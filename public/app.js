// Wordul — client
// Single-file SPA: home → room (lobby → playing → finished), localStorage stats.
import { getSessionToken, openSecureSheet } from "/account.js";
import { wireCardArt, aiLookupHref, hasOgCard } from "/endcard.js";
import { generateRoomCode } from "/codes.js";
import { renderProfile } from "/profile.js";
import { applyEdition, applyColorScheme, getActiveEditionId, setDefaultEdition, getGold, setGold, drainGold, companionReact, renderEditionPicker, activeMistakeFx, isVoiceEnabled, setVoiceEnabled } from "/edition.js";
import { pickGuessEvent } from "/roomConfig.js";
import { playVoice, speakMeaning } from "/voice.js";
import { tapeStart, tapeRecord, tapeForUpload, tapeIsLive, tapeSuspend } from "/tape-recorder.js";
import { loadVoiceConfig, setActiveVoiceId } from "/voice-config.js";
import { newGreensInLast, orderedDiscoveriesInLast, wastedDeadLettersInLast } from "/celebrate.js";
import { typingHints } from "/hints.js";
import { GOLD, comboMultiplier, awardGold, goldDrain, escalatedPenalty, renderGoldHud, playPayoutSequence, dailyCashOutReady } from "/gold.js";
import { createHacklog } from "/hacklog.js";
import { renderPowerups, resetPowerHints, handlePowerupMessage, bumpErrorCount, surfaceGiveUp, checkBankruptcy } from "/powerups.js";
import { activeLayoutId, buildKeyboard, renderKeyboard, renderLayoutPicker, detectLayout } from "/keyboard.js";
import { getSettings, saveSettings, applySettings, openSettings, openHub, activeDifficulty } from "/settings.js";
import { wireMuteBtn, toggleMuted } from "/mute-btn.js";
import { buildShareCardModel, renderShareCard } from "/share-card.js";
import { shareTargetUrl } from "/share-links.js";
import { buildDailyShareLink } from "/daily-share-core.js";
import { buildOwnerTape } from "/owner-tape.js";
import { renderHub, homeTypeLetter, dayTheme } from "/hub.js";
import { mountArenaList, pickNextGame, renderYourTableRow } from "/arena-panel.js";
import { mountGlobalChat } from "/live.js";
import { computeDailyStatsFromRoster, computeRosterView, buildDayShareLine } from "/daily-stats.js";
import { rosterRow } from "/daily-card.js";
import { mountDailyLeaderboard, wireReplayRows } from "/daily-lb.js";
import { computeFeedStreamView, computeFeedPostView } from "/feed.js";
import { EDITIONS, getEdition } from "/editions/index.js";
import { ghostPlayersAt, nextEventAfter, hostFinish } from "/ghost-replay.js";
import { dramaUpdate, dramaStop } from "/drama.js";
import { MODES, isAvailableMode } from "/modes.js";
import { getWorld, worldSlugFromPath, listWorlds, featuredWorlds, loadWorlds } from "/worlds.js";
import { renderWorldCard, pushRecentWorld, getRecentWorldSlugs } from "/world-card.js";
import { t, initLang } from "/i18n.js";
import { wordIntel } from "/data/word-intel.js";
import { pickInspire, pickForfeit } from "/inspire.js";
import { renderSettlement, dailyReceiptLines } from "/settle.js";
import { lossKind, duelVerdict } from "/race-copy.js";
import { wireStampReplays } from "/stamp-replay.js";
import { autoPlayBoardOnce, playBoardReplay, boardReplayActive } from "/board-replay.js";
import { initDarePillActivation } from "/dare-pill.js";
import { seatModel, ghostSeatModel, railPillLabel, railTitleCount, emptySeatActions, yourTableRowProps, shouldChimeOnJoin, shouldShowRoundScore } from "/lobby-view.js";
import { createChatPill, chatHasUserText, routeChatEntry, formatChatTime } from "/chat-pill.js";
import { encodeLocalSolve, needsDailyRecovery, recoverDailyArtifacts } from "/daily-recover.js";

initLang(); // resolve language (saved pick → locale auto-detect) before any t() call

wireStampReplays(); // tap any solve stamp (home recap / featured / profile) → replay

// Apply the active edition at module load (before motion consts read WordulMotion).
applyEdition(getActiveEditionId());

const LS = {
  username: "wr.username",
  session: "wr.session", // raw account session token (bearer) — present only for a secured name
  preferredLength: "wr.length",
  replay: "wr.replay", // structured per-guess payout log, keyed per game (slug:round)
  clearHint: "wr.clearHint", // one-time "press Esc / hold ⌫ to clear the row" nudge
  dailySolve: "wr.dailySolve", // your own daily solve (letters + colors), per date — CLIENT-ONLY
                               // so the home stamp shows real letters without the public
                               // profile ever leaking today's answer.
  dailyToken: "wr.dailyToken", // per-date proof-of-finish token (handed to you over the WS the
                               // moment you finish); sent to /leaderboard to unlock EVERYONE's
                               // letter-boards. Worthless to a non-finisher, so no answer leak.
};

// Stash this browser's own finished daily (letters + color grid) so the home recap can
// draw a crystallized stamp with real letters. Never sent to the server. (Encoding
// shared with daily-recover.js, which restores the same payload on another browser.)
function captureDailySolve(date, me) {
  if (!date || !me || !Array.isArray(me.guesses)) return;
  try {
    localStorage.setItem(`${LS.dailySolve}:${date}`, JSON.stringify(encodeLocalSolve(me)));
  } catch { /* storage full / disabled — stamp falls back to the server color grid */ }
}

const SUPPORTED_LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_LENGTH = 5;

function getPreferredLength() {
  const n = parseInt(localStorage.getItem(LS.preferredLength) ?? "", 10);
  return SUPPORTED_LENGTHS.includes(n) ? n : DEFAULT_LENGTH;
}
function setPreferredLength(n) {
  if (SUPPORTED_LENGTHS.includes(n)) localStorage.setItem(LS.preferredLength, String(n));
}

// --- settings ---
// Settings storage (get/save/apply), the settings modal, and the avatar hub now
// live in /settings.js (imported above). app.js stays the orchestrator.

// --- identity ---
// A username (no password) is the player's identity everywhere. Normalized to
// [a-z0-9_-], min 3, max 20 — matching the server's onHello + worker regexes.
function normalizeUsername(u) {
  // Mirrors src/identity.ts: re-trim after the slice in case clipping exposes a trailing separator.
  return (u || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "").slice(0, 20).replace(/^[-_]+|[-_]+$/g, "");
}
function getUsername() {
  return localStorage.getItem(LS.username) || "";
}
function setUsername(u) {
  const clean = normalizeUsername(u);
  localStorage.setItem(LS.username, clean);
  syncAvatar(); // keep the hub avatar glyph in sync with the chosen name
  return clean;
}
function clearUsername() {
  localStorage.removeItem(LS.username);
  syncAvatar();
}

// --- routing ---
// Owner-nested rooms (/@owner/<slug>) and public profiles (/@username).
const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function parseRoute() {
  const challenge = location.pathname.match(/^\/c\/([0-9A-Za-z]{5})$/);
  if (challenge) return { kind: "challenge", id: challenge[1] };
  if (location.pathname === "/daily/archive") return { kind: "daily-archive" };
  const dailyStats = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/stats$/);
  if (dailyStats) return { kind: "daily-stats", date: dailyStats[1] };
  const daily = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (daily) return { kind: "daily", date: daily[1] };
  if (location.pathname === "/daily") return { kind: "daily", date: todayUTC() };
  if (location.pathname === "/arena" || location.pathname === "/live") return { kind: "live" };
  if (location.pathname === "/feed") return { kind: "feed" };
  const feedPost = location.pathname.match(/^\/feed\/(\d{4}-\d{2}-\d{2})$/);
  if (feedPost) return { kind: "feed-post", date: feedPost[1] };
  if (location.pathname === "/worlds") return { kind: "worlds" };
  const worldSlug = worldSlugFromPath(location.pathname);
  if (worldSlug) return { kind: "world", slug: worldSlug };
  const gallery = location.pathname.match(/^\/@([a-z0-9_-]{3,20})\/worduls$/);
  if (gallery) return { kind: "worduls-gallery", username: gallery[1] };
  const room = location.pathname.match(ROOM_RE);
  if (room) return { kind: "room", owner: room[1], slug: room[2] };
  const prof = location.pathname.match(PROFILE_RE);
  if (prof) return { kind: "profile", username: prof[1] };
  return { kind: "home" };
}

// --- DOM helpers ---
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function mount(tplId) {
  const tpl = $("#" + tplId);
  const app = $("#app");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  // Every screen change drops the home-only topbar stats; renderHub re-adds it.
  document.body.classList.remove("hub-home");
}

// Type-to-play: a bare letter pressed on the home (hub up, nothing focused) carries
// into today's board as a seed. Held here between the home keypress and the daily
// board becoming interactive; applied once by seedDailyOnce, then cleared.
let pendingDailySeed = null;
// One-shot: the edition a room should be created with (e.g. launching Solo from a World),
// without persisting it as the player's saved default. Consumed by the hello message.
let pendingRoomEdition = null;
// Arena-origin handoff: set just before navigating INTO a room reached through the Arena
// (open-games row tap or public host). showRoom consumes it into game.fromArena and mirrors
// it to sessionStorage so a mid-game refresh still resolves the Arena end screen.
let pendingArenaOrigin = false;
// Set when a flow wants the home hub to open straight into the Arena list once it renders
// (the "Join next game → none waiting" fallback). Consumed after renderHub.
let pendingOpenArena = false;

// One persistent listener: while the home screen is up and no field is focused, a
// letter key starts today's word seeded with it (the card's own keydown handles
// Enter/Space). Guarded so it never steals typing from the username field or rooms.
document.addEventListener("keydown", (e) => {
  if (parseRoute().kind !== "home") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (/^[a-zA-Z]$/.test(e.key)) homeTypeLetter(e.key.toUpperCase());
});

// Best-effort seed of the daily board with the letter typed on the home. Self-
// contained and harmless: it only types through the real input path once an input
// row exists, and gives up quietly after a couple of seconds (e.g. slow WS).
function seedDailyOnce(letter) {
  if (!/^[A-Za-z]$/.test(letter || "")) return;
  let tries = 0;
  const tick = () => {
    if (parseRoute().kind !== "daily") return; // navigated away — abandon
    const ready = document.querySelector("#boards .input-row");
    if (ready) { try { typeLetter(letter.toUpperCase()); } catch (_) {} return; }
    if (++tries < 20) setTimeout(tick, 120);
  };
  setTimeout(tick, 120);
}

// Play today's word as an in-place BLOOM, not a hard cut to a new screen: wrap the
// client-side nav in a View Transition so the home card morphs/grows into the board
// (showDaily tags #tabPlay with the same view-transition-name as .daily-card).
// Progressive + reduced-motion safe: no API or reduce-motion → plain instant nav.
function bloomIntoDaily(voiceId) {
  const target = "/daily/" + todayUTC();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Apply the daily's voice INSIDE the transition's DOM-swap so the captured "old"
  // frame is still the elegant default home and the "new" frame is the themed board.
  // That difference is what the View Transition morphs through (square→rounded,
  // ultraviolet→the day's accent). Applying it earlier made old==new — a hard cut.
  // The daily room re-applies its voice from the server snapshot, so a reload is fine.
  const swap = () => { if (voiceId) applyEdition(voiceId); navigate(target); };
  if (typeof document.startViewTransition === "function" && !reduce) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

// --- screens ---

function showHome() {
  history.replaceState(null, "", "/");
  mount("tpl-home");
  // No chat available outside a room.
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;

  const input = $("#usernameInput");
  input.value = getUsername();

  // Registration commit: set the username and reveal the hub so the new player can
  // choose Wordul of the Day / Solo / Head-to-head — rather than being dropped
  // straight into a personal room.
  $("#startPlayingBtn").addEventListener("click", () => {
    if (commitUsername()) renderHomeIdentity();
  });
  // Enter in the username field mirrors the CTA → into the hub.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#startPlayingBtn").click();
  });

  // Switch-user reset (returning users): drop identity, reveal the intro, refocus.
  const switchBtn = $("#switchUserBtn");
  if (switchBtn) {
    switchBtn.onclick = () => {
      clearUsername();
      renderHomeIdentity();
      const i = $("#usernameInput");
      if (i) { i.value = ""; i.focus(); }
    };
  }

  renderHomeIdentity();
}

// Toggle greeting vs. intro based on whether we know who the player is.
// For returning users, render the Hub (hides the legacy greeting/rooms sections).
function renderHomeIdentity() {
  // The home wears the app's signature look, never a daily's voice. Reset to the
  // default edition here so today's voice (Tactile, etc.) doesn't bleed onto the
  // hub — it only takes over when you START the WOTD, as a morph (see bloomIntoDaily).
  // This also re-persists "default", so a leftover voice can't leak into a Solo game.
  applyEdition("default");
  setActiveVoiceId(null); // home is a non-game surface: no active voice source → stays silent
  applyColorScheme(null); // drop any curated day palette so the hub never wears yesterday's vibe
  const u = getUsername();
  const greeting = $("#homeGreeting");
  const intro = $("#homeIntro");
  const rooms = $("#homeRooms");
  if (u) {
    // Hide legacy home sections — the Hub takes over.
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = true;
    if (rooms) rooms.hidden = true;
    // Also hide the CTA button and how-to link — hub has its own play action.
    const cta = $(".home-cta");
    if (cta) cta.hidden = true;
    const howto = $(".home-howto");
    if (howto) howto.hidden = true;

    const cbs = {
      username: u,
      editions: EDITIONS,
      editionName: (id) => getEdition(id).name,
      // Tap or type-to-play: drop into today's board (client-side, no reload). A
      // typed letter is carried as a seed so "start playing right here" feels real.
      onPlay: (editionId, seed) => { pendingDailySeed = seed || null; bloomIntoDaily(editionId); },
      onSolo: () => enterNewRoom({ autoStart: true }),
      onPvP: () => enterNewRoom({ autoStart: false }),
      onLive: () => showLive(),
      onStats: () => navigate("/daily/" + todayUTC() + "/stats"),
      onShareDaily: () => shareDailyResult(cbs.dailyResult, cbs.dailyResult?.date),
      onProfile: (name) => navigate("/@" + name),
      onWorld: (slug) => navigate("/w/" + slug),
      onBrowseWorlds: () => navigate("/worlds"),
      fetchLeaderboard: (username) => {
        // Attach today's proof-of-finish token (if we have one) so the board comes back with
        // everyone's REAL letters. No token → the public letterless board (still renders fine).
        const date = todayUTC();
        const tok = (() => { try { return localStorage.getItem(`${LS.dailyToken}:${date}`) || ""; } catch { return ""; } })();
        const q = tok ? `&t=${encodeURIComponent(tok)}` : "";
        return fetch(`/api/daily/${date}/leaderboard?username=${encodeURIComponent(username)}${q}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      },
      // dailyResult is filled from the profile below: null until you've played today,
      // then { won, guesses } — flips the home card to its post-play recap.
      dailyResult: null,
      // Day carousel: swipe back through past dailies. dailyDates arrives async (filled
      // below, then the hub re-renders); pastRecord reads the loaded profile (cbs.profile,
      // set in the fetch .then) so a past day shows your own stamp + replay.
      dailyDates: [],
      pastRecord: (date) => dailyResultFor(cbs.profile, date),
      navigate: (p) => navigate(p),
      // Real "N played" for the day = the daily roster's ranked-finisher count — the SAME
      // number the stats page derives from (Jun 7 incident: science roundsStarted said
      // "8 played" while the stats roster listed 6; science counts rounds across ALL
      // modes, not daily people, so home and stats disagreed).
      fetchPlayed: () => fetch(`/api/daily/${todayUTC()}/leaderboard?username=&n=1`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => (typeof v?.total === "number" ? v.total : null)),
      renderRecentRooms: (mountEl) => renderRecentRoomsInto(mountEl, 3),
    };
    fetch(`/api/user/${encodeURIComponent(u)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((profile) => {
        // Populate homeRoomRows so renderRecentRoomsInto has data ready.
        homeRoomRows = buildRoomRows(profile, u);
        homeRoomVisible = HOME_ROOMS_PAGE;
        cbs.dailyResult = dailyResultFor(profile);
        cbs.profile = profile;
        renderHub(profile, cbs);
        maybeOpenArena();
        // The daily date list drives how far the home carousel can swipe back. Fetched
        // once; if there's history beyond today, re-render so the carousel arms itself.
        fetch("/api/daily/dates")
          .then((r) => (r.ok ? r.json() : { dates: [] }))
          .then(({ dates }) => {
            cbs.dailyDates = Array.isArray(dates) ? dates : [];
            if (cbs.dailyDates.length > 1 && document.getElementById("dailyPanel")) renderHub(profile, cbs);
          })
          .catch(() => {});
        // Cross-browser self-heal: the server says you finished today (dailyResult), but
        // this browser holds no local solve/finisher token — you solved elsewhere. Pull
        // both off the room's own WS contract once, then re-render the recap with your
        // real letters (and a token that unlocks everyone's letter-boards).
        maybeRecoverDailySolve(u, profile, cbs);
      })
      .catch(() => { renderHub({}, cbs); maybeOpenArena(); });
  } else {
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = false;
    if (rooms) rooms.hidden = true;
    const i = $("#usernameInput");
    if (i) i.focus();
  }
}

// Today's daily result from the profile (no extra request): the finished game whose
// roomPath is daily/<today>. Drives the home's post-play recap. null = not played yet.
function dailyResultFor(profile, date = todayUTC()) {
  const g = (profile?.games || []).find((x) => x.roomPath === "daily/" + date);
  if (!g) return null;
  // Colors come from the server record (cross-device, no spoiler); the real LETTERS come
  // only from THIS browser's own solve (never the public profile). Local wins when present.
  let grid = g.solveGrid ?? null;
  let words = null;
  try {
    const raw = localStorage.getItem(`${LS.dailySolve}:${date}`);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.grid) && s.grid.length) grid = s.grid;
      if (Array.isArray(s.words) && s.words.length) words = s.words;
    }
  } catch { /* ignore */ }
  // `date` rides along so a share from the recap pins the link to THIS day (frozen at
  // render), not a fresh todayUTC() at click time — see buildDailyShareLink.
  return { won: g.result === "won", guesses: g.guesses, solveGrid: grid, solveWords: words, date };
}

// "I solved it on my phone, why is this board blank?" — when the profile proves you
// finished today but THIS browser lacks the client-only artifacts (letters + finisher
// token), recover them over the daily room's own socket: a finished player's snapshot
// already carries both (same payload a reload in the solving browser gets — no new
// surface, no answer leak to anyone the server doesn't already consider done).
// In-flight guard: home re-renders re-enter this; one recovery at a time is plenty.
let dailyRecoveryInFlight = false;
function maybeRecoverDailySolve(username, profile, cbs) {
  const date = todayUTC();
  if (dailyRecoveryInFlight || !cbs.dailyResult || !needsDailyRecovery(date, localStorage)) return;
  if (game.ws) return; // a live game socket exists — the normal play flow owns the artifacts
  dailyRecoveryInFlight = true;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  recoverDailyArtifacts({
    date,
    username,
    storage: localStorage,
    makeSocket: () => new WebSocket(`${proto}//${location.host}/ws?room=${encodeURIComponent("daily/" + date)}`),
    // Mirror openSocket's hello so the room treats this like any reconnect of you.
    hello: {
      type: "hello",
      username,
      wordLength: getPreferredLength(),
      edition: getActiveEditionId(),
      mode: "race",
      scienceOptOut: !getSettings().communityScience,
      sessionToken: getSessionToken() || undefined,
    },
  }).then((ok) => {
    dailyRecoveryInFlight = false;
    // Re-render only if the home recap is still on screen (don't yank a room view).
    if (!ok || !document.getElementById("dailyFeatured")) return;
    cbs.dailyResult = dailyResultFor(profile); // now reads the recovered letters
    renderHub(profile, cbs);
  }).catch(() => { dailyRecoveryInFlight = false; });
}

// Challenge a friend onto this day's Wordul — a spoiler-free dare line + the day's
// link. When the run's masks are on hand, the link carries ?g=<colors-only pattern>
// so the unfurl shows the sharer's golden board, letters hidden (the worker's
// /daily/og route renders it). Native sheet, else clipboard.
// `date` pins the link to the day being shared (past-day pages); omitted → today.
function shareDailyResult(result, date) {
  const { url, line } = buildDailyShareLink({ origin: location.origin, date: date || todayUTC(), result });
  if (typeof navigator.share === "function") {
    navigator.share({ title: "Wordul of the Day", text: line, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(`${line} ${url}`).then(() => toast("Copied — share it anywhere")).catch(() => {});
  } else {
    toast("Sharing isn't supported on this browser");
  }
}

// Validate + persist the typed username. Returns the committed username, or "" when
// it fails the min-length gate (with inline feedback). Shared by the registration
// CTA and the room-create flow.
function commitUsername() {
  const input = $("#usernameInput");
  const username = setUsername(input ? input.value : getUsername());
  if (username.length < 3) {
    if (input) {
      input.focus();
      input.style.outline = "2px solid var(--error)";
      setTimeout(() => (input.style.outline = ""), 700);
    }
    toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
    return "";
  }
  return username;
}

// Shared create flow for the hub CTAs. autoStart=true → solo game begins on the
// first lobby snapshot (see onServerMessage); false → land in the lobby to invite.
function enterNewRoom({ autoStart, publicArena = false, editionId = null }) {
  const username = commitUsername();
  if (!username) return;
  pendingRoomEdition = editionId; // null for normal creates; a World's edition from showWorld
  const slug = generateRoomCode();
  history.pushState(null, "", `/@${username}/${slug}`);
  // Hosting a public Arena room IS an Arena-origin entry — flag it before showRoom consumes it.
  if (publicArena) pendingArenaOrigin = true;
  showRoom(username, slug);
  // showRoom resets game state, so set the one-shot flags after it.
  // Invite path lands quietly in the lobby; the explicit invite button shares on demand.
  if (autoStart) game.autoStart = true;
  // Public Arena host: tell the room (via hello) to list itself in the open-games index.
  if (publicArena) game.publicArena = true;
}

// --- Home rooms list ---

let homeRoomRows = [];
const HOME_ROOMS_PAGE = 6; // show this many at first; "Show more" reveals another page
let homeRoomVisible = HOME_ROOMS_PAGE;

async function loadHomeRooms(username) {
  homeRoomRows = [];
  homeRoomVisible = HOME_ROOMS_PAGE;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profile = await res.json();
    homeRoomRows = buildRoomRows(profile, username);
  } catch (e) {
    // Degrade silently — greeting + CTAs still carry the screen.
    console.error("loadHomeRooms failed:", e);
  }
  const rooms = $("#homeRooms");
  if (!rooms) return; // user navigated away mid-fetch
  if (homeRoomRows.length === 0) {
    rooms.hidden = true;
    return;
  }
  rooms.hidden = false;
  renderRoomList();
}

// Merge owned rooms with rooms derived from game history, dedupe by path
// (owned name wins), sort most-recent-first.
function buildRoomRows(profile, username) {
  const byPath = new Map();
  for (const r of profile.ownedRooms || []) {
    const path = `/@${username}/${r.slug}`;
    byPath.set(path, {
      path,
      name: r.name || titleCaseSlug(r.slug),
      ts: r.lastPlayedAt || 0,
      mine: true,
      owned: true,
    });
  }
  for (const g of profile.games || []) {
    const roomPath = g.roomPath || "";
    if (!roomPath.includes("/")) continue;
    const path = `/@${roomPath}`;
    const slug = roomPath.split("/")[1] || "";
    const owner = roomPath.split("/")[0];
    const existing = byPath.get(path);
    if (existing) {
      // Owned name already wins; just keep the most recent timestamp.
      existing.ts = Math.max(existing.ts, g.finishedAt || 0);
      continue;
    }
    byPath.set(path, {
      path,
      name: titleCaseSlug(slug),
      ts: g.finishedAt || 0,
      mine: owner === username,
      owned: false,
    });
  }
  return Array.from(byPath.values()).sort((a, b) => b.ts - a.ts);
}

// Render homeRoomRows into an arbitrary <ul> mount element (defaults to #roomList).
// The hub calls this with #hubRoomList so it can embed the list in The Daily panel.
function renderRecentRoomsInto(mountEl, limit) {
  renderRoomList(mountEl, limit);
}

function renderRoomList(mountEl, limit) {
  const list = mountEl || $("#roomList");
  if (!list) return;
  const rows = homeRoomRows;
  list.textContent = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "room-empty muted small";
    li.textContent = "No rooms yet.";
    list.appendChild(li);
    return;
  }
  // A hard `limit` (the hub) shows exactly N with no "Show more"; the legacy paged
  // list (#roomList) falls back to homeRoomVisible and keeps its reveal control.
  const shown = rows.slice(0, limit || homeRoomVisible);
  for (const row of shown) {
    const li = document.createElement("li");
    li.className = "room-row";
    li.tabIndex = 0;
    li.setAttribute("role", "button");

    const main = document.createElement("div");
    main.className = "room-row-main";
    const name = document.createElement("span");
    name.className = "room-row-name";
    name.textContent = row.name; // textContent → inherently XSS-safe
    main.appendChild(name);
    if (!row.mine) {
      const tag = document.createElement("span");
      tag.className = "room-row-owner";
      tag.textContent = `@${row.path.split("/")[1]}`; // /@owner/slug → owner
      main.appendChild(tag);
    }

    const time = document.createElement("span");
    time.className = "room-row-time muted small";
    time.textContent = relativeTime(row.ts);

    li.appendChild(main);
    li.appendChild(time);
    li.addEventListener("click", () => navigate(row.path));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(row.path); }
    });
    list.appendChild(li);
  }
  // "Show more" — reveal the next page rather than scrolling a wall of rooms.
  // Suppressed when a hard `limit` is set (the hub shows exactly N, no reveal).
  const remaining = rows.length - shown.length;
  if (!limit && remaining > 0) {
    const more = document.createElement("li");
    more.className = "room-row room-more";
    more.tabIndex = 0;
    more.setAttribute("role", "button");
    const moreLabel = document.createElement("span");
    moreLabel.className = "room-more-label";
    moreLabel.textContent = `Show ${Math.min(HOME_ROOMS_PAGE, remaining)} more`;
    const moreChevron = document.createElement("span");
    moreChevron.className = "room-more-chevron";
    moreChevron.textContent = "⌄";
    more.appendChild(moreLabel);
    more.appendChild(moreChevron);
    const showMore = () => { homeRoomVisible += HOME_ROOMS_PAGE; renderRoomList(); };
    more.addEventListener("click", showMore);
    more.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showMore(); }
    });
    list.appendChild(more);
  }
}

// "crunchy-zebra" → "Crunchy Zebra"
function titleCaseSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Compact relative time: "just now" / "5m ago" / "3h ago" / "2d ago".
function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

function showRoomEntry(owner, slug) {
  // For joiners with no username yet — show home but pre-fill the join path and
  // repurpose the primary CTA as "Join room".
  mount("tpl-home");
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  $("#homeGreeting").hidden = true;
  $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = `Join @${owner}'s Wordul room.`;
  $(".sub").textContent = "Pick a username to join.";

  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = "Join room →";
  const join = () => {
    const username = setUsername(input.value);
    if (username.length < 3) {
      input.focus();
      toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
      return;
    }
    showRoom(owner, slug);
  };
  btn.addEventListener("click", join);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
}

// --- Game / room ---

const game = {
  ws: null,
  challengeId: null,   // /c/<id> solo-replay: the challenge being raced (null in normal rooms)
  challengeVs: "",     // ?vs=<username>: the named challenger — duel resolves on the END screen
  challengeMeta: null, // cached { owner, ownerScore, record, ... } from /api/challenge/<id>/meta
  myGuessTimes: [],    // Date.now() per accepted guess of MINE — paces the owner tape at mint (exact when myRoundStartAt also captured)
  myRoundStartAt: null, // client wall time when *this* round went live (lobby→playing snapshot). Used with myGuessTimes for real first-row offset in buildOwnerTape for challenge ghosts.
  isDaily: false,      // /daily/<date>: async one-shot, gated "underneath"
  dailyDate: null,
  fromArena: false,    // reached through the Arena (open-games join or public host) → Arena end screen
  owner: null,
  slug: null,
  path: null,
  name: null,
  snapshot: null,
  pending: "",       // current guess being typed
  lastRejected: null, // { word, reason } of the last server-rejected guess — resubmitting it is handled locally (no second −50)
  toastTimer: null,
  hasShownEndStats: false,
  lastGuessCounts: new Map(),
  typing: new Map(), // username -> # letters in their live (uncommitted) row, for opponent ghost fill
  // Chat state: how many entries we'd already rendered so we can flag new ones for
  // the unread badge while the panel is collapsed.
  lastChatLen: 0,
  // Which chat channel is showing. "table" is the real per-room chat; "global" is a
  // dormant placeholder (the Global tab is hidden this release until the backend lands).
  // Defaults to "table" — the your-game channel is the only visible tab.
  chatChannel: "table",
  lastSeatCount: 0, // # of taken seats last "Your table" render — new seats get a pop (seatin)
  joinChimeSeen: null, // other-player count at last lobby render; null = first paint (silent) — drives shouldChimeOnJoin
  unreadChat: 0,
  chatCollapsed: false,
  exploding: false,
  reconnectNoticeTimer: null, // arms the gentle glass pill once an outage is sustained
  reconnectTimer: null, // pending openSocket() after an unintended close
  reconnectAttempts: 0, // backoff counter; reset to 0 on a successful open
  pendingReconnect: null, // { url, session } so online/focus can pull the retry forward
  socketSession: null,  // { ws, reconnect } — stale close handlers bail when !== this
  heartbeatTimer: null,
  pongTimer: null, // heartbeat watchdog — unanswered ping ⇒ recycle a zombie socket
  autoStart: false,  // one-shot: "Start playing" auto-begins the solo game on first lobby snapshot
  shareImage: null,  // { url, text, canvas } — pre-rendered result card for sharing
  // EZ-mode power-ups (reset each round): revealed letters + known vowel count.
  ezRound: -1,
  revealed: [],
  vowels: null,
  pendingReveal: false,
  pendingVowel: false,
  // Clearer-wins: structured replay capture + a guard so a mid-payout board repaint
  // (from another player's snapshot) doesn't orphan the tiles the payout is glowing.
  replay: [],
  payingOut: false,
  // Clearer-wins: ids of the deferred payout/drain timers, so leaving the room or
  // starting a new round can cancel them before they fire off-screen (which would
  // mutate the persistent gold balance unseen + run a bankruptcy check on a stale snapshot).
  payoutTimers: [],
  // Loss penalties (C2): per-GAME map of dead-letter (uppercase) → times already
  // wasted this game. The first reuse costs the base penalty; each repeat escalates.
  deadLetterReuse: new Map(),
  // C4 — give-up / bankruptcy state. finishReason is how the game ended from MY view;
  // stuck/errorCount surface the 💀 give-up affordance (reset per round by resetPowerHints).
  finishReason: null, // 'solved' | 'lost' | 'bankrupt' | 'gave_up' | null
  stuck: false,
  errorCount: 0,
  // Lobby → play transition: the lobby board is a single collapsed row; the first
  // snapshot that leaves lobby blooms it out to the full grid (one-shot .blooming class).
  wasLobby: false,
  bloomTimer: null,
};
// Dependency bundle handed to the power-ups module (it must not import app.js — the
// <script type="module"> entry — or the graph would cycle). All app-owned helpers it
// reaches for, in one place. Function refs resolve lazily (hoisted declarations).
const stakeGold = () => game.goldThisRound || 0;
const powerupsCtx = {
  game,
  send: (msg) => send(msg),
  render: () => render(),
  toast: (text, opts) => toast(text, opts),
  renderGoldHud,
  // Settlement spec: races spend/check the STAKE (round score); the ◆ wallet never moves
  // mid-game. Daily keeps the real wallet (§A: WOTD power-ups cost real gold) until Phase 2.
  getGold: () => (game.isDaily ? getGold() : stakeGold()),
  drainGold: (n) => {
    if (game.isDaily) return drainGold(n);
    game.goldThisRound = stakeGold() - n;
    renderRoundScore?.();
    return game.goldThisRound;
  },
  getUsername,                                     // resolve "me" inside the module
  forfeit: (reason) => forfeit(reason),            // C4: give-up / bankruptcy — record loss + explode
};
// The hacker-log terminal: lazily mounted into #hacklog on first payout, reused
// across guesses within a room, cleared per round. reducedMotion is read live.
let hacklog = null;
function getHacklog() {
  const el = $("#hacklog");
  if (!el) return null;
  if (!hacklog) hacklog = createHacklog(el, { reducedMotion: getSettings().reducedMotion });
  el.hidden = false; // reveal on every payout (resetRound re-hides between rounds)
  return hacklog;
}
// The localStorage key is per-game (slug + round) so distinct games never clobber
// each other's replay. game.ezRound tracks the live round number.
function replayKey() {
  return `${LS.replay}:${game.slug || "?"}:${game.ezRound}`;
}
// Push one structured per-guess entry into game.replay + persist. This is the exact
// shape the (gated) server-side replay viewer will store — capture it now, no rework.
function recordReplayEntry(entry) {
  game.replay.push(entry);
  try {
    localStorage.setItem(replayKey(), JSON.stringify(game.replay));
  } catch { /* storage full / disabled — the in-memory replay still drives the end-screen */ }
}
// Schedule a deferred payout/drain step, tracking its id so leaveRoom()/resetRound()
// can cancel it. If the room is gone by the time it fires, it no-ops (we don't touch
// gold for a room we've left). See game.payoutTimers.
function deferPayout(fn, ms) {
  const id = setTimeout(() => {
    game.payoutTimers = game.payoutTimers.filter((t) => t !== id);
    if (!game.snapshot) return;
    fn();
  }, ms);
  game.payoutTimers.push(id);
  return id;
}
function clearPayoutTimers() {
  for (const t of game.payoutTimers) clearTimeout(t);
  game.payoutTimers = [];
  game.payingOut = false;
  clearGiveUpTimer(); // a new round / leaving resets the 3-min 💀 unlock
}
// Resolve a tile in MY board's freshly-flipped row by column index, re-querying each
// beat so a board repaint mid-payout never targets a detached node. MY board is the
// first .player-board (renderBoards orders me first, no .spectator).
function getMyFreshTile(colIndex) {
  const myBoard = document.querySelector("#boards .player-board:not(.spectator)");
  if (!myBoard) return null;
  const rows = myBoard.querySelectorAll(".grid .grid-row");
  // The fresh row is the last one carrying a played guess (it has .tile.reveal or a
  // colored tile). Walk from the bottom to find the most-recently-filled row.
  for (let r = rows.length - 1; r >= 0; r--) {
    const tiles = rows[r].querySelectorAll(".tile");
    const filled = tiles[0] && (tiles[0].classList.contains("reveal") ||
      tiles[0].classList.contains("hot") || tiles[0].classList.contains("warm") ||
      tiles[0].classList.contains("cold"));
    if (filled) return tiles[colIndex] || null;
  }
  return null;
}
const REVEAL_STAGGER_MS = window.WordulMotion?.revealStaggerMs ?? 110;
const REVEAL_FLIP_HALF_MS = window.WordulMotion?.flipHalfMs ?? 200; // matches the tile-reveal keyframe halfway point (0.4s flip)
// Daily-tape upload deferral: the final guess's companion reaction is scheduled at
// flipDoneMs (≈1.5s — word length × stagger + flip half) and records via tapeRecord;
// the upload detaches the recorder, so it must wait past that or every tape loses its
// climax line. 2s > worst-case flipDoneMs with margin.
const TAPE_UPLOAD_DELAY_MS = 2000;

function showRoom(owner, slug) {
  leaveRoom(); // tear down any prior room's socket so room->room nav can't leave a zombie WS
  game.owner = owner;
  game.slug = slug;
  game.path = `${owner}/${slug}`;
  game.name = slug.replace(/-/g, " ");
  game.snapshot = null;
  game.pending = "";
  game.hasShownEndStats = false;
  game.pendingForfeitReveal = false; // stale forfeit one-shot must not announce in a new room
  game.joinChimeSeen = null; // a fresh room's first paint is silent (my own join)
  game.lastChatLen = 0;
  game.chatChannel = "table"; // your-game chat is the only visible channel (Global hidden this release)
  game.unreadChat = 0;
  game.chatCollapsed = false;
  game.lastGuessCounts = new Map();
  game.typing = new Map();
  game.autoStart = false;
  resetGhostReplay(); // no ghost field carries into a fresh room
  game.publicArena = false; // never carry a public-host intent into the next room
  // Arena origin: the pending flag (set at entry) OR a sessionStorage marker (survives a
  // mid-game refresh, which loses the in-memory flag). Persist it so a reload still resolves
  // the Arena end screen. seed is stripped from snapshots, so origin can't be read off the wire.
  game.fromArena = pendingArenaOrigin || sessionStorage.getItem("arena:" + game.path) === "1";
  pendingArenaOrigin = false;
  if (game.fromArena) { try { sessionStorage.setItem("arena:" + game.path, "1"); } catch {} }
  game.roomTab = "play";
  game.shareImage = null;
  game.replay = [];
  game.myGuessTimes = [];
  game.myRoundStartAt = null;
  game.tapeSent = false; // per-room one-shot: a prior daily's upload must not block this room's
  game.payingOut = false;
  // tpl-room mounts a FRESH #hacklog node, so drop any stale terminal bound to the
  // previous room's (now-detached) element — it's re-created lazily on first payout.
  hacklog = null;
  mount("tpl-room");
  renderRoomHeader();
  $("#startBtn").addEventListener("click", () => {
    const snap = game.snapshot;
    if (snap && snap.isDuel) {
      const meP = snap.players.find((p) => p.username === getUsername());
      send({ type: "ready", ready: !(meP && meP.ready) });
    } else {
      send({ type: "start" });
    }
  });
  $("#rematchBtn").addEventListener("click", () => {
    const snap = game.snapshot;
    if (snap && snap.isDuel) {
      // Duel: the between-rounds button readies up for the next KOTH round (no rematch handshake).
      const meP = snap.players.find((p) => p.username === getUsername());
      send({ type: "ready", ready: !(meP && meP.ready) });
    } else {
      proposeRematch();
    }
  });
  wireChat();
  wireRoomTabs();
  wireMuteBtn({ onToggle: (m) => toast(m ? "Muted" : "Sound on", { duration: 1000 }) });
  wireDim();
  wireLobbyPair();
  buildKeyboard($("#keyboard"), resolvedLayoutId(), keyboardHandlers);
  connect();
}

// The lobby Setup · Invite pair (below Start, in the left zone). Setup opens room
// settings (length · theme); Invite shares the room link. Wired once — #lobbyPair lives
// in #tpl-room which remounts per room, so guard with a dataset flag to avoid stacking.
function wireLobbyPair() {
  const setup = $("#lobbySetupBtn");
  if (setup && !setup.dataset.wired) {
    setup.dataset.wired = "1";
    setup.addEventListener("click", () => showSettings());
  }
  const invite = $("#lobbyInviteBtn");
  if (invite && !invite.dataset.wired) {
    invite.dataset.wired = "1";
    invite.addEventListener("click", () => shareRoomInvite());
  }
}

// A challenge link (/c/<id>): solo board on the owner's exact word, racing their
// standing record. Reuses the room engine via a per-player challenge WS.
async function showChallenge(id) {
  // Gate: a challenge WS needs a username (it's the player's identity + score key).
  if (!getUsername()) { showChallengeEntry(id); return; }
  let meta;
  try {
    const res = await fetch(`/api/challenge/${id}/meta`);
    if (!res.ok) throw new Error("gone");
    meta = await res.json();
  } catch {
    toast("That challenge link has expired.", { error: true, duration: 3000 });
    navigate("/");
    return;
  }
  // Ghost tape: a FILED arena tape only (real recorded race) — that one still replays
  // live beside you. A ?vs=<sender> challenger stays UNTOLD: no ghost board, no synth
  // pacing, no spoilers — the duel settles on the end screen, by guesses. In the
  // wordul, lots of words are untold. A miss or fetch hiccup → plain solo challenge.
  const vs = normalizeVs(new URLSearchParams(location.search).get("vs"));
  let ghosts = null;
  try {
    // Pass ?vs when present so the worker can synth a ghost tape from *that user's*
    // bestGameForWord (via game-for-word + tapeFromSolveGrid). Real recorded arena tapes
    // (filed on the Challenge DO) win over synth. This restores live ghost replay for
    // ?vs= duels (reverting the stealth behavior).
    const vsQ = vs ? `?vs=${encodeURIComponent(vs)}` : "";
    const gr = await fetch(`/api/challenge/${id}/ghosts${vsQ}`);
    if (gr.ok) ghosts = (await gr.json()).ghosts;
  } catch { /* plain challenge — no ghosts */ }
  // Stand up the room view (same engine; challenge chrome instead of owner/slug).
  leaveRoom();
  game.challengeId = id;
  game.challengeVs = vs; // the named challenger — resolved at the END, not raced live
  game.challengeMeta = meta;
  game.owner = meta.owner;
  game.slug = null;
  game.path = null;
  // A word challenge fronts as its sender ("@papa's challenge") when the link names
  // one; bare word links read as what they are — the word's open challenge.
  const isWordChallenge = meta.kind === "word";
  game.name = isWordChallenge
    ? (vs ? `@${vs}'s challenge` : "Word challenge")
    : `@${meta.owner}'s challenge`;
  game.snapshot = null;
  game.pending = "";
  game.hasShownEndStats = false;
  game.pendingForfeitReveal = false; // stale forfeit one-shot must not announce in a new room
  game.joinChimeSeen = null; // a fresh room's first paint is silent (my own join)
  game.lastChatLen = 0;
  game.chatChannel = "table"; // your-game chat is the only visible channel (Global hidden this release)
  game.unreadChat = 0;
  game.chatCollapsed = false;
  game.lastGuessCounts = new Map();
  game.typing = new Map();
  resetGhostReplay();
  game.ghostTape = ghosts && Array.isArray(ghosts.events) && ghosts.events.length ? ghosts : null;
  // A plain challenge keeps the instant board; a GHOST challenge arms a tap — the tap
  // is the start gun (and, later, the browser audio-unlock gesture for voice replays).
  game.autoStart = !game.ghostTape;
  game.roomTab = "play";
  game.shareImage = null;
  game.replay = [];
  game.myGuessTimes = [];
  game.myRoundStartAt = null;
  game.payingOut = false;
  hacklog = null;
  mount("tpl-room");
  renderRoomHeader();
  wireChat();
  wireRoomTabs();
  wireMuteBtn({ onToggle: (m) => toast(m ? "Muted" : "Sound on", { duration: 1000 }) });
  buildKeyboard($("#keyboard"), resolvedLayoutId(), keyboardHandlers);

  // No special ghost overlay. For ghostTape challenges we rely on autoStart=false
  // (set above) so the normal lobby ready/start UI is shown; tapping it starts the
  // race (and the snapshot handler will arm the replay clock + we have myRoundStartAt).
  if (isWordChallenge) {
    // "@wordul is racing it right now" would be nonsense — the word's open challenge
    // speaks for its record (or dares you to set it).
    const target = meta.record
      ? `@${meta.record.username} holds the record at ${meta.record.score}. Beat it.`
      : `Set the first record.`;
    toast(`${vs ? `@${vs} challenges you` : "A word challenge"} — ${target}`, { duration: 4200 });
  } else {
    const target = meta.record
      ? `${meta.record.username} holds the record at ${meta.record.score}`
      : meta.ownerScore
        ? `@${meta.owner} scored ${meta.ownerScore}`
        : `@${meta.owner} is racing it right now`;
    toast(`Challenge from @${meta.owner} — ${target}. Beat it.`, { duration: 4200 });
  }
  connectChallenge(id);
}

// A shared username from a query param — same charset as real usernames; anything
// odd collapses to "" (no ghost lookup, no weird names in toasts).
function normalizeVs(raw) {
  const v = (raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
  return v.length >= 3 ? v : "";
}

// No-username gate for a challenge link — pick a name, then resolve the challenge.
// Mirrors showRoomEntry's join flow.
function showChallengeEntry(id) {
  mount("tpl-home");
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  $("#homeGreeting").hidden = true;
  $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = "You've been challenged on Wordul.";
  $(".sub").textContent = "Pick a username to take the challenge.";

  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = "Take the challenge →";
  const go = () => {
    const username = setUsername(input.value);
    if (username.length < 3) {
      input.focus();
      toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
      return;
    }
    showChallenge(id);
  };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

// The Wordul of the Day: a SHARED room at daily/<date> (everyone joins the same DO).
// Reuses the room engine; daily chrome + the gated unlock are render()-driven.
function showDaily(date) {
  if (!getUsername()) { showDailyEntry(date); return; }
  document.title = `Wordul of the Day — ${date}`;
  showRoom("daily", date);                       // connects to /ws?room=daily/<date>
  game.isDaily = true; game.dailyDate = date;    // AFTER showRoom resets state (mirrors enterNewRoom's autoStart)
  // Morph target: the home's .daily-card grows into the play panel (View Transition).
  // Set synchronously after mount so the transition snapshot picks it up.
  const tabPlay = document.getElementById("tabPlay");
  if (tabPlay) tabPlay.style.viewTransitionName = "wotd-bloom";
  if (pendingDailySeed) { seedDailyOnce(pendingDailySeed); pendingDailySeed = null; }
}

// Username gate for a cold deep-link to /daily/<date> (the hub path already has a username).
function showDailyEntry(date) {
  mount("tpl-home");
  const hub = $("#hub"); if (hub) hub.hidden = true;
  $("#homeGreeting").hidden = true; $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = t("daily.entryTitle");
  $(".sub").textContent = t("daily.entrySub");
  const cta = $(".home-cta"); if (cta) cta.hidden = false;
  const input = $("#usernameInput"); input.value = getUsername(); input.focus();
  const btn = $("#startPlayingBtn"); const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = t("daily.entryCta");
  const play = () => {
    const u = setUsername(input.value);
    if (u.length < 3) { input.focus(); toast("Pick a username — at least 3 letters", { error: true, duration: 1800 }); return; }
    showDaily(date);
  };
  btn.addEventListener("click", play);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
}

// Today's Wordul — its own Stats page (premium, easy back). Real public aggregates
// only: played / solved / averages / guess distribution + the day's Studio title and
// "glow". Usernames are withheld by design, so the top-10 leaderboard is a fast-follow.
async function showDailyStats(date) {
  document.title = `Wordul — Stats · ${date}`;
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const dShort = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const ed = getEdition(dayTheme(new Date(), EDITIONS.map((e) => e.id)));
  const glow = ed.companion?.lines?.idle?.[0] ?? "A quiet day on the board.";
  const screen = document.createElement("section");
  screen.className = "screen daily-stats-screen";
  screen.innerHTML = `
    <a href="/" class="link daily-stats-back" id="dailyStatsBack">← Home</a>
    <header class="daily-stats-head">
      <span class="daily-kicker">Today's Wordul · Stats</span>
      <h1 class="daily-stats-title">${dShort}</h1>
      <p class="daily-stats-studio">${ed.name} <span class="muted">· from the Studio</span></p>
      <p class="daily-stats-glow">${glow}</p>
    </header>
    <div class="daily-reveal daily-stats-reveal" id="dailyStatsReveal" hidden></div>
    <div class="daily-stats-body" id="dailyStatsBody"><p class="muted small">Loading today's numbers…</p></div>
    <h2 class="daily-stats-sub">Players</h2>
    <div class="daily-roster" id="dailyRoster"><p class="muted small">Loading players…</p></div>
    <div class="daily-stats-actions">
      <button type="button" class="btn primary small" id="dailyStatsShare">Share</button>
      <a href="/" class="btn ghost small" id="dailyStatsHome">Home</a>
    </div>
    <a href="/feed" class="link lab-entry" id="dailyLabLink">🧠 See what the lab learned →</a>`;
  app.appendChild(screen);
  $("#dailyStatsBack").addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  $("#dailyLabLink").addEventListener("click", (e) => { e.preventDefault(); navigate("/feed"); });
  $("#dailyStatsHome").addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  let full = null;
  try {
    const me = getUsername();
    // Present today's proof-of-finish token (if we hold one) — the server then echoes the
    // answer back so the page can show the word's wiki info. No token → no spoiler.
    const tok = (() => { try { return localStorage.getItem(`${LS.dailyToken}:${date}`) || ""; } catch { return ""; } })();
    const tq = tok ? `&t=${encodeURIComponent(tok)}` : "";
    const res = await fetch(`/api/daily/${date}/leaderboard?full=1&username=${encodeURIComponent(me)}${tq}`);
    if (res.ok) full = await res.json();
  } catch (_) { /* offline / cold day — render the empty state */ }
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  renderDailyStatsReveal(full);
  renderDailyStatsBody(full);
  renderDailyRoster(full);
  // Share brags spoiler-free and hands out the day's PLAY link — a friend should land
  // on the puzzle, never on a page of answers. Native sheet on mobile, else clipboard.
  $("#dailyStatsShare")?.addEventListener("click", () => {
    const view = computeRosterView(full, getUsername());
    const line = buildDayShareLine(view.rows, view.total);
    const url = `${location.origin}/daily/${date}`;
    if (typeof navigator.share === "function") {
      navigator.share({ title: "Wordul of the Day", text: line, url }).catch(() => {});
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(`${line} ${url}`).then(() => toast("Copied — share it anywhere")).catch(() => {});
    } else {
      toast("Sharing isn't supported on this browser");
    }
  });
}

// The word's wiki info atop the stats — rendered ONLY when the server echoed the answer
// back, which it does iff this browser presented today's finisher token. A non-finisher's
// stats page stays spoiler-free, same contract as the letter boards. Built with
// textContent / DOM nodes so nothing from the wire is ever parsed as markup.
function renderDailyStatsReveal(full) {
  const box = $("#dailyStatsReveal");
  if (!box || !full || typeof full.word !== "string" || !full.word) return;
  const word = full.word.toUpperCase();
  const wiki = `/word/${word.toLowerCase()}`;
  const me = getUsername();
  const mine = Array.isArray(full.players) ? full.players.find((p) => p.username === me) : null;
  const kicker = document.createElement("p");
  kicker.className = "daily-reveal-kicker";
  kicker.textContent = t(mine && !mine.won ? "daily.revealKickerLost" : "daily.revealKickerWon");
  const wordEl = document.createElement("a");
  wordEl.className = "daily-reveal-word";
  wordEl.textContent = word;
  wordEl.href = wiki;
  wordEl.setAttribute("aria-label", `${word} — ${t("daily.revealStory", { word })}`);
  box.append(kicker, wordEl);
  const intel = wordIntel(word);
  if (intel?.def) {
    const entry = document.createElement("a");
    entry.className = "daily-reveal-entry";
    entry.textContent = intel.def;
    entry.href = wiki;
    box.appendChild(entry);
  }
  const story = document.createElement("a");
  story.className = "daily-reveal-story";
  story.textContent = t("daily.revealStory", { word });
  story.href = wiki;
  box.appendChild(story);
  box.hidden = false;
}

// Paint the full ranked roster below the aggregates — the SAME rows as the golden
// card (medal/#N · @name · gold · in N / ✗ / 💀), tap-to-replay included. No inline
// time (it lives in the replay modal), so a row can never wrap. Same payload as the
// tiles — one source, no disagreement possible.
function renderDailyRoster(full) {
  const me = getUsername();
  const host = $("#dailyRoster");
  if (!host) return;
  const view = computeRosterView(full, me);
  if (!view.rows.length) {
    host.innerHTML = `<p class="muted small">No finishers recorded.</p>`;
    return;
  }
  host.innerHTML = `<ul class="daily-top-list">${view.rows.map((r) => rosterRow(r, me)).join("")}</ul>`;
  host.querySelectorAll("a[data-profile]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      navigate("/@" + a.getAttribute("data-profile"));
    });
  });
  // Tap a row → that player's board replays (colors for everyone; letters arrive only
  // finisher-gated from the server). Keyed by data-user = escaped username.
  const entries = new Map();
  view.rows.forEach((r) => entries.set(String(r.username).replace(/[^a-z0-9_-]/gi, ""), r));
  wireReplayRows(host, entries);
}

function renderDailyStatsBody(full) {
  const body = $("#dailyStatsBody");
  if (!body) return;
  const v = computeDailyStatsFromRoster(full);
  if (v.played === 0) {
    body.innerHTML = `<p class="muted daily-stats-empty">No numbers yet today — be the first to finish.</p>`;
    return;
  }
  const fmt = (n) => (n == null ? "—" : n.toLocaleString());
  const stat = (num, label) => `<div class="dstat"><div class="dstat-num">${num}</div><div class="dstat-label">${label}</div></div>`;
  const rows = v.distRows.filter((r) => r.count > 0).map((r) => {
    const pct = v.maxCount > 0 ? Math.round((r.count / v.maxCount) * 100) : 0;
    return `<div class="ddist-row"><span class="ddist-g">${r.guesses}</span><span class="ddist-bar" style="width:${Math.max(pct, 8)}%">${r.count}</span></div>`;
  }).join("");
  body.innerHTML = `
    <div class="dstat-grid">
      ${stat(fmt(v.played), "Played")}
      ${stat(v.winRate == null ? "—" : v.winRate + "%", "Solved")}
      ${stat(v.avgGuesses == null ? "—" : v.avgGuesses.toFixed(2), "Avg guesses")}
      ${stat(v.avgScore == null ? "—" : Math.round(v.avgScore).toLocaleString(), "Avg score")}
    </div>
    <h2 class="daily-stats-sub">Guess distribution</h2>
    <div class="ddist">${rows || '<p class="muted small">No solves yet.</p>'}</div>
    <p class="daily-stats-foot muted small">Failed today: ${fmt(v.losses)}</p>`;
}

// The Living Lab reader — human-readable, blog-style discoveries over the same
// /feed.json the worker serves crawlers. Built with textContent (XSS-safe), so the
// admin editorial intro and authored notes can't inject markup. View-models live in
// feed.js (unit-tested); these functions just fetch + paint into #app.
function showFeed() {
  document.title = "Wordul — The Living Lab";
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const screen = document.createElement("section");
  screen.className = "screen lab-screen";
  const back = document.createElement("a");
  back.href = "/"; back.className = "link lab-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  const head = document.createElement("header");
  head.className = "lab-head";
  const kicker = document.createElement("span"); kicker.className = "daily-kicker"; kicker.textContent = "The Living Lab";
  const h1 = document.createElement("h1"); h1.className = "lab-title"; h1.textContent = "Discoveries";
  const sub = document.createElement("p"); sub.className = "lab-sub muted"; sub.textContent = "Honest, privacy-preserving notes on how we all play — one day at a time.";
  head.append(kicker, h1, sub);
  const body = document.createElement("div"); body.className = "lab-body"; body.id = "labBody";
  const loading = document.createElement("p"); loading.className = "muted small"; loading.textContent = "Loading the latest discoveries…";
  body.appendChild(loading);
  screen.append(back, head, body);
  app.appendChild(screen);
  loadFeedStream();
}

async function loadFeedStream() {
  let feed = null;
  try { const res = await fetch("/feed.json"); if (res.ok) feed = await res.json(); } catch (_) { /* offline → empty state */ }
  if (parseRoute().kind !== "feed") return; // navigated away mid-fetch
  const body = $("#labBody"); if (!body) return;
  const v = computeFeedStreamView(feed);
  body.innerHTML = "";
  if (v.empty) {
    const empty = document.createElement("p");
    empty.className = "muted lab-empty";
    empty.textContent = "The lab hasn't published a discovery yet — play a few days and check back.";
    body.appendChild(empty);
    return;
  }
  for (const card of v.cards) {
    const a = document.createElement("a");
    a.className = "lab-card"; a.href = "/feed/" + card.date;
    a.addEventListener("click", (e) => { e.preventDefault(); navigate("/feed/" + card.date); });
    const h = document.createElement("h2"); h.className = "lab-card-title"; h.textContent = card.title; a.appendChild(h);
    if (card.intro) { const p = document.createElement("p"); p.className = "lab-card-intro"; p.textContent = card.intro; a.appendChild(p); }
    const more = document.createElement("span"); more.className = "lab-more"; more.textContent = "Read →"; a.appendChild(more);
    body.appendChild(a);
  }
}

async function showFeedPost(date) {
  document.title = "Wordul — Lab · " + date;
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const screen = document.createElement("section");
  screen.className = "screen lab-screen lab-post-screen";
  const back = document.createElement("a");
  back.href = "/feed"; back.className = "link lab-back"; back.textContent = "← The Lab feed";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/feed"); });
  const body = document.createElement("div"); body.className = "lab-body"; body.id = "labPostBody";
  const loading = document.createElement("p"); loading.className = "muted small"; loading.textContent = "Loading…";
  body.appendChild(loading);
  screen.append(back, body);
  app.appendChild(screen);
  let post = null; let status = 0;
  try { const res = await fetch("/feed/" + date + ".json"); status = res.status; if (res.ok) post = await res.json(); } catch (_) { /* network error → message */ }
  if (parseRoute().kind !== "feed-post") return; // navigated away mid-fetch
  renderFeedPostBody(post, status);
}

function renderFeedPostBody(post, status) {
  const body = $("#labPostBody"); if (!body) return;
  body.innerHTML = "";
  if (!post) {
    const msg = document.createElement("p");
    msg.className = "muted lab-empty";
    msg.textContent = status === 404
      ? "This day's discovery isn't published yet — today's word is never spoiled. Check back tomorrow."
      : "Couldn't load this discovery. Please try again in a moment.";
    body.appendChild(msg);
    return;
  }
  const v = computeFeedPostView(post);
  const article = document.createElement("article"); article.className = "lab-post";
  const h1 = document.createElement("h1"); h1.className = "lab-post-title"; h1.textContent = v.title; article.appendChild(h1);
  // Lab days are UTC days — say it, or a 9pm evening reads as the "wrong" date.
  const utc = document.createElement("p"); utc.className = "muted small lab-utc-note";
  utc.textContent = "Lab days tick over at midnight UTC."; article.appendChild(utc);
  if (v.intro) { const intro = document.createElement("p"); intro.className = "lab-post-intro"; intro.textContent = v.intro; article.appendChild(intro); }
  if (v.findings.length) {
    const ul = document.createElement("ul"); ul.className = "lab-findings";
    for (const f of v.findings) { const li = document.createElement("li"); li.textContent = f; ul.appendChild(li); }
    article.appendChild(ul);
  }
  for (const n of v.notes) {
    const aside = document.createElement("aside"); aside.className = "lab-note"; aside.dataset.pillar = n.pillar || "";
    const nt = document.createElement("h3"); nt.className = "lab-note-title"; nt.textContent = n.title || ""; aside.appendChild(nt);
    const np = document.createElement("p"); np.textContent = n.note || ""; aside.appendChild(np);
    if (n.citation) { const c = document.createElement("cite"); c.textContent = n.citation; aside.appendChild(c); }
    article.appendChild(aside);
  }
  body.appendChild(article);
}

// Connect the per-player challenge WS — an isolated solo room seeded with the
// challenge's pinned word. Username is guaranteed by showChallenge's gate.
function connectChallenge(id) {
  const username = getUsername();
  if (!username) { showChallengeEntry(id); return; }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?challenge=${id}&username=${encodeURIComponent(username)}`;
  openSocket(url);
}

// Hand the player the invite link with minimum ceremony: native share sheet on
// mobile, clipboard + a clear toast on desktop. Used by the lobby invite button
// AND auto-fired right after "Invite friend" creates a room, so sharing is the
// first thing that happens — no hunting for a button. MUST be called inside a
// user-gesture call stack (a click) for navigator.share to be allowed.
async function shareRoomInvite() {
  // A challenge view shares its own /c/<id>; a seeded arena room shares the challenge
  // it published (works for unlimited friends, with ghost replay) — never a null slug.
  const cid = game.challengeId || (game.snapshot && game.snapshot.shareChallengeId);
  const inviteUrl = withMyVs(shareTargetUrl({
    origin: location.origin, challengeId: game.challengeId,
    shareChallengeId: game.snapshot?.shareChallengeId, owner: game.owner, slug: game.slug,
  }));
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: `Wordul — ${game.name || game.slug}`,
        text: cid ? "Race my word on Wordul — beat my ghost!" : `Race me on Wordul in ${game.owner}'s room!`,
        url: inviteUrl,
      });
      return;
    } catch (e) {
      // User cancelled → done. Real error → fall through to clipboard.
      if (e && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast("Link copied — send it to a friend!", { duration: 2400 });
  } catch {
    prompt("Copy this link:", inviteUrl);
  }
}

// On a WORD challenge (the canonical per-word leaderboard), my share carries ?vs=me
// so MY friend races MY ghost — the /c/<id> is shared by everyone; vs personalizes
// the replay. Other links (rooms, personal challenges) pass through untouched.
function withMyVs(url) {
  if (game.challengeMeta?.kind !== "word") return url;
  const u = getUsername();
  return u ? `${url}?vs=${encodeURIComponent(u)}` : url;
}

// Render the room name. The name IS the share affordance — tapping it copies the
// room link. Rename + invite live in the avatar hub now (nothing lost, just moved).
function renderRoomHeader() {
  const nameEl = $("#roomName");
  if (nameEl) {
    nameEl.textContent = game.name || game.slug;
    nameEl.onclick = copyRoomLink;
  }
  renderChatTabLabel();
  renderHeaderIdentity();
  renderGoldHud();
  renderH2HBadge();
}

// Label the (single visible) game chat tab with the room's display name, e.g. "⌗ Jade Owl".
// Global is hidden this release, so this tab reads as the chat header. Reuses the same
// room-name source as #roomName.
function renderChatTabLabel() {
  const label = $("#chatTabTableLabel");
  if (label) label.textContent = game.name || game.slug || "Table";
}

// Copy the room link with a subtle confirmation. The whole share/copy surface
// collapsed into one gesture: tap the name.
async function copyRoomLink() {
  // Same rule as shareRoomInvite: challenge views and seeded arena rooms hand out
  // their /c/<id> link (regression: this used to mint "/@papa/null" in a challenge).
  const url = withMyVs(shareTargetUrl({
    origin: location.origin, challengeId: game.challengeId,
    shareChallengeId: game.snapshot?.shareChallengeId, owner: game.owner, slug: game.slug,
  }));
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied ✓", { duration: 1200 });
  } catch {
    prompt("Copy this link:", url);
  }
}

// The immersive in-game header (C5): gold beside the avatar, username as a tiny
// The username trigger (@handle) is self-maintaining via syncAvatar() on
// load + every setUsername; just refresh it when a room view (re)renders so a
// name picked at join time shows immediately.
function renderHeaderIdentity() {
  syncAvatar();
}

// Strip the in-room gold from the topbar header when we leave a room. The @handle
// trigger persists everywhere (home + room), so only #roomHeader (the gold host)
// needs clearing here.
function clearHeaderIdentity() {
  const header = $("#roomHeader");
  if (header) header.textContent = "";
}

// Rename the current room. Shared (anyone present can rename) and reachable from
// both the ✎ button (lobby/finished) and the avatar hub (during play).
function renameRoom() {
  const next = prompt("Rename this room:", game.name || game.slug);
  if (next == null) return;
  const clean = next.replace(/[\x00-\x1f\x7f<>]/g, "").trim().slice(0, 40);
  if (!clean) return;
  send({ type: "rename", name: clean });
}

// Reveal + scroll to the scoreboard. It's hidden mid-play; the hub un-hides it
// (clearing the playing-state gate) and scrolls it into view so it isn't orphaned.
function scrollToScoreboard() {
  const sb = $("#scoreboard");
  if (!sb) return;
  if (game.snapshot && (game.snapshot.scoreboard || []).length === 0) {
    toast("No scores yet — finish a round!", { duration: 1600 });
    return;
  }
  sb.classList.add("hub-reveal"); // overrides the body.playing hide for this peek
  sb.hidden = false;
  sb.scrollIntoView({ behavior: getSettings().reducedMotion ? "auto" : "smooth", block: "center" });
}

// --- Edition: gold HUD + companion personality ---
// Gold economy (constants, combo, payout, HUD, coin-rain) lives in /gold.js.
// celebrateCombo stays here because it depends on app-local playChime + toast.

// A satisfying combo flourish: ascending arpeggio + a "✦ N× COMBO" toast.
function celebrateCombo(discoveries, mult) {
  playChime([[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]]);
  toast(`✦ ${mult}× COMBO · ${discoveries} in one shot`, { duration: 1600 });
}

// Surface the active edition's companion line for an event, reusing the toast.
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak, revealVoice, voice } = companionReact(event, ctx);
  if (!text) return;
  // Tape the line that actually fired (recorder is live only during a daily solve) —
  // the replay re-speaks exactly this line through the viewer's voice engine.
  tapeRecord("v", { raw, text, voice, revealVoice, answer: ctx.answer });
  // The written toast is opt-out via Settings → Companion comments. Voice is governed
  // separately — the 🗣️ voice opt-in (wordul.voice, off by default: only the word
  // reveal speaks) plus the 🔊 mute (wordul.muted) — so the two channels stay independent.
  if (getSettings().companionComments) {
    // Big moments linger; routine lines stay snappy.
    const big = tier && !(event === "wrong" && tier === "normal");
    toast(text, { duration: big ? 4200 : 3200 });
  }
  // The wipe aside is text-only — it fires often enough that voicing it would grate.
  // The win QUIP is text-only too: the spoken slot on a solve belongs to the winReveal
  // announcement ("Congratulations — you found the word, {answer}", speakWinReveal),
  // and two voices back-to-back would cut each other off (speakTemplated stops prior audio).
  if (!speak || event === "wipe" || event === "win") return;
  // Templated lines (the loss reveal): full robot voice by default; a world/room can
  // opt into "split" (Yan's cloned frame + robot answer) via sound.voice.reveal.
  // Per-world dispatch: the descriptor (silent/ai/clips) comes from companionReact. text is
  // the already-rendered line (ai voice speaks it); raw + ctx feed the clip templating path.
  // Returned so callers can sequence after the spoken reveal (e.g. appending the meaning).
  return playVoice(voice, raw, text, ctx, revealVoice);
}

// The spoken WIN ANNOUNCEMENT — "Congratulations — you found the word [1s beat] TAFFY".
// Voice-only (no toast — the screen already shows the word: the broadsheet reveal in a
// daily, the end card in a race). Honors the world's reveal mode like the loss reveal
// (full robot by default, "split" = cloned frame + robot answer via sound.voice.reveal);
// ctx.pauseMs stretches the pre-word beat to a full dramatic second in either mode.
// Line bank: yang.js companion.lines.winReveal (per-edition + rung-2 room tweakable).
function speakWinReveal(answer) {
  if (!answer) return;
  const { raw, speak, revealVoice, voice } = companionReact("winReveal", { answer });
  // Returned so the caller can sequence the meaning right after the framed word reveal.
  if (speak && raw) return playVoice(voice, raw, raw.includes("{answer}") ? raw.replace("{answer}", answer) : raw, { answer, pauseMs: 1000 }, revealVoice);
}

// Speech-only twin of showCompanion("loss") for surfaces that own their screen (the
// daily's curated #dailyUnlock): the spoken "the word was…" reveal without a toast
// stacking over the curated card.
function speakLossReveal(answer) {
  const { raw, speak, revealVoice, voice } = companionReact("loss", { answer });
  if (speak && raw) return playVoice(voice, raw, raw.replace("{answer}", answer), { answer }, revealVoice);
}

// THE single end-game announcer. Every finish — race, arena, duel, forfeit, daily —
// funnels through here, so the chime + companion quip + spoken word reveal can never
// drift apart per mode. (The server's "The word was X" system CHAT line in room.ts is
// the text record, a separate surface; voice happens only here.)
//   won        — picks the win celebration (chime + quip + winReveal) vs the loss reveal
//   answer     — the word; win paths should fall back to the winner's last guess
//   guessesUsed— tiers the win quip (genius/clutch)
//   delayMs    — let the final row's flip land first (daily uses 1500ms)
//   quip       — false = speech only, for screens with their own curated reveal (daily)
function announceGameEnd({ won, answer, guessesUsed, delayMs = 0, quip = true }) {
  // The short meaning rides along with the word — heard while it's seen, on win and loss.
  const meaning = answer ? (wordIntel(answer)?.gloss || "") : "";
  const fire = () => {
    if (won) {
      playChime([[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]]); // the race-win arpeggio
      if (quip) showCompanion("win", { guessesUsed }); // text-only quip (voice yields to the reveal)
      // Framed lead-in FIRST (the winReveal bank's encouragement + "the word is {answer}",
      // warm cloned voice in split editions), THEN the meaning right after — same voice.
      const revealDone = speakWinReveal(answer);
      if (meaning) Promise.resolve(revealDone).then(() => speakMeaning(meaning)).catch(() => {});
    } else if (!answer) {
      // A forfeit announces BEFORE the server's reveal snapshot lands — with no answer
      // the reveal would speak a dangling "the word was…". Stay quiet; the end card
      // carries the word the moment the reveal snapshot arrives.
    } else {
      // "the word was {answer}" reveal (toast+voice on a race, voice-only on the daily),
      // then the meaning in the same voice — you hear what you missed.
      const revealDone = quip ? showCompanion("loss", { answer }) : speakLossReveal(answer);
      if (meaning) Promise.resolve(revealDone).then(() => speakMeaning(meaning)).catch(() => {});
    }
  };
  if (delayMs) setTimeout(fire, delayMs); else fire();
}

// --- Idle taunts: the companion checks in when you go quiet mid-game. ---
let idleTimer = null;
const IDLE_FIRST_MS = 180000; // 3 min of silence before the companion checks in
const IDLE_REPEAT_MS = 180000; // …and every 3 min after that

function isMyTurn() {
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  return !!(game.snapshot && game.snapshot.phase === "playing" && me && me.status === "playing");
}
function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function armIdle(delay = IDLE_FIRST_MS) {
  clearIdle();
  if (!isMyTurn()) return;
  idleTimer = setTimeout(() => {
    if (!isMyTurn()) { clearIdle(); return; } // re-check at fire time
    showCompanion("idle");
    armIdle(IDLE_REPEAT_MS);
  }, delay);
}
function resetIdle() { armIdle(IDLE_FIRST_MS); }

// C4: the 💀 give-up escape hatch is intentionally NOT eager — quitting should only be
// an option once you've genuinely been grinding. It surfaces after 3 minutes in a round
// (this timer) OR after too many mistakes (errorCount threshold in powerups.js). The idle
// nudge only shows the companion now; it no longer reveals give-up.
let giveUpTimer = null;
const GIVE_UP_AFTER_MS = 180000; // 3 min into the round before 💀 appears
function clearGiveUpTimer() { if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; } }
function armGiveUpTimer() {
  clearGiveUpTimer();
  if (!isMyTurn()) return;
  giveUpTimer = setTimeout(() => {
    if (isMyTurn()) surfaceGiveUp(powerupsCtx);
  }, GIVE_UP_AFTER_MS);
}

// SPA navigation: pushState + re-dispatch the router.
function navigate(path) {
  stopArenaPoll(); // any route change tears down the Arena open-games poll
  history.pushState(null, "", path);
  route();
}

// The Arena (bots-in-PvP) open-games poll handle. mountArenaList returns a stop() we MUST
// call on teardown (Back, row-tap → navigate, or any nav) so the 8s poll can't leak.
let arenaPollStop = null;
function stopArenaPoll() {
  if (arenaPollStop) { arenaPollStop(); arenaPollStop = null; }
}

// The in-room lobby rail (Civ-3 lobby): while waiting in a room's lobby phase, poll the
// open-games index and show OTHER tables filling up, tap-to-defect. Reuses mountArenaList
// with excludePath set to my own room so I never see myself in the list.
let lobbyRailStop = null;
function teardownLobbyRail() {
  if (lobbyRailStop) { lobbyRailStop(); lobbyRailStop = null; }
  const el = $("#lobbyRail");
  if (el) el.hidden = true;
  // #lobbyRail is static DOM that survives room navigations — clear the pinned "Your
  // table" row so a previous room's seats can't leak into the next lobby it mounts in.
  renderYourTableRow($("#lobbyRailYou"), null);
}
function mountLobbyRailIfNeeded() {
  const el = $("#lobbyRail");
  const list = $("#lobbyRailList");
  if (!el || !list) return;
  el.hidden = false;
  wireLobbyRailPill(el);
  // Pinned "Your table" first row (iter3 §1): painted from the LIVE snapshot on every
  // lobby render — never the open-games feed (it may exclude/lag my own room) — so a
  // ＋/✕ tap or a join ticks 1/2 → 1/3 immediately. Challenges skip it: their solo DO's
  // seat math is fiction (the ghost strip is their counter).
  if (!game.challengeId && game.snapshot) {
    renderYourTableRow($("#lobbyRailYou"), yourTableRowProps(game.snapshot, getUsername()));
  } else if (game.challengeId) {
    // Belt-and-braces with teardownLobbyRail: a previous room's row must never leak
    // into a challenge lobby. Null props clear the mount (CSS :empty then hides it).
    renderYourTableRow($("#lobbyRailYou"), null);
  }
  if (lobbyRailStop) return; // already polling — don't restart on every render()
  const mine = `/@${game.owner}/${game.slug}`;
  lobbyRailStop = mountArenaList(list, {
    excludePath: mine,
    // Defect: leave this room and jump into the tapped one. showRoom()→leaveRoom() closes
    // the current socket; the 45s abandon-grace then delists the table I bailed from.
    onJoin: (routePath) => { pendingArenaOrigin = true; navigate(routePath); },
    // One live count per viewport, riding the same poll: the mobile pill says
    // "▸ N tables open"; the desktop "Tables" title carries a muted "N open"
    // (mobile hides the title, desktop hides the pill — never two counts at once).
    onCount: (n) => {
      const c = $("#lobbyRailPillCount");
      if (c) c.textContent = railPillLabel(n);
      const t = $("#lobbyRailTitleCount");
      if (t) t.textContent = railTitleCount(n);
    },
  });
}

// The mobile rail collapses to a "▸ N tables open" pill; tap toggles the list open.
// Collapsed-vs-expanded is pure CSS (≤880px scoped) — desktop never shows the pill, so
// the class is inert there. Wired once per mount (the room template rebuilds the node).
function wireLobbyRailPill(el) {
  const pill = $("#lobbyRailPill");
  if (!pill || pill.dataset.wired) return;
  pill.dataset.wired = "1";
  pill.addEventListener("click", () => {
    const expanded = el.classList.toggle("expanded");
    pill.setAttribute("aria-expanded", String(expanded));
  });
}

// The Arena: open games anyone can jump into — bots now, public human rooms too (a host
// opts in via "Host a public game"). Rendered into #hubContent (home stays mounted); Back
// restores the launcher. Distinct from Head-to-head, which makes a private invite-link room.
// Direct load / refresh of /arena: the Arena view lives inside the home hub (#hubContent),
// so mount home first and let maybeOpenArena() open the view once the hub renders. The
// pendingOpenArena one-shot is the same hook the "join next → none waiting" fallback uses.
function showLiveRoute() {
  pendingOpenArena = true;
  leaveRoom();
  showHome();
}

let liveChatStop = null;

function showLive() {
  const content = document.getElementById("hubContent");
  if (!content) return;
  // A real, refresh-survivable route — reflect it in the URL (replace, not push, so it
  // doesn't pile a history entry on top of the hub the user is already standing on).
  history.replaceState(null, "", "/live");
  stopArenaPoll();
  if (liveChatStop) { liveChatStop(); liveChatStop = null; }
  content.innerHTML =
    `<section class="hub-panel live-view">
      <button id="liveBack" class="hub-textlink" type="button">← Back</button>
      <h1 class="pvp-title">Live <span id="liveTitleCount" class="rail-title-count"></span></h1>
      <p class="live-blurb muted">Jump into an open game, or chat with whoever's around.</p>
      <div class="live-grid">
        <div class="live-tables">
          <div id="arenaList" class="arena-mount"></div>
          <button id="liveHost" class="btn block">Host a public game →</button>
        </div>
        <aside id="liveChat" class="live-chat"></aside>
      </div>
    </section>`;
  const back = document.getElementById("liveBack");
  if (back) back.addEventListener("click", () => { stopArenaPoll(); navigate("/"); });
  const host = document.getElementById("liveHost");
  if (host) host.addEventListener("click", () => { stopArenaPoll(); enterNewRoom({ autoStart: false, publicArena: true }); });
  arenaPollStop = mountArenaList(document.getElementById("arenaList"), {
    onJoin: (routePath) => { pendingArenaOrigin = true; navigate(routePath); },
    onCount: (n) => {
      const t = document.getElementById("liveTitleCount");
      if (t) t.textContent = railTitleCount(n);
    },
  });
  liveChatStop = mountGlobalChat(document.getElementById("liveChat"), {
    username: getUsername(),
    onNeedName: () => toast("Pick a name to chat", { duration: 1800 }),
  });
}

// --- Arena end-screen actions (the "keep playing the Arena" set) --------------
// "Join next game →": jump straight to the next waiting open game (not the one just
// played). If nothing else is waiting, fall back to the Arena list on the home hub.
function joinNextArena() {
  const current = `/@${game.owner}/${game.slug}`;
  fetch("/api/arena/open")
    .then((r) => (r.ok ? r.json() : []))
    .then((games) => {
      const next = pickNextGame(games, current);
      closeStats();
      if (next) { pendingArenaOrigin = true; navigate(next); }
      else { pendingOpenArena = true; navigate("/"); } // none waiting → open the Arena list
    })
    .catch(() => { closeStats(); pendingOpenArena = true; navigate("/"); });
}

// "Create your own game": leave this finished room and host a fresh public Arena room,
// listed in the open-games index for the next person (or bot) to join.
function hostPublicArena() {
  closeStats();
  enterNewRoom({ autoStart: false, publicArena: true });
}

// "Main menu": close out to the home hub (route() handles leaveRoom + home render).
function backToMenu() {
  closeStats();
  navigate("/");
}

// After the home hub renders, open straight into the Arena list if a flow requested it
// (the "Join next → none waiting" fallback). One-shot; #hubContent only exists post-render.
function maybeOpenArena() {
  if (!pendingOpenArena) return;
  pendingOpenArena = false;
  showLive();
}

// Render a username as a clickable link to their public profile (/@username).
// Single source of truth so every @handle — greeting, chat, scoreboard, player
// boards, owner byline — is a one-tap hop to that player. The name goes through
// textContent (XSS-safe); the click stays in the SPA via navigate().
function userLink(username, { at = false, suffix = "" } = {}) {
  const a = document.createElement("a");
  a.className = "userlink";
  a.href = `/@${username}`;
  a.textContent = (at ? "@" : "") + username + suffix;
  a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/@${username}`); });
  return a;
}

// The lobby chat pill: chat collapses to a "▸ Chat" row until real conversation
// exists (chat-pill.js owns the model; this sync owns the DOM). When the user's
// manual-close latch holds, an arriving message pulses the pill (blink) instead
// of force-opening — opening clears the pulse.
const chatPill = createChatPill(
  (open) => {
    $("#chatPanel")?.classList.toggle("chat-open", open);
    $("#chatPill")?.setAttribute("aria-expanded", String(open));
    if (open) {
      $("#chatPill")?.classList.remove("blinking");
      // Pill open = the chat is on screen; nothing stays "unread". This is what
      // keeps the in-game 💬 badge honest — it's hidden in the lobby, so a count
      // accrued while reading the open pill would resurface stale at race start.
      game.unreadChat = 0;
      updateChatBadge();
      scrollChatToBottom();
    }
  },
  () => $("#chatPill")?.classList.add("blinking"),
);

function wireChat() {
  const form = $("#chatForm");
  const input = $("#chatInput");
  const toggle = $("#chatToggle");
  const backdrop = $("#chatBackdrop");
  const topBtn = $("#chatTopBtn");

  chatPill.reset(); // new room = quiet room
  $("#chatPill")?.classList.remove("blinking"); // a stale pulse never crosses rooms
  const pillBtn = $("#chatPill");
  if (pillBtn && !pillBtn.dataset.wired) {
    pillBtn.dataset.wired = "1";
    pillBtn.addEventListener("click", () => chatPill.toggle());
    // The blink is finite (6 pulses, style.css). Drop the class when the run ends
    // so a LATER message's classList.add restarts the animation — re-adding to an
    // element still carrying .blinking is a no-op and would never re-pulse.
    pillBtn.addEventListener("animationend", (e) => {
      if (e.animationName === "chat-pill-blink") pillBtn.classList.remove("blinking");
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // Only the Table channel sends — Global is a placeholder and Status is
      // read-only; the input is disabled on both, but belt-and-suspenders.
      if (game.chatChannel !== "table") return;
      const text = (input.value || "").trim();
      if (!text) return;
      send({ type: "chat", text });
      input.value = "";
    });
  }

  // Channel tabs (wired once). Table = the real per-room chat; Status = read-only
  // system lines; Global is a dormant "coming soon" placeholder. Guarded so
  // re-running wireChat() doesn't stack listeners.
  const tabs = $("#chatTabs");
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = "1";
    $("#chatTabGlobal")?.addEventListener("click", () => switchChatChannel("global"));
    $("#chatTabTable")?.addEventListener("click", () => switchChatChannel("table"));
    $("#chatTabStatus")?.addEventListener("click", () => switchChatChannel("status"));
  }

  // Desktop toggle: collapse/expand inline panel.
  if (toggle) {
    toggle.addEventListener("click", () => {
      // On mobile a header-bar tap closes the sheet (backdrop tap does too).
      if (isMobile()) {
        closeChatSheet();
        return;
      }
      game.chatCollapsed = !game.chatCollapsed;
      const panel = $("#chatPanel");
      panel?.classList.toggle("collapsed", game.chatCollapsed);
      toggle.setAttribute("aria-expanded", String(!game.chatCollapsed));
      if (!game.chatCollapsed) {
        game.unreadChat = 0;
        updateChatBadge();
        scrollChatToBottom();
      }
    });
  }

  if (backdrop) backdrop.addEventListener("click", closeChatSheet);
  // Visibility is owned by render() (gated on player count); we just wire the tap.
  if (topBtn) {
    topBtn.onclick = openChatSheet;
  }
}

// Switch the active chat channel ("global" placeholder / "table" real chat / "status"
// system lines). Toggles the tab .is-active state, re-renders the body for the
// channel, and clears the Table ping.
function switchChatChannel(which) {
  game.chatChannel = which;
  $("#chatTabGlobal")?.classList.toggle("is-active", which === "global");
  $("#chatTabTable")?.classList.toggle("is-active", which === "table");
  $("#chatTabStatus")?.classList.toggle("is-active", which === "status");
  if (which === "table") {
    const ping = $("#chatTabPing");
    if (ping) ping.hidden = true;
  }
  renderChatChannel();
}

// Show the body for the active channel. Table → real #chatLog + enabled input.
// Status → read-only #chatStatusLog (timestamped system lines). Global → a single
// muted placeholder + disabled input (no networking; placeholder this release).
function renderChatChannel() {
  const log = $("#chatLog");
  const statusLog = $("#chatStatusLog");
  const input = $("#chatInput");
  // Lazily create the Global placeholder line once, as a sibling of #chatLog in #chatBody.
  let placeholder = $("#chatGlobalPlaceholder");
  if (!placeholder && log) {
    placeholder = document.createElement("div");
    placeholder.id = "chatGlobalPlaceholder";
    placeholder.className = "chat-global-placeholder";
    placeholder.textContent = "🌐 Global lobby chat is coming soon — you're chatting with your table for now.";
    log.parentNode.insertBefore(placeholder, log);
  }
  const isGlobal = game.chatChannel === "global";
  const isStatus = game.chatChannel === "status";
  if (log) log.hidden = isGlobal || isStatus;
  if (statusLog) statusLog.hidden = !isStatus;
  if (placeholder) placeholder.hidden = !isGlobal;
  if (input) {
    input.disabled = isGlobal || isStatus;
    input.placeholder = isGlobal ? "Global chat coming soon…" : isStatus ? "Status is read-only" : "Chat";
  }
  if (isStatus) scrollChatToBottom();
}

function isMobile() {
  return window.matchMedia("(max-width: 520px)").matches;
}

function openChatSheet() {
  if (!isMobile()) return;
  const panel = $("#chatPanel");
  const backdrop = $("#chatBackdrop");
  if (!panel) return;
  panel.classList.add("sheet-open");
  backdrop?.classList.add("sheet-open");
  backdrop?.removeAttribute("hidden");
  // Mark read — flush the unread badge.
  game.unreadChat = 0;
  game.chatCollapsed = false;
  updateChatBadge();
  scrollChatToBottom();
  // Focus the input for immediate typing (deferred so iOS doesn't fight the animation).
  setTimeout(() => $("#chatInput")?.focus(), 280);
}

function closeChatSheet() {
  const panel = $("#chatPanel");
  const backdrop = $("#chatBackdrop");
  panel?.classList.remove("sheet-open");
  backdrop?.classList.remove("sheet-open");
  setTimeout(() => backdrop?.setAttribute("hidden", ""), 240);
  $("#chatInput")?.blur();
}

// Reconnect tuning. The philosophy is "premium silent recovery": the first retry is
// near-instant, backoff is gentle-but-capped so a flapping/restarting server is never
// hammered, and we NEVER surface a stark error toast — most drops (dev hot-reload, a
// backgrounded mobile tab, a signal blip) resolve in well under a second and the player
// sees nothing at all. A calm glass pill only appears for a genuinely sustained outage.
const RECONNECT_FIRST_MS = 250;      // first retry — fast enough to feel instant
const RECONNECT_MAX_MS = 6_000;      // backoff ceiling; we keep trying forever, but politely
const RECONNECT_NOTICE_AFTER_MS = 2_600; // only show the (gentle) pill past this much downtime
const HEARTBEAT_MS = 20_000;         // keep the DO path warm
const PONG_TIMEOUT_MS = 8_000;       // no pong in this window ⇒ socket is a zombie, recycle it

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(game.path)}`;
  openSocket(url);
}

// Open (and auto-reconnect) a game WebSocket to `url`, wiring the shared hello /
// snapshot / heartbeat handlers. Used by both the room path (connect) and the
// challenge path (connectChallenge); reconnect re-opens the SAME url.
function openSocket(url) {
  const ws = new WebSocket(url);
  const session = { ws, reconnect: true };
  game.socketSession = session;
  game.ws = ws;

  ws.addEventListener("open", () => {
    if (game.socketSession !== session) return; // superseded by leaveRoom() / a newer socket
    // We're back — drop any reconnecting UI and reset backoff so the next blip is fast again.
    game.reconnectAttempts = 0;
    game.pendingReconnect = null;
    clearReconnectNotice();
    setConnectionStatus("ok");
    send({
      type: "hello",
      username: getUsername(),
      wordLength: getPreferredLength(),
      edition: pendingRoomEdition ?? getActiveEditionId(), // World skin if launched from one, else the saved default
      mode: "race", // only valid selectable mode today
      scienceOptOut: !getSettings().communityScience,
      public: game.publicArena === true, // host opted into the public Arena open-games list
      sessionToken: getSessionToken() || undefined, // P0 auth seam; absent for unsecured names
    });
    pendingRoomEdition = null; // consumed — never leak into the next room
    refreshGold(); // sync server-authoritative balance into HUD cache on join
    // Kick off heartbeat so the path stays warm.
    startHeartbeat();
  });

  ws.addEventListener("message", (e) => {
    if (game.socketSession !== session) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "pong") {
      clearTimeout(game.pongTimer); // heartbeat acked — connection is alive
      game.pongTimer = null;
      return;
    }
    onServerMessage(msg);
  });

  // A socket error always precedes/forces a close; close() makes the reconnect path fire.
  ws.addEventListener("error", () => { try { ws.close(); } catch {} });

  ws.addEventListener("close", () => {
    dramaStop(); // no more snapshots will arrive to stop the tick — kill it now
    // Stale or intentional close — leaveRoom() cleared socketSession/reconnect, or a
    // newer socket replaced this one. Reconnecting would resurrect a zombie WS that
    // streams snapshots into home/hub/profile where the room scaffold is gone.
    if (game.socketSession !== session || !session.reconnect) return;
    stopHeartbeat();
    scheduleReconnect(url, session);
  });
}

// Backoff scheduler. Captures the (url, session) so a later leaveRoom()/supersede can
// cancel us, and stashes a `pendingReconnect` handle so an online/focus event can pull
// the retry forward instead of waiting out the backoff.
function scheduleReconnect(url, session) {
  setConnectionStatus("reconnecting");
  game.pendingReconnect = { url, session };
  // Arm the gentle notice once. It only paints if we're still down after the grace window.
  if (!game.reconnectNoticeTimer && !document.querySelector(".net-pill")) {
    game.reconnectNoticeTimer = setTimeout(showReconnectNotice, RECONNECT_NOTICE_AFTER_MS);
  }
  const attempt = game.reconnectAttempts++;
  // Exponential backoff with ±30% jitter; first attempt is near-instant.
  const capped = Math.min(RECONNECT_FIRST_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const delay = attempt === 0 ? RECONNECT_FIRST_MS : capped * (0.7 + Math.random() * 0.6);
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = setTimeout(() => {
    game.reconnectTimer = null;
    if (game.socketSession !== session || !session.reconnect) return;
    openSocket(url);
  }, delay);
}

// Pull a pending reconnect forward — fired when the network returns or the tab regains
// focus. Network's back, so reset backoff and retry immediately instead of idling.
function reconnectNow() {
  const pending = game.pendingReconnect;
  if (!pending) return;
  const { url, session } = pending;
  if (game.socketSession !== session || !session.reconnect) return;
  if (game.ws && (game.ws.readyState === WebSocket.OPEN || game.ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = null;
  game.reconnectAttempts = 0;
  openSocket(url);
}

function startHeartbeat() {
  stopHeartbeat();
  game.heartbeatTimer = setInterval(() => {
    const ws = game.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { return; }
    // Watchdog: a socket can read OPEN while the underlying path is dead (half-open TCP,
    // sleeping radio). If the pong doesn't land, close it so the reconnect loop kicks in.
    clearTimeout(game.pongTimer);
    game.pongTimer = setTimeout(() => {
      game.pongTimer = null;
      try { ws.close(); } catch {}
    }, PONG_TIMEOUT_MS);
  }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (game.heartbeatTimer) {
    clearInterval(game.heartbeatTimer);
    game.heartbeatTimer = null;
  }
  if (game.pongTimer) {
    clearTimeout(game.pongTimer);
    game.pongTimer = null;
  }
}

function setConnectionStatus(state) {
  // Ambient cue only: the brand dot breathes in the accent color while reconnecting —
  // calm, on-brand, never alarming. The explicit signal (for sustained outages) is the pill.
  const dot = document.querySelector(".brand-dot");
  if (!dot) return;
  if (state === "ok") {
    dot.style.color = "";
    dot.style.animation = "";
  } else {
    dot.style.color = "var(--accent)";
    dot.style.animation = "pulse 1.6s ease-in-out infinite";
  }
}

// The gentle reconnect notice — a frosted glass pill, not the stark error toast. Only ever
// shown when an outage outlasts RECONNECT_NOTICE_AFTER_MS; removed the instant we're back.
function showReconnectNotice() {
  game.reconnectNoticeTimer = null;
  if (document.querySelector(".net-pill")) return;
  const pill = document.createElement("div");
  pill.className = "net-pill";
  pill.innerHTML = '<span class="net-pill-dot"></span><span>Reconnecting…</span>';
  document.body.appendChild(pill);
}
function clearReconnectNotice() {
  clearTimeout(game.reconnectNoticeTimer);
  game.reconnectNoticeTimer = null;
  const pill = document.querySelector(".net-pill");
  if (pill) {
    pill.classList.add("net-pill-out");
    setTimeout(() => pill.remove(), 240);
  }
}

// Register once: the OS/browser tells us exactly when recovery is possible. Reacting to
// these beats waiting out a backoff timer — flip back to the tab and you're already in.
addEventListener("online", reconnectNow);
addEventListener("focus", reconnectNow);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reconnectNow(); });

function send(msg) {
  if (game.ws && game.ws.readyState === WebSocket.OPEN) {
    game.ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

// Pull the server-authoritative gold balance into the HUD cache. The server (USER
// ledger) is the source of truth; localStorage is just a display mirror now.
function refreshGold() {
  const name = getUsername();
  if (!name) return;
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p) return;
      if (typeof p.gold === "number") { setGold(p.gold); renderGoldHud(); }
      // Cache the head-to-head map so the in-room badge can show "You vs <opp> W–L".
      // It only ever contains personas (the server writes h2h for seeded rooms only), so
      // looking up a live opponent's username naturally scopes the badge to bot rooms.
      game.myH2H = p.h2h || {};
      renderH2HBadge();
    })
    .catch(() => {});
}

// DAILY round-score (§A): discoveries + penalties during a daily must NOT move the sacred
// ◆ gold wallet — that mint is server-authoritative and cashed out ONCE at the end. So in a
// daily we route the payout/drain choreography through this ephemeral counter instead. It's
// backed by game.goldThisRound (the same running per-round tally the end screen reads), and
// it paints #roundScore. Both daily and race rooms route through this adapter; the ◆ wallet only moves at settlement.
const roundScoreWallet = {
  get: () => game.goldThisRound || 0,
  add: (d) => { game.goldThisRound = (game.goldThisRound || 0) + d; },
  drain: (d) => { game.goldThisRound = (game.goldThisRound || 0) - d; },
};
// The chip prefix the count-up animation prepends to the number, so the static render and the
// animated ticks share one format ("<label> <n>"). animateCount writes `${prefix}${n}`, so the
// label lives in the prefix; keep the trailing space.
const SCORE_PREFIX = () => (game.isDaily ? t("daily.roundScorePrefix") : t("race.scorePrefix")) + " ";
// Paint the round-score chip from the current tally — and OWN its visibility. Every static
// paint (render loop, power-up drains, post-tween settles) routes through here, so the
// iter3 §2 gate (pure shouldShowRoundScore in lobby-view.js: never in the lobby phase,
// never a zero tally) lives in exactly one place. The payout animation tweens the number
// itself (via the wallet adapter + #roundScore as its hud); this is the static render used
// on mount / reveal so the chip is never blank or stale between animated ticks.
function renderRoundScore() {
  const el = $("#roundScore");
  if (!el) return;
  const snap = game.snapshot;
  const me = snap && (snap.players || []).find((p) => p.username === getUsername());
  if (!shouldShowRoundScore(snap && snap.phase, me && me.status, game.goldThisRound)) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `${SCORE_PREFIX()}${game.goldThisRound || 0}`;
}

// In-room head-to-head record against the current opponent, shown beside the room name.
// Keyed off the opponent's VISIBLE username (no bot-only field on the wire) — present in
// game.myH2H only for personas the player has faced before.
function renderH2HBadge() {
  const nameEl = $("#roomName");
  if (!nameEl) return;
  let badge = $("#roomH2H");
  const snap = game.snapshot;
  const me = getUsername();
  const h2h = game.myH2H || {};
  let text = "";
  if (snap && me) {
    const opp = (snap.players || []).find((p) => p.username !== me);
    const rec = opp && h2h[opp.username];
    if (rec) {
      const oppName = opp.username.charAt(0).toUpperCase() + opp.username.slice(1);
      text = `You vs ${oppName} ${rec.w}–${rec.l}`;
    }
  }
  if (!text) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "roomH2H";
    badge.className = "room-h2h";
    nameEl.insertAdjacentElement("afterend", badge);
  }
  badge.textContent = text;
}

function onServerMessage(msg) {
  if (msg.type === "snapshot") {
    const prev = game.snapshot;
    game.snapshot = msg.room;
    // Ghost race: a server snapshot only ever carries the solo player — re-graft the
    // ghost field so renders between replay ticks never drop the opponents.
    if (game.ghostPlayers && game.ghostPlayers.length) {
      game.snapshot.players = [...msg.room.players, ...game.ghostPlayers];
    }
    // Daily finisher token: the server hands it ONLY to a viewer who's completed today.
    // Stash it per-date so the home recap can unlock everyone's letter-boards. Never sent
    // to a still-playing client, so it can't leak today's answer.
    if (msg.room.dailyToken && msg.room.isDaily && game.dailyDate) {
      try { localStorage.setItem(`${LS.dailyToken}:${game.dailyDate}`, msg.room.dailyToken); } catch { /* storage off */ }
    }
    // Real-solve tape: arm the recorder the moment the daily is playable for me.
    // tapeStart resumes a same-day crash mirror, so a mid-game reload keeps its early events.
    if (game.isDaily && msg.room.phase === "playing" && !tapeIsLive()) {
      const meT = msg.room.players.find((p) => p.username === getUsername());
      if (meT && meT.status === "playing") tapeStart(game.dailyDate);
    }
    // Live-typing ghosts are transient: drop a player's ghost the moment they commit a guess
    // (their row advanced) or leave the race (won / out / away), so no phantom fill lingers on
    // the new empty row. Done here, before render(), so the board never flashes a stale ghost.
    if (game.typing.size) {
      for (const p of msg.room.players) {
        const before = prev?.players.find((q) => q.username === p.username);
        const committed = before && p.guesses.length > before.guesses.length;
        if (committed || p.status !== "playing" || !p.connected) game.typing.delete(p.username);
      }
    }
    // Drama audio: opponents' progress → stings / danger tick / bust fanfare. Snapshot-
    // driven, so every end-of-round path (win, loss, outpaced, rematch reset) re-evaluates
    // to silence on its own — no per-path stop calls needed.
    dramaUpdate(prev?.players ?? null, msg.room.players, {
      me: getUsername(), maxGuesses: msg.room.maxGuesses ?? 6,
      phase: msg.room.phase, isDaily: !!msg.room.isDaily,
    });
    // The room owns the theme: adopt it whenever it differs from what's applied. This is
    // how invitees inherit the host's theme and how a live change reaches everyone. applyEdition
    // also persists it locally, so your last room's vibe sticks into your next solo game.
    const wantEd = game.isDaily
      ? (msg.room.edition && msg.room.edition !== "default" ? msg.room.edition : getActiveEditionId())
      : msg.room.edition;
    if (wantEd && wantEd !== getActiveEditionId()) { applyEdition(wantEd); applySettings(getSettings()); }
    // The game bundle (daily/room/challenge) carries its voice id (server defaults to "yang") —
    // make it the active voice source so this surface speaks in the world's voice.
    setActiveVoiceId(msg.room.voice ?? null);
    // Vibe Studio: a curated daily ships a colorScheme — re-theme the whole day page from it
    // (a1 → --accent re-lights all the chrome; a1/a2/a3 atoms drive the bespoke palette layers).
    // Non-daily rooms and legacy days pass null → falls back to the active edition's own accent.
    applyColorScheme(game.isDaily ? msg.room.colorScheme : null);
    // EZ-mode hints belong to a single round — wipe them on any new round (start,
    // rematch, or reconnecting into a different round).
    if (msg.room.phase === "playing" && msg.room.round !== game.ezRound) {
      resetRound(msg.room.round);
    }
    // "Start playing" one-shot: kick off the solo game as soon as we're in the
    // lobby. Cleared immediately so a reconnect (which replays a snapshot) can't
    // re-trigger it, and lobby-gated so it never fires mid-game.
    if (game.autoStart && msg.room.phase === "lobby") {
      game.autoStart = false;
      // In a duel room, auto-start goes through the ready-gate so solo still gets the 3-2-1.
      send(msg.room.isDuel ? { type: "ready", ready: true } : { type: "start" });
    }
    // Duel 3-2-1 overlay: enter on the move into countdown, leave when it exits.
    if (prev?.phase !== "countdown" && msg.room.phase === "countdown" && msg.room.goAt) {
      startCountdownOverlay(msg.room.goAt);
    } else if (prev?.phase === "countdown" && msg.room.phase !== "countdown") {
      stopCountdownOverlay();
    }
    // Synchronized start celebration: any transition INTO playing (fresh start or
    // rematch) fires GO! + confetti. Driven by the shared snapshot, so it lands on
    // every player's screen at once. Late joiners (prev === null) don't get it.
    if (prev && prev.phase !== "playing" && msg.room.phase === "playing") {
      triggerStartCelebration();
      resetIdle();
      armGiveUpTimer(); // 💀 give-up only unlocks 3 min into the round
      // Ghost race: GO is t=0 — the original field starts typing beside you now.
      if (game.ghostTape && game.ghostT0 == null) startGhostReplay();
      // Capture client round-start wall time for owner-mint tapes (buildOwnerTape) so the
      // first ghost row can use a real offset instead of the old fixed 4.5s. Set once per round.
      if (msg.room.phase === "playing" && game.myRoundStartAt == null) {
        game.myRoundStartAt = Date.now();
      }
    }
    const me = msg.room.players.find((p) => p.username === getUsername());
    const prevMe = prev?.players.find((p) => p.username === getUsername());
    renderH2HBadge(); // opponent may have just joined; refresh the "You vs X W–L" badge
    // Ghost race verdict: my finish vs the host ghost's recorded finish — one toast,
    // the moment my status flips. Time is the tiebreak story; guesses break a same-time tie.
    if (game.ghostTape && me && prevMe && prevMe.status === "playing" && me.status !== "playing" && game.ghostT0 != null) {
      // Same rule as a live room: the first solve ends the race for EVERYONE. My win
      // freezes the tape and flips still-racing ghosts to OUT (recorded finishes that
      // already replayed stay as they happened). A bust leaves the field racing — just
      // like spectating after going out in a real room.
      if (me.status === "won") endGhostRaceOnMyWin();
      const hf = hostFinish(game.ghostTape);
      if (hf) {
        const myMs = Date.now() - game.ghostT0;
        const ds = Math.max(1, Math.abs(Math.round((hf.t - myMs) / 1000)));
        const iWon = me.status === "won" && (hf.status !== "won" || myMs < hf.t || (myMs === hf.t && me.guesses.length <= hf.guesses));
        toast(iWon
          ? `You beat @${hf.username} by ${ds}s 🏆`
          : me.status === "won" ? `@${hf.username} had you by ${ds}s — rematch?` : `@${hf.username} survives this round 👻`,
          { duration: 5000 });
      }
    }
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
      // Stamp the commit for the mint-time owner tape. A reload loses earlier stamps —
      // buildOwnerTape detects the shortfall and falls back to a fixed cadence.
      game.myGuessTimes.push(Date.now());
      // A valid guess landed. If it didn't end the game, the companion reacts —
      // and in Yang's edition, new greens get a scaled celebration instead.
      if (me.status === "playing" && !game.hasShownEndStats) {
        // Gold flows on progress for EVERY edition: new greens + yellows pay out, with
        // a combo multiplier for multiple hits in one shot. Clearer wins: instead of one
        // lump coin-burst, we SEQUENCE the payout — yellows first, then greens, each its
        // own beat (glow + "+N" floater + HUD tick + ascending chime + a hacker-log line),
        // then a "✦ N× COMBO" finale lands the multiplier last. The TOTAL is identical to
        // the old lump Math.round((ng*green + ny*yellow)*mult); only the timing is staged.
        const discoveryList = orderedDiscoveriesInLast(me.guesses).map((d) => ({
          ...d,
          value: d.kind === "hot" ? GOLD.hot : GOLD.warm,
        }));
        const ng = discoveryList.filter((d) => d.kind === "hot").length;
        const ny = discoveryList.filter((d) => d.kind === "warm").length;
        const discoveries = discoveryList.length;
        const mult = comboMultiplier(discoveries);
        const base = discoveryList.reduce((s, d) => s + d.value, 0);
        const total = Math.round(base * mult); // ← exactly the old `earned`
        const bonus = total - base;
        const guessIndex = me.guesses.length - 1;
        const flipDoneMs = me.guesses[guessIndex].word.length * REVEAL_STAGGER_MS + REVEAL_FLIP_HALF_MS;

        // Loss penalty (C2) — HARD MODE ONLY: reusing a known-dead letter (proven wrong by
        // a PRIOR guess, duplicate-letter safe) drains gold per wasted letter, capped per
        // guess. Repeat the SAME mistake and it escalates via game.deadLetterReuse. We
        // read-then-increment the Map NOW (deterministic, once per accepted guess); the
        // drain itself is deferred so it lands AFTER the win payout finishes — never racing
        // the HUD tween. Off hard mode the reuse still gets companion commentary (below)
        // but costs nothing and triggers no mistakeFx — the drain+buzz felt punishing for
        // casual play (user call, Jun 7 2026; per-world config may re-open this later).
        // Twin contract: the server's pointsEarned gates on the same flag (sent per guess).
        const wasted = wastedDeadLettersInLast(me.guesses);
        let penalty = 0;
        const penaltyLines = [];
        if (activeDifficulty() === "hard") {
          for (const letter of wasted.letters) {
            const reuse = game.deadLetterReuse.get(letter) ?? 0;
            const pen = escalatedPenalty(GOLD.wastedLetterPenalty, reuse);
            penalty += pen;
            penaltyLines.push(`${"bad ".repeat(reuse + 1).trim()}  ${letter}  −${pen}`);
            game.deadLetterReuse.set(letter, reuse + 1);
          }
          penalty = Math.min(penalty, GOLD.wastedCapPerGuess);
        }
        // §A everywhere (settlement spec): in EVERY mode the payout/drain choreography
        // drives the EPHEMERAL #roundScore — the sacred ◆ wallet moves only at settlement.
        // onDone re-applies the visibility gate once a tween lands, so a drain ending
        // exactly on 0 doesn't leave "Score 0" painted until the next render() pass.
        const payoutOpts = { wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX(), onDone: renderRoundScore };
        // Drain + red log lines. Caller owns the line text; goldDrain stays generic.
        const runDrain = () => {
          if (penalty <= 0) return;
          if (!game.snapshot || game.hasShownEndStats) return; // game ended / left room — don't drain off-screen
          const reducedMotion = getSettings().reducedMotion;
          goldDrain(penalty, reducedMotion, playChime, payoutOpts);
          const log = getHacklog();
          for (const line of penaltyLines) log?.logLine(line, { tone: "loss" });
          mistakeFx(activeMistakeFx(), wasted.letters); // sensory punishment for the sloppy reuse (room-themed)
          checkBankruptcy(powerupsCtx); // C4: a wasted-letter drain may bankrupt Hard difficulty
        };
        // Valid-word bonus: EVERY accepted guess pays a flat tick — even a zero-discovery
        // shot in the dark — so a real word never lands as dead air. Deliberately quiet:
        // no coin-rain (reducedMotion=true to awardGold), just the HUD tick + a log line.
        // Twin contract: GOLD.validWord === POINTS.validWord; the server's pointsEarned
        // pays the same flat bonus per accepted non-winning row. (The final LOSING row
        // skips this branch — its +25 still lands server-side in the settlement mint.)
        const runValidWordBonus = () => {
          if (!game.snapshot || game.hasShownEndStats) return; // game ended / left room
          awardGold(GOLD.validWord, true, payoutOpts);
          getHacklog()?.logLine(`valid word  +${GOLD.validWord}`, { tone: "gain" });
        };

        if (discoveries > 0) {
          // Replay tracks the running balance: the ROUND SCORE in every mode (the ◆ wallet is
          // frozen until settlement). Either way balanceAfter =
          // before + total, since the sequence awards exactly `total`.
          const balanceBefore = game.goldThisRound || 0;
          recordReplayEntry({
            guessIndex,
            events: discoveryList.map((d) => ({
              kind: d.kind, index: d.index, letter: d.letter, delta: d.value,
            })),
            combo: { discoveries, mult, bonus },
            balanceAfter: balanceBefore + total,
          });
          const reducedMotion = getSettings().reducedMotion;
          const log = getHacklog();
          // Start the payout after the row finishes flipping, so coins land as colors do.
          // payingOut is flipped on INSIDE the deferred callback (not now): setting it
          // before this snapshot's render() would make renderBoards preserve my OLD board
          // and skip drawing the freshly-flipped colored row — so colors wouldn't appear
          // until the whole payout finished. By the time the payout starts the colors are
          // already revealed, and the guard still protects the coin-floater animations.
          deferPayout(() => {
            game.payingOut = true;
            playPayoutSequence({
              discoveries: discoveryList,
              mult,
              ...payoutOpts, // §A: round-score wallet + #roundScore in every mode
              getTile: getMyFreshTile,
              log,
              playChime,
              celebrateCombo,
              reducedMotion,
            }).finally(() => {
              game.payingOut = false;
              // The flat valid-word tick lands right after the discovery beats…
              runValidWordBonus();
              // …then the drain, spaced past the tick's 650ms tween so the HUD tweens
              // never race on the same element (animateCount has no cancel guard). The
              // win lands before the loss bites.
              if (penalty > 0) deferPayout(runDrain, 700);
              if (log) deferPayout(() => log.collapse(), penalty > 0 ? 1450 : 1050);
            });
          }, flipDoneMs);
        } else {
          // No discoveries this guess — the valid-word tick (and any drain, spaced past
          // the tick's tween) land once the row finishes flipping.
          deferPayout(() => {
            runValidWordBonus();
            if (penalty > 0) deferPayout(runDrain, 700);
          }, flipDoneMs);
        }
        // Never silent: every accepted guess resolves to exactly ONE companion event,
        // on EVERY edition. Yang's green confetti stays Yang-only + cosmetic; voice is global.
        const { event: guessEvent, ctx: guessCtx } = pickGuessEvent(ng, ny, wasted.letters.length > 0);
        if (getActiveEditionId() === "yang" && guessEvent === "greens") {
          setTimeout(() => celebrateGreens(ng), flipDoneMs); // celebrateGreens internally showCompanion("greens",{count})
        } else {
          setTimeout(() => showCompanion(guessEvent, guessCtx), flipDoneMs);
        }
        resetIdle();
      }
    }
    // Three ways the game ends from my perspective (the room may keep running for others):
    //   (a) phase transitions to finished (everyone is done)
    //   (b) I personally ran out of guesses while the room continues
    //   (c) I personally SOLVED it while the room continues — others race on for their gold
    // Each fires my end sequence (handleGameOver branches on won/lost).
    const phaseEnded = prev && prev.phase !== "finished" && msg.room.phase === "finished";
    const personallyLost = prevMe?.status === "playing" && me?.status === "lost";
    const personallyWon = prevMe?.status === "playing" && me?.status === "won";
    // Daily owns its OWN reveal (#dailyUnlock: goody + curated story + bridge), so the
    // generic stats/challenge/share modal must NOT also fire for daily — it would stack
    // over and bury the curated reveal.
    if ((phaseEnded || personallyLost || personallyWon) && !game.hasShownEndStats && !game.isDaily) {
      handleGameOver(msg.room);
    }
    // Forfeit's deferred reveal: forfeit() resigns BEFORE the server has told us the word
    // (per-viewer snapshots only reveal it once we're marked lost), so it arms this one-shot
    // instead of announcing a wordless reveal. The first snapshot that carries the word
    // completes the announcement — toast + spoken word. Fires for races AND daily (forfeit
    // set hasShownEndStats, so neither generic path re-announces).
    if (game.pendingForfeitReveal && msg.room.word) {
      game.pendingForfeitReveal = false;
      announceGameEnd({ won: false, answer: msg.room.word });
    }
    if (msg.room.phase === "finished") {
      // Settlement spec: the receipt (server-confirmed mint) drives the show. It may arrive
      // on a FOLLOW-UP snapshot (the confirmed re-broadcast), so run on whichever snapshot
      // first carries it — once. No receipt (mint failed / old server)? The plain
      // refreshGold reconcile below still keeps the wallet true.
      // First receipt-bearing snapshot fires the show, which owns the wallet HUD until it
      // lands on server truth — a concurrent refreshGold could yank the count-up around.
      // Every other finished snapshot (no receipt yet / already shown / daily) reconciles plainly.
      if (!maybeRunSettlement(msg)) refreshGold();
    }
    // Daily rooms never globally "finish" (per-player async scoring) — so once YOU are
    // personally done, run the honest §B CASH-OUT: a single ONLY-UP animation that counts
    // the ◆ wallet up by the server-confirmed mint (me.goldAwarded) with coins flying onto
    // the pile. NOT keyed to the won/lost transition edge: the server's early "fast board
    // flip" snapshot flips status BEFORE the mint lands, so the cash-out waits for the
    // follow-up snapshot that carries a confirmed goldAwarded (dailyCashOutReady) — firing
    // on the edge cashed out 0 and stranded the HUD at the pre-mint balance (the ◆0 bug).
    if (game.isDaily && (personallyWon || personallyLost)) {
      game.pendingCashOut = true; // ARM on the transition edge (this session earned it)…
      captureDailySolve(game.dailyDate, me); // client-only — powers the home's letter stamp
      // The end moment, timed to land as the final row's flip completes (same 1500ms
      // pacing handleGameOver uses for races). The transition edge fires this exactly
      // once; reloads of a finished daily stay quiet. quip:false — the curated
      // #dailyUnlock owns the screen, so it's speech (+ win chime) only.
      // hasShownEndStats guard: on a daily it's only ever set by forfeit(), which already
      // announced the loss — without it a give-up would speak the reveal twice.
      if (!game.hasShownEndStats) {
        const answer = msg.room.word || (personallyWon ? me.guesses[me.guesses.length - 1]?.word : null); // a win's last guess IS the word
        // delayMs 2200: let the settlement's points/gold animation land first, so the framed
        // spoken reveal ("…the word is {answer}" + meaning) trails it rather than talking over it.
        announceGameEnd({ won: personallyWon, answer, guessesUsed: me.guesses.length, delayMs: 2200, quip: false });
      }
    }
    // …FIRE once the mint confirms. The arm/fire split matters twice over: a reloaded
    // already-finished daily has goldAwarded on its first snapshot but no transition (no
    // replayed coin-rain), and a reconnect AFTER arming still cashes out on the re-join
    // snapshot if the confirmed one was lost to the dropped socket.
    if (game.isDaily && game.pendingCashOut && dailyCashOutReady(me, game.cashedOut)) {
      // Pass the answer (room.word covers a LOSS too, so the lesson shows when you most need it).
      const dailyAnswer = msg.room.word || (me.status === "won" ? me.guesses?.[me.guesses.length - 1]?.word : null);
      cashOutDaily(me, dailyAnswer);
    }
    // File the tape exactly once when MY daily game reaches a terminal status. Covers
    // win, loss, AND resign; also files a crash-mirror from an earlier tab (the server
    // accepts the first write only, so a duplicate send is harmless).
    // Deferred past flipDoneMs: the final guess's companion reaction fires inside the
    // row-flip setTimeout (~1.5s above), and tapeForUpload detaches the live recorder —
    // uploading synchronously here would drop every tape's climax line.
    if (game.isDaily && me && me.status !== "playing" && !game.tapeSent) {
      game.tapeSent = true; // sync, so repeat snapshots can't double-schedule
      const tapeDate = game.dailyDate;
      setTimeout(() => {
        // Left the room (leaveRoom nulls dailyDate / clears isDaily) or switched days:
        // don't touch the tape — tapeSuspend flushed it to the mirror, and the next
        // visit's terminal snapshot files it via the crash-mirror path above.
        if (!game.isDaily || game.dailyDate !== tapeDate) return;
        const tape = tapeForUpload(tapeDate);
        if (tape) send({ type: "tape", events: tape.events, truncated: tape.truncated });
      }, TAPE_UPLOAD_DELAY_MS);
    }
    render();
  } else if (msg.type === "invalid_guess") {
    // Shake the row and toast prominently, but DON'T burn a guess slot. The gold is
    // the cost (C2). The letters auto-clear once the shake lands (below).
    flashShake();
    const reason = msg.reason || "not a word";
    if (SHOW_REJECT_TOAST) toast(`${reason} — doesn't count, try again`, { error: true, duration: 2500 });
    showCompanion("invalid");
    tapeRecord("r");
    // Only MY live turn is penalized: a late / duplicate / out-of-phase reject must not
    // silently subtract gold or inch me toward the 💀 offer with no visible cause.
    const meNow = game.snapshot?.players.find((p) => p.username === getUsername());
    if (!meNow || meNow.status !== "playing" || game.hasShownEndStats) return;
    // Penalty: a non-word submit drains gold + a red hacker-log line.
    // game.pending still holds the rejected letters (we never cleared them above).
    const rejected = (game.pending || "").toUpperCase();
    const reducedMotion = getSettings().reducedMotion;
    // §A everywhere (settlement spec): drain the EPHEMERAL #roundScore in every mode —
    // the sacred ◆ wallet never moves mid-game; it moves only at settlement.
    goldDrain(GOLD.invalidPenalty, reducedMotion, playChime, {
      wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX(),
      onDone: renderRoundScore, // gate re-applies post-tween (a drain to exactly 0 hides the chip)
    });
    const log = getHacklog();
    log?.logLine(
      `rejected  ${rejected || reason}  −${GOLD.invalidPenalty}`,
      { tone: "loss" },
    );
    // C4: a rejected submit is an error (surfaces 💀 after enough) and a drain (may
    // tip Hard difficulty into bankruptcy).
    bumpErrorCount(powerupsCtx);
    checkBankruptcy(powerupsCtx);
    // Remember the dud: re-submitting the identical word is handled locally by
    // submitGuess — instant shake + toast, no round trip, and NO second −50 drain.
    // (The THESS incident, Jun 5: Enter mashed on one unseen typo cost −50 a press.)
    game.lastRejected = { word: rejected, reason };
    // …and sweep the row once the shake lands. On a phone the rejected letters can
    // sit behind the keyboard, invisible — leaving them in is what invited the Enter
    // mashing. Skip if the player already started editing the row.
    setTimeout(() => {
      if ((game.pending || "").toUpperCase() === rejected && !game.hasShownEndStats) clearRow({ silent: true });
    }, 550);
  } else if (msg.type === "typing") {
    // An opponent's live row length (anonymous — count only). Patch just their ghost row
    // in place; a full render() per keystroke would nuke in-flight board animations.
    if (msg.username && msg.username !== getUsername()) {
      const len = Math.max(0, msg.len | 0);
      if (len > 0) game.typing.set(msg.username, len);
      else game.typing.delete(msg.username);
      updateOpponentGhost(msg.username);
    }
  } else if (msg.type === "revealed_letter" || msg.type === "vowels") {
    handlePowerupMessage(powerupsCtx, msg);
    tapeRecord("p", msg.type);
  } else if (msg.type === "rematch_proposed") {
    if (msg.proposer !== getUsername()) renderRematchPrompt(msg.proposer);
  } else if (msg.type === "rematch_accepted") {
    game.hasShownEndStats = false;
    game.pendingForfeitReveal = false; // the rematch round must not inherit a stale reveal
    renderRematchIdle();
    closeStats();
  } else if (msg.type === "rematch_cancelled") {
    settleRematchHome(msg.reason, opponentName());
  } else if (msg.type === "arena_handoff") {
    // The arena race already has its 1 human — but their word is published as a
    // challenge. Route there: same word, their ghosts, a score to beat. No dead end.
    const who = msg.host ? `@${msg.host}` : "your friend";
    toast(msg.hostDone
      ? `${who} already raced this word — your turn.`
      : `${who} is racing this word right now — race it too.`, { duration: 4200 });
    navigate(`/c/${msg.challengeId}`);
  } else if (msg.type === "error") {
    toast(msg.message || "Error", { error: true });
  }
}

// --- Render ---

// --- Room tabs (Play / Games / Players) ---
// Tabs are a between-games surface; active guessing stays immersive (board only,
// driven by body.playing). Off-play, the active tab gates the three panels.

function wireRoomTabs() {
  const tabs = $("#roomTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".room-tab").forEach((btn) => {
    btn.addEventListener("click", () => setRoomTab(btn.dataset.tab));
  });
  updateTabUI();
}

function setRoomTab(tab) {
  game.roomTab = tab;
  updateTabUI();
  applyTabVisibility(game.snapshot?.phase === "playing");
}

function updateTabUI() {
  $("#roomTabs")?.querySelectorAll(".room-tab").forEach((b) => {
    const on = b.dataset.tab === game.roomTab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  });
}

function applyTabVisibility(playing) {
  const play = $("#tabPlay"), games = $("#tabGames"), players = $("#tabPlayers");
  if (!play) return;
  if (playing) {
    // Immersive: board only. #tabPlayers wrapper stays present so the .playing CSS
    // (and its hub-reveal peek) keeps owning #scoreboard.
    play.hidden = false;
    games.hidden = true;
    players.hidden = false;
    return;
  }
  play.hidden = game.roomTab !== "play";
  games.hidden = game.roomTab !== "games";
  players.hidden = game.roomTab !== "players";
}

// The "underneath", revealed once you finish today's word: a goody line, the story behind
// the word, and a one-tap bridge back to the hub. Idempotent per snapshot.
// snap.story may be null (house day / World fetch failed) — goody + bridge still render.
function renderDailyUnlock(snap, me) {
  const box = $("#dailyUnlock");
  if (!box) return;
  const done = me && me.status !== "playing";
  box.hidden = !done;
  // The ◆ Dare ◆ pill now lives in its own wrap, lifted into the board↔card gap (it used
  // to be the card's first child). Reveal it with the card; its faded→lit activation is
  // wired once here, ahead of the board replay that renderBoards kicks off below.
  const dareWrap = $("#dailyDareWrap");
  if (dareWrap) dareWrap.hidden = !done;
  initDarePillActivation();
  // The ritual stage: once you're done, non-ritual chrome (mute, hacklog, header
  // chat/link) bows out via CSS — see body.daily-ritual in style.css. Toggled (not
  // added) so a not-yet-done render never leaves a stale stage class behind.
  document.body.classList.toggle("daily-ritual", done);
  if (!done) return;
  // The curated day's name (vibeTitle) crowns the reveal — a palette-gradient hero on a
  // themed day (see .daily-vibe-title), inserted once above the goody. Absent on legacy days.
  if (snap.vibeTitle && !box.dataset.vibeTitled) {
    const h = document.createElement("h2");
    h.className = "daily-vibe-title";
    h.id = "dailyVibeTitle";
    h.textContent = snap.vibeTitle;
    box.insertBefore(h, $("#dailyReveal")); // crown the card, above the Broadsheet reveal
    box.dataset.vibeTitled = "1";
  }
  const won = me.status === "won";
  // Only a CONFIRMED gold mint sets player.goldAwarded (a number). Drive both the
  // copy and the celebration off it — never claim/float gold the server didn't grant.
  const confirmed = me && typeof me.goldAwarded === "number";
  const award = confirmed ? me.goldAwarded : 0;
  // — The Broadsheet reveal (replaces the old #dailyGoody line): kicker → the word as a
  // serif headline → dictionary entry → credit. Word, entry, and the credit's story link
  // all lead into /word/<word>. Fills once the word is on the wire (it always is once
  // you're done); the minted credit upgrades separately when the server confirms.
  const reveal = $("#dailyReveal");
  const word = (snap.word || "").toUpperCase();
  if (reveal && word && !reveal.dataset.filled) {
    reveal.hidden = false;
    const wiki = `/word/${word.toLowerCase()}`;
    $("#dailyRevealKicker").textContent = t(won ? "daily.revealKickerWon" : "daily.revealKickerLost");
    const wordEl = $("#dailyRevealWord");
    wordEl.textContent = word;
    wordEl.href = wiki;
    wordEl.setAttribute("aria-label", `${word} — ${t("daily.revealStory", { word })}`);
    const entry = $("#dailyRevealEntry");
    const intel = wordIntel(word);
    if (intel?.def) { entry.textContent = intel.def; entry.href = wiki; } else entry.hidden = true;
    const storyLink = $("#dailyRevealStory");
    storyLink.textContent = t("daily.revealStory", { word });
    storyLink.href = wiki;
    reveal.dataset.filled = "1";
  }
  // The minted credit — same mint-confirmed contract as cashOutDaily: appears only once
  // the server's goldAwarded lands (the ◆0 race fix, papa Jun 5 2026), never fabricated.
  const mintEl = $("#dailyRevealMint");
  if (mintEl && confirmed && award > 0 && !mintEl.dataset.filled) {
    mintEl.textContent = t("daily.revealMint", { gold: award });
    mintEl.hidden = false;
    mintEl.dataset.filled = "1";
    // GOLD-FLIGHT: celebrate the confirmed gold solve once — bump the HUD + send a few
    // floaters rising toward it. Skipped under reduced motion and on a 0-gold mint.
    if (won && !getSettings().reducedMotion) celebrateDailyUnlock();
  }
  const story = $("#dailyStory");
  // Curated stories ONLY: an unauthored day renders no story block at all. The house
  // fallback ("No curator claimed …") read as filler — houseWorld no longer ships a
  // story, and this guard also hides it in rooms seeded before that change.
  const authoredStory = snap.story && !/^No curator claimed /.test(snap.story.body || "");
  if (story && authoredStory && !story.dataset.filled) {
    const kicker = document.createElement("span"); kicker.className = "daily-story-kicker"; kicker.textContent = t("daily.storyKicker");
    const h = document.createElement("h3"); h.textContent = snap.story.title || t("daily.storyFallbackTitle");
    const p = document.createElement("p"); p.textContent = snap.story.body || "";
    story.append(kicker, h, p);
    if (snap.story.tip) { const tip = document.createElement("p"); tip.className = "daily-tip"; tip.textContent = "💡 " + snap.story.tip; story.appendChild(tip); }
    story.dataset.filled = "1";
  }
  const share = $("#dailyShareBtn");
  if (share && !share.dataset.wired) {
    share.textContent = t("daily.dare");
    // shareDailyResult is gesture-safe here: this listener runs on the tap itself.
    // game.dailyDate: a past-day page must challenge friends to THAT day, not today's.
    share.addEventListener("click", () => shareDailyResult({ won, guesses: me.guesses.length, masks: me.guesses.map((g) => g.mask) }, game.dailyDate));
    share.dataset.wired = "1";
  }
  // The share/invite subline under the lifted pill (no gold promised — sharing mints none).
  const dareSub = $("#dailyDareSub");
  if (dareSub && !dareSub.dataset.wired) {
    dareSub.textContent = t("daily.dareSub");
    dareSub.hidden = false;
    dareSub.dataset.wired = "1";
  }
  // The action rail under the CTA: Wiki · Recap · Past days · Home.
  const wikiL = $("#dailyWikiLink");
  if (wikiL && word && !wikiL.dataset.wired) {
    wikiL.textContent = t("daily.actionWiki");
    wikiL.href = `/word/${word.toLowerCase()}`;
    wikiL.hidden = false;
    wikiL.dataset.wired = "1";
  }
  const recapL = $("#dailyRecapLink");
  if (recapL && game.dailyDate && !recapL.dataset.wired) {
    const statsPath = `/daily/${game.dailyDate}/stats`;
    recapL.textContent = t("daily.actionRecap");
    recapL.href = statsPath;
    recapL.addEventListener("click", (e) => { e.preventDefault(); navigate(statsPath); });
    recapL.hidden = false;
    recapL.dataset.wired = "1";
  }
  const arch = $("#dailyArchiveLink");
  if (arch && !arch.dataset.wired) {
    arch.textContent = t("daily.actionPast");
    arch.addEventListener("click", (e) => { e.preventDefault(); navigate("/daily/archive"); }); arch.dataset.wired = "1";
  }
  const home = $("#dailyHomeLink");
  if (home && !home.dataset.wired) {
    home.textContent = t("daily.actionHome");
    home.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); }); home.dataset.wired = "1";
  }
  // Today's winners board — mounted once the mint confirms (the finisher token from the
  // same snapshot is already in localStorage by now; see wr.dailyToken storage above).
  const lb = $("#dailyLeaderboard");
  if (lb && confirmed && game.dailyDate && getUsername()) {
    mountDailyLeaderboard({ mount: lb, date: game.dailyDate, username: getUsername(), t });
  }
}

// The daily solve's gold-flight: pulse the gold HUD and float a few coins from the
// goody line up toward it. Pure presentation, reuses the room's existing gold-motion
// vocabulary (.gold-floater + .gold-hud.gold-bump). Caller guards reduced-motion.
function celebrateDailyUnlock() {
  const hud = $("#goldHud");
  if (hud) { hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump"); }
  const origin = ($("#dailyRevealWord") || $("#dailyUnlock"))?.getBoundingClientRect();
  if (!origin) return;
  // a small, intentional flight — 5 coins, staggered, drifting up (the .gold-floater
  // keyframe rises and fades; that reads as coins lifting toward the HUD).
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const f = document.createElement("div");
      f.className = "gold-floater";
      f.textContent = "◆";
      f.style.left = `${origin.left + origin.width * (0.3 + Math.random() * 0.4)}px`;
      f.style.top = `${origin.top + origin.height * 0.5}px`;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 800);
    }, i * 90);
  }
}

// Race settlement show (§C): fires exactly once per round on the first snapshot that carries
// my receipt (server-confirmed mint). The receipt may arrive on a FOLLOW-UP snapshot (the
// re-broadcast after the ledger write), so we poll every finished-phase snapshot.
// Daily flow is completely unaffected (game.isDaily guard).
let settlementShown = false; // reset in resetRound() alongside cashedOut
function maybeRunSettlement(msg) {
  if (settlementShown || game.isDaily) return false;
  const me = (msg.room.players || []).find((p) => p.username === getUsername());
  if (!me || !me.receipt) return false;
  settlementShown = true;
  const name = getUsername();
  if (!name) return true;
  // ONLY-UP: fetch truth, pin HUD to (balance − payout), let the show count it up.
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      const balance = p && typeof p.gold === "number" ? p.gold : null;
      if (balance == null) { refreshGold(); return; }
      const pre = Math.max(0, balance - Math.max(0, me.receipt.payout));
      setGold(pre); renderGoldHud();
      // The answer word leads the lexicon celebration; its intel (gloss/example/ipa/pos)
      // teaches the word. A win's last guess IS the word, covering snapshots where
      // room.word isn't revealed yet. Intel ships only for words that have it (5-letter
      // today) — other lengths gracefully show the word + gold tail with no meaning lines.
      const answer = msg.room.word || (me.status === "won" ? me.guesses?.[me.guesses.length - 1]?.word : null);
      const intel = answer ? (wordIntel(answer) || {}) : {};
      return renderSettlement(me.receipt, {
        reducedMotion: getSettings().reducedMotion,
        walletBefore: pre,
        onWalletTick: (v) => { setGold(v); renderGoldHud(); },
        playChime,
        word: answer,
        outcome: me.status,
        gloss: intel.gloss, example: intel.example, ipa: intel.ipa, pos: intel.pos, def: intel.def,
      });
    })
    .catch(() => refreshGold());
  return true;
}

// §B CASH-OUT — the honest, ONLY-UP gold reveal at the end of a daily. During play the
// sacred ◆ wallet never moved (discoveries pumped the ephemeral #roundScore instead); the
// server minted the real gold once, server-authoritatively. So at finish we count the ◆ HUD
// UP from its pre-mint value to pre-mint + mint, fly coins onto the pile. The displayed mint
// is the SERVER's confirmed me.goldAwarded — never fabricated. Idempotent per solve
// (guarded by game.cashedOut). The score/daily/speed breakdown is animated by the settlement
// overlay (dailyReceiptLines) and recorded in the gold ledger — no longer duplicated on the
// broadsheet card (slimmed 2026-06-23), so the card stays the word + the lasting actions.
const DAILY_GOLD_BONUS = 100; // mirrors src/room.ts DAILY_GOLD_BONUS — feeds the overlay's daily line
function cashOutDaily(me, answer = null) {
  if (game.cashedOut) return;
  game.cashedOut = true;
  const mint = (me && typeof me.goldAwarded === "number") ? Math.max(0, me.goldAwarded) : 0;
  const dailyBonus = mint > 0 ? DAILY_GOLD_BONUS : 0; // the overlay's dailyReceiptLines splits the rest
  const reducedMotion = getSettings().reducedMotion;
  // Reconcile from the server (source of truth), then run the ritual. The receipt
  // (server-confirmed, attached only after the mint ledger write) drives the same
  // supernova settlement Duel/Arena get — daily-flavored lines. No receipt (old
  // server / mint raced the snapshot)? The legacy coin-rain still fires, so the
  // moment is never silent. ONLY-UP either way: pin HUD to (balance − mint) first.
  const name = getUsername();
  if (!name) { refreshGold(); return; }
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      const balance = p && typeof p.gold === "number" ? p.gold : null;
      if (balance == null) { refreshGold(); return; }
      if (mint <= 0) { setGold(balance); renderGoldHud(); return; }
      const pre = Math.max(0, balance - mint);
      if (me.receipt) {
        setGold(pre); renderGoldHud();
        // The daily answer (passed in — covers a loss) leads the lexicon celebration; its
        // intel teaches the word. Falls back to a solved daily's last guess.
        const word = answer || (me.status === "won" ? me.guesses?.[me.guesses.length - 1]?.word : null);
        const intel = word ? (wordIntel(word) || {}) : {};
        renderSettlement(me.receipt, {
          reducedMotion, // supernova handles reduced motion with its static lines path
          walletBefore: pre,
          onWalletTick: (v) => { setGold(v); renderGoldHud(); },
          playChime,
          lines: dailyReceiptLines(me.receipt, dailyBonus, t),
          bonusCaption: t("settle.caption.dailyBonus"),
          word,
          outcome: me.status,
          gloss: intel.gloss, example: intel.example, ipa: intel.ipa, pos: intel.pos, def: intel.def,
        }).then(() => replayMyDailyBoard(me)); // overlay's gone — now the board takes its bow
        return;
      }
      if (reducedMotion) { setGold(balance); renderGoldHud(); return; }
      setGold(pre); renderGoldHud();
      awardGold(mint, false); // legacy fallback: tween (balance − mint) → balance, coins fly
    })
    .catch(() => refreshGold());
}

// Live-finish bow: once the supernova settlement tears down, YOUR board plays itself
// back (type-in + signature flips). The cold-render path (renderBoards → autoPlayBoardOnce)
// covers revisits; this covers the finish you just played — the settlement overlay sat
// over the board until now, so without this the moment ended on a flat board.
function replayMyDailyBoard(me) {
  if (!me?.guesses?.length || getSettings().reducedMotion) return;
  const board = $$(".player-board").find((b) => b.dataset.player === getUsername());
  const grid = board?.querySelector(".grid");
  if (grid) playBoardReplay(grid, me.guesses);
}

function renderGames(snap) {
  const panel = $("#gamesPanel");
  if (!panel) return;
  panel.textContent = "";
  const frag = document.createDocumentFragment();

  if (snap.phase === "playing") {
    const names = snap.players.map((p) => p.username);
    frag.appendChild(gameRow({ live: true, solo: names.length === 1, names, result: "in progress" }));
  }
  const hist = Array.isArray(snap.history) ? snap.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const g = hist[i];
    const names = g.players.map((p) => p.username);
    const winnerP = g.players.find((p) => p.username === g.winner);
    const result = g.winner
      ? `${g.winner === getUsername() ? "you" : g.winner} · ${winnerP?.guesses ?? "?"}/${snap.maxGuesses}`
      : `no one · X/${snap.maxGuesses}`;
    frag.appendChild(gameRow({ live: false, solo: g.solo, names, result, when: relativeTime(g.finishedAt) }));
  }

  if (!frag.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "muted small games-empty";
    empty.textContent = "No games yet. Start one to begin this room's story.";
    panel.appendChild(empty);
    return;
  }
  panel.appendChild(frag);
}

function gameRow(g) {
  const row = document.createElement("div");
  row.className = "game-row" + (g.live ? " is-live" : "");

  const mode = document.createElement("span");
  mode.className = "game-mode";
  mode.dataset.mode = g.solo ? "solo" : "race";
  mode.textContent = g.solo ? "solo" : "race";
  row.appendChild(mode);

  const who = document.createElement("span");
  who.className = "game-who";
  who.textContent = g.names.map((n) => (n === getUsername() ? "you" : n)).join(g.solo ? "" : " vs ");
  row.appendChild(who);

  const res = document.createElement("span");
  res.className = "game-result";
  if (g.live) {
    const dot = document.createElement("span");
    dot.className = "live-dot";
    res.appendChild(dot);
  }
  res.appendChild(document.createTextNode(g.result));
  row.appendChild(res);

  if (g.when) {
    const when = document.createElement("span");
    when.className = "game-when";
    when.textContent = g.when;
    row.appendChild(when);
  }
  return row;
}

// "Your table" lobby strip: a seat for you (seat 0), one per other joined player, and
// empty placeholders up to room capacity, plus a taken/capacity count. New seats since
// the last render get a `seatin` class so CSS can pop them in. Seats are built with
// createElement/textContent (never innerHTML) — usernames are server-validated but DOM
// construction keeps it XSS-proof regardless.
function renderMyTable(snap) {
  const seatsEl = $("#myTableSeats");
  const countEl = $("#myTableCount");
  if (!seatsEl) return;
  const model = game.challengeId ? ghostSeatModel(game.ghostTape) : seatModel(snap, getUsername());
  // A seat is "new" if it's a taken seat beyond the count we last rendered (front-loaded:
  // you=seat0, then takens in order), so freshly-joined players pop while existing ones stay put.
  const prevTaken = game.lastSeatCount || 0;
  let takenSeen = 0;
  seatsEl.replaceChildren();
  // The empty seat IS the capacity control (Air skin): ＋ adds a chair, the last
  // empty chair carries a ✕. No − n/m + stepper line, no count.
  const actions = emptySeatActions(model, canEditCapacity(snap), { min: MIN_CAPACITY, max: MAX_CAPACITY });
  for (const [i, s] of model.seats.entries()) {
    const el = document.createElement("div");
    if (s.kind === "you") {
      el.className = "seat you";
      const me = getUsername();
      el.textContent = me ? me[0].toUpperCase() : "◆";
      if (snap.isDuel && s.ready) el.classList.add("rdy");
    } else if (s.kind === "taken") {
      el.className = "seat taken";
      takenSeen++;
      // takenSeen counts taken seats 1..N; new ones are those past the previous render's count.
      if (takenSeen > prevTaken) el.classList.add("seatin");
      const name = s.username || "";
      el.textContent = name ? name[0].toUpperCase() : "◆";
      if (snap.isDuel && s.ready) el.classList.add("rdy");
    } else if (s.kind === "ghost") {
      el.className = "seat ghost";
      el.textContent = s.username ? s.username[0].toUpperCase() : "◆";
    } else {
      el.className = "seat empty";
      if (actions.addable) {
        el.classList.add("addable");
        el.textContent = "＋";
        el.title = "Add a seat";
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", "Add a seat");
        el.addEventListener("click", () => stepCapacity(1));
      }
      if (i === actions.removableIndex) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "seat-x";
        x.textContent = "✕";
        x.setAttribute("aria-label", "Remove this seat");
        x.addEventListener("click", (e) => { e.stopPropagation(); stepCapacity(-1); });
        el.appendChild(x);
      }
    }
    seatsEl.appendChild(el);
  }
  // Join sound (iter3 §1): another player just took a seat while we wait. The decision is
  // pure (lobby-view.js): lobby phase only, never the first paint (my own join), and my
  // capacity taps move capacity — not takenSeen — so they stay silent. playChime itself
  // honors wordul.muted. Ghost-tape challenges never ring (no live joins on a tape).
  if (!game.challengeId && shouldChimeOnJoin(game.joinChimeSeen, takenSeen, snap.phase)) {
    playChime([[523, 0], [784, 0.09]]); // soft two-note "someone sat down"
  }
  game.joinChimeSeen = takenSeen;
  game.lastSeatCount = takenSeen;
  // No n/m count for duels — the chairs themselves say it. Challenges keep their
  // "vs N ghosts" line (that strip has no empty seats to read).
  if (countEl) {
    countEl.hidden = !game.challengeId;
    if (game.challengeId) {
      const nGhosts = model.taken - 1;
      countEl.textContent = `vs ${nGhosts} ghost${nGhosts === 1 ? "" : "s"}`;
    }
  }
  // Watchers are company, not seats — a quiet chip after the count.
  const watchEl = $("#myTableWatch");
  if (watchEl) {
    const n = model.watching || 0;
    watchEl.hidden = !n;
    watchEl.textContent = n ? `+${n} watching` : "";
  }
}

function render() {
  if (!game.snapshot) return;
  // A late snapshot can land after we've left the room view: tpl-room is unmounted
  // on home/hub/profile, so the room scaffold (#boards, #lobbyControls, …) is gone.
  // With nothing to draw, bail before dereferencing room-only elements that would
  // throw against the wrong template. #boards is the room scaffold's signature node.
  if (!$("#boards")) return;
  const snap = game.snapshot;
  const me = snap.players.find((p) => p.username === getUsername());

  // Daily hard-gate: until YOU finish (win/give up), only your board is visible.
  // me.status flips to won/lost on completion → the whole "underneath" unlocks.
  const dailyLocked = game.isDaily && (!me || me.status === "playing");
  if (game.isDaily) {
    document.body.classList.add("daily");
    const tabs = $("#roomTabs"); if (tabs) tabs.hidden = dailyLocked; // no leaderboard/games until done
    const nameBtn = $("#roomName"); if (nameBtn) nameBtn.textContent = t("daily.boardTitle", { date: game.dailyDate });
    // The lobby bar's controls (choose-mode / start / play-again) are all meaningless for
    // the daily (it auto-starts, never resets) — hide the otherwise-empty bar entirely.
    const lobbyBar = $(".lobby-bar"); if (lobbyBar) lobbyBar.hidden = true;
  }
  if (game.isDaily) renderDailyUnlock(snap, me);
  // §A: the ephemeral round-score chip rides ABOVE the board while you're still solving,
  // in EVERY mode. The payout animation tweens its number; renderRoundScore paints the
  // static value AND owns the visibility gate (iter3 §2: pure shouldShowRoundScore in
  // lobby-view.js — never in the lobby phase, never a zero tally; hidden once you're
  // done, the settlement screen owns the end state), so the render loop just repaints.
  renderRoundScore();

  // Keep the header name (and tab title) in sync with server renames.
  if (snap.name && snap.name !== game.name) {
    game.name = snap.name;
    const nameEl = $("#roomName");
    if (nameEl) nameEl.textContent = game.name;
    document.title = `${game.name} — Wordul`;
  }

  // A rename can also move the room's URL slug. The old slug still resolves
  // (server-side alias), so we just slide the address bar + share link over to
  // the new one — no reconnect, the socket stays on the same room.
  if (snap.slug && snap.slug !== game.slug) {
    game.slug = snap.slug;
    game.path = `${game.owner}/${game.slug}`;
    history.replaceState(null, "", `/@${game.owner}/${game.slug}`);
  }

  // Lobby controls. Control is shared — anyone present can start/rename/rematch.
  const lobby = $("#lobbyControls");
  const startBtn = $("#startBtn");
  const endControls = $("#endControls");
  const rematchBtn = $("#rematchBtn");

  if (snap.phase === "lobby") {
    lobby.hidden = false;
    endControls.hidden = true;
    syncModePicker(snap);
    if (snap.isDuel) applyDuelReadyButton(startBtn, snap, me);
    else startBtn.hidden = false;
    applySpectatorHint(snap, me);
  } else if (snap.phase === "countdown") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "playing") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "finished") {
    lobby.hidden = true;
    endControls.hidden = false;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
    // Duel: the between-rounds intermission reuses the rematch button as the ready toggle
    // (KOTH replaces the rematch handshake); queued spectators just watch the queue advance.
    if (snap.isDuel) applyDuelReadyButton(rematchBtn, snap, me);
    // Death is final: a finished challenge offers no rematch — one run per player.
    else rematchBtn.hidden = !!game.challengeId;
  }

  syncModeChip(snap);

  // Dimension control (letters × rows) rides above the single-row lobby board — it only
  // makes sense while waiting in the lobby. Repaint from the snapshot every render so a
  // remote change (another player resizing) or the smart-default rows reset shows up.
  const dimWrap = $("#dimWrap");
  if (dimWrap) {
    const inLobby = snap.phase === "lobby";
    dimWrap.hidden = !inLobby;
    if (inLobby) {
      const cols = snap.wordLength, rows = snap.maxGuesses;
      const dimCols = $("#dimCols"); if (dimCols) dimCols.textContent = cols;
      const dimRows = $("#dimRows"); if (dimRows) dimRows.textContent = rows;
      const colVal = $("#colVal"); if (colVal) colVal.textContent = cols;
      const rowVal = $("#rowVal"); if (rowVal) rowVal.textContent = rows;
      const editable = canEditLength(snap);
      dimWrap.classList.toggle("locked", !editable);
      // Disable steppers at bounds (and entirely when not editable).
      const colMinus = $("#colMinus"); if (colMinus) colMinus.disabled = !editable || cols <= MIN_COLS;
      const colPlus = $("#colPlus"); if (colPlus) colPlus.disabled = !editable || cols >= MAX_COLS;
      const rowMinus = $("#rowMinus"); if (rowMinus) rowMinus.disabled = !editable || rows <= MIN_ROWS;
      const rowPlus = $("#rowPlus"); if (rowPlus) rowPlus.disabled = !editable || rows >= MAX_ROWS;
    } else {
      closeDim(); // tearing down the lobby closes any open popover
    }
  }

  // "Your table" seat strip rides alongside the tries badge — lobby-only. Reveal + paint
  // it while waiting; hide (and reset the new-seat tracker) in any other phase.
  // Tape-less challenges auto-start (never sit in lobby), so hide the strip entirely;
  // ghost-tape challenges show the real ghost field instead of the fictional 1/8.
  const myTable = $("#myTable");
  if (myTable) {
    const inLobby = snap.phase === "lobby";
    const show = inLobby && (!game.challengeId || !!game.ghostTape);
    myTable.hidden = !show;
    if (show) renderMyTable(snap);
    else { game.lastSeatCount = 0; game.joinChimeSeen = null; }
  }

  // Lobby rail: only while genuinely waiting in a multiplayer lobby (not the daily, which
  // auto-starts). Any other phase or the daily tears it down so its poll can't leak.
  if (snap.phase === "lobby" && !game.isDaily) mountLobbyRailIfNeeded();
  else teardownLobbyRail();

  // Chat is social — keep it out of sight while you're playing solo, and only
  // surface it (inline on desktop, 💬 button on mobile) once someone else is in
  // the room. `me` is always in snap.players, so >= 2 means real company.
  // Exception: in the lobby phase the right zone hosts chat, so we show the panel even
  // solo (the Global "coming soon" placeholder fills it) — otherwise the zone is empty.
  const hasCompany = snap.players.length >= 2;
  const inLobbyPhase = snap.phase === "lobby" && !game.isDaily;
  const showSocial = game.isDaily ? !dailyLocked : (hasCompany || inLobbyPhase);
  const chatPanel = $("#chatPanel");
  const chatTopBtn = $("#chatTopBtn");
  if (chatPanel) chatPanel.hidden = !showSocial;
  // iter3 §2: the topbar 💬 is the MOBILE PLAY-PHASE sheet trigger only. In the lobby
  // the chat panel (and its chevron pill) is already on screen in the right zone, so a
  // second topbar entry point is clutter — hide it there, keep it during play.
  if (chatTopBtn) chatTopBtn.hidden = !showSocial || inLobbyPhase;
  if (!showSocial) closeChatSheet();
  // The Table/Status tabs (+ dormant Global placeholder) are a LOBBY-ONLY affordance.
  // Outside the lobby — the mobile play-phase sheet, the desktop inline play panel, a
  // finished daily — the tabs hide and chat is forced to the Table pane (user messages),
  // or a lingering Global/Status channel would hide #chatLog and disable #chatInput,
  // silently breaking working chat. System lines keep routing to the Status pane
  // (renderChat) and read back whenever the tabs are next on screen.
  const chatTabs = $("#chatTabs");
  if (!showSocial) {
    if (chatTabs) chatTabs.hidden = true;
  } else if (inLobbyPhase) {
    if (chatTabs) chatTabs.hidden = false;
    renderChatChannel(); // respect the user's chosen Table/Status/Global channel
  } else {
    if (chatTabs) chatTabs.hidden = true;
    if (game.chatChannel !== "table") switchChatChannel("table"); // real log + enabled input
    else renderChatChannel();
  }

  // Immersive UI (C5): mid-play, the in-game header collapses to just avatar +
  // username + gold. Room name, ✎ rename, Share ↗, and the scoreboard hide while
  // you're guessing (all reachable via the avatar hub) and return in lobby/finished.
  setChromeVisibility(snap.phase);

  // Neon Floor lobby (Task 7): in the lobby phase the screen splits into two zones —
  // your game on the left, the floor + chat on the right. body.lobby drives the CSS
  // (hides the .room-info title card + #roomTabs, activates the grid). The Setup · Invite
  // pair (below Start, left zone) stands in for the dropped title-card controls — reveal
  // it in the lobby phase only; it hides elsewhere with the rest of the lobby chrome.
  const isLobby = snap.phase === "lobby";
  document.body.classList.toggle("lobby", isLobby);
  const pair = $("#lobbyPair"); if (pair) pair.hidden = !isLobby;

  renderBoards(snap, me);
  // Two-zone reparenting: move controls/floor/chat into the lobby zones while in lobby,
  // and restore them to their exact original DOM homes on leaving — so playing/finished
  // chrome is byte-for-byte unchanged. Idempotent (re-running with the same phase is a no-op).
  arrangeLobbyLayout(isLobby);
  // Bloom-on-start: the lobby board is a single collapsed row; the first snapshot that
  // leaves lobby has just re-rendered the full grid above — tag #boards once so its rows
  // can animate in (keyframes land in a later task). One-shot: the class is cleared on
  // the next render or after ~600ms, and game.wasLobby below re-arms it for the next lobby.
  if (game.wasLobby && snap.phase !== "lobby") {
    const boards = $("#boards");
    if (boards) {
      boards.classList.add("blooming");
      clearTimeout(game.bloomTimer);
      game.bloomTimer = setTimeout(() => boards.classList.remove("blooming"), 600);
    }
  }
  game.wasLobby = snap.phase === "lobby";
  renderKeyboard($("#keyboard"), me);
  renderChat(snap);
  renderScoreboard(snap);
  renderQueue(snap);
  renderGames(snap);
  applyTabVisibility(snap.phase === "playing");
  // In the lobby the Play/Games/Players tabs collapse away (the two-zone layout owns the
  // screen; the room name lives in the header). They return in playing/finished. The daily
  // already gates #roomTabs on dailyLocked above — don't override that, only hide for lobby.
  const tabsNav = $("#roomTabs");
  if (tabsNav && !game.isDaily) tabsNav.hidden = isLobby;
  renderPowerups(powerupsCtx, snap, me);

  // Show the keyboard only when a guess is actually possible — keeps the lobby
  // unambiguous (no dead keys to mash) and post-game state minimal.
  const kb = $("#keyboard");
  const canType = snap.phase === "playing" && me && me.status === "playing" && (!snap.isDuel || me.role === "duelist");
  if (kb) kb.hidden = !canType;
}

// Immersive UI hide-chrome gate (C5). A single `body.playing` class drives the CSS
// that hides the room name / ✎ rename / Share ↗ / scoreboard while a guess is in
// progress; lobby + finished restore the full chrome. Everything hidden here is
// reachable via the avatar hub, so nothing is orphaned.
function setChromeVisibility(phase) {
  const playing = phase === "playing";
  document.body.classList.toggle("playing", playing);
  // A hub "peek" at the scoreboard adds .hub-reveal to force it visible mid-play;
  // drop that the moment we leave the playing phase so normal gating resumes.
  if (!playing) $("#scoreboard")?.classList.remove("hub-reveal");
}

// Two-zone lobby reparenting (Task 7, Neon Floor). In the lobby phase the Start control,
// the "other tables" floor, and chat all move into the left/right zones; on leaving lobby
// each node is restored to its EXACT original DOM home so the playing/finished UI is
// unchanged. The original parent + nextSibling are captured the first time we touch each
// node (markers live on the element, survive reparenting), so restore is precise. Idempotent:
// appendChild of an already-placed node is a no-op move, and so is restoring an in-place node.
function arrangeLobbyLayout(isLobby) {
  const left = $(".lobby-left");
  const right = $("#lobbyRight");
  const controls = $("#lobbyControls"); // the Start / mode / setup cluster
  const rail = $("#lobbyRail");          // the "other tables" floor
  const chat = $("#chatPanel");
  if (!left || !right) return;
  for (const el of [controls, rail, chat]) {
    if (el && !el.dataset.homeParent) {
      el._origParent = el.parentNode;
      el._origNext = el.nextSibling;
      el.dataset.homeParent = "1";
    }
  }
  if (isLobby) {
    if (controls) left.appendChild(controls);   // Start under the board / badge / your-table
    // Mobile-first DOM order (≤880px single column): chat comes right after the left
    // zone, the tables rail (a collapsed pill on mobile, Task 9) last. Desktop (≥881px)
    // lifts the rail above chat via flex order — the two-zone look is unchanged.
    if (chat) right.appendChild(chat);          // chat first in the right zone
    if (rail) right.appendChild(rail);          // floor after it
  } else {
    for (const el of [controls, rail, chat]) {
      if (el && el._origParent) {
        // If the saved sibling has since detached (or moved out of the original parent),
        // insertBefore would throw or misplace — fall back to append (ref = null).
        const ref = el._origNext && el._origNext.parentNode === el._origParent ? el._origNext : null;
        el._origParent.insertBefore(el, ref);
      }
    }
  }
}

// --- Per-round reset ---

// A fresh round: clear the power-up hints (owned by powerups.js) AND the gold-economy
// / clearer-wins per-round state (owned here). Both halves reset together on the same
// new-round snapshot hook.
function resetRound(round) {
  resetPowerHints(game, round); // ezRound, revealed, vowels, pending*, stuck, errorCount
  // A new round reopens input: the end-stats lock (set on game over / give-up) must clear here,
  // or a duel REPLAY (ready→KOTH next round) leaves the keyboard dead — that path never hits the
  // rematch_accepted handler that otherwise resets it. Covers fresh start, rematch, and reconnect.
  game.hasShownEndStats = false;
  game.pendingForfeitReveal = false; // a forfeit reveal never carries across rounds
  game.finishReason = null; // C4: how this round ended, from my view — fresh each round
  game.goldThisRound = 0; // per-round earnings, shown as your score on the end screen
  game.cashedOut = false; // §B: re-arm the daily cash-out for this round's solve (one mint, once)
  game.pendingCashOut = false; // §B: the new round hasn't earned a cash-out yet (armed on won/lost)
  settlementShown = false; // §C: re-arm the race settlement show for the next round
  // Clearer-wins: a fresh round starts an empty replay + a cleared hacker-log.
  game.replay = [];
  game.myGuessTimes = [];
  game.myRoundStartAt = null;
  clearPayoutTimers(); // cancel any pending payout/drain from the prior round + reset payingOut
  // Loss penalties (C2): escalation is per-game, so a fresh round forgets old mistakes.
  game.deadLetterReuse = new Map();
  if (hacklog) {
    hacklog.clear();
    const el = $("#hacklog");
    if (el) el.hidden = true;
  }
}

function renderChat(snap) {
  const log = $("#chatLog");
  const statusLog = $("#chatStatusLog");
  if (!log) return;
  const chat = snap.chat || [];
  // Only append new entries — avoid rebuilding scroll position on every snapshot.
  if (chat.length < game.lastChatLen) {
    // Backwards jump shouldn't happen (chat is append-only) but be defensive.
    log.textContent = "";
    if (statusLog) statusLog.textContent = "";
    game.lastChatLen = 0;
  }
  const appended = chat.length - game.lastChatLen;
  let notifyCount = 0;
  const freshUserMsgs = []; // this pass's Chat-pane entries, for the pill attention matrix
  for (let i = game.lastChatLen; i < chat.length; i++) {
    const e = chat[i];
    // §4 split (chat-pill.js): system lines → the quiet Status pane; user messages →
    // the Chat pane; legacy persisted presence noise (joined/left/reconnected) → dropped.
    const route = routeChatEntry(e);
    if (route === "drop") continue;
    if (route === "status") {
      // Status lines NEVER blink, expand, badge, or ping anything.
      statusLog?.appendChild(renderChatRow(e));
      continue;
    }
    log.appendChild(renderChatRow(e));
    freshUserMsgs.push(e);
    // Only notify for real messages from someone else — system lines live in the
    // Status tab now and never touch the badge; an unread count that's all noise
    // trains people to ignore it.
    const hasText = (e.text || "").trim().length > 0;
    if (hasText && e.from !== getUsername()) notifyCount++;
  }
  // Capture "a genuinely new, meaningful table message arrived" BEFORE we mutate
  // lastChatLen — seeding existing history on first render has appended>0 too, so we
  // key the auto-pop on notifyCount (system join/quit or someone else's non-empty line).
  // The FIRST render seeds room history (incl. the host's own "X joined" line) with
  // lastChatLen 0, which would otherwise yank the solo host off the Global default
  // immediately — so flag the initial seed and skip the auto-pop on it.
  const isInitialSeed = game.lastChatLen === 0 && appended > 0;
  const hadNewTableMsg = notifyCount > 0;
  game.lastChatLen = chat.length;
  // Attention matrix (chat-pill.js): a fresh message expands a quiet pill; one
  // arriving while the manual-close latch holds pulses the collapsed pill instead
  // of force-opening it. Runs BEFORE setHasText below so notify() sees the pill's
  // pre-arrival state — otherwise setHasText opens the pill first and the expand
  // branch could never fire. Skipped on the initial history seed — old messages
  // aren't "arriving".
  if (!isInitialSeed) {
    for (const e of freshUserMsgs) chatPill.notify(e, { mine: e.from === getUsername() });
  }
  // Lobby pill: real conversation (incl. seeded history) expands the chat box.
  // For fresh arrivals this is a no-op (notify's expand already set hasText); it
  // still covers the initial seed and the defensive history-reset path above.
  chatPill.setHasText(chatHasUserText(chat));
  if (appended > 0) {
    const panel = $("#chatPanel");
    const sheetOpen = panel?.classList.contains("sheet-open");
    // In the lobby the chat lives in the pill, so its .chat-open state IS
    // visibility there — the mobile sheet / desktop collapse don't apply. Without
    // this, messages read in the expanded pill still count as unread and the 💬
    // button (hidden in lobby) reappears at race start wearing a stale badge.
    const pillOpen = document.body.classList.contains("lobby") &&
      !!panel?.classList.contains("chat-open");
    const visible = pillOpen || (isMobile() ? sheetOpen : !game.chatCollapsed);
    if (visible) {
      scrollChatToBottom();
    } else if (notifyCount > 0) {
      game.unreadChat += notifyCount;
    }
    updateChatBadge();
  }
  // Auto-pop the Table tab on a new table message so it's not buried under the Global
  // placeholder. Only on a real new message (notifyCount), and only if not already there.
  if (hadNewTableMsg && !isInitialSeed && game.chatChannel !== "table") {
    switchChatChannel("table");
  }
}

function renderChatRow(entry) {
  const row = document.createElement("div");
  // Timestamp first — both panes read like a transcript: 14:32 @maya: nice one.
  // Entries carry the server's `t`. A system line missing one falls back to arrival
  // time (the Status pane always shows a stamp); a user line just omits the stamp
  // rather than fabricate a time on legacy history.
  const stamp = () => {
    const time = document.createElement("span");
    time.className = "chat-time";
    time.textContent = formatChatTime(entry.t || Date.now());
    return time;
  };
  if (entry.kind === "system") {
    row.className = "chat-row system";
    row.appendChild(stamp());
    row.appendChild(document.createTextNode(entry.text));
  } else {
    const mine = entry.from && entry.from === getUsername();
    row.className = "chat-row user" + (mine ? " mine" : "");
    if (entry.t) row.appendChild(stamp());
    const from = userLink(entry.from);
    from.classList.add("from");
    row.appendChild(from);
    row.appendChild(document.createTextNode(": " + entry.text));
  }
  return row;
}

function scrollChatToBottom() {
  // Scroll the pane the user is looking at (Status is its own log).
  const log = game.chatChannel === "status" ? $("#chatStatusLog") : $("#chatLog");
  if (!log) return;
  // Defer to next frame so newly-appended rows have their height.
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function updateChatBadge() {
  const inline = $("#chatBadge");
  const topBadge = $("#chatTopBadge");
  // On desktop the inline badge shows while the panel is collapsed.
  const desktopUnread = game.unreadChat > 0 && game.chatCollapsed;
  if (inline) inline.hidden = !desktopUnread;
  if (inline && desktopUnread) inline.textContent = String(game.unreadChat);
  // On mobile the topbar button shows the unread count whenever the sheet is closed.
  const panel = $("#chatPanel");
  const sheetClosed = panel ? !panel.classList.contains("sheet-open") : true;
  const mobileUnread = isMobile() && game.unreadChat > 0 && sheetClosed;
  if (topBadge) {
    topBadge.hidden = !mobileUnread;
    if (mobileUnread) topBadge.textContent = String(game.unreadChat);
  }
}

function syncModePicker(snap) {
  const list = $("#modeList");
  const control = $("#modeControl");
  if (!list || !control) return;
  $("#modeHeading").textContent = t("mode.heading");

  // Only show modes that are actually online — no locked "coming soon" teasers cluttering
  // the lobby. With a single playable mode there's nothing to pick, so hide the whole
  // control; the picker only earns its space once a second mode ships.
  const availableIds = Object.keys(MODES).filter(isAvailableMode);
  control.hidden = availableIds.length <= 1;

  // Build rows once.
  if (list.children.length === 0) {
    for (const id of availableIds) {
      const li = document.createElement("li");
      li.className = "mode-row";
      li.dataset.mode = id;
      li.setAttribute("role", "radio");

      const main = document.createElement("div");
      main.className = "mode-row-main";
      const label = document.createElement("span");
      label.className = "mode-row-label";
      label.textContent = t(`mode.${id}.label`);
      const blurb = document.createElement("span");
      blurb.className = "mode-row-blurb";
      blurb.textContent = t(`mode.${id}.blurb`);
      main.append(label, blurb);

      const tag = document.createElement("span");
      tag.className = "mode-row-tag";
      li.append(main, tag);

      li.tabIndex = 0;
      const choose = () => send({ type: "set_mode", mode: id });
      li.addEventListener("click", choose);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });
      list.appendChild(li);
    }
  }

  // Reflect current selection from the snapshot (server is source of truth).
  for (const li of list.children) {
    const selected = li.dataset.mode === snap.mode;
    li.classList.toggle("selected", selected);
    li.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function syncModeChip(snap) {
  const chip = $("#modeChip");
  if (!chip) return;
  // The mode pill ("Live Race") read as noise on top of the board (Jun 8) — the room name
  // + the board itself carry the context. Kept in the DOM (id-wired) but never shown.
  chip.hidden = true;
}

// Word-length picker — now mounted in the Settings "Room" section (out of the lobby).
// Called when the gear opens in a room. Builds options once, reflects the room's current
// length (server is source of truth), and disables once the game starts (length is locked).
function syncLengthSelect(snap) {
  const sel = $("#lengthSelect");
  if (!sel || !snap) return;
  if (sel.options.length === 0) {
    for (const n of SUPPORTED_LENGTHS) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} letters`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      const n = parseInt(sel.value, 10);
      if (SUPPORTED_LENGTHS.includes(n)) {
        setPreferredLength(n);
        send({ type: "set_length", wordLength: n });
      }
    });
  }
  sel.disabled = snap.phase !== "lobby" || !!game.challengeId; // pinned word in challenges
  if (parseInt(sel.value, 10) !== snap.wordLength) sel.value = String(snap.wordLength);
}

// Rows twin of syncLengthSelect — the guest-reachable path for set_rows (the in-lobby
// dim popover is host-only). Options mirror the server clamp [MIN_ROWS, MAX_ROWS].
function syncRowsSelect(snap) {
  const sel = $("#rowsSelect");
  if (!sel || !snap) return;
  if (sel.options.length === 0) {
    for (let n = MIN_ROWS; n <= MAX_ROWS; n++) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} rows`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      const n = parseInt(sel.value, 10);
      if (n >= MIN_ROWS && n <= MAX_ROWS) send({ type: "set_rows", rows: n });
    });
  }
  sel.disabled = snap.phase !== "lobby" || !!game.challengeId;
  if (parseInt(sel.value, 10) !== snap.maxGuesses) sel.value = String(snap.maxGuesses);
}

// Length can only be changed while genuinely in a multiplayer lobby — and only by the
// host (snap.hostId: first connected human, succession on disconnect). Challenge rooms
// pin the word, so the dim control is read-only there (the server rejects the messages
// too — onSetLength/onSetRows guard daily, challenge, and phase). An un-hosted snapshot
// (older server) stays editable for everyone.
function canEditLength(snap) {
  if (!snap || snap.phase !== "lobby" || game.isDaily) return false;
  if (game.challengeId) return false;
  return !snap.hostId || snap.hostId === getUsername();
}

// Capacity is HOST authority — server-enforced (onSetCapacity), unlike the shared-control
// size settings — so there is no un-hosted fallback here: no host, no steppers. Mirrors
// the server clamp [max(2, seated), 6]; the snapshot repaints, we never desync optimistically.
const MIN_CAPACITY = 2;
const MAX_CAPACITY = 6;
function canEditCapacity(snap) {
  if (!snap || snap.phase !== "lobby" || game.isDaily || game.challengeId) return false;
  if (!snap.isDuel) return false;
  return !!snap.hostId && snap.hostId === getUsername();
}
function stepCapacity(d) {
  const snap = game.snapshot;
  if (!canEditCapacity(snap)) return;
  const seated = (snap.players || []).filter((p) => p && p.role !== "spectator").length;
  const lo = Math.max(MIN_CAPACITY, seated);
  const clamped = Math.max(lo, Math.min(MAX_CAPACITY, (Number(snap.capacity) || MIN_CAPACITY) + d));
  if (clamped === snap.capacity) return;
  send({ type: "set_capacity", capacity: clamped });
}
// Spectator's lobby view: the Ready button is hidden (role gate in applyDuelReadyButton);
// this quiet line fills the hole so "no button" reads as a state, not a bug.
function applySpectatorHint(snap, me) {
  const hint = $("#spectatorHint");
  if (!hint) return;
  hint.hidden = !(snap.phase === "lobby" && snap.isDuel && me && me.role === "spectator");
}

// Dimension-control bounds. Cols mirror SUPPORTED_LENGTHS' ends; rows mirror the server
// clamp in room-core.ts (clampRows: [3, 8]). triesFor stays in lockstep with guessesFor.
const MIN_COLS = SUPPORTED_LENGTHS[0];
const MAX_COLS = SUPPORTED_LENGTHS[SUPPORTED_LENGTHS.length - 1];
const MIN_ROWS = 3;
const MAX_ROWS = 8;

function closeDim() {
  const pop = $("#dimPop"); if (pop) pop.classList.remove("open");
  const dim = $("#dim"); if (dim) dim.classList.remove("open");
}

// Step letters: clamp, then tell the server (set_length). The next snapshot repaints the
// numbers (and resets rows to the smart default) — we don't optimistically desync.
function stepCols(d) {
  const snap = game.snapshot;
  if (!canEditLength(snap)) return;
  const clamped = Math.max(MIN_COLS, Math.min(MAX_COLS, snap.wordLength + d));
  if (clamped === snap.wordLength) return;
  setPreferredLength(clamped); // remember the user's local pref regardless of socket state
  send({ type: "set_length", wordLength: clamped });
}

// Step rows: clamp to [MIN_ROWS, MAX_ROWS], tell the server (set_rows). Snapshot repaints.
function stepRows(d) {
  const snap = game.snapshot;
  if (!canEditLength(snap)) return;
  const clamped = Math.max(MIN_ROWS, Math.min(MAX_ROWS, snap.maxGuesses + d));
  if (clamped === snap.maxGuesses) return;
  send({ type: "set_rows", rows: clamped });
}

// The 5 × 6 control: tap the .dim to open the popover with Letters/Rows steppers; a
// click outside closes it. The steppers drive set_length / set_rows. Wired once per mount.
function wireDim() {
  const dim = $("#dim");
  if (!dim || dim.dataset.wired) return;
  dim.dataset.wired = "1";
  dim.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canEditLength(game.snapshot)) return;
    const pop = $("#dimPop");
    const opening = pop && !pop.classList.contains("open");
    if (pop) pop.classList.toggle("open", opening);
    dim.classList.toggle("open", !!opening);
  });
  // Click-outside closes the popover (scoped: ignore clicks within the control itself).
  // Registered ONCE at the document level — mount() rebuilds #dim on every room entry,
  // so without this guard a fresh listener would accumulate per visit.
  if (!wireDim._outsideWired) {
    wireDim._outsideWired = true;
    document.addEventListener("click", (e) => {
      const pop = $("#dimPop");
      if (pop && pop.classList.contains("open") && !e.target.closest("#dimWrap")) closeDim();
    });
  }
  $("#colMinus")?.addEventListener("click", (e) => { e.stopPropagation(); stepCols(-1); });
  $("#colPlus")?.addEventListener("click", (e) => { e.stopPropagation(); stepCols(1); });
  $("#rowMinus")?.addEventListener("click", (e) => { e.stopPropagation(); stepRows(-1); });
  $("#rowPlus")?.addEventListener("click", (e) => { e.stopPropagation(); stepRows(1); });
}

// Per-room cumulative scoreboard (wins/played across rounds), sorted by wins desc.
function renderScoreboard(snap) {
  const root = $("#scoreboard");
  if (!root) return;
  const board = (snap.scoreboard || []).slice().sort((a, b) => b.wins - a.wins || b.played - a.played);
  if (board.length === 0) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.textContent = "";
  const title = document.createElement("div");
  title.className = "scoreboard-title";
  title.textContent = "Scoreboard";
  root.appendChild(title);
  const me = getUsername();
  for (const e of board) {
    const row = document.createElement("div");
    row.className = "score-row" + (e.username === me ? " mine" : "");
    const name = document.createElement("span");
    name.className = "score-name";
    name.appendChild(userLink(e.username, { suffix: e.username === me ? " (you)" : "" }));
    const tally = document.createElement("span");
    tally.className = "score-tally";
    tally.textContent = `${e.wins}W · ${e.losses ?? 0}L · ${e.ties ?? 0}T`;
    row.appendChild(name);
    row.appendChild(tally);
    root.appendChild(row);
  }
}

// Duel ready / "Challenge 👑" button, shared by the lobby start button and the
// between-rounds intermission button. Only duelists ready up; spectators see no button.
function applyDuelReadyButton(btn, snap, me) {
  const amDuelist = me && me.role === "duelist";
  btn.hidden = !amDuelist;
  if (!amDuelist) return;
  const ready = !!me.ready;
  const challenger = snap.throne && snap.throne.username !== getUsername();
  btn.textContent = ready ? "Ready ✓" : (challenger ? "Challenge 👑" : "Ready");
  btn.classList.toggle("ready-on", ready);
}

// Duel queue strip: the throne holder + the line of waiting challengers. Hidden when
// there's no queue and no throne (a fresh 1v1 with nobody waiting), or in a non-duel room.
function renderQueue(snap) {
  const strip = $("#queueStrip");
  if (!strip) return;
  const queue = Array.isArray(snap.queue) ? snap.queue : [];
  // The throne's "👑 X · N in a row" line was removed (read as noise, Jun 8) — the crown
  // badge on the board already carries the streak. The strip now shows only the waiting
  // challenger queue, so it hides whenever nobody's waiting (incl. solo / duel with no line).
  if (!snap.isDuel || queue.length === 0) {
    strip.hidden = true; strip.textContent = ""; return;
  }
  strip.hidden = false;
  strip.textContent = "";
  const label = document.createElement("span");
  label.className = "queue-next muted small";
  const meName = getUsername();
  const names = queue.map((u, i) => (u === meName ? `you (#${i + 1})` : u));
  label.textContent = `Next up: ${names.join(" → ")}`;
  strip.appendChild(label);
}

function renderBoards(snap, me) {
  const root = $("#boards");
  // The daily is a focused, personal puzzle (the whole world plays the same word, but
  // you see only YOUR board) — the shared standings live in the gated leaderboard, not
  // a wall of strangers' boards. Live race rooms still show everyone.
  const ordered = game.isDaily
    ? (me ? [me] : [])
    : snap.isDuel
    ? [
        // Duel rooms show only the two duelists' boards; spectators watch via the queue strip.
        ...(me && me.role === "duelist" ? [me] : []),
        ...snap.players.filter((p) => p.role === "duelist" && p.username !== getUsername()),
      ]
    : [
        ...(me ? [me] : []),
        ...snap.players.filter((p) => p.username !== getUsername()),
      ];
  // Lobby: opponents have no board pre-start — show only your own single-row "word to
  // fill" board (the per-row collapse happens below). Skipping opponent boards here keeps
  // the waiting lobby calm; everyone's full board reappears the moment the game starts.
  const lobbyOrdered = snap.phase === "lobby" && me ? [me] : ordered;
  // While my board's tiles are mid-explosion OR mid-payout (glow/floater anchored to
  // them) OR mid-replay (finished daily playing itself back), preserve the existing
  // DOM so the animations don't get nuked by a snapshot. Everyone else updates as normal.
  const preserveMine = game.exploding || game.payingOut || boardReplayActive();
  if (preserveMine) {
    for (const board of root.querySelectorAll(".player-board")) {
      if (board.dataset.player !== getUsername()) board.remove();
      // My board is frozen to protect the animating row + coin floaters, but the input
      // row below it has no animation to guard. Sync it in place so letters typed mid-
      // payout actually paint — otherwise fast play looks like it eats the next word.
      else if (me) syncMyInputRow(board, snap, me);
    }
  } else {
    root.textContent = "";
  }
  for (const p of lobbyOrdered) {
    if (preserveMine && p.username === getUsername()) continue; // keep existing animating board
    const board = document.createElement("div");
    board.className = "player-board" + (p.username === getUsername() ? "" : " spectator");
    board.dataset.player = p.username;
    const name = document.createElement("div");
    name.className = "player-name";
    const isMe = p.username === getUsername();
    // Your OWN board needs no name label — your identity already rides under the topbar
    // avatar, so "(you)" on top of the board read as noise (Jun 8). Daily is always solo
    // (no label either way). Races/duels keep OPPONENT names: they say whose board is whose.
    if (!isMe && !game.isDaily) {
      name.appendChild(userLink(p.username, {}));
    }

    if (p.status === "won") {
      const b = document.createElement("span"); b.className = "badge won"; b.textContent = "WON"; name.appendChild(b);
    } else if (p.status === "lost") {
      const b = document.createElement("span"); b.className = "badge lost"; b.textContent = "OUT"; name.appendChild(b);
    } else if (!p.connected) {
      const b = document.createElement("span"); b.className = "badge off"; b.textContent = "AWAY"; name.appendChild(b);
    }
    // Throne streak badge: opponents only. On your OWN board the "👑 ×N" chip was the
    // streak noise flagged Jun 8 — your run is yours to know; the badge is for reading rivals.
    if (snap.throne && p.username === snap.throne.username && !isMe) {
      const crown = document.createElement("span");
      crown.className = "badge throne";
      crown.textContent = `👑 ×${snap.throne.streak}`;
      name.appendChild(crown);
    }
    // Ghost chip intentionally omitted (ghost disguise spec): ghosts render as ordinary
    // opponents (WON/OUT badges still appear at their recorded finish moments via the tape).
    // The internal p.ghost / p.ghostHost flags are kept for replay math (ghostPlayersAt,
    // hostFinish, end-of-race freeze) and any future non-visual use.
    if (name.childNodes.length) board.appendChild(name); // daily + no badge ⇒ no empty row

    const grid = document.createElement("div");
    grid.className = "grid";
    const cols = snap.wordLength;
    const rows = snap.maxGuesses;
    // Lobby: a single teaser row — and only ONE grid track, so no phantom-rows gap.
    // The full grid re-renders on leaving lobby; the bloom stagger (style.css §7) is a
    // per-row opacity animation on that re-render, so it needs no pre-reserved tracks.
    const isLobby = snap.phase === "lobby";
    const rowsToDraw = isLobby ? 1 : rows;
    // CSS vars drive grid-template + tile sizing.
    board.style.setProperty("--cols", String(cols));
    board.style.setProperty("--rows", String(rowsToDraw));
    grid.style.setProperty("--rows", String(rowsToDraw));
    const pending = (isMe && snap.phase === "playing" && p.status === "playing") ? game.pending : "";
    const prevCount = game.lastGuessCounts.get(p.username) ?? 0;
    const freshRowIdx = p.guesses.length > prevCount ? p.guesses.length - 1 : -1;
    // Cold render of YOUR already-finished daily (page load / return visit): don't
    // leave the solved board sitting flat — board-replay re-types and re-flips it,
    // once per page load (the same self-demo the home recap stamp does). The rows
    // still paint flat below (the replay veils them itself); only the lone last-row
    // flip is suppressed so its scheduleReveal timers don't fight the replay's veil.
    const replayMyBoard = isMe && game.isDaily && p.status !== "playing" &&
      prevCount === 0 && p.guesses.length > 0 && !getSettings().reducedMotion;

    for (let r = 0; r < rowsToDraw; r++) {
      const row = document.createElement("div");
      row.className = "grid-row";
      row.style.setProperty("--cols", String(cols));
      const guess = p.guesses[r];
      const isCurrentRow = !guess && r === p.guesses.length;
      const isFresh = r === freshRowIdx && !replayMyBoard;
      // Easy mode: the typing row wears a live "knowledge lens" — classes derived
      // from what prior guesses PROVED (hints.js). Same facts the keyboard colors
      // show, surfaced where the eyes are. Result fills stay settled-rows-only.
      const rowHints = isMe && isCurrentRow && activeDifficulty() === "easy"
        ? typingHints(pending, p.guesses) : null;
      for (let c = 0; c < cols; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        if (guess) {
          if (isFresh) {
            // Render as "filled with letter" first; flip animation reveals color mid-spin.
            tile.classList.add("filled", "reveal");
            tile.style.setProperty("--reveal-delay", `${c * REVEAL_STAGGER_MS}ms`);
            if (isMe) tile.textContent = guess.word[c];
            scheduleReveal(tile, guess.mask[c], c);
          } else {
            tile.classList.add(guess.mask[c]);
            if (isMe) tile.textContent = guess.word[c];
          }
        } else if (isMe && isCurrentRow && pending[c]) {
          tile.classList.add("filled", "pop");
          if (rowHints?.[c]) tile.classList.add(`hint-${rowHints[c]}`);
          tile.textContent = pending[c];
        } else if (
          isMe && isCurrentRow && c === pending.length &&
          snap.phase === "playing" && p.status === "playing"
        ) {
          // Blinking cursor on the next slot so you always know where you're typing.
          tile.classList.add("cursor");
        } else if (!isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
          // Opponent's LIVE typing (anonymous): ghost-fill the letters they've entered, with a
          // soft pulse on the slot they're about to fill. No letters — same hidden-word rule as
          // the rest of the spectator board. Driven by game.typing; updateOpponentGhost() patches
          // this in place between full renders.
          const tlen = Math.min(game.typing.get(p.username) ?? 0, cols);
          if (c < tlen) tile.classList.add("ghost");
          else if (c === tlen && tlen > 0) tile.classList.add("ghost-cursor");
        }
        row.appendChild(tile);
      }
      // One-shot line clear: tap your active row to wipe the whole guess (no Delete button).
      if (isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
        row.classList.add("input-row");
        row.addEventListener("click", clearRow);
      }
      grid.appendChild(row);
    }
    board.appendChild(grid);
    root.appendChild(board);
    if (replayMyBoard) autoPlayBoardOnce(grid, p.guesses);
    game.lastGuessCounts.set(p.username, p.guesses.length);
  }
}

// Patch a single opponent's live-typing ghost row in place — far cheaper than a full render()
// and it never disturbs another board or an in-flight animation. game.typing is already updated
// by the caller; here we just re-paint the ghost / ghost-cursor classes on their current input
// row. No-ops silently if their board isn't on screen yet (a later full render picks it up).
function updateOpponentGhost(username) {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.isDaily) return;
  const p = snap.players.find((q) => q.username === username);
  if (!p || p.status !== "playing") return;
  const root = $("#boards");
  const board = root && $$(".player-board", root).find((b) => b.dataset.player === username);
  if (!board) return;
  const rowEl = board.querySelectorAll(".grid-row")[p.guesses.length];
  if (!rowEl) return; // their current row is off the board (shouldn't happen while playing)
  const len = Math.min(game.typing.get(username) ?? 0, snap.wordLength);
  rowEl.querySelectorAll(".tile").forEach((tile, c) => {
    tile.classList.toggle("ghost", c < len);
    tile.classList.toggle("ghost-cursor", c === len && len > 0);
  });
}

// --- Ghost replay (arena race tape): one clock from GO, events fire at their offsets ---

function resetGhostReplay() {
  clearTimeout(ghostTimer);
  ghostTimer = null;
  game.ghostTape = null;
  game.ghostT0 = null;
  game.ghostPlayers = [];
}

// My solve ends the ghost race (mirrors the live room's first-solve-ends-all rule):
// stop the tape clock and flip every still-racing ghost to OUT. Mutates the grafted
// ghost objects in place — the snapshot render that triggered this paints the result.
function endGhostRaceOnMyWin() {
  clearTimeout(ghostTimer);
  ghostTimer = null;
  for (const g of game.ghostPlayers || []) {
    if (g.status === "playing") g.status = "lost";
    g.typingLen = 0;
    game.typing.delete(g.username);
  }
}

// (showGhostReadyOverlay removed per ghost-disguise + exact-time spec.
// Ghost challenges now use the regular lobby "I'm ready" / start flow. The tap on
// that affordance serves as the iOS user-gesture for unlockAudio (global listeners
// already cover pointerdown/touchend; the button is a real interactive element).
// Replay clock is armed in the snapshot handler on phase "playing", exactly like
// other ghost tapes.

let ghostTimer = null;
function startGhostReplay() {
  game.ghostT0 = Date.now();
  game.ghostPlayers = ghostPlayersAt(game.ghostTape, 0);
  tickGhostReplay();
}

function tickGhostReplay() {
  clearTimeout(ghostTimer);
  if (!game.ghostTape || game.ghostT0 == null || !game.snapshot) return;
  const t = Date.now() - game.ghostT0;
  const prev = game.ghostPlayers;
  const next = ghostPlayersAt(game.ghostTape, t);
  game.ghostPlayers = next;
  const real = game.snapshot.players.filter((p) => !p.ghost);
  game.snapshot.players = [...real, ...next];
  // Typing pulses ride the existing ghost-fill path; commits/finishes need a render.
  let structural = false;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i], b = next[i];
    if (!a || a.guesses.length !== b.guesses.length || a.status !== b.status) { structural = true; break; }
  }
  for (const g of next) {
    if (g.typingLen > 0) game.typing.set(g.username, g.typingLen);
    else game.typing.delete(g.username);
  }
  if (structural) {
    // Drama reacts to ghost commits exactly like live opponents.
    dramaUpdate([...real, ...prev], game.snapshot.players, {
      me: getUsername(), maxGuesses: game.snapshot.maxGuesses ?? 6,
      phase: game.snapshot.phase, isDaily: false,
    });
    render();
  } else {
    for (const g of next) updateOpponentGhost(g.username);
  }
  const at = nextEventAfter(game.ghostTape, t);
  if (at != null) ghostTimer = setTimeout(tickGhostReplay, Math.max(16, at - t));
}

// During a preserved render (mid-payout / mid-explosion) the board DOM is frozen so the
// flipping row's coin floaters stay anchored. The input row has nothing to protect, so we
// patch its tiles in place to mirror game.pending. We only rewrite tiles that actually
// changed, so an existing letter never re-fires its pop animation on each new keystroke.
function syncMyInputRow(board, snap, me) {
  if (snap.phase !== "playing" || me.status !== "playing") return;
  const inputRow = board.querySelectorAll(".grid-row")[me.guesses.length];
  if (!inputRow) return;
  const pending = game.pending;
  // Easy-mode knowledge lens — must match the full-render path (renderBoards).
  const hints = activeDifficulty() === "easy" ? typingHints(pending, me.guesses) : null;
  inputRow.querySelectorAll(".tile").forEach((tile, c) => {
    const want = pending[c] ?? "";
    const isCursor = c === pending.length;
    if (tile.textContent === want && tile.classList.contains("filled") === !!want) {
      tile.classList.toggle("cursor", isCursor); // letter unchanged — just move the cursor
      return;
    }
    tile.className = "tile";
    tile.textContent = "";
    if (want) {
      tile.classList.add("filled", "pop");
      if (hints?.[c]) tile.classList.add(`hint-${hints[c]}`, "hint-fresh");
      tile.textContent = want;
    }
    else if (isCursor) tile.classList.add("cursor");
  });
}

// Fast path for the typing hot loop: a keystroke only ever changes MY input row, so patch
// just that row in place instead of a full render() — which would wipe + rebuild every board,
// re-class all keyboard keys, and rebuild the scoreboard/games panels on EVERY letter (the
// tap-lag culprit). Falls back to a full render() if my board isn't built yet (first paint).
function patchMyInputRow() {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing") { render(); return; }
  const me = snap.players.find((p) => p.username === getUsername());
  const myBoard = $$(".player-board").find((b) => b.dataset.player === getUsername());
  if (!me || !myBoard || !myBoard.querySelectorAll(".grid-row")[me.guesses.length]) { render(); return; }
  syncMyInputRow(myBoard, snap, me);
}

function scheduleReveal(tile, color, colIdx) {
  // Swap to colored class at the keyframe's halfway point so the color is revealed
  // exactly when the tile is edge-on (invisible) — that's why the snap feels seamless.
  const at = colIdx * REVEAL_STAGGER_MS + REVEAL_FLIP_HALF_MS;
  setTimeout(() => {
    tile.classList.remove("filled");
    tile.classList.add(color);
  }, at);
}

// --- Keyboard input ---

// Resolve the player's keyboard layout: an explicit saved pick always wins; an
// unset / "auto" setting falls through to locale auto-detect (fr-* → AZERTY).
// The first explicit pick in the layout picker pins it forever.
function resolvedLayoutId() {
  const s = getSettings().keyboardLayout;
  return s && s !== "auto" ? activeLayoutId(s) : detectLayout(navigator.language);
}

// Handlers injected into the on-screen keyboard's delegated click listener.
const keyboardHandlers = { onEnter: submitGuess, onBack: backspace, onLetter: typeLetter, onClear: clearRow };

function onPhysicalKey(e) {
  // Don't hijack typing in any input fields, with modifiers, or while a modal is open.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // End-game: when the stats modal is up with Play Again showing, Enter starts a
  // new game — so the instinctive "tap Enter to keep going" just works.
  if (e.key === "Enter") {
    const playAgain = $("#modalPlayAgain");
    if (playAgain && !playAgain.hidden && playAgain.offsetParent !== null) {
      e.preventDefault(); playAgain.click(); return;
    }
  }
  if (document.querySelector(".modal:not([hidden])")) return;

  const isLetter = /^[a-zA-Z]$/.test(e.key);
  const isEnter = e.key === "Enter";

  // Type-to-start: on the home screen or in a lobby, a letter or Enter kicks off the
  // game — so players who instinctively start typing don't have to hunt for the button.
  if (!game.snapshot || game.snapshot.phase === "lobby") {
    if (!isLetter && !isEnter) return;
    const startPlaying = $("#startPlayingBtn");
    if (!game.snapshot && startPlaying && startPlaying.offsetParent !== null) {
      startPlaying.click(); e.preventDefault(); return;
    }
    if (game.snapshot?.phase === "lobby") {
      const snap = game.snapshot;
      if (snap.isDuel) {
        const meP = snap.players.find((p) => p.username === getUsername());
        if (meP && meP.role === "duelist") send({ type: "ready", ready: true });
      } else {
        send({ type: "start" });
      }
      e.preventDefault();
    }
    return;
  }

  if (game.snapshot.phase !== "playing") return;
  const me = game.snapshot.players.find((p) => p.username === getUsername());
  if (!me || me.status !== "playing") return;
  // A give-up / bankruptcy ends the game from MY side without a server status change
  // (server still says "playing"). Once that's happened, input is closed — otherwise you
  // could keep typing, re-trigger payouts, even "win" after a loss was recorded.
  if (game.hasShownEndStats) return;

  if (isEnter) { submitGuess(); e.preventDefault(); }
  else if (e.key === "Escape") { clearRow(); e.preventDefault(); }
  else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
  else if (isLetter) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
}

// Broadcast my current row LENGTH (never the letters) so opponents see a live ghost fill.
// Coalesced to one send per frame — fast typing or a held ⌫ collapses into the latest length —
// and only sent in a live race that actually has someone else watching; solo/daily skip it.
let _typingRaf = 0;
let _typingLen = -1;
function sendTyping(len = game.pending.length) {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.isDaily) return;
  if (!snap.players.some((p) => p.username !== getUsername())) return; // nobody to show it to
  _typingLen = len;
  if (_typingRaf) return;
  _typingRaf = requestAnimationFrame(() => {
    _typingRaf = 0;
    send({ type: "typing", len: _typingLen });
  });
}

function typeLetter(l) {
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  if (game.pending.length >= game.snapshot.wordLength) return;
  game.pending += l.toUpperCase();
  tapeRecord("k", l.toUpperCase());
  patchMyInputRow(); // in-place: a keystroke only changes my input row, not the whole room
  sendTyping();
  resetIdle();
}
let lastWipeReactAt = 0;
// silent: skip the companion aside — used by the auto-clear after a rejected guess,
// where the "invalid" companion already spoke.
function clearRow({ silent = false } = {}) {
  if (!game.pending.length) return;
  tapeRecord("c");
  const cleared = game.pending.length;
  resetIdle();
  sendTyping(0); // tell opponents the row emptied the instant the wipe starts

  // A meaningful wipe (most of a word, not one stray letter) earns a dry companion
  // aside — throttled so rapid retries don't turn it into a chatterbox. Text-only:
  // the wipe is frequent enough that voicing it would wear thin fast.
  if (!silent && cleared >= 3 && Date.now() - lastWipeReactAt > 8000) {
    lastWipeReactAt = Date.now();
    showCompanion("wipe", { cleared });
  }

  const row = activeInputRow();
  if (!row || getSettings().reducedMotion) { game.pending = ""; render(); return; }

  // Sweep the tiles away left-to-right, THEN clear + re-render once the gesture lands.
  const tiles = row.querySelectorAll(".tile");
  tiles.forEach((t, i) => t.style.setProperty("--wipe-delay", `${i * 22}ms`));
  row.classList.add("wipe");
  const total = 180 + (tiles.length - 1) * 22;
  setTimeout(() => { game.pending = ""; render(); }, total);
}
// The active (unplayed) input row for me — sits right after my played guesses.
function activeInputRow() {
  const myBoard = $$(".player-board")[0];
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  if (!myBoard || !me) return null;
  return myBoard.querySelectorAll(".grid-row")[me.guesses.length] || null;
}
function backspace() {
  if (game.pending.length === 0) return;
  game.pending = game.pending.slice(0, -1);
  tapeRecord("b");
  patchMyInputRow(); // in-place: backspace only changes my input row
  sendTyping();
  resetIdle();
  maybeShowClearHint();
}
// One-time nudge: the first time someone backspaces, reveal the faster way to bail
// on a whole guess. Shown once ever (localStorage), never nags again.
function maybeShowClearHint() {
  if (localStorage.getItem(LS.clearHint) === "1") return;
  localStorage.setItem(LS.clearHint, "1");
  const tip = isTouch() ? "Tip: hold ⌫ to clear the whole row" : "Tip: press Esc to clear the whole row";
  setTimeout(() => toast(tip, { duration: 3200 }), 500);
}
function isTouch() {
  return window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
}
function submitGuess() {
  resetIdle();
  if (game.hasShownEndStats) return; // locally forfeited/bankrupt — input is closed (server may still say "playing")
  const len = game.snapshot?.wordLength ?? 5;
  if (game.pending.length !== len) {
    flashShake();
    toast("Not enough letters", { error: true, duration: 1400 });
    bumpErrorCount(powerupsCtx); // C4: fumbling the length counts toward the 💀 give-up offer
    return;
  }
  // The same dud again (Enter mashed on a just-rejected word): handle it locally —
  // instant feedback, no server round trip, and crucially no second −50 drain.
  if (game.lastRejected && game.pending.toUpperCase() === game.lastRejected.word) {
    flashShake();
    if (SHOW_REJECT_TOAST) toast(`${game.lastRejected.reason} — doesn't count, try again`, { error: true, duration: 2500 });
    bumpErrorCount(powerupsCtx); // still counts toward the 💀 offer — they're stuck
    return;
  }
  if (activeDifficulty() === "hard") {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const violation = checkHardMode(game.pending, me?.guesses ?? []);
    if (violation) {
      flashShake();
      toast(violation, { error: true, duration: 2200 });
      bumpErrorCount(powerupsCtx); // C4: a hard-mode violation counts toward the 💀 offer too
      return;
    }
  }
  // `hard` rides along so the server's pointsEarned applies the dead-letter penalty
  // only for hard-mode players — keeps settlement in lockstep with the client drain.
  send({ type: "guess", word: game.pending, hard: activeDifficulty() === "hard" });
  tapeRecord("e");
}

function checkHardMode(guess, prevGuesses) {
  const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  for (const g of prevGuesses) {
    for (let i = 0; i < g.word.length; i++) {
      if (g.mask[i] === "hot" && guess[i] !== g.word[i]) {
        return `${ord(i + 1)} letter must be ${g.word[i]}`;
      }
    }
    const need = {};
    for (let i = 0; i < g.word.length; i++) {
      if (g.mask[i] === "warm") need[g.word[i]] = (need[g.word[i]] ?? 0) + 1;
    }
    const have = {};
    for (const c of guess) have[c] = (have[c] ?? 0) + 1;
    for (const [letter, count] of Object.entries(need)) {
      if ((have[letter] ?? 0) < count) {
        return `Guess must contain ${letter}${count > 1 ? ` (x${count})` : ""}`;
      }
    }
  }
  return null;
}

function flashShake() {
  // Shake my current row.
  const myBoard = $$(".player-board")[0];
  if (!myBoard) return;
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  if (!me) return;
  const rows = myBoard.querySelectorAll(".grid-row");
  const row = rows[me.guesses.length];
  if (!row) return;
  row.classList.remove("shake");
  void row.offsetWidth; // restart animation
  row.classList.add("shake");
}

// Invalid-guess red pills ("… — doesn't count, try again") are OFF by default: the row
// shake, the companion, and the hacklog `rejected XXXXX −50` line already carry the news,
// and the big red bubble over the board read as nagging. Kept as a flag (not deleted) so
// worlds/rooms can later opt back in via their config with their own toast copy.
const SHOW_REJECT_TOAST = false;

function toast(text, opts = {}) {
  // Remove any existing toast so we never stack.
  const old = document.querySelector(".toast-bubble");
  if (old) old.remove();
  clearTimeout(game.toastTimer);

  const bubble = document.createElement("div");
  bubble.className = "toast-bubble" + (opts.error ? " error" : "");
  bubble.textContent = text;
  // On touch the eyes live at the BOTTOM (thumbs on the on-screen keyboard) — anchor
  // the bubble just above the keys, not the top of the page. The THESS incident
  // (Jun 5): five rejections went unseen because the toast sat at top:80px while the
  // player stared at the keyboard. Desktop (and no-keyboard surfaces) keep the top slot.
  const kb = document.getElementById("keyboard");
  if (isTouch() && kb && kb.offsetHeight > 0) {
    bubble.style.top = "auto";
    bubble.style.bottom = `${Math.max(8, Math.round(window.innerHeight - kb.getBoundingClientRect().top) + 8)}px`;
  }
  document.body.appendChild(bubble);

  const stay = opts.duration ?? 2200;
  game.toastTimer = setTimeout(() => {
    bubble.classList.add("fade");
    setTimeout(() => bubble.remove(), 280);
  }, stay);
}

// --- Start celebration ---

// GO! pop + confetti rain. Fires on every client via the shared snapshot, so the
// celebration is simultaneous on both sides. Visual only for now — the "golden
// voice" wishing luck is parked for later.
function triggerStartCelebration() {
  if (getSettings().reducedMotion) return;

  const burst = document.createElement("div");
  burst.className = "go-burst";
  burst.textContent = "GO!";
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1100);

  spawnConfetti(40);
}

// --- Duel 3-2-1 countdown overlay (server-stamped goAt keeps every client in sync) ---
let countdownTimer = null;
function startCountdownOverlay(goAt) {
  stopCountdownOverlay();
  if (getSettings().reducedMotion) return; // numbers skipped; the alarm still flips the round live
  const el = document.createElement("div");
  el.id = "countdownOverlay";
  el.className = "countdown-overlay";
  document.body.appendChild(el);
  let lastShown = null;
  const tick = () => {
    const remaining = goAt - Date.now();
    const n = remaining <= 0 ? null : Math.ceil(remaining / 1000);
    if (n == null) { stopCountdownOverlay(); return; }
    if (n !== lastShown) {
      lastShown = n;
      el.textContent = String(n);
      el.classList.remove("pulse");
      void el.offsetWidth; // restart the pop animation
      el.classList.add("pulse");
      try { playChime([[330 + (3 - n) * 110, 0]]); } catch {} // 330→440→550 Hz as it ticks down
    }
  };
  tick();
  countdownTimer = setInterval(tick, 80);
}
function stopCountdownOverlay() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  const el = $("#countdownOverlay");
  if (el) el.remove();
}

// Solve celebration: a big "SOLVED!" pop + confetti so winning the word lands as an
// event, not just a quiet toast. Reuses the GO! burst styling (green, centered).
function triggerWinCelebration() {
  if (getSettings().reducedMotion) return;
  const burst = document.createElement("div");
  burst.className = "go-burst win-burst";
  burst.textContent = "SOLVED!";
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1300);
  spawnConfetti(48);
}

const CONFETTI_COLORS = ["#538d4e", "#c9b458", "#6aaa64", "#ffd166", "#9d4edd", "#4cc9f0", "#ef476f"];
function spawnConfetti(pieces) {
  // Win/start celebration can spawn 40–130 pieces. Build them in a DocumentFragment and
  // append ONCE (one reflow instead of `pieces` reflows), and clean up with a single timer
  // instead of one per piece — both were a real synchronous stall at the win moment.
  const frag = document.createDocumentFragment();
  const nodes = [];
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement("div");
    c.className = "cheer-confetti";
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.setProperty("--cf-x", `${(Math.random() - 0.5) * 140}px`);
    c.style.setProperty("--cf-rot", `${(Math.random() - 0.5) * 900}deg`);
    c.style.setProperty("--cf-delay", `${Math.random() * 250}ms`);
    c.style.setProperty("--cf-dur", `${1200 + Math.random() * 900}ms`);
    frag.appendChild(c);
    nodes.push(c);
  }
  document.body.appendChild(frag);
  setTimeout(() => { for (const c of nodes) c.remove(); }, 2600); // one cleanup pass (max anim ≈ 2.35s)
}

// A short sparkle chime via Web Audio. Honors the global mute toggle.
let audioCtx = null;
// iOS/Safari start an AudioContext "suspended" until a user gesture resumes it. Our
// first chime is fired by a network message (a guess result), not a tap — so without
// this the context stays suspended and mobile hears nothing. Unlock on every touch
// (NOT {once}: iOS re-suspends the context after backgrounding, and the win reveal
// fires off a WS message + timers with no gesture on the stack to rescue it).
let speechPrimed = false;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* audio is a nice-to-have */ }
  // iOS Safari also gates speechSynthesis behind a gesture: unless the FIRST speak()
  // happens on a user-gesture stack, every later utterance is silently dropped — the
  // spoken win reveal comes from a WS message, so it never qualified. Prime the engine
  // once with a silent utterance while we ARE in a gesture; later speaks then work.
  if (!speechPrimed && window.speechSynthesis) {
    speechPrimed = true;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* speech is a nice-to-have */ }
  }
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("touchend", unlockAudio);
function playChime(notes) {
  if (localStorage.getItem("wordul.muted") === "1") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    // Don't schedule against a suspended clock: currentTime is frozen while suspended,
    // so notes scheduled "now" land in the past once resume() lands and never sound.
    // Wait for the resume, then read t0 fresh.
    const schedule = () => {
      const t0 = audioCtx.currentTime;
      notes.forEach(([freq, at], i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + at); osc.stop(t0 + at + 0.24);
      });
    };
    if (audioCtx.state === "suspended") audioCtx.resume().then(schedule).catch(() => {});
    else schedule();
  } catch { /* ignore — audio is a nice-to-have */ }
}

// A short filtered-noise burst for mistake feedback. "glass" = bright, fast decay;
// "shock" = a buzzy zap; "buzz" = a low dull thud. WebAudio-only, no asset files.
function playNoise(kind) {
  if (localStorage.getItem("wordul.muted") === "1") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const dur = kind === "buzz" ? 0.18 : 0.3;
    const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    if (kind === "glass") { filter.type = "highpass"; filter.frequency.value = 2200; }
    else if (kind === "shock") { filter.type = "bandpass"; filter.frequency.value = 900; filter.Q.value = 6; }
    else { filter.type = "lowpass"; filter.frequency.value = 500; }
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start(t0); src.stop(t0 + dur);
  } catch { /* ignore — audio is a nice-to-have */ }
}

// Sensory feedback for a committed sloppy mistake (reused dead letter). Config comes
// from the active edition (activeMistakeFx); reduced motion suppresses shake + flash
// but keeps the non-motion cues (sound, haptics). No-ops when the edition opts out.
function mistakeFx(cfg, letters) {
  if (!cfg) return;
  if (cfg.sound) playNoise(cfg.sound);
  if (cfg.haptics && navigator.vibrate) navigator.vibrate([30, 40, 30]);
  if (getSettings().reducedMotion) return;
  const boards = $("#boards");
  if (cfg.shake && boards) {
    boards.classList.remove("fx-shake");
    void boards.offsetWidth; // restart the animation
    boards.classList.add("fx-shake");
    setTimeout(() => boards.classList.remove("fx-shake"), 360);
  }
  if (cfg.crack && letters && letters.length) crackTiles(letters);
  if (cfg.flash) {
    const flash = document.createElement("div");
    flash.className = "fx-flash";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 320);
  }
}

// Shatter just the reused dead-letter tiles in MY fresh row (matched by letter).
// Same bottom-up "is it filled?" walk as getMyFreshTile so a mid-payout repaint
// can't target a detached node.
function crackTiles(letters) {
  const up = new Set([...letters].map((l) => l.toUpperCase()));
  const myBoard = document.querySelector("#boards .player-board:not(.spectator)");
  if (!myBoard) return;
  const rows = myBoard.querySelectorAll(".grid .grid-row");
  for (let r = rows.length - 1; r >= 0; r--) {
    const tiles = rows[r].querySelectorAll(".tile");
    const filled = tiles[0] && (tiles[0].classList.contains("reveal") ||
      tiles[0].classList.contains("hot") || tiles[0].classList.contains("warm") ||
      tiles[0].classList.contains("cold"));
    if (!filled) continue;
    tiles.forEach((t) => {
      if (!up.has((t.textContent || "").toUpperCase())) return;
      t.classList.remove("fx-break");
      void t.offsetWidth; // restart the animation
      t.classList.add("fx-break");
      setTimeout(() => t.classList.remove("fx-break"), 600);
    });
    return; // only the fresh row
  }
}

// Yang's scaled green celebration. 1 new green → spark + soft chime; 2+ → confetti
// + an ascending chime + a hyped voice line. Visual bits respect reduced motion.
// Yang's scaled green celebration. 1 new green → spark + soft chime; 2+ → confetti
// + chime + a hyped voice line whose words match the real count. Respects reduced motion.
function celebrateGreens(count) {
  const reduced = getSettings().reducedMotion;
  const boards = $("#boards");
  if (count >= 2) {
    if (count >= 3) playChime([[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]]);
    else playChime([[523, 0], [659, 0.09], [784, 0.18]]);
    if (!reduced) spawnConfetti(count >= 3 ? 28 + (count - 2) * 18 : 28); // 3→46, 4→64, 5→82
    showCompanion("greens", { count });
  } else {
    playChime([[660, 0], [880, 0.08]]);
    if (boards && !reduced) {
      boards.classList.remove("hot-spark");
      void boards.offsetWidth; // restart the animation
      boards.classList.add("hot-spark");
      setTimeout(() => boards.classList.remove("hot-spark"), 700);
    }
  }
}

// --- End of game ---

// Losing used to summon a skull and a roast. Now every loss — ran out of guesses,
// beaten in a race, gave up, or went bankrupt — ends on a constructive, encouraging
// line drawn from the great minds of humanity (and a few AIs). The pool lives in
// /inspire.js; pickInspire() returns one formatted “quote” — author string.

// C4: forfeit — give-up or bankruptcy ends the game from MY side WITHOUT a server
// status change. Mirrors handleGameOver's bookkeeping (record the loss, guard
// fire-once, stop the idle timer) so a forfeit counts exactly like running out of
// guesses, then runs the lose explosion. `reason` is 'gave_up' | 'bankrupt'.
function forfeit(reason) {
  const snap = game.snapshot;
  if (!snap || game.hasShownEndStats) return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  clearGiveUpTimer();
  game.finishReason = reason;
  game.hasShownEndStats = true;
  // Tell the server we're out: it marks us lost (others see OUT) and the next snapshot
  // reveals the word to US, so the end-screen word card has it by the time it opens.
  send({ type: "resign" });
  // That same timing means the word is usually NOT here yet — announcing now would speak
  // a wordless reveal ("the word was…" + silence, the silent-forfeit bug). Announce only
  // if we somehow already have it; otherwise arm a one-shot and let the first revealing
  // snapshot fire the announcement (the snapshot handler owns the other half).
  if (snap.word) announceGameEnd({ won: false, answer: snap.word });
  else game.pendingForfeitReveal = true;
  triggerLoseSequence(snap, me);
}

function handleGameOver(snap) {
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  clearGiveUpTimer();
  const won = me.status === "won";
  const guessCount = me.guesses.length;
  game.hasShownEndStats = true;
  // C4: record how the game ended (give-up / bankruptcy already set theirs before
  // reaching here via forfeit, which short-circuits this path).
  game.finishReason = won ? "solved" : "lost";

  if (won) {
    // Solve bonus + speed bonus (fewer guesses = richer) + the winning row's greens.
    const maxGuesses = snap.maxGuesses ?? 6;
    const finalGreens = newGreensInLast(me.guesses);
    const speedBonus = GOLD.speedPerGuessLeft * Math.max(0, maxGuesses - guessCount);
    const winGold = GOLD.solve + speedBonus + finalGreens * GOLD.hot;
    awardGold(winGold, getSettings().reducedMotion, { wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX() });
    // Clearer-wins: the solve is the climactic turn — capture it in the replay + hacker-log
    // so "your run, line by line" ends ON the win and its gold, not one guess short. The gold
    // was already awarded above; this only RECORDS it (shape matches the gated server viewer).
    const winEvents = [];
    for (const d of orderedDiscoveriesInLast(me.guesses)) {
      if (d.kind === "hot") winEvents.push({ kind: "hot", index: d.index, letter: d.letter, delta: GOLD.hot });
    }
    winEvents.push({ kind: "solve", delta: GOLD.solve });
    if (speedBonus > 0) winEvents.push({ kind: "speed", delta: speedBonus });
    recordReplayEntry({ guessIndex: guessCount - 1, events: winEvents, combo: null, balanceAfter: game.goldThisRound || 0 });
    const winLog = getHacklog();
    if (winLog) for (const ev of winEvents) {
      // Tile-palette tones: hot discoveries light --hot; solve/speed stay neutral "gain".
      winLog.logLine(`${ev.kind}${ev.letter ? " " + String(ev.letter).toUpperCase() : ""}  +${ev.delta}`, { tone: ev.kind === "hot" ? "hot" : "gain" });
    }
    triggerWinCelebration();
    // "Congratulations — you found the word… [beat] {answer}". snap.word can be absent
    // while others still race (no leaks to the wire) — but the winner's own last accepted
    // guess IS the word, so the announcement never goes silent on a live-race solve.
    announceGameEnd({
      won: true,
      answer: snap.word || me.guesses[me.guesses.length - 1]?.word,
      guessesUsed: me.guesses.length,
    });
    // Same gentle pacing as before — wait for the final row's flip to finish.
    setTimeout(
      () => openStats({ snap, me, won, justFinished: true, lastGuessCount: guessCount }),
      1700,
    );
  } else {
    // Loss: let the player's last row flip first (if they made one), THEN explode.
    announceGameEnd({ won: false, answer: snap.word });
    const lastFlipDoneAt = guessCount > 0 ? 1500 : 200;
    setTimeout(() => triggerLoseSequence(snap, me), lastFlipDoneAt);
  }
}

function triggerLoseSequence(snap, me) {
  game.exploding = true;
  // However the round ended, the player gets a lift, not a roast. A FORFEIT draws
  // from its own pool (empowerment + tips) and the line is SPOKEN — the word reveal
  // stays silent on a forfeit (no answer revealed yet, see announceGameEnd), so the
  // quote owns the audio moment. Other losses keep the silent great-minds quote:
  // their spoken slot belongs to the "the word was…" reveal.
  const forfeited = game.finishReason === "gave_up" || game.finishReason === "bankrupt";
  const inspire = forfeited ? pickForfeit() : pickInspire();

  // 1. Screen flash.
  const flash = document.createElement("div");
  flash.className = "lose-flash";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 700);

  // 2. Confetti shards from screen center.
  const colors = ["#ff3838", "#ffb347", "#ffd166", "#b59f3b", "#9d4edd", "#ef476f"];
  const shards = 28;
  for (let i = 0; i < shards; i++) {
    const s = document.createElement("div");
    s.className = "shard";
    const angle = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 280 + Math.random() * 240;
    s.style.background = colors[i % colors.length];
    s.style.setProperty("--shard-tx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--shard-ty", `${Math.sin(angle) * dist + 220}px`); // bias downward
    s.style.setProperty("--shard-rot", `${(Math.random() - 0.5) * 1080}deg`);
    s.style.setProperty("--shard-delay", `${Math.random() * 120}ms`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1700);
  }

  // 3. Shake the page + explode my board's tiles.
  document.body.classList.add("lose-shake");
  setTimeout(() => document.body.classList.remove("lose-shake"), 600);

  const myBoard = $$(".player-board")[0];
  if (myBoard) {
    const tiles = Array.from(myBoard.querySelectorAll(".tile"));
    for (const tile of tiles) {
      const tx = (Math.random() - 0.5) * 800;
      const ty = 600 + Math.random() * 400;
      const rot = (Math.random() - 0.5) * 900;
      tile.style.setProperty("--ex-tx", `${tx}px`);
      tile.style.setProperty("--ex-ty", `${ty}px`);
      tile.style.setProperty("--ex-rot", `${rot}deg`);
      tile.style.setProperty("--ex-delay", `${Math.random() * 200}ms`);
      tile.classList.add("explode");
    }
  }

  // 4. After the dust settles, release the render lock so the snapshot can repaint
  //    a clean board behind the modal, then show the joke.
  setTimeout(() => {
    game.exploding = false;
    if (game.snapshot) renderBoards(game.snapshot, game.snapshot.players.find((p) => p.username === getUsername()));
    // inspire is ad-hoc text (pickForfeit), not a companion bank line — so we pull only the
    // descriptor + gate from companionReact and speak the raw line through the per-world voice.
    { const { voice, speak } = companionReact("loss", {}); if (forfeited && speak) playVoice(voice, inspire, inspire); } // voice + screen land together
    openStats({
      snap: game.snapshot ?? snap,
      me,
      won: false,
      justFinished: true,
      lastGuessCount: me.guesses.length,
      inspire,
    });
  }, 1500);
}

// --- Stats modal ---

// "The word — and a reason to remember it." Shows the answer big plus a reason to
// remember it: a definition, a surprising fact, and a quote from a great mind. Pulls
// from the pre-generated word-intel set first (instant, offline, with fact + quote);
// for words not yet in that set it falls back to the live dictionary definition. A
// one-tap web search always offers a way to go deeper.
function renderWordCard(parent, word) {
  if (!word) return;
  const w = String(word).toLowerCase();
  const card = document.createElement("div");
  card.className = "endgame-word-card";

  const label = document.createElement("div");
  label.className = "ewc-label";
  label.textContent = t("endscreen.theWord");
  card.appendChild(label);

  const big = document.createElement("div");
  big.className = "ewc-word";
  big.textContent = word.toUpperCase();
  card.appendChild(big);

  const intel = wordIntel(word);

  // The reward: an inline preview of the word's OG card. Only words with a pre-rendered
  // card in R2 get one (hasOgCard — the 5-letter pool; other lengths were a guaranteed
  // 404 per game, e.g. CHAOTICAL Jun 6). Lazy + async so it never blocks the modal, and
  // self-hides on error so a missing image can never break the end-card.
  let preview = null;
  if (hasOgCard(w)) {
    preview = document.createElement("img");
    preview.className = "ewc-preview";
    preview.src = `/word/og/${w}.png`;
    preview.alt = `${word.toUpperCase()} — word card`;
    preview.loading = "lazy";
    preview.decoding = "async";
    // Keep it small and tasteful even before any .ewc-preview CSS lands: the OG card
    // is 1200×630, so a fluid full-width box with a 1200/630 aspect ratio stays crisp.
    preview.style.width = "100%";
    preview.style.maxWidth = "320px";
    preview.style.aspectRatio = "1200 / 630";
    preview.style.height = "auto";
    preview.style.borderRadius = "10px";
    preview.style.display = "block";
    preview.style.margin = "10px auto 0";
    card.appendChild(preview);
  }

  const def = document.createElement("div");
  def.className = "ewc-def";
  card.appendChild(def);

  if (preview && intel) {
    // Dedup: the art already shows the word (tiles) and definition (tagline), so the
    // big-word + def text start hidden; if the art fails to load they return (endcard.js).
    wireCardArt(preview, [big, def]);
  } else if (preview) {
    preview.onerror = () => { preview.remove(); };
  }

  // Inward link to the word's wiki page — "see the full story of <WORD>". Plain link,
  // no auto-redirect and nothing gating the next game; the player taps it if they want.
  const look = document.createElement("a");
  look.className = "ewc-look";
  look.href = `/word/${w}`;
  look.textContent = t("endscreen.lookup");
  look.title = `See the full story of ${word.toUpperCase()}`;
  look.setAttribute("aria-label", `See the full story of ${word.toUpperCase()}`);

  if (intel) {
    // Rich path: pre-generated definition + fact + quote. No network needed.
    def.textContent = intel.def;
    if (intel.fact) {
      const fact = document.createElement("div");
      fact.className = "ewc-fact";
      fact.textContent = intel.fact;
      card.appendChild(fact);
    }
    if (intel.quote) {
      const q = document.createElement("blockquote");
      q.className = "ewc-quote";
      q.textContent = `“${intel.quote}”`;
      if (intel.author) {
        const cite = document.createElement("cite");
        cite.textContent = `— ${intel.author}`;
        q.appendChild(cite);
      }
      card.appendChild(q);
    }
    card.appendChild(look);
    parent.appendChild(card);
    return;
  }

  // Fallback: live dictionary definition (no key, CORS-friendly). Never blocks the modal.
  def.textContent = t("endscreen.looking");
  card.appendChild(look);
  parent.appendChild(card);
  fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const d = Array.isArray(data) && data[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      const pos = Array.isArray(data) && data[0]?.meanings?.[0]?.partOfSpeech;
      if (d) {
        def.textContent = pos ? `(${pos}) ${d}` : d;
      } else {
        def.textContent = t("endscreen.noEntry");
        def.classList.add("muted");
        // No dictionary entry → the /word/<w> wiki page may not exist either (e.g. a
        // 4-letter answer). Retarget "Look it up" to the same Google AI Mode hand-off
        // the wiki's "Continue with AI ✦" uses, so the tap never dead-ends.
        look.href = aiLookupHref(w);
        look.target = "_blank";
        look.rel = "noopener";
        look.textContent = t("endscreen.lookupAi");
        look.title = `Ask AI about ${word.toUpperCase()}`;
        look.setAttribute("aria-label", `Ask AI about ${word.toUpperCase()}`);
      }
    })
    .catch(() => {
      def.textContent = t("endscreen.offline");
      def.classList.add("muted");
    });
}

const STAT_BOX_IDS = ["statPlayed", "statWinPct", "statCurStreak", "statMaxStreak"];
// Replace the distribution area with a single muted note (no username / load fail).
function setStatsNote(msg) {
  for (const id of STAT_BOX_IDS) $("#" + id).textContent = "–";
  const dist = $("#dist");
  dist.textContent = "";
  const note = document.createElement("p");
  note.className = "muted dist-note";
  note.textContent = msg;
  dist.appendChild(note);
}

// Render the 1–6 guess-distribution bars from a {guesses: count} map.
function renderDist(distribution, highlight) {
  const dist = $("#dist");
  dist.textContent = "";
  const counts = [1,2,3,4,5,6].map((i) => distribution[i] || 0);
  const maxDist = Math.max(1, ...counts);
  for (let i = 1; i <= 6; i++) {
    const v = distribution[i] || 0;
    const isEmpty = v === 0;
    const row = document.createElement("div");
    row.className = "dist-row" + (i === highlight ? " current" : "") + (isEmpty ? " empty" : "");
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(i);
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "fill";
    // Empty rows use the CSS-set fixed width (24px). Non-empty rows scale by share
    // of the max bin, with a sensible floor so a single win is still readable.
    if (!isEmpty) {
      const pct = Math.max(14, Math.round((v / maxDist) * 100));
      fill.style.width = `${pct}%`;
    }
    fill.textContent = String(v);
    track.appendChild(fill);
    row.appendChild(num);
    row.appendChild(track);
    dist.appendChild(row);
  }
}

// Fetch the server profile and fill the stats boxes + distribution. The just-
// finished append may land a beat after the modal opens (room broadcasts finish
// and reports in parallel) — we accept eventual consistency; the next open is
// correct. No username → prompt to pick one; fetch failure → honest note.
async function fillStatsPanel(opts = {}) {
  const username = getUsername();
  if (!username) { setStatsNote(t("stats.needUsername")); return; }
  let stats;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(String(res.status));
    stats = (await res.json()).stats;
  } catch {
    setStatsNote(t("stats.loadFailed"));
    return;
  }
  const played = stats.gamesPlayed || 0;
  $("#statPlayed").textContent = played;
  $("#statWinPct").textContent = played ? Math.round((stats.wins / played) * 100) : 0;
  $("#statCurStreak").textContent = stats.currentStreak || 0;
  $("#statMaxStreak").textContent = stats.bestStreak || 0;
  renderDist(stats.guessDistribution || {}, opts.justFinished && opts.won ? opts.lastGuessCount : null);
}

// --- Rematch handshake (client) ---------------------------------------------
// One source of truth for proposing + rendering the four end-screen states.
function opponentName() {
  const snap = game.snapshot;
  const me = getUsername();
  const other = snap?.players.find((p) => p.username !== me);
  return other?.username ?? "your opponent";
}

// The idle rematch button reads "Rematch" in the Arena (where it sits beside Join next /
// Create / Main menu) and "Play again" on friend/daily end screens.
function rematchLabel() {
  return t(game.fromArena ? "endscreen.rematch" : "endscreen.playAgain");
}

// Propose a rematch and morph the action into a cancellable waiting state. The
// waiting/accept/decline UI lives in the stats modal, so make sure it's open
// (proposing from the lobby #rematchBtn while the modal is closed otherwise gives
// no visible "Waiting…" feedback).
function proposeRematch() {
  const dsnap = game.snapshot;
  if (dsnap && dsnap.isDuel) {
    // Duel: "play again" means ready up for the next KOTH round (no rematch handshake).
    const meP = dsnap.players.find((p) => p.username === getUsername());
    if (meP && meP.role === "duelist") send({ type: "ready", ready: true });
    closeStats();
    return;
  }
  send({ type: "rematch_propose" });
  // Solo room: there's no opponent to wait on. The server starts a fresh game at
  // once and the round-start snapshot (plus rematch_accepted → closeStats) resets the
  // board — so skip the "Waiting for your opponent" state entirely and keep replay smooth.
  if ((game.snapshot?.players?.length ?? 1) <= 1) return;
  const modal = document.getElementById("statsModal");
  if (modal && modal.hidden) openStats();
  renderRematchWaiting(opponentName());
}

// Render helpers operate on the stats-modal action row (#modalPlayAgain) so the
// handshake lives where the player already is post-game. The button is reused;
// a sibling #rematchDecline is created on demand for the recipient prompt.
function rematchControls() {
  const play = document.getElementById("modalPlayAgain");
  let decline = document.getElementById("rematchDecline");
  if (!decline && play) {
    decline = document.createElement("button");
    decline.id = "rematchDecline";
    decline.className = play.className;
    play.parentNode.insertBefore(decline, play.nextSibling);
  }
  return { play, decline };
}

function renderRematchIdle() {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.hidden = false; play.disabled = false; play.textContent = rematchLabel(); play.onclick = proposeRematch; }
}

function renderRematchWaiting(who) {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) {
    play.hidden = false;
    play.disabled = false;
    play.textContent = t("rematch.waiting", { who });
    play.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; // ✕ cancels my own
  }
}

function renderRematchPrompt(who) {
  const { play, decline } = rematchControls();
  if (play) { play.hidden = false; play.disabled = false; play.textContent = t("rematch.accept"); play.onclick = () => send({ type: "rematch_accept" }); }
  if (decline) { decline.hidden = false; decline.textContent = t("rematch.decline"); decline.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; }
  const eg = document.getElementById("endgameMsg");
  if (eg && !eg.querySelector(".rematch-prompt")) {
    eg.hidden = false;
    const line = document.createElement("div");
    line.className = "endgame-status rematch-prompt";
    line.textContent = t("rematch.prompt", { who });
    eg.prepend(line);
  }
}

// A cancelled proposal: one friendly line keyed to reason, then fade Home (~2s).
function settleRematchHome(reason, who) {
  const key = reason === "timeout" ? "rematch.timeout" : reason === "left" ? "rematch.left" : "rematch.declined";
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.disabled = true; play.textContent = t(key, { who }); }
  clearTimeout(game.rematchSettleTimer);
  game.rematchSettleTimer = setTimeout(() => {
    game.rematchSettleTimer = null;
    closeStats(); leaveRoom(); showHome();
  }, 2000);
}

function openStats(opts = {}) {
  const modal = $("#statsModal");
  modal.hidden = false;
  modal.removeAttribute("hidden");
  // Stats are server-truth: the room reports every finished game to the player's
  // User DO, so we fetch the profile rather than keep a parallel local tally.
  // Async-fill the four boxes + distribution; the rest of the modal renders now.
  fillStatsPanel(opts);

  const eg = $("#endgameMsg");
  eg.textContent = "";
  eg.className = "endgame";
  if (opts.justFinished && opts.snap) {
    const snap = opts.snap;
    const winner = snap.winner; // winner username (string) or null
    // One short status line — the word itself (+ definition + lookup) lives in the
    // word card below, so we never repeat "the word was X" here.
    const status = document.createElement("span");
    status.className = "endgame-status";
    if (opts.inspire) {
      eg.classList.add("inspire");
      status.classList.add("inspire-line");
      status.textContent = opts.inspire;
    } else if (opts.won && winner && winner === getUsername()) {
      status.textContent = t("endscreen.youWon", { n: opts.lastGuessCount });
    } else if (winner) {
      const me = snap.players.find((p) => p.username === getUsername());
      const kind = me ? lossKind({
        status: me.status,
        guessCount: me.guesses?.length ?? 0,
        maxGuesses: snap.maxGuesses,
        winner,
        me: getUsername(),
      }) : "exhausted";
      status.textContent = kind === "outpaced"
        ? t("endscreen.outpaced", { who: winner })
        : t("endscreen.someoneWon", { who: winner });
    } else {
      status.textContent = t("endscreen.nobodyWon");
    }
    eg.appendChild(status);
    // The learning beat: the word, a definition, and a one-tap way to go deeper.
    renderWordCard(eg, snap.word);
    eg.hidden = false;
  } else {
    eg.hidden = true;
  }

  const finished = !!(game.snapshot && game.snapshot.phase === "finished");
  // Arena games get the "keep playing the Arena" action set; everyone else keeps the
  // plain Challenge + Play-again pair. .is-arena flips the CSS order so the buttons read
  // Join next → Rematch → Create → Main menu → Challenge (DOM order stays friend-screen).
  const arena = finished && game.fromArena === true;
  const actions = document.querySelector(".modal-actions");
  if (actions) actions.classList.toggle("is-arena", arena);

  const playAgain = $("#modalPlayAgain");
  // Death is final: a challenge is one run per player — no Play Again on the same pinned
  // word (it never scored anyway; the server now refuses the restart too). Hiding the
  // button also disarms the Enter shortcut that silently "continued" a lost challenge.
  if (finished && !game.challengeId) {
    playAgain.hidden = false;
    playAgain.onclick = proposeRematch;
    // Reset to the plain idle state; hide any stale decline button from a prior prompt.
    const stale = document.getElementById("rematchDecline");
    if (stale) stale.hidden = true;
    playAgain.textContent = rematchLabel(); // "Rematch" in the Arena, else "Play again"
    playAgain.disabled = false;
  } else {
    playAgain.hidden = true;
  }

  // The three Arena-only actions. Hidden (and inert) on every non-Arena end screen.
  const joinNext = document.getElementById("modalJoinNext");
  if (joinNext) { joinNext.hidden = !arena; joinNext.textContent = t("endscreen.joinNext"); joinNext.onclick = joinNextArena; }
  const createGame = document.getElementById("modalCreateGame");
  if (createGame) { createGame.hidden = !arena; createGame.textContent = t("endscreen.createGame"); createGame.onclick = hostPublicArena; }
  const mainMenu = document.getElementById("modalMainMenu");
  if (mainMenu) { mainMenu.hidden = !arena; mainMenu.textContent = t("endscreen.mainMenu"); mainMenu.onclick = backToMenu; }

  // Pre-render the share card so a later Share tap can fire navigator.share with a ready
  // blob (iOS rejects share() after an async toBlob). The canvas draw is 2x-DPR and heavy,
  // so run it AFTER the modal has painted (double-rAF) rather than on the open frame — it's
  // ready in tens of ms, long before anyone reads the results and taps Share.
  requestAnimationFrame(() => requestAnimationFrame(() => { void prepareShareCard(); }));

  // Challenge end screen. The duel was UNTOLD during play (no live ghost for a ?vs=
  // link) — so THIS line is where it resolves: the challenger's stored run is fetched
  // now and judged by guesses (never synthetic replay timing). No vs (or a challenger
  // who never played the word) → the standing record, re-fetched fresh.
  const recEl = document.getElementById("challengeRecordLine");
  if (recEl) recEl.textContent = "";
  if (game.challengeId && recEl) {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const maxG = game.snapshot?.maxGuesses ?? 6;
    const myWon = me?.status === "won";
    const myScore = myWon ? `${me.guesses.length}/${maxG}` : `X/${maxG}`;
    const recordLine = () =>
      fetch(`/api/challenge/${game.challengeId}/meta`).then((r) => r.json()).then((m) => {
        const rec = m.record ? `Record: @${m.record.username} ${m.record.score}` : "You set the first record!";
        const el = document.getElementById("challengeRecordLine");
        if (el) el.textContent = `You: ${myScore} · ${rec}`;
      });
    const duelLine = () =>
      fetch(`/api/challenge/${game.challengeId}/ghosts?vs=${encodeURIComponent(game.challengeVs)}`)
        .then((r) => r.json())
        .then(({ ghosts }) => {
          const finish = ghosts?.events?.find((e) => e.k === "finish");
          if (!finish) return recordLine(); // challenger never played it — record instead
          const el = document.getElementById("challengeRecordLine");
          if (el && me) el.textContent = duelVerdict({
            myWon, myGuesses: me.guesses.length, maxGuesses: maxG,
            theirWon: finish.status === "won", theirGuesses: finish.guesses,
            name: game.challengeVs,
          });
        });
    (game.challengeVs && me ? duelLine() : recordLine()).catch(() => {});
  }

  $("#modalShare").onclick = () => shareResult();
  // The headline CTA: same share, explicit "throw down the gauntlet" framing.
  const challengeBtn = $("#modalChallenge");
  if (challengeBtn) challengeBtn.onclick = () => shareResult();

  const urlEl = $("#shareUrl");
  const copyBtn = $("#shareCopy");
  const row = $(".share-row");
  if (urlEl) urlEl.value = game.shareImage?.url ?? location.href;
  if (row) row.classList.toggle("no-native", typeof navigator.share !== "function");
  // "Save card" — the PNG card moved here when sharing went link-first (AirDrop
  // ships an attached file alone, so the file can't ride along with the link).
  const saveBtn = $("#shareSave");
  if (saveBtn) {
    saveBtn.textContent = t("endscreen.saveCard");
    saveBtn.hidden = !game.shareImage?.canvas; // prepareShareCard reveals it when the canvas lands
    saveBtn.onclick = () => {
      if (game.shareImage?.canvas) downloadCanvas(game.shareImage.canvas, "wordul.png");
    };
  }
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(game.shareImage?.url ?? location.href);
      copyBtn.textContent = "✓ Copied"; copyBtn.classList.add("ok");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("ok"); }, 1600);
    } catch { prompt("Copy this link:", game.shareImage?.url ?? location.href); }
  };

  modal.addEventListener("click", onModalClick);
}
function onModalClick(e) {
  if (e.target.matches("[data-close]")) closeStats();
}
function closeStats() {
  const modal = $("#statsModal");
  modal.hidden = true;
  modal.setAttribute("hidden", "");
  modal.removeEventListener("click", onModalClick);
}

// --- Share ---
// The share is an IMAGE card (score grid + the word + a "beat me" CTA with a link
// straight into this room), not plain text — something you'd actually want to send.

// Build the card and cache a PNG File so shareResult() can call navigator.share
// synchronously inside the click gesture (iOS requirement). Called on modal open.
async function prepareShareCard() {
  game.shareImage = null;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "finished") return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;

  const maxG = snap.maxGuesses ?? 6;
  const won = me.status === "won";
  const score = won ? `${me.guesses.length}/${maxG}` : `X/${maxG}`;

  // Mint (or reuse) a challenge for THIS word so the card's CTA is a real replay link.
  // If we arrived via a challenge link already, reuse that id (don't re-mint the same
  // word). A seeded arena room already published one WITH the ghost tape — prefer it.
  let challengeId = game.challengeId || snap.shareChallengeId || null;
  // The daily is a shared, blind, leaderboard word — never a personal ghost duel. Skip
  // the mint entirely: its live `word` is stripped server-side, so a mint would file a
  // junk challenge whose ghost falls back to a seeded record. The card links to the day
  // itself (below) — a brag, not a versus lobby.
  if (!challengeId && !game.isDaily) {
    // My run, re-cut as a ghost tape (masks only) — so whoever takes the challenge
    // races my replay, not just a static score. Built OUTSIDE the mint try: a tape
    // bug must degrade to a ghost-less challenge, never cost us the mint itself.
    let ghosts;
    try {
      ghosts = buildOwnerTape({
        username: getUsername(),
        wordLength: snap.wordLength ?? 5,
        maxGuesses: maxG,
        masks: (me.guesses || []).map((g) => g.mask),
        won,
        times: game.myGuessTimes,
        startAt: game.myRoundStartAt ?? null,
      }) ?? undefined;
    } catch { /* malformed run data — mint without a replay */ }
    try {
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: (snap.word || "").toUpperCase(),
          wordLength: snap.wordLength ?? 5,
          owner: getUsername(),
          ownerScore: score,
          ownerGrid: (me.guesses || []).map((g) => g.mask),
          ghosts,
        }),
      });
      if (!res.ok) throw new Error(`mint ${res.status}`); // fetch doesn't throw on 5xx
      challengeId = (await res.json()).id;
    } catch { /* offline / mint failed — the card falls back to a plain link below */ }
  }
  const cardUrl = game.isDaily
    ? `${location.origin}/daily/${game.dailyDate}`
    : challengeId
      ? withMyVs(`${location.origin}/c/${challengeId}`)
      : shareTargetUrl({ origin: location.origin, owner: game.owner, slug: game.slug });

  // The card draws ONLY the color grid (no letters, no answer) — the model is the
  // no-spoiler guarantee, unit-tested in test/share-card.test.js.
  const model = buildShareCardModel({
    username: getUsername(), guesses: me.guesses || [], won, score,
    challengeUrl: cardUrl.replace(/^https?:\/\//, ""),
  });
  const canvas = renderShareCard(model, snap.wordLength ?? 5);
  const text = game.isDaily
    ? (won ? `Solved today's Wordul in ${score} — your turn?` : `Today's Wordul got me. Your turn?`)
    : won
      ? `Solved Wordul in ${score} — beat me?`
      : `Wordul got me. Your turn?`;
  game.shareImage = { url: cardUrl, text, canvas };
  // The share row may have rendered before the mint resolved — backfill its URL field
  // and reveal "Save card" now that a canvas exists to save.
  const urlEl = $("#shareUrl");
  if (urlEl) urlEl.value = cardUrl;
  const saveBtn = $("#shareSave");
  if (saveBtn) saveBtn.hidden = false;
}

async function shareResult() {
  // LINK-first, never file-first: AirDrop ships an attached file ALONE (text + url
  // silently dropped), so sharing the PNG card meant AirDrop delivered an image with
  // no tappable way in. A bare url AirDrops as a real link and unfurls an OG preview
  // in iMessage/WhatsApp. The pretty card lives behind "Save card" instead.
  const img = game.shareImage;
  const url = img?.url ?? withMyVs(shareTargetUrl({
    origin: location.origin, challengeId: game.challengeId,
    shareChallengeId: game.snapshot?.shareChallengeId, owner: game.owner, slug: game.slug,
  }));
  const text = img?.text ?? "Race me on Wordul!";
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  fallbackCopy(`${text} ${url}`);
}

function fallbackCopy(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => prompt("Copy this:", text),
  );
}

function downloadCanvas(canvas, name) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}


// --- top-level UI wiring ---
document.addEventListener("DOMContentLoaded", () => {
  applySettings(getSettings());
  // The avatar IS the hub: one tap opens settings / theme / mute / stats (and, in a
  // room, the mid-play-hidden share / rename / scoreboard). Replaces the old scattered
  // ⚙ / 📊 / 🔊 icons. The avatar glyph is the username's initial (no edition avatar field).
  const avatarBtn = $("#avatarBtn");
  if (avatarBtn) {
    syncAvatar();
    avatarBtn.addEventListener("click", () => showHub(avatarBtn));
  }
  // Clicking the logo always takes you home — the universal escape hatch.
  const brandBtn = $("#brandBtn");
  if (brandBtn) brandBtn.addEventListener("click", () => navigate("/"));
  // Global physical-keyboard handler — drives type-to-start on home/lobby and typing in-game.
  document.addEventListener("keydown", onPhysicalKey);
  route();
  // Hydrate the effective Worlds registry (code defaults + admin KV overrides) without
  // blocking first paint. Once it arrives, re-render only the worlds-bearing views so
  // admin edits show up; other routes (in-game, profiles, etc.) are left untouched.
  loadWorlds().then((changed) => {
    const p = location.pathname;
    if (changed && (p === "/" || p === "/worlds")) route();
  });
  loadVoiceConfig(); // hydrate the effective voice registry (code defaults + admin overrides); fire-and-forget, never throws
});

// Paint the hub trigger from the username: @handle is the tappable menu opener (the ▾
// chevron is a CSS ::after). A generic ◆ stands in before the player picks a name.
// Called on load + whenever the username changes (setUsername/clearUsername).
function syncAvatar() {
  const avatarBtn = $("#avatarBtn");
  if (!avatarBtn) return;
  const u = getUsername();
  avatarBtn.textContent = "";
  const label = document.createElement("span");
  label.className = "avatar-handle";
  label.textContent = u ? `@${u}` : "◆";
  avatarBtn.appendChild(label);
  avatarBtn.setAttribute("aria-label", u ? `Open menu — @${u}` : "Menu");
}

// Open the settings modal, wiring the orchestrator-owned bits (live re-render,
// theme picker, the keyboard layout picker mount, reset-stats) into settings.js.
// settings.js owns the modal chrome (chevron sections, toggle persistence, close);
// app.js only supplies callbacks for state it owns (game.snapshot, render, stats).
function showSettings() {
  const snap = game.snapshot;
  openSettings({
    inRoom: !!snap,
    // Mount the room's word-length picker into the gear's "Room" section (in a room only).
    mountRoomLength: snap ? () => { syncLengthSelect(snap); syncRowsSelect(snap); } : null,
    onChange: () => { if (game.snapshot) render(); },
    renderEditionPicker,
    // Theme is bound to the room: picking sends set_edition so the server rethemes
    // everyone. send() is a no-op with no open socket, so solo play just keeps the
    // local theme applyEdition already set. Locked mid-game (server enforces too).
    onEditionPick: (id) => send({ type: "set_edition", edition: id }),
    editionLocked: game.snapshot?.phase === "playing",
    toast: (t, o) => toast(t, o),
    // Mount the keyboard layout picker into the Advanced section. Owning the
    // save → rebuild → re-render here keeps settings.js free of a keyboard import
    // (keyboard.js imports settings.js, not the reverse — no cycle).
    mountLayoutPicker: (el) => renderLayoutPicker(el, {
      current: resolvedLayoutId(),
      onPick: (id) => {
        saveSettings({ ...getSettings(), keyboardLayout: id });
        buildKeyboard($("#keyboard"), id, keyboardHandlers);
        if (game.snapshot) render();
      },
    }),
  });
}

// The avatar hub: one popover that replaces the scattered ⚙/📊/🔊 icons and keeps
// the mid-play-hidden chrome (share / rename / scoreboard) reachable. settings.js
// builds + positions the menu; app.js wires every action since they touch app state.
function showHub(anchor) {
  const inRoom = !!game.snapshot;
  // Accounts P0: show "Secure this account" only when a name is set but not yet claimed.
  const needsSecure = getUsername() && !getSessionToken();
  openHub({
    anchor,
    inRoom,
    isMuted: localStorage.getItem("wordul.muted") === "1",
    isVoiceOn: isVoiceEnabled(),
    onSettings: showSettings,
    onTheme: showSettings, // theme lives inside Settings (Appearance section)
    // The @handle trigger replaced the tap-name-to-profile link, so surface the
    // player's public profile here (only when they actually have a name).
    onProfile: getUsername() ? () => navigate(`/@${getUsername()}`) : null,
    onStats: () => openStats(),
    onMute: toggleMute,
    onVoice: toggleVoice,
    onShare: inRoom ? () => shareRoomInvite() : null,
    onRename: inRoom ? () => renameRoom() : null,
    onScoreboard: inRoom ? () => scrollToScoreboard() : null,
    onSecure: needsSecure ? () => openSecureSheet(getUsername(), () => location.reload()) : null,
  });
}

// Flip the mute flag (companion voice + chimes already honor wordul.muted).
// Delegates to mute-btn.js so the in-game 🔊 button's glyph stays in sync too.
function toggleMute() {
  const muted = toggleMuted();
  toast(muted ? "Muted" : "Sound on", { duration: 1000 });
}

// Flip the companion-voice opt-in (wordul.voice — OFF by default, see edition.js).
// The end-of-game word reveal speaks either way; this governs the running commentary.
function toggleVoice() {
  const on = setVoiceEnabled(!isVoiceEnabled());
  toast(on ? "Voice on" : "Voice off — the word reveal still speaks", { duration: 1400 });
}

// Tear down any live room connection when leaving a room view.
function leaveRoom() {
  if (game.rematchSettleTimer) { clearTimeout(game.rematchSettleTimer); game.rematchSettleTimer = null; }
  stopCountdownOverlay(); // tear down a duel 3-2-1 overlay if we navigate away mid-countdown
  resetGhostReplay(); // stop a running tape + drop the ghost field
  // (ghostReady overlay removed; standard lobby start now gates ghost challenges)
  teardownLobbyRail(); // stop the open-games poll when leaving the room (incl. defection)
  stopHeartbeat();
  game.challengeId = null;
  game.challengeVs = "";
  game.challengeMeta = null;
  pendingRoomEdition = null; // discard any pending one-shot edition from a failed/aborted create
  clearPayoutTimers(); // cancel any pending payout/drain so it can't fire off-screen + mutate gold
  clearReconnectNotice();
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = null;
  game.reconnectAttempts = 0;
  game.pendingReconnect = null;
  if (game.socketSession) {
    game.socketSession.reconnect = false;
    const ws = game.socketSession.ws;
    game.socketSession = null;
    game.ws = null;
    try { ws.close(); } catch {}
  }
  clearHeaderIdentity(); // drop the in-room username + gold from the topbar header
  document.body.classList.remove("playing"); // restore full chrome outside a room
  document.body.classList.remove("daily");
  document.body.classList.remove("daily-ritual");
  document.body.classList.remove("lobby"); // drop the two-zone lobby layout outside a room
  game.isDaily = false; game.dailyDate = null;
  tapeSuspend(); // detach the recorder so the next room's keystrokes can't pollute this tape (mirror kept for resume)
  settlementShown = false; // discard stale latch so a different already-finished room can show
}

// The archive: every past day as a clickable list (data from /api/daily/dates).
async function showDailyArchive() {
  leaveRoom();
  mount("tpl-profile");
  const back = $("#profileBack"); if (back) back.onclick = (e) => { e.preventDefault(); navigate("/"); };
  document.title = "Wordul Daily — Archive";
  const mountEl = $("#profileMount");
  if (mountEl) mountEl.innerHTML = `<h1>${t("daily.archiveTitle")}</h1><ul class="daily-archive-list" id="dailyArchiveList"></ul>`;
  try {
    const res = await fetch("/api/daily/dates");
    const { dates } = res.ok ? await res.json() : { dates: [] };
    const list = $("#dailyArchiveList");
    if (list) for (const d of dates.slice().reverse()) {
      const li = document.createElement("li");
      const a = document.createElement("a"); a.href = `/daily/${d}`; a.textContent = d; a.className = "link";
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/daily/${d}`); });
      li.appendChild(a); list.appendChild(li);
    }
  } catch { /* empty archive degrades to just the heading */ }
}

function showProfile(username) {
  leaveRoom();
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  document.title = `@${username} — Wordul`;
  mount("tpl-profile");
  const backBtn = $("#profileBack");
  if (backBtn) backBtn.onclick = (e) => { e.preventDefault(); navigate("/"); };
  renderProfile(username, $("#profileMount"));
}

// A user's published worduls gallery (/@<user>/worduls). Paints a back link + a mount
// container into #app, then lazy-loads the gallery module to fetch + render the cards.
function showWordulsGallery(username) {
  leaveRoom();
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  document.title = `@${username}'s worduls — Wordul`;
  applyEdition(getActiveEditionId());
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen worduls-gallery-screen";
  const back = document.createElement("a");
  back.href = "/"; back.className = "link worduls-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  const root = document.createElement("div");
  root.id = "worduls-root";
  root.dataset.spaMounted = "1"; // suppress the module's standalone self-mount
  screen.append(back, root);
  app.append(screen);

  import("/worduls-gallery.js")
    .then((m) => m.renderWorduls(username, root))
    .catch((e) => { root.innerHTML = `<p class="empty">Could not load worduls.</p>`; console.error("gallery load failed", e); });
}

// Breadcrumb trail under the brand — the one place that always knows "where am I".
// Home shows nothing (the brand alone is enough); rooms/profiles show a clickable
// "Home › <here>" so you can never get stranded deep in the app.
function renderCrumbs(r) {
  const nav = $("#crumbs");
  if (!nav) return;
  if (r.kind === "home") {
    nav.hidden = true;
    nav.innerHTML = "";
    return;
  }
  const here =
    r.kind === "room" ? r.slug.replace(/-/g, " ")
    : r.kind === "challenge" ? "challenge"
    : r.kind === "daily" ? "Daily"
    : r.kind === "daily-stats" ? "Stats"
    : r.kind === "daily-archive" ? "Archive"
    : r.kind === "live" ? "Live"
    : r.kind === "feed" ? "Lab"
    : r.kind === "feed-post" ? "Lab · " + r.date
    : r.kind === "worlds" ? "Worlds"
    : r.kind === "world" ? (getWorld(r.slug)?.name ?? "World")
    : `@${r.username}`;
  nav.hidden = false;
  nav.innerHTML = "";
  const home = document.createElement("button");
  home.type = "button";
  home.className = "crumb crumb-link";
  home.textContent = "Home";
  home.addEventListener("click", () => navigate("/"));
  const sep = document.createElement("span");
  sep.className = "crumb-sep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = "›";
  const cur = document.createElement("span");
  cur.className = "crumb crumb-current";
  cur.setAttribute("aria-current", "page");
  cur.textContent = here;
  nav.append(home, sep, cur);
}

// The Worlds theater (/worlds): a tabbed wall of themed cards. Tabs: Featured · All ·
// Mine (recently visited). Live counts / an "Active" tab arrive in Plan 2b. Each card
// self-paints (paintEditionVars); the page chrome stays on the saved default.
function showWorlds() {
  document.title = "Worlds — Wordul";
  applyEdition(getActiveEditionId()); // neutral page chrome; cards paint themselves
  setActiveVoiceId(null); // the theater is a non-game surface → silent
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen worlds-screen";

  const back = document.createElement("a");
  back.href = "/"; back.className = "link worlds-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });

  const head = document.createElement("header");
  head.className = "worlds-head";
  const kicker = document.createElement("span");
  kicker.className = "daily-kicker"; kicker.textContent = "Worlds";
  const h1 = document.createElement("h1");
  h1.className = "worlds-title"; h1.textContent = "Browse Worlds";
  head.append(kicker, h1);

  const tabsBar = document.createElement("div");
  tabsBar.className = "worlds-tabs"; tabsBar.setAttribute("role", "tablist");
  const wall = document.createElement("div");
  wall.className = "worlds-wall"; wall.id = "worldsWall";

  const TABS = [
    { key: "featured", label: "Featured", worlds: () => featuredWorlds() },
    { key: "all",      label: "All",      worlds: () => listWorlds() },
    { key: "mine",     label: "Mine",     worlds: () => getRecentWorldSlugs().map(getWorld).filter(Boolean) },
  ];

  const paintWall = (worlds) => {
    wall.textContent = "";
    if (worlds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted worlds-empty";
      empty.textContent = "No Worlds here yet — visit a few and they'll show up.";
      wall.appendChild(empty);
      return;
    }
    for (const w of worlds) {
      const card = renderWorldCard(w);
      if (!card) continue;
      card.addEventListener("click", (e) => { e.preventDefault(); navigate("/w/" + w.slug); });
      wall.appendChild(card);
    }
  };

  TABS.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    btn.className = "worlds-tab" + (i === 0 ? " is-active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      tabsBar.querySelectorAll(".worlds-tab").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      paintWall(tab.worlds());
    });
    tabsBar.appendChild(btn);
  });

  screen.append(back, head, tabsBar, wall);
  app.appendChild(screen);
  paintWall(TABS[0].worlds()); // default to Featured
}

// A World page (/w/<slug>): a themed place you can visit, share, and play in. Landing
// here is a TRY-ON — the skin is applied for this visit only (persist:false), never
// silently saved as the default. "Make this my default" is the only thing that commits.
// Live counts + "Join the live race" + SEO meta arrive in Plan 2; an unknown slug here
// redirects to /worlds.
function showWorld(slug) {
  const world = getWorld(slug);
  if (!world) { navigate("/worlds"); return; }
  pushRecentWorld(slug); // feeds the theater's "Mine" tab
  document.title = `${world.name} — Wordul`;
  // Try-on: preview the skin without changing the saved default.
  applyEdition(world.editionId, { persist: false });
  setActiveVoiceId(getWorld(slug)?.id ?? null); // the world's own voice owns the /w/<slug> preview

  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen world-screen";

  const back = document.createElement("a");
  back.href = "/worlds"; back.className = "link world-back"; back.textContent = "← Worlds";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/worlds"); });

  const head = document.createElement("header");
  head.className = "world-head";
  const kicker = document.createElement("span");
  kicker.className = "daily-kicker"; kicker.textContent = "World";
  const h1 = document.createElement("h1");
  h1.className = "world-title"; h1.textContent = world.name;
  const blurb = document.createElement("p");
  blurb.className = "world-blurb muted"; blurb.textContent = world.blurb;
  head.append(kicker, h1, blurb);

  const actions = document.createElement("div");
  actions.className = "world-actions";

  const play = document.createElement("button");
  play.type = "button"; play.className = "btn block"; play.textContent = "Play solo →";
  play.addEventListener("click", () => {
    if (!getUsername()) { toast("Pick a username to play", { duration: 1800 }); navigate("/"); return; } // no identity yet — register on Home first
    enterNewRoom({ autoStart: true, editionId: world.editionId });
  });

  const makeDefault = document.createElement("button");
  makeDefault.type = "button"; makeDefault.className = "btn block ghost";
  makeDefault.textContent = "Make this my default theme";
  makeDefault.addEventListener("click", () => {
    setDefaultEdition(world.editionId);
    toast("Saved — this World is your default look now", { duration: 1600 });
  });

  actions.append(play, makeDefault);
  screen.append(back, head, actions);
  app.appendChild(screen);
}

function route() {
  stopArenaPoll(); // leaving the in-place Arena view (incl. browser Back / popstate) kills its poll
  if (liveChatStop) { liveChatStop(); liveChatStop = null; } // leaving /live kills the chat socket
  // The ritual stage class must not outlive the daily view: routes that don't pass
  // through leaveRoom (/feed, /worlds, stats) would otherwise keep header chrome
  // hidden. renderDailyUnlock re-adds it whenever a finished daily renders.
  document.body.classList.remove("daily-ritual");
  const r = parseRoute();
  renderCrumbs(r);
  if (r.kind === "challenge") {
    showChallenge(r.id);
    return;
  }
  if (r.kind === "daily") { showDaily(r.date); return; }
  if (r.kind === "daily-stats") { showDailyStats(r.date); return; }
  if (r.kind === "daily-archive") { showDailyArchive(); return; }
  if (r.kind === "live") { showLiveRoute(); return; }
  if (r.kind === "feed") { showFeed(); return; }
  if (r.kind === "feed-post") { showFeedPost(r.date); return; }
  if (r.kind === "worlds") { showWorlds(); return; }
  if (r.kind === "world") { showWorld(r.slug); return; }
  if (r.kind === "room") {
    if (getUsername()) {
      showRoom(r.owner, r.slug);
    } else {
      showRoomEntry(r.owner, r.slug);
    }
  } else if (r.kind === "worduls-gallery") {
    showWordulsGallery(r.username);
  } else if (r.kind === "profile") {
    showProfile(r.username);
  } else {
    leaveRoom();
    showHome();
  }
}

window.addEventListener("popstate", route);
