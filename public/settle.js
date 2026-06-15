// Wordul — settlement screen module. A race ends in a RECEIPT (server-confirmed); this
// module turns it into the dopamine moment. Renderers are THEME PLUG-INS: a fixed receipt
// contract in, animation out — editions can pin their own (settleRenderer) the same way
// they pin tiles/sounds. Default: "supernova" (design ritual winner, 2026-06-05).
//
// Decoupling note: this module NEVER imports app.js. App-owned hooks come in via opts:
//   { renderer?, reducedMotion, walletBefore, onWalletTick(value), playChime, lines?, bonusCaption?, word? }
// Same pattern as gold.js. `word` is the round's answer — when present, the win beat
// reveals it letter-by-letter (random entrance each time) instead of the generic
// "supernova" caption.

// ── Pure: receipt → display lines ────────────────────────────────────────────────────────
// tFn is optional — defaults to English identity so the pure function stays hermetic in
// tests (no DOM / locale bootstrapping needed). The browser path passes the real `t`.
// Zero legs are dropped; Σ visible numbers stays honest.
export function receiptLines(r, tFn = (_key, fallback) => fallback) {
  const fmt = (n) => n.toLocaleString("en-US");
  const toWallet = tFn("settle.toWallet", "to your wallet");
  const netLabel = tFn("settle.net", "net");

  const lines = [
    { key: "mint", text: `${fmt(r.points)} pts → ◆ ${fmt(r.minted)}`, tone: "gain" },
  ];

  if (r.mult > 1) {
    lines.push({ key: "mult", text: `×${r.mult} → ◆ ${fmt(r.earned)}`, tone: "gain" });
  }

  if (r.spends) {
    lines.push({ key: "spends", text: `power-ups − ◆ ${fmt(r.spends)}`, tone: "loss" });
  }

  if (r.bonus) {
    lines.push({ key: "bonus", text: `bonus + ◆ ${fmt(r.bonus)}`, tone: "gain" });
  }

  const netSign = r.net >= 0 ? "+" : "−";
  const netAbs = fmt(Math.abs(r.net));
  lines.push({
    key: "payout",
    text: `◆ ${fmt(r.payout)} ${toWallet} · ${netLabel} ${netSign}${netAbs}`,
    tone: r.net >= 0 ? "gain" : "loss",
  });

  return lines;
}

// Daily flavor of receiptLines: the receipt's single `bonus` leg is really the flat daily
// goody + the ÷9 speed gold (room.ts scorePlayer). Split it back into the two honest lines
// the old cash-out list showed — dailyBonus is the client's mirror constant, speed is the
// exact remainder. Pure, like receiptLines (settle-lines.test.js).
export function dailyReceiptLines(r, dailyBonus, tFn = (_key, fallback) => fallback) {
  const fmt = (n) => n.toLocaleString("en-US");
  const lines = [
    { key: "mint", text: `${fmt(r.points)} pts → ◆ ${fmt(r.minted)}`, tone: "gain" },
  ];
  const speed = Math.max(0, r.bonus - dailyBonus);
  if (dailyBonus > 0) lines.push({ key: "daily", text: `${tFn("settle.dailyBonus", "daily bonus")} + ◆ ${fmt(dailyBonus)}`, tone: "gain" });
  if (speed > 0) lines.push({ key: "speed", text: `${tFn("settle.speedBonus", "speed")} + ◆ ${fmt(speed)}`, tone: "gain" });
  const netSign = r.net >= 0 ? "+" : "−";
  lines.push({
    key: "payout",
    text: `◆ ${fmt(r.payout)} ${tFn("settle.toWallet", "to your wallet")} · ${tFn("settle.net", "net")} ${netSign}${fmt(Math.abs(r.net))}`,
    tone: r.net >= 0 ? "gain" : "loss",
  });
  return lines;
}

// ── Renderer registry ─────────────────────────────────────────────────────────────────────
const renderers = new Map();

export function registerSettleRenderer(name, fn) {
  renderers.set(name, fn);
}

// opts: { renderer?, reducedMotion, walletBefore, onWalletTick(value), playChime, lines?, bonusCaption? }
// Returns a Promise that resolves when the show (or static fallback) is done.
export function renderSettlement(receipt, opts = {}) {
  const name = opts.renderer || "supernova";
  const fn = renderers.get(name) || renderers.get("supernova");
  return fn(receipt, opts);
}

// ── Supernova renderer (design ritual winner 2026-06-05) ─────────────────────────────────
// Ported from /tmp/settlement-supernova.html. Changes from the prototype:
//   - Scenario chips / demo controls removed — real receipt drives everything.
//   - AudioContext replaced by opts.playChime (app-owned).
//   - Wallet count-up drives opts.onWalletTick so app.js owns the real HUD.
//   - reducedMotion (opts OR prefers-reduced-motion) → static fallback, resolves fast.
//   - Overlay self-removes on completion or tap-to-skip; no orphaned rAF/resize listeners.
//   - mult beat skipped when receipt.mult === 1 (Phase 1 default).
//   - i18n captions via receiptLines / settle.* keys.

registerSettleRenderer("supernova", supernova);

async function supernova(receipt, opts = {}) {
  // Fix 4: double-show guard — bail if an overlay is already in the DOM.
  if (document.getElementById("settleOverlay")) return Promise.resolve();

  const prefersReduced = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const reducedMotion = opts.reducedMotion || prefersReduced;

  // Resolve the i18n `t` function if available in the browser; fall back to identity.
  let tFn = (_key, fallback) => fallback;
  if (typeof window !== "undefined") {
    try {
      const mod = await import("/i18n.js");
      tFn = mod.t;
    } catch { /* no i18n available — use identity */ }
  }

  const walletBefore = typeof opts.walletBefore === "number" ? opts.walletBefore : 0;
  const finalWallet = walletBefore + Math.max(0, receipt.payout);
  const onWalletTick = typeof opts.onWalletTick === "function" ? opts.onWalletTick : null;
  const playChime = typeof opts.playChime === "function" ? opts.playChime : null;
  const lines = Array.isArray(opts.lines) ? opts.lines : receiptLines(receipt, tFn);
  const answerWord = typeof opts.word === "string" && opts.word.trim()
    ? opts.word.trim().toUpperCase()
    : null;
  const metaText = [opts.ipa, opts.pos].filter(Boolean).join(" · ");
  const glossText = (typeof opts.gloss === "string" && opts.gloss.trim())
    || (typeof opts.def === "string" && opts.def.trim())
    || "";
  const exampleText = typeof opts.example === "string" ? opts.example.trim() : "";
  const isLoss = receipt.payout <= 0;

  return new Promise((resolve) => {
    // ── static fallback (reduced motion) ─────────────────────────────────────────────────
    if (reducedMotion) {
      const overlay = buildOverlay();
      const inner = document.createElement("div");
      inner.style.cssText = `
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:14px; padding:32px;
      `;
      if (answerWord) {
        const wEl = document.createElement("div");
        wEl.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:900;
          font-size:clamp(40px,10vw,96px); color:#f0c14b; line-height:1; margin-bottom:6px;`;
        wEl.textContent = answerWord;
        inner.appendChild(wEl);
        if (glossText) {
          const gEl = document.createElement("div");
          gEl.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:600;
            font-size:clamp(17px,3.5vw,24px); color:#f4f2ec; max-width:18em; margin:0 auto 18px;`;
          gEl.textContent = glossText;
          inner.appendChild(gEl);
        }
      }
      for (const ln of lines) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family:'Fraunces',Georgia,serif; font-weight:600;
          font-size:clamp(17px,3.5vw,26px); text-align:center;
          color:${ln.tone === "loss" ? "#e0796b" : ln.tone === "gain" ? "#f0c14b" : "#f4f2ec"};
        `;
        el.textContent = ln.text;
        inner.appendChild(el);
      }
      const skip = document.createElement("div");
      skip.style.cssText = `
        margin-top:28px; font-size:13px; color:#8a8a8f; letter-spacing:.14em;
        text-transform:uppercase; cursor:pointer;
      `;
      skip.textContent = tFn("settle.skip", "Tap to continue");
      inner.appendChild(skip);
      overlay.appendChild(inner);
      document.body.appendChild(overlay);

      // Tick wallet to final value once (so HUD lands true).
      onWalletTick?.(finalWallet);

      const finish = () => { overlay.remove(); resolve(); };
      overlay.addEventListener("click", finish);
      setTimeout(finish, 3200);
      return;
    }

    // ── canvas animation path ─────────────────────────────────────────────────────────────
    let canvas, ctx2d;
    try {
      canvas = document.createElement("canvas");
      ctx2d = canvas.getContext("2d");
      if (!ctx2d) throw new Error("no 2d context");
    } catch {
      // Canvas failed — fall back to static.
      supernova(receipt, { ...opts, reducedMotion: true }).then(resolve);
      return;
    }

    const overlay = buildOverlay();
    overlay.style.position = "fixed";

    // Canvas sizing
    // Fix 5: DPR read once per frame; fit() still uses it directly (called outside loop).
    let currentDPR = window.devicePixelRatio || 1;
    const DPR = () => currentDPR;
    let W, H;
    function fit() {
      currentDPR = window.devicePixelRatio || 1;
      W = canvas.width = window.innerWidth * currentDPR;
      H = canvas.height = window.innerHeight * currentDPR;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    }
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);

    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    overlay.appendChild(canvas);

    // Caption element (center-low)
    const capEl = document.createElement("div");
    capEl.style.cssText = `
      position:absolute; left:0; right:0; bottom:17vh; z-index:5;
      text-align:center; pointer-events:none;
    `;
    const capLine = document.createElement("span");
    capLine.style.cssText = `
      display:inline-block; font-family:'Fraunces',Georgia,serif; font-weight:600;
      font-size:clamp(18px,3vw,26px); color:#f4f2ec; opacity:0; transform:translateY(10px);
      text-shadow:0 2px 24px rgba(0,0,0,.8); transition:all .4s cubic-bezier(.2,.9,.3,1.2);
    `;
    capEl.appendChild(capLine);
    overlay.appendChild(capEl);

    // Multiplier flash element
    const multEl = document.createElement("div");
    multEl.style.cssText = `
      position:absolute; left:50%; top:38%; z-index:6;
      transform:translate(-50%,-50%) scale(.4);
      font-family:'Fraunces',Georgia,serif; font-weight:900;
      font-size:clamp(60px,11vw,130px); color:#f0c14b; opacity:0; pointer-events:none;
      letter-spacing:-.02em;
      text-shadow:0 0 60px rgba(240,193,75,.65),0 0 16px rgba(240,193,75,.9);
    `;
    overlay.appendChild(multEl);

    // Payout figure
    const payoutEl = document.createElement("div");
    payoutEl.style.cssText = `
      position:absolute; left:50%; top:62%; z-index:7;
      transform:translate(-50%,-50%); text-align:center; opacity:0; pointer-events:none;
    `;
    const payN = document.createElement("div");
    payN.style.cssText = `
      font-family:'Fraunces',Georgia,serif; font-weight:900;
      font-size:clamp(40px,8vw,84px); color:#f0c14b;
      font-variant-numeric:tabular-nums;
      text-shadow:0 0 80px rgba(240,193,75,.55),0 0 20px rgba(240,193,75,.8);
    `;
    const payS = document.createElement("div");
    payS.style.cssText = `font-size:14px; color:#8a8a8f; letter-spacing:.24em; text-transform:uppercase; margin-top:4px;`;
    payoutEl.appendChild(payN);
    payoutEl.appendChild(payS);
    overlay.appendChild(payoutEl);

    // Act 1 — Aurora Lexicon hero: the word + its meaning, the lesson of the round.
    const heroEl = document.createElement("div");
    heroEl.style.cssText = `
      position:absolute; left:0; right:0; top:50%; transform:translateY(-50%);
      z-index:8; text-align:center; padding:0 24px; pointer-events:none;
      transition:opacity .5s ease, transform .6s cubic-bezier(.4,0,.2,1);
    `;
    const heroKicker = document.createElement("div");
    heroKicker.style.cssText = `font-size:13px; letter-spacing:.34em; text-transform:uppercase;
      color:#8a8a8f; opacity:0; transform:translateY(8px); transition:.5s ease; margin-bottom:14px;`;
    const heroWord = document.createElement("div");
    heroWord.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:900; line-height:.92;
      font-size:clamp(56px,12vw,140px); color:#f0c14b; display:flex; justify-content:center; flex-wrap:wrap;
      text-shadow:0 0 60px rgba(240,193,75,.45),0 0 14px rgba(240,193,75,.6);`;
    const heroMeta = document.createElement("div");
    heroMeta.style.cssText = `font-family:'Fraunces',Georgia,serif; font-style:italic;
      font-size:clamp(15px,2.4vw,20px); color:#8a8a8f; margin-top:10px;
      opacity:0; transform:translateY(8px); transition:.5s ease .1s;`;
    const heroRule = document.createElement("div");
    heroRule.style.cssText = `height:1px; width:0; margin:26px auto 22px;
      background:linear-gradient(90deg,transparent,#a87a14,#f0c14b,#a87a14,transparent);
      transition:width .8s cubic-bezier(.2,.8,.2,1);`;
    const heroGloss = document.createElement("div");
    heroGloss.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:600;
      font-size:clamp(20px,4vw,32px); color:#f4f2ec; line-height:1.25; max-width:18em; margin:0 auto;
      opacity:0; transform:translateY(12px); transition:.6s ease;`;
    const heroExample = document.createElement("div");
    heroExample.style.cssText = `font-family:'Fraunces',Georgia,serif; font-style:italic;
      font-size:clamp(16px,2.8vw,21px); color:#8a8a8f; margin:18px auto 0; max-width:22em; line-height:1.5;
      opacity:0; transform:translateY(12px); transition:.6s ease .12s;`;
    // Compact gold tally — lives INSIDE the hero so the reward lands on the same screen as
    // the lesson (the coins rain behind via canvas; this is where they settle, ticking up).
    const heroTally = document.createElement("div");
    heroTally.style.cssText = `display:inline-flex; align-items:center; gap:10px; margin-top:26px;
      opacity:0; transform:translateY(14px) scale(.92); transition:.5s cubic-bezier(.2,1.4,.4,1);`;
    const heroTallyAmt = document.createElement("div");
    heroTallyAmt.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:900;
      font-size:clamp(28px,5.5vw,46px); color:#f0c14b; font-variant-numeric:tabular-nums;
      text-shadow:0 0 30px rgba(240,193,75,.55);`;
    const heroTallyLbl = document.createElement("div");
    heroTallyLbl.style.cssText = `font-size:11px; letter-spacing:.22em; text-transform:uppercase;
      color:#8a8a8f; text-align:left; line-height:1.4;`;
    heroTally.append(heroTallyAmt, heroTallyLbl);
    heroEl.append(heroKicker, heroWord, heroMeta, heroRule, heroGloss, heroExample, heroTally);
    overlay.appendChild(heroEl);

    document.body.appendChild(overlay);

    // ── particle state ─────────────────────────────────────────────────────────────────────
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.4 + 0.3, tw: Math.random() * 6,
    }));
    let coins = [], rings = [], shake = 0;
    let rafId = null;
    let running = true;

    function mkCoin(x, y, burst = 1) {
      coins.push({
        x, y,
        vx: (Math.random() - 0.5) * 3 * burst,
        vy: (Math.random() - 0.5) * 3 * burst,
        r: (10 + Math.random() * 3) * DPR() / 2,
        o: Math.random() * 7,
        spin: 0.7 + Math.random() * 1.6,
        fly: null,
        born: performance.now(),
        hue: 0,
        gone: false,
      });
    }

    function orbitCenter() { return { x: W / 2, y: H * 0.38 }; }

    function ringBurst(col = "#f0c14b", n = 3) {
      const c = orbitCenter();
      for (let i = 0; i < n; i++) {
        rings.push({ r: 30 * DPR() / 2 + i * 12, vr: 5 + i * 1.5, o: 0.7, col });
      }
    }

    function stepPhysics(dt) {
      const c = orbitCenter();
      for (const k of coins) {
        if (k.fly || k.gone) continue;
        const dx = c.x - k.x, dy = c.y - k.y, dist = Math.hypot(dx, dy) || 1;
        const want = 110 * DPR() / 2 + (k.o * 9 * DPR() / 2) % (70 * DPR() / 2);
        const pull = (dist - want) * 0.0016;
        k.vx += dx / dist * pull * dt;
        k.vy += dy / dist * pull * dt;
        k.vx += -dy / dist * 0.0125 * dt;
        k.vy += dx / dist * 0.0125 * dt;
        k.vx *= 0.985; k.vy *= 0.985;
        k.x += k.vx * dt * 0.06;
        k.y += k.vy * dt * 0.06;
      }
      for (const r of rings) { r.r += r.vr * dt * 0.06; r.o -= 0.0011 * dt; }
      rings = rings.filter((r) => r.o > 0);
      if (shake > 0) shake *= 0.88;
    }

    function drawFrame() {
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.save();
      if (shake > 0.4) {
        ctx2d.translate(
          (Math.random() - 0.5) * shake * DPR(),
          (Math.random() - 0.5) * shake * DPR(),
        );
      }

      // Stars
      const t = performance.now() / 1000;
      for (const s of stars) {
        ctx2d.globalAlpha = 0.35 + 0.3 * Math.sin(t * 1.4 + s.tw);
        ctx2d.fillStyle = "#f4f2ec";
        ctx2d.fillRect(s.x * W, s.y * H, s.r * DPR(), s.r * DPR());
      }
      ctx2d.globalAlpha = 1;

      // Nebula glow
      const c = orbitCenter();
      const g = ctx2d.createRadialGradient(c.x, c.y, 4, c.x, c.y, 180 * DPR() / 2);
      g.addColorStop(0, "rgba(255,222,120,.26)");
      g.addColorStop(0.5, "rgba(216,151,30,.08)");
      g.addColorStop(1, "transparent");
      ctx2d.fillStyle = g;
      ctx2d.fillRect(c.x - 200 * DPR(), c.y - 200 * DPR(), 400 * DPR(), 400 * DPR());

      // Rings
      for (const r of rings) {
        ctx2d.globalAlpha = Math.max(0, r.o);
        ctx2d.strokeStyle = r.col;
        ctx2d.lineWidth = 2.5 * DPR() / 2;
        ctx2d.beginPath();
        ctx2d.ellipse(c.x, c.y, r.r, r.r * 0.62, 0, 0, 7);
        ctx2d.stroke();
      }
      ctx2d.globalAlpha = 1;

      // Coins — milled-rim, radial gold gradient, embossed ◆, glint sweep
      for (const k of coins) {
        if (k.gone) continue;
        ctx2d.save();
        ctx2d.translate(k.x, k.y);
        const pop = Math.min(1, (performance.now() - k.born) / 200);
        const sq = Math.abs(Math.cos(t * k.spin + k.o));
        ctx2d.scale(pop * Math.max(0.18, sq), pop);
        const r = k.r * 1.15;
        const red = !!k.hue;
        ctx2d.shadowColor = red ? "rgba(224,121,107,.8)" : "rgba(240,193,75,.7)";
        ctx2d.shadowBlur = 16 * DPR() / 2;
        // rim
        ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, 7);
        ctx2d.fillStyle = red ? "#7e362c" : "#7e5c10"; ctx2d.fill();
        ctx2d.shadowBlur = 0;
        // face gradient
        const f = ctx2d.createRadialGradient(-r * 0.45, -r * 0.5, r * 0.1, 0, 0, r * 1.25);
        if (red) {
          f.addColorStop(0, "#ffd9cf"); f.addColorStop(0.35, "#e0796b"); f.addColorStop(1, "#8e3d31");
        } else {
          f.addColorStop(0, "#fff7d6"); f.addColorStop(0.3, "#f7d36b");
          f.addColorStop(0.7, "#e3ab2e"); f.addColorStop(1, "#a87a14");
        }
        ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.86, 0, 7);
        ctx2d.fillStyle = f; ctx2d.fill();
        // embossed ◆
        const dsz = r * 0.62;
        ctx2d.save(); ctx2d.rotate(Math.PI / 4);
        ctx2d.fillStyle = red ? "rgba(110,40,30,.85)" : "rgba(140,98,12,.9)";
        ctx2d.fillRect(-dsz / 2 + 0.8 * DPR(), -dsz / 2 + 0.8 * DPR(), dsz, dsz);
        ctx2d.fillStyle = red ? "#f2a99c" : "#ffe9a8";
        ctx2d.fillRect(-dsz / 2, -dsz / 2, dsz, dsz);
        ctx2d.restore();
        // glint sweep
        const gl = (t * 1.3 + k.o) % 3;
        if (gl < 1) {
          const gx = (gl * 2 - 1) * r;
          const sg = ctx2d.createLinearGradient(gx - r * 0.32, 0, gx + r * 0.32, 0);
          sg.addColorStop(0, "rgba(255,255,255,0)");
          sg.addColorStop(0.5, "rgba(255,255,255,.6)");
          sg.addColorStop(1, "rgba(255,255,255,0)");
          ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.86, 0, 7); ctx2d.clip();
          ctx2d.fillStyle = sg; ctx2d.fillRect(-r, -r, r * 2, r * 2);
        }
        ctx2d.restore();
      }
      ctx2d.restore();
    }

    let lastFrame = performance.now();
    function loop(now) {
      if (!running) return;
      // Fix 5: snapshot DPR once per frame so stepPhysics/drawFrame don't re-query it.
      currentDPR = window.devicePixelRatio || 1;
      stepPhysics(now - lastFrame);
      lastFrame = now;
      drawFrame();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    // ── helpers ────────────────────────────────────────────────────────────────────────────
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // caption() accepts an array of {text, color?} segments for safe DOM construction —
    // no innerHTML, no XSS surface (receipt fields are numbers; i18n strings are internal).
    async function caption(segments) {
      capLine.style.opacity = "0";
      capLine.style.transform = "translateY(10px)";
      await sleep(60);
      while (capLine.firstChild) capLine.removeChild(capLine.firstChild);
      for (const seg of segments) {
        if (seg.color) {
          const span = document.createElement("span");
          span.style.color = seg.color;
          span.textContent = seg.text;
          capLine.appendChild(span);
        } else {
          capLine.appendChild(document.createTextNode(seg.text));
        }
      }
      capLine.style.opacity = "1";
      capLine.style.transform = "none";
    }

    // Word reveal: the round's answer takes the supernova beat's stage. Every finish rolls
    // a fresh combo of entrance animation × letter order × stagger/tilt, so no two reveals
    // look alike. Same safe-DOM rules as caption(): textContent only, no innerHTML.
    async function wordReveal(word) {
      capLine.style.opacity = "0";
      capLine.style.transform = "translateY(10px)";
      await sleep(60);
      while (capLine.firstChild) capLine.removeChild(capLine.firstChild);

      const anims = ["rise", "drop", "flip", "zoom", "scatter"];
      const anim = anims[Math.floor(Math.random() * anims.length)];
      const n = word.length;
      // Letter order: left→right, right→left, center-out, or shuffled.
      const orders = [
        (i) => i,
        (i) => n - 1 - i,
        (i) => Math.abs(i - (n - 1) / 2),
        (() => {
          const p = Array.from({ length: n }, (_, i) => i);
          for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
          }
          return (i) => p[i];
        })(),
      ];
      const order = orders[Math.floor(Math.random() * orders.length)];
      const stagger = 28 + Math.random() * 38;   // ms between letters — rapid-fire
      const dur = 280 + Math.random() * 150;     // per-letter animation length

      // The word IS the supernova — announce it with a jolt.
      shake = 14;
      ringBurst("#f0c14b", 4);

      // The answer earns headline size; capLine is rebuilt by teardown, so no restore needed.
      capLine.style.fontSize = "clamp(30px,7vw,54px)";
      capLine.style.letterSpacing = ".08em";
      capLine.style.fontWeight = "900";

      let maxDelay = 0;
      for (let i = 0; i < n; i++) {
        const delay = order(i) * stagger;
        maxDelay = Math.max(maxDelay, delay);
        const span = document.createElement("span");
        span.textContent = word[i];
        span.style.cssText = `
          display:inline-block; color:#f0c14b;
          text-shadow:0 0 28px rgba(240,193,75,.75),0 0 8px rgba(240,193,75,.9);
          --wr-rot:${(Math.random() - 0.5) * 70}deg;
          --wr-dx:${(Math.random() - 0.5) * 240}px;
          --wr-dy:${(Math.random() - 0.5) * 180}px;
          animation:settle-wr-${anim} ${dur}ms cubic-bezier(.18,1.4,.3,1) ${delay}ms both;
        `;
        capLine.appendChild(span);
        // Rising chime per letter, timed to its entrance.
        setTimeout(() => {
          if (running && !skipFired) playChime?.([[620 + order(i) * 80, 0]]);
        }, delay);
      }
      capLine.style.opacity = "1";
      capLine.style.transform = "none";
      // Let the letters mostly land, then punch: shake + rings + a glow pulse on the word.
      await Promise.race([sleep(maxDelay + dur * 0.5), skipRace]);
      if (!skipFired) {
        shake = 10;
        ringBurst("#f0c14b", 3);
        playChime?.([[988, 0], [1319, 0.07]]);
        capLine.style.animation = "settle-wr-pulse .45s cubic-bezier(.2,.9,.3,1.2)";
      }
    }

    // Bold the answer word (gold) inside its example sentence — safe DOM, no innerHTML.
    function buildExample(el, word, sentence) {
      while (el.firstChild) el.removeChild(el.firstChild);
      const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
      const m = sentence.match(re);
      if (!m) { el.textContent = sentence; return; }
      el.appendChild(document.createTextNode(sentence.slice(0, m.index)));
      const b = document.createElement("b");
      b.style.cssText = "color:#f0c14b; font-weight:600;";
      b.textContent = m[0];
      el.appendChild(b);
      el.appendChild(document.createTextNode(sentence.slice(m.index + m[0].length)));
    }

    // Act 1: the word assembles letter-by-letter, then meaning fades in beneath. Calm, editorial.
    async function lexiconReveal() {
      heroKicker.textContent = isLoss
        ? tFn("settle.theWordWas", "the word was")
        : tFn("settle.theWordIs", "the word is");
      const stagger = 70, dur = 550;
      [...answerWord].forEach((ch, i) => {
        const s = document.createElement("span");
        s.textContent = ch;
        s.style.cssText = `display:inline-block; opacity:0; transform:translateY(38px) rotate(6deg);
          transition:opacity ${dur}ms ease ${120 + i * stagger}ms,
                      transform ${dur}ms cubic-bezier(.2,.9,.3,1.4) ${120 + i * stagger}ms;`;
        heroWord.appendChild(s);
      });
      shake = 7; ringBurst("#f0c14b", 3);
      playChime?.([[660, 0]]);
      requestAnimationFrame(() => heroWord.querySelectorAll("span").forEach((s) => {
        s.style.opacity = "1"; s.style.transform = "none";
      }));
      await Promise.race([sleep(120 + answerWord.length * stagger + 180), skipRace]);
      // kicker + headword meta
      heroKicker.style.opacity = "1"; heroKicker.style.transform = "none";
      if (metaText) { heroMeta.textContent = metaText; heroMeta.style.opacity = "1"; heroMeta.style.transform = "none"; }
      heroRule.style.width = "min(420px,70%)";
      // meaning
      if (glossText) {
        heroGloss.textContent = glossText;
        heroGloss.style.opacity = "1"; heroGloss.style.transform = "none";
      }
      if (exampleText) {
        buildExample(heroExample, answerWord, exampleText);
        heroExample.style.opacity = "1"; heroExample.style.transform = "none";
      }
      // brief settle so the meaning paints; the celebration owns the hold + the gold.
      await Promise.race([sleep(220), skipRace]);
    }

    // ONE SCREEN: the word + meaning hold center while the gold rains behind them (canvas
    // coins orbiting the nebula) and settles into the compact in-hero tally that ticks up.
    // Comprehension and dopamine in a single beat — no second screen.
    async function runLexiconCelebration() {
      const c = orbitCenter();
      const revealP = lexiconReveal();                 // word + meaning appear…
      // …and the gold begins the instant the word has formed (concurrent, not after).
      await Promise.race([sleep(120 + answerWord.length * 70 + 240), skipRace]);
      const isWin = receipt.payout > 0;
      if (!skipFired) {
        const netSign = receipt.net >= 0 ? "+" : "−";
        heroTallyAmt.textContent = `◆ ${isWin ? 0 : receipt.payout}`;
        heroTallyAmt.style.color = isWin ? "#f0c14b" : "#e0796b";
        const l1 = document.createTextNode(tFn("settle.toWallet", "to your wallet"));
        const l2 = document.createTextNode(`${tFn("settle.net", "net")} ${netSign}${Math.abs(receipt.net)}`);
        heroTallyLbl.append(l1, document.createElement("br"), l2);
        heroTally.style.opacity = "1"; heroTally.style.transform = "none";

        if (isWin) {
          shake = 14; ringBurst("#f0c14b", 5);
          playChime?.([[392, 0], [523, 0.12], [659, 0.26], [988, 0.4]]);
          const n = Math.min(receipt.minted, 30); // thinned coin field — texture, not a storm
          for (let i = 0; i < n; i++) {
            if (!running || skipFired) break;
            mkCoin(c.x, c.y, 1.4);
            if (i % 3 === 0) ringBurst("#f0c14b", 1);
            await Promise.race([sleep(26), skipRace]);
          }
          // payout figure + wallet HUD count up together
          const payDur = 1100, t0 = performance.now();
          (function f(now) {
            if (!running) return;
            const t = Math.min(1, (now - t0) / payDur);
            heroTallyAmt.textContent = `◆ ${Math.round(receipt.payout * (1 - Math.pow(1 - t, 3)))}`;
            if (t < 1) requestAnimationFrame(f);
          })(t0);
          countTo(walletBefore, finalWallet, payDur);
          await Promise.race([sleep(payDur + 180), skipRace]);
        } else {
          onWalletTick?.(finalWallet); // payout ≤ 0: HUD already true, nothing to count
        }
      }
      // hold so the lesson is read (and heard — the voice reads it concurrently)
      await Promise.race([sleep(1600), skipRace]);
      await revealP.catch(() => {});
    }

    function countTo(from, to, ms) {
      const t0 = performance.now();
      function f(n) {
        if (!running) return;
        const t = Math.min(1, (n - t0) / ms);
        const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
        onWalletTick?.(v);
        if (t < 1) requestAnimationFrame(f);
        else onWalletTick?.(to); // guarantee exact final value
      }
      requestAnimationFrame(f);
    }

    function flyTo(k, tx, ty, ms) {
      const x0 = k.x, y0 = k.y, t0 = performance.now();
      k.fly = true;
      (function f(n) {
        if (!running) { k.gone = true; return; }
        const t = Math.min(1, (n - t0) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        k.x = x0 + (tx - x0) * e;
        k.y = y0 + (ty - y0) * e - Math.sin(t * Math.PI) * 70 * DPR() / 2;
        if (t < 1) requestAnimationFrame(f);
        else { k.gone = true; coins = coins.filter((c) => c !== k); }
      })(t0);
    }

    // ── skip: tap/click anywhere to jump to end ─────────────────────────────────────────────
    let skipFired = false;
    let resolveSkip;
    const skipRace = new Promise((r) => { resolveSkip = r; });
    const onSkip = () => {
      if (!skipFired) { skipFired = true; resolveSkip(); }
    };
    overlay.addEventListener("click", onSkip);

    // ── teardown ────────────────────────────────────────────────────────────────────────────
    function teardown() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      window.removeEventListener("resize", onResize);
      overlay.removeEventListener("click", onSkip);
      overlay.remove();
      // Ensure final wallet value is landed on EVERY exit path.
      onWalletTick?.(finalWallet);
      resolve();
    }

    // ── animation sequence ──────────────────────────────────────────────────────────────────
    (async () => {
      const c = orbitCenter();

      // ── The word + its meaning + the gold, all on ONE screen, all at once. ──
      // The common path: a known answer (win OR loss) gets the lexicon celebration.
      if (answerWord && !skipFired) {
        await runLexiconCelebration();
        teardown();
        return;
      }

      // ── Fallback (no answer word / bust with no word): the original gold beats. ──
      // Beat 1: mint — coins emerge, one per minted gold
      await caption([
        { text: `${receipt.points.toLocaleString("en-US")} pts`, color: "#9d8bff" },
        { text: ` → ` },
        { text: `◆ ${receipt.minted}`, color: "#f0c14b" },
      ]);
      const mintCount = Math.min(receipt.minted, 28); // thin particle field — gold reads as a tail, not the headline
      for (let i = 0; i < mintCount; i++) {
        if (!running) break;
        mkCoin(c.x, c.y, 1);
        if (i % 2 === 0) ringBurst("#f0c14b", 1);
        playChime?.([[620 + i * 16, 0]]);
        shake = Math.min(6, 2 + i * 0.1);
        await Promise.race([sleep(32), skipRace]);
        if (skipFired) break;
      }
      if (!skipFired) await Promise.race([sleep(220), skipRace]);

      // Beat 2: multiplier (skipped when mult===1)
      if (!skipFired && receipt.mult > 1) {
        multEl.textContent = `×${receipt.mult}`;
        // Fix 6: use Object.assign instead of cssText += (avoids accumulation + reflow hack).
        multEl.style.animation = "none";
        Object.assign(multEl.style, {
          opacity: "1",
          transform: "translate(-50%,-50%) scale(1)",
          transition: "none",
          animation: "settle-mf 1.1s cubic-bezier(.16,1.3,.3,1) forwards",
        });

        playChime?.([[262, 0], [330, 0.18]]);
        shake = 16;
        ringBurst("#f0c14b", 6);
        await caption([
          { text: `×${receipt.mult} STREAK`, color: "#f0c14b" },
          { text: ` — ${tFn("settle.caption.eachCoinSplits", "every coin splits")}` },
        ]);
        const parents = coins.slice();
        for (const p of parents) {
          if (!running || skipFired) break;
          for (let j = 1; j < receipt.mult; j++) mkCoin(p.x, p.y, 3);
          playChime?.([[880 + Math.random() * 400, 0]]);
          await Promise.race([sleep(16), skipRace]);
        }
        // Fix 1: cap VISUAL coin count at 60; captions already show the honest number.
        const earnedCap = Math.min(receipt.earned, 60);
        while (coins.length > earnedCap) coins.pop();
        while (coins.length < earnedCap) mkCoin(c.x, c.y, 2);
        playChime?.([[523, 0.05]]);
        shake = 10;
        if (!skipFired) await Promise.race([sleep(320), skipRace]);
      }

      // Beat 3: spends — red coins ripped away
      if (!skipFired && receipt.spends) {
        await caption([
          { text: `${tFn("settle.caption.powerUps", "power-ups")} ` },
          { text: `− ◆ ${receipt.spends}`, color: "#e0796b" },
        ]);
        const n = Math.min(coins.length, Math.max(1, Math.round(receipt.spends / 5)));
        for (let i = 0; i < n; i++) {
          if (!running || skipFired) break;
          const k = coins[coins.length - 1 - i];
          if (!k) break;
          k.hue = 1;
          flyTo(k, -60 * DPR(), H * 0.7, 400);
          playChime?.([[300 - i * 12, 0]]);
          await Promise.race([sleep(35), skipRace]);
        }
        coins = coins.filter((k) => !k.gone);
        if (!skipFired) await Promise.race([sleep(200), skipRace]);
      }

      // Beat 4: bonus — shooting stars
      if (!skipFired && receipt.bonus) {
        await caption([
          { text: `${opts.bonusCaption || tFn("settle.caption.winBonus", "win bonus")} ` },
          { text: `+ ◆ ${receipt.bonus}`, color: "#f0c14b" },
        ]);
        // Fix 2: cap bonus star count at 12.
        const n = Math.min(Math.max(2, Math.round(receipt.bonus / 6)), 12);
        for (let i = 0; i < n; i++) {
          if (!running || skipFired) break;
          coins.push({
            x: -30, y: H * 0.12 + Math.random() * H * 0.2,
            vx: 14, vy: 5,
            r: 10 * DPR() / 2,
            o: Math.random() * 7, fly: null,
            born: performance.now(), hue: 0, gone: false,
          });
          playChime?.([[1046 + i * 60, 0]]);
          await Promise.race([sleep(45), skipRace]);
        }
        if (!skipFired) await Promise.race([sleep(220), skipRace]);
      }

      // Beat 5: supernova → wallet
      const isWin = receipt.payout > 0;
      const payLabel = tFn("settle.toWallet", "to your wallet");
      const bustLabel = tFn("settle.bust", "buy-in was your max loss");

      // The word already led in Act 1; only the no-word / loss caption remains here.
      if (!skipFired && !answerWord) {
        await caption(
          isWin
            ? [{ text: tFn("settle.caption.supernova", "supernova"), color: "#f0c14b" }]
            : [{ text: `${tFn("settle.caption.tableKeepsIt", "the table keeps it")} — ` }, { text: bustLabel, color: "#e0796b" }],
        );
      }

      payN.textContent = `◆ ${receipt.payout}`;
      payN.style.color = receipt.net < 0 ? "#e0796b" : "#f0c14b";
      payN.style.textShadow = receipt.net < 0
        ? "0 0 40px rgba(224,121,107,.4)"
        : "0 0 80px rgba(240,193,75,.55),0 0 20px rgba(240,193,75,.8)";

      const netSign = receipt.net >= 0 ? "+" : "−";
      const netAbs = Math.abs(receipt.net);
      payS.textContent = `${payLabel} · ${tFn("settle.net", "net")} ${netSign}${netAbs}`;

      if (!skipFired) await Promise.race([sleep(170), skipRace]);

      payoutEl.style.opacity = "1";
      payoutEl.style.transition = "opacity .25s";

      if (isWin && !skipFired) {
        shake = 20;
        ringBurst("#f0c14b", 8);
        playChime?.([[392, 0], [523, 0.15], [659, 0.3]]);

        // Count payout figure 0 → payout
        const payT0 = performance.now();
        const payDur = 600;
        (function f(n) {
          if (!running) return;
          const t2 = Math.min(1, (n - payT0) / payDur);
          const v = Math.round(receipt.payout * (1 - Math.pow(1 - t2, 3)));
          payN.textContent = `◆ ${v}`;
          if (t2 < 1) requestAnimationFrame(f);
        })(payT0);

        // Swarm coins to wallet position (top-right, approximate)
        const walletX = window.innerWidth * 0.88 * DPR();
        const walletY = 32 * DPR();
        const flock = coins.slice();
        let fi = 0;
        for (const k of flock) {
          if (!running) break;
          flyTo(k, walletX, walletY, 420);
          if (fi % 2 === 0) playChime?.([[523 * Math.pow(2, (fi % 16) / 16), 0]]);
          fi++;
          await Promise.race([sleep(18), skipRace]);
        }
        // Wallet count-up: walletBefore → finalWallet
        countTo(walletBefore, finalWallet, flock.length * 18 + 400);
        if (!skipFired) await Promise.race([sleep(flock.length * 18 + 420), skipRace]);
        playChime?.([[784, 0]]);
      } else {
        // Bust: coins collapse to center
        for (const k of coins) {
          if (!running) break;
          flyTo(k, c.x, c.y, 550);
        }
        playChime?.([[196, 0], [147, 0.3]]);
        onWalletTick?.(finalWallet); // payout=0 but still call so HUD is true
      }

      if (!skipFired) await Promise.race([sleep(420), skipRace]);
      teardown();
    })().catch(() => teardown());
  });
}

// ── CSS injection ─────────────────────────────────────────────────────────────────────────
// Injected once; guard prevents re-injection on hot reload.
if (typeof document !== "undefined" && !document.getElementById("settle-styles")) {
  const style = document.createElement("style");
  style.id = "settle-styles";
  style.textContent = `
    @keyframes settle-mf {
      0%   { opacity:0; transform:translate(-50%,-50%) scale(.4) rotate(-6deg) }
      18%  { opacity:1; transform:translate(-50%,-50%) scale(1.12) rotate(2deg) }
      30%  { transform:translate(-50%,-50%) scale(1) }
      78%  { opacity:1 }
      100% { opacity:0; transform:translate(-50%,-50%) scale(1.3) }
    }
    /* Word-reveal entrances (settle.js wordReveal) — per-letter, randomized per finish. */
    @keyframes settle-wr-rise {
      0%   { opacity:0; transform:translateY(28px) scale(.6) }
      60%  { opacity:1; transform:translateY(-7px) scale(1.1) }
      100% { opacity:1; transform:none }
    }
    @keyframes settle-wr-drop {
      0%   { opacity:0; transform:translateY(-70px) rotate(var(--wr-rot,0deg)) }
      70%  { opacity:1; transform:translateY(7px) rotate(0deg) }
      100% { opacity:1; transform:none }
    }
    @keyframes settle-wr-flip {
      0%   { opacity:0; transform:perspective(420px) rotateX(95deg) scale(.8) }
      55%  { opacity:1; transform:perspective(420px) rotateX(-18deg) }
      100% { opacity:1; transform:none }
    }
    @keyframes settle-wr-zoom {
      0%   { opacity:0; transform:scale(2.6) rotate(var(--wr-rot,0deg)) }
      100% { opacity:1; transform:none }
    }
    @keyframes settle-wr-scatter {
      0%   { opacity:0; transform:translate(var(--wr-dx,0px),var(--wr-dy,0px)) rotate(var(--wr-rot,0deg)) scale(.4) }
      100% { opacity:1; transform:none }
    }
    @keyframes settle-wr-pulse {
      0%   { transform:scale(1) }
      35%  { transform:scale(1.12) }
      100% { transform:scale(1) }
    }
    #settleOverlay {
      position:fixed; inset:0; z-index:10000;
      background:#0a0a0e; overflow:hidden;
    }
  `;
  document.head.appendChild(style);
}

// ── shared overlay factory ────────────────────────────────────────────────────────────────
function buildOverlay() {
  const el = document.createElement("div");
  el.id = "settleOverlay";
  return el;
}
