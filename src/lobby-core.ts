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
