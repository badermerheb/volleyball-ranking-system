// src/App.tsx
import React, { useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Slider } from "./components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Separator } from "./components/ui/separator";
import { Badge } from "./components/ui/badge";
import {
  ShieldCheck,
  LogOut,
  Trophy,
  RefreshCcw,
  BarChart3,
  Plus,
  UserMinus,
  Lock,
  Unlock,
} from "lucide-react";
import VolleyballSpinner from "./components/VolleyballSpinner";

/* -------------------- Config -------------------- */
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const LS_USER_KEY = "vb_current_user";
const LS_PASS_KEY = "vb_current_pass";

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
type LbResp = {
  ok: boolean;
  ready: boolean;
  raters: number;
  total: number;
  locked: boolean;
  rows: LeaderboardRow[];
};

interface PlayerDetail {
  name: string;
  can_rate: boolean;
}

/* -------------------- API helpers -------------------- */
async function apiGet<T>(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
async function apiSend<T>(
  path: string,
  body: any,
  method: "POST" | "PATCH" | "DELETE" = "POST"
) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = "";
    try {
      msg = (await res.json()).error;
    } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// players (names only)
async function fetchPlayers(): Promise<string[]> {
  const data = await apiGet<{ players: string[] }>("/players");
  return data.players ?? [];
}

// players with can_rate
async function fetchPlayersDetails(): Promise<PlayerDetail[]> {
  const data = await apiGet<{ ok: boolean; players: PlayerDetail[] }>(
    "/players/details"
  );
  return data.players ?? [];
}

// current-match leaderboard
async function fetchLeaderboard(): Promise<{
  ready: boolean;
  raters: number;
  total: number;
  locked: boolean;
  rows: LeaderboardRow[];
}> {
  const data = await apiGet<LbResp>("/leaderboard");
  return {
    ready: data.ready,
    raters: data.raters,
    total: data.total,
    locked: data.locked,
    rows: data.rows ?? [],
  };
}

// overall leaderboard (across locked matches)
async function fetchOverall(): Promise<{
  rows: LeaderboardRow[];
}> {
  const data = await apiGet<{ ok: boolean; rows: LeaderboardRow[] }>(
    "/leaderboard/overall"
  );
  return { rows: data.rows ?? [] };
}

// my submitted set (current match)
async function fetchMine(name: string): Promise<RatingEntry[]> {
  const data = await apiGet<{ ok: boolean; ratings: RatingEntry[] }>(
    `/mine?name=${encodeURIComponent(name)}`
  );
  return data.ratings ?? [];
}

// login (server authoritative, case-insensitive username on server)
// NOTE: returns canonical-cased name from server so "bader" becomes "Bader".
async function login(name: string, password: string) {
  return apiSend<{ ok: boolean; name: string }>("/login", { name, password });
}

// submit my run (uses stored pass)
async function submitRun(
  name: string,
  password: string,
  entries: { ratee: string; score: number }[]
) {
  return apiSend<{ ok: boolean }>("/submit", {
    name,
    password,
    entries,
  });
}

// admin reset (close match; start new)
async function adminReset(name: string, password: string) {
  return apiSend<{ ok: boolean }>("/reset", { name, password });
}

// admin add/remove player
async function adminAddPlayer(
  adminName: string,
  adminPass: string,
  newName: string,
  newPass: string
) {
  return apiSend<{ ok: boolean }>("/admin/players", {
    adminName,
    adminPassword: adminPass,
    name: newName,
    password: newPass,
  });
}
async function adminRemovePlayer(
  adminName: string,
  adminPass: string,
  removeName: string
) {
  return apiSend<{ ok: boolean }>(
    "/admin/players",
    {
      adminName,
      adminPassword: adminPass,
      name: removeName,
    },
    "DELETE"
  );
}

// admin include/exclude ONE player
async function adminSetPermission(
  adminName: string,
  adminPass: string,
  targetName: string,
  can_rate: boolean
) {
  return apiSend<{ ok: boolean }>(
    "/admin/players/permission",
    {
      adminName,
      adminPassword: adminPass,
      name: targetName,
      can_rate,
    },
    "PATCH"
  );
}

// admin lock/unlock ALL
async function adminLockAll(
  adminName: string,
  adminPass: string,
  locked: boolean
) {
  return apiSend<{ ok: boolean; locked: boolean }>("/admin/lock", {
    name: adminName,
    password: adminPass,
    locked,
  });
}

/* -------------------- Small utils -------------------- */
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

/* -------------------- Avatar / Dots -------------------- */
function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hue =
    Math.abs([...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 360;
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
        <div
          key={i}
          className={`h-2 w-2 rounded-full ${
            i <= index ? "bg-foreground/80" : "bg-foreground/20"
          }`}
        />
      ))}
    </div>
  );
}

/* -------------------- Main App -------------------- */
export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [currentPass, setCurrentPass] = useState<string | null>(null);

  // dynamic players list (from server)
  const [players, setPlayers] = useState<string[]>([]);
  const [playersDetails, setPlayersDetails] = useState<PlayerDetail[]>([]);

  // loading state for "did this user already submit?"
  const [myLoading, setMyLoading] = useState(false);

  // server-backed state
  const [myRatings, setMyRatings] = useState<RatingEntry[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [leaderboardReady, setLeaderboardReady] = useState(false);
  const [ratersCount, setRatersCount] = useState(0);
  const [totalPlayers, setTotalPlayers] = useState<number>(0);
  const [lbLoading, setLbLoading] = useState(false);
  const [matchLocked, setMatchLocked] = useState<boolean>(true);

  // overall board state
  const [overallRows, setOverallRows] = useState<LeaderboardRow[]>([]);
  const [overallLoading, setOverallLoading] = useState(false);

  // UI state
  const [activeTab, setActiveTab] =
    useState<"rate" | "board" | "overall" | "admin">("rate");

  // rating session state (client-only until submit)
  const [pendingOrder, setPendingOrder] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentScore, setCurrentScore] = useState(7);
  const [sessionRatings, setSessionRatings] = useState<
    { ratee: string; score: number }[]
  >([]);

  // helper: refresh leaderboard (with loading flag)
  async function refreshLeaderboard() {
    try {
      setLbLoading(true);
      const lb = await fetchLeaderboard();
      setLeaderboardRows(lb.rows);
      setLeaderboardReady(lb.ready);
      setRatersCount(lb.raters);
      setTotalPlayers(lb.total);
      setMatchLocked(!!lb.locked);
    } finally {
      setLbLoading(false);
    }
  }

  async function refreshOverall() {
    try {
      setOverallLoading(true);
      const data = await fetchOverall();
      setOverallRows(data.rows);
    } finally {
      setOverallLoading(false);
    }
  }

  async function refreshPlayers() {
    try {
      const [list, details] = await Promise.all([
        fetchPlayers(),
        fetchPlayersDetails(),
      ]);
      if (Array.isArray(list)) setPlayers(list);
      if (Array.isArray(details)) setPlayersDetails(details);
    } catch {
      // ignore; blank list shows until server responds
    }
  }

  // Persisted login: restore on mount + initial data
  useEffect(() => {
    (async () => {
      await Promise.all([refreshPlayers(), refreshLeaderboard(), refreshOverall()]);
      const cachedName = localStorage.getItem(LS_USER_KEY);
      const cachedPass = localStorage.getItem(LS_PASS_KEY);
      if (cachedName && cachedPass) {
        setCurrentUser(cachedName);
        setCurrentPass(cachedPass);
        setMyLoading(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When user logs in (or after refresh), pull his set + boards
  useEffect(() => {
    if (!currentUser) return;
    setMyLoading(true);
    (async () => {
      try {
        const mine = await fetchMine(currentUser);
        setMyRatings(mine);
        await Promise.all([refreshLeaderboard(), refreshOverall(), refreshPlayers()]);
      } catch {
        toast.error("Failed to load data from server.");
      } finally {
        setMyLoading(false);
      }
    })();
  }, [currentUser]);

  const hasSubmitted = myRatings.length > 0;

  // Compute current user's include/exclude status
  const currentDetail = playersDetails.find(
    (p) => p.name.toLowerCase() === (currentUser ?? "").toLowerCase()
  );
  const currentUserCanRate = !!currentDetail?.can_rate;

  /* ---------- Tab-driven refresh & polling ---------- */
  useEffect(() => {
    if (activeTab === "board") {
      refreshLeaderboard().catch(() => {});
    } else if (activeTab === "overall") {
      refreshOverall().catch(() => {});
    } else if (activeTab === "admin" && currentUser === "Bader") {
      refreshPlayers().catch(() => {});
    } else if (activeTab === "rate") {
      // keep the rate tab aware of permission/lock status
      Promise.all([refreshPlayers(), refreshLeaderboard()]).catch(() => {});
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (activeTab !== "board" || leaderboardReady) return;
    const id = setInterval(() => {
      refreshLeaderboard().catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [activeTab, leaderboardReady]);

  useEffect(() => {
    function onFocus() {
      if (activeTab === "board") refreshLeaderboard().catch(() => {});
      if (activeTab === "overall") refreshOverall().catch(() => {});
      if (activeTab === "admin" && currentUser === "Bader")
        refreshPlayers().catch(() => {});
      if (activeTab === "rate") {
        Promise.all([refreshPlayers(), refreshLeaderboard()]).catch(() => {});
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeTab, currentUser]);

  /* ---------- Flow helpers ---------- */
  function startRatingFlow() {
    if (!currentUser || myLoading || hasSubmitted) return;

    // Block if excluded or if ratings are locked
    if (matchLocked) {
      toast.error("Ratings are currently locked. Please wait for the admin to unlock.");
      return;
    }
    if (!currentUserCanRate) {
      toast.error("You are currently excluded from rating this round.");
      return;
    }

    const order = players.filter((p) => p !== currentUser);
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

  async function submitOne() {
    if (!currentUser || !currentPass) return;
    const ratee = pendingOrder[currentIndex];
    const nextSession = [...sessionRatings, { ratee, score: currentScore }];
    setSessionRatings(nextSession);

    if (currentIndex < pendingOrder.length - 1) {
      setCurrentIndex((i) => i + 1);
      setCurrentScore(7);
    } else {
      try {
        await submitRun(currentUser, currentPass, nextSession);
        const mine = await fetchMine(currentUser);
        setMyRatings(mine);
        await Promise.all([refreshLeaderboard(), refreshOverall()]);
        toast.success("Ratings submitted.");
      } catch (e: any) {
        if (String(e.message).includes("already_submitted")) {
          toast.error(
            "You have already submitted. Wait for admin reset to rate again."
          );
        } else if (String(e.message).includes("no_permission_to_rate")) {
          toast.error("You are excluded from this round and cannot submit.");
        } else if (String(e.message).includes("ratings_locked")) {
          toast.error("Ratings are locked. Please wait for the admin to unlock.");
        } else {
          toast.error("Failed to submit ratings.");
        }
      }
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    setCurrentPass(null);
    localStorage.removeItem(LS_USER_KEY);
    localStorage.removeItem(LS_PASS_KEY);
    setPendingOrder([]);
    setCurrentIndex(0);
    setSessionRatings([]);
    setMyRatings([]);
    setMyLoading(false);
    setActiveTab("rate");
  }

  async function handleReset() {
    if (currentUser !== "Bader" || !currentPass) {
      toast.error("Only Bader (admin) can reset data.");
      return;
    }
    try {
      await adminReset("Bader", currentPass);
      setMyRatings([]);
      setLeaderboardRows([]);
      setOverallRows([]);
      setLeaderboardReady(false);
      setRatersCount(0);
      setTotalPlayers(players.length);
      toast("Round closed. New round started.");
      if (activeTab === "board") refreshLeaderboard().catch(() => {});
      if (activeTab === "overall") refreshOverall().catch(() => {});
      await refreshPlayers();
    } catch (e: any) {
      toast.error(e?.message || "Reset failed.");
    }
  }

  /* ---------- Admin actions ---------- */
  async function handleAddPlayer(newName: string, newPass: string) {
    if (!currentPass) return;
    try {
      await adminAddPlayer("Bader", currentPass, newName, newPass);
      toast.success(`Added ${newName}.`);
      await Promise.all([
        refreshPlayers(),
        refreshLeaderboard(),
        refreshOverall(),
      ]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to add player.");
    }
  }
  async function handleRemovePlayer(name: string) {
    if (!currentPass) return;
    try {
      await adminRemovePlayer("Bader", currentPass, name);
      toast.success(`Removed ${name}.`);
      await Promise.all([
        refreshPlayers(),
        refreshLeaderboard(),
        refreshOverall(),
      ]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove player.");
    }
  }
  async function handleInclude(name: string) {
    if (!currentPass) return;
    try {
      await adminSetPermission("Bader", currentPass, name, true);
      toast.success(`Included ${name}.`);
      await refreshPlayers();
    } catch (e: any) {
      toast.error(e?.message || "Failed to include player.");
    }
  }
  async function handleExclude(name: string) {
    if (!currentPass) return;
    try {
      await adminSetPermission("Bader", currentPass, name, false);
      toast.success(`Excluded ${name}.`);
      await refreshPlayers();
    } catch (e: any) {
      toast.error(e?.message || "Failed to exclude player.");
    }
  }
  async function handleLockAll() {
    if (!currentPass) return;
    try {
      await adminLockAll("Bader", currentPass, true);
      toast("Ratings locked (all excluded).");
      await Promise.all([refreshLeaderboard(), refreshPlayers()]);
    } catch (e: any) {
      toast.error(e?.message || "Lock failed.");
    }
  }
  async function handleUnlockAll() {
    if (!currentPass) return;
    try {
      await adminLockAll("Bader", currentPass, false);
      toast("Ratings unlocked (all included).");
      await Promise.all([refreshLeaderboard(), refreshPlayers()]);
    } catch (e: any) {
      toast.error(e?.message || "Unlock failed.");
    }
  }

  const tabCols = currentUser === "Bader" ? "grid-cols-4" : "grid-cols-3";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 text-foreground p-4 md:p-10">
      <div className="mx-auto max-w-5xl grid gap-6">
        <Header
          currentUser={currentUser}
          onLogout={handleLogout}
          onReset={handleReset}
          isAdmin={currentUser === "Bader"}
          locked={matchLocked}
        />
        {!currentUser ? (
          <LoginCard
            players={players}
            onLogin={async (typedName, pass) => {
              const name = typedName.trim();
              if (!name) {
                toast.error("Enter your name.");
                return;
              }
              try {
                const resp = await login(name, pass); // server validates (case-insensitive username)
                // Store & use canonical name returned by server
                localStorage.setItem(LS_USER_KEY, resp.name);
                localStorage.setItem(LS_PASS_KEY, pass);
                setCurrentUser(resp.name);
                setCurrentPass(pass);
                toast.success(`Welcome, ${resp.name}!`);
              } catch (e: any) {
                toast.error(e?.message || "Login failed.");
              }
            }}
          />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(v as "rate" | "board" | "overall" | "admin")
            }
            className="w-full"
          >
            <TabsList className={`grid w-full ${tabCols}`}>
              <TabsTrigger value="rate">Rate Players</TabsTrigger>
              <TabsTrigger value="board">Leaderboard</TabsTrigger>
              <TabsTrigger value="overall">Overall</TabsTrigger>
              {currentUser === "Bader" && (
                <TabsTrigger value="admin">Admin</TabsTrigger>
              )}
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
                hasFinished={sessionRatings.length === players.length - 1}
                hasSubmitted={myRatings.length > 0}
                checking={myLoading}
                canRate={currentUserCanRate}
                locked={matchLocked}
              />
            </TabsContent>

            <TabsContent value="board">
              <AnimatePresence mode="wait">
                {leaderboardReady ? (
                  <motion.div
                    key="leaderboard"
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 220, damping: 24 }}
                  >
                    <Leaderboard rows={leaderboardRows} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="locked"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Trophy className="h-5 w-5" /> Leaderboard (Locked)
                          <Badge variant={matchLocked ? "destructive" : "secondary"} className="ml-2">
                            {matchLocked ? (
                              <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Locked</span>
                            ) : (
                              <span className="inline-flex items-center gap-1"><Unlock className="h-3 w-3" /> Unlocked</span>
                            )}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          The leaderboard will be visible once{" "}
                          <span className="font-semibold">all players</span> have
                          submitted their ratings.
                        </p>
                        <p className="text-sm mt-2">
                          {lbLoading ? (
                            <div className="flex items-center gap-2">
                              <VolleyballSpinner size={22} label="Refreshing…" />
                              <span>
                                <span className="font-semibold">{ratersCount}</span>{" "}
                                / {totalPlayers} players have submitted
                                {totalPlayers - ratersCount > 0 && (
                                  <>
                                    {" "}(
                                    <span className="font-semibold">
                                      {totalPlayers - ratersCount}
                                    </span>{" "}
                                    remaining)
                                  </>
                                )}
                                .
                              </span>
                            </div>
                          ) : (
                            <>
                              <span className="font-semibold">{ratersCount}</span>{" "}
                              / {totalPlayers} players have submitted
                              {totalPlayers - ratersCount > 0 && (
                                <>
                                  {" "}(
                                  <span className="font-semibold">
                                    {totalPlayers - ratersCount}
                                  </span>{" "}
                                  remaining)
                                </>
                              )}
                              .
                            </>
                          )}
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            <TabsContent value="overall">
              <motion.div
                key="overall"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5" /> Overall Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {overallLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Refreshing…
                      </p>
                    ) : overallRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No completed matches yet.
                      </p>
                    ) : (
                      <Leaderboard rows={overallRows} />
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            {currentUser === "Bader" && (
              <TabsContent value="admin">
                <AdminPanel
                  players={players}
                  playerDetails={playersDetails}
                  raters={ratersCount}
                  total={totalPlayers}
                  locked={matchLocked}
                  onReset={handleReset}
                  onRefreshAll={async () => {
                    await Promise.all([
                      refreshPlayers(),
                      refreshLeaderboard(),
                      refreshOverall(),
                    ]);
                    toast("Refreshed.");
                  }}
                  onAdd={handleAddPlayer}
                  onRemove={handleRemovePlayer}
                  onInclude={handleInclude}
                  onExclude={handleExclude}
                  onLock={handleLockAll}
                  onUnlock={handleUnlockAll}
                />
              </TabsContent>
            )}
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
  locked,
}: {
  currentUser: string | null;
  onLogout: () => void;
  onReset: () => void;
  isAdmin: boolean;
  locked: boolean;
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
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Secure per-player ratings • One-shot submissions
            </p>
            <Badge variant={locked ? "destructive" : "secondary"}>
              {locked ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Unlock className="h-3 w-3" /> Unlocked
                </span>
              )}
            </Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            title="Close current round and start a new one"
          >
            <RefreshCcw className="h-4 w-4 mr-2" /> Reset Round
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
function LoginCard({
  players,
  onLogin,
}: {
  players: string[];
  onLogin: (typedName: string, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      onLogin(name, pass);
    } finally {
      setSubmitting(false);
    }
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
              list="known-players"
            />
            <datalist id="known-players">
              {players.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
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
          <Button type="submit" className="mt-2" disabled={submitting}>
            {submitting ? "Checking..." : "Continue"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You can submit exactly once per round. Admin can reset to start a
            new round.
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
  hasSubmitted,
  checking,
  canRate,
  locked,
  onScoreChange,
  onSubmitOne,
  onStart,
}: {
  currentUser: string;
  pendingOrder: string[];
  currentIndex: number;
  currentScore: number;
  hasFinished: boolean;
  hasSubmitted: boolean;
  checking: boolean;
  canRate: boolean;
  locked: boolean;
  onScoreChange: (v: number) => void;
  onSubmitOne: () => void;
  onStart: () => void;
}) {
  const inProgress = pendingOrder.length > 0 && !hasFinished;
  const done = pendingOrder.length > 0 && hasFinished;

  const startDisabled = checking || hasSubmitted || locked || !canRate;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Rate Players</span>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Logged in as {currentUser}
            </Badge>
            <Badge variant={locked ? "destructive" : "secondary"} className="text-xs">
              {locked ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Unlock className="h-3 w-3" /> Unlocked
                </span>
              )}
            </Badge>
            <Badge
              variant={canRate ? "default" : "outline"}
              className={`text-xs ${canRate ? "" : "opacity-70"}`}
            >
              {canRate ? "Included" : "Excluded"}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!inProgress && !done && (
          <div className="grid place-items-center py-8 gap-6">
            {hasSubmitted ? (
              <>
                <p className="text-center text-sm text-muted-foreground max-w-prose">
                  You’ve already submitted your ratings for this round. Wait for
                  the leaderboard to unlock once everyone submits, or ask the
                  admin to reset for a new round.
                </p>
                <Button size="lg" disabled>
                  Start Rating
                </Button>
              </>
            ) : (
              <>
                <p className="text-center text-sm text-muted-foreground max-w-prose">
                  You'll be shown each teammate (except yourself) one by one.
                  Slide to rate from 1 (lowest) to 10 (highest). You can only
                  submit once per round.
                </p>
                <div className="grid gap-2 place-items-center">
                  {!canRate && (
                    <div className="text-xs text-red-500">
                      You are excluded from this round.
                    </div>
                  )}
                  {locked && (
                    <div className="text-xs text-amber-600">
                      Ratings are currently locked.
                    </div>
                  )}
                  <Button size="lg" onClick={onStart} disabled={startDisabled}>
                    {checking
                      ? "Checking your status..."
                      : !canRate
                      ? "Excluded"
                      : locked
                      ? "Locked"
                      : "Start Rating"}
                  </Button>
                </div>
              </>
            )}
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
                Your ratings were saved. You can't submit again until the admin
                resets the round.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Leaderboard (flashy) -------------------- */
function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const container: Variants = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.085, delayChildren: 0.15 },
    },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 24, scale: 0.92 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: "spring", stiffness: 520, damping: 28 },
    },
  };
  const topPulse: Variants = {
    hidden: { scale: 0.9, opacity: 0 },
    show: {
      scale: [0.9, 1.15, 1],
      opacity: 1,
      transition: { duration: 0.6, ease: "easeOut", times: [0, 0.7, 1] },
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" /> Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ratings yet.</p>
        ) : (
          <motion.div variants={container} initial="hidden" animate="show" className="grid gap-3">
            {rows.map((r, idx) => (
              <motion.div
                key={r.player}
                variants={item}
                whileHover={{ y: -2, scale: 1.01 }}
                className="relative overflow-hidden grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 p-3 rounded-2xl bg-card/60 border"
              >
                {/* subtle shine sweep */}
                <motion.div
                  aria-hidden
                  initial={{ x: "-120%" }}
                  animate={{ x: ["-120%", "120%"] }}
                  transition={{ duration: 1.2, delay: 0.08 * idx + 0.25, ease: "easeOut" }}
                  className="pointer-events-none absolute inset-y-0 -left-1 w-1/3 rotate-6 bg-gradient-to-r from-transparent via-white/6 to-transparent"
                />

                {/* rank bubble with pulse for top 3 */}
                <motion.div
                  variants={idx < 3 ? topPulse : undefined}
                  className={`w-8 text-center font-semibold ${
                    idx < 3 ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {idx + 1}
                </motion.div>

                <div className="flex items-center gap-3">
                  <Avatar name={r.player} size={40} />
                  <div className="font-medium">{r.player}</div>
                </div>

                <div className="text-sm text-muted-foreground">{r.ratings} ratings</div>

                <div className="text-lg font-semibold tabular-nums">
                  {r.average ? r.average.toFixed(2) : "–"}
                </div>
              </motion.div>
            ))}

            <div className="text-xs text-muted-foreground mt-2">
              Averages are calculated across all submitted ratings.
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Admin Panel (cleaned & clearer) -------------------- */
function AdminPanel({
  players,
  playerDetails,
  raters,
  total,
  locked,
  onReset,
  onRefreshAll,
  onAdd,
  onRemove,
  onInclude,
  onExclude,
  onLock,
  onUnlock,
}: {
  players: string[];
  playerDetails: PlayerDetail[];
  raters: number;
  total: number;
  locked: boolean;
  onReset: () => void;
  onRefreshAll: () => void;
  onAdd: (newName: string, newPass: string) => void;
  onRemove: (name: string) => void;
  onInclude: (name: string) => void;
  onExclude: (name: string) => void;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [removeName, setRemoveName] = useState("");

  // quick lookup for can_rate
  const canRateMap = new Map(
    playerDetails.map((p) => [p.name.toLowerCase(), p.can_rate])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5" /> Admin
          </span>
          <div className="flex gap-2 items-center">
            <Badge variant={locked ? "destructive" : "secondary"}>
              {locked ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Unlock className="h-3 w-3" /> Unlocked
                </span>
              )}
            </Badge>
            <Button variant="outline" onClick={onLock} title="Exclude all">
              <Lock className="h-4 w-4 mr-2" /> Lock Rating
            </Button>
            <Button variant="outline" onClick={onUnlock} title="Include all">
              <Unlock className="h-4 w-4 mr-2" /> Unlock Rating
            </Button>
            <Button variant="outline" onClick={onRefreshAll}>Refresh</Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-6">
        {/* Round status */}
        <div className="text-sm">
          <div className="mb-3">
            Round status:{" "}
            <span className="font-semibold">
              {raters} / {total}
            </span>{" "}
            eligible players submitted.
          </div>

          {/* Players & participation chips */}
          <div className="space-y-2">
            <div className="font-semibold">Players & Participation</div>
            <div className="flex flex-wrap gap-3">
              {players.map((p) => {
                const included = !!canRateMap.get(p.toLowerCase());
                return (
                  <div
                    key={p}
                    className={`flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 ${
                      included ? "border-green-500/50" : "border-red-500/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{p}</span>
                    <Button
                      variant={included ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => (included ? onExclude(p) : onInclude(p))}
                      title={included ? `Exclude ${p}` : `Include ${p}`}
                    >
                      {included ? "Exclude" : "Include"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <Separator />

        {/* Add / Remove */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="grid gap-3">
            <div className="font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Player
            </div>
            <Label htmlFor="newName">Name</Label>
            <Input
              id="newName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New player name"
            />
            <Label htmlFor="newPass">Password</Label>
            <Input
              id="newPass"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="New player password"
            />
            <Button
              onClick={() => {
                if (!newName.trim() || !newPass.trim()) {
                  toast.error("Name and password required.");
                  return;
                }
                onAdd(newName.trim(), newPass.trim());
                setNewName("");
                setNewPass("");
              }}
            >
              Add Player
            </Button>
            <p className="text-xs text-muted-foreground">
              New players start with permission OFF.
            </p>
          </div>

          <div className="grid gap-3">
            <div className="font-semibold flex items-center gap-2">
              <UserMinus className="h-4 w-4" /> Remove Player from Data
            </div>
            <Label htmlFor="removeName">Player Name</Label>
            <Input
              id="removeName"
              value={removeName}
              onChange={(e) => setRemoveName(e.target.value)}
              placeholder="Player to remove"
              list="players-list"
            />
            <datalist id="players-list">
              {players.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Button
              variant="destructive"
              onClick={() => {
                if (!removeName.trim()) {
                  toast.error("Enter a player name to remove.");
                  return;
                }
                onRemove(removeName.trim());
                setRemoveName("");
              }}
            >
              Remove Player
            </Button>
            <p className="text-xs text-muted-foreground">
              This deletes the player and their ratings.
            </p>
          </div>
        </div>

        <Separator />

        {/* Reset (kept out of header) */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Reset also locks rating and starts a new locked round.
          </div>
          <Button variant="destructive" onClick={onReset}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Reset Round
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------- Footer -------------------- */
function Footer() {
  return (
    <div className="text-center text-xs text-muted-foreground py-2">
      One-shot, unbiased team ratings. Admin can reset to start a new round.
    </div>
  );
}
