# /live Page — Global Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing `/arena` view into a `/live` page that keeps the open-tables
list and adds a real global chat (new singleton `Lobby` Durable Object).

**Architecture:** The open-tables backend already ships (Arena DO + `mountArenaList`). This
plan adds one new singleton DO (`Lobby`, keyed `idFromName("lobby")`) that owns a hibernatable
WebSocket chat with a persisted 100-entry ring buffer, exposed at `GET /ws/live`. The client
gets a `mountGlobalChat()` module; `/arena` becomes `/live` (redirect + relabel) and renders
tables + chat side by side. All chat logic that can be pure lives in `src/lobby-core.ts` for
node-env unit tests; the DO is a thin wrapper tested with the same in-node stub harness the
Room tests use.

**Tech Stack:** Cloudflare Workers, Durable Objects (hibernation WebSocket API), vanilla JS
frontend, Vitest (node env, `cloudflare:workers` stubbed), TypeScript typecheck.

**Spec:** `docs/superpowers/specs/2026-06-12-live-page-design.md` (see the 2026-06-14
Reconciliation section — Section 2 is already built; this plan is Sections 1/3/4).

**Working dir:** `/Users/zang/wordul/.claude/worktrees/live-page` (branch `live-page`).
Run all commands from there. Ship at the end via `bash dev/ship.sh` — never `wrangler deploy`.

---

## File structure

**Create:**
- `src/lobby-core.ts` — pure chat logic: sanitize, throttle, ring-buffer cap, message-type
  definitions (`LobbyClientMessage`, `LobbyServerMessage`). Zero Cloudflare deps.
- `src/lobby.ts` — the `Lobby` DO. Thin: hibernation WS accept, attachment-based identity,
  storage-backed ring, broadcast + presence. Delegates all rules to `lobby-core.ts`.
- `public/live.js` — `mountGlobalChat(mountEl, opts)`: the WS chat client (connect, render
  transcript, composer, presence, reconnect) + exported pure render helpers.
- `test/lobby-core.test.js` — unit tests for the pure core.
- `test/lobby-do.test.ts` — DO tests using the in-node stub harness (pattern:
  `test/room-chat-noise.test.ts`).
- `test/live-chat.test.js` — jsdom render/wiring tests for `mountGlobalChat`.

**Modify:**
- `src/types.ts` — add `LOBBY: DurableObjectNamespace` to `Env`.
- `wrangler.jsonc` — add `LOBBY` binding + migration tag `v9` (`new_sqlite_classes: ["Lobby"]`).
- `src/worker.ts` — import + export `Lobby`; route `GET /ws/live` → Lobby DO; serve `/live`
  SPA shell; redirect `/arena` → `/live`.
- `public/app.js` — rename `showArena`→`showLive`; add `kind:"live"` route + `/arena` client
  redirect; render a chat region in the view and wire `mountGlobalChat`; relabel copy.
- `public/hub.js` — relabel the `#modeArena` door tile to "Live".
- `public/style.css` — `/live` two-region layout + chat panel styles.

---

## Task 1: Pure chat core (`src/lobby-core.ts`)

**Files:**
- Create: `src/lobby-core.ts`
- Test: `test/lobby-core.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/lobby-core.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  sanitizeChat, isThrottled, capChat,
  LOBBY_MAX_CHAT, LOBBY_MAX_CHAT_LEN, LOBBY_THROTTLE_MS,
} from "../src/lobby-core.ts";

describe("sanitizeChat", () => {
  it("strips control chars and angle brackets, trims, caps length", () => {
    expect(sanitizeChat("  hi <b>there</b>\x00  ")).toBe("hi bthere/b");
    expect(sanitizeChat("a".repeat(LOBBY_MAX_CHAT_LEN + 50))).toHaveLength(LOBBY_MAX_CHAT_LEN);
    expect(sanitizeChat("   ")).toBe("");
    expect(sanitizeChat(null)).toBe("");
  });
});

describe("isThrottled", () => {
  it("blocks a second message inside the window, allows after", () => {
    expect(isThrottled(1000, 1000 + LOBBY_THROTTLE_MS - 1)).toBe(true);
    expect(isThrottled(1000, 1000 + LOBBY_THROTTLE_MS)).toBe(false);
    expect(isThrottled(undefined, 5000)).toBe(false); // never spoke → not throttled
  });
});

describe("capChat", () => {
  it("keeps only the last LOBBY_MAX_CHAT entries, newest preserved", () => {
    const many = Array.from({ length: LOBBY_MAX_CHAT + 10 }, (_, i) => ({ kind: "user", from: "u", text: String(i), t: i }));
    const capped = capChat(many);
    expect(capped).toHaveLength(LOBBY_MAX_CHAT);
    expect(capped[capped.length - 1].text).toBe(String(LOBBY_MAX_CHAT + 9));
    const few = [{ kind: "user", from: "u", text: "x", t: 1 }];
    expect(capChat(few)).toBe(few); // no copy when under cap
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lobby-core.test.js`
Expected: FAIL — "Failed to resolve import ../src/lobby-core.ts" / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lobby-core.ts`:

```ts
// Pure, node-testable chat logic for the global Lobby DO. Mirrors the Room chat rules
// (room.ts onChat/capChat) but with lobby-tuned constants and no Cloudflare deps. The DO
// wrapper (lobby.ts) is the only layer that touches storage/sockets.
import type { ChatEntry } from "./types.ts";

export const LOBBY_MAX_CHAT = 100;      // persisted ring size (bigger than a room's 40)
export const LOBBY_MAX_CHAT_LEN = 200;  // same boundary as room + username sanitation
export const LOBBY_THROTTLE_MS = 2000;  // stiffer than a room's 800ms — one global feed

// Strip control chars + angle brackets (same boundary as usernames), trim, hard-cap length.
export function sanitizeChat(textRaw: string | null | undefined): string {
  return (textRaw ?? "")
    .replace(/[\x00-\x1f\x7f<>]/g, "")
    .trim()
    .slice(0, LOBBY_MAX_CHAT_LEN);
}

// True when `now` is within THROTTLE_MS of this sender's last accepted message.
export function isThrottled(lastMs: number | undefined, nowMs: number): boolean {
  return nowMs - (lastMs ?? 0) < LOBBY_THROTTLE_MS;
}

// Ring-buffer cap: keep only the newest LOBBY_MAX_CHAT entries. Returns the input
// unchanged when already under the cap (no needless copy).
export function capChat(chat: ChatEntry[]): ChatEntry[] {
  return chat.length > LOBBY_MAX_CHAT ? chat.slice(-LOBBY_MAX_CHAT) : chat;
}

// --- Wire protocol (isolated from the Room's ClientMessage/ServerMessage unions) --------
export type LobbyClientMessage =
  | { type: "chat"; text: string }
  | { type: "ping" };

export type LobbyServerMessage =
  | { type: "chat_snapshot"; chat: ChatEntry[]; online: number }
  | { type: "chat"; entry: ChatEntry }
  | { type: "online"; n: number }
  | { type: "error"; code: "need_name" | "slow_down" }
  | { type: "pong" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lobby-core.test.js`
Expected: PASS (3 files of assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/lobby-core.ts test/lobby-core.test.js
git commit -q -m "feat(lobby): pure chat core — sanitize, throttle, ring buffer + wire types"
```

---

## Task 2: Lobby Durable Object (`src/lobby.ts`)

**Files:**
- Create: `src/lobby.ts`
- Test: `test/lobby-do.test.ts`

Behavior contract:
- On WS upgrade: accept via hibernation API, store `{ username }` in the attachment
  (`""` = anonymous, read-only), send `chat_snapshot`, broadcast updated `online`.
- On `{type:"chat"}`: reject (`error/need_name`) if attachment has no username; sanitize;
  reject (`error/slow_down`) if throttled; else append to the persisted ring, cap, and
  broadcast `{type:"chat", entry}` to all sockets.
- On `{type:"ping"}`: reply `{type:"pong"}`.
- On close: broadcast `online` recomputed **excluding** the closing socket.

- [ ] **Step 1: Write the failing test**

Create `test/lobby-do.test.ts` (harness mirrors `test/room-chat-noise.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown; env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Lobby } from "../src/lobby.ts";
import { LOBBY_THROTTLE_MS } from "../src/lobby-core.ts";

type Sent = Record<string, unknown>;
function mockWs(username: string | null) {
  const sent: Sent[] = [];
  const ws = {
    _sent: sent,
    serializeAttachment: (_v: unknown) => {},
    deserializeAttachment: () => (username === null ? null : { username }),
    send: (s: string) => sent.push(JSON.parse(s)),
    close: () => {},
  };
  return ws as unknown as WebSocket & { _sent: Sent[] };
}

function makeLobby() {
  const sockets: WebSocket[] = [];
  let stored: unknown[] | undefined;
  const ctx = {
    storage: {
      get: async (_k: string) => stored,
      put: async (_k: string, v: unknown[]) => { stored = v; },
    },
    getWebSockets: () => sockets,
    acceptWebSocket: (ws: WebSocket) => sockets.push(ws),
  };
  const lobby = new Lobby(ctx as never, {} as never) as unknown as {
    webSocketMessage: (ws: WebSocket, raw: string) => Promise<void>;
    webSocketClose: (ws: WebSocket) => Promise<void>;
  };
  return { lobby, sockets };
}

const now = () => vi.spyOn(Date, "now");

describe("Lobby chat", () => {
  it("rejects chat from an anonymous (no-username) socket", async () => {
    const { lobby, sockets } = makeLobby();
    const anon = mockWs(null);
    sockets.push(anon);
    await lobby.webSocketMessage(anon, JSON.stringify({ type: "chat", text: "hi" }));
    expect((anon as any)._sent).toContainEqual({ type: "error", code: "need_name" });
  });

  it("broadcasts a sanitized entry from a named socket to everyone", async () => {
    const { lobby, sockets } = makeLobby();
    const a = mockWs("alice"); const b = mockWs("bob");
    sockets.push(a, b);
    const t = now().mockReturnValue(10_000);
    await lobby.webSocketMessage(a, JSON.stringify({ type: "chat", text: "  he<b>llo  " }));
    for (const s of [a, b]) {
      expect((s as any)._sent).toContainEqual({ type: "chat", entry: { kind: "user", from: "alice", text: "hello", t: 10_000 } });
    }
    t.mockRestore();
  });

  it("throttles a second message inside the window", async () => {
    const { lobby, sockets } = makeLobby();
    const a = mockWs("alice"); sockets.push(a);
    const t = now().mockReturnValue(1000);
    await lobby.webSocketMessage(a, JSON.stringify({ type: "chat", text: "one" }));
    t.mockReturnValue(1000 + LOBBY_THROTTLE_MS - 1);
    await lobby.webSocketMessage(a, JSON.stringify({ type: "chat", text: "two" }));
    expect((a as any)._sent).toContainEqual({ type: "error", code: "slow_down" });
    const chats = (a as any)._sent.filter((m: Sent) => m.type === "chat");
    expect(chats).toHaveLength(1); // only "one" broadcast
    t.mockRestore();
  });

  it("answers ping with pong", async () => {
    const { lobby, sockets } = makeLobby();
    const a = mockWs("alice"); sockets.push(a);
    await lobby.webSocketMessage(a, JSON.stringify({ type: "ping" }));
    expect((a as any)._sent).toContainEqual({ type: "pong" });
  });

  it("on close, broadcasts online excluding the closing socket", async () => {
    const { lobby, sockets } = makeLobby();
    const a = mockWs("alice"); const b = mockWs("bob");
    sockets.push(a, b);
    await lobby.webSocketClose(a);
    expect((b as any)._sent).toContainEqual({ type: "online", n: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lobby-do.test.ts`
Expected: FAIL — cannot resolve `../src/lobby.ts` / `Lobby` not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lobby.ts`:

```ts
import { DurableObject } from "cloudflare:workers";
import type { Env, ChatEntry } from "./types.ts";
import {
  sanitizeChat, isThrottled, capChat,
  type LobbyClientMessage, type LobbyServerMessage,
} from "./lobby-core.ts";

// Singleton global-chat DO (idFromName("lobby")). Hibernatable WebSockets; identity rides
// the socket attachment ("" = anonymous read-only). The chat ring is the only persisted
// state (survives hibernation/eviction). Presence is derived, never stored.
export class Lobby extends DurableObject<Env> {
  private throttle = new Map<string, number>();

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // The worker validates + normalizes the username before proxying; "" means anonymous.
    const username = new URL(req.url).searchParams.get("u") ?? "";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username });
    const chat = (await this.ctx.storage.get<ChatEntry[]>("chat")) ?? [];
    this.send(server, { type: "chat_snapshot", chat, online: this.ctx.getWebSockets().length });
    this.broadcastOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: LobbyClientMessage;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { return; }
    if (msg.type === "ping") { this.send(ws, { type: "pong" }); return; }
    if (msg.type === "chat") { await this.onChat(ws, msg.text); return; }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // The closing socket may still appear in getWebSockets() during this handler — exclude it.
    this.broadcastOnline(ws);
  }

  private async onChat(ws: WebSocket, textRaw: string): Promise<void> {
    const att = ws.deserializeAttachment() as { username?: string } | null;
    const username = att?.username ?? "";
    if (!username) { this.send(ws, { type: "error", code: "need_name" }); return; }
    const text = sanitizeChat(textRaw);
    if (!text) return;
    const now = Date.now();
    if (isThrottled(this.throttle.get(username), now)) {
      this.send(ws, { type: "error", code: "slow_down" });
      return;
    }
    this.throttle.set(username, now);
    const entry: ChatEntry = { kind: "user", from: username, text, t: now };
    const chat = capChat([...((await this.ctx.storage.get<ChatEntry[]>("chat")) ?? []), entry]);
    await this.ctx.storage.put("chat", chat);
    this.broadcast({ type: "chat", entry });
  }

  private send(ws: WebSocket, msg: LobbyServerMessage): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket closing; ignore */ }
  }

  private broadcast(msg: LobbyServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  private broadcastOnline(exclude?: WebSocket): void {
    const others = this.ctx.getWebSockets().filter((ws) => ws !== exclude);
    const payload: LobbyServerMessage = { type: "online", n: others.length };
    for (const ws of others) this.send(ws, payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lobby-do.test.ts`
Expected: PASS (5 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lobby.ts test/lobby-do.test.ts
git commit -q -m "feat(lobby): global-chat Durable Object — hibernatable WS, ring, presence"
```

---

## Task 3: Register the DO (`src/types.ts`, `wrangler.jsonc`, `src/worker.ts` export)

**Files:**
- Modify: `src/types.ts` (add `LOBBY` to `Env`)
- Modify: `wrangler.jsonc` (binding + migration `v9`)
- Modify: `src/worker.ts:6` (import) and `src/worker.ts:27` (export)

- [ ] **Step 1: Add the binding to the `Env` interface**

In `src/types.ts`, inside `interface Env`, add after the `WORDULS` line (types.ts:39):

```ts
  LOBBY: DurableObjectNamespace;
```

- [ ] **Step 2: Add the wrangler binding**

In `wrangler.jsonc`, in `durable_objects.bindings`, after the `Worduls` entry
(the block ending at the `"class_name": "Worduls"` object, ~line 62), add:

```jsonc
      { "name": "LOBBY", "class_name": "Lobby" }
```

- [ ] **Step 3: Add the migration tag**

In `wrangler.jsonc`, in `migrations`, after the `v8` entry (~line 146), add:

```jsonc
    {
      // Global-chat coordinator DO. Free plan: new_sqlite_classes (same rule as every
      // class here — new_classes fails on the free plan, err 10097).
      "tag": "v9",
      "new_sqlite_classes": ["Lobby"]
    }
```

- [ ] **Step 4: Import and export the class in the worker entry**

In `src/worker.ts` line 6 area, add an import:

```ts
import { Lobby } from "./lobby.ts";
```

Change the export line (worker.ts:27) from:

```ts
export { Room, User, WordStats, Challenge, Daily, Science, Arena, Worduls };
```

to:

```ts
export { Room, User, WordStats, Challenge, Daily, Science, Arena, Worduls, Lobby };
```

- [ ] **Step 5: Verify typecheck + config parse**

Run: `npm run typecheck`
Expected: PASS (no type errors — `Lobby` referenced by the binding now has an `Env.LOBBY`).

Run: `npx wrangler deploy --dry-run --outdir /tmp/live-dryrun 2>&1 | tail -5`
Expected: builds without a migration/binding error (dry run only — does NOT deploy).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts wrangler.jsonc src/worker.ts
git commit -q -m "feat(lobby): wire Lobby DO — Env binding, migration v9, worker export"
```

---

## Task 4: Worker routing — `/ws/live`, `/live` shell, `/arena`→`/live`

**Files:**
- Modify: `src/worker.ts` (WS route near the `/ws` block ~line 82; shell route near
  the `/arena` shell ~line 769)

- [ ] **Step 1: Add the `/ws/live` upgrade route**

In `src/worker.ts`, immediately BEFORE the `if (url.pathname === "/ws") {` block
(~line 83), add:

```ts
    // Global lobby chat WebSocket. Singleton Lobby DO; the username is validated +
    // normalized HERE (the DO trusts the `u` param), "" ⇒ anonymous read-only.
    if (url.pathname === "/ws/live") {
      const raw = normalizeUsername(url.searchParams.get("u") ?? "");
      const username = isValidUsername(raw) ? raw : "";
      const stub = env.LOBBY.get(env.LOBBY.idFromName("lobby"));
      const upstream = new URL(req.url);
      upstream.searchParams.set("u", username);
      return stub.fetch(new Request(upstream.toString(), req));
    }
```

- [ ] **Step 2: Add the `/live` shell route and `/arena`→`/live` redirect**

In `src/worker.ts`, REPLACE the existing `/arena` shell block (~lines 769-776):

```ts
    // Arena lobby (/arena): a real, refresh-survivable client route. Serve the SPA shell
    // so a hard load / refresh / share resolves; the client router then renders the open-
    // games view. Explicit (not left to asset fallback) to match every other client route
    // here and to not depend on an out-of-band not_found_handling setting (see wrangler.jsonc).
    if (url.pathname === "/arena") {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }
```

with:

```ts
    // /arena was renamed to /live (open tables + global chat). Redirect old links/shares
    // (302, not 301 — keep it uncached during rollout in case the name moves again).
    if (url.pathname === "/arena") {
      return Response.redirect(url.origin + "/live", 302);
    }

    // Live (/live): open tables + global chat. Real refresh-survivable route — serve the
    // SPA shell with lobby meta; the client router renders the two-region view.
    if (url.pathname === "/live") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      const title = "Live — Wordul";
      const desc = "See who's playing, jump into an open game, and chat with the room.";
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(title))
        .on('[data-meta="og:title"]', new AttrSetter("content", title))
        .on('[data-meta="description"]', new AttrSetter("content", desc))
        .on('[data-meta="og:description"]', new AttrSetter("content", desc))
        .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/live`))
        .on('[data-meta="og:url"]', new AttrSetter("content", `${url.origin}/live`))
        .transform(shell);
    }
```

(`TextSetter` / `AttrSetter` are already imported and used by the `/worlds` block — reuse them.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify the loc-ratchet still passes**

Run: `npx vitest run test/loc-ratchet.test.ts`
Expected: PASS (`src/worker.ts` stays under its 1300-line cap).

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts
git commit -q -m "feat(live): worker routes — /ws/live chat socket, /live shell, /arena→/live"
```

---

## Task 5: Chat client module (`public/live.js`)

**Files:**
- Create: `public/live.js`
- Test: `test/live-chat.test.js`

`mountGlobalChat(mountEl, opts)` renders a transcript + composer + presence line, opens
`/ws/live?u=<username>`, and returns a `stop()` that closes the socket. It must be
XSS-safe (build rows with `textContent`, never `innerHTML` of user text). Pure render
helpers are exported for testing without a live socket.

- [ ] **Step 1: Write the failing test**

Create `test/live-chat.test.js`:

```js
// jsdom render tests for the global-chat client. We test the pure DOM helpers, not the
// live WebSocket (the DO is covered by test/lobby-do.test.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { chatRow, renderTranscript, presenceLabel } from "../public/live.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("chatRow", () => {
  it("renders a user entry with the sender and text as textContent (XSS-safe)", () => {
    const row = chatRow({ kind: "user", from: "alice", text: "<img src=x>", t: 0 });
    expect(row.querySelector(".chat-from").textContent).toBe("alice");
    expect(row.querySelector(".chat-text").textContent).toBe("<img src=x>");
    expect(row.querySelector(".chat-text").innerHTML).not.toContain("<img");
  });

  it("renders a system entry without a sender", () => {
    const row = chatRow({ kind: "system", text: "welcome", t: 0 });
    expect(row.querySelector(".chat-from")).toBeNull();
    expect(row.classList.contains("chat-system")).toBe(true);
  });
});

describe("renderTranscript", () => {
  it("replaces prior content (idempotent re-seed) and appends in order", () => {
    const el = document.createElement("div");
    renderTranscript(el, [{ kind: "user", from: "a", text: "1", t: 1 }]);
    renderTranscript(el, [
      { kind: "user", from: "a", text: "1", t: 1 },
      { kind: "user", from: "b", text: "2", t: 2 },
    ]);
    const rows = el.querySelectorAll(".chat-row");
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector(".chat-text").textContent).toBe("2");
  });
});

describe("presenceLabel", () => {
  it("formats the online count", () => {
    expect(presenceLabel(1)).toBe("1 online");
    expect(presenceLabel(23)).toBe("23 online");
    expect(presenceLabel(0)).toBe("0 online");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/live-chat.test.js`
Expected: FAIL — cannot resolve `../public/live.js`.

- [ ] **Step 3: Write the implementation**

Create `public/live.js`:

```js
// public/live.js — the global-chat client for /live. Pure render helpers (chatRow,
// renderTranscript, presenceLabel) are exported for tests; mountGlobalChat wires them to a
// live /ws/live socket with auto-reconnect. All user text goes in via textContent — never
// innerHTML — so a message can never inject markup.

export function presenceLabel(n) {
  return `${n} online`;
}

// Build one transcript row. `entry` is a ChatEntry: {kind:"user",from,text,t} | {kind:"system",text,t}.
export function chatRow(entry) {
  const row = document.createElement("div");
  row.className = "chat-row" + (entry.kind === "system" ? " chat-system" : "");
  if (entry.kind === "user") {
    const from = document.createElement("span");
    from.className = "chat-from";
    from.textContent = entry.from;
    row.appendChild(from);
  }
  const text = document.createElement("span");
  text.className = "chat-text";
  text.textContent = entry.text;
  row.appendChild(text);
  return row;
}

// Replace the transcript wholesale (used for the initial snapshot AND reconnect re-seed —
// idempotent). For a single new message, use appendRow to avoid a full rebuild.
export function renderTranscript(el, entries) {
  el.textContent = "";
  const frag = document.createDocumentFragment();
  for (const e of entries) frag.appendChild(chatRow(e));
  el.appendChild(frag);
  el.scrollTop = el.scrollHeight;
}

function appendRow(el, entry) {
  el.appendChild(chatRow(entry));
  el.scrollTop = el.scrollHeight;
}

// Mount the chat panel into mountEl and open the socket.
// opts: { username, onNeedName }.
//   username    — the current player's name ("" / null ⇒ anonymous read-only composer)
//   onNeedName  — called when an anonymous user tries to post (host prompts a rename)
// Returns stop() — closes the socket and halts reconnect. The caller MUST call it on teardown.
export function mountGlobalChat(mountEl, { username, onNeedName } = {}) {
  if (!mountEl) return () => {};
  mountEl.innerHTML =
    `<div class="chat-head"><span class="chat-title">Global chat</span>` +
    `<span class="chat-presence" id="chatPresence"></span></div>` +
    `<div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>` +
    `<form class="chat-compose" id="chatCompose">` +
    `<input id="chatInput" class="chat-input" maxlength="200" autocomplete="off" ` +
    `placeholder="${username ? "Say something…" : "Pick a name to chat"}"${username ? "" : " disabled"}>` +
    `<button class="chat-send" type="submit"${username ? "" : " disabled"}>Send</button></form>`;

  const log = mountEl.querySelector("#chatLog");
  const presence = mountEl.querySelector("#chatPresence");
  const form = mountEl.querySelector("#chatCompose");
  const input = mountEl.querySelector("#chatInput");

  let ws = null;
  let stopped = false;
  let backoff = 1000;

  const connect = () => {
    if (stopped) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const u = username ? `?u=${encodeURIComponent(username)}` : "";
    ws = new WebSocket(`${proto}//${location.host}/ws/live${u}`);
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "chat_snapshot") { renderTranscript(log, msg.chat); presence.textContent = presenceLabel(msg.online); }
      else if (msg.type === "chat") { appendRow(log, msg.entry); }
      else if (msg.type === "online") { presence.textContent = presenceLabel(msg.n); }
      else if (msg.type === "error" && msg.code === "need_name" && onNeedName) { onNeedName(); }
      else if (msg.type === "error" && msg.code === "slow_down") { input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 400); }
    };
    ws.onopen = () => { backoff = 1000; };
    ws.onclose = () => {
      if (stopped) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000); // cap reconnect backoff at 15s
    };
  };
  connect();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!username) { if (onNeedName) onNeedName(); return; }
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", text }));
    input.value = "";
  });

  return function stop() {
    stopped = true;
    if (ws) { try { ws.close(); } catch (_) { /* already closing */ } }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/live-chat.test.js`
Expected: PASS (helpers render as asserted).

- [ ] **Step 5: Commit**

```bash
git add public/live.js test/live-chat.test.js
git commit -q -m "feat(live): global-chat client module — transcript, composer, reconnect"
```

---

## Task 6: `/live` view + routing in `public/app.js`

**Files:**
- Modify: `public/app.js` — import (line ~24 area), route table (`route()` ~line 127),
  route dispatch (~line 5687), title map (~line 5512), `showArenaRoute`/`showArena`
  (~lines 1677-1710), `maybeOpenArena` (~1743).

The current `showArena()` renders into `#hubContent`. We rename it `showLive()`, add a
chat region beside the tables, wire `mountGlobalChat`, relabel copy, and set the URL to
`/live`. The `/arena` client path redirects to `/live` (for in-app history + any client
navigation that still targets `/arena`).

- [ ] **Step 1: Import the chat module**

In `public/app.js` near line 24 (after the `mountArenaList` import), add:

```js
import { mountGlobalChat } from "/live.js";
```

- [ ] **Step 2: Add the `/live` route + redirect `/arena` in `route()`**

In `public/app.js`, find (line ~127):

```js
  if (location.pathname === "/arena") return { kind: "arena" };
```

Replace it with:

```js
  if (location.pathname === "/arena" || location.pathname === "/live") return { kind: "live" };
```

(No `replaceState` here — this classifier stays side-effect-free; `showLive()` normalizes
the URL to `/live` when it renders, so an `/arena` in-app hit lands on the canonical URL.)

- [ ] **Step 3: Update the route dispatch**

In `public/app.js`, find (line ~5687):

```js
  if (r.kind === "arena") { showArenaRoute(); return; }
```

Replace with:

```js
  if (r.kind === "live") { showLiveRoute(); return; }
```

- [ ] **Step 4: Update the document-title map**

In `public/app.js`, find (line ~5512):

```js
    : r.kind === "arena" ? "Arena"
```

Replace with:

```js
    : r.kind === "live" ? "Live"
```

- [ ] **Step 5: Rename the route-open helpers**

In `public/app.js`, rename `showArenaRoute` → `showLiveRoute` and `maybeOpenArena` /
`pendingOpenArena` stay as-is internally, but the entry helper (line ~1677) becomes:

```js
// Direct load / refresh of /live: the view lives inside the home hub (#hubContent), so
// mount home first and let maybeOpenArena() open it once the hub renders. The
// pendingOpenArena one-shot is the same hook the "join next → none waiting" fallback uses.
function showLiveRoute() {
  pendingOpenArena = true;
  leaveRoom();
  showHome();
}
```

(Keep the internal `pendingOpenArena` / `maybeOpenArena` names — they're referenced in
several places; only the exported route entry is renamed. `maybeOpenArena()` now calls
`showLive()`.)

- [ ] **Step 6: Rebuild `showArena()` as `showLive()` with a chat region**

In `public/app.js`, replace the whole `showArena()` function (lines ~1683-1710) with:

```js
let liveChatStop = null;

function showLive() {
  const content = document.getElementById("hubContent");
  if (!content) return;
  // A real, refresh-survivable route — reflect it in the URL (replace, not push, so it
  // doesn't pile a history entry on top of the hub the user is already standing on).
  history.replaceState(null, "", "/live");
  stopArenaPoll();
  if (liveChatStop) { liveChatStop(); liveChatStop = null; }
  content.innerHTML =
    `<section class="hub-panel live-view">
      <button id="liveBack" class="hub-textlink" type="button">← Back</button>
      <h1 class="pvp-title">Live <span id="liveTitleCount" class="rail-title-count"></span></h1>
      <p class="live-blurb muted">Jump into an open game, or chat with whoever's around.</p>
      <div class="live-grid">
        <div class="live-tables">
          <div id="arenaList" class="arena-mount"></div>
          <button id="liveHost" class="btn block">Host a public game →</button>
        </div>
        <aside id="liveChat" class="live-chat"></aside>
      </div>
    </section>`;
  const back = document.getElementById("liveBack");
  if (back) back.addEventListener("click", () => { stopArenaPoll(); navigate("/"); });
  const host = document.getElementById("liveHost");
  if (host) host.addEventListener("click", () => { stopArenaPoll(); enterNewRoom({ autoStart: false, publicArena: true }); });
  arenaPollStop = mountArenaList(document.getElementById("arenaList"), {
    onJoin: (routePath) => { pendingArenaOrigin = true; navigate(routePath); },
    onCount: (n) => {
      const t = document.getElementById("liveTitleCount");
      if (t) t.textContent = railTitleCount(n);
    },
  });
  liveChatStop = mountGlobalChat(document.getElementById("liveChat"), {
    username: currentUsername(),
    onNeedName: () => promptRename(),
  });
}
```

**Adapt the last two lines to the codebase's real helpers.** Before writing, grep for the
existing "current username" accessor and the rename/identity entry point:

Run: `grep -n "wr.username\|function currentUsername\|getUsername\|promptRename\|openRename\|function rename" public/app.js | head`

Use whatever the app already exposes (e.g. a `game.username`, a `localStorage["wr.username"]`
read, or an existing rename modal opener). If there is no single accessor, read the username
the same way the hello handshake does (search for `public: game.publicArena` — the username
sent there is the canonical source) and pass a no-op `onNeedName` that focuses the rename UI.

- [ ] **Step 7: Ensure teardown stops the chat socket**

In `public/app.js`, find `stopArenaPoll();` inside the leave/teardown path (line ~5673,
the "leaving the in-place Arena view" comment). Immediately after it, add:

```js
  if (liveChatStop) { liveChatStop(); liveChatStop = null; } // leaving /live kills the chat socket
```

- [ ] **Step 8: Update the callback name (hub door)**

In `public/app.js`, find the hub callback wiring (line ~287):

```js
      onArena: () => showArena(),
```

Replace with:

```js
      onLive: () => showLive(),
```

- [ ] **Step 9: Run the app.js-facing tests + typecheck-adjacent checks**

Run: `npx vitest run test/loc-ratchet.test.ts test/module-graph.test.ts`
Expected: PASS (app.js under 6000-line cap; the new `/live.js` import resolves in the graph).

If `test/module-graph.test.ts` asserts an import allow-list, add `public/live.js` there as
the code directs (open the failure message; it names the file to edit).

- [ ] **Step 10: Commit**

```bash
git add public/app.js
git commit -q -m "feat(live): /live view — tables + global chat, /arena redirects to /live"
```

---

## Task 7: Home door relabel (`public/hub.js`)

**Files:**
- Modify: `public/hub.js` (tile markup ~line 81; wiring ~line 122)
- Test: `test/hub-live-door.test.js` (static-markup, pattern: existing hub markup tests)

- [ ] **Step 1: Write the failing test**

Create `test/hub-live-door.test.js`:

```js
// The home mode grid must offer a "Live" door (renamed from "Arena") wired to onLive.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const hub = readFileSync(new URL("../public/hub.js", import.meta.url), "utf8");

describe("home Live door", () => {
  it("renders a #modeLive tile labelled Live", () => {
    expect(hub).toMatch(/id="modeLive"/);
    expect(hub).toMatch(/aria-label="Live"/);
    expect(hub).not.toMatch(/id="modeArena"/); // fully renamed, no stale id
  });
  it("wires the tile to the onLive callback", () => {
    expect(hub).toMatch(/getElementById\("modeLive"\)/);
    expect(hub).toMatch(/hubCallbacks\.onLive/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hub-live-door.test.js`
Expected: FAIL — hub.js still uses `modeArena` / `onArena`.

- [ ] **Step 3: Relabel the tile markup**

In `public/hub.js` (~line 81), change:

```js
        <button id="modeArena" class="mode-tile" type="button" aria-label="Arena" title="Arena">
```

to:

```js
        <button id="modeLive" class="mode-tile" type="button" aria-label="Live" title="Live">
```

If the tile has a visible text label inside it (check the lines just below 81), change
that text from "Arena" to "Live" as well. Keep the same glyph/icon.

- [ ] **Step 4: Rewire the tile**

In `public/hub.js` (~line 122), change:

```js
  const arena = document.getElementById("modeArena");
  if (arena && hubCallbacks.onArena) arena.addEventListener("click", () => hubCallbacks.onArena());
```

to:

```js
  const live = document.getElementById("modeLive");
  if (live && hubCallbacks.onLive) live.addEventListener("click", () => hubCallbacks.onLive());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/hub-live-door.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/hub.js test/hub-live-door.test.js
git commit -q -m "feat(live): home door relabel Arena → Live, wired to onLive"
```

---

## Task 8: Styles (`public/style.css`)

**Files:**
- Modify: `public/style.css` (append a `/live` section)

No test (pure CSS). Match the existing panel/token vocabulary — reuse the CSS variables
the arena view and chat pill already use (grep for `--` tokens used by `.arena-row` and any
existing chat styles before writing, so colors/spacing stay consistent).

- [ ] **Step 1: Inspect existing tokens**

Run: `grep -n "arena-view\|arena-mount\|arena-row\|chat-log\|chat-input\|--surface\|--muted\|--accent" public/style.css | head -30`

Note the variable names actually in use (e.g. `--surface`, `--line`, `--muted`) and reuse them.

- [ ] **Step 2: Append the layout + chat styles**

Append to `public/style.css` (substitute the real token names found in Step 1 for any that
differ):

```css
/* --- /live: open tables + global chat ------------------------------------ */
.live-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 860px) {
  .live-grid { grid-template-columns: 1fr 1fr; align-items: start; }
}
.live-chat {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  max-height: 60vh;
  border: 1px solid var(--line, #2a2a2a);
  border-radius: 12px;
  overflow: hidden;
}
.chat-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line, #2a2a2a);
}
.chat-title { font-weight: 600; }
.chat-presence { font-size: 0.8rem; color: var(--muted, #888); }
.chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-row { font-size: 0.9rem; line-height: 1.35; word-break: break-word; }
.chat-row .chat-from { font-weight: 600; margin-right: 6px; }
.chat-row.chat-system { color: var(--muted, #888); font-style: italic; }
.chat-compose { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line, #2a2a2a); }
.chat-input { flex: 1; min-width: 0; }
.chat-input:disabled { opacity: 0.6; }
.chat-input.shake { animation: chat-shake 0.4s; }
@keyframes chat-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -q -m "feat(live): styles — two-region /live grid + global chat panel"
```

---

## Task 9: Full verification + manual QA

- [ ] **Step 1: Full test suite + typecheck**

Run: `npm test`
Expected: PASS — all files green, including the four new test files.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Local smoke via dev server**

Run: `npm run dev` (background), then in a browser open `http://localhost:8787/live`.
Verify: the Live door on home opens `/live`; open tables list populates (bots trickle in);
the chat panel shows "N online"; posting requires a name; a message you send appears for a
second tab pointed at `/live`; `http://localhost:8787/arena` redirects to `/live`.

Note the Node-25 localStorage caveat: if jsdom-based tests fail on `localStorage`, confirm
`test/setup.js` is present (it is — the vitest config references it).

- [ ] **Step 3: Preview-lane QA (optional but recommended before ship)**

Deploy the branch to the preview worker (does NOT touch prod):
Run: `npx wrangler deploy -c wrangler.preview.jsonc`
Then QA on `wordul-preview.love-00b.workers.dev/live`. (Version preview URLs do NOT work for
DO workers — use the preview worker, per project memory.)

- [ ] **Step 4: Ship**

Run: `bash dev/ship.sh`
This tests → rebases on `origin/main` → tags a prod backup → fast-forwards main; CI then
deploys `origin/main`. Confirm the deploy by run *conclusions* + a prod smoke of
`https://wordul.com/live`, per CLAUDE.md.

---

## Self-review notes

- **Spec coverage:** Section 1 (page shell) → Tasks 4,6,8. Section 3 (Lobby DO) → Tasks 1–4.
  Section 4 (client + failure modes) → Tasks 5,6. Presence, throttle, sanitize, anonymous
  read-only, reconnect re-seed — all have explicit tests. The `visibility` field is
  deferred per the 2026-06-14 reconciliation (open-tables backend already ships).
- **Identity accessor (Task 6, Step 6):** the ONE codebase-specific unknown — the plan
  directs a grep for the real "current username" + rename helpers rather than guessing a
  name. Resolve it during implementation; everything else is fully specified.
- **Type consistency:** `LobbyClientMessage`/`LobbyServerMessage` (Task 1) are the exact
  shapes the DO (Task 2) and client (Task 5) send/handle; `ChatEntry` is imported from
  `types.ts` in all three. Error codes `need_name`/`slow_down` match across DO, client, tests.
- **loc-ratchet:** app.js gains ~15 lines (rename is net-zero; new logic lives in
  `live.js`); worker.ts gains ~25. Both stay under caps (Task 4/6 verify).
