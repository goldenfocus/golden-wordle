// Pure, fully-tested index reducer for the ARENA coordinator. Zero Cloudflare deps so
// it runs under plain Vitest. The DO wrapper (arena.ts) is the only thing that persists
// the ArenaState this module produces.

export type SeedStatus = "minted" | "registered" | "closed";

export type SeedRec = {
  path: string; // DO key form: "arena/<personaId>-<seedCount>"
  routePath: string; // routable form: "/@arena/<personaId>-<seedCount>" ← client navigates here
  name: string; // room display name
  host: string; // persona display name (looks human)
  personaId: string; // stable key: persona uniqueness + H2H
  personaIcon: string; // human avatar (emoji)
  edition: string; // theme id from the existing library
  wordLength: number; // always 5 in v1
  seats: string; // "1/2", "2/3", "4/5" … = `${botCount}/${capacity}`
  capacity: number; // total seats 2–5 (Inc.2)
  botCount: number; // bots present at mint, 1…capacity−1 (Inc.2)
  personaIds: string[]; // the room's full bot roster (capacity−1 ids) — drives cross-room dedup
  mintedAt: number; // epoch ms at mint
  lifetimeMs: number; // jittered expiry budget from mint; 0 ⇒ fall back to MAX_OPEN_MS
  status: SeedStatus;
};

export type ArenaState = { seeded: Record<string, SeedRec>; seedCount: number; desiredOpen?: number };

export type ArenaEvent =
  | { type: "mint"; rec: SeedRec }
  | { type: "publish"; rec: SeedRec }
  | { type: "register"; path: string }
  | { type: "close"; path: string };

// Client projection — NO internal fields (no mintedAt, status, personaId).
export type OpenGame = Pick<
  SeedRec,
  "routePath" | "name" | "host" | "personaIcon" | "edition" | "wordLength" | "seats"
>;

export const STALE_MS = 60_000; // minted-not-registered TTL
export const MAX_OPEN_MS = 4 * 60 * 60 * 1000; // registered max lifetime FROM MINT
export const TARGET_OPEN = 3;
export const MAX_SEEDED = 10;

// --- Living Arena (v2 inc.1): liveliness knobs. desiredOpen drifts within this band; each
// seeded room gets a jittered lifetime and a weighted word length. All chosen by PURE
// helpers taking an injected roll so arena.ts (Math.random) stays the only impure layer.
export const ARENA_MIN_OPEN = 1;
export const ARENA_MAX_OPEN = 6;
export const LIFETIME_MIN_MS = 45_000;
export const LIFETIME_MAX_MS = 180_000;
// Friendly lengths common, long ones rare — atmosphere without a wall of brutal rooms.
export const LENGTH_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [4, 3], [5, 5], [6, 3], [7, 2], [8, 1], [9, 1],
];

// Inc.2 seat variety: mostly small rooms, occasional lively big ones. Same weighted-pick
// shape as LENGTH_WEIGHTS. capacity 2 = the classic 1v1; 5 = the rare battle-royale.
export const CAPACITY_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [2, 6], [3, 4], [4, 2], [5, 1],
];

// Random-walk the desired open-room count one step within [MIN, MAX]. roll in [0,1):
// low third → -1, high third → +1, middle → hold. A slow tide, never a sawtooth.
export function driftTarget(current: number, roll: number): number {
  const base = Number.isFinite(current) ? current : ARENA_MIN_OPEN;
  let next = base;
  if (roll < 1 / 3) next = base - 1;
  else if (roll >= 2 / 3) next = base + 1;
  return Math.max(ARENA_MIN_OPEN, Math.min(ARENA_MAX_OPEN, next));
}

// Weighted pick of a seeded room's word length. roll in [0,1).
export function rollWordLength(roll: number): number {
  const total = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let t = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const [len, w] of LENGTH_WEIGHTS) {
    if (t < w) return len;
    t -= w;
  }
  return LENGTH_WEIGHTS[LENGTH_WEIGHTS.length - 1][0];
}

// A seeded room's jittered expiry budget (ms from mint). roll in [0,1).
export function rollLifetime(roll: number): number {
  const r = Math.max(0, Math.min(1, roll));
  return Math.round(LIFETIME_MIN_MS + r * (LIFETIME_MAX_MS - LIFETIME_MIN_MS));
}

// Weighted capacity + a uniform botCount in [1, capacity-1]. Two injected rolls in [0,1)
// (same purity contract as rollWordLength/rollLifetime — arena.ts is the only Math.random layer).
export function rollSpawn(rCap: number, rBots: number): { capacity: number; botCount: number } {
  const capacity = pickCapacity(rCap);
  const span = capacity - 1; // ≥ 1
  const botCount = 1 + Math.floor(Math.max(0, Math.min(0.999999, rBots)) * span);
  return { capacity, botCount };
}

function pickCapacity(roll: number): number {
  const total = CAPACITY_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let t = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const [cap, w] of CAPACITY_WEIGHTS) {
    if (t < w) return cap;
    t -= w;
  }
  return CAPACITY_WEIGHTS[CAPACITY_WEIGHTS.length - 1][0];
}

// --- Viewer-aware mint scheduling (GET /open) ---------------------------------------
export const EMPTY_KICK_MS = 250; // empty index + someone looking → mint almost now
export const ENSURE_ALARM_MS = 5_000; // stocked index → just make sure the loop is alive
export const ALARM_STALE_MS = 10_000; // overdue by more than this → the alarm is wedged, not imminent

// Decide whether GET /open should (re)set the seed-loop alarm, and for when. Returns the
// new alarm time (epoch ms) or null to leave the schedule alone. An empty index with a
// viewer staring at it pulls the alarm forward so the first room mints in ~EMPTY_KICK_MS
// instead of waiting out the 30–90s at-target idle drift — the "open the Arena, stare at
// 'no open games' for a minute" failure. Mints still happen ONLY in alarm() (the
// no-mint-from-GET review fix, defects 6 & 10, stands). An already-imminent (or
// just-overdue) alarm is left to fire on its own — but an alarm overdue by more than
// ALARM_STALE_MS never will (the timestamp can survive a deploy/platform hiccup that
// dropped the scheduled firing; prod incident 2026-07-21: the seed loop stayed wedged
// for two weeks because this function refused to re-arm a dead alarm). Treat stale as
// absent so the loop self-heals on the next viewer.
export function alarmKick(openCount: number, currentAlarm: number | null, nowMs: number): number | null {
  const alarm = currentAlarm !== null && nowMs - currentAlarm > ALARM_STALE_MS ? null : currentAlarm;
  if (openCount === 0) {
    const kickAt = nowMs + EMPTY_KICK_MS;
    return alarm === null || alarm > kickAt ? kickAt : null;
  }
  return alarm === null ? nowMs + ENSURE_ALARM_MS : null;
}

export function emptyArenaState(): ArenaState {
  return { seeded: {}, seedCount: 0 };
}

export function apply(state: ArenaState, event: ArenaEvent): ArenaState {
  switch (event.type) {
    case "mint":
      return {
        ...state, // preserve desiredOpen (the breathing-arena drift) — was dropped on mint
        seedCount: state.seedCount + 1,
        seeded: { ...state.seeded, [event.rec.path]: { ...event.rec, status: "minted" } },
      };
    case "publish":
      // A human-hosted public room: already live (no mint/seed handshake), so it goes
      // straight to "registered" and does NOT consume a persona seedCount.
      return {
        ...state,
        seeded: { ...state.seeded, [event.rec.path]: { ...event.rec, status: "registered" } },
      };
    case "register": {
      const cur = state.seeded[event.path];
      // No-op if missing or already closed — register must never resurrect a closed room.
      if (!cur || cur.status !== "minted") return state;
      return {
        ...state,
        seeded: { ...state.seeded, [event.path]: { ...cur, status: "registered" } },
      };
    }
    case "close": {
      const cur = state.seeded[event.path];
      if (!cur) return state;
      return {
        ...state,
        seeded: { ...state.seeded, [event.path]: { ...cur, status: "closed" } },
      };
    }
  }
}

// Drop minted that never registered (STALE_MS), registered past MAX_OPEN_MS measured
// FROM MINT (not reset on register — review fix, defect 7), and always GC closed.
export function prune(state: ArenaState, nowMs: number): ArenaState {
  const seeded: Record<string, SeedRec> = {};
  for (const [path, r] of Object.entries(state.seeded)) {
    if (r.status === "closed") continue;
    if (r.status === "minted" && nowMs - r.mintedAt > STALE_MS) continue;
    if (r.status === "registered") {
      const budget = r.lifetimeMs && r.lifetimeMs > 0 ? r.lifetimeMs : MAX_OPEN_MS;
      if (nowMs - r.mintedAt > budget) continue;
    }
    seeded[path] = r;
  }
  return { ...state, seeded };
}

export function openGames(state: ArenaState): OpenGame[] {
  return Object.values(state.seeded)
    .filter((r) => r.status === "registered")
    .map((r) => ({
      routePath: r.routePath,
      name: r.name,
      host: r.host,
      personaIcon: r.personaIcon,
      edition: r.edition,
      wordLength: r.wordLength,
      seats: r.seats,
    }));
}

export function liveCount(state: ArenaState): number {
  return Object.values(state.seeded).filter((r) => r.status !== "closed").length;
}

// The monotonic seedCount makes every mint's key unique. `path` is the DO key (idFromName);
// `routePath` is what the client navigates to — the worker's ROOM_RE accepts /@arena/<slug>
// and resolves /ws?room=arena/<slug> to the byte-identical key.
export function seedPaths(personaId: string, seedCount: number): { path: string; routePath: string } {
  const slug = `${personaId}-${seedCount}`;
  return { path: `arena/${slug}`, routePath: `/@arena/${slug}` };
}

// Backfill a persisted pre-Inc2 SeedRec (no capacity/botCount/personaIds) to the legacy
// 1/2 single-bot shape so old rooms render + typecheck until they churn out. Idempotent.
export function hydrateSeedRec(rec: SeedRec): SeedRec {
  const capacity = typeof rec.capacity === "number" ? rec.capacity : 2;
  const botCount = typeof rec.botCount === "number" ? rec.botCount : 1;
  const personaIds = Array.isArray(rec.personaIds) && rec.personaIds.length > 0
    ? rec.personaIds
    : [rec.personaId];
  const seats = rec.seats || `${botCount}/${capacity}`;
  return { ...rec, capacity, botCount, personaIds, seats };
}
