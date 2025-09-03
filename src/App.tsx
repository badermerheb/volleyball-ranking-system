import React, { useMemo, useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Slider } from "./components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Separator } from "./components/ui/separator";
import { Badge } from "./components/ui/badge";
import { ShieldCheck, LogOut, Trophy, UserRound, RefreshCcw, BarChart3 } from "lucide-react";

/* -------------------- Config -------------------- */
// src/App.tsx
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

/* -------------------- Domain Data -------------------- */
const PLAYERS = [
  "Bader",
  "Charbel",
  "Christian",
  "Edmond",
  "Edwin",
  "Justin",
  "Marc",
  "Rayan",
] as const;

const PASSWORDS: Record<(typeof PLAYERS)[number], string> = {
  Bader: "Ghoul23",
  Charbel: "0.2kd",
  Christian: "b4ss0",
  Edmond: "123eddy123",
  Edwin: "guzwin1",
  Justin: "jbcbobj",
  Marc: "mezapromax",
  Rayan: "nurumassage",
};

/* -------------------- Types -------------------- */
interface RatingEntry {
  rater: string;
  ratee: string;
  score: number;
  timestamp: number;
}
interface LeaderboardRow {
  player: string;
  average: number;
  ratings: number;
}

/* -------------------- API helpers -------------------- */
async function apiGet<T>(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
async function apiSend<T>(path: string, body: any, method: "POST" | "PATCH" = "POST") {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const data = await apiGet<{ ok: boolean; rows: LeaderboardRow[] }>("/leaderboard");
  return data.rows ?? [];
}
async function fetchMine(name: string): Promise<RatingEntry[]> {
  const data = await apiGet<{ ok: boolean; ratings: RatingEntry[] }>(`/mine?name=${encodeURIComponent(name)}`);
  return data.ratings ?? [];
}
async function submitRun(name: string, entries: { ratee: string; score: number }[]) {
  return apiSend<{ ok: boolean }>("/submit", {
    name,
    password: PASSWORDS[name as keyof typeof PASSWORDS],
    entries,
  });
}
async function batchSave(name: string, scores: Record<string, number>) {
  return apiSend<{ ok: boolean }>("/mine", {
    name,
    password: PASSWORDS[name as keyof typeof PASSWORDS],
    scores,
  }, "PATCH");
}
async function adminReset(name: string) {
  return apiSend<{ ok: boolean }>("/reset", {
    name,
    password: PASSWORDS[name as keyof typeof PASSWORDS],
  });
}

/* -------------------- Avatar / Dots -------------------- */
function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const hue = Math.abs([...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 360;
  return (
    <div
      className="grid place-items-center text-white font-semibold rounded-2xl shadow"
      style={{ width: size, height: size, background: `hsl(${hue} 65% 45%)` }}
      title={name}
    >
      {initials}
    </div>
  );
}
function Dots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex items-center gap-1 mt-4">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full ${i <= index ? "bg-foreground/80" : "bg-foreground/20"}`} />
      ))}
    </div>
  );
}

/* -------------------- Main App -------------------- */
export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  // server-backed state
  const [myRatings, setMyRatings] = useState<RatingEntry[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);

  // rating session state (client-only until submit)
  const [pendingOrder, setPendingOrder] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentScore, setCurrentScore] = useState(7);
  const [sessionRatings, setSessionRatings] = useState<{ ratee: string; score: number }[]>([]);

  // load leaderboard on mount (optional; you can also defer until login)
  useEffect(() => {
    fetchLeaderboard().then(setLeaderboardRows).catch(() => {});
  }, []);

  // when user logs in, pull his current set + latest leaderboard
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const [mine, rows] = await Promise.all([fetchMine(currentUser), fetchLeaderboard()]);
        setMyRatings(mine);
        setLeaderboardRows(rows);
      } catch (e) {
        toast.error("Failed to load data from server.");
      }
    })();
  }, [currentUser]);

  const leaderboardMemo = useMemo(() => leaderboardRows, [leaderboardRows]);

  /* ---------- Flow helpers ---------- */
  function startRatingFlow() {
    if (!currentUser) return;
    const order = PLAYERS.filter((p) => p !== currentUser);
    const seed = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const rng = mulberry32(hashStr(seed + currentUser));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    setPendingOrder(order);
    setCurrentIndex(0);
    setCurrentScore(7);
    setSessionRatings([]);
  }

  async function startFreshRun() {
    if (!currentUser) return;
    try {
      // Clear my set on server (empty scores -> remove my entries)
      await batchSave(currentUser, {});
      const [mine, rows] = await Promise.all([fetchMine(currentUser), fetchLeaderboard()]);
      setMyRatings(mine);
      setLeaderboardRows(rows);
      toast("Your previous submissions were cleared. Starting a fresh run.");
      startRatingFlow();
    } catch {
      toast.error("Failed to start fresh run.");
    }
  }

  async function submitOne() {
    if (!currentUser) return;
    const ratee = pendingOrder[currentIndex];
    const nextSession = [...sessionRatings, { ratee, score: currentScore }];
    setSessionRatings(nextSession);

    if (currentIndex < pendingOrder.length - 1) {
      setCurrentIndex((i) => i + 1);
      setCurrentScore(7);
    } else {
      // finalize: send to server and refresh local views
      try {
        await submitRun(currentUser, nextSession);
        const [mine, rows] = await Promise.all([fetchMine(currentUser), fetchLeaderboard()]);
        setMyRatings(mine);
        setLeaderboardRows(rows);
        toast.success("Ratings submitted. Leaderboard updated.");
      } catch (e) {
        toast.error("Failed to submit ratings.");
      }
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    setPendingOrder([]);
    setCurrentIndex(0);
    setSessionRatings([]);
    setMyRatings([]);
  }

  async function handleReset() {
    if (currentUser !== "Bader") {
      toast.error("Only Bader (admin) can reset data.");
      return;
    }
    try {
      await adminReset("Bader");
      setMyRatings([]);
      setLeaderboardRows([]);
      toast("All saved ratings cleared for everyone.");
    } catch {
      toast.error("Reset failed.");
    }
  }

  /* ---------- Batch Save from History ---------- */
  async function updateMyBatchRatings(newScores: Record<string, number>) {
    if (!currentUser) return;
    try {
      await batchSave(currentUser, newScores);
      const [mine, rows] = await Promise.all([fetchMine(currentUser), fetchLeaderboard()]);
      setMyRatings(mine);
      setLeaderboardRows(rows);
      toast.success("All changes saved.");
    } catch {
      toast.error("Failed to save changes.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 text-foreground p-4 md:p-10">
      <div className="mx-auto max-w-5xl grid gap-6">
        <Header
          currentUser={currentUser}
          onLogout={handleLogout}
          onReset={handleReset}
          isAdmin={currentUser === "Bader"}
        />
        {!currentUser ? (
          <LoginCard onLogin={setCurrentUser} />
        ) : (
          <Tabs defaultValue="rate" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="rate">Rate Players</TabsTrigger>
              <TabsTrigger value="board">Leaderboard</TabsTrigger>
              <TabsTrigger value="history">My Submissions</TabsTrigger>
            </TabsList>

            <TabsContent value="rate">
              <RateFlow
                key={currentUser}
                currentUser={currentUser}
                currentIndex={currentIndex}
                currentScore={currentScore}
                onScoreChange={setCurrentScore}
                onSubmitOne={submitOne}
                pendingOrder={pendingOrder}
                onStart={startRatingFlow}
                onStartFresh={startFreshRun}
                hasFinished={sessionRatings.length === PLAYERS.length - 1}
              />
            </TabsContent>

            <TabsContent value="board">
              <Leaderboard rows={leaderboardMemo} />
            </TabsContent>

            <TabsContent value="history">
              <History
                allRatings={myRatings}
                me={currentUser}
                onBatchSave={updateMyBatchRatings}
              />
            </TabsContent>
          </Tabs>
        )}
        <Footer />
      </div>
      <Toaster richColors />
    </div>
  );
}

/* -------------------- Header -------------------- */
function Header({
  currentUser,
  onLogout,
  onReset,
  isAdmin,
}: {
  currentUser: string | null;
  onLogout: () => void;
  onReset: () => void;
  isAdmin: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-2xl bg-primary text-primary-foreground shadow">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold leading-tight">
            Volleyball Ranking
          </h1>
          <p className="text-sm text-muted-foreground">
            Secure per-player ratings • Clean flow • Instant averages
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            title="Clear all saved ratings for everyone"
          >
            <RefreshCcw className="h-4 w-4 mr-2" /> Reset Data
          </Button>
        )}
        {currentUser && (
          <Button variant="secondary" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        )}
      </div>
    </div>
  );
}

/* -------------------- Login -------------------- */
function LoginCard({ onLogin }: { onLogin: (name: string) => void }) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = PLAYERS.find(
      (p) => p.toLowerCase() === name.trim().toLowerCase()
    );
    if (!normalized) {
      toast.error("Unknown player. Use one of the 8 names.");
      return;
    }
    // Optional: hit /login, but since we use predefined passwords on each call,
    // we can just do a quick in-memory check here:
    if (PASSWORDS[normalized] !== pass) {
      toast.error("Wrong password.");
      return;
    }
    onLogin(normalized);
    toast.success(`Welcome, ${normalized}!`);
  }

  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Player Login
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Player Name</Label>
            <Input
              id="name"
              placeholder="e.g., Charbel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pass">Password</Label>
            <Input
              id="pass"
              type="password"
              placeholder="••••••••"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="mt-2">
            Continue
          </Button>
          <p className="text-xs text-muted-foreground">
            Tip: This connects to your local Node server (JSON file). Swap for a real DB later.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------- Rate Flow -------------------- */
function RateFlow({
  currentUser,
  pendingOrder,
  currentIndex,
  currentScore,
  hasFinished,
  onScoreChange,
  onSubmitOne,
  onStart,
  onStartFresh,
}: {
  currentUser: string;
  pendingOrder: string[];
  currentIndex: number;
  currentScore: number;
  hasFinished: boolean;
  onScoreChange: (v: number) => void;
  onSubmitOne: () => void;
  onStart: () => void;
  onStartFresh: () => void;
}) {
  const inProgress = pendingOrder.length > 0 && !hasFinished;
  const done = pendingOrder.length > 0 && hasFinished;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Rate Players</span>
          <Badge variant="secondary" className="text-xs">
            Logged in as {currentUser}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!inProgress && !done && (
          <div className="grid place-items-center py-8 gap-6">
            <p className="text-center text-sm text-muted-foreground max-w-prose">
              You'll be shown each teammate (except yourself) one by one. Slide
              to rate from 1 (lowest) to 10 (highest). After you submit the last
              rating, the leaderboard updates automatically.
            </p>
            <Button size="lg" onClick={onStart}>
              Start Rating
            </Button>
          </div>
        )}

        {inProgress && (
          <AnimatePresence mode="wait">
            <motion.div
              key={pendingOrder[currentIndex]}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.35 }}
            >
              <div className="grid md:grid-cols-[160px_1fr] gap-6 items-center">
                <div className="grid place-items-center">
                  <Avatar name={pendingOrder[currentIndex]} size={96} />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold">
                      {pendingOrder[currentIndex]}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {currentIndex + 1} / {pendingOrder.length}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="grid gap-4">
                    <Label htmlFor="slider">
                      Rating: <span className="font-semibold">{currentScore}</span>
                    </Label>
                    <Slider
                      id="slider"
                      min={1}
                      max={10}
                      step={1}
                      value={[currentScore]}
                      onValueChange={(v) => onScoreChange(v[0] ?? 7)}
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>1 • Needs improvement</span>
                      <span>10 • Outstanding</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={onSubmitOne} className="w-full">
                        Submit & Next
                      </Button>
                    </div>
                    <Dots total={pendingOrder.length} index={currentIndex} />
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        )}

        {done && (
          <div className="grid place-items-center gap-6 py-10">
            <BarChart3 className="h-10 w-10" />
            <div className="text-center">
              <h3 className="text-xl font-semibold">All set!</h3>
              <p className="text-sm text-muted-foreground">
                Your ratings were saved. Jump to the leaderboard to see updated
                averages.
              </p>
            </div>
            <Button onClick={onStartFresh} variant="secondary">
              Rate Again (new order)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Leaderboard -------------------- */
function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" /> Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ratings yet. Once players submit, the leaderboard will populate.
          </p>
        ) : (
          <div className="grid gap-3">
            {rows.map((r, idx) => (
              <div
                key={r.player}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 p-3 rounded-2xl bg-card/60 border"
              >
                <div className="w-8 text-center text-muted-foreground font-semibold">
                  {idx + 1}
                </div>
                <div className="flex items-center gap-3">
                  <Avatar name={r.player} size={40} />
                  <div className="font-medium">{r.player}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {r.ratings} ratings
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {r.average ? r.average.toFixed(2) : "–"}
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground mt-2">
              Averages are calculated across all submitted ratings.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- History (Batch Save) -------------------- */
function History({
  allRatings,
  me,
  onBatchSave,
}: {
  allRatings: RatingEntry[];
  me: string;
  onBatchSave: (newScores: Record<string, number>) => void;
}) {
  const mine = allRatings.sort((a, b) => a.ratee.localeCompare(b.ratee));

  const [local, setLocal] = useState<Record<string, number>>(
    Object.fromEntries(mine.map((r) => [r.ratee, r.score]))
  );

  useEffect(() => {
    setLocal(Object.fromEntries(mine.map((r) => [r.ratee, r.score])));
  }, [allRatings, me]);

  const hasChanges =
    mine.length !== Object.keys(local).length ||
    mine.some((r) => local[r.ratee] !== r.score);

  function saveAll() {
    if (!hasChanges) return;
    onBatchSave(local);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <UserRound className="h-5 w-5" /> My Submissions
          </span>
          <Button size="sm" onClick={saveAll} disabled={!hasChanges}>
            Save all changes
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven't submitted any ratings yet.
          </p>
        ) : (
          <div className="grid gap-3">
            {mine.map((r) => (
              <div
                key={r.ratee}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 rounded-2xl bg-card/60 border"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.ratee} size={36} />
                  <div>
                    <div className="font-medium">{r.ratee}</div>
                    <div className="text-[11px] text-muted-foreground">
                      last updated {new Date(r.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="px-2">
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={[local[r.ratee] ?? r.score]}
                    onValueChange={(v) =>
                      setLocal((s) => ({ ...s, [r.ratee]: v[0] ?? r.score }))
                    }
                  />
                </div>

                <div className="w-10 text-right font-semibold">
                  {local[r.ratee] ?? r.score}
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              Click <span className="font-semibold">Save all changes</span> to apply every edit at once.
              Your entire set replaces the previous one.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Footer -------------------- */
function Footer() {
  return (
    <div className="text-center text-xs text-muted-foreground py-2">
      Built for clean, unbiased team ratings. Backed by a tiny Node/Express JSON API.
    </div>
  );
}

/* -------------------- Tiny utilities for deterministic shuffles -------------------- */
function hashStr(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
