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
  // players
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY,
      password TEXT NOT NULL
    );
  `);

  // matches (each "round")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id BIGSERIAL PRIMARY KEY,
      played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  // ratings (may already exist with old PK; we migrate below)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      rater TEXT NOT NULL,
      ratee TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
      ts BIGINT NOT NULL
      -- PK and match_id will be (re)applied below
    );
  `);

  // Add match_id if missing
  await pool.query(`
    ALTER TABLE ratings
      ADD COLUMN IF NOT EXISTS match_id BIGINT;
  `);

  // Ensure FKs (idempotent)
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

  // Ensure per-match uniqueness PK: (match_id, rater, ratee)
  await pool.query(`
    DO $$
    BEGIN
      -- Drop old primary key if present
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='ratings' AND constraint_type='PRIMARY KEY'
      ) THEN
        ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_pkey;
      END IF;

      -- Create new composite primary key if missing
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

  // Seed players if empty (same as before)
  const { rows: playerCount } = await pool.query(`SELECT COUNT(*)::int AS n FROM players`);
  if (playerCount[0].n === 0) {
    const seed = [
      ["Bader", "Ghoul23"],
      ["Charbel", "0.2kd"],
      ["Christian", "b4ss0"],
      ["Edmond", "123eddy123"],
      ["Edwin", "guzwin1"],
      ["Justin", "jbcbobj"],
      ["Marc", "mezapromax"],
      ["Rayan", "nurumassage"],
    ];
    const values = [];
    const ph = seed.map((_, i) => {
      const b = i * 2;
      values.push(seed[i][0], seed[i][1]);
      return `($${b + 1}, $${b + 2})`;
    });
    await pool.query(
      `INSERT INTO players(name, password) VALUES ${ph.join(",")}`,
      values
    );
  }

  // Ensure at least one match exists
  await pool.query(`INSERT INTO matches DEFAULT VALUES ON CONFLICT DO NOTHING;`);

  // Backfill existing ratings to the first (oldest) match if match_id is null
  await pool.query(`
    WITH first_match AS (
      SELECT id FROM matches ORDER BY id ASC LIMIT 1
    )
    UPDATE ratings
    SET match_id = (SELECT id FROM first_match)
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
    `SELECT 1 FROM players WHERE name = $1 AND password = $2 LIMIT 1`,
    [name, password]
  );
  return rows.length > 0;
}
async function getPlayers() {
  const { rows } = await pool.query(`SELECT name FROM players ORDER BY name ASC`);
  return rows.map((r) => r.name);
}
async function getCurrentMatchId() {
  const { rows } = await pool.query(`SELECT id FROM matches ORDER BY id DESC LIMIT 1`);
  return rows[0]?.id;
}
async function getTotalsForMatch(matchId) {
  const players = await getPlayers();
  const total = players.length;
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
    res.json({ ok: true, players: await getPlayers() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/login", async (req, res) => {
  const { name, password } = req.body || {};
  try {
    if (await checkCreds(name, password)) return res.json({ ok: true });
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: add a new player (only Bader can do this)
app.post("/admin/players", async (req, res) => {
  const { adminName, adminPassword, name, password } = req.body || {};
  try {
    if (!(adminName === "Bader" && (await checkCreds(adminName, adminPassword)))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name || !password) {
      return res.status(400).json({ ok: false, error: "name_and_password_required" });
    }
    await pool.query(`INSERT INTO players(name, password) VALUES ($1, $2)`, [name, password]);
    return res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes("duplicate key")) {
      return res.status(400).json({ ok: false, error: "player_exists" });
    }
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: remove a player (only Bader). Also deletes that player’s ratings via FK.
app.delete("/admin/players", async (req, res) => {
  const payload = { ...(req.body || {}), ...(req.query || {}) };
  const { adminName, adminPassword, name } = payload;
  try {
    if (!(adminName === "Bader" && (await checkCreds(adminName, adminPassword)))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name) {
      return res.status(400).json({ ok: false, error: "name_required" });
    }
    const result = await pool.query(
      `DELETE FROM players WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
      [name]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// replace entire set for rater (one-shot) within current match
app.post("/submit", async (req, res) => {
  const { name, password, entries } = req.body || {};
  try {
    if (!(await checkCreds(name, password))) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    const matchId = await getCurrentMatchId();

    const check = await pool.query(
      `SELECT 1 FROM ratings WHERE match_id = $1 AND rater = $2 LIMIT 1`,
      [matchId, name]
    );
    if (check.rows.length > 0) {
      return res.status(400).json({ ok: false, error: "already_submitted" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ ok: false, error: "entries_required" });
    }

    const players = await getPlayers();
    const setPlayers = new Set(players);
    const ts = now();

    for (const e of entries) {
      const score = Number(e.score);
      if (!setPlayers.has(e.ratee) || e.ratee === name) {
        return res.status(400).json({ ok: false, error: "invalid_ratee" });
      }
      if (!Number.isFinite(score) || score < 1 || score > 10) {
        return res.status(400).json({ ok: false, error: "invalid_score" });
      }
    }

    // Build (match_id, rater, ratee, score, ts) rows
    const values = [];
    const ph = entries.map((e, i) => {
      const base = i * 5;
      values.push(matchId, name, e.ratee, Math.round(Number(e.score)), ts);
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
    const matchId = await getCurrentMatchId();
    const { rows } = await pool.query(
      `SELECT rater, ratee, score, ts AS timestamp
       FROM ratings
       WHERE match_id = $1 AND rater = $2
       ORDER BY ratee ASC`,
      [matchId, String(name)]
    );
    res.json({ ok: true, ratings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// leaderboard for current match (locked until all players submitted)
app.get("/leaderboard", async (_req, res) => {
  try {
    const matchId = await getCurrentMatchId();
    const { total, raters } = await getTotalsForMatch(matchId);
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
      [matchId]
    );

    res.json({
      ok: true,
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

// overall leaderboard: averages across all *locked* matches
app.get("/leaderboard/overall", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      WITH locked_matches AS (
        SELECT id FROM matches WHERE locked = TRUE
      ),
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

// admin "reset": close current match, then start a new one (no data loss)
app.post("/reset", async (req, res) => {
  const { name, password } = req.body || {};
  try {
    if (!(name === "Bader" && (await checkCreds(name, password)))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }

    const matchId = await getCurrentMatchId();
    const { total, raters } = await getTotalsForMatch(matchId);
    const ready = raters >= total && total > 0;

    // Mark closed (locked if everyone submitted)
    await pool.query(`UPDATE matches SET locked = $1 WHERE id = $2`, [ready, matchId]);

    // Start a new match for the next round
    const { rows } = await pool.query(`INSERT INTO matches DEFAULT VALUES RETURNING id`);
    res.json({ ok: true, closedMatch: matchId, locked: ready, newMatch: rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
