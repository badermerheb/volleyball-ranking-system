// server/server.js
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = process.env.PORT || 8787;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL.replace(/channel_binding=.*?(?:&|$)/, ""),
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(cors());
app.use(express.json());

const now = () => Date.now();

/* -------------------- bootstrap schema + seed -------------------- */
async function ensureSchema() {
  // players (+ can_rate)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      can_rate BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await pool.query(`
    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS can_rate BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  // matches (each round). Start locked; admin unlocks to begin.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id BIGSERIAL PRIMARY KEY,
      played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  // ratings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      rater TEXT NOT NULL,
      ratee TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
      ts BIGINT NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS match_id BIGINT;`);

  // FKs idempotent
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ratings_rater_fkey'
      ) THEN
        ALTER TABLE ratings
          ADD CONSTRAINT ratings_rater_fkey
          FOREIGN KEY (rater) REFERENCES players(name) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ratings_ratee_fkey'
      ) THEN
        ALTER TABLE ratings
          ADD CONSTRAINT ratings_ratee_fkey
          FOREIGN KEY (ratee) REFERENCES players(name) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ratings_match_fkey'
      ) THEN
        ALTER TABLE ratings
          ADD CONSTRAINT ratings_match_fkey
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
      END IF;
    END$$;
  `);

  // Composite PK (match_id, rater, ratee)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='ratings' AND constraint_type='PRIMARY KEY'
      ) THEN
        ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_pkey;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='ratings' AND constraint_name='ratings_match_rater_ratee_pk'
      ) THEN
        ALTER TABLE ratings
          ADD CONSTRAINT ratings_match_rater_ratee_pk
          PRIMARY KEY (match_id, rater, ratee);
      END IF;
    END$$;
  `);

  // Seed players if empty
  const { rows: playerCount } = await pool.query(`SELECT COUNT(*)::int AS n FROM players`);
  if (playerCount[0].n === 0) {
    const seed = [
      ["Bader", "Ghoul23"],
      ["Charbel", "0.2kd"],
      ["Christian", "b4ss0"],
      ["Edmond", "123eddy123"],
      ["Edwin", "guzwin1"],
      ["Justin", "jbcbobj"],
      ["Mambo", "mamb00b"],
      ["Marc", "mezapromax"],
      ["Rayan", "nurumassage"],
    ];
    const values = [];
    const ph = seed.map((_, i) => {
      const b = i * 2;
      values.push(seed[i][0], seed[i][1]);
      return `($${b + 1}, $${b + 2})`;
    });
    await pool.query(`INSERT INTO players(name, password) VALUES ${ph.join(",")}`, values);
    // optional: turn on for seed (you can remove this if you want OFF by default)
    await pool.query(`UPDATE players SET can_rate = TRUE WHERE name = ANY($1)`, [
      seed.map((s) => s[0]),
    ]);
  }

  // Ensure a match exists (locked by default)
  await pool.query(`INSERT INTO matches DEFAULT VALUES ON CONFLICT DO NOTHING;`);

  // Backfill ratings to the first match if needed
  await pool.query(`
    WITH first_match AS (SELECT id FROM matches ORDER BY id ASC LIMIT 1)
    UPDATE ratings SET match_id = (SELECT id FROM first_match)
    WHERE match_id IS NULL;
  `);
}
ensureSchema().catch((e) => {
  console.error("Schema init failed", e);
  process.exit(1);
});

/* -------------------- helpers -------------------- */
async function checkCreds(name, password) {
  if (!name || !password) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM players WHERE LOWER(name) = LOWER($1) AND password = $2 LIMIT 1`,
    [name, password]
  );
  return rows.length > 0;
}
async function canonicalName(name) {
  const { rows } = await pool.query(
    `SELECT name FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name]
  );
  return rows[0]?.name || name;
}
async function getAllPlayers() {
  const { rows } = await pool.query(`SELECT name FROM players ORDER BY LOWER(name) ASC`);
  return rows.map((r) => r.name);
}
async function getEligibleRaters() {
  const { rows } = await pool.query(
    `SELECT name FROM players WHERE can_rate = TRUE ORDER BY LOWER(name) ASC`
  );
  return rows.map((r) => r.name);
}
async function getCurrentMatch() {
  const { rows } = await pool.query(
    `SELECT id, locked FROM matches ORDER BY id DESC LIMIT 1`
  );
  return rows[0];
}
async function getTotalsForMatch(matchId) {
  const eligible = await getEligibleRaters();
  const total = eligible.length;
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT rater)::int AS n FROM ratings WHERE match_id = $1`,
    [matchId]
  );
  return { total, raters: rows[0].n };
}

/* -------------------- routes -------------------- */
app.get("/", (_req, res) => res.json({ ok: true }));

app.get("/players", async (_req, res) => {
  try {
    res.json({ ok: true, players: await getAllPlayers() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/players/details", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, can_rate FROM players ORDER BY LOWER(name) ASC`
    );
    res.json({ ok: true, players: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Case-insensitive username; returns canonical casing
app.post("/login", async (req, res) => {
  const { name, password } = req.body || {};
  try {
    const { rows } = await pool.query(
      `SELECT name FROM players WHERE LOWER(name) = LOWER($1) AND password = $2 LIMIT 1`,
      [name, password]
    );
    if (rows.length) return res.json({ ok: true, name: rows[0].name });
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: add player (can_rate defaults to FALSE)
app.post("/admin/players", async (req, res) => {
  const { adminName, adminPassword, name, password } = req.body || {};
  try {
    if (!(await checkCreds(adminName, adminPassword))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name || !password) {
      return res.status(400).json({ ok: false, error: "name_and_password_required" });
    }
    await pool.query(`INSERT INTO players(name, password) VALUES ($1, $2)`, [name, password]);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes("duplicate key")) {
      return res.status(400).json({ ok: false, error: "player_exists" });
    }
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: remove player completely
app.delete("/admin/players", async (req, res) => {
  const payload = { ...(req.body || {}), ...(req.query || {}) };
  const { adminName, adminPassword, name } = payload;
  try {
    if (!(await checkCreds(adminName, adminPassword))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    const result = await pool.query(
      `DELETE FROM players WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
      [name]
    );
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: include/exclude one player (toggle can_rate for a single name)
// ---- shared handler (so we can mount on POST and PATCH) ----
async function togglePlayerPermission(req, res) {
  try {
    const { adminName, adminPassword, name } = req.body || {};
    let { can_rate } = req.body || {};

    // admin auth (treat "Bader" case-insensitively)
    if (
      !(
        adminName &&
        adminName.toString().toLowerCase() === "bader" &&
        (await checkCreds(adminName, adminPassword))
      )
    ) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }

    // coerce boolean
    if (typeof can_rate === "string") {
      const t = can_rate.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "yes") can_rate = true;
      else if (t === "false" || t === "0" || t === "no") can_rate = false;
    }
    if (!name || typeof can_rate !== "boolean") {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }

    // case-insensitive, trim match
    const result = await pool.query(
      `UPDATE players
         SET can_rate = $1
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))`,
      [can_rate, name]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true, name, can_rate });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
}
// Support BOTH PATCH and POST (client can use either)
app.patch("/admin/players/permission", togglePlayerPermission);
app.post("/admin/players/permission", togglePlayerPermission);

// ADMIN: lock/unlock for everyone (bulk set can_rate, and set match lock)
app.post("/admin/lock", async (req, res) => {
  const { name, password, locked } = req.body || {};
  try {
    if (!(await checkCreds(name, password))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    const match = await getCurrentMatch();

    // Set match lock
    await pool.query(`UPDATE matches SET locked = $1 WHERE id = $2`, [!!locked, match.id]);

    // Bulk permission flip:
    if (locked) {
      await pool.query(`UPDATE players SET can_rate = FALSE`);
    } else {
      await pool.query(`UPDATE players SET can_rate = TRUE`);
    }

    res.json({ ok: true, locked: !!locked });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Submit ratings (must have can_rate and match must be unlocked)
app.post("/submit", async (req, res) => {
  const { name, password, entries } = req.body || {};
  try {
    if (!(await checkCreds(name, password))) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    const { rows: perm } = await pool.query(
      `SELECT can_rate FROM players WHERE LOWER(name)=LOWER($1)`,
      [name]
    );
    if (!perm[0]?.can_rate) {
      return res.status(403).json({ ok: false, error: "no_permission_to_rate" });
    }

    const match = await getCurrentMatch();
    if (match.locked) {
      return res.status(423).json({ ok: false, error: "ratings_locked" });
    }

    const raterName = await canonicalName(name);

    const check = await pool.query(
      `SELECT 1 FROM ratings WHERE match_id = $1 AND rater = $2 LIMIT 1`,
      [match.id, raterName]
    );
    if (check.rows.length > 0) {
      return res.status(400).json({ ok: false, error: "already_submitted" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ ok: false, error: "entries_required" });
    }

    const players = await getAllPlayers();
    const setPlayers = new Set(players);
    const ts = now();

    for (const e of entries) {
      const score = Number(e.score);
      if (!setPlayers.has(e.ratee) || e.ratee.toLowerCase() === raterName.toLowerCase()) {
        return res.status(400).json({ ok: false, error: "invalid_ratee" });
      }
      if (!Number.isFinite(score) || score < 1 || score > 10) {
        return res.status(400).json({ ok: false, error: "invalid_score" });
      }
    }

    const values = [];
    const ph = entries.map((e, i) => {
      const base = i * 5;
      values.push(match.id, raterName, e.ratee, Math.round(Number(e.score)), ts);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await pool.query(
      `INSERT INTO ratings (match_id, rater, ratee, score, ts) VALUES ${ph.join(",")}`,
      values
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// fetch my set (current match)
app.get("/mine", async (req, res) => {
  const { name } = req.query;
  try {
    const match = await getCurrentMatch();
    const rName = await canonicalName(String(name));
    const { rows } = await pool.query(
      `SELECT rater, ratee, score, ts AS timestamp
       FROM ratings
       WHERE match_id = $1 AND rater = $2
       ORDER BY ratee ASC`,
      [match.id, rName]
    );
    res.json({ ok: true, ratings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// current-match leaderboard (ready counts eligible only)
app.get("/leaderboard", async (_req, res) => {
  try {
    const match = await getCurrentMatch();
    const { total, raters } = await getTotalsForMatch(match.id);
    const ready = raters >= total && total > 0;

    const { rows } = await pool.query(
      `
      WITH p AS (SELECT name FROM players)
      SELECT
        p.name AS player,
        COALESCE(AVG(r.score), 0) AS average,
        COUNT(r.score) AS ratings
      FROM p
      LEFT JOIN ratings r
        ON r.ratee = p.name
       AND r.match_id = $1
      GROUP BY p.name
      ORDER BY average DESC
      `,
      [match.id]
    );

    res.json({
      ok: true,
      locked: !!match.locked,
      ready,
      raters,
      total,
      rows: rows.map((r) => ({
        player: r.player,
        average: Number(r.average),
        ratings: Number(r.ratings),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// overall leaderboard over locked matches
app.get("/leaderboard/overall", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      WITH locked_matches AS (SELECT id FROM matches WHERE locked = TRUE),
      p AS (SELECT name FROM players)
      SELECT
        p.name AS player,
        COALESCE(AVG(r.score), 0) AS average,
        COUNT(r.score) AS ratings
      FROM p
      LEFT JOIN ratings r
        ON r.ratee = p.name
       AND r.match_id IN (SELECT id FROM locked_matches)
      GROUP BY p.name
      ORDER BY average DESC
      `
    );
    res.json({
      ok: true,
      rows: rows.map((r) => ({
        player: r.player,
        average: Number(r.average),
        ratings: Number(r.ratings),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// reset: lock current match, create a new locked match
app.post("/reset", async (req, res) => {
  const { name, password } = req.body || {};
  try {
    if (!(await checkCreds(name, password))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    const match = await getCurrentMatch();
    await pool.query(`UPDATE matches SET locked = TRUE WHERE id = $1`, [match.id]);
    const { rows } = await pool.query(
      `INSERT INTO matches (locked) VALUES (TRUE) RETURNING id`
    );
    res.json({ ok: true, closedMatch: match.id, locked: true, newMatch: rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
