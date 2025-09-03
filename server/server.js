// server/server.js
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

/* ---------- config ---------- */
const PORT = process.env.PORT || 8787;
const DATABASE_URL = process.env.DATABASE_URL; // set this in Render

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
  process.exit(1);
}

// static players + passwords (no external auth)
const PLAYERS = [
  "Bader", "Charbel", "Christian", "Edmond",
  "Edwin", "Justin", "Marc", "Rayan"
];
const PASSWORDS = {
  Bader:"Ghoul23", Charbel:"0.2kd", Christian:"b4ss0",
  Edmond:"123eddy123", Edwin:"guzwin1", Justin:"jbcbobj",
  Marc:"mezapromax", Rayan:"nurumassage"
};

/* ---------- db ---------- */
const pool = new Pool({
  connectionString: DATABASE_URL.replace(/channel_binding=.*?(?:&|$)/, ""), // strip channel_binding if present
  ssl: { rejectUnauthorized: false },
});

/* ---------- helpers ---------- */
const now = () => Date.now();
const checkCreds = (name, password) =>
  PLAYERS.includes(name) && PASSWORDS[name] === password;

/* ---------- app ---------- */
const app = express();

// CORS: keep open during testing; lock to your Vercel domain later
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/players", (_req, res) => res.json({ players: PLAYERS }));

app.post("/login", (req, res) => {
  const { name, password } = req.body || {};
  if (checkCreds(name, password)) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: "invalid_credentials" });
});

/**
 * Replace entire set for rater (ONE-SHOT).
 * If this rater has already submitted at least once (has any rows), reject with 409.
 */
app.post("/submit", async (req, res) => {
  const { name, password, entries } = req.body || {};
  if (!checkCreds(name, password)) {
    return res.status(401).json({ ok:false, error:"invalid_credentials" });
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ ok:false, error:"entries_required" });
  }
  for (const e of entries) {
    if (!PLAYERS.includes(e.ratee) || e.ratee === name) {
      return res.status(400).json({ ok:false, error:"invalid_ratee" });
    }
    if (!Number.isFinite(e.score) || e.score < 1 || e.score > 10) {
      return res.status(400).json({ ok:false, error:"invalid_score" });
    }
  }

  const client = await pool.connect();
  try {
    // Has this rater already submitted?
    const existing = await client.query(
      "SELECT 1 FROM ratings WHERE rater = $1 LIMIT 1",
      [name]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ ok:false, error:"already_submitted" });
    }

    await client.query("BEGIN");
    const ts = now();
    const values = [];
    const placeholders = [];
    entries.forEach((e, i) => {
      values.push(name, e.ratee, Math.round(e.score), ts);
      const b = i * 4;
      placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
    });

    await client.query(
      `INSERT INTO ratings (rater, ratee, score, ts) VALUES ${placeholders.join(",")}`,
      values
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ ok:false, error:"db_error" });
  } finally {
    client.release();
  }
});

// fetch my set
app.get("/mine", async (req, res) => {
  const { name } = req.query;
  if (!PLAYERS.includes(String(name))) return res.status(400).json({ ok:false, error:"invalid_name" });
  try {
    const { rows } = await pool.query(
      "SELECT rater, ratee, score, ts AS timestamp FROM ratings WHERE rater = $1 ORDER BY ratee ASC",
      [name]
    );
    res.json({ ok:true, ratings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"db_error" });
  }
});

/**
 * Leaderboard
 * - Returns rows
 * - Returns `ready: true` only when ALL players have submitted (distinct raters = PLAYERS.length).
 *   Frontend should hide the leaderboard UI unless ready=true.
 */
app.get("/leaderboard", async (_req, res) => {
  try {
    const readyCheck = await pool.query(
      "SELECT COUNT(DISTINCT rater) AS c FROM ratings"
    );
    const distinctRaters = Number(readyCheck.rows[0]?.c ?? 0);
    const ready = distinctRaters >= PLAYERS.length;

    const { rows } = await pool.query(
      `
      SELECT
        p.name AS player,
        COALESCE(AVG(r.score), 0) AS average,
        COUNT(r.score) AS ratings
      FROM (VALUES ${PLAYERS.map((_, i) => `($${i+1})`).join(",")}) AS p(name)
      LEFT JOIN ratings r ON r.ratee = p.name
      GROUP BY p.name
      ORDER BY average DESC
      `,
      PLAYERS
    );

    res.json({
      ok:true,
      ready,
      rows: rows.map(r => ({
        player: r.player,
        average: Number(r.average),
        ratings: Number(r.ratings)
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"db_error" });
  }
});

// No edits allowed after submission: remove/disable batch endpoint
app.patch("/mine", (_req, res) => {
  res.status(405).json({ ok:false, error:"editing_disabled" });
});

// admin reset
app.post("/reset", async (req, res) => {
  const { name, password } = req.body || {};
  if (!(name === "Bader" && checkCreds(name, password))) {
    return res.status(403).json({ ok:false, error:"admin_only" });
  }
  try {
    await pool.query("DELETE FROM ratings");
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"db_error" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
