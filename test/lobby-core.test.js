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
