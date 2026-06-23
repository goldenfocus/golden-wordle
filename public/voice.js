// Cloned-voice playback with graceful fallback.
// speakLine(clipBase, rawLine, spokenText):
//   - look up the RAW template line in the clip set's manifest; if a clip exists,
//     play it (the cloned voice). Otherwise speak `spokenText` via the browser's
//     speechSynthesis (covers un-rendered and dynamic {answer} lines).
// clipBase must end with "/", e.g. "/voice/yang/" or "/voice-clips/my-set/".
import { lineKey } from "/voice-key.js";
import { splitTemplate } from "/companion.js";

const MUTE_LS = "wordul.muted";
const manifests = {}; // clipBase -> { key: filename }
let current = null;   // { audio } currently playing

function isMuted() { return localStorage.getItem(MUTE_LS) === "1"; }

async function loadManifest(clipBase) {
  // Only ever cache a SUCCESSFUL fetch. A transient failure (offline blip, or a 404/5xx
  // during a deploy's propagation window) must NOT be memoized — otherwise one bad fetch
  // strands the whole page session on the empty map, and the cloned voice silently falls
  // back to TTS until a full reload (the "voice gone until I hard-refresh" bug). On
  // failure we return a throwaway {} that the next line retries.
  if (manifests[clipBase]) return manifests[clipBase];
  try {
    const res = await fetch(`${clipBase}manifest.json`);
    if (res.ok) return (manifests[clipBase] = (await res.json()) || {});
  } catch { /* transient — do not memoize the failure */ }
  return {};
}

function playClip(url) {
  stopSpeaking();
  try {
    const audio = new Audio(url);
    current = { audio };
    // Autoplay can be blocked before a user gesture — that's fine, stay silent.
    audio.play().catch(() => {});
  } catch { /* ignore */ }
}

function fallbackSpeak(text) {
  if (!text || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* ignore */ }
}

// Chrome (and other engines) populate getVoices() ASYNCHRONOUSLY: the first
// synchronous call after page load returns [] while it kicks off loading, then
// fires `voiceschanged` once the list is ready. The loss reveal's answer is usually
// the session's FIRST speechSynthesis call — the line's prefix/suffix play as
// pre-rendered mp3 clips, so nothing warms the voice list before it. That cold call
// returned [], pickRoboticVoice() found no robot voice, and the answer fell to the
// pitch-mangle below — a one-syllable word at pitch 0.3 comes out as a low garbled
// growl, not the word. ("It didn't say the word, just a distortion" bug.)
// Fix: trigger the load at module import and cache the list on `voiceschanged`, so by
// the time a game ends the robot voice is ready.
let voiceCache = [];
function refreshVoiceCache() {
  try { voiceCache = window.speechSynthesis?.getVoices?.() ?? []; } catch { voiceCache = []; }
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  refreshVoiceCache(); // first call returns [] but kicks off the async load
  try { window.speechSynthesis.addEventListener("voiceschanged", refreshVoiceCache); } catch { /* ignore */ }
}

// Pick the most mechanical voice the browser offers, so the answer reveal sounds
// deliberately uncanny against Yan's warm frame. Falls back to pitch/rate mangling.
function pickRoboticVoice() {
  // Prefer the cached list; if it's still empty (very early in the session), retry a
  // live fetch — by now the load triggered at import has usually completed.
  const voices = voiceCache.length ? voiceCache : (window.speechSynthesis?.getVoices?.() ?? []);
  const wanted = ["Zarvox", "Trinoids", "Cellos", "Bad News", "Boing", "Albert"];
  for (const name of wanted) {
    const v = voices.find((x) => x.name && x.name.includes(name));
    if (v) return v;
  }
  return null;
}

function roboticUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickRoboticVoice();
  if (v) u.voice = v;
  // No novelty voice on this platform (e.g. Chrome on Windows/Linux/Android): lower
  // the default voice for an uncanny edge, but not so far it garbles. 0.3 turned short
  // words into noise; 0.6 keeps the word legible while still sounding off.
  else { u.pitch = 0.6; u.rate = 0.85; }
  return u;
}

export function speakRobotic(word) {
  if (!word || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(roboticUtterance(word)); } catch { /* ignore */ }
}

// Speak just the MEANING, after a short beat — appended right after the spoken word reveal
// (win: the framed "you found the word {answer}"; loss: "the word was {answer}") so the
// meaning lands in the same voice (dual coding: what the eye reads, the ear hears too).
export async function speakMeaning(meaning) {
  if (!meaning || isMuted()) return;
  await new Promise((r) => setTimeout(r, 350)); // beat between the word and its meaning
  if (isMuted()) return;
  await sayRobotic(meaning);
}

// One robotic segment, resolving on utterance end (or immediately when empty,
// punctuation-only, or speech is unavailable/throws).
const REVEAL_BEAT_MS = 500; // the dramatic pause between "the word was" and the word
function sayRobotic(text) {
  return new Promise((resolve) => {
    if (!text || !/[a-z0-9]/i.test(text) || !window.speechSynthesis) return resolve();
    try {
      const u = roboticUtterance(text);
      u.addEventListener("end", resolve, { once: true });
      // An utterance the engine drops (iOS) fires "error", not "end" — resolve on
      // either so the reveal's await chain can't hang on a silent segment.
      u.addEventListener("error", resolve, { once: true });
      // iOS leaves the engine stuck "paused" after backgrounding; resume() is a no-op
      // everywhere else and un-sticks it there.
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

// A templated line like "The word was {answer}." — the loss reveal.
// Default mode "robot": the WHOLE line in the robotic voice — frame, a half-second
// beat, then the answer in the same voice. No clips, no manifest, one dependency.
// Mode "split" (per world/room via the edition's sound.voice.reveal, see edition.js):
// the static frame in Yan's cloned voice (pre-rendered clip, else fallback TTS), the
// answer in the robotic voice. Segments play strictly in order via `ended` events.
// revealVoice param is accepted for forward-compat but does not yet branch behavior
// beyond the existing robot/split modes.
export async function speakTemplated(clipBase, rawLine, ctx = {}, revealVoice = "robot") {
  if (!rawLine || isMuted()) return;
  if (!rawLine.includes("{answer}")) { // not actually templated — fall back to the normal path
    return speakLine(clipBase, rawLine, rawLine);
  }
  // A reveal with no answer would speak a dangling frame ("the word was… [silence]").
  // Defense in depth — callers guard this too, but a missed path must stay silent.
  if (!ctx.answer) return;
  const { prefix, suffix } = splitTemplate(rawLine);

  // The beat before the word: ½s by default; the WIN reveal passes ctx.pauseMs=1000
  // for a full dramatic second ("Congratulations — you found the word [beat] TAFFY").
  const beatMs = ctx.pauseMs > 0 ? ctx.pauseMs : REVEAL_BEAT_MS;

  if (revealVoice !== "split") {
    stopSpeaking(); // clear any clip/TTS from a prior reaction
    await sayRobotic(prefix);
    if (isMuted()) return;
    await new Promise((r) => setTimeout(r, beatMs));
    await sayRobotic(ctx.answer);
    if (isMuted()) return;
    await sayRobotic(suffix);
    return;
  }

  const map = await loadManifest(clipBase);
  if (isMuted()) return;
  // Clear any clip/TTS still playing from a prior reaction so segments don't stack.
  stopSpeaking();

  // Play one cloned-voice segment, resolving when it finishes (clip end, or TTS end,
  // or immediately if empty / on error). Reuses module-level `current` for stop().
  const playSegment = (seg) => new Promise((resolve) => {
    if (!seg) return resolve();
    const file = map[lineKey(seg)];
    if (file) {
      stopSpeaking();
      try {
        const audio = new Audio(`${clipBase}${file}`);
        current = { audio };
        audio.addEventListener("ended", resolve, { once: true });
        audio.play().catch(resolve);
      } catch { resolve(); }
    } else {
      try {
        const u = new SpeechSynthesisUtterance(seg);
        u.addEventListener("end", resolve, { once: true });
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    }
  });

  await playSegment(prefix);
  if (isMuted()) return;
  // Same dramatic beat in split mode — the cloned frame lands, silence, then the robot.
  if (ctx.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, ctx.pauseMs));
  if (isMuted()) return;
  await sayRobotic(ctx.answer);
  if (isMuted()) return;
  await playSegment(suffix);
}

export async function speakLine(clipBase, rawLine, spokenText) {
  if (!rawLine || isMuted()) return;
  const map = await loadManifest(clipBase);
  if (isMuted()) return; // re-check after the await
  const file = map[lineKey(rawLine)];
  if (file) playClip(`${clipBase}${file}`);
  else fallbackSpeak(spokenText ?? rawLine);
}

// Speak arbitrary text via a named system TTS voice (the "ai" source).
export function speakAI(voiceName, text, rate, pitch) {
  if (!text || !window.speechSynthesis) return;
  stopSpeaking();
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = (window.speechSynthesis.getVoices?.() ?? []).find((x) => x.name === voiceName);
    if (v) u.voice = v;
    if (typeof rate === "number") u.rate = rate;
    if (typeof pitch === "number") u.pitch = pitch;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// Dispatch a companionReact `voice` descriptor to the right playback path.
export function playVoice(voice, raw, text, ctx = {}, revealVoice = "robot") {
  if (!voice || voice.mode === "silent") return;
  if (voice.mode === "ai") return speakAI(voice.voiceName, raw.includes("{answer}") ? text : (text ?? raw), voice.rate, voice.pitch);
  if (voice.mode === "clips") {
    if (raw.includes("{answer}")) return speakTemplated(voice.clipBase, raw, ctx, revealVoice);
    return speakLine(voice.clipBase, raw, text);
  }
}

export function stopSpeaking() {
  try { current?.audio?.pause(); } catch { /* ignore */ }
  current = null;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
