// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHub, homeTypeLetter } from "../public/hub.js";
import { fmtDuration } from "../public/daily-card.js";
import { featuredWorlds } from "../public/worlds.js";

// Minimal DOM the hub render touches (topbar stat glyphs + the mount points).
function setupDom() {
  document.body.innerHTML = `
    <span id="hubGoldVal"></span>
    <span id="hubStreak" hidden><span id="hubStreakVal"></span></span>
    <div id="hub" hidden><main id="hubContent"></main></div>`;
}

function makeCallbacks(over = {}) {
  return {
    username: "yan",
    editions: [{ id: "default" }, { id: "tactile" }, { id: "arcade" }],
    editionName: (id) => ({ tactile: "Tactile", arcade: "Arcade" }[id] || id),
    onPlay: vi.fn(),
    onSolo: vi.fn(),
    onPvP: vi.fn(),
    onArena: vi.fn(),
    onStats: vi.fn(),
    onShareDaily: vi.fn(),
    onWorld: vi.fn(),
    onBrowseWorlds: vi.fn(),
    fetchPlayed: () => Promise.resolve(null),
    renderRecentRooms: () => {},
    ...over,
  };
}

describe("hub home (redesign)", () => {
  beforeEach(() => setupDom());

  it("renders the new daily card with identity on top — and NO emoji", () => {
    renderHub({ gold: 0, stats: { currentStreak: 0 } }, makeCallbacks());
    const html = document.getElementById("hubContent").innerHTML;
    expect(document.getElementById("dailyCard")).toBeTruthy();
    expect(document.querySelector(".daily-head .daily-kicker")).toBeTruthy();
    expect(document.getElementById("modeSolo")).toBeTruthy();
    expect(document.getElementById("modePvP")).toBeTruthy();
    expect(document.getElementById("modeArena")).toBeTruthy(); // Arena is back, third tile
    expect(document.getElementById("dailyStats")).toBeTruthy();
    // No instructional copy, no OS emoji on this surface.
    expect(html).not.toMatch(/start typing/i);
    expect(html).not.toMatch(/[⚡\u{1F465}\u{1F4CA}▶]/u); // ⚡ 👥 📊 ▶
  });

  it("mode tiles show an icon + a small word label and each routes to its mode", () => {
    const cb = makeCallbacks();
    renderHub({}, cb);
    // Icon + catchy micro-label: Solo · Duel · Arena.
    const labels = { modeSolo: "Solo", modePvP: "Duel", modeArena: "Arena" };
    for (const [id, word] of Object.entries(labels)) {
      const tile = document.getElementById(id);
      expect(tile.getAttribute("aria-label")).toBeTruthy();
      expect(tile.querySelector(".mode-name").textContent.trim()).toBe(word);
    }
    document.getElementById("modeSolo").click();
    document.getElementById("modePvP").click();
    document.getElementById("modeArena").click();
    expect(cb.onSolo).toHaveBeenCalledTimes(1);
    expect(cb.onPvP).toHaveBeenCalledTimes(1);
    expect(cb.onArena).toHaveBeenCalledTimes(1);
  });

  it("tap plays today's word; Stats goes to its own page (not the card)", () => {
    const cb = makeCallbacks();
    renderHub({}, cb);
    document.getElementById("dailyCard").click();
    expect(cb.onPlay).toHaveBeenCalledTimes(1);
    expect(cb.onPlay.mock.calls[0][1]).toBeUndefined(); // tap = no seed

    cb.onPlay.mockClear();
    document.getElementById("dailyStats").click();
    expect(cb.onStats).toHaveBeenCalledTimes(1);
    expect(cb.onPlay).not.toHaveBeenCalled(); // stopPropagation: card didn't also fire
  });

  it("type-to-play seeds the board with the typed letter", () => {
    const cb = makeCallbacks();
    renderHub({}, cb);
    homeTypeLetter("G");
    expect(cb.onPlay).toHaveBeenCalledTimes(1);
    expect(cb.onPlay.mock.calls[0][1]).toBe("G");
  });

  it("fills a real played count when one arrives, else stays 'Stats'", async () => {
    renderHub({}, makeCallbacks({ fetchPlayed: () => Promise.resolve(1248) }));
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById("dailyStatsLabel").textContent).toBe("1,248 played");
  });

  it("after you've played today, shows the post-play recap — result + countdown + Share + 'Today's stats', no play card", () => {
    const cb = makeCallbacks({ dailyResult: { won: true, guesses: 4 } });
    renderHub({}, cb);
    expect(document.getElementById("dailyCard")).toBeNull();           // no replay surface
    expect(document.querySelector(".daily-done")).toBeTruthy();
    expect(document.querySelector(".daily-result-text").textContent).toMatch(/Solved in 4/);
    expect(document.getElementById("dailyCountdown")).toBeTruthy();
    expect(document.getElementById("dailyStats")).toBeNull();

    // ◆ Dare ◆ — the spoiler-safe recap share (dated link, never names the answer) routes
    // through onShareDaily, which builds the frozen /daily/<date> link.
    const dare = document.getElementById("dailyCardDare");
    expect(dare).toBeTruthy();
    dare.click();
    expect(cb.onShareDaily).toHaveBeenCalledTimes(1);

    // The "see everyone" chevron replaces Stats — it routes through onStats.
    document.getElementById("dailySeeAll").click();
    expect(cb.onStats).toHaveBeenCalledTimes(1);

    // Typing must NOT start a game once today's done.
    homeTypeLetter("G");
    expect(cb.onPlay).not.toHaveBeenCalled();
  });

  it("a loss reads calmly ('Missed today'), still no play card", () => {
    renderHub({}, makeCallbacks({ dailyResult: { won: false, guesses: 6 } }));
    expect(document.getElementById("dailyCard")).toBeNull();
    expect(document.querySelector(".daily-result.is-lost")).toBeTruthy();
    expect(document.querySelector(".daily-result-text").textContent).toMatch(/Missed today/);
  });

  it("when a solve grid is present, the board IMAGE is the hero — no text result line", () => {
    renderHub({}, makeCallbacks({
      dailyResult: { won: true, guesses: 2, solveGrid: ["xyxxg", "ggggg"], solveWords: ["SLATE", "GRAPE"] },
    }));
    const hero = document.querySelector(".daily-stamp-hero");
    expect(hero).toBeTruthy();
    expect(hero.getAttribute("aria-label")).toBe("Solved in 2");   // result conveyed to AT
    expect(document.querySelector(".daily-result-text")).toBeNull(); // no duplicate text line
    expect(document.querySelector(".daily-stamp.has-letters")).toBeTruthy();
    // The real letters render inside the stamp tiles.
    const letters = [...document.querySelectorAll(".stamp-ch")].map((e) => e.textContent).join("");
    expect(letters).toBe("SLATEGRAPE");
  });

  it("leaderboard row swap: viewer's row is selected by default; clicking another row swaps featured card", async () => {
    const onProfile = vi.fn();
    renderHub({}, makeCallbacks({
      username: "yan",
      dailyResult: { won: true, guesses: 4, solveGrid: ["ggggg"], solveWords: ["GRAPE"] },
      fetchLeaderboard: () => Promise.resolve({
        top: [
          { username: "yan", gold: 128, guesses: 4, won: true, grid: ["ggggg"], durationMs: 134000 },
          { username: "ada", gold: 120, guesses: 5, won: true, grid: ["yxxxg", "ggggg"], durationMs: 95000 },
        ],
        you: null, total: 2,
      }),
      onProfile,
    }));
    // Let fetchLeaderboard promise + .then() resolve.
    await new Promise((r) => setTimeout(r, 0));

    // Viewer's row should be selected by default.
    const yanRow = document.querySelector('[data-user="yan"]');
    const adaRow = document.querySelector('[data-user="ada"]');
    expect(yanRow).toBeTruthy();
    expect(adaRow).toBeTruthy();
    expect(yanRow.classList.contains("is-selected")).toBe(true);
    expect(adaRow.classList.contains("is-selected")).toBe(false);

    // Clicking ada's row swaps the featured card and moves is-selected.
    adaRow.click();
    expect(adaRow.classList.contains("is-selected")).toBe(true);
    expect(yanRow.classList.contains("is-selected")).toBe(false);
    expect(document.getElementById("dailyFeatured").innerHTML).toContain("@ada");

    // Clicking the @name link inside a row calls onProfile and does NOT change selection.
    const adaLink = adaRow.querySelector("a[data-profile]");
    expect(adaLink).toBeTruthy();
    adaLink.click();
    expect(onProfile).toHaveBeenCalledWith("ada");
    // Row selection unchanged — stopPropagation prevented the row swap.
    expect(adaRow.classList.contains("is-selected")).toBe(true);
    expect(yanRow.classList.contains("is-selected")).toBe(false);
  });
  it("renders a Worlds strip with a card per featured World + a Browse-all card", () => {
    const cb = makeCallbacks();
    renderHub({ gold: 0, stats: { currentStreak: 0 } }, cb);
    const strip = document.getElementById("worldsStrip");
    expect(strip).toBeTruthy();
    // `.world-card:not(.world-card-more)` counts only the per-World themed cards,
    // excluding the "Browse all →" card which also carries .world-card for Task 7 CSS.
    const cards = strip.querySelectorAll(".world-card:not(.world-card-more)");
    expect(cards.length).toBe(featuredWorlds().length);
    expect(document.getElementById("worldsBrowseAll")).toBeTruthy();

    // Clicking the first themed World card routes through onWorld with its slug.
    cards[0].click();
    expect(cb.onWorld).toHaveBeenCalledTimes(1);
    expect(cb.onWorld).toHaveBeenCalledWith(featuredWorlds()[0].slug);

    // Clicking "Browse all →" routes through onBrowseWorlds.
    document.getElementById("worldsBrowseAll").click();
    expect(cb.onBrowseWorlds).toHaveBeenCalledTimes(1);
  });
});

describe("fmtDuration", () => {
  it("formats null/sub-second/seconds/minutes/hours", () => {
    expect(fmtDuration(null)).toBe("");
    expect(fmtDuration(undefined)).toBe("");
    expect(fmtDuration(500)).toBe("<1s");
    expect(fmtDuration(47000)).toBe("47s");
    expect(fmtDuration(134000)).toBe("2m 14s");
    expect(fmtDuration(120000)).toBe("2m");
    expect(fmtDuration(3780000)).toBe("1h 3m");
    expect(fmtDuration(3600000)).toBe("1h");
  });
});
