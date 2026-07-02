import type { Color } from "./color.ts";
import type { UserStats } from "./stats.ts";
import type { GameRecord, RoomGame } from "./records.ts";
import type { RoomScore } from "./scoreboard.ts";
import type { RoomMode } from "./modes.ts";
import type { LedgerTx, SettlementReceipt } from "./economy.ts";
import type { AuthRecord, PendingClaim } from "./account-core.ts";
import type { GhostTape } from "./ghost-core.ts";
import type { Ruleset, LaneName } from "./lane.ts";

export type OwnedRoom = { slug: string; name: string; lastPlayedAt: number };

export type UserProfile = {
  username: string;
  createdAt: number;
  stats: UserStats;
  games: GameRecord[];     // most-recent-first, capped
  ownedRooms: OwnedRoom[];
  ledger: LedgerTx[];   // append-only token transactions; capped audit log (last 500)
  balances: Record<string, number>;  // running per-token balance; authoritative (ledger is a capped audit log)
  h2h?: Record<string, { w: number; l: number }>; // per-(human, persona) record, keyed by persona id
  follows?: string[];   // RESERVED (P-later): usernames this user follows
  followers?: string[]; // RESERVED (P-later): usernames following this user
  // --- Accounts P0 (all optional; absent = open "kindness model" name) ---
  claimed?: boolean;            // true once secured with a wordul-passphrase
  auth?: AuthRecord;            // secret material — NEVER leaves the DO (publicProfile strips it)
  pendingClaim?: PendingClaim;  // ephemeral preview slot between preview→commit; stripped from public output
};

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  WORDSTATS: DurableObjectNamespace;
  CHALLENGE: DurableObjectNamespace;
  DAILY: DurableObjectNamespace;
  SCIENCE: DurableObjectNamespace;
  ARENA: DurableObjectNamespace;
  WORDULS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  DIRECTORY: KVNamespace;
  DESIGNS: R2Bucket;
  OG: R2Bucket;
  VOICE: R2Bucket;
  AI?: Ai;                    // Workers AI — powers POST /vibe-studio/tune (optional: route 503s if absent)
  DAILY_ADMIN_TOKEN?: string; // wrangler secret; gates POST /daily/schedule
  DAILY_SALT?: string;        // wrangler secret; server-only seed salt for the daily house word (empty = NO-OP). Set via: wrangler secret put DAILY_SALT
}

export type GuessRow = { word: string; mask: Color[] };

export type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;         // a worduler — born in Wordul, plays from public masks only
  ready: boolean;          // duel readiness — gates the 3-2-1 countdown (reset false on join/round)
  role: "duelist" | "queued" | "spectator"; // duel seat: two duelists play; queued rotate in (KOTH); spectators (past capacity) watch + chat, never rotate
  scienceOptOut?: boolean; // true = skip player-level research telemetry
  revealHints?: number;    // per-round count, powers aggregate hint-use research
  vowelHints?: number;     // per-round count, powers aggregate hint-use research
  points: number;        // live in-game points (earned − spent); reset each round
  pointsSpent: number;   // running power-up spend this round (internal accumulator)
  scored?: boolean;        // daily: this player's one result has been recorded (mint once)
  wordulCounted?: boolean; // wordul: this player's play has been counted (bump once per player)
  goldAwarded?: number;    // daily: gold actually minted on a confirmed (res.ok) ledger write
  receipt?: SettlementReceipt; // race + daily: settlement receipt, set ONLY after a confirmed (res.ok) mint
  resigned?: boolean;      // gave up (vs ran out of guesses) — both land status "lost"
  hardMode?: boolean;      // client-reported hard mode (rides each guess msg) — gates the dead-letter penalty in scoring; bots never set it
  firstGuessAt?: number;   // daily: epoch ms of this player's first guess (start of solve clock)
  finishedAt?: number;     // daily: epoch ms this player finished (won/lost/resigned) — solve clock end
  nextGuessAt?: number;    // bot-only: epoch ms this bot is next due to guess (per-bot heartbeat, Inc.2)
  guessAts?: number[];     // per-round ms offsets from startedAt (GO) for each accepted guess; parallel to guesses.
                           // Captured so GameRecord can store real per-guess timing for exact ghost replay on challenges.
};

export type RoomPhase = "lobby" | "countdown" | "playing" | "finished";

export type ChatEntry =
  | { kind: "user"; from: string; text: string; t: number }
  | { kind: "system"; text: string; t: number };

// Server-only marker stamped on a seeded (bot-hosted) room. NEVER reaches a client:
// snapshotFor (Slice C) shadows it with `seed: undefined` on the outbound projection.
export type SeedMarker = { profile: "noob"; personaIds: string[]; capacity: number };

export type RoomSnapshot = {
  path: string;            // "<owner>/<slug>" — immutable canonical DO key
  owner: string;           // owner username
  hostId?: string | null;  // settings authority: first connected human; succession on disconnect, no reclaim
  slug: string;            // current URL slug (renameable; old slugs alias to canonical path)
  name: string;            // display name (renameable)
  phase: RoomPhase;
  players: PlayerState[];
  word: string | null;
  winner: string | null;   // winner username
  startedAt: number | null;
  goAt: number | null;     // duel: epoch ms the 3-2-1 countdown ends and the round goes live (null off-countdown)
  finishedAt: number | null;
  round: number;
  chat: ChatEntry[];
  wordLength: number;      // letters per guess (4-12)
  maxGuesses: number;      // rows per board, derived from wordLength
  capacity: number;        // seats in this room (2–6, host-set via set_capacity; persisted). Seeded rooms override outbound with seed.capacity. Powers the lobby "Your table" strip.
  mode: RoomMode;          // room game format; "race" today, more later
  scoreboard: RoomScore[];
  history: RoomGame[];     // finished games in this room, newest last (capped)
  edition: string;         // theme/edition id bound to the room — everyone in it sees this theme
  ruleset: Ruleset;        // the room's lane (Vanilla = power-ups off / Wild = on). Stored AND broadcast (state === snapshot).
  // --- Duel (1v1 + king-of-the-hill). Present on every room; only meaningful in duel rooms. ---
  rotation: "koth" | "host"; // next-opponent model; "koth" = winner stays (default). "host" reserved for Plan 2b.
  queue: string[];         // duel: waiting challenger usernames, front = next to play
  throne: { username: string; streak: number } | null; // duel: current king + win streak (KOTH)
  isDuel?: boolean;        // computed outbound: true when this room runs the duel (ready/seats/KOTH); absent on stored state
  challengeId?: string | null; // set when this room plays a pinned challenge word
  shareChallengeId?: string | null; // seeded Arena: the challenge minted from THIS round's word — public, late visitors race it (+ its ghost tape)
  // Daily-mode (Wordul of the Day). Absent/false on normal race rooms.
  isDaily?: boolean;       // async one-shot, locked word, no resets, per-player scoring
  story?: { title: string; body: string; tip?: string } | null; // World story for the unlock
  voice?: string;          // World companion voice id (forward-compat; client still defaults)
  // Daily "see everyone's board once you've solved" gate. finisherSecret is a per-day
  // random key minted on the first finish and held server-side; it NEVER reaches a client
  // raw (snapshotFor strips it like `seed`). It's handed to a player ONLY via dailyToken,
  // computed into the snapshot for a viewer who has finished today — their proof-of-finish
  // for the /leaderboard letter-board unlock. A non-finisher gets no token and the public
  // leaderboard stays letterless, so today's answer can't be scraped.
  finisherSecret?: string; // INTERNAL ONLY — stripped outbound (see snapshotFor)
  dailyToken?: string;     // computed outbound — present only on a finished daily viewer's snapshot
  // --- Vibe Studio v1: curated day-page theming (additive; absent on legacy days) ---
  colorScheme?: { a1: string; a2: string; a3: string } | null; // palette → CSS-var re-theme
  vibeTitle?: string;      // curated title; becomes the daily board title when present
  seed?: SeedMarker;       // INTERNAL ONLY — present on seeded bot rooms; stripped outbound (Slice C)
  tape?: GhostTape | null; // INTERNAL ONLY — seeded round's ghost tape; persisted with state (survives hibernation), stripped outbound
  publicArena?: boolean;   // INTERNAL ONLY — a human-hosted public Arena room; stripped outbound
  // Rematch handshake — INTERNAL ONLY; stripped outbound in snapshotFor (like seed/publicArena).
  rematch?: { proposer: string; deadline: number } | null;
  botRematchAt?: number | null;     // epoch ms the bot decides; null = none pending
  rematchTimeoutAt?: number | null; // epoch ms the proposal auto-cancels; null = none pending
  abandonAt?: number | null;        // INTERNAL ONLY — public lobby grace deadline; delist if still human-empty when it fires
};

export type ClientMessage =
  | { type: "hello"; username: string; wordLength?: number; mode?: RoomMode; edition?: string; lane?: LaneName; scienceOptOut?: boolean; public?: boolean; sessionToken?: string }
  | { type: "start" }
  | { type: "ready"; ready: boolean } // duel: toggle ready / "Challenge 👑"; gates the countdown
  | { type: "guess"; word: string; hard?: boolean } // hard: client hard-mode flag — gates the dead-letter penalty in pointsEarned
  | { type: "typing"; len: number } // ephemeral: how many letters are in my current row (no letters sent)
  | { type: "rematch_propose" }
  | { type: "rematch_accept" }
  | { type: "rematch_decline" }
  | { type: "chat"; text: string }
  | { type: "set_length"; wordLength: number }
  | { type: "set_rows"; rows: number }
  | { type: "set_capacity"; capacity: number } // host-only (server-enforced): resize the duel table, clamped [max(2, seated), 6]
  | { type: "set_mode"; mode: RoomMode }
  | { type: "set_edition"; edition: string }
  | { type: "rename"; name: string }
  | { type: "reveal_letter"; known?: number[] }
  | { type: "vowel_count" }
  | { type: "resign" }
  | { type: "tape"; events: unknown; truncated?: boolean }
  | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; room: RoomSnapshot }
  | { type: "typing"; username: string; len: number } // relayed live-typing pulse (anonymous: count only)
  | { type: "error"; message: string }
  | { type: "arena_handoff"; challengeId: string; host: string; hostDone: boolean } // seeded room is 1-human: route the visitor to the share challenge instead of a dead-end
  | { type: "invalid_guess"; reason: string }
  | { type: "revealed_letter"; index: number; letter: string }
  | { type: "vowels"; count: number }
  | { type: "pong" }
  | { type: "rematch_proposed"; proposer: string }
  | { type: "rematch_accepted"; by: string }
  | { type: "rematch_cancelled"; reason: "declined" | "timeout" | "left" };

// Challenge link types live in challenge-core.ts (pure + unit-tested); re-export
// here so DO/worker/room import them alongside the other shared types.
export type { ChallengeAttempt, ChallengeRecord, ChallengeState, ChallengeMeta } from "./challenge-core.ts";
