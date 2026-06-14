// public/daily-share-core.js — pure helpers for the DAILY result share, unit-tested in
// test/daily-share-core.test.js (the share-card.js / ghost-replay.js pattern). The daily
// is a shared, blind, leaderboard-scored word — NOT a personal ghost duel — so its share
// is a result card linking to /daily/<date>, never a /c/<id> ghost challenge. These take
// only the page's word + the browser's own `wr.dailySolve:<date>` JSON, so the match is
// spoiler-safe: only the solver's own browser holds the grid and the answer.

// "g"/"y"/"x" color-letters → the hot/warm/cold masks share-card.js draws.
import { masksToGiftPattern } from "/share-links.js";

const CELL = { g: "hot", y: "warm", x: "cold" };
export function decodeGridToMasks(grid) {
  return (grid ?? []).map((row) => [...String(row)].map((ch) => CELL[ch] ?? "cold"));
}

// The all-green row's word, lowercased — the daily word THIS browser solved. "" on a loss
// (no all-green row) or a malformed solve. This is the spoiler-safe "is this my daily" key.
export function dailyAnswerOf(solve) {
  const grid = solve?.grid;
  const words = solve?.words;
  if (!Array.isArray(grid) || !Array.isArray(words)) return "";
  const i = grid.findIndex((row) => typeof row === "string" && row.length > 0 && /^g+$/.test(row));
  return i >= 0 && typeof words[i] === "string" ? words[i].toLowerCase() : "";
}

// Mirrors guessesFor() in src/room-core.ts: length+1, capped at 8 rows.
function maxRowsFor(len) {
  return Math.min(len + 1, 8);
}

// Build a daily result-card model from this browser's solve, but ONLY when `pageWord` is
// the daily word I actually solved. Returns null otherwise (archived word, a loss, no
// solve, or junk) so the caller falls back to its generic behavior. No URL lives in the
// model — the caller builds the /daily/<date> link — so this can never carry a /c/ ghost.
export function dailyShareModel({ pageWord, raw }) {
  if (!raw) return null;
  let solve;
  try { solve = JSON.parse(raw); } catch { return null; }
  const answer = dailyAnswerOf(solve);
  if (!answer || answer !== String(pageWord ?? "").toLowerCase()) return null;
  const masks = decodeGridToMasks(solve.grid);
  if (!masks.length) return null;
  const cols = masks[0].length;
  const max = maxRowsFor(cols);
  const guesses = Number.isInteger(solve.guesses) ? solve.guesses : masks.length;
  return { won: solve.won === true, score: `${guesses}/${max}`, masks, cols };
}

// The daily share link + brag line, PINNED to the exact day being shared. `date` is the
// puzzle's own date (the day you solved / the carousel's viewed day) — never "today" —
// so a friend who opens it after the UTC rollover, or from another timezone, still lands
// on the SAME puzzle. (The bug this fixes: a date-less link resolves to the opener's own
// "today", handing them a different word.) The optional ?g=<colors> pattern — from the
// run's masks, or decoded from a g/y/x solveGrid — makes the OG unfurl show the board with
// letters hidden, so the link stays spoiler-free by construction.
export function buildDailyShareLink({ origin, date, result }) {
  const masks = result && Array.isArray(result.masks)
    ? result.masks
    : (result && result.solveGrid ? decodeGridToMasks(result.solveGrid) : null);
  const pattern = masksToGiftPattern(masks);
  const url = `${origin}/daily/${date}${pattern ? `?g=${pattern}` : ""}`;
  const line = result && result.won
    ? `I got this Wordul in ${result.guesses} — I dare you.`
    : "This Wordul beat me — I dare you to avenge me.";
  return { url, line };
}
