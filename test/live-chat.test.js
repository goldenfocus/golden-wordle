// @vitest-environment jsdom
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
