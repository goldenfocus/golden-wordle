import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { arenaRowProps, arenaEmptyState, pickNextGame, seatLabel, isHot, nextPollMs, renderYourTableRow } from "../public/arena-panel.js";
import { compactRowProps } from "../public/lobby-view.js";

const game = {
  routePath: "/@arena/maya-0",
  name: "Maya's room",
  host: "Maya",
  personaIcon: "🦊",
  edition: "default",
  wordLength: 5,
  seats: "1/2",
};

describe("arenaRowProps (F1)", () => {
  it("maps an OpenGame to row props", () => {
    expect(arenaRowProps(game)).toMatchObject({
      routePath: "/@arena/maya-0",
      avatar: "🦊",
      host: "Maya",
      wordLength: 5,
      seats: "1/2",
      edition: "default",
    });
  });
});

describe("arenaEmptyState (F2)", () => {
  it("null games → loading", () => {
    expect(arenaEmptyState(null, false)).toBe("loading");
  });
  it("isError → error (even with stale games)", () => {
    expect(arenaEmptyState([game], true)).toBe("error");
    expect(arenaEmptyState(null, true)).toBe("error");
  });
  it("empty array → empty", () => {
    expect(arenaEmptyState([], false)).toBe("empty");
  });
  it("non-empty array → list", () => {
    expect(arenaEmptyState([game], false)).toBe("list");
  });
});

describe("seatLabel (F4)", () => {
  it("returns the seats string", () => {
    expect(seatLabel({ seats: "4/5" })).toBe("4/5");
  });
  it("defaults to 1/2 when seats are missing", () => {
    expect(seatLabel({})).toBe("1/2");
    expect(seatLabel(null)).toBe("1/2");
  });
});

describe("isHot (F5) — FOMO highlight for near-full rooms", () => {
  it("true when exactly one seat remains", () => {
    expect(isHot({ seats: "4/5" })).toBe(true);
    expect(isHot({ seats: "5/6" })).toBe(true);
  });
  it("false with two or more seats free", () => {
    expect(isHot({ seats: "1/6" })).toBe(false);
    expect(isHot({ seats: "3/5" })).toBe(false);
  });
  it("false when full (about to vanish, not joinable)", () => {
    expect(isHot({ seats: "5/5" })).toBe(false);
  });
  it("false for malformed/missing seats", () => {
    expect(isHot({})).toBe(false);
    expect(isHot({ seats: "??" })).toBe(false);
  });
});

describe("pickNextGame (F3) — the 'Join next game' target", () => {
  const maya = { routePath: "/@arena/maya-0", host: "Maya" };
  const yan = { routePath: "/@yan/abcd", host: "yan" };
  const wurdl = { routePath: "/@arena/wurdl-2", host: "wurdl" };

  it("returns the first game that isn't the room just played", () => {
    expect(pickNextGame([maya, yan, wurdl], "/@arena/maya-0")).toBe("/@yan/abcd");
  });
  it("returns the first game when the current room isn't in the list", () => {
    expect(pickNextGame([maya, yan], "/@someone/gone")).toBe("/@arena/maya-0");
  });
  it("returns null when the only open game is the room just played", () => {
    expect(pickNextGame([maya], "/@arena/maya-0")).toBe(null);
  });
  it("returns null for an empty list", () => {
    expect(pickNextGame([], "/@arena/maya-0")).toBe(null);
  });
  it("returns null defensively for null/undefined games", () => {
    expect(pickNextGame(null, "/@arena/maya-0")).toBe(null);
    expect(pickNextGame(undefined, "/@arena/maya-0")).toBe(null);
  });
});

describe("nextPollMs (F6) — adaptive poll while the list is empty", () => {
  it("a populated list polls at the relaxed cadence", () => {
    expect(nextPollMs("list", false)).toBe(8000);
    expect(nextPollMs("list", true)).toBe(8000);
  });
  it("standalone arena with nothing tappable polls fast (empty/loading/error)", () => {
    expect(nextPollMs("empty", false)).toBe(2000);
    expect(nextPollMs("loading", false)).toBe(2000);
    expect(nextPollMs("error", false)).toBe(2000);
  });
  it("the in-room lobby rail never fast-polls (it lives for minutes)", () => {
    expect(nextPollMs("empty", true)).toBe(8000);
    expect(nextPollMs("error", true)).toBe(8000);
  });
});

describe("compact floor row", () => {
  it("row props carry a letters×rows board dimension (rows = smart default tries)", () => {
    const p = compactRowProps({ routePath: "/@m/x", personaIcon: "🦊", host: "maya", wordLength: 6, seats: "2/4", edition: "default" });
    expect(p.tries).toBe(7);
    expect(p.dim).toBe("6×7");
  });
});

describe("rail pill count plumbing", () => {
  const src = readFileSync(new URL("../public/arena-panel.js", import.meta.url), "utf8");
  it("mountArenaList reports the visible count via onCount", () => {
    expect(src).toContain("onCount");
    expect(src).toContain("onCount(state === \"list\" ? visible.length : 0)");
  });
  it("the redundant 'N open' line inside the list is gone (iter3 §1)", () => {
    expect(src).not.toContain("arena-count");
  });
});

describe("renderYourTableRow (pinned 'Your table' rail row, iter3 §1)", () => {
  // The renderer only assigns el.innerHTML, so a bare object stands in for the mount node.
  it("renders a non-navigating row in the arena-row shape", () => {
    const el = { innerHTML: "" };
    renderYourTableRow(el, { avatar: "P", host: "Your table", dim: "5×6", seats: "2/3" });
    expect(el.innerHTML).toContain("Your table");
    expect(el.innerHTML).toContain("5×6");
    expect(el.innerHTML).toContain("2/3");
    expect(el.innerHTML).toContain("your-table");
    expect(el.innerHTML).not.toContain("<button"); // you're already here — nothing to tap
  });
  it("re-render replaces the row (ticks on every snapshot)", () => {
    const el = { innerHTML: "" };
    renderYourTableRow(el, { avatar: "P", host: "Your table", dim: "5×6", seats: "1/2" });
    renderYourTableRow(el, { avatar: "P", host: "Your table", dim: "5×6", seats: "1/3" });
    expect(el.innerHTML).toContain("1/3");
    expect(el.innerHTML).not.toContain("1/2");
  });
  it("tolerates a missing mount node", () => {
    expect(() => renderYourTableRow(null, { avatar: "P", host: "x", dim: "5×6", seats: "1/2" })).not.toThrow();
  });
  it("null props CLEAR the mount — challenge lobbies / teardown must not leak a stale row", () => {
    const el = { innerHTML: "" };
    renderYourTableRow(el, { avatar: "P", host: "Your table", dim: "5×6", seats: "2/3" });
    renderYourTableRow(el, null);
    expect(el.innerHTML).toBe(""); // .lobby-rail-you:empty CSS then hides the mount
  });
});

describe("count surfaces once per viewport (iter3 §1 review fixes)", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  it("the lobby rail's onCount feeds BOTH the mobile pill and the desktop title count", () => {
    expect(app).toContain("#lobbyRailPillCount");
    expect(app).toContain("#lobbyRailTitleCount");
    expect(html).toContain('id="lobbyRailTitleCount"');
  });
  it("the standalone Live title carries the open count (the in-list line is gone)", () => {
    expect(app).toContain("liveTitleCount");
  });
  it("teardown AND the challenge path clear the pinned Your-table row (stale-row leak)", () => {
    // Both call renderYourTableRow(..., null): teardownLobbyRail on leaving the lobby
    // phase/room, and mountLobbyRailIfNeeded's challenge branch (rail is static DOM).
    const clears = app.match(/renderYourTableRow\(\$\("#lobbyRailYou"\), null\)/g) || [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });
});
