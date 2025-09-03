// server/server.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

/* -------------------- Config -------------------- */
const PORT = process.env.PORT || 8787;
// Persistent data directory (use Render disk mount if provided)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, "db.json");

// Optional: lock CORS to your deployed frontend origin
// e.g. FRONTEND_ORIGIN=https://vb-rank-frontend.vercel.app
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";

/* -------------------- Domain -------------------- */
const PLAYERS = [
  "Bader", "Charbel", "Christian", "Edmond",
  "Edwin", "Justin", "Marc", "Rayan"
];

const PASSWORDS = {
  Bader: "Ghoul23",
  Charbel: "0.2kd",
  Christian: "b4ss0",
  Edmond: "123eddy123",
  Edwin: "guzwin1",
  Justin: "jbcbobj",
  Marc: "mezapromax",
  Rayan: "nurumassage",
};

/* -------------------- Tiny File “DB” -------------------- */
function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ ratings: [] }, null, 2));
  }
}
function loadDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  try { return JSON.parse(raw); } catch { return { ratings: [] }; }
}
function saveDB(db) {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
const now = () => Date.now();

/* -------------------- Helpers -------------------- */
function checkCreds(name, password) {
  const okName = PLAYERS.includes(name);
  const okPass = okName && PASSWORDS[name] === password;
  return okPass;
}

function replaceAllForRater(ratings, rater, newEntries) {
  // dedupe by ratee
  const dedup = Object.values(
    (newEntries || []).reduce((acc, e) => {
      acc[e.ratee] = e;
      return acc;
    }, {})
  );
  const others = ratings.filter((r) => r.rater !== rater);
  return [...others, ...dedup];
}

function computeLeaderboard(ratings) {
  const map = Object.fromEntries(PLAYERS.map(p => [p, { total: 0, count: 0 }]));
  for (const r of ratings) {
    if (!map[r.ratee]) map[r.ratee] = { total: 0, count: 0 };
    map[r.ratee].total += r.score;
    map[r.ratee].count += 1;
  }
  return PLAYERS
    .map((p) => {
      const { total, count } = map[p];
      return { player: p, average: count ? total / count : 0, ratings: count };
    })
    .sort((a, b) => b.average - a.average);
}

/* -------------------- App -------------------- */
const app = express();

// CORS: open by default; lock to FRONTEND_ORIGIN if set
if (FRONTEND_ORIGIN) {
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origin === FRONTEND_ORIGIN) return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );
} else {
  app.use(cors());
}

app.use(express.json());

// Health
app.get("/", (_req, res) => res.json({ ok: true }));

// Players list
app.get("/players", (_req, res) => res.json({ players: PLAYERS }));

// Optional login check (frontend does a quick check already)
app.post("/login", (req, res) => {
  const { name, password } = req.body || {};
  if (checkCreds(name, password)) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: "invalid_credentials" });
});

// Submit a full run (replace entire set for this rater)
app.post("/submit", (req, res) => {
  const { name, password, entries } = req.body || {};
  if (!checkCreds(name, password)) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ ok: false, error: "entries_required" });
  }

  for (const e of entries) {
    if (!PLAYERS.includes(e.ratee) || e.ratee === name) {
      return res.status(400).json({ ok: false, error: "invalid_ratee" });
    }
    if (typeof e.score !== "number" || e.score < 1 || e.score > 10) {
      return res.status(400).json({ ok: false, error: "invalid_score" });
    }
  }

  const db = loadDB();
  const ts = now();
  const normalized = entries.map((e) => ({
    rater: name,
    ratee: e.ratee,
    score: Math.round(e.score),
    timestamp: ts,
  }));

  db.ratings = replaceAllForRater(db.ratings, name, normalized);
  saveDB(db);
  return res.json({ ok: true });
});

// Get my current set
app.get("/mine", (req, res) => {
  const name = String(req.query.name || "");
  if (!PLAYERS.includes(name)) {
    return res.status(400).json({ ok: false, error: "invalid_name" });
  }
  const db = loadDB();
  const mine = db.ratings.filter((r) => r.rater === name);
  res.json({ ok: true, ratings: mine });
});

// Batch update (Save all changes). Empty {} clears the set.
app.patch("/mine", (req, res) => {
  const { name, password, scores } = req.body || {};
  if (!checkCreds(name, password)) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
  if (typeof scores !== "object" || scores === null) {
    return res.status(400).json({ ok: false, error: "scores_required" });
  }

  const ts = now();
  try {
    const newEntries = Object.entries(scores).map(([ratee, score]) => {
      if (!PLAYERS.includes(ratee) || ratee === name) {
        throw new Error("invalid_ratee");
      }
      const num = Number(score);
      if (!Number.isFinite(num) || num < 1 || num > 10) {
        throw new Error("invalid_score");
      }
      return { rater: name, ratee, score: Math.round(num), timestamp: ts };
    });

    const db = loadDB();
    db.ratings = replaceAllForRater(db.ratings, name, newEntries);
    saveDB(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || "bad_request" });
  }
});

// Leaderboard
app.get("/leaderboard", (_req, res) => {
  const db = loadDB();
  res.json({ ok: true, rows: computeLeaderboard(db.ratings) });
});

// Admin reset (only Bader)
app.post("/reset", (req, res) => {
  const { name, password } = req.body || {};
  if (!(name === "Bader" && checkCreds(name, password))) {
    return res.status(403).json({ ok: false, error: "admin_only" });
  }
  saveDB({ ratings: [] });
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`DB path: ${DB_PATH}`);
});
