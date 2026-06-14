import { describe, it, expect } from "vitest";
import { decodeGridToMasks, dailyAnswerOf, dailyShareModel, buildDailyShareLink } from "/daily-share-core.js";

// The wr.dailySolve:<date> payload shape, written by daily-recover.js encodeLocalSolve:
//   { won, guesses, words: ["SLATE","CRANE"], grid: ["xxxyx","ggggg"] }
const WIN = {
  won: true,
  guesses: 2,
  words: ["SLATE", "CRANE"],
  grid: ["xxxyx", "ggggg"], // last row all-green → answer is CRANE
};

describe("decodeGridToMasks", () => {
  it("maps g/y/x rows to hot/warm/cold mask arrays", () => {
    expect(decodeGridToMasks(["ggggg", "yxxxx"])).toEqual([
      ["hot", "hot", "hot", "hot", "hot"],
      ["warm", "cold", "cold", "cold", "cold"],
    ]);
  });

  it("treats any unknown cell as cold (no crash on junk)", () => {
    expect(decodeGridToMasks(["g?z"])).toEqual([["hot", "cold", "cold"]]);
  });
});

describe("dailyAnswerOf", () => {
  it("returns the lowercased all-green word", () => {
    expect(dailyAnswerOf(WIN)).toBe("crane");
  });

  it("returns '' when there is no all-green row (a loss)", () => {
    const loss = { won: false, guesses: 6, words: ["SLATE"], grid: ["xxxyx"] };
    expect(dailyAnswerOf(loss)).toBe("");
  });
});

describe("dailyShareModel", () => {
  it("builds a card model when the page IS my solved daily word", () => {
    const m = dailyShareModel({ pageWord: "crane", raw: JSON.stringify(WIN) });
    expect(m).not.toBeNull();
    expect(m.won).toBe(true);
    expect(m.cols).toBe(5);
    expect(m.score).toBe("2/6");
    expect(m.masks).toHaveLength(2);
    expect(m.masks[1]).toEqual(["hot", "hot", "hot", "hot", "hot"]);
  });

  it("is case-insensitive on the page word", () => {
    expect(dailyShareModel({ pageWord: "CRANE", raw: JSON.stringify(WIN) })).not.toBeNull();
  });

  it("NEVER produces a /c/ ghost-challenge URL (the whole point)", () => {
    const m = dailyShareModel({ pageWord: "crane", raw: JSON.stringify(WIN) });
    expect(JSON.stringify(m)).not.toContain("/c/");
  });

  it("scores the denominator as min(len+1, 8): 5→/6, 7→/8, 12→/8", () => {
    const seven = { won: true, guesses: 3, words: ["xxxxxxx", "MYSTERY"], grid: ["xxxxxxx", "ggggggg"] };
    const twelve = { won: true, guesses: 4, words: ["x".repeat(12), "ABRACADABRAS"], grid: ["x".repeat(12), "g".repeat(12)] };
    expect(dailyShareModel({ pageWord: "mystery", raw: JSON.stringify(seven) }).score).toBe("3/8");
    expect(dailyShareModel({ pageWord: "abracadabras", raw: JSON.stringify(twelve) }).score).toBe("4/8");
  });

  it("returns null when this page is NOT the daily word I solved", () => {
    expect(dailyShareModel({ pageWord: "slate", raw: JSON.stringify(WIN) })).toBeNull();
  });

  it("returns null on a loss (no all-green row to match)", () => {
    const loss = { won: false, guesses: 6, words: ["SLATE"], grid: ["xxxyx"] };
    expect(dailyShareModel({ pageWord: "crane", raw: JSON.stringify(loss) })).toBeNull();
  });

  it("returns null on empty / malformed raw", () => {
    expect(dailyShareModel({ pageWord: "crane", raw: null })).toBeNull();
    expect(dailyShareModel({ pageWord: "crane", raw: "" })).toBeNull();
    expect(dailyShareModel({ pageWord: "crane", raw: "{not json" })).toBeNull();
    expect(dailyShareModel({ pageWord: "crane", raw: "{}" })).toBeNull();
  });
});

describe("buildDailyShareLink", () => {
  const O = "https://wordul.com";

  it("pins the URL to the GIVEN day, never today (the whole bug)", () => {
    // Sender solved 2026-06-09; this must NOT become a friend's own todayUTC().
    const { url } = buildDailyShareLink({ origin: O, date: "2026-06-09", result: { won: true, guesses: 4 } });
    expect(url.startsWith("https://wordul.com/daily/2026-06-09")).toBe(true);
  });

  it("appends a colors-only ?g= board decoded from a g/y/x solveGrid", () => {
    const { url } = buildDailyShareLink({
      origin: O, date: "2026-06-09",
      result: { won: true, guesses: 2, solveGrid: ["yxxxx", "ggggg"] },
    });
    expect(url).toBe("https://wordul.com/daily/2026-06-09?g=wcccc-hhhhh");
  });

  it("uses result.masks directly when present (in-game Dare share path)", () => {
    const { url } = buildDailyShareLink({
      origin: O, date: "2026-06-09",
      result: { won: true, guesses: 1, masks: [["hot", "hot", "hot", "hot", "hot"]] },
    });
    expect(url).toBe("https://wordul.com/daily/2026-06-09?g=hhhhh");
  });

  it("omits ?g= when there's no board to encode (non-5-wide or absent)", () => {
    expect(buildDailyShareLink({ origin: O, date: "2026-06-09", result: { won: true, guesses: 3 } }).url)
      .toBe("https://wordul.com/daily/2026-06-09");
    expect(buildDailyShareLink({ origin: O, date: "2026-06-09", result: { won: true, guesses: 3, solveGrid: ["ggggggg"] } }).url)
      .toBe("https://wordul.com/daily/2026-06-09");
  });

  it("brags spoiler-free: the line never contains the answer word", () => {
    const win = buildDailyShareLink({ origin: O, date: "2026-06-09", result: { won: true, guesses: 4, solveGrid: ["xxxxx", "ggggg"] } });
    expect(win.line).toBe("I got this Wordul in 4 — I dare you.");
    const loss = buildDailyShareLink({ origin: O, date: "2026-06-09", result: { won: false, guesses: 6 } });
    expect(loss.line).toBe("This Wordul beat me — I dare you to avenge me.");
  });
});
