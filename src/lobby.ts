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
