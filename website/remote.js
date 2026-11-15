import { captureDisplay, detectPlatform } from "./shared/capabilities.js";

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const runtimeConfig = window.MADRADOR_CONFIG || {};
const onStaticPages = location.hostname === "madrador60.github.io";
const apiUrl = String(runtimeConfig.apiUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const signalUrl = String(runtimeConfig.signalUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const socket = signalUrl
  ? io(signalUrl, { transports: ["websocket", "polling"], timeout: 10000, reconnectionDelayMax: 10000 })
  : io({ autoConnect: false });
const platform = detectPlatform();
const MAX_FILE_SIZE = 25 * 1024 * 1024; // via le serveur
const MAX_DIRECT_FILE_SIZE = 2 * 1024 ** 3; // en direct entre les deux appareils
const CHUNK_SIZE = 64 * 1024;
const DEVICE_NAME = `Navigateur ${navigator.userAgentData?.brands?.find((brand) => !/Not.A.Brand|Chromium/i.test(brand.brand))?.brand || ""}`.trim();
// Raccourcis que le PC de l'aidant intercepterait lui-même.
const COMBOS = {
  win: { key: "Meta", code: "MetaLeft", meta: true },
  alttab: { key: "Tab", code: "Tab", alt: true },
  taskmgr: { key: "Escape", code: "Escape", ctrl: true, shift: true },
  desktop: { key: "d", code: "KeyD", meta: true },
  altf4: { key: "F4", code: "F4", alt: true },
  lock: { key: "l", code: "KeyL", meta: true }
};

const state = {
  role: null, peer: null, code: null, stream: null, resumeToken: null,
  permissions: { control: false, clipboard: false, files: false },
  candidates: [], channels: {}, pendingViewer: null, pendingFileOffer: null, transferIn: null, transferOut: null,
  inputPaused: false, zoom: 0, side: null, startedAt: 0, timers: {}
};

/* ---------- Utilitaires ---------- */

const formatCode = (value) => String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
const formatDuration = (seconds) => [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
const formatBytes = (bytes) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.ceil(bytes / 1024)} Ko`;
const initials = (name) => String(name || "PC").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "PC";
const setStatus = (text) => { $("status").textContent = String(text).slice(0, 120); };

function toast(text) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = String(text).slice(0, 220);
  $("toasts").append(item);
  while ($("toasts").children.length > 3) $("toasts").firstElementChild.remove();
  setTimeout(() => item.remove(), 4500);
}

function showPanel(id) {
  for (const panel of ["modePanel", "connectPanel", "hostPanel", "sessionPanel"]) $(panel).hidden = panel !== id;
}

/* ---------- Aider (viewer) ---------- */

function setPending(active, title = "Demande envoyée", text = "La personne doit accepter sur son ordinateur.") {
  $("connectPending").hidden = !active;
  $("connectForm").hidden = active;
  $("pendingTitle").textContent = title;
  $("pendingText").textContent = text;
}

function showError(message) {
  setPending(false);
  $("errorText").textContent = String(message).slice(0, 180);
  $("connectError").hidden = false;
}

function requestConnection(event) {
  event.preventDefault();
  const value = $("code").value.replace(/\D/g, "");
  if (value.length !== 9) return showError("Le code contient 9 chiffres.");
  if (!socket.connected) return showError("Le serveur de connexion est injoignable. Réessayez dans un instant (jusqu’à une minute s’il sortait de veille).");
  state.code = value;
  state.role = "viewer";
  $("connectError").hidden = true;
  socket.emit("viewer-request", { code: value, deviceName: DEVICE_NAME });
  setPending(true);
}

/* ---------- Montrer (hôte navigateur) ---------- */

function hostPermissions() {
  // Un navigateur ne peut pas piloter le système : le contrôle reste désactivé.
  return { control: false, clipboard: $("webClipboard").checked, files: $("webFiles").checked };
}

async function chooseDisplay() {
  try {
    const stream = await captureDisplay({ audio: false });
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = stream;
    $("hostPreview").srcObject = stream;
    $("hostPreview").hidden = false;
    $("sourceEmpty").hidden = true;
    $("generateHostCode").disabled = false;
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (state.role === "host") endSession(true, "Le partage a été arrêté depuis le navigateur.");
      else resetHost();
    });
  } catch (error) {
    toast(error.name === "NotAllowedError" ? "Partage annulé." : error.message);
  }
}

function createHostCode() {
  if (!state.stream) return toast("Choisissez d’abord ce que vous voulez montrer.");
  if (!socket.connected) return toast("Le serveur de connexion est injoignable.");
  state.role = "host";
  state.permissions = hostPermissions();
  socket.emit("host-create", { deviceName: DEVICE_NAME, permissions: state.permissions, durationMinutes: Number($("webDuration").value), available: true });
}

function drawQr(canvas, text) {
  if (typeof window.qrcode !== "function") return;
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = canvas.width / (count + 4);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1020";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) ctx.fillRect(Math.floor((col + 2) * cell), Math.floor((row + 2) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}

function showHostWaiting(code, expiresAt) {
  $("hostSetup").hidden = true;
  $("hostWaiting").hidden = false;
  $("hostCode").textContent = formatCode(code);
  drawQr($("hostQr"), `${location.origin}${location.pathname}?code=${code}`);
  clearInterval(state.timers.expiry);
  if (!expiresAt) { $("hostExpiry").textContent = "Valable sans limite"; return; }
  const tick = () => {
    const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    $("hostExpiry").textContent = seconds ? `Expire dans ${formatDuration(seconds).replace(/^00:/, "")}` : "Code expiré";
  };
  tick();
  state.timers.expiry = setInterval(tick, 1000);
}

function resetHost({ stopStream = false } = {}) {
  clearInterval(state.timers.expiry);
  $("hostSetup").hidden = false;
  $("hostWaiting").hidden = true;
  if (stopStream) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    $("hostPreview").srcObject = null;
    $("hostPreview").hidden = true;
    $("sourceEmpty").hidden = false;
    $("generateHostCode").disabled = true;
  }
}

/* ---------- WebRTC ---------- */

async function iceServers() {
  if (!apiUrl) return [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const response = await fetch(`${apiUrl}/api/ice`, { signal: AbortSignal.timeout(8000) });
    const body = response.ok ? await response.json() : null;
    if (Array.isArray(body?.iceServers) && body.iceServers.length) return body.iceServers;
  } catch {}
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

async function sendOffer(peer, iceRestart = false) {
  const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
  await peer.setLocalDescription(offer);
  socket.emit("signal", { code: state.code, data: { type: "offer", sdp: peer.localDescription } });
}

async function createPeer(isHost) {
  state.peer?.close();
  state.candidates = [];
  state.channels = {};
  const peer = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
  state.peer = peer;
  peer.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("signal", { code: state.code, data: { type: "candidate", candidate } }); };
  const bindChannel = (channel) => {
    state.channels[channel.label] = channel;
    channel.binaryType = "arraybuffer";
    channel.onmessage = ({ data }) => {
      try {
        if (channel.label === "file-transfer") receiveChunk(data);
        else if (channel.label === "commands" && state.role === "viewer") {
          const message = JSON.parse(data);
          if (message.type === "screens") renderScreens(message);
        }
      } catch {}
    };
  };
  peer.ondatachannel = ({ channel }) => bindChannel(channel);
  if (isHost) {
    for (const [label, options] of [["input-fast", { ordered: false, maxRetransmits: 0 }], ["commands", { ordered: true }], ["file-transfer", { ordered: true }]]) {
      bindChannel(peer.createDataChannel(label, options));
    }
  } else {
    // Un seul flux regroupe l'image et le son, quel que soit l'ordre d'arrivée.
    const remoteStream = new MediaStream();
    $("video").srcObject = remoteStream;
    peer.ontrack = ({ track }) => {
      remoteStream.addTrack(track);
      if (track.kind === "audio") { track.onunmute = () => { $("toggleSound").hidden = false; }; return; }
      $("videoLoader").hidden = true;
      $("video").play().catch(() => { $("tapToPlay").hidden = false; });
      $("video").focus();
    };
  }
  peer.onconnectionstatechange = () => {
    const labels = { connecting: "Connexion…", connected: "Connecté", disconnected: "Connexion instable…", failed: "Reconnexion…", closed: "Terminé" };
    $("sessionState").textContent = labels[peer.connectionState] || peer.connectionState;
    if (peer.connectionState === "connected" && !state.startedAt) {
      state.startedAt = Date.now();
      const tick = () => { $("sessionDuration").textContent = formatDuration(Math.floor((Date.now() - state.startedAt) / 1000)); };
      tick();
      state.timers.duration = setInterval(tick, 1000);
      monitor(peer, isHost);
      if (isHost) $("videoLoader").hidden = true;
    }
    if (peer.connectionState === "failed") {
      peer.restartIce();
      if (isHost) sendOffer(peer, true).catch(() => {});
    }
  };
  return peer;
}

// Messages arrivés avant la création de la connexion : gardés puis rejoués.
const earlySignals = [];

async function handleSignal(data) {
  if (!state.peer) {
    if (state.code && earlySignals.length < 200) earlySignals.push(data);
    return;
  }
  if (data.type === "offer") {
    await state.peer.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate).catch(() => {});
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    socket.emit("signal", { code: state.code, data: { type: "answer", sdp: state.peer.localDescription } });
  } else if (data.type === "answer") {
    await state.peer.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate).catch(() => {});
  } else if (data.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(data.candidate);
    else state.candidates.push(data.candidate);
  }
}

function monitor(peer, isHost) {
  clearInterval(state.timers.stats);
  let last = { bytes: 0, at: performance.now() };
  state.timers.stats = setInterval(async () => {
    const report = await peer.getStats();
    report.forEach((item) => {
      if (item.type === (isHost ? "outbound-rtp" : "inbound-rtp") && item.kind === "video") {
        const bytes = isHost ? item.bytesSent : item.bytesReceived;
        const now = performance.now();
        $("bitrate").textContent = `${Math.max(0, (bytes - last.bytes) * 8 / (now - last.at) / 1000).toFixed(1)} Mb/s`;
        last = { bytes, at: now };
        $("resolution").textContent = item.frameWidth ? `${item.frameWidth}×${item.frameHeight}` : "—";
        $("fps").textContent = item.framesPerSecond ? String(Math.round(item.framesPerSecond)) : "—";
        $("codec").textContent = report.get(item.codecId)?.mimeType?.split("/")[1] || "—";
      }
      if (item.type === "candidate-pair" && item.nominated && item.state === "succeeded") {
        $("latency").textContent = `${Math.round((item.currentRoundTripTime || 0) * 1000)} ms`;
        const relay = [report.get(item.localCandidateId), report.get(item.remoteCandidateId)].some((candidate) => candidate?.candidateType === "relay");
        $("route").textContent = relay ? "Relais" : "Directe";
      }
    });
  }, 1000);
}

/* ---------- Session ---------- */

function enterSession(role, peerName) {
  state.role = role;
  state.startedAt = 0;
  state.inputPaused = false;
  showPanel("sessionPanel");
  $("sessionPanel").classList.toggle("as-host", role === "host");
  $("peerName").textContent = role === "host" ? `Vous montrez votre écran à ${peerName}` : peerName;
  $("peerAvatar").textContent = initials(peerName);
  $("sessionState").textContent = "Connexion…";
  $("sessionDuration").textContent = "00:00:00";
  $("messages").replaceChildren();
  $("videoLoader").hidden = false;
  $("screensWrap").hidden = true;
  $("toggleSound").hidden = true;
  $("tapToPlay").hidden = true;
  // Les navigateurs (surtout sur téléphone) refusent la lecture automatique avec son :
  // l'image démarre sans son, un appui sur « Son » l'active.
  setSound(false);
  if (role === "host") { $("video").srcObject = state.stream; $("video").muted = true; }
  setZoom(0);
  updateTools();
}

function endSession(notifyPeer = true, reason = "Session terminée.") {
  if (notifyPeer && state.code) socket.emit("end-session", { code: state.code });
  if (state.transferOut) state.transferOut.cancelled = true;
  state.transferIn = null;
  $("fileProgress").hidden = true;
  for (const timer of Object.values(state.timers)) clearInterval(timer);
  state.peer?.close();
  const wasHost = state.role === "host";
  earlySignals.length = 0;
  Object.assign(state, { role: null, peer: null, code: null, resumeToken: null, candidates: [], channels: {}, startedAt: 0, side: null });
  $("video").srcObject = null;
  closeSide();
  setPending(false);
  if (wasHost) resetHost();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  showPanel("modePanel");
  if (reason) toast(reason);
}

function updateTools() {
  const { control, clipboard, files } = state.permissions;
  const active = control && !state.inputPaused;
  $("toggleControl").disabled = !control;
  $("toggleControl").setAttribute("aria-pressed", String(active));
  $("toggleControl").title = control ? (active ? "Suspendre le contrôle" : "Reprendre le contrôle") : "Le contrôle n’a pas été autorisé";
  $("keysButton").disabled = !active;
  $$('[data-panel="clipboard"]').forEach((button) => { button.disabled = !clipboard; });
  $$('[data-panel="files"]').forEach((button) => { button.disabled = !files; });
  if ((state.side === "clipboard" && !clipboard) || (state.side === "files" && !files)) closeSide();
}

function openSide(name) {
  if (state.side === name) return closeSide();
  state.side = name;
  $("side").hidden = false;
  $("sideTitle").textContent = { chat: "Discussion", files: "Fichiers", clipboard: "Presse-papiers", stats: "Qualité" }[name];
  $$(".side-content").forEach((content) => { content.hidden = content.dataset.content !== name; });
  $$("[data-panel]").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  if (name === "chat") { $$(".unread").forEach((dot) => { dot.hidden = true; }); $("message").focus(); }
}

function closeSide() {
  state.side = null;
  $("side").hidden = true;
  $$("[data-panel]").forEach((button) => button.classList.remove("active"));
}

function addMessage(text, mine) {
  if ($("messages").querySelector(".muted")) $("messages").replaceChildren();
  const bubble = document.createElement("div");
  bubble.className = `bubble${mine ? " mine" : ""}`;
  bubble.textContent = String(text).slice(0, 2000);
  $("messages").append(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
  if (!mine && state.side !== "chat") { $$(".unread").forEach((dot) => { dot.hidden = false; }); toast(`Message : ${String(text).slice(0, 120)}`); }
}

function setSound(on) {
  $("video").muted = !on;
  $("toggleSound").setAttribute("aria-pressed", String(on));
  $("toggleSound").querySelector("use").setAttribute("href", on ? "#i-volume" : "#i-mute");
}

function renderScreens({ screens, current }) {
  $("screensWrap").hidden = !Array.isArray(screens) || screens.length < 2;
  $("screensMenu").replaceChildren();
  for (const screen of screens || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = String(screen.label).slice(0, 80);
    button.classList.toggle("current", screen.id === current);
    button.onclick = () => {
      state.channels.commands?.send(JSON.stringify({ type: "select-screen", id: screen.id }));
      $("screensMenu").hidden = true;
      video.focus();
    };
    $("screensMenu").append(button);
  }
}

/* ---------- Fichiers ---------- */

function showProgress(name, done, total, startedAt, verb) {
  $("fileProgress").hidden = false;
  $("fileProgressName").textContent = name;
  const percent = total ? Math.floor(done / total * 100) : 0;
  $("fileProgressPercent").textContent = `${percent} %`;
  $("fileProgressBar").value = percent;
  const speed = done / Math.max(0.5, (performance.now() - startedAt) / 1000);
  $("fileProgressDetail").textContent = `${verb} ${formatBytes(done)} sur ${formatBytes(total)} · ${formatBytes(speed)}/s`;
}

function finishTransfer(message) {
  $("fileProgress").hidden = true;
  $("fileStatus").textContent = message;
}

async function streamFile(file, id) {
  const channel = state.channels["file-transfer"];
  const transfer = { cancelled: false };
  state.transferOut = transfer;
  const startedAt = performance.now();
  channel.bufferedAmountLowThreshold = 1024 * 1024;
  channel.send(JSON.stringify({ type: "start", id, name: file.name, size: file.size }));
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    if (transfer.cancelled || channel.readyState !== "open") { state.transferOut = null; return finishTransfer("Envoi interrompu."); }
    if (channel.bufferedAmount > 8 * 1024 * 1024) await new Promise((resolve) => { channel.onbufferedamountlow = resolve; });
    channel.send(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
    if (offset % (CHUNK_SIZE * 16) === 0) showProgress(file.name, offset, file.size, startedAt, "Envoyé");
  }
  channel.send(JSON.stringify({ type: "end", id }));
  state.transferOut = null;
  finishTransfer(`${file.name} envoyé.`);
}

function receiveChunk(data) {
  const transfer = state.transferIn;
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (!transfer || message.id !== transfer.id) return;
    if (message.type === "start") transfer.startedAt = performance.now();
    if (message.type === "end") {
      state.transferIn = null;
      if (transfer.received !== transfer.size) return finishTransfer("Le fichier reçu est incomplet.");
      const url = URL.createObjectURL(new Blob(transfer.chunks));
      const link = document.createElement("a");
      link.href = url;
      link.download = transfer.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      finishTransfer(`${transfer.name} téléchargé.`);
      toast(`Fichier reçu : ${transfer.name}`);
    }
    return;
  }
  if (!transfer) return;
  transfer.chunks.push(data);
  transfer.received += data.byteLength;
  if (transfer.received > transfer.size) { state.transferIn = null; return finishTransfer("Fichier refusé : taille incorrecte."); }
  if (transfer.received === transfer.size || transfer.received % (CHUNK_SIZE * 16) === 0) showProgress(transfer.name, transfer.received, transfer.size, transfer.startedAt, "Reçu");
}

function setZoom(level) {
  state.zoom = level;
  const video = $("video");
  $("stage").classList.toggle("fit", level === 0);
  $("stage").classList.toggle("zoomed", level !== 0);
  $("zoomFit").setAttribute("aria-pressed", String(level === 0));
  $("zoomLabel").textContent = level === 0 ? "Ajusté" : `${Math.round(level * 100)} %`;
  video.style.width = level && video.videoWidth ? `${Math.round(video.videoWidth * level)}px` : "";
  video.style.height = level && video.videoHeight ? `${Math.round(video.videoHeight * level)}px` : "";
}

/* ---------- Contrôle (aidant) ---------- */

function videoPoint(event) {
  const video = $("video");
  const rect = video.getBoundingClientRect();
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : rect.width / rect.height;
  let width = rect.width;
  let height = rect.height;
  if (width / height > ratio) width = height * ratio; else height = width / ratio;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - (rect.width - width) / 2) / width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top - (rect.height - height) / 2) / height))
  };
}

const canControl = () => state.role === "viewer" && state.permissions.control && !state.inputPaused && state.code;

function sendPayload(payload) {
  if (!canControl()) return;
  const channel = state.channels[payload.type === "mousemove" ? "input-fast" : "commands"];
  if (channel?.readyState === "open") channel.send(JSON.stringify(payload));
  else socket.emit("remote-input", { code: state.code, payload });
}

const video = $("video");
for (const type of ["mousedown", "mouseup"]) {
  video.addEventListener(type, (event) => {
    if (type === "mousedown") video.focus();
    if (event.button > 2 || !canControl()) return;
    event.preventDefault();
    sendPayload({ type, ...videoPoint(event), button: event.button });
  });
}
video.addEventListener("mousemove", (event) => sendPayload({ type: "mousemove", ...videoPoint(event) }));
video.addEventListener("wheel", (event) => {
  if (!canControl()) return;
  event.preventDefault();
  sendPayload({ type: "wheel", ...videoPoint(event), deltaY: Math.max(-10000, Math.min(10000, event.deltaY)) });
}, { passive: false });
video.addEventListener("keydown", (event) => {
  if (!canControl()) return;
  event.preventDefault();
  sendPayload({ type: "keydown", key: event.key.slice(0, 40), code: event.code.slice(0, 40), ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey });
});
video.addEventListener("contextmenu", (event) => event.preventDefault());
video.addEventListener("loadedmetadata", () => { if (state.zoom) setZoom(state.zoom); });

/* ---------- Serveur ---------- */

socket.on("connect", () => {
  setStatus("Serveur connecté");
  $("serverDot").className = "dot online";
  if (state.code && state.resumeToken && state.role) socket.emit("resume-session", { code: state.code, resumeToken: state.resumeToken, role: state.role });
});
socket.on("disconnect", () => { setStatus("Reconnexion au serveur…"); $("serverDot").className = "dot warn"; });
socket.on("connect_error", () => { setStatus("Serveur injoignable, nouvelle tentative…"); $("serverDot").className = "dot warn"; });

socket.on("host-created", ({ code, expiresAt, resumeToken }) => {
  state.code = code;
  state.resumeToken = resumeToken;
  showHostWaiting(code, expiresAt);
});
socket.on("session-expired", () => { if (!state.peer) { resetHost(); state.code = null; toast("Le code a expiré."); } });
socket.on("incoming-request", ({ viewerSocketId, deviceName }) => {
  state.pendingViewer = { id: viewerSocketId, name: deviceName || "Un appareil" };
  $("requester").textContent = state.pendingViewer.name;
  $("requestDialog").showModal();
});
socket.on("viewer-ready", async () => {
  if (!state.stream) return;
  enterSession("host", state.pendingViewer?.name || "un appareil");
  const peer = await createPeer(true);
  for (const track of state.stream.getTracks()) {
    if (track.kind === "video") track.contentHint = "detail";
    peer.addTrack(track, state.stream);
  }
  await sendOffer(peer);
});
socket.on("viewer-approved", async ({ code, permissions, resumeToken, deviceName }) => {
  if (state.code !== code || state.role !== "viewer") { socket.emit("end-session", { code }); return; }
  state.resumeToken = resumeToken;
  state.permissions = permissions;
  setPending(false);
  enterSession("viewer", deviceName || "Ordinateur distant");
  await createPeer(false);
  for (const data of earlySignals.splice(0)) await handleSignal(data).catch(() => {});
});
socket.on("viewer-denied", ({ reason }) => { if (state.role === "viewer") { state.code = null; state.role = null; showError(reason); } });
socket.on("host-unavailable", ({ reason }) => toast(reason));
socket.on("peer-reconnecting", () => { $("sessionState").textContent = "Reconnexion de l’autre appareil…"; });
socket.on("peer-resumed", async () => {
  $("sessionState").textContent = "Connecté";
  if (state.peer && state.role === "host") await sendOffer(state.peer, true).catch(() => {});
});
socket.on("resume-denied", () => {
  if (state.peer && ["connected", "connecting"].includes(state.peer.connectionState)) return toast("Le serveur a redémarré : l’image continue, le chat reviendra à la prochaine session.");
  endSession(false, "La session a expiré.");
});
socket.on("permissions-state", (permissions) => { state.permissions = permissions; updateTools(); toast(permissions.control ? "Autorisations mises à jour." : "Le contrôle n’est pas autorisé."); });
socket.on("signal", ({ data }) => handleSignal(data).catch(() => toast("La négociation de la connexion a échoué.")));
socket.on("chat-message", ({ text }) => addMessage(text, false));
socket.on("clipboard-share", ({ text }) => { $("clipboard").value = text; toast("Texte reçu dans le panneau Presse-papiers."); });
socket.on("file-offer", ({ id, name, size, direct }) => {
  state.pendingFileOffer = { id, name, size, direct: Boolean(direct) };
  $("fileOfferText").textContent = `${name} · ${formatBytes(size)}`;
  $("fileDialog").showModal();
});
socket.on("file-decision", async ({ id, accepted }) => {
  const file = $("file").files[0];
  if (!accepted || !file || id !== `${file.name}:${file.size}`) { $("fileStatus").textContent = "Le fichier a été refusé."; return; }
  if (state.channels["file-transfer"]?.readyState === "open") { $("fileStatus").textContent = ""; await streamFile(file, id); return; }
  if (file.size > MAX_FILE_SIZE) { $("fileStatus").textContent = "Liaison directe indisponible : 25 Mo maximum."; return; }
  $("fileStatus").textContent = "Envoi…";
  socket.emit("file-data", { code: state.code, id, name: file.name, type: file.type, size: file.size, data: await file.arrayBuffer() });
  $("fileStatus").textContent = `${file.name} envoyé.`;
});
socket.on("file-data", ({ name, type, data }) => {
  const url = URL.createObjectURL(new Blob([data], { type: type || "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name || "fichier";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  $("fileStatus").textContent = `${name} téléchargé.`;
  toast(`Fichier reçu : ${name}`);
});
socket.on("session-ended", () => {
  if (state.peer) endSession(false, "L’autre personne a mis fin à la session.");
  else if (state.role === "host") { resetHost(); state.code = null; }
});

/* ---------- Interface ---------- */

$("openViewer").onclick = () => { showPanel("connectPanel"); $("code").focus(); };
$("openHost").onclick = () => showPanel("hostPanel");
$$("[data-back]").forEach((button) => { button.onclick = () => { if (state.code) socket.emit("end-session", { code: state.code }); state.code = null; state.role = null; resetHost({ stopStream: true }); setPending(false); showPanel("modePanel"); }; });
$("code").oninput = (event) => { event.target.value = formatCode(event.target.value); };
$("connectForm").onsubmit = requestConnection;
$("cancelConnect").onclick = () => { state.code = null; state.role = null; setPending(false); };
$("selectDisplay").onclick = chooseDisplay;
$("generateHostCode").onclick = createHostCode;
$("regenerateHostCode").onclick = createHostCode;
$("copyHostCode").onclick = () => navigator.clipboard.writeText(state.code || "").then(() => toast("Code copié."));
$("stopHosting").onclick = () => { if (state.code) socket.emit("end-session", { code: state.code }); state.code = null; state.role = null; resetHost({ stopStream: true }); toast("Partage arrêté."); };
let decided = false;
$("requestDialog").addEventListener("close", () => {
  if (!decided && state.pendingViewer) socket.emit("host-decision", { viewerSocketId: state.pendingViewer.id, approved: false });
  decided = false;
});
$("deny").onclick = () => $("requestDialog").close();
$("accept").onclick = () => {
  decided = true;
  state.permissions = hostPermissions();
  socket.emit("host-decision", { viewerSocketId: state.pendingViewer.id, approved: true, permissions: state.permissions });
  $("requestDialog").close();
};

$("toggleControl").onclick = () => { state.inputPaused = !state.inputPaused; updateTools(); if (!state.inputPaused) video.focus(); };
function toggleMenu(menu, button) {
  const open = $(menu).hidden;
  for (const [other, otherButton] of [["keysMenu", "keysButton"], ["screensMenu", "screensButton"]]) { $(other).hidden = true; $(otherButton).setAttribute("aria-expanded", "false"); }
  $(menu).hidden = !open;
  $(button).setAttribute("aria-expanded", String(open));
}
$("keysButton").onclick = () => toggleMenu("keysMenu", "keysButton");
$("screensButton").onclick = () => toggleMenu("screensMenu", "screensButton");
$("toggleSound").onclick = () => { setSound(video.muted); video.play().catch(() => {}); };
$("tapToPlay").onclick = () => { video.play().then(() => { $("tapToPlay").hidden = true; }).catch(() => {}); };
$$("[data-combo]").forEach((button) => {
  button.onclick = () => {
    sendPayload({ type: "keydown", ctrl: false, shift: false, alt: false, meta: false, ...COMBOS[button.dataset.combo] });
    $("keysMenu").hidden = true;
    $("keysButton").setAttribute("aria-expanded", "false");
    video.focus();
  };
});
document.addEventListener("click", (event) => { if (!event.target.closest(".menu-wrap")) { $("keysMenu").hidden = true; $("screensMenu").hidden = true; } });
$("zoomFit").onclick = () => setZoom(0);
$("zoomLabel").onclick = () => setZoom(1);
$("zoomIn").onclick = () => setZoom(Math.min(2.5, (state.zoom || 1) + 0.25));
$("zoomOut").onclick = () => setZoom(Math.max(0.25, (state.zoom || 1) - 0.25));
$("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("stage").requestFullscreen()).catch(() => {});
$("leave").onclick = () => endSession(true, "Vous avez quitté la session.");
$$("[data-panel]").forEach((button) => { button.onclick = () => openSide(button.dataset.panel); });
$("closeSide").onclick = closeSide;
$("chatForm").onsubmit = (event) => {
  event.preventDefault();
  const text = $("message").value.trim();
  if (!text || !state.code) return;
  socket.emit("chat-message", { code: state.code, text });
  addMessage(text, true);
  $("message").value = "";
};
$("file").onchange = () => { const file = $("file").files[0]; $("fileLabel").textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "Choisir un fichier"; };
$("sendFile").onclick = () => {
  const file = $("file").files[0];
  if (!file) return toast("Choisissez d’abord un fichier.");
  const direct = state.channels["file-transfer"]?.readyState === "open";
  if (file.size > (direct ? MAX_DIRECT_FILE_SIZE : MAX_FILE_SIZE)) return toast(`Le fichier dépasse ${direct ? "2 Go" : "25 Mo"}.`);
  if (state.transferOut) return toast("Un envoi est déjà en cours.");
  socket.emit("file-offer", { code: state.code, id: `${file.name}:${file.size}`, name: file.name, type: file.type, size: file.size, direct });
  $("fileStatus").textContent = "En attente de l’accord de l’autre personne…";
};
const decideFile = (accepted) => {
  const offer = state.pendingFileOffer;
  if (!offer) return;
  if (accepted && !offer.direct && offer.size > MAX_FILE_SIZE) accepted = false;
  if (accepted && offer.direct) state.transferIn = { id: offer.id, name: offer.name, size: offer.size, received: 0, chunks: [], startedAt: performance.now() };
  socket.emit("file-decision", { code: state.code, id: offer.id, accepted });
  $("fileStatus").textContent = accepted ? "Réception…" : "Fichier refusé.";
  state.pendingFileOffer = null;
  $("fileDialog").close();
};
$("acceptFile").onclick = () => decideFile(true);
$("rejectFile").onclick = () => decideFile(false);
$("pasteClipboard").onclick = () => navigator.clipboard.readText().then((text) => { $("clipboard").value = text; }).catch(() => toast("Le navigateur a refusé l’accès au presse-papiers."));
$("copyClipboard").onclick = () => navigator.clipboard.writeText($("clipboard").value).then(() => toast("Texte copié."));
$("sendClipboard").onclick = () => {
  if (!$("clipboard").value) return toast("Le texte est vide.");
  socket.emit("clipboard-share", { code: state.code, text: $("clipboard").value });
  toast("Texte envoyé.");
};

/* ---------- Compatibilité ---------- */

if (!platform.displayCapture) {
  $("openHost").disabled = true;
  $("capabilityNotice").textContent = "Ce navigateur ne permet pas de montrer son écran. Vous pouvez quand même aider quelqu’un.";
}
if (!signalUrl) {
  // Sans serveur public, aucune session ne peut aboutir : on le dit clairement.
  setStatus("Serveur public à configurer");
  $("capabilityNotice").textContent = "Le serveur de connexion n’est pas encore configuré : utilisez l’application Windows en attendant.";
  $("capabilityNotice").className = "notice warn";
  $("openHost").disabled = true;
  $("openViewer").disabled = true;
}
// Lien ou QR code « ?code=123456789 » : on se connecte directement.
const linkedCode = new URLSearchParams(location.search).get("code")?.replace(/\D/g, "");
if (linkedCode?.length === 9 && signalUrl) {
  history.replaceState(null, "", location.pathname);
  showPanel("connectPanel");
  $("code").value = formatCode(linkedCode);
  const go = () => $("connectForm").requestSubmit();
  if (socket.connected) go(); else { setPending(true, "Connexion au serveur…", "Le serveur peut mettre jusqu’à une minute à démarrer."); socket.once("connect", () => { setPending(false); go(); }); }
}

// Téléphone : un toucher = un clic ; « Taper » ouvre le clavier et envoie les caractères.
let touchStart = null;
video.addEventListener("touchstart", (event) => {
  if (!canControl() || event.touches.length !== 1) return;
  event.preventDefault();
  const touch = event.touches[0];
  touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  sendPayload({ type: "mousemove", ...videoPoint(touch) });
}, { passive: false });
video.addEventListener("touchmove", (event) => {
  if (!canControl() || !touchStart || event.touches.length !== 1) return;
  event.preventDefault();
  const touch = event.touches[0];
  if (!touchStart.dragging && Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 12) {
    touchStart.dragging = true;
    sendPayload({ type: "mousedown", ...videoPoint({ clientX: touchStart.x, clientY: touchStart.y }), button: 0 });
  }
  sendPayload({ type: "mousemove", ...videoPoint(touch) });
}, { passive: false });
video.addEventListener("touchend", (event) => {
  if (!canControl() || !touchStart) return;
  event.preventDefault();
  const touch = event.changedTouches[0];
  const point = videoPoint(touch);
  const longPress = !touchStart.dragging && Date.now() - touchStart.at > 550;
  if (!touchStart.dragging) sendPayload({ type: "mousedown", ...point, button: longPress ? 2 : 0 });
  sendPayload({ type: "mouseup", ...point, button: longPress ? 2 : 0 });
  touchStart = null;
}, { passive: false });
$("mobileKeyboard").onclick = () => { $("mobileInput").value = ""; $("mobileInput").focus(); };
$("mobileInput").addEventListener("input", (event) => {
  const text = event.target.value;
  for (const char of [...text]) sendPayload({ type: "keydown", key: char, code: "", ctrl: false, shift: false, alt: false, meta: false });
  event.target.value = "";
});
$("mobileInput").addEventListener("keydown", (event) => {
  if (["Backspace", "Enter", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    sendPayload({ type: "keydown", key: event.key, code: event.key, ctrl: false, shift: false, alt: false, meta: false });
  }
});

if (!window.RTCPeerConnection || !window.WebSocket) {
  setStatus("Navigateur incompatible");
  $("openHost").disabled = true;
  $("openViewer").disabled = true;
}
