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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY,
      password TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      rater TEXT NOT NULL,
      ratee TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
      ts BIGINT NOT NULL,
      PRIMARY KEY (rater, ratee),
      FOREIGN KEY (rater) REFERENCES players(name) ON DELETE CASCADE,
      FOREIGN KEY (ratee) REFERENCES players(name) ON DELETE CASCADE
    );
  `);

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM players`);
  if (rows[0].n === 0) {
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
  const { rows } = await pool.query(
    `SELECT name FROM players ORDER BY name ASC`
  );
  return rows.map((r) => r.name);
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
    return res
      .status(401)
      .json({ ok: false, error: "invalid_credentials" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ADMIN: add a new player (only Bader can do this)
app.post("/admin/players", async (req, res) => {
  const { adminName, adminPassword, name, password } = req.body || {};
  try {
    if (
      !(adminName === "Bader" && (await checkCreds(adminName, adminPassword)))
    ) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "name_and_password_required" });
    }
    await pool.query(
      `INSERT INTO players(name, password) VALUES ($1, $2)`,
      [name, password]
    );
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
  const { adminName, adminPassword, name } = req.body || {};
  try {
    if (
      !(adminName === "Bader" && (await checkCreds(adminName, adminPassword)))
    ) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    if (!name) {
      return res
        .status(400)
        .json({ ok: false, error: "name_required" });
    }
    const result = await pool.query(
      `DELETE FROM players WHERE name = $1`,
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

// replace entire set for rater (one-shot)
app.post("/submit", async (req, res) => {
  const { name, password, entries } = req.body || {};
  try {
    if (!(await checkCreds(name, password))) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    const check = await pool.query(
      `SELECT 1 FROM ratings WHERE rater = $1 LIMIT 1`,
      [name]
    );
    if (check.rows.length > 0) {
      return res.status(400).json({ ok: false, error: "already_submitted" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: "entries_required" });
    }

    const players = await getPlayers();
    const setPlayers = new Set(players);
    const ts = now();

    for (const e of entries) {
      const score = Number(e.score);
      if (!setPlayers.has(e.ratee) || e.ratee === name)
        return res
          .status(400)
          .json({ ok: false, error: "invalid_ratee" });
      if (!Number.isFinite(score) || score < 1 || score > 10)
        return res
          .status(400)
          .json({ ok: false, error: "invalid_score" });
    }

    const values = [];
    const ph = entries.map((e, i) => {
      values.push(name, e.ratee, Math.round(Number(e.score)), ts);
      const b = i * 4;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
    });
    await pool.query(
      `INSERT INTO ratings (rater, ratee, score, ts) VALUES ${ph.join(",")}`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// fetch my set
app.get("/mine", async (req, res) => {
  const { name } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT rater, ratee, score, ts AS timestamp
       FROM ratings
       WHERE rater = $1
       ORDER BY ratee ASC`,
      [String(name)]
    );
    res.json({ ok: true, ratings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// leaderboard (locked until all players submitted)
app.get("/leaderboard", async (_req, res) => {
  try {
    const players = await getPlayers();
    const total = players.length;

    const { rows: ratersRows } = await pool.query(
      `SELECT COUNT(DISTINCT rater)::int AS n FROM ratings`
    );
    const raters = ratersRows[0].n;
    const ready = raters >= total && total > 0;

    const { rows } = await pool.query(
      `
      WITH p AS (SELECT name FROM players)
      SELECT
        p.name AS player,
        COALESCE(AVG(r.score), 0) AS average,
        COUNT(r.score) AS ratings
      FROM p
      LEFT JOIN ratings r ON r.ratee = p.name
      GROUP BY p.name
      ORDER BY average DESC
      `
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

// admin reset (only Bader)
app.post("/reset", async (req, res) => {
  const { name, password } = req.body || {};
  try {
    if (!(name === "Bader" && (await checkCreds(name, password)))) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    await pool.query(`DELETE FROM ratings`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
