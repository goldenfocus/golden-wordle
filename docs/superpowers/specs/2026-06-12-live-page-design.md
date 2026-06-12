# /live — Open Tables + Global Chat (Increment 1)

**Date:** 2026-06-12 · **Status:** approved design · **Branch:** `live-page`

## Vision (two increments)

A public "town square" page where visitors see live activity and players find each other.

- **Increment 1 (this spec):** new `/live` page = open-tables list (bots + humans) + full
  global chat. No changes to the in-game loop.
- **Increment 2 (separate spec, later):** watch mode — spectator role in the Room DO,
  "Watch" buttons on in-progress games, and per-room privacy settings (no-spectators now;
  invite-only / password / secret-link later). Increment 1's data model anticipates this
  via the `visibility` field but builds no spectator code.

## Decisions (from brainstorm)

- New 2nd page at **`/live`**, "Live" door tile on the home mode grid. Home stays calm.
- **Full global chat** (real backend, not a feed or placeholder).
- Reading chat + browsing tables: open to everyone, including anonymous visitors.
  **Posting requires a username** (existing identity flow).
- Tables list shows **joinable lobby-phase rooms only** (no greyed in-progress rows);
  in-progress games join the page in Increment 2 when they're watchable.
- Rooms are listed by default; `visibility: "unlisted"` opts out (UI in Increment 2).
- Daily rooms keep their privacy guarantee — never listed, never spectatable.

## Section 1 — Page shell

- `/live` is an SPA route: `worker.ts` serves the `index.html` shell (same as `/feed`);
  `app.js` adds a `live` view to the router.
- Home: `#modeLive` tile in the `hub.js` mode grid → navigates to `/live`.
- Layout: two stacked regions on mobile, two columns at ≥860px.
  - **Open tables** (primary): host + icon, edition, word length, seats, Join.
    Empty state: "No open tables — start one" → `enterNewRoom()`.
  - **Global chat** (secondary): transcript + composer + "N online" presence count.

## Section 2 — Open-tables registry (extend Arena)

Today only bot-seeded rooms appear in `/api/arena/open` (`arena.ts`). Human rooms join
the same index:

- **Register:** `Room.registerRoom()` (room.ts:432, fires on first join) additionally
  best-effort `POST https://do/open` to the ARENA singleton with the room's metadata
  (path, routePath, host, edition, wordLength, seats) — the same record shape bots use.
  Re-POST on join/leave so seat counts stay fresh.
  - **Never register:** daily rooms (`daily/<date>`), challenge ghost rooms
    (`c:<id>:<player>`), full rooms, and `visibility: "unlisted"` rooms.
- **Deregister:** `closeArena()` (room.ts:964) drops its `if (!this.state.seed)` guard
  for the `/close` POST so human rooms leave the index on game start; also deregister
  when the room fills or empties.
- **Arena:** `/open` POST handler (arena.ts:41) extends to accept the full metadata
  record (today it takes only `{path}`). Existing `prune()` ages out stale entries;
  re-registration on every join self-heals a missed close.
- **Room state:** new `visibility: "open" | "unlisted"` field, default `"open"`.
  Persisted with room state; no settings UI in this increment.
- **Client:** `arena-panel.js` (mount-agnostic, polls `/api/arena/open` every 8s) is
  mounted on `/live` as-is. One unified bot+human feed.

## Section 3 — Global chat backend (new `Lobby` DO)

New Durable Object class `Lobby`, binding `LOBBY`, singleton `idFromName("lobby")`.
Modeled on `Room`'s proven patterns:

- **WS endpoint:** `GET /ws/live` in worker.ts → `handleUpgrade()` with the
  **hibernation API** (`ctx.acceptWebSocket`, username in `serializeAttachment`,
  same as room.ts:177). Anonymous visitors connect with an empty attachment (read-only).
- **Protocol:**
  - client→server: `{type:"chat", text}` · `{type:"ping"}`
  - server→client: `{type:"chat_snapshot", chat, online}` on connect, then incremental
    `{type:"chat", entry}` · `{type:"online", n}` · `{type:"error", code}` · `{type:"pong"}`
  - Incremental diffs, NOT Room's full-snapshot rebroadcast — chat-only deltas are
    trivial and the singleton holds many sockets.
- **Message shape:** reuse `ChatEntry` from types.ts verbatim
  (`{kind:"user", from, text, t} | {kind:"system", text, t}`).
- **Guards (mirroring `onChat()`, room.ts:1063):** strip control chars + `<>`, trim,
  `MAX_CHAT_LEN = 200`, per-username throttle **2000ms** (stiffer than room's 800ms),
  ring buffer `slice(-100)` persisted to DO storage. Sockets without a username
  attachment get their `chat` messages rejected server-side.
- **Presence:** `online` = `ctx.getWebSockets().length`, broadcast on connect/close.
  No join/leave lines in the transcript (matches lobby-air presence-out-of-chat call).
- **Pure core:** `src/lobby-core.ts` — sanitize, throttle window, ring buffer, presence
  count — direct vitest coverage without DO scaffolding (pattern: `arena-core.ts`).
- **Wrangler:** new DO class + migration tag in `wrangler.jsonc`.

## Section 4 — Client view

New module `public/live.js`:

- `renderLive()` mounts `mountArenaList(el, {onJoin})` (existing) and a new
  `mountGlobalChat(el)`.
- Chat socket connects on view enter, disconnects on view exit — no background socket
  while playing.
- Transcript renders `ChatEntry` rows timestamp-first (same formatting as room chat).
- Composer enabled with a username; otherwise one sign-in nudge row ("pick a name to
  chat") reusing the existing rename/identity flow.

## Failure modes

- **Chat WS drops** → auto-reconnect with backoff (reuse room socket reconnect pattern);
  on reconnect, `chat_snapshot` REPLACES the transcript (idempotent re-seed).
- **Arena poll fails** → `arena-panel.js` keeps the last list; empty state only on a
  confirmed-empty response (existing behavior).
- **Throttle / oversize / anonymous post** → server `{type:"error", code}`; composer
  shows inline notice; message not echoed.
- **Stale table row** (filled/started between polls) → join flows into existing
  room-full handling; prune + 8s poll keep the window small.

## Testing

- `test/lobby-core.test.js` — sanitize, length cap, throttle window, ring-buffer cap,
  presence counting, anonymous-sender rejection.
- Room registry tests — human rooms register on join / deregister on start, fill, and
  empty; daily, challenge, and unlisted rooms never register; seat-count re-POST.
- Static-markup/wiring tests (pattern: `#hubGold` ARIA tests) — `/live` route renders
  both regions; composer disabled state for anonymous users; `#modeLive` tile present.
- Manual QA on the preview lane (`wrangler deploy -c wrangler.preview.jsonc` →
  wordul-preview) before ship — version preview URLs don't work for DO workers.

## Out of scope (Increment 2+)

- Spectator role / watch mode in the Room DO; "Watch" buttons.
- Room privacy settings UI (no spectators, invite-only, password, secret link) — only
  the `visibility` field ships now.
- Moderation tooling beyond throttle + sanitize (mute/ban lists, admin tools).
- Chat history beyond the 100-entry ring; no persistence of old messages.
