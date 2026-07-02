import { Room } from "./room.ts";
import { User } from "./user.ts";
import { Challenge } from "./challenge.ts";
import { Daily } from "./daily.ts";
import { Science } from "./science-object.ts";
import { Arena } from "./arena.ts";
import { Lobby } from "./lobby.ts";
import { makeChallengeId, wordChallengeIdFromBytes } from "./challenge-core.ts";
import { tapeFromSolveGrid } from "./ghost-core.ts";
import { Worduls } from "./worduls.ts";
import { extractBearer, isOwner, wordulsStub } from "./worduls-routes.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
import { isWordPage, slugFor, wordOfTheDay, ANSWER_WORDS } from "./words.ts";
import { getEffectiveWorlds, getEffectiveWorld, WORLDS, WORLD_OVERRIDES_KEY } from "./worlds.ts";
import { normalizeOverrides } from "./world-overrides.ts";
import { getEffectiveVoice, knownClipSets, builtinClipSets, VOICE_OVERRIDES_KEY } from "./voice.ts";
import { normalizeVoiceOverrides } from "./voice-overrides.ts";
import { WordStats } from "./wordstats-do.ts";
import { activeDate } from "./daily-core.ts";
import type { World } from "./daily-core.ts";
import { buildDailyMeta, buildDailyJsonLd, buildGiftMeta, dailyPrevNext, dailyDateFromPathname, dailyOgFromPathname, giftPatternFromSearch, dailySitemapUrls } from "./daily-seo.ts";
import { renderGiftPng } from "./gift-png.ts";
import { buildWeeklyScienceSummary, type SciencePublicDailySummary } from "./science.ts";
import { buildDailyPost, buildWeeklyPost, type FeedPost } from "./feed.ts";
import { BRAIN_NOTES } from "./brain-notes.ts";
import { buildTuneMessages, cleanTuneOutput, TUNE_MODEL, MAX_STORY_CHARS, MAX_PROMPT_CHARS } from "./vibe-tune.ts";
export { Room, User, WordStats, Challenge, Daily, Science, Arena, Worduls, Lobby };

const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
const CHALLENGE_RE = /^\/c\/([0-9A-Za-z]{5})$/;
const WORLD_RE = /^\/w\/([a-z0-9-]{1,40})$/;
const SCIENCE_DAILY_RE = /^\/api\/science\/daily\/(\d{4}-\d{2}-\d{2})(?:\.json)?$/;
const FEED_DATE_RE = /^\/feed\/(\d{4}-\d{2}-\d{2})(?:\.json)?$/;

// Pure rate-limit decision: given the current window count + limit, allow or block and
// return the count to persist. Unit-tested; the KV plumbing around it is integration.
export function rateLimitDecision(count: number, limit: number): { allow: boolean; next: number } {
  if (count >= limit) return { allow: false, next: count };
  return { allow: true, next: count + 1 };
}

// KV-counter rate limit on the DIRECTORY namespace. Best-effort: a KV hiccup ALLOWS
// (fail-open) so a transient KV outage can't lock everyone out of claiming. `key` should
// already encode the scope (e.g. `rl:claim:<ip>`); `windowSec` is the bucket lifetime.
// Counter is get-then-put (not atomic): a concurrent burst can undercount — fine for a
// best-effort deterrent (the DO is the real auth boundary), not an exact quota.
// The canonical challenge id for a word — SHA-256 keeps it opaque (no word in the URL),
// deterministic so every wiki visitor lands on the same per-word leaderboard.
async function wordChallengeId(word: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`word:${word.toUpperCase()}`));
  return wordChallengeIdFromBytes(new Uint8Array(digest));
}

async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const raw = await env.DIRECTORY.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    const { allow, next } = rateLimitDecision(count, limit);
    if (allow) await env.DIRECTORY.put(key, String(next), { expirationTtl: windowSec });
    return allow;
  } catch {
    return true; // fail-open
  }
}

// Returns null when the caller holds the admin bearer token; otherwise a 401 Response.
// Closed (401) when DAILY_ADMIN_TOKEN is unset.
function requireAdmin(req: Request, env: Env): Response | null {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.DAILY_ADMIN_TOKEN || token !== env.DAILY_ADMIN_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Room WebSocket: /ws?room=<owner>/<slug>
    if (url.pathname === "/ws") {
      const challengeId = url.searchParams.get("challenge");
      if (challengeId && /^[0-9A-Za-z]{5}$/.test(challengeId)) {
        const player = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(player)) return new Response("invalid player", { status: 400 });
        const key = `c:${challengeId}:${player}`;
        const stub = env.ROOM.get(env.ROOM.idFromName(key));
        const upstream = new URL(req.url);
        upstream.searchParams.set("room", key);
        upstream.searchParams.set("challenge", challengeId);
        return stub.fetch(new Request(upstream.toString(), req));
      }
      const raw = url.searchParams.get("room") ?? "";
      const [ownerRaw, slugRaw] = raw.split("/");
      const owner = normalizeUsername(ownerRaw ?? "");
      const slug = normalizeSlug(slugRaw ?? "");
      if (!isValidUsername(owner) || slug.length < 1) {
        return new Response("invalid room", { status: 400 });
      }
      const requested = `${owner}/${slug}`;
      // A renamed room keeps its original DO key; the new (and any past) slug is a
      // KV alias back to that canonical path. Resolve it so old + new links both work.
      const canonical = (await env.DIRECTORY.get(`roomalias:${requested}`)) ?? requested;
      const stub = env.ROOM.get(env.ROOM.idFromName(canonical));
      const upstream = new URL(req.url);
      upstream.searchParams.set("room", canonical);
      return stub.fetch(new Request(upstream.toString(), req));
    }

    // Arena Open-Games index (public read). Exact-equality match — avoids the endsWith
    // shadow class. Singleton coordinator DO keyed by idFromName("arena").
    if (url.pathname === "/api/arena/open" && req.method === "GET") {
      const stub = env.ARENA.get(env.ARENA.idFromName("arena"));
      return stub.fetch(new Request("https://do/open", { method: "GET" }));
    }

    // Accounts P0 — proxy /api/account/* to the per-username User DO, with KV rate limiting.
    if (url.pathname.startsWith("/api/account/")) {
      const sub = url.pathname.slice("/api/account/".length); // "preview" | "claim" | "login" | "sessions/revoke" | "me" | "verify-session"
      const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";

      const userDo = (name: string, doPath: string, init: RequestInit) =>
        env.USER.get(env.USER.idFromName(name)).fetch(`https://do/${doPath}?username=${encodeURIComponent(name)}`, init);

      // GET /api/account/me?username=<u> with Bearer token.
      if (sub === "me" && req.method === "GET") {
        const name = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
        const authVal = req.headers.get("Authorization");
        return userDo(name, "account/me", { method: "GET", headers: authVal ? { Authorization: authVal } : {} });
      }

      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { return new Response("bad json", { status: 400 }); }
      const name = normalizeUsername(typeof body.username === "string" ? body.username : "");
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });

      // Rate-limit the abusable surfaces. preview is cheap (just generates+hashes a phrase,
      // hit on every 🎲 re-roll) → generous. claim/login are the sensitive ones → strict
      // (5/min per username deters spraying). Checks short-circuit so a blocked request
      // doesn't also burn the other bucket's quota or pay a second serial KV round-trip.
      if (sub === "preview" || sub === "claim" || sub === "login") {
        const [ipLimit, nameLimit] = sub === "preview" ? [20, 15] : [10, 5];
        const limited = () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json" } });
        if (!(await rateLimit(env, `rl:acct:${sub}:u:${name}`, nameLimit, 60))) return limited();
        if (!(await rateLimit(env, `rl:acct:${sub}:ip:${ip}`, ipLimit, 60))) return limited();
      }

      const doPath =
        sub === "preview" ? "account/preview" :
        sub === "claim" ? "account/claim" :
        sub === "login" ? "account/login" :
        sub === "sessions/revoke" ? "account/sessions/revoke" :
        sub === "verify-session" ? "account/verify-session" : null;
      if (!doPath) return new Response("not found", { status: 404 });
      return userDo(name, doPath, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    }

    // Profile JSON API: /api/user/<name>
    if (url.pathname.startsWith("/api/user/")) {
      const name = normalizeUsername(decodeURIComponent(url.pathname.slice("/api/user/".length)));
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
      const stub = env.USER.get(env.USER.idFromName(name));
      return stub.fetch(new Request(`https://do/?username=${name}`, { method: "GET" }));
    }

    // --- Worduls: user-authored creations (namespace /api/worduls — /api/worlds is the editions' to take) ---
    if (url.pathname === "/api/worduls" && req.method === "POST") {
      const body = await req.json().catch(() => null) as { owner?: string; desiredSlug?: string; bundle?: unknown } | null;
      const owner = normalizeUsername(body?.owner ?? "");
      if (!isValidUsername(owner)) return Response.json({ error: "bad_owner" }, { status: 400 });
      if (!(await isOwner(env, owner, extractBearer(req)))) return Response.json({ error: "unauthorized" }, { status: 401 });
      const res = await wordulsStub(env, owner).fetch("https://do/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, desiredSlug: body?.desiredSlug, bundle: body?.bundle, now: Date.now() }),
      });
      // On success, register the published wordul for discoverability (sitemap + crawl).
      if (res.ok) {
        const cloned = res.clone();
        const out = await cloned.json().catch(() => null) as { url?: string } | null;
        if (out?.url) ctx.waitUntil(env.DIRECTORY.put(`wordul:${out.url}`, "1").catch(() => {}));
      }
      return res;
    }
    const wlist = url.pathname.match(/^\/api\/worduls\/([a-z0-9_-]{3,20})$/);
    if (wlist && req.method === "GET") {
      const owner = normalizeUsername(wlist[1]);
      const includeAll = await isOwner(env, owner, extractBearer(req));
      return wordulsStub(env, owner).fetch(`https://do/list?owner=${owner}${includeAll ? "&includeAll=1" : ""}`);
    }
    const wone = url.pathname.match(/^\/api\/worduls\/([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/);
    if (wone) {
      const owner = normalizeUsername(wone[1]);
      const slug = wone[2];
      if (req.method === "GET") {
        // Owner gets the full record (incl. word) for editing; public gets the card via /list.
        if (await isOwner(env, owner, extractBearer(req))) {
          return wordulsStub(env, owner).fetch(`https://do/get?slug=${slug}`);
        }
        return Response.json({ error: "owner_only" }, { status: 403 });
      }
      if (req.method === "PATCH") {
        if (!(await isOwner(env, owner, extractBearer(req)))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const patch = await req.text();
        const res = await wordulsStub(env, owner).fetch(`https://do/patch?slug=${slug}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: patch,
        });
        // Keep the discoverability index in sync with publish/unpublish transitions.
        if (res.ok) {
          const status = (() => { try { return (JSON.parse(patch) as { status?: string }).status; } catch { return undefined; } })();
          const key = `wordul:/@${owner}/${slug}`;
          if (status === "unpublished" || status === "draft") ctx.waitUntil(env.DIRECTORY.delete(key).catch(() => {}));
          else if (status === "published") ctx.waitUntil(env.DIRECTORY.put(key, "1").catch(() => {}));
        }
        return res;
      }
    }

    // Per-word public solve stats (powers the live panel on each word page).
    if (url.pathname.startsWith("/api/word/") && url.pathname.endsWith("/stats")) {
      const word = decodeURIComponent(
        url.pathname.slice("/api/word/".length, -"/stats".length),
      ).toUpperCase();
      if (!isWordPage(word)) return new Response("not found", { status: 404 });
      const res = await env.WORDSTATS.get(env.WORDSTATS.idFromName(word)).fetch("https://do/");
      return new Response(res.body, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      });
    }

    // Canonical per-word challenge (the word's public leaderboard, wiki CTA):
    // GET /api/word/<word>/challenge → { id, record, attempts, wordLength }.
    // The id is hash-derived (opaque — /c/OCEAN would spoil the answer); the DO is
    // minted lazily with the reserved owner "wordul" and kind:"word".
    if (url.pathname.startsWith("/api/word/") && url.pathname.endsWith("/challenge") && req.method === "GET") {
      const word = decodeURIComponent(
        url.pathname.slice("/api/word/".length, -"/challenge".length),
      ).toUpperCase();
      if (!isWordPage(word)) return new Response("not found", { status: 404 });
      const id = await wordChallengeId(word);
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(id));
      let res = await stub.fetch(new Request("https://do/meta", { method: "GET" }));
      if (res.status === 404) {
        await stub.fetch(new Request("https://do/", {
          method: "POST",
          body: JSON.stringify({
            id, word, wordLength: word.length,
            owner: "wordul", ownerScore: "", ownerGrid: [], kind: "word",
          }),
          headers: { "content-type": "application/json" },
        }));
        res = await stub.fetch(new Request("https://do/meta", { method: "GET" }));
      }
      return new Response(res.body, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      });
    }

    // Daily leaderboard JSON API: /api/daily/<YYYY-MM-DD>/leaderboard?username=<u>
    // Proxies to the day's single Room DO (keyed exactly like the /ws daily room).
    const dailyLb = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/leaderboard$/);
    if (dailyLb && req.method === "GET") {
      const date = dailyLb[1];
      const u = normalizeUsername(url.searchParams.get("username") ?? "");
      const full = url.searchParams.get("full") === "1";
      // A finisher's proof-of-finish token (opaque; the room validates it) unlocks letter
      // rows. Forwarded verbatim; an absent/wrong token just yields the public letterless board.
      const t = url.searchParams.get("t") ?? "";
      const tq = t ? `&t=${encodeURIComponent(t)}` : "";
      const stub = env.ROOM.get(env.ROOM.idFromName(`daily/${date}`));
      return stub.fetch(new Request(
        `https://do/leaderboard?username=${encodeURIComponent(u)}&${full ? "full=1" : "n=3"}${tq}`,
        { method: "GET" },
      ));
    }

    // Real-solve tape: /api/daily/<YYYY-MM-DD>/tape?u=<player>&t=<finisher token>.
    // Proxies to the day's Room DO; the room enforces the token gate (tapes contain letters).
    const dailyTape = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/tape$/);
    if (dailyTape && req.method === "GET") {
      const u = normalizeUsername(url.searchParams.get("u") ?? "");
      const t = url.searchParams.get("t") ?? "";
      const stub = env.ROOM.get(env.ROOM.idFromName(`daily/${dailyTape[1]}`));
      return stub.fetch(new Request(
        `https://do/tape?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`,
        { method: "GET" },
      ));
    }

    // Mint a challenge: POST /api/challenge
    if (url.pathname === "/api/challenge" && req.method === "POST") {
      const id = makeChallengeId();
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(id));
      const body = (await req.json()) as Record<string, unknown>;
      return stub.fetch(new Request("https://do/", {
        method: "POST",
        body: JSON.stringify({ ...body, id }),
        headers: { "content-type": "application/json" },
      }));
    }

    // Challenge meta (no word): GET /api/challenge/<id>/meta
    const metaMatch = url.pathname.match(/^\/api\/challenge\/([0-9A-Za-z]{5})\/meta$/);
    if (metaMatch && req.method === "GET") {
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(metaMatch[1]));
      return stub.fetch(new Request("https://do/meta", { method: "GET" }));
    }

    // Challenge ghost tape (no word): GET /api/challenge/<id>/ghosts[?vs=<username>]
    // ?vs= is the dual-replay half of a wiki word challenge: when the DO has no filed
    // tape, the sender's stored run for this word (colors only) is re-cut into a ghost
    // on the fly — so each shared link races ITS challenger on one shared leaderboard.
    const ghostsMatch = url.pathname.match(/^\/api\/challenge\/([0-9A-Za-z]{5})\/ghosts$/);
    if (ghostsMatch && req.method === "GET") {
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(ghostsMatch[1]));
      const res = await stub.fetch(new Request("https://do/ghosts", { method: "GET" }));
      const vs = normalizeUsername(url.searchParams.get("vs") ?? "");
      if (!vs || !res.ok) return res;
      const filed = (await res.json()) as { ghosts: unknown };
      if (filed.ghosts) return Response.json(filed); // a real recorded tape beats a synth
      try {
        // Server→server only: the pinned word never reaches the client on this path.
        const wr = await stub.fetch(new Request("https://do/word", { method: "GET" }));
        if (!wr.ok) return Response.json({ ghosts: null });
        const { word, wordLength } = (await wr.json()) as { word: string; wordLength: number };
        const gr = await env.USER.get(env.USER.idFromName(vs)).fetch(
          new Request(`https://do/game-for-word?username=${encodeURIComponent(vs)}&word=${encodeURIComponent(word)}`, { method: "GET" }),
        );
        if (!gr.ok) return Response.json({ ghosts: null });
        const game = (await gr.json()) as { found: boolean; won: boolean; solveGrid: string[]; guessAts?: number[] };
        if (!game.found) return Response.json({ ghosts: null });
        const tape = tapeFromSolveGrid({
          username: vs, wordLength, maxGuesses: 6, solveGrid: game.solveGrid, won: game.won,
          guessAts: game.guessAts,
        });
        return Response.json({ ghosts: tape });
      } catch {
        return Response.json({ ghosts: null }); // a ghost hiccup never blocks the challenge
      }
    }

    // Sitemap from the directory.
    if (url.pathname === "/sitemap.xml") {
      return sitemap(env, url.origin);
    }

    // Bare /daily -> today's dated permalink (the daily lives at the date; "/" is the hub).
    if (url.pathname === "/daily") {
      return Response.redirect(url.origin + "/daily/" + activeDate(Date.now()), 302);
    }

    // Admin schedule: POST writes a curated World, GET lists curated days (no words),
    // DELETE ?date= unschedules one — the day falls back to the house World (base look).
    // All Bearer-token gated; closed/401 when DAILY_ADMIN_TOKEN unset.
    if (url.pathname === "/daily/schedule" && ["POST", "GET", "DELETE"].includes(req.method)) {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      const target = "https://do/schedule" + url.search;
      if (req.method === "POST") {
        return stub.fetch(new Request(target, {
          method: "POST",
          body: await req.text(),
          headers: { "content-type": "application/json" },
        }));
      }
      return stub.fetch(new Request(target, { method: req.method }));
    }

    // Admin retheme: re-apply the day's resolved theme to an already-seeded daily room
    // (theme fields only — the word and boards are untouched). ?date= defaults to today.
    if (url.pathname === "/daily/retheme" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const date = url.searchParams.get("date") || activeDate(Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("bad date", { status: 400 });
      const path = `daily/${date}`;
      const stub = env.ROOM.get(env.ROOM.idFromName(path));
      return stub.fetch(new Request(`https://do/daily/retheme?path=${encodeURIComponent(path)}`, { method: "POST" }));
    }

    // Public effective Worlds registry (code base + admin KV overrides). Powers the
    // live client strip, the /w/<slug> page, and the sitemap.
    if (url.pathname === "/worlds.json" && req.method === "GET") {
      const list = await getEffectiveWorlds(env);
      return new Response(JSON.stringify(list), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: read effective list + base (for the manager editor).
    if (url.pathname === "/admin/worlds" && req.method === "GET") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const effective = await getEffectiveWorlds(env);
      return new Response(JSON.stringify({ base: WORLDS, effective }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: write the override doc.
    if (url.pathname === "/admin/worlds" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > 64 * 1024) {
        return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } });
      }
      let raw: unknown;
      try { raw = await req.json(); }
      catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { "content-type": "application/json" } }); }
      const result = normalizeOverrides(raw, WORLDS);
      if (!result.ok) {
        return new Response(JSON.stringify({ error: result.reason }), { status: 400, headers: { "content-type": "application/json" } });
      }
      await env.DIRECTORY.put(WORLD_OVERRIDES_KEY, JSON.stringify(result.value));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // Public effective voice map (code base silent-default + admin KV overrides).
    if (url.pathname === "/voice-config.json" && req.method === "GET") {
      const map = await getEffectiveVoice(env);
      return new Response(JSON.stringify(map), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: read effective map + base (world list + available clip sets) for the editor.
    if (url.pathname === "/admin/voice" && req.method === "GET") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const effective = await getEffectiveVoice(env);
      const clipSets = await knownClipSets(env);
      return new Response(JSON.stringify({ base: { worlds: WORLDS, clipSets, builtin: builtinClipSets() }, effective }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: write the voice override map.
    if (url.pathname === "/admin/voice" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > 64 * 1024) {
        return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } });
      }
      let raw: unknown;
      try { raw = await req.json(); }
      catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { "content-type": "application/json" } }); }
      const result = normalizeVoiceOverrides(raw, WORLDS, await knownClipSets(env));
      if (!result.ok) {
        return new Response(JSON.stringify({ error: result.reason }), { status: 400, headers: { "content-type": "application/json" } });
      }
      await env.DIRECTORY.put(VOICE_OVERRIDES_KEY, JSON.stringify(result.value));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // Admin: upload one clip into a clip set. multipart form: clipSetId, lineKey, file (wav/mp3).
    if (url.pathname === "/admin/voice/clips" && req.method === "POST") {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const form = await req.formData().catch(() => null);
      if (!form) return new Response(JSON.stringify({ error: "bad_form" }), { status: 400, headers: { "content-type": "application/json" } });
      const clipSetId = String(form.get("clipSetId") ?? "");
      const lineKey = String(form.get("lineKey") ?? "");
      // Workers-types FormData.get() is typed string|null; cast to access File properties.
      const file = form.get("file") as File | string | null;
      if (!/^[a-z0-9-]{1,40}$/.test(clipSetId)) return new Response(JSON.stringify({ error: "bad_clipSetId" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!/^[a-z0-9._-]{1,80}$/.test(lineKey)) return new Response(JSON.stringify({ error: "bad_lineKey" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!(file instanceof File)) return new Response(JSON.stringify({ error: "no_file" }), { status: 400, headers: { "content-type": "application/json" } });
      if (!["audio/wav", "audio/x-wav", "audio/mpeg"].includes(file.type)) return new Response(JSON.stringify({ error: "bad_type" }), { status: 415, headers: { "content-type": "application/json" } });
      if (file.size > 2 * 1024 * 1024) return new Response(JSON.stringify({ error: "too_large" }), { status: 413, headers: { "content-type": "application/json" } });

      const ext = file.type === "audio/mpeg" ? "mp3" : "wav";
      const fname = `${lineKey}.${ext}`;
      await env.VOICE.put(`clipsets/${clipSetId}/${fname}`, file.stream(), { httpMetadata: { contentType: file.type } });

      // Update the per-set manifest (lineKey -> filename).
      const mkey = `clipsets/${clipSetId}/manifest.json`;
      let manifest: Record<string, string> = {};
      const cur = await env.VOICE.get(mkey);
      if (cur) { try { manifest = JSON.parse(await cur.text()) || {}; } catch { manifest = {}; } }
      manifest[lineKey] = fname;
      await env.VOICE.put(mkey, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });

      // Register the set id so the validator accepts it (skip built-ins, which live in ASSETS).
      if (!builtinClipSets().includes(clipSetId)) {
        const reg = new Set(await knownClipSets(env));
        reg.add(clipSetId);
        await env.DIRECTORY.put("voice:clipsets", JSON.stringify([...reg].filter((s) => !builtinClipSets().includes(s))));
      }
      return new Response(JSON.stringify({ ok: true, file: fname }), { headers: { "content-type": "application/json" } });
    }

    // Vibe Studio "✨ tune" — rewrite a curator's "why this word" note via Workers AI.
    // POST /vibe-studio/tune  { story, prompt? } -> { text }. Open for now (the whole
    // studio is an un-launched, un-auth'd seam; real auth + rate-limit land with the
    // scheduling increment). Input is hard-capped so a stray request can't balloon the
    // call; the route 503s cleanly if the AI binding is missing (e.g. local dev).
    if (url.pathname === "/vibe-studio/tune" && req.method === "POST") {
      const json = (v: unknown, status: number) =>
        new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
      if (!env.AI) return json({ error: "ai_unavailable" }, 503);
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; }
      catch { return json({ error: "bad_json" }, 400); }
      const story = (typeof body.story === "string" ? body.story : "").slice(0, MAX_STORY_CHARS);
      const prompt = (typeof body.prompt === "string" ? body.prompt : "").slice(0, MAX_PROMPT_CHARS);
      if (!story.trim()) return json({ error: "empty_story" }, 400);
      try {
        const out = await env.AI.run(TUNE_MODEL, {
          messages: buildTuneMessages(story, prompt),
          max_tokens: 512,
        }) as { response?: string };
        const text = cleanTuneOutput(typeof out?.response === "string" ? out.response : "");
        if (!text) return json({ error: "no_output" }, 502);
        return json({ text }, 200);
      } catch {
        return json({ error: "tune_failed" }, 502);
      }
    }

    // Archive index.
    if (url.pathname === "/daily/archive") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter("Wordul Daily — Archive"))
        .on('[data-meta="description"]', new AttrSetter("content", "Every Wordul of the Day — the whole archive, one word at a time."))
        .on('[data-meta="canonical"]', new AttrSetter("href", url.origin + "/daily/archive"))
        .transform(shell);
    }

    // Daily stats sub-page — client-rendered; serve the SPA shell so hard-loads,
    // refreshes, and shares of /daily/<YYYY-MM-DD>/stats resolve (the SPA then
    // client-routes it). Without this the route falls through to a 404.
    const dailyStatsDate = url.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/stats$/);
    if (dailyStatsDate) {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(`Wordul of the Day — Stats · ${dailyStatsDate[1]}`))
        .on('[data-meta="description"]', new AttrSetter("content", "How the world played today's Wordul — solve rate, averages, and the day's Studio theme."))
        .on('[data-meta="canonical"]', new AttrSetter("href", url.origin + url.pathname))
        .transform(shell);
    }

    // Dare-ritual gift image: /daily/og/<date>/<pattern>.png — the sharer's board,
    // letters hidden. Pattern is colors-only (validated), so the route is public,
    // spoiler-free, and immutable-cacheable: one render per board per colo.
    // Future dates 404 (same clamp as the page route) — kills date-sweep abuse for free.
    const ogGift = dailyOgFromPathname(url.pathname);
    if (ogGift && req.method === "GET" && ogGift.date <= activeDate(Date.now())) {
      const cached = await caches.default.match(req);
      if (cached) return cached;
      const png = await renderGiftPng(ogGift.date, ogGift.pattern);
      const res = new Response(png.buffer as ArrayBuffer, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
      });
      ctx.waitUntil(caches.default.put(req, res.clone()));
      return res;
    }

    // Dated permalink — the eternal artifact. /daily/<YYYY-MM-DD>
    const dailyDate = dailyDateFromPathname(url.pathname);
    if (dailyDate && dailyDate <= activeDate(Date.now())) {
      return injectDailyMeta(env, url, dailyDate);
    }

    // Public dates list (powers the archive UI).
    if (url.pathname === "/api/daily/dates") {
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request("https://do/dates", { method: "GET" }));
    }

    if (url.pathname === "/api/daily/word") {
      const date = url.searchParams.get("date") || "";
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request(`https://do/word?date=${encodeURIComponent(date)}`, { method: "GET" }));
    }

    // Public, privacy-preserving research artifacts. These are intentionally JSON-first
    // so AI systems and researchers can ingest them without scraping the app UI.
    if (url.pathname === "/science/latest.json" || url.pathname === "/api/science/today") {
      return scienceDaily(env, activeDate(Date.now()));
    }
    const scienceMatch = url.pathname.match(SCIENCE_DAILY_RE);
    if (scienceMatch && req.method === "GET") {
      return scienceDaily(env, scienceMatch[1]);
    }
    if (url.pathname === "/science/weekly.json" || url.pathname === "/api/science/weekly") {
      return scienceWeekly(env);
    }

    // Living Lab Feed — JSON-first (the honest AI/science surface).
    if (url.pathname === "/feed.json") {
      const posts = await feedStream(env);
      return Response.json({ generatedAt: Date.now(), posts }, { headers: { "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/feed/weekly.json") {
      return Response.json(await feedWeeklyPost(env), { headers: { "cache-control": "public, max-age=300" } });
    }
    const feedJsonMatch = url.pathname.match(FEED_DATE_RE);
    if (feedJsonMatch && url.pathname.endsWith(".json") && req.method === "GET") {
      const post = await feedDailyPost(env, feedJsonMatch[1]);
      // A still-active day's post is not published — return 404 rather than a teaser blob to tools.
      if (!post.published) return new Response("not yet", { status: 404 });
      return Response.json(post, { headers: { "cache-control": "public, max-age=300" } });
    }

    if (url.pathname === "/feed") return renderFeedStream(env, url);
    if (url.pathname === "/feed/weekly") {
      const post = await feedWeeklyPost(env);
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(post.headline))
        .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/weekly`))
        .on('[data-feed-prose]', new RawHtmlSetter(feedPostProse(post, url.origin)))
        .transform(shell);
    }
    const feedHtmlMatch = url.pathname.match(FEED_DATE_RE);
    if (feedHtmlMatch && !url.pathname.endsWith(".json")) return renderFeedPost(env, url, feedHtmlMatch[1]);

    if (url.pathname === "/feed.xml") {
      const posts = await feedStream(env);
      return new Response(feedRss(posts, url.origin), {
        headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" },
      });
    }

    // Legacy redirect: /r or /r/<code> -> home (rooms are owner-nested now).
    if (url.pathname === "/r" || url.pathname.startsWith("/r/")) {
      return Response.redirect(url.origin + "/", 301);
    }

    // Serve uploaded voice clips from the VOICE R2 bucket at /voice-clips/<set>/<file>.
    if (url.pathname.startsWith("/voice-clips/")) {
      const key = "clipsets/" + url.pathname.slice("/voice-clips/".length);
      const obj = await env.VOICE.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "public, max-age=300" },
      });
    }

    // Design gallery: serve /designs/* from the DESIGNS R2 bucket (permanent,
    // upload-only — no redeploy needed to publish a new prototype).
    if (url.pathname === "/designs" || url.pathname === "/designs/") {
      const idx = await env.DESIGNS.get("designs/index.html");
      if (idx) {
        return new Response(idx.body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("No designs yet.", { status: 404 });
    }
    if (url.pathname.startsWith("/designs/")) {
      const key = url.pathname.slice(1); // drop leading "/"
      // Pretty slug URLs (/designs/<slug>) map to <slug>.html objects; fall back
      // when the verbatim key misses so manifest.json / index.html still hit directly.
      const obj =
        (await env.DESIGNS.get(key)) ??
        (key.endsWith(".html") ? null : await env.DESIGNS.get(key + ".html"));
      if (obj) {
        const ct = obj.httpMetadata?.contentType ?? "text/html; charset=utf-8";
        return new Response(obj.body, { headers: { "content-type": ct } });
      }
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Design not found</title>" +
          "<body style=font-family:system-ui;padding:3rem><h1>Design not found</h1>" +
          "<p><a href=/designs/>← back to the gallery</a></p>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    // OG cards for word pages live in the wordul-og R2 bucket (built + uploaded offline).
    if (url.pathname.startsWith("/word/og/")) {
      const key = url.pathname.slice("/word/og/".length);
      const obj = await env.OG.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }

    // Hero / supporting word imagery also lives in the wordul-og R2 bucket (env.OG —
    // no new binding). Served as webp; a missing key 404s rather than throwing.
    if (url.pathname.startsWith("/word/img/")) {
      const key = url.pathname.slice("/word/img/".length);
      const obj = await env.OG.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400" },
      });
    }

    // TEMP — Phase 2 image-gen prototype. Generates one flux-1-schnell image via the AI
    // runtime binding (no offline API token needed) and returns raw PNG bytes. Gated by the
    // IMG_GEN_KEY secret (x-img-gen-key header) — 404s without it so the route is invisible.
    // Shipped ONLY as a preview version, never to prod main. REMOVE after the image batch.
    if (url.pathname === "/admin/genimg") {
      const want = (env as unknown as { IMG_GEN_KEY?: string }).IMG_GEN_KEY;
      if (!want || req.headers.get("x-img-gen-key") !== want) return new Response("not found", { status: 404 });
      if (!env.AI) return new Response("ai_unavailable", { status: 503 });
      let prompt = "";
      try { prompt = ((await req.json()) as { prompt?: string }).prompt || ""; } catch { prompt = ""; }
      if (!prompt) return new Response("missing prompt", { status: 400 });
      try {
        const out = (await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
          prompt, steps: 4,
        })) as { image?: string };
        if (!out?.image) return new Response("no_image", { status: 502 });
        const bytes = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
        return new Response(bytes, { headers: { "content-type": "image/png" } });
      } catch (e) {
        return new Response("gen_failed: " + (e as Error).message, { status: 502 });
      }
    }

    // Word wiki. Note: wrangler serves matching static assets BEFORE the worker, so a
    // word page like /word/ocean is served straight from public/word/ocean.html; the
    // /word/ branch below only runs on asset misses (uppercase → lowercase redirect,
    // and the friendly 404 for non-answer/excluded words). The featured-word route lives
    // at top-level /today — NOT /word/today, which would be shadowed by the TODAY page.
    if (url.pathname === "/today") {
      const slug = slugFor(wordOfTheDay(new Date()));
      return Response.redirect(`${url.origin}/word/${slug}`, 302);
    }
    if (url.pathname.startsWith("/word/")) {
      const raw = url.pathname.slice("/word/".length).replace(/\/$/, "");
      const lower = raw.toLowerCase();
      if (raw !== lower) return Response.redirect(`${url.origin}/word/${lower}`, 301);
      if (isWordPage(lower)) {
        return env.ASSETS.fetch(new Request(`${url.origin}/word/${lower}.html`));
      }
      // Non-answer or excluded word: a friendly dead-endless 404.
      return new Response(
        `<!doctype html><meta charset=utf-8><title>No word page</title>` +
          `<p>No wiki page for that word. <a href="/words">Browse all words</a> or <a href="/">play Wordul</a>.</p>`,
        { status: 404, headers: { "content-type": "text/html" } },
      );
    }
    if (url.pathname === "/words") {
      return env.ASSETS.fetch(new Request(`${url.origin}/words.html`));
    }

    // World pages (/w/<slug>): SPA shell with per-World SEO meta. Unknown slug still
    // serves the shell (the client router redirects to /worlds), with default meta.
    const worldMatch = url.pathname.match(WORLD_RE);
    if (worldMatch) {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      const world = getEffectiveWorld(await getEffectiveWorlds(env), worldMatch[1]);
      const canonical = `${url.origin}/w/${worldMatch[1]}`;
      const title = world ? `${world.name} — Wordul` : "Worlds — Wordul";
      const desc = world ? world.blurb : "Browse themed Worlds on Wordul.";
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(title))
        .on('[data-meta="og:title"]', new AttrSetter("content", title))
        .on('[data-meta="description"]', new AttrSetter("content", desc))
        .on('[data-meta="og:description"]', new AttrSetter("content", desc))
        .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
        .on('[data-meta="og:url"]', new AttrSetter("content", canonical))
        .transform(shell);
    }

    // Arena lobby (/arena): a real, refresh-survivable client route. Serve the SPA shell
    // so a hard load / refresh / share resolves; the client router then renders the open-
    // games view. Explicit (not left to asset fallback) to match every other client route
    // here and to not depend on an out-of-band not_found_handling setting (see wrangler.jsonc).
    if (url.pathname === "/arena") {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }

    // The Worlds theater (/worlds): SPA shell + browse meta.
    if (url.pathname === "/worlds") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      const title = "Browse Worlds — Wordul";
      const desc = "Pick a World and play — themed places to race the same word.";
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(title))
        .on('[data-meta="og:title"]', new AttrSetter("content", title))
        .on('[data-meta="description"]', new AttrSetter("content", desc))
        .on('[data-meta="og:description"]', new AttrSetter("content", desc))
        .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/worlds`))
        .on('[data-meta="og:url"]', new AttrSetter("content", `${url.origin}/worlds`))
        .transform(shell);
    }

    // A user's wordul gallery: /@<user>/worduls (must precede ROOM_RE — "worduls" is a
    // reserved slug, never a real room). Serves the SPA shell with gallery meta.
    const galleryMatch = url.pathname.match(/^\/@([a-z0-9_-]{3,20})\/worduls$/);
    if (galleryMatch) {
      return injectGalleryMeta(env, url, normalizeUsername(galleryMatch[1]));
    }

    // Profile + room + challenge pages: serve SPA shell with per-route meta injected.
    const profileMatch = url.pathname.match(PROFILE_RE);
    const roomMatch = url.pathname.match(ROOM_RE);
    const challengeMatch = url.pathname.match(CHALLENGE_RE);
    if (profileMatch || roomMatch || challengeMatch) {
      return injectMeta(env, url, profileMatch, roomMatch, challengeMatch);
    }

    // Everything else: static asset (SPA fallback handled by wrangler).
    return env.ASSETS.fetch(req);
  },

  // Cron (wrangler.jsonc triggers): poke today's daily room so wordulers play at
  // "their hour" even on a day no human has opened the daily (the DO can't set its
  // own alarm before it exists — this tick is what creates/seeds it).
  async scheduled(_ctrl: ScheduledController, env: Env): Promise<void> {
    const date = activeDate(Date.now());
    const path = `daily/${date}`;
    const stub = env.ROOM.get(env.ROOM.idFromName(path));
    try {
      const res = await stub.fetch(`https://do/bots/tick?path=${encodeURIComponent(path)}`, { method: "POST" });
      if (!res.ok && res.status !== 409) console.error("wotd bot tick non-ok", date, res.status);
      // 409 = daily word not set yet (the Room couldn't resolve it from the Daily DO) — next tick retries.
    } catch (e) {
      console.error("wotd bot tick threw", date, e);
    }
  },
};

async function sitemap(env: Env, origin: string): Promise<Response> {
  const urls: string[] = [origin + "/", origin + "/science/latest.json", origin + "/science/weekly.json"];
  let cursor: string | undefined;
  do {
    const page = await env.DIRECTORY.list({ limit: 1000, cursor });
    for (const k of page.keys) {
      if (k.name.startsWith("user:")) urls.push(`${origin}/@${k.name.slice(5)}`);
      else if (k.name.startsWith("room:")) urls.push(`${origin}/@${k.name.slice(5)}`);
      // wordul:/@owner/slug — published worduls (spoiler-safe; the URL carries no word).
      else if (k.name.startsWith("wordul:")) urls.push(`${origin}${k.name.slice("wordul:".length)}`);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  for (const w of await getEffectiveWorlds(env)) urls.push(`${origin}/w/${w.slug}`);
  urls.push(origin + "/worlds");
  urls.push(origin + "/words");
  // Word-wiki pages. Emit ALPHABETICALLY — iterating ANSWER_WORDS in pool order would
  // leak the secret answer-pool ordering (the daily answer is answers[fnv1a(date)%len]
  // over that exact order), letting a cheater reconstruct it from the sitemap. Sorting
  // by slug severs any link between sitemap order and pool order. Each word page also
  // advertises its existing OG card via a Google image-sitemap child.
  const wordEntries = [...ANSWER_WORDS]
    .filter(isWordPage)
    .map(slugFor)
    .sort()
    .map((slug) =>
      `  <url><loc>${origin}/word/${slug}</loc>` +
      `<image:image><image:loc>${origin}/word/og/${slug}.png</image:loc></image:image></url>`,
    );

  // Daily surface: home, archive, and every known date (best-effort — a DAILY hiccup
  // must not 500 the sitemap).
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch("https://do/dates");
    if (res.ok) {
      const { dates } = (await res.json()) as { dates: string[] };
      urls.push(...dailySitemapUrls(dates, origin));
    }
  } catch { /* skip daily urls */ }

  // Living Lab Feed surface (best-effort — must not 500 the sitemap).
  urls.push(origin + "/feed", origin + "/feed.xml", origin + "/feed.json", origin + "/feed/weekly");
  try {
    const posts = await feedStream(env, 60);
    for (const p of posts) urls.push(`${origin}/feed/${p.slug}`);
  } catch { /* skip feed urls */ }

  const plainEntries = urls.map((u) => `  <url><loc>${u}</loc></url>`);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    [...plainEntries, ...wordEntries].join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}

async function scienceDaily(env: Env, date: string): Promise<Response> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("bad date", { status: 400 });
  const includeWords = date < activeDate(Date.now());
  const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
  const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}`);
  return withJsonCache(res, includeWords ? 300 : 60);
}

async function scienceWeekly(env: Env): Promise<Response> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, -6 + i));
  const daily = await Promise.all(dates.map(async (date) => {
    const includeWords = date < today;
    const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
    const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}`);
    return (await res.json()) as SciencePublicDailySummary;
  }));
  return Response.json(buildWeeklyScienceSummary(daily, Date.now()), {
    headers: { "cache-control": "public, max-age=300" },
  });
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function withJsonCache(res: Response, maxAge: number): Response {
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", `public, max-age=${maxAge}`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fetchSummary(env: Env, date: string, today: string, answer?: string): Promise<SciencePublicDailySummary> {
  const includeWords = date < today;
  const stub = env.SCIENCE.get(env.SCIENCE.idFromName(date));
  const answerParam = answer ? `&answer=${encodeURIComponent(answer)}` : "";
  const res = await stub.fetch(`https://do/summary?date=${date}&includeWords=${includeWords ? "1" : "0"}${answerParam}`);
  return (await res.json()) as SciencePublicDailySummary;
}

async function fetchWorld(env: Env, date: string): Promise<World> {
  const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch(`https://do/resolve?date=${date}`);
  return (await res.json()) as World;
}

async function feedDailyPost(env: Env, date: string): Promise<FeedPost> {
  const today = activeDate(Date.now());
  // World first: its word keys the daily-only fallback bucket for days recorded before
  // per-kind science scopes. buildDailyPost still gates what the active day may show.
  const world = await fetchWorld(env, date);
  const summary = await fetchSummary(env, date, today, world.word);
  return buildDailyPost(summary, world, BRAIN_NOTES, { todayUTC: today });
}

async function feedWeeklyPost(env: Env): Promise<FeedPost> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, -6 + i));
  const daily = await Promise.all(dates.map((d) => fetchSummary(env, d, today)));
  const weekly = buildWeeklyScienceSummary(daily, Date.now());
  return buildWeeklyPost(weekly, BRAIN_NOTES, { todayUTC: today });
}

/** The published stream: the last `days` PAST days, newest first. Only days that are
 *  published AND carry at least one finding surface here — a zero-participation past day
 *  would otherwise show as an empty post in the stream, RSS, and sitemap. A per-day fetch
 *  failure is logged (not silently dropped) so an outage is distinguishable from "no data". */
async function feedStream(env: Env, days = 14): Promise<FeedPost[]> {
  const today = activeDate(Date.now());
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, -1 - i)); // yesterday backwards
  const posts = await Promise.all(
    dates.map((d) => feedDailyPost(env, d).catch((e) => { console.error("feed day failed", d, e); return null; })),
  );
  return posts.filter((p): p is FeedPost => !!p && p.published && p.findings.length > 0);
}

function feedRss(posts: FeedPost[], origin: string): string {
  const items = posts.map((p) =>
    `<item><title>${escapeHtml(p.headline)}</title>` +
    `<link>${origin}/feed/${p.slug}</link><guid>${origin}/feed/${p.slug}</guid>` +
    `<description>${escapeHtml(p.findings.map((f) => f.text).join(" "))}</description></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>` +
    `<title>The Wordul Living Lab</title><link>${origin}/feed</link>` +
    `<description>Honest, privacy-preserving discoveries from the Wordul of the Day.</description>` +
    `${items}</channel></rss>`;
}

function feedPostProse(post: FeedPost, origin: string): string {
  const findings = post.findings.map((f) => `<li>${escapeHtml(f.text)}</li>`).join("");
  const notes = post.brainNotes.map((n) =>
    `<aside class="brain-note" data-pillar="${n.pillar}"><h3>${escapeHtml(n.title)}</h3>` +
    `<p>${escapeHtml(n.note)}</p>${n.citation ? `<cite>${escapeHtml(n.citation)}</cite>` : ""}</aside>`).join("");
  const ed = post.editorial?.intro ? `<p class="lab-intro">${escapeHtml(post.editorial.intro)}</p>` : "";
  // Lab days are UTC days — said out loud, because a 9pm evening in New York is
  // already "tomorrow" in the Lab and the date reads off-by-one otherwise.
  const utcNote = `<p class="muted small lab-utc-note">Lab days tick over at midnight UTC.</p>`;
  return `<article><h1>${escapeHtml(post.headline)}</h1>${utcNote}${ed}` +
    `<ul class="findings">${findings}</ul>${notes}` +
    `<p class="pillars">${post.pillars.map(escapeHtml).join(" · ")}</p>` +
    `<nav><a href="${origin}/feed">← the Lab feed</a></nav></article>`;
}

function feedArticleJsonLd(post: FeedPost, origin: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    datePublished: post.date,
    author: { "@type": "Organization", name: "Wordul" },
    publisher: { "@type": "Organization", name: "Wordul", url: origin },
    about: post.pillars,
    isPartOf: { "@type": "WebSite", name: "Wordul Living Lab", url: `${origin}/feed` },
  };
}

async function renderFeedPost(env: Env, url: URL, date: string): Promise<Response> {
  const post = await feedDailyPost(env, date);
  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  if (!post.published) {
    // Active/unknown day: no-spoiler shell, self canonical, no findings.
    return new HTMLRewriter()
      .on('[data-meta="title"]', new TextSetter("The Wordul Lab"))
      .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/${date}`))
      .transform(shell);
  }
  const title = post.headline;
  const desc = post.findings.map((f) => f.text).join(" ").slice(0, 200);
  const jsonld = JSON.stringify(feedArticleJsonLd(post, url.origin)).replace(/</g, "\\u003c");
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", desc))
    .on('[data-meta="og:description"]', new AttrSetter("content", desc))
    .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed/${date}`))
    .on('[data-meta="og:url"]', new AttrSetter("content", `${url.origin}/feed/${date}`))
    .on('[data-feed-jsonld]', new RawHtmlSetter(jsonld))
    .on('[data-feed-prose]', new RawHtmlSetter(feedPostProse(post, url.origin)))
    .transform(shell);
}

async function renderFeedStream(env: Env, url: URL): Promise<Response> {
  const posts = await feedStream(env);
  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const list = posts.map((p) =>
    `<li><a href="${url.origin}/feed/${p.slug}"><strong>${escapeHtml(p.headline)}</strong></a>` +
    (p.findings[0] ? `<span>${escapeHtml(p.findings[0].text)}</span>` : "") + `</li>`).join("");
  const prose = `<h1>The Wordul Living Lab</h1><p>Honest, privacy-preserving discoveries from the daily puzzle.</p><ul class="feed-stream">${list}</ul>`;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter("The Wordul Living Lab — daily discoveries"))
    .on('[data-meta="description"]', new AttrSetter("content", "Honest, privacy-preserving discoveries about how people learn and reason, from the Wordul of the Day."))
    .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/feed`))
    .on('[data-feed-prose]', new RawHtmlSetter(prose))
    .transform(shell);
}

async function injectMeta(
  env: Env,
  url: URL,
  profileMatch: RegExpMatchArray | null,
  roomMatch: RegExpMatchArray | null,
  challengeMatch: RegExpMatchArray | null = null,
): Promise<Response> {
  let title = "Wordul";
  let description = "Race your friends on the same word — come wordul with us.";

  if (challengeMatch) {
    const [, id] = challengeMatch;
    // Best-effort OG meta for a shared challenge link — a DO hiccup degrades to default.
    try {
      const res = await env.CHALLENGE.get(env.CHALLENGE.idFromName(id)).fetch("https://do/meta");
      if (res.ok) {
        const m = (await res.json()) as { owner?: string; ownerScore?: string };
        const owner = m.owner ?? "someone";
        title = `Beat @${owner}'s Wordul challenge`;
        description = `@${owner} scored ${m.ownerScore ?? "?"} on this word. Same word, your turn — beat the score.`;
      } else {
        title = "A Wordul challenge";
        description = "Same word, your turn — beat the score.";
      }
    } catch {
      title = "A Wordul challenge";
      description = "Same word, your turn — beat the score.";
    }
  } else if (roomMatch) {
    const [, owner, slug] = roomMatch;
    // A published wordul gets its own spoiler-safe OG meta (vibeTitle + author, NEVER the
    // word — the /list projection has no word). Falls back to generic room meta otherwise.
    let isWordul = false;
    try {
      const o = normalizeUsername(owner);
      const res = await env.WORDULS.get(env.WORDULS.idFromName(o)).fetch(`https://do/list?owner=${o}`);
      if (res.ok) {
        const { worlds } = (await res.json()) as { worlds: Array<{ slug: string; vibeTitle: string }> };
        const card = worlds.find((w) => w.slug === slug);
        if (card) {
          isWordul = true;
          title = `${card.vibeTitle} — a Wordul by @${owner}`;
          description = `Play “${card.vibeTitle}”, an original wordul forged by @${owner}. One word, one shot.`;
        }
      }
    } catch { /* fall through to room meta */ }
    if (!isWordul) {
      title = `${slug.replace(/-/g, " ")} — a Wordul room by ${owner}`;
      description = `Join ${owner}'s Wordul room and race on the same word.`;
    }
  } else if (profileMatch) {
    const [, name] = profileMatch;
    // Best-effort: a DO hiccup or odd payload must degrade to default meta, not 500 the page.
    try {
      const res = await env.USER.get(env.USER.idFromName(name)).fetch(`https://do/?username=${name}`);
      if (res.ok) {
        const p = (await res.json()) as { stats?: { wins?: number; bestStreak?: number } };
        const wins = p.stats?.wins ?? 0;
        const streak = p.stats?.bestStreak ?? 0;
        title = `${name} on Wordul — ${wins} wins, best streak ${streak}`;
        description = `${name}'s Wordul profile: ${wins} wins, best streak ${streak}.`;
      } else {
        title = `${name} on Wordul`;
        description = `${name}'s Wordul profile.`;
      }
    } catch {
      title = `${name} on Wordul`;
      description = `${name}'s Wordul profile.`;
    }
  }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const canonical = url.origin + url.pathname;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", description))
    .on('[data-meta="og:description"]', new AttrSetter("content", description))
    .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", canonical))
    .transform(shell);
}

// Serve the SPA shell for a user's wordul gallery (/@<user>/worduls) with gallery meta.
// The client (app.js → worduls-gallery.js) fetches + paints the cards.
async function injectGalleryMeta(env: Env, url: URL, owner: string): Promise<Response> {
  const title = `@${owner}'s worduls`;
  const description = `Play the worduls @${owner} has forged — original word puzzles, each with its own vibe.`;
  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const canonical = url.origin + url.pathname;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", description))
    .on('[data-meta="og:description"]', new AttrSetter("content", description))
    .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", canonical))
    .transform(shell);
}

// Serve the SPA shell themed for a daily date: meta + JSON-LD + crawlable story
// prose + prev/next links injected. `date` is a validated YYYY-MM-DD.
async function injectDailyMeta(env: Env, url: URL, date: string): Promise<Response> {
  let world: World | null = null;
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch(`https://do/resolve?date=${date}`);
    if (res.ok) world = (await res.json()) as World;
  } catch { /* degrade to default meta below */ }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  if (!world) {
    // DAILY unavailable — still serve a sane shell with a self canonical.
    return new HTMLRewriter()
      .on('[data-meta="title"]', new TextSetter("Wordul of the Day"))
      .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/daily/${date}`))
      .transform(shell);
  }

  // The ACTIVE puzzle must NEVER reveal its answer via SEO — a curated story like
  // "Why EMBER?" would leak today's word to anyone reading view-source. Today: generic,
  // no-spoiler meta + prose. Past days are archival → full story.
  const isActive = date === activeDate(Date.now());
  const seoWorld: World = isActive
    ? { ...world, story: { title: "Today's Wordul", body: "One word, the whole world. Solve today's Wordul to reveal the story behind the word." } }
    : world;
  const meta = buildDailyMeta(date, seoWorld, url.origin);
  const jsonld = JSON.stringify(buildDailyJsonLd(date, seoWorld, url.origin));
  const { prev, next } = dailyPrevNext(date);
  const story = seoWorld.story; // absent on unauthored (house) past days — no story prose
  const prose =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    (story
      ? `<h2>${escapeHtml(story.title)}</h2>` +
        `<p>${escapeHtml(story.body)}</p>` +
        (story.tip ? `<p><em>${escapeHtml(story.tip)}</em></p>` : "")
      : "") +
    `<nav><a href="${url.origin}/daily/${prev}">← ${prev}</a> · ` +
    `<a href="${url.origin}/daily/archive">archive</a> · ` +
    `<a href="${url.origin}/daily/${next}">${next} →</a></nav>`;

  // A ?g=<pattern> link is a dare: override the teaser meta and point og:image at
  // the masked-board gift. Registered AFTER the base setters — same selector, later
  // registration runs later, so the gift values win. Canonical stays the bare
  // /daily/<date> (meta.canonical), so ?g= never fragments search indexing.
  const gift = giftPatternFromSearch(url.search);
  const giftMeta = gift ? buildGiftMeta(gift) : null;
  let rw = new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(meta.title))
    .on('[data-meta="og:title"]', new AttrSetter("content", meta.title))
    .on('[data-meta="description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="og:description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="canonical"]', new AttrSetter("href", meta.canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", meta.canonical))
    .on('[data-daily-jsonld]', new RawHtmlSetter(jsonld.replace(/</g, "\\u003c")))
    .on('[data-daily-prose]', new RawHtmlSetter(prose));
  if (gift && giftMeta) {
    rw = rw
      .on('[data-meta="og:title"]', new AttrSetter("content", giftMeta.title))
      .on('[data-meta="og:description"]', new AttrSetter("content", giftMeta.description))
      .on('[data-meta="og:image"]', new AttrSetter("content", `${url.origin}/daily/og/${date}/${gift}.png`));
  }
  return rw.transform(shell);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

class TextSetter {
  constructor(private content: string) {}
  element(el: Element) { el.setInnerContent(this.content); }
}

class AttrSetter {
  constructor(private attr: string, private value: string) {}
  element(el: Element) { el.setAttribute(this.attr, this.value); }
}

class RawHtmlSetter {
  constructor(private html: string) {}
  element(el: Element) { el.setInnerContent(this.html, { html: true }); }
}
