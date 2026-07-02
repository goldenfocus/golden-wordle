// public/live.js — the global-chat client for /live. Pure render helpers (chatRow,
// renderTranscript, presenceLabel) are exported for tests; mountGlobalChat wires them to a
// live /ws/live socket with auto-reconnect. All user text goes in via textContent — never
// innerHTML — so a message can never inject markup.

export function presenceLabel(n) {
  return `${n} online`;
}

// Build one transcript row. `entry` is a ChatEntry: {kind:"user",from,text,t} | {kind:"system",text,t}.
export function chatRow(entry) {
  const row = document.createElement("div");
  row.className = "chat-row" + (entry.kind === "system" ? " chat-system" : "");
  if (entry.kind === "user") {
    const from = document.createElement("span");
    from.className = "chat-from";
    from.textContent = entry.from;
    row.appendChild(from);
  }
  const text = document.createElement("span");
  text.className = "chat-text";
  text.textContent = entry.text;
  row.appendChild(text);
  return row;
}

// Replace the transcript wholesale (used for the initial snapshot AND reconnect re-seed —
// idempotent). For a single new message, use appendRow to avoid a full rebuild.
export function renderTranscript(el, entries) {
  el.textContent = "";
  const frag = document.createDocumentFragment();
  for (const e of entries) frag.appendChild(chatRow(e));
  el.appendChild(frag);
  el.scrollTop = el.scrollHeight;
}

function appendRow(el, entry) {
  el.appendChild(chatRow(entry));
  el.scrollTop = el.scrollHeight;
}

// Mount the chat panel into mountEl and open the socket.
// opts: { username, onNeedName }.
//   username    — the current player's name ("" / null ⇒ anonymous read-only composer)
//   onNeedName  — called when an anonymous user tries to post (host prompts a rename)
// Returns stop() — closes the socket and halts reconnect. The caller MUST call it on teardown.
export function mountGlobalChat(mountEl, { username, onNeedName } = {}) {
  if (!mountEl) return () => {};
  mountEl.innerHTML =
    `<div class="chat-head"><span class="chat-title">Global chat</span>` +
    `<span class="chat-presence" id="chatPresence"></span></div>` +
    `<div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>` +
    `<form class="chat-compose" id="chatCompose">` +
    `<input id="chatInput" class="chat-input" maxlength="200" autocomplete="off" ` +
    `placeholder="${username ? "Say something…" : "Pick a name to chat"}"${username ? "" : " disabled"}>` +
    `<button class="chat-send" type="submit"${username ? "" : " disabled"}>Send</button></form>`;

  const log = mountEl.querySelector("#chatLog");
  const presence = mountEl.querySelector("#chatPresence");
  const form = mountEl.querySelector("#chatCompose");
  const input = mountEl.querySelector("#chatInput");

  let ws = null;
  let stopped = false;
  let backoff = 1000;

  const connect = () => {
    if (stopped) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const u = username ? `?u=${encodeURIComponent(username)}` : "";
    ws = new WebSocket(`${proto}//${location.host}/ws/live${u}`);
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "chat_snapshot") { renderTranscript(log, msg.chat); presence.textContent = presenceLabel(msg.online); }
      else if (msg.type === "chat") { appendRow(log, msg.entry); }
      else if (msg.type === "online") { presence.textContent = presenceLabel(msg.n); }
      else if (msg.type === "error" && msg.code === "need_name" && onNeedName) { onNeedName(); }
      else if (msg.type === "error" && msg.code === "slow_down") { input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 400); }
    };
    ws.onopen = () => { backoff = 1000; };
    ws.onclose = () => {
      if (stopped) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000); // cap reconnect backoff at 15s
    };
  };
  connect();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!username) { if (onNeedName) onNeedName(); return; }
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", text }));
    input.value = "";
  });

  return function stop() {
    stopped = true;
    if (ws) { try { ws.close(); } catch (_) { /* already closing */ } }
  };
}
