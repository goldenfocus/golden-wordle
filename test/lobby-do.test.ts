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
    webSocketError: (ws: WebSocket) => Promise<void>;
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
    await lobby.webSocketMessage(a, JSON.stringify({ type: "chat", text: "  he\x01llo  " }));
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

  it("on error (abnormal drop), recomputes presence like close", async () => {
    const { lobby, sockets } = makeLobby();
    const a = mockWs("alice"); const b = mockWs("bob");
    sockets.push(a, b);
    await lobby.webSocketError(a);
    expect((b as any)._sent).toContainEqual({ type: "online", n: 1 });
  });
});
