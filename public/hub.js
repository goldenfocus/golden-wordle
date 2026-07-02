// public/hub.js — the Wordul home shell: identity on top, the daily card, modes below.
// The daily card (play + post-play states + countdown) lives in daily-card.js; the
// shared icon set in hub-glyphs.js. This file orchestrates the shell + topbar stats.
import { GLYPH } from "/hub-glyphs.js";
import { dayTheme, renderDailyCard, wireDailyCard } from "/daily-card.js";
import { featuredWorlds } from "/worlds.js";
import { renderWorldCard } from "/world-card.js";
import { t } from "/i18n.js";
import { initDailyCarousel } from "/daily-carousel.js";

// Re-exported for back-compat: app.js and tests import dayTheme from here.
export { dayTheme };

let hubCallbacks = {};

// Shared, hub-wide state the shell reads (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

// callbacks: { username, editions, editionName(id), onPlay(editionId, seed), onSolo(),
//   onPvP(), onLive(), onStats(), onShareDaily(), dailyResult, renderRecentRooms(el), fetchPlayed() }
// dailyResult is null until you've played today, then { won, guesses }.
// The avatar/menu is the one persistent topbar avatar (#avatarBtn → showHub).
export function renderHub(profile, callbacks) {
  hubState.gold = (profile && typeof profile.gold === "number") ? profile.gold : 0;
  hubState.streak = profile?.stats?.currentStreak ?? 0;
  hubState.username = callbacks.username ?? "";
  hubCallbacks = callbacks;

  const hub = document.getElementById("hub");
  if (hub) hub.hidden = false;
  // Reveal the home-only gold + streak in the persistent topbar (mount() cleared it).
  document.body.classList.add("hub-home");
  const g = document.getElementById("hubGoldVal");
  const s = document.getElementById("hubStreakVal");
  if (g) g.textContent = String(hubState.gold);
  // The stacked glyph/number split (iter3 §3) reads as one phrase via the container label.
  document.getElementById("hubGold")?.setAttribute("aria-label", `${hubState.gold} gold`);
  if (s) s.textContent = String(hubState.streak);
  // Streak only shows when there IS one — no cold flame sitting at 0.
  const streakEl = document.getElementById("hubStreak");
  if (streakEl) streakEl.hidden = hubState.streak <= 0;

  const content = document.getElementById("hubContent");
  if (content) { content.innerHTML = renderDaily(); wireDaily(); }
}

function shortDate(d) { return d.toLocaleDateString("en-US", { day: "numeric", month: "short" }); }

function themeOfDay() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  return dayTheme(new Date(), ids.length ? ids : ["default"]);
}

function renderDaily() {
  const themeId = themeOfDay();
  const themeName = hubCallbacks.editionName ? hubCallbacks.editionName(themeId) : themeId;
  return `<section class="hub-panel daily" id="dailyPanel">
    <header class="daily-head" id="dailyCarHead">
      <button type="button" class="daily-arrow" id="dailyPrev" aria-label="${t("daily.prevDay")}" hidden>‹</button>
      <div class="daily-head-mid">
        <span class="daily-kicker">${themeName} <span class="daily-edition-by">· from the Studio</span></span>
        <h1 class="daily-date" id="dailyCarDate">${shortDate(new Date())}</h1>
      </div>
      <button type="button" class="daily-arrow" id="dailyNext" aria-label="${t("daily.nextDay")}" hidden>›</button>
    </header>
    <div id="dailyCarSlot">
      <div id="dailyToday">${renderDailyCard({ themeId, result: hubCallbacks.dailyResult ?? null })}</div>
      <div id="dailyPast" hidden></div>
    </div>

    <section class="hub-modes" aria-label="Other ways to play">
      <div class="mode-grid mode-grid-3">
        <button id="modeSolo" class="mode-tile" type="button" aria-label="Solo" title="Solo">
          <span class="mode-ico">${GLYPH.solo}</span>
          <span class="mode-name">Solo</span>
        </button>
        <button id="modePvP" class="mode-tile" type="button" aria-label="Duel — invite a friend" title="Duel">
          <span class="mode-ico">${GLYPH.duo}</span>
          <span class="mode-name">Duel</span>
        </button>
        <button id="modeLive" class="mode-tile" type="button" aria-label="Live" title="Live">
          <span class="mode-ico">${GLYPH.crowd}</span>
          <span class="mode-name">Live</span>
        </button>
      </div>
    </section>

    <section class="hub-worlds" aria-label="Worlds">
      <div class="hub-worlds-head">
        <span class="section-label">Worlds</span>
      </div>
      <div class="worlds-strip" id="worldsStrip"></div>
    </section>

    <section class="daily-recent" id="dailyRecent" hidden>
      <span class="section-label">Recent</span>
      <ul id="hubRoomList" class="room-list"></ul>
    </section>
  </section>`;
}

function wireDaily() {
  // The card owns its own events; we register its type-to-play handler for the home
  // keydown listener (a no-op in the post-play state).
  const { onType } = wireDailyCard({
    themeId: themeOfDay(),
    result: hubCallbacks.dailyResult ?? null,
    username: hubCallbacks.username,
    onPlay: hubCallbacks.onPlay,
    onStats: hubCallbacks.onStats,
    onShareDaily: hubCallbacks.onShareDaily,
    onProfile: hubCallbacks.onProfile,
    fetchPlayed: hubCallbacks.fetchPlayed,
    fetchLeaderboard: hubCallbacks.fetchLeaderboard,
  });
  onHomeTyping = onType;

  const solo = document.getElementById("modeSolo");
  if (solo && hubCallbacks.onSolo) solo.addEventListener("click", () => hubCallbacks.onSolo());
  const pvp = document.getElementById("modePvP");
  if (pvp && hubCallbacks.onPvP) pvp.addEventListener("click", () => hubCallbacks.onPvP());
  const live = document.getElementById("modeLive");
  if (live && hubCallbacks.onLive) live.addEventListener("click", () => hubCallbacks.onLive());

  const strip = document.getElementById("worldsStrip");
  if (strip) {
    strip.textContent = "";
    // Registry hydration (admin KV overrides) is driven by app.js boot: loadWorlds() runs
    // after first paint, then re-calls route() → showHome() → renderHub(), so this loop
    // automatically sees the updated registry. No loadWorlds() call needed here.
    for (const w of featuredWorlds()) {
      const card = renderWorldCard(w);
      if (!card) continue;
      card.addEventListener("click", (e) => {
        if (hubCallbacks.onWorld) { e.preventDefault(); hubCallbacks.onWorld(w.slug); }
      });
      strip.appendChild(card);
    }
    // Trailing "Browse all →" card → /worlds theater.
    const all = document.createElement("a");
    all.id = "worldsBrowseAll";
    all.className = "world-card world-card-more";
    all.href = "/worlds";
    all.textContent = "Browse all →";
    all.addEventListener("click", (e) => {
      if (hubCallbacks.onBrowseWorlds) { e.preventDefault(); hubCallbacks.onBrowseWorlds(); }
    });
    strip.appendChild(all);
  }

  const recent = document.getElementById("dailyRecent");
  const list = document.getElementById("hubRoomList");
  if (recent && list && hubCallbacks.renderRecentRooms) {
    hubCallbacks.renderRecentRooms(list);
    if (list.children.length > 0) recent.hidden = false;
  }

  // Day carousel: swipe / arrow back through past dailies. Only meaningful once there's
  // more than today on record; the dates list arrives async (app.js re-renders the hub).
  const car = document.getElementById("dailyPanel");
  if (car && Array.isArray(hubCallbacks.dailyDates) && hubCallbacks.dailyDates.length > 1) {
    initDailyCarousel(car, {
      dates: hubCallbacks.dailyDates,
      shortDate: (d) => shortDate(new Date(`${d}T00:00:00Z`)),
      editionName: (id) => (hubCallbacks.editionName ? hubCallbacks.editionName(id) : id),
      pastRecord: (d) => hubCallbacks.pastRecord?.(d) ?? null,
      navigate: (p) => hubCallbacks.navigate?.(p),
    });
  }
}

// Document-level letter capture lives in app.js (it owns the keydown listener while
// the hub is mounted); it calls this when a bare letter is pressed on the home.
let onHomeTyping = null;
export function homeTypeLetter(letter) { if (onHomeTyping) onHomeTyping(letter); }
