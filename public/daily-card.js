// public/daily-card.js — the heart of the home: today's Wordul as one calm card.
// Two states, one surface:
//   • play invitation — a 5-tile row you tap (or just start typing) to bloom into
//     the board; a quiet Stats chip.
//   • post-play recap — once you've finished today: your result, a live countdown
//     to the next word, and Share / Stats. No replay teleport.
// The shell (hub.js) supplies the header + modes; this file owns the card.
import { GLYPH } from "/hub-glyphs.js";
import { autoPlayStampOnce, playStampReplay } from "/stamp-replay.js";

function escAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, ""); } // usernames are [a-z0-9_-]

// Format a solve duration. null/undefined → "" (caller omits the chip). A genuine
// sub-second solve reads "<1s" rather than a confusing "0s".
export function fmtDuration(ms) {
  if (ms == null) return "";
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

// "The precious" — a small struck gold coin. Inline fills (no gradient <defs>, so it
// repeats safely down the list); the soft glow lives in CSS.
const COIN = `<svg class="wcoin" viewBox="0 0 24 24" aria-hidden="true">` +
  `<circle cx="12" cy="12" r="9" fill="#e9b23d"/>` +
  `<circle cx="12" cy="12" r="9" fill="none" stroke="#ffe7a3" stroke-width="1.3" stroke-opacity=".7"/>` +
  `<circle cx="12" cy="12" r="5.4" fill="none" stroke="#8a6314" stroke-width="1.1" stroke-opacity=".65"/>` +
  `<path d="M12 8.85l.93 1.88 2.07.3-1.5 1.46.35 2.06L12 14.64l-1.85.97.35-2.06-1.5-1.46 2.07-.3z" fill="#fff3cf" fill-opacity=".85"/>` +
  `</svg>`;

// A struck podium medallion (1/2/3) with a serif numeral — luxe, never an OS emoji.
// Per-rank flat metal so the SVG repeats without colliding gradient ids.
const MEDAL_PAL = {
  1: { a: "#ffe7a3", b: "#e9b23d", c: "#a87a1f", ink: "#3a2a07" }, // gold ("the precious")
  2: { a: "#f4f7fb", b: "#c3ccd9", c: "#8b95a6", ink: "#2c313a" }, // silver
  3: { a: "#f6cda0", b: "#cf8a44", c: "#8a5320", ink: "#3a230c" }, // bronze
};
export function medalGlyph(rank) {
  const p = MEDAL_PAL[rank];
  if (!p) return `#${rank}`;
  return `<svg class="wmedal wmedal-${rank}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="9.2" fill="${p.b}"/>` +
    `<circle cx="12" cy="12" r="9.2" fill="none" stroke="${p.a}" stroke-width="1.4" stroke-opacity=".8"/>` +
    `<circle cx="12" cy="12" r="6.4" fill="none" stroke="${p.c}" stroke-width="1" stroke-opacity=".6"/>` +
    `<text x="12" y="12.3" text-anchor="middle" dominant-baseline="central" font-family="Fraunces, Georgia, serif" font-size="10.5" font-weight="700" fill="${p.ink}">${rank}</text>` +
    `</svg>`;
}

// A gold value: number + coin. Warm-gold styling lives in CSS.
export function goldValue(n) { return `${Number(n).toLocaleString()}${COIN}`; }

// A crystallized stamp of a solved board: one tiny glass tile per cell, mirroring the
// real board's precious-gold / champagne / obsidian treatment. grid is an array of row
// strings ("g"=correct, "y"=present, "x"=absent). words (optional) are the actual guessed
// words — shown ONLY when present. Words reach here from your own local solve, or from the
// /leaderboard board AFTER it's been unlocked by a finisher token; either way a still-playing
// viewer never receives them, so today's answer can't leak. Empty → nothing.
const STAMP_CLS = { g: "is-correct", y: "is-present", x: "is-absent" };
function escLetter(c) { return String(c || "").replace(/[^a-zA-Z]/g, ""); }
// Rows a board has for a given word length — mirrors the server's guessesFor (room.ts):
// length+1, capped at 8 (5-letter → 6). Used to pad every featured stamp to a FULL board so
// the frame is the same height for a solve-in-3 and a miss-in-6 (no resize when swapping).
export function boardRows(wordLength) { return Math.min((wordLength || 5) + 1, 8); }
// minRows pads the stamp up to a constant height with faint empty rows. Default 0 = no pad
// (profile letter-cards call it that way, so they're untouched).
export function renderStamp(grid, words, minRows = 0) {
  if (!Array.isArray(grid) || grid.length === 0) return "";
  const hasLetters = Array.isArray(words) && words.length > 0;
  const cols = String(grid[0] ?? "").length || 5;
  const rows = grid.map((r, ri) => {
    const w = hasLetters ? String(words[ri] || "") : "";
    return `<div class="stamp-row">${[...String(r)].map((ch, ci) =>
      `<span class="stamp-cell ${STAMP_CLS[ch] || "is-absent"}">${w[ci] ? `<span class="stamp-ch">${escLetter(w[ci])}</span>` : ""}</span>`).join("")}</div>`;
  });
  // Pad to a constant board height: empty rows are faint, glyph-less shells the same size as
  // played cells (sized in CSS), so every player's stamp is one fixed frame.
  const pad = Math.max(0, minRows - grid.length);
  if (pad > 0) {
    const emptyRow = `<div class="stamp-row">${`<span class="stamp-cell is-empty"></span>`.repeat(cols)}</div>`;
    for (let i = 0; i < pad; i++) rows.push(emptyRow);
  }
  return `<div class="daily-stamp${hasLetters ? " has-letters" : ""}" role="button" tabindex="0" aria-label="Play replay" title="Play replay">${rows.join("")}</div>`;
}

// The featured card at the top of the post-play recap. For YOU, render your OWN board WITH
// letters (yourGrid + yourWords, from this browser's own solve) — the "precious" hero — +
// a "Solved in N · 2m 14s" caption. For anyone else, render their server color grid with NO
// letters + an "@name · #rank · gold · in N · time" stat line. Letters are never shown for
// another player (the public leaderboard never ships today's words — see Privacy in the spec).
function renderFeaturedCard(entry, { isYou, yourGrid, yourWords, rank }) {
  const won = !!entry.won;
  // Render real letters whenever we legitimately have them, keeping grid+words parallel:
  //   • YOU: your own local solve first (always available same-browser); else the server's
  //     gated words for your row (covers a fresh browser that holds today's finisher token).
  //   • OTHERS: entry.words is present ONLY when the server unlocked it for a finisher — so
  //     letters appear once you've solved, and the public payload stays color-only.
  const hasLocal = isYou && Array.isArray(yourWords) && yourWords.length > 0;
  const gridRows = hasLocal && yourGrid && yourGrid.length ? yourGrid : entry.grid;
  const wordRows = hasLocal ? yourWords : entry.words;
  // Pad to the full board (constant frame across every player you can swap to).
  const cols = Array.isArray(gridRows) && gridRows[0] ? String(gridRows[0]).length : 5;
  const grid = renderStamp(gridRows, wordRows, boardRows(cols));
  const dur = fmtDuration(entry.durationMs);
  if (isYou) {
    const verb = won ? `Solved in ${entry.guesses}` : "Missed today";
    const cap = dur ? `${verb} · ${dur}` : verb;
    return `${grid}<div class="daily-featured-cap">${cap}</div>`;
  }
  const u = escAttr(entry.username);
  const bits = [
    `<a class="daily-featured-name" href="/@${u}" data-profile="${u}">@${u}</a>`,
    `<span class="daily-featured-rank">#${rank}</span>`,
    `<span class="daily-featured-gold">${goldValue(entry.gold)}</span>`,
    `<span class="daily-featured-guesses">${won ? `in ${entry.guesses}` : "missed"}</span>`,
  ];
  if (dur) bits.push(`<span class="daily-featured-time">${dur}</span>`);
  return `${grid}<div class="daily-featured-cap is-other">${bits.join("")}</div>`;
}

// Result column shared by every leaderboard row: solved → "in N"; gave up → skull
// (forfeit, 0 gold); ran out of guesses → cross. Luxe currentColor glyphs (never
// emoji), themed by class in CSS.
export function resultMark(entry) {
  return entry.won
    ? `in ${entry.guesses}`
    : entry.resigned
      ? `<span class="daily-top-mark is-quit" role="img" aria-label="gave up" title="gave up">${GLYPH.skull}</span>`
      : `<span class="daily-top-mark is-out" role="img" aria-label="ran out of guesses" title="ran out of guesses">${GLYPH.cross}</span>`;
}

// One roster row — the SAME vocabulary on every after-the-word surface (golden card,
// Show-all roster, day Stats page): medal/#N · @name · gold · result. Your own row is
// marked .is-you (outline + accented name in CSS) — never a "you (@name)" prefix, and
// never an inline time, so the row can't wrap. Duration lives in the replay modal.
export function rosterRow(e, me) {
  const u = escAttr(e.username);
  const mine = u === escAttr(me);
  return `<li class="daily-top-row${mine ? " is-you" : ""}" data-user="${u}">
    <span class="daily-top-rank" aria-hidden="true">${e.rank <= 3 ? medalGlyph(e.rank) : `#${e.rank}`}</span>
    <a class="daily-top-name" href="/@${u}" data-profile="${u}">@${u}</a>
    <span class="daily-top-gold">${goldValue(e.gold)}</span>
    <span class="daily-top-guesses">${resultMark(e)}</span>
  </li>`;
}

// Build the leaderboard HTML from a LeaderboardView ({ top, you, total }) and the
// viewer's own username. Top-3 medal rows; your medal row gets .is-you; if you're
// outside the top, a pinned row with your real rank — always shown ("celebrate you").
export function renderLeaderboard(view, me) {
  if (!view || !Array.isArray(view.top) || view.top.length === 0) return "";
  const row = (entry, rank, opts = {}) => {
    const u = escAttr(entry.username);
    const badge = opts.pinned ? `#${rank}` : medalGlyph(rank);
    const mine = u === escAttr(me);
    return `<li class="daily-top-row${mine ? " is-you" : ""}${opts.pinned ? " is-pinned" : ""}" data-user="${u}">
      <span class="daily-top-rank" aria-hidden="true">${badge}</span>
      <a class="daily-top-name" href="/@${u}" data-profile="${u}">@${u}</a>
      <span class="daily-top-gold">${goldValue(entry.gold)}</span>
      <span class="daily-top-guesses">${resultMark(entry)}</span>
    </li>`;
  };
  const medals = view.top.map((e, i) => row(e, i + 1)).join("");
  // Outside the top 3, your own row is pinned below (with rank + gold + guesses) — so the
  // header carries only the day's stat, no duplicate "you #N". In the top 3, your medal
  // row already highlights you. #dailyPlayed is filled async (real count).
  const pinned = view.you ? `<li class="daily-top-sep" aria-hidden="true"></li>${row(view.you, view.you.rank, { pinned: true })}` : "";
  // Discoverability: the row-tap-to-preview interaction is invisible on touch (no hover/
  // cursor), so spell it out once there's actually someone else to swap to.
  const others = view.top.length + (view.you ? 1 : 0) > 1;
  const hint = others
    ? `<p class="daily-top-hint">Tap a player to preview their board · <b>@name</b> opens their profile</p>`
    : "";
  return `<div class="daily-top-head"><span class="section-label">Today's Top</span>` +
    `<span class="daily-top-stat"><span id="dailyPlayed"></span></span></div>` +
    `<ul class="daily-top-list">${medals}${pinned}</ul>${hint}`;
}

// The daily wears the base Wordul theme unless the day is configured otherwise —
// the authoritative edition arrives in the room snapshot (a curated World from the
// Studio). No client-side rotation: starting the WOTD expands the home page in
// place instead of cutting to a randomly-skinned screen. (Signature kept for callers.)
export function dayTheme(_date, _editionIds) {
  return "default";
}

// ── Countdown to the next Wordul (UTC midnight, mirroring server activeDate()) ──
function msToNextDaily(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}
function fmtCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

let countdownTimer = null;
function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}
function startCountdown() {
  stopCountdown();
  const tick = () => {
    const el = document.getElementById("dailyCountdown");
    if (!el) { stopCountdown(); return; } // home unmounted — stop ticking
    el.textContent = fmtCountdown(msToNextDaily(new Date()));
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ── Render ──────────────────────────────────────────────────────────────────
// state.result is null (not played yet) or { won: boolean, guesses: number }.
export function renderDailyCard({ themeId, result }) {
  if (result) {
    const won = !!result.won;
    const caption = won ? `Solved in ${result.guesses}` : "Missed today";
    const cols0 = Array.isArray(result.solveGrid) && result.solveGrid[0] ? String(result.solveGrid[0]).length : 5;
    const stamp = renderStamp(result.solveGrid, result.solveWords, boardRows(cols0));
    // Featured card region — JS fills it (defaults to your own card) once wired. The
    // immediate render shows your stamp so the recap never flashes empty.
    const heroInner = stamp
      ? `<div class="daily-stamp-hero ${won ? "is-won" : "is-lost"}" role="img" aria-label="${caption}">${stamp}</div>`
      : `<div class="daily-result ${won ? "is-won" : "is-lost"}">
        <span class="daily-result-mark" aria-hidden="true">${won ? GLYPH.check : GLYPH.cross}</span>
        <span class="daily-result-text">${caption}</span>
      </div>`;
    return `<article class="daily-card daily-done" data-theme="${themeId}">
      <div class="daily-featured" id="dailyFeatured">${heroInner}</div>
      <!-- ◆ Dare ◆ follows you home (spec 2026-06-09): the same spoiler-free invite/share
           as the finish screen. No board replay here, so it arrives already lit. -->
      <div class="daily-dare-wrap daily-card-dare">
        <button id="dailyCardDare" class="daily-dare is-lit" type="button" aria-label="Dare — invite a friend to today's word">◆ Dare ◆</button>
        <p class="daily-dare-sub">Invite a friend to today's word</p>
      </div>
      <section class="daily-top" id="dailyTop" hidden aria-label="Today's top players"></section>
      <div class="daily-next">
        <span class="daily-next-label">Next Wordul in</span>
        <span class="daily-countdown" id="dailyCountdown">—</span>
      </div>
      <button id="dailySeeAll" class="daily-seeall" type="button" aria-label="See today's stats and everyone who played">
        Today's stats<span class="daily-chev" aria-hidden="true">›</span>
      </button>
    </article>`;
  }
  const tiles = Array.from({ length: 5 }, (_, i) =>
    `<span class="daily-tile${i === 0 ? " is-cursor" : ""}"></span>`).join("");
  return `<article class="daily-card" id="dailyCard" data-theme="${themeId}"
           role="button" tabindex="0" aria-label="Play today's Wordul">
    <div class="daily-row" aria-hidden="true">${tiles}</div>
    <button class="daily-stats-link" id="dailyStats" type="button" aria-label="See today's stats">
      ${GLYPH.bars}<span class="daily-stats-label" id="dailyStatsLabel">Stats</span><span class="daily-chev" aria-hidden="true">›</span>
    </button>
  </article>`;
}

// ── Wire ────────────────────────────────────────────────────────────────────
// Binds the card's events for the current state. Returns { onType } — a letter
// handler the shell registers for type-to-play (a no-op once you've played today).
export function wireDailyCard({ themeId, result, username, onPlay, onStats, onShareDaily, onProfile, fetchPlayed, fetchLeaderboard }) {
  stopCountdown(); // never leave a stale timer running across re-renders

  const stats = document.getElementById("dailyStats");
  if (stats && onStats) stats.addEventListener("click", (e) => { e.stopPropagation(); onStats(); });

  // Post-play: result + gold + your stamp + ◆ Dare ◆ + Today's Top + countdown + "see all".
  // The only share is the spoiler-free Dare (masked board, never the answer word).
  if (result) {
    const seeAll = document.getElementById("dailySeeAll");
    if (seeAll && onStats) seeAll.addEventListener("click", () => onStats());
    // ◆ Dare ◆ — spoiler-free invite/share of today's word, same as the finish screen.
    // onShareDaily → shareDailyResult builds a FROZEN dated /daily/<this-day> link (never
    // today-at-click) + a colors-only ?g= board, so a friend who opens it after the UTC
    // rollover still lands on the same puzzle and the answer word never leaks.
    const dare = document.getElementById("dailyCardDare");
    if (dare && onShareDaily) dare.addEventListener("click", (e) => { e.stopPropagation(); onShareDaily(); });
    startCountdown();

    // Discovery: auto-play the recap stamp once per visit — most people never find
    // tap-to-replay on their own. Deferred until after the leaderboard swap settles
    // (setFeatured re-renders #dailyFeatured, which would cut a replay mid-flight).
    const autoReplay = () => {
      // typeof guard: this fires on a delayed timer — in jsdom tests the env can be
      // torn down before it lands, and a bare `document` then throws (flaky ship gate).
      if (typeof document === "undefined") return;
      const s = document.querySelector("#dailyFeatured .daily-stamp");
      if (s) autoPlayStampOnce(s);
    };

    // Best-effort leaderboard: fills the gold line + the board once it resolves; a
    // failure or empty board just leaves them hidden (recap still renders).
    if (fetchLeaderboard && username) {
      fetchLeaderboard(username).then((view) => {
        if (!view) return;
        const board = document.getElementById("dailyTop");
        const html = renderLeaderboard(view, username);
        if (board && html) {
          board.innerHTML = html;
          board.hidden = false;
          // Index every visible entry by username so a row tap can re-feature it.
          const entries = new Map();
          // Key by escAttr(username) to match each row's data-user (and renderLeaderboard's is-you).
          (view.top || []).forEach((e, i) => entries.set(escAttr(e.username), { entry: e, rank: i + 1 }));
          if (view.you) entries.set(escAttr(view.you.username), { entry: view.you, rank: view.you.rank });
          const featured = document.getElementById("dailyFeatured");
          const rows = Array.from(board.querySelectorAll(".daily-top-row"));
          const myWords = (result && result.solveWords) || undefined;
          const myGrid = (result && result.solveGrid) || undefined;
          const setFeatured = (name, { replay } = {}) => {
            const hit = entries.get(name);
            if (!hit || !featured) return;
            const isYou = name === escAttr(username);
            featured.innerHTML = renderFeaturedCard(hit.entry, { isYou, yourGrid: myGrid, yourWords: myWords, rank: hit.rank });
            rows.forEach((r) => r.classList.toggle("is-selected", r.getAttribute("data-user") === name));
            // A featured "other" card's @name still navigates to their profile.
            if (!isYou && onProfile) {
              const a = featured.querySelector("a[data-profile]");
              if (a) a.addEventListener("click", (e) => { e.preventDefault(); onProfile(a.getAttribute("data-profile")); });
            }
            // Deliberate row taps replay every time; the default landing card uses the
            // once-per-visit discovery autoplay instead.
            if (replay) {
              const s = featured.querySelector(".daily-stamp");
              if (s) playStampReplay(s);
            }
          };
          // Row taps swap the featured card (and replay it); the inner @name link still opens the profile.
          rows.forEach((row) => {
            const name = row.getAttribute("data-user");
            row.addEventListener("click", () => setFeatured(name, { replay: true }));
            const a = row.querySelector("a[data-profile]");
            if (a) a.addEventListener("click", (e) => {
              e.preventDefault(); e.stopPropagation();
              if (onProfile) onProfile(a.getAttribute("data-profile"));
            });
          });
          // Default the featured card to you, and mark your row selected.
          if (entries.has(escAttr(username))) setFeatured(escAttr(username));
          // Fill the real "N played" count from THIS payload's total (ranked finishers) —
          // the same number the stats page roster counts, so they can never disagree.
          const playedEl = document.getElementById("dailyPlayed");
          if (playedEl && typeof view.total === "number" && view.total > 0) {
            playedEl.textContent = `${view.total.toLocaleString()} played`;
          }
        }
      }).catch(() => {}).finally(() => setTimeout(autoReplay, 300));
    } else {
      setTimeout(autoReplay, 400); // no leaderboard to wait for — play on the initial stamp
    }
    return { onType: () => {} };
  }

  // Play invitation: tap / Enter / Space / start-typing all bloom into the board.
  const card = document.getElementById("dailyCard");
  const play = (seed) => { if (onPlay) onPlay(themeId, seed); };
  if (card) {
    card.addEventListener("click", () => play());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
    });
  }
  // Real "N played" count from public aggregates (best-effort; reads "Stats" until
  // a count arrives — never a fake number).
  if (fetchPlayed) {
    fetchPlayed().then((n) => {
      const el = document.getElementById("dailyStatsLabel");
      if (el && typeof n === "number" && n > 0) el.textContent = `${n.toLocaleString()} played`;
    }).catch(() => {});
  }
  return { onType: (letter) => play(letter) };
}
