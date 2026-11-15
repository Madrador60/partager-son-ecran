import { captureDisplay } from "./shared/capabilities.js";

const bridge = window.remoteAssist;
const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const KEYS = { server: "madrador.server", history: "madrador.history", recents: "madrador.recents", prefs: "madrador.prefs" };
const MAX_FILE_SIZE = 25 * 1024 * 1024; // via le serveur (ancien protocole)
const MAX_DIRECT_FILE_SIZE = 2 * 1024 ** 3; // en direct entre les deux PC
const CHUNK_SIZE = 64 * 1024;
// Profils réellement appliqués à l'encodeur WebRTC de l'hôte.
const QUALITY = {
  sharp: { maxBitrate: 8_000_000, maxFramerate: 30, hint: "detail", degradation: "maintain-resolution" },
  smooth: { maxBitrate: 6_000_000, maxFramerate: 60, hint: "motion", degradation: "maintain-framerate" },
  eco: { maxBitrate: 1_500_000, maxFramerate: 15, hint: "detail", degradation: "balanced" }
};
// Raccourcis que le PC de l'aidant intercepterait lui-même : envoyés explicitement.
const COMBOS = {
  win: { key: "Meta", code: "MetaLeft", meta: true },
  alttab: { key: "Tab", code: "Tab", alt: true },
  taskmgr: { key: "Escape", code: "Escape", ctrl: true, shift: true },
  desktop: { key: "d", code: "KeyD", meta: true },
  explorer: { key: "e", code: "KeyE", meta: true },
  altf4: { key: "F4", code: "F4", alt: true },
  lock: { key: "l", code: "KeyL", meta: true }
};

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const prefs = Object.assign({
  theme: "system",
  quality: "sharp",
  duration: 0,
  permissions: { control: true, clipboard: true, files: false },
  shareAudio: false,
  notifications: true,
  launchAtStartup: false
}, readJson(KEYS.prefs, {}));
const savePrefs = () => writeJson(KEYS.prefs, prefs);

const state = {
  socket: null,
  serverUrl: "",
  info: null,
  role: null, // "host" | "viewer"
  peer: null,
  stream: null,
  sourceName: "",
  sourceId: null,
  selectedBounds: null,
  screens: [],
  transferOut: null,
  transferIn: null,
  hostCode: null,
  remoteCode: null,
  resumeToken: null,
  pendingViewer: null,
  pendingViewerName: "",
  peerName: "",
  permissions: { control: false, clipboard: false, files: false },
  candidateQueue: [],
  channels: {},
  incomingFile: null,
  pendingFileOffer: null,
  available: true,
  inputPaused: false,
  zoom: 0, // 0 = ajusté à la fenêtre
  sidePanel: null,
  sessionStartedAt: 0,
  timers: {},
  update: { status: "idle" }
};

/* ---------- Utilitaires d'interface ---------- */

function notify(message, type = "info", title = "Madrador Remote") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<svg class="i"><use href="#i-${type === "error" ? "alert" : type === "success" ? "check" : "shield"}"/></svg>`;
  const content = document.createElement("div");
  const heading = document.createElement("b");
  const detail = document.createElement("small");
  heading.textContent = title;
  detail.textContent = message;
  content.append(heading, detail);
  toast.append(content);
  $("toasts").append(toast);
  while ($("toasts").children.length > 4) $("toasts").firstElementChild.remove();
  setTimeout(() => toast.remove(), 5000);
}

function systemNotify(title, body) {
  if (prefs.notifications && !document.hasFocus()) bridge.showNotification({ title, body }).catch(() => {});
}

function showView(id) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${id}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === id));
}

function formatCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds % 3600 / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatBytes(bytes) {
  if (!bytes) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

function initials(name) {
  return String(name || "PC").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "PC";
}

function isLocalServer(value) {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname); } catch { return true; }
}

function applyTheme() {
  if (prefs.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = prefs.theme;
}

function sessionCode() {
  return state.role === "viewer" ? state.remoteCode : state.hostCode;
}

/* ---------- Historique et récents ---------- */

function addHistory(entry) {
  const history = readJson(KEYS.history, []);
  history.unshift({ id: crypto.randomUUID(), date: new Date().toISOString(), ...entry });
  writeJson(KEYS.history, history.slice(0, 100));
  renderHistory();
}

function renderHistory() {
  const query = $("historySearch").value.replace(/\s/g, "").toLowerCase();
  const filter = $("historyFilter").value;
  const history = readJson(KEYS.history, []).filter((item) =>
    (!query || `${item.code || ""}${item.device || ""}`.replace(/\s/g, "").toLowerCase().includes(query)) &&
    (filter === "all" || item.status === filter));
  $("historyRows").replaceChildren();
  $("historyEmpty").hidden = history.length > 0;
  for (const item of history) {
    const row = document.createElement("tr");
    for (const value of [item.device || formatCode(item.code), new Date(item.date).toLocaleString("fr-FR"), item.duration || "—", item.type || "—"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const statusCell = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `chip${item.status === "failed" ? " failed" : ""}`;
    chip.textContent = item.status === "failed" ? "Échouée" : "Terminée";
    statusCell.append(chip);
    const actionCell = document.createElement("td");
    if (item.type === "Sortante" && item.code) {
      const retry = document.createElement("button");
      retry.className = "btn ghost";
      retry.type = "button";
      retry.textContent = "Reconnecter";
      retry.onclick = () => { $("remoteCode").value = formatCode(item.code); showView("home"); $("remoteCode").focus(); };
      actionCell.append(retry);
    }
    row.append(statusCell, actionCell);
    $("historyRows").append(row);
  }
}

function rememberRecent(code) {
  const recents = readJson(KEYS.recents, []).filter((item) => item.code !== code);
  recents.unshift({ code, at: new Date().toISOString() });
  writeJson(KEYS.recents, recents.slice(0, 6));
  renderRecents();
}

function renderRecents() {
  const recents = readJson(KEYS.recents, []);
  $("recentList").replaceChildren();
  $("clearRecents").hidden = recents.length === 0;
  if (!recents.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Les codes utilisés récemment apparaîtront ici.";
    $("recentList").append(empty);
    return;
  }
  for (const item of recents) {
    const li = document.createElement("li");
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = formatCode(item.code);
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = item.at ? relativeTime(item.at) : "";
    const use = document.createElement("button");
    use.className = "btn ghost";
    use.type = "button";
    use.textContent = "Utiliser";
    use.onclick = () => { $("remoteCode").value = formatCode(item.code); $("remoteCode").focus(); };
    li.append(code, when, use);
    $("recentList").append(li);
  }
}

/* ---------- Partage (hôte) ---------- */

function hostPermissions() {
  return { control: $("permControl").checked, clipboard: $("permClipboard").checked, files: $("permFiles").checked };
}

async function openSourcePicker() {
  const sources = await bridge.listSources();
  const render = (kind) => {
    $$("[data-source-tab]").forEach((tab) => {
      const active = tab.dataset.sourceTab === kind;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("sourceGrid").replaceChildren();
    const list = sources.filter((source) => source.id.startsWith(`${kind}:`));
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = kind === "screen" ? "Aucun écran détecté." : "Aucune fenêtre ouverte.";
      $("sourceGrid").append(empty);
    }
    list.forEach((source, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const image = document.createElement("img");
      image.src = source.thumbnail;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = kind === "screen"
        ? `${source.display?.primary ? "Écran principal" : `Écran ${index + 1}`}${source.display ? ` · ${source.display.resolution.width}×${source.display.resolution.height}` : ""}`
        : source.name;
      button.append(image, label);
      button.onclick = () => selectSource(source, label.textContent).catch((error) => notify(error.message, "error", "Capture impossible"));
      $("sourceGrid").append(button);
    });
  };
  $$("[data-source-tab]").forEach((tab) => { tab.onclick = () => render(tab.dataset.sourceTab); });
  render("screen");
  $("sourceDialog").showModal();
}

async function selectSource(source, label) {
  const stream = await captureDisplay({ bridge, sourceId: source.id, audio: prefs.shareAudio && source.id.startsWith("screen:") });
  const previous = state.stream;
  state.stream = stream;
  state.sourceName = label;
  state.sourceId = source.id;
  state.lastSource = source;
  state.selectedBounds = source.bounds;
  $("sourcePreview").srcObject = stream;
  $("sourcePreview").hidden = false;
  $("sourceEmpty").hidden = true;
  $("chooseSource").classList.add("has-source");
  $("sourceName").textContent = `${label} · cliquez pour changer`;
  if ($("sourceDialog").open) $("sourceDialog").close();
  // Si une session est déjà en cours, remplacer les pistes sans renégocier.
  if (state.peer) {
    for (const kind of ["video", "audio"]) {
      const transceiver = state.peer.getTransceivers().find((item) => item.receiver.track?.kind === kind);
      const track = stream.getTracks().find((item) => item.kind === kind) || null;
      if (transceiver) await transceiver.sender.replaceTrack(track);
    }
    $("localVideo").srcObject = stream;
    await bridge.setControlEnabled({ enabled: state.permissions.control, bounds: state.selectedBounds });
    applyQuality();
    sendScreens();
  }
  previous?.getTracks().forEach((track) => track.stop());
}

// Liste des écrans envoyée à l'aidant pour qu'il puisse changer d'écran lui-même.
async function sendScreens() {
  const channel = state.channels.commands;
  if (state.role !== "host" || channel?.readyState !== "open") return;
  const sources = await bridge.listSources().catch(() => []);
  state.screens = sources.filter((source) => source.id.startsWith("screen:")).map((source, index) => ({
    id: source.id,
    bounds: source.bounds,
    label: `${source.display?.primary ? "Écran principal" : `Écran ${index + 1}`}${source.display ? ` · ${source.display.resolution.width}×${source.display.resolution.height}` : ""}`
  }));
  channel.send(JSON.stringify({ type: "screens", current: state.sourceId, screens: state.screens.map(({ id, label }) => ({ id, label })) }));
}

async function handleCommand(message) {
  if (message.type === "select-screen") {
    if (!state.permissions.control) return;
    const screen = state.screens.find((item) => item.id === message.id);
    if (screen) await selectSource(screen, screen.label).catch((error) => notify(error.message, "error", "Changement d’écran impossible"));
    return;
  }
  await bridge.sendRemoteInput(message);
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
      $("remoteVideo").focus();
    };
    $("screensMenu").append(button);
  }
}

function createHostCode() {
  if (!state.stream) {
    notify("Choisissez d’abord l’écran à partager.", "error");
    openSourcePicker().catch((error) => notify(error.message, "error"));
    return;
  }
  if (!state.socket?.connected) return notify("Le serveur de connexion est injoignable pour le moment.", "error");
  state.permissions = hostPermissions();
  state.socket.emit("host-create", {
    deviceName: state.info.hostname,
    permissions: state.permissions,
    durationMinutes: Number($("durationSelect").value),
    available: state.available
  });
}

function showHostWaiting(code, expiresAt) {
  $("hostSetup").hidden = true;
  $("hostWaiting").hidden = false;
  $("hostCode").textContent = formatCode(code);
  $("hostWaitingText").textContent = state.available ? "En attente d’une demande de connexion…" : "Indisponible : les demandes sont refusées.";
  clearInterval(state.timers.code);
  if (!expiresAt) {
    $("codeValidity").textContent = "Valable sans limite";
    return;
  }
  const tick = () => {
    const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    $("codeValidity").textContent = remaining ? `Expire dans ${formatDuration(remaining).replace(/^00:/, "")}` : "Code expiré";
    if (!remaining) clearInterval(state.timers.code);
  };
  tick();
  state.timers.code = setInterval(tick, 1000);
}

function resetHostCard({ keepStream = true } = {}) {
  clearInterval(state.timers.code);
  state.hostCode = null;
  bridge.setHostCode("");
  $("hostSetup").hidden = false;
  $("hostWaiting").hidden = true;
  if (!keepStream) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    $("sourcePreview").srcObject = null;
    $("sourcePreview").hidden = true;
    $("sourceEmpty").hidden = false;
    $("chooseSource").classList.remove("has-source");
    $("sourceName").textContent = "";
  }
}

function stopHosting() {
  if (state.hostCode) state.socket.emit("end-session", { code: state.hostCode });
  resetHostCard({ keepStream: false });
  notify("Le partage est arrêté.");
}

/* ---------- Connexion (aidant) ---------- */

function setViewerPending(pending, title = "Demande envoyée", text = "La personne doit accepter sur son ordinateur.") {
  $("viewerPending").hidden = !pending;
  $("connectForm").hidden = pending;
  $("viewerPendingTitle").textContent = title;
  $("viewerPendingText").textContent = text;
}

function requestConnection(event) {
  event.preventDefault();
  const code = $("remoteCode").value.replace(/\D/g, "");
  if (code.length !== 9) return notify("Le code contient 9 chiffres.", "error");
  if (code === state.hostCode) return notify("C’est le code de cet ordinateur : saisissez celui de votre ami.", "error");
  if (!state.socket?.connected) return notify("Le serveur de connexion est injoignable pour le moment.", "error");
  if (state.peer) return notify("Une session est déjà en cours.", "error");
  state.remoteCode = code;
  state.socket.emit("viewer-request", { code, deviceName: state.info.hostname });
  rememberRecent(code);
  setViewerPending(true);
}

function cancelConnection() {
  // Le serveur ne connaît pas d'annulation : une approbation tardive sera refermée aussitôt.
  state.remoteCode = null;
  setViewerPending(false);
}

/* ---------- WebRTC ---------- */

async function flushCandidates() {
  if (!state.peer?.remoteDescription) return;
  for (const candidate of state.candidateQueue.splice(0)) {
    try { await state.peer.addIceCandidate(candidate); } catch (error) { console.warn(error); }
  }
}

async function applyQuality(peer = state.peer) {
  if (!peer || state.role !== "host") return;
  const profile = QUALITY[prefs.quality] || QUALITY.sharp;
  for (const sender of peer.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    sender.track.contentHint = profile.hint;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) continue;
    parameters.encodings[0].maxBitrate = profile.maxBitrate;
    parameters.encodings[0].maxFramerate = profile.maxFramerate;
    parameters.degradationPreference = profile.degradation;
    await sender.setParameters(parameters).catch(() => {});
  }
}

async function sendOffer(peer, iceRestart = false) {
  const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
  await peer.setLocalDescription(offer);
  state.socket.emit("signal", { code: sessionCode(), data: { type: "offer", sdp: peer.localDescription } });
}

async function createPeer(isHost) {
  const iceServers = await bridge.getIceServers(state.serverUrl);
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  state.peer = peer;
  state.channels = {};
  state.candidateQueue = [];

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) state.socket.emit("signal", { code: sessionCode(), data: { type: "candidate", candidate } });
  };
  peer.onconnectionstatechange = () => {
    const labels = { new: "Préparation…", connecting: "Connexion…", connected: "Connecté", disconnected: "Connexion instable…", failed: "Reconnexion…", closed: "Terminé" };
    setSessionStatus(labels[peer.connectionState] || peer.connectionState);
    if (peer.connectionState === "connected" && !state.sessionStartedAt) {
      state.sessionStartedAt = Date.now();
      startSessionTimer();
      bridge.setSessionActive(true);
      $("sessionLive").hidden = false;
      monitorStats(peer);
      applyQuality(peer);
      notify(isHost ? "Votre écran est maintenant partagé." : "Vous voyez l’écran distant.", "success", "Connexion établie");
    }
    if (peer.connectionState === "failed") {
      peer.restartIce();
      if (isHost) sendOffer(peer, true).catch((error) => console.warn(error));
    }
  };
  if (!isHost) {
    // Un seul flux local regroupe l'image et le son, quel que soit l'ordre d'arrivée.
    const remoteStream = new MediaStream();
    $("remoteVideo").srcObject = remoteStream;
    peer.ontrack = ({ track }) => {
      remoteStream.addTrack(track);
      if (track.kind === "audio") {
        track.onunmute = () => { $("toggleSound").hidden = false; };
        return;
      }
      $("stageOverlay").hidden = true;
      updateControlUi();
      $("remoteVideo").focus();
    };
  }
  const bindChannel = (channel) => {
    state.channels[channel.label] = channel;
    channel.binaryType = "arraybuffer";
    if (channel.label === "commands" && isHost) channel.onopen = () => sendScreens();
    channel.onmessage = async ({ data }) => {
      try {
        if (channel.label === "input-fast" || channel.label === "commands") {
          const message = JSON.parse(data);
          if (state.role === "host") await handleCommand(message);
          else if (message.type === "screens") renderScreens(message);
        } else if (channel.label === "file-transfer") {
          await receiveFileChunk(data);
        }
      } catch (error) { console.warn(error); }
    };
  };
  peer.ondatachannel = ({ channel }) => bindChannel(channel);
  if (isHost) {
    bindChannel(peer.createDataChannel("input-fast", { ordered: false, maxRetransmits: 0 }));
    bindChannel(peer.createDataChannel("commands", { ordered: true }));
    bindChannel(peer.createDataChannel("file-transfer", { ordered: true }));
  }
  return peer;
}

/* ---------- Fichiers ---------- */

function showProgress(name, done, total, startedAt, verb) {
  $("fileProgress").hidden = false;
  $("fileProgressName").textContent = name;
  const percent = total ? Math.floor(done / total * 100) : 0;
  $("fileProgressPercent").textContent = `${percent} %`;
  $("fileProgressBar").value = percent;
  const seconds = Math.max(0.5, (performance.now() - startedAt) / 1000);
  const speed = done / seconds;
  const remaining = speed > 0 ? Math.ceil((total - done) / speed) : 0;
  const eta = done < total ? ` · ${remaining < 60 ? `${remaining} s` : `${Math.ceil(remaining / 60)} min`} restantes` : "";
  $("fileProgressDetail").textContent = `${verb} ${formatBytes(done)} sur ${formatBytes(total)} · ${formatBytes(speed)}/s${eta}`;
}

function finishTransfer(message, path = null) {
  $("fileProgress").hidden = true;
  $("fileStatus").textContent = message;
  $("showReceivedFile").hidden = !path;
  $("showReceivedFile").dataset.path = path || "";
}

async function streamFile(file, id) {
  const channel = state.channels["file-transfer"];
  const transfer = { id, cancelled: false };
  state.transferOut = transfer;
  const startedAt = performance.now();
  channel.bufferedAmountLowThreshold = 1024 * 1024;
  channel.send(JSON.stringify({ type: "start", id, name: file.name, size: file.size }));
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    if (transfer.cancelled || channel.readyState !== "open") {
      state.transferOut = null;
      return finishTransfer("Envoi interrompu.");
    }
    if (channel.bufferedAmount > 8 * 1024 * 1024) await new Promise((resolve) => { channel.onbufferedamountlow = resolve; });
    channel.send(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
    if (offset % (CHUNK_SIZE * 16) === 0) showProgress(file.name, offset, file.size, startedAt, "Envoyé");
  }
  channel.send(JSON.stringify({ type: "end", id }));
  state.transferOut = null;
  finishTransfer(`${file.name} envoyé (${formatBytes(file.size)}).`);
}

async function receiveFileChunk(data) {
  const transfer = state.transferIn;
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (!transfer || message.id !== transfer.offerId) return;
    if (message.type === "start") transfer.startedAt = performance.now();
    if (message.type === "end") {
      transfer.queue = transfer.queue.then(async () => {
        const result = await bridge.fileEnd({ transferId: transfer.transferId });
        if (state.transferIn === transfer) state.transferIn = null;
        if (result.ok) {
          finishTransfer(`Enregistré : ${result.path}`, result.path);
          notify(transfer.name, "success", "Fichier reçu");
        } else finishTransfer("Le fichier reçu est incomplet : il a été supprimé.");
      });
    }
    return;
  }
  if (!transfer) return;
  transfer.received += data.byteLength;
  const received = transfer.received;
  transfer.queue = transfer.queue.then(async () => {
    const result = await bridge.fileChunk({ transferId: transfer.transferId, data });
    if (!result.ok) throw new Error(result.error);
    if (received === transfer.size || received % (CHUNK_SIZE * 16) === 0) showProgress(transfer.name, received, transfer.size, transfer.startedAt, "Reçu");
  }).catch(() => {
    if (state.transferIn === transfer) state.transferIn = null;
    finishTransfer("Réception interrompue.");
  });
}

async function abortTransfers() {
  if (state.transferOut) state.transferOut.cancelled = true;
  if (state.transferIn) await bridge.fileAbort({ transferId: state.transferIn.transferId }).catch(() => {});
  state.transferIn = null;
  state.transferOut = null;
  $("fileProgress").hidden = true;
}

// Les messages arrivés avant la création de la connexion (récupération TURN en cours)
// sont gardés puis rejoués : sinon l'offre est perdue et la session reste bloquée.
const earlySignals = [];

async function drainEarlySignals() {
  for (const payload of earlySignals.splice(0)) await handleSignal(payload).catch((error) => console.warn(error));
}

async function handleSignal({ data }) {
  if (!state.peer) {
    if ((state.remoteCode || state.hostCode) && earlySignals.length < 200) earlySignals.push({ data });
    return;
  }
  if (data.type === "offer") {
    await state.peer.setRemoteDescription(data.sdp);
    await flushCandidates();
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    state.socket.emit("signal", { code: sessionCode(), data: { type: "answer", sdp: state.peer.localDescription } });
  } else if (data.type === "answer") {
    await state.peer.setRemoteDescription(data.sdp);
    await flushCandidates();
  } else if (data.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(data.candidate);
    else state.candidateQueue.push(data.candidate);
  }
}

/* ---------- Vue de session ---------- */

function setSessionStatus(text) {
  $("sessionStatus").textContent = text;
  $("hostSessionStatus").textContent = text;
}

function startSessionTimer() {
  clearInterval(state.timers.session);
  const tick = () => {
    const text = formatDuration(Math.floor((Date.now() - state.sessionStartedAt) / 1000));
    $("sessionTimer").textContent = text;
    $("hostSessionTimer").textContent = text;
  };
  tick();
  state.timers.session = setInterval(tick, 1000);
}

function enterSession(role) {
  state.role = role;
  state.sessionStartedAt = 0;
  $("sessionEmpty").hidden = true;
  $("viewerSession").hidden = role !== "viewer";
  $("hostSession").hidden = role !== "host";
  setSessionStatus("Connexion…");
  $("sessionTimer").textContent = "00:00:00";
  $("hostSessionTimer").textContent = "00:00:00";
  $("messages").replaceChildren();
  $("fileStatus").textContent = "";
  $("clipboardText").value = "";
  closeSidePanel();
  if (role === "viewer") {
    $("peerName").textContent = state.peerName || "Ordinateur distant";
    $("peerAvatar").textContent = initials(state.peerName);
    $("stageOverlay").hidden = false;
    $("stageOverlayText").textContent = "Connexion à l’écran distant…";
    state.inputPaused = false;
    $("screensWrap").hidden = true;
    $("toggleSound").hidden = true;
    setSound(true);
    setZoom(0);
  } else {
    $("hostPeerName").textContent = state.pendingViewerName || "un ordinateur";
    $("localVideo").srcObject = state.stream;
    syncLivePermissions();
  }
  updateToolAvailability();
  showView("session");
}

async function endSession({ notifyPeer = true, reason = "Session terminée." } = {}) {
  const code = sessionCode();
  const role = state.role;
  if (!role) return;
  if (notifyPeer && code) state.socket.emit("end-session", { code });
  await abortTransfers();
  clearInterval(state.timers.stats);
  clearInterval(state.timers.session);
  state.peer?.close();
  await bridge.setControlEnabled({ enabled: false, bounds: null }).catch(() => {});
  if (state.sessionStartedAt) {
    addHistory({
      code,
      device: role === "viewer" ? `${state.peerName || "Ordinateur"} · ${formatCode(code)}` : `${state.pendingViewerName || "Ordinateur"}`,
      duration: formatDuration(Math.floor((Date.now() - state.sessionStartedAt) / 1000)),
      type: role === "viewer" ? "Sortante" : "Entrante",
      status: "completed"
    });
  }
  earlySignals.length = 0;
  Object.assign(state, { peer: null, role: null, resumeToken: null, remoteCode: null, candidateQueue: [], channels: {}, incomingFile: null, sessionStartedAt: 0 });
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("viewerSession").hidden = true;
  $("hostSession").hidden = true;
  $("sessionEmpty").hidden = false;
  $("sessionLive").hidden = true;
  bridge.setSessionActive(false);
  setViewerPending(false);
  if (role === "host") resetHostCard({ keepStream: true });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  showView("home");
  notify(reason);
}

function updateToolAvailability() {
  const { clipboard, files } = state.permissions;
  $$('[data-panel="clipboard"]').forEach((button) => { button.disabled = !clipboard; });
  $$('[data-panel="files"]').forEach((button) => { button.disabled = !files; });
  if ((state.sidePanel === "clipboard" && !clipboard) || (state.sidePanel === "files" && !files)) closeSidePanel();
  updateControlUi();
}

function updateControlUi() {
  const allowed = Boolean(state.permissions.control);
  const active = allowed && !state.inputPaused;
  $("toggleControl").disabled = !allowed;
  $("toggleControl").setAttribute("aria-pressed", String(active));
  $("toggleControl").title = allowed ? (active ? "Suspendre le contrôle" : "Reprendre le contrôle") : "L’autre personne n’a pas autorisé le contrôle";
  $("keysMenuButton").disabled = !active;
  $("stage").classList.toggle("no-control", !active);
  $("controlHint").hidden = !active || !$("stageOverlay").hidden;
  if ($("controlHint").hidden === false) setTimeout(() => { $("controlHint").hidden = true; }, 5000);
}

function syncLivePermissions() {
  $("livePermControl").checked = state.permissions.control;
  $("livePermClipboard").checked = state.permissions.clipboard;
  $("livePermFiles").checked = state.permissions.files;
}

async function applyLivePermissions() {
  state.permissions = { control: $("livePermControl").checked, clipboard: $("livePermClipboard").checked, files: $("livePermFiles").checked };
  state.socket.emit("set-permissions", { code: state.hostCode, permissions: state.permissions });
  await bridge.setControlEnabled({ enabled: state.permissions.control, bounds: state.selectedBounds });
  updateToolAvailability();
}

function openSidePanel(name) {
  if (state.sidePanel === name) return closeSidePanel();
  const container = state.role === "host" ? $("sidePanelHost") : $("sidePanelViewer");
  container.append($("sidePanel"));
  container.hidden = false;
  state.sidePanel = name;
  $("sideTitle").textContent = { chat: "Discussion", files: "Fichiers", clipboard: "Presse-papiers", stats: "Qualité de connexion" }[name];
  $$(".side-content").forEach((content) => { content.hidden = content.dataset.content !== name; });
  $$("[data-panel]").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  if (name === "chat") {
    $$('[data-panel="chat"] .unread').forEach((dot) => { dot.hidden = true; });
    $("messageInput").focus();
  }
}

function closeSidePanel() {
  state.sidePanel = null;
  $("sidePanelHost").hidden = true;
  $("sidePanelViewer").hidden = true;
  $$("[data-panel]").forEach((button) => button.classList.remove("active"));
}

function addMessage(text, mine = false) {
  if ($("messages").querySelector(".muted")) $("messages").replaceChildren();
  const bubble = document.createElement("div");
  bubble.className = `bubble${mine ? " mine" : ""}`;
  bubble.textContent = String(text).slice(0, 2000);
  $("messages").append(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
  if (!mine && state.sidePanel !== "chat") {
    $$('[data-panel="chat"] .unread').forEach((dot) => { dot.hidden = false; });
    notify(String(text).slice(0, 140), "info", "Nouveau message");
  }
}

function setSound(on) {
  $("remoteVideo").muted = !on;
  $("toggleSound").setAttribute("aria-pressed", String(on));
  $("toggleSound").querySelector("use").setAttribute("href", on ? "#i-volume" : "#i-mute");
}

function closeMenus(except = null) {
  for (const [menu, button] of [["keysMenu", "keysMenuButton"], ["screensMenu", "screensButton"]]) {
    if (menu === except) continue;
    $(menu).hidden = true;
    $(button).setAttribute("aria-expanded", "false");
  }
}

function toggleMenu(menu, button) {
  const open = $(menu).hidden;
  closeMenus(menu);
  $(menu).hidden = !open;
  $(button).setAttribute("aria-expanded", String(open));
  if (open) $(menu).querySelector("button")?.focus();
}

function setZoom(level) {
  state.zoom = level;
  const stage = $("stage");
  const video = $("remoteVideo");
  stage.classList.toggle("fit", level === 0);
  stage.classList.toggle("zoomed", level !== 0);
  $("zoomFit").setAttribute("aria-pressed", String(level === 0));
  $("zoomLabel").textContent = level === 0 ? "Ajusté" : `${Math.round(level * 100)} %`;
  if (level === 0) {
    video.style.width = "";
    video.style.height = "";
  } else if (video.videoWidth) {
    video.style.width = `${Math.round(video.videoWidth * level)}px`;
    video.style.height = `${Math.round(video.videoHeight * level)}px`;
  }
}

function monitorStats(peer) {
  clearInterval(state.timers.stats);
  let last = { bytes: 0, at: performance.now() };
  state.timers.stats = setInterval(async () => {
    if (peer.connectionState !== "connected") return;
    const report = await peer.getStats();
    let rtp = null;
    let pair = null;
    const byId = new Map();
    report.forEach((item) => {
      byId.set(item.id, item);
      if (item.type === "inbound-rtp" && item.kind === "video") rtp = item;
      if (item.type === "outbound-rtp" && item.kind === "video" && !rtp) rtp = item;
      if (item.type === "candidate-pair" && item.nominated && item.state === "succeeded") pair = item;
    });
    if (rtp) {
      const bytes = rtp.bytesReceived ?? rtp.bytesSent ?? 0;
      const now = performance.now();
      const mbps = Math.max(0, (bytes - last.bytes) * 8 / (now - last.at) / 1000);
      last = { bytes, at: now };
      $("statBitrate").textContent = `${mbps.toFixed(1)} Mb/s`;
      $("statResolution").textContent = rtp.frameWidth ? `${rtp.frameWidth}×${rtp.frameHeight}` : "—";
      $("statFps").textContent = rtp.framesPerSecond ? String(Math.round(rtp.framesPerSecond)) : "—";
    }
    if (pair) {
      const rtt = Math.round((pair.currentRoundTripTime || 0) * 1000);
      $("statLatency").textContent = `${rtt} ms`;
      const local = byId.get(pair.localCandidateId);
      const remote = byId.get(pair.remoteCandidateId);
      $("statRoute").textContent = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "Relais" : "Directe";
      $("statQuality").textContent = rtt < 80 ? "Excellente" : rtt < 180 ? "Bonne" : "Lente";
    }
  }, 1000);
}

/* ---------- Contrôle à distance (aidant) ---------- */

function videoPoint(event) {
  const video = $("remoteVideo");
  const rect = video.getBoundingClientRect();
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : rect.width / rect.height;
  let width = rect.width;
  let height = rect.height;
  if (width / height > ratio) width = height * ratio; else height = width / ratio;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - left) / width)),
    y: Math.max(0, Math.min(1, (event.clientY - top) / height))
  };
}

function canControl() {
  return state.role === "viewer" && state.permissions.control && !state.inputPaused && state.remoteCode;
}

function sendPayload(payload) {
  if (!canControl()) return;
  const channel = state.channels[payload.type === "mousemove" ? "input-fast" : "commands"];
  if (channel?.readyState === "open") channel.send(JSON.stringify(payload));
  else state.socket.emit("remote-input", { code: state.remoteCode, payload });
}

function bindRemoteInput() {
  const video = $("remoteVideo");
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
}

/* ---------- Socket.IO ---------- */

function bindSocket(socket) {
  socket.on("connect", () => {
    $("serverDot").className = "dot online";
    $("serverLabel").textContent = "Serveur connecté";
    // Reprise après une coupure réseau : en session, ou hôte en attente avec son code.
    if (state.resumeToken && state.role === "viewer" && state.remoteCode) socket.emit("resume-session", { code: state.remoteCode, resumeToken: state.resumeToken, role: "viewer" });
    else if (state.resumeToken && state.hostCode) socket.emit("resume-session", { code: state.hostCode, resumeToken: state.resumeToken, role: "host" });
  });
  socket.on("disconnect", () => {
    $("serverDot").className = "dot warn";
    $("serverLabel").textContent = "Reconnexion…";
  });
  socket.on("connect_error", () => {
    $("serverDot").className = "dot warn";
    $("serverLabel").textContent = "Serveur injoignable";
  });

  socket.on("host-created", ({ code, expiresAt, resumeToken }) => {
    state.hostCode = code;
    state.resumeToken = resumeToken;
    bridge.setHostCode(code);
    showHostWaiting(code, expiresAt);
  });
  socket.on("host-unavailable", ({ reason }) => notify(reason, "error", "Indisponible"));
  socket.on("session-expired", () => {
    if (state.role) return;
    resetHostCard({ keepStream: true });
    notify("Le code a expiré. Générez-en un nouveau si besoin.", "info", "Code expiré");
  });
  socket.on("incoming-request", ({ viewerSocketId, deviceName }) => {
    state.pendingViewer = viewerSocketId;
    state.pendingViewerName = deviceName || "Un ordinateur";
    $("requester").textContent = state.pendingViewerName;
    const defaults = hostPermissions();
    $("reqControl").checked = defaults.control;
    $("reqClipboard").checked = defaults.clipboard;
    $("reqFiles").checked = defaults.files;
    if (!$("requestDialog").open) $("requestDialog").showModal();
    bridge.focusWindow?.();
    systemNotify("Demande de connexion", `${state.pendingViewerName} souhaite voir votre écran.`);
  });
  socket.on("viewer-approved", async ({ code, permissions, resumeToken, deviceName }) => {
    if (state.remoteCode !== code) {
      // L'aidant a annulé entre-temps : on referme proprement.
      socket.emit("end-session", { code });
      return;
    }
    state.resumeToken = resumeToken;
    state.permissions = permissions;
    state.peerName = deviceName || "Ordinateur distant";
    setViewerPending(false);
    await createPeer(false);
    await drainEarlySignals();
    enterSession("viewer");
  });
  socket.on("viewer-denied", ({ reason }) => {
    if (!state.remoteCode) return;
    addHistory({ code: state.remoteCode, device: formatCode(state.remoteCode), type: "Sortante", status: "failed" });
    state.remoteCode = null;
    setViewerPending(false);
    notify(reason, "error", "Connexion refusée");
  });
  socket.on("viewer-ready", async () => {
    if (!state.stream) return notify("Aucun écran sélectionné.", "error");
    enterSession("host");
    const peer = await createPeer(true);
    for (const track of state.stream.getTracks()) {
      if (track.kind === "video") track.contentHint = (QUALITY[prefs.quality] || QUALITY.sharp).hint;
      peer.addTrack(track, state.stream);
    }
    // Emplacement audio réservé : le son pourra être ajouté plus tard sans renégocier.
    if (!state.stream.getAudioTracks().length) peer.addTransceiver("audio", { direction: "sendonly", streams: [state.stream] });
    await sendOffer(peer);
  });
  socket.on("peer-reconnecting", () => setSessionStatus("Reconnexion de l’autre ordinateur…"));
  socket.on("peer-resumed", async () => {
    setSessionStatus("Connecté");
    if (state.peer && state.role === "host") await sendOffer(state.peer, true).catch((error) => console.warn(error));
  });
  socket.on("session-resumed", () => setSessionStatus("Connecté"));
  socket.on("resume-denied", () => {
    // Serveur redémarré : la liaison directe peut continuer sans lui.
    if (state.peer && ["connected", "connecting"].includes(state.peer.connectionState)) {
      notify("Le serveur a redémarré. L’écran et le contrôle continuent ; le chat et les fichiers reviendront à la prochaine session.", "info", "Session maintenue");
      return;
    }
    if (!state.role && state.hostCode) {
      resetHostCard({ keepStream: true });
      notify("Le serveur a redémarré : générez un nouveau code.", "info", "Code expiré");
      return;
    }
    endSession({ notifyPeer: false, reason: "La session a expiré." });
  });
  socket.on("signal", (payload) => handleSignal(payload).catch((error) => notify(`Négociation impossible : ${error.message}`, "error")));
  socket.on("permissions-state", (permissions) => {
    const gainedControl = permissions.control && !state.permissions.control;
    state.permissions = permissions;
    updateToolAvailability();
    notify(gainedControl ? "Vous pouvez maintenant contrôler l’ordinateur." : permissions.control ? "Autorisations mises à jour." : "Le contrôle vous a été retiré.", "info", "Autorisations");
  });
  socket.on("remote-input", (payload) => { if (state.role === "host") bridge.sendRemoteInput(payload).catch(() => {}); });
  socket.on("chat-message", ({ text }) => addMessage(text));
  socket.on("clipboard-share", ({ text }) => {
    $("clipboardText").value = text;
    notify("Texte reçu dans le panneau Presse-papiers.", "success", "Presse-papiers");
  });
  socket.on("file-offer", ({ id, name, size, direct }) => {
    state.pendingFileOffer = { id, name, size, direct: Boolean(direct) };
    $("fileOfferText").textContent = `${name} · ${formatBytes(size)}`;
    $("fileDialog").showModal();
  });
  socket.on("file-decision", async ({ id, accepted }) => {
    const file = $("fileInput").files[0];
    if (!accepted || !file || id !== `${file.name}:${file.size}`) {
      $("fileStatus").textContent = "Le fichier a été refusé.";
      return;
    }
    if (state.channels["file-transfer"]?.readyState === "open") {
      $("fileStatus").textContent = "";
      await streamFile(file, id);
      return;
    }
    if (file.size > MAX_FILE_SIZE) { $("fileStatus").textContent = "Liaison directe indisponible : 25 Mo maximum."; return; }
    $("fileStatus").textContent = "Envoi en cours…";
    socket.emit("file-data", { code: sessionCode(), id, name: file.name, type: file.type, size: file.size, data: await file.arrayBuffer() });
    $("fileStatus").textContent = `${file.name} envoyé.`;
  });
  socket.on("file-data", async ({ name, data }) => {
    const result = await bridge.saveReceivedFile({ name, data });
    $("fileStatus").textContent = result.ok ? `Enregistré : ${result.path}` : "Enregistrement annulé.";
    if (result.ok) notify(name, "success", "Fichier reçu");
  });
  socket.on("session-ended", () => {
    if (state.role) endSession({ notifyPeer: false, reason: "L’autre personne a mis fin à la session." });
    else if (state.hostCode) resetHostCard({ keepStream: true });
  });
}

/* ---------- Mises à jour ---------- */

// Les notes GitHub sont en HTML : on n'en garde que le texte (DOMParser n'exécute rien).
function plainText(html) {
  return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "";
}

function updateUpdater(data) {
  state.update = data;
  const labels = {
    idle: ["Mises à jour", "Vérification automatique au démarrage."],
    development: ["Mode développement", "Les mises à jour fonctionnent dans la version installée."],
    cached: ["Vérification récente", "La prochaine vérification aura lieu plus tard."],
    checking: ["Recherche en cours…", "Connexion au service de mises à jour."],
    available: [`Version ${data.version} disponible`, "Prête à être téléchargée."],
    current: ["Madrador Remote est à jour", `Version ${data.version || ""}`],
    downloading: ["Téléchargement…", `${data.percent || 0} %`],
    downloaded: [`Version ${data.version} prête`, "Installez maintenant ou au prochain redémarrage."],
    scheduled: ["Installation planifiée", "La mise à jour sera installée à la fermeture."],
    error: ["Mise à jour indisponible", "Réessayez plus tard."]
  };
  const [title, description] = labels[data.status] || labels.error;
  $("updateTitle").textContent = title;
  $("updateDescription").textContent = description;
  $("updateProgress").hidden = data.status !== "downloading";
  $("updateProgress").value = data.percent || 0;
  const notes = typeof data.notes === "string" ? data.notes : Array.isArray(data.notes) ? data.notes.map((note) => note.note || "").join("\n") : "";
  $("releaseNotes").textContent = plainText(notes).slice(0, 1500);
  const action = data.status === "available" ? "download" : data.status === "downloaded" ? "install" : "check";
  $("updateButton").dataset.action = action;
  $("updateButton").textContent = { download: "Télécharger", install: "Installer", check: "Rechercher" }[action];
  $("updateButton").disabled = ["checking", "downloading"].includes(data.status);

  if (["available", "downloading", "downloaded"].includes(data.status)) {
    if (!$("updateDialog").open && !state.role) $("updateDialog").showModal();
    $("updateDialogTitle").textContent = data.status === "downloaded" ? "Mise à jour prête" : data.status === "downloading" ? "Téléchargement…" : "Nouvelle version disponible";
    $("updateDialogDescription").textContent = data.status === "downloading" ? "Vous pouvez continuer à utiliser l’application." : `Madrador Remote ${data.version}`;
    $("updateDialogNotes").textContent = plainText(notes).slice(0, 1500);
    const downloading = data.status === "downloading";
    $("downloadMetrics").hidden = !downloading;
    $("updateDialogProgress").hidden = !downloading;
    $("updateDialogProgress").value = data.percent || 0;
    $("downloadPercent").textContent = `${data.percent || 0} %`;
    $("downloadSpeed").textContent = `${formatBytes(data.bytesPerSecond || 0)}/s`;
    $("downloadEta").textContent = data.secondsRemaining == null ? "…" : data.secondsRemaining < 60 ? `${data.secondsRemaining} s` : `${Math.floor(data.secondsRemaining / 60)} min`;
    $("integrityStatus").hidden = data.status !== "downloaded";
    $("integrityStatus").textContent = `Intégrité vérifiée (${data.integrity?.algorithm || "SHA-512"})`;
    $("updatePrimary").textContent = data.status === "downloaded" ? "Redémarrer et installer" : "Télécharger";
    $("updatePrimary").disabled = downloading;
    $("updateLater").textContent = data.status === "downloaded" ? "À la fermeture" : "Plus tard";
  }
}

/* ---------- Diagnostic ---------- */

async function renderDiagnostics() {
  const details = await bridge.systemInfo();
  const report = {
    generatedAt: new Date().toISOString(),
    application: { version: details.version, electron: details.electron, chromium: details.chromium, node: details.node },
    system: { platform: details.platform, release: details.platformRelease, memoryGb: Math.round(details.memoryBytes / 1024 ** 3), cpu: details.cpu, cpuCores: details.cpuCores, gpu: details.gpu, displays: details.displays },
    connection: {
      server: state.serverUrl ? new URL(state.serverUrl).host : null,
      localMode: isLocalServer(state.serverUrl),
      socketIo: state.socket?.connected ? "connected" : "disconnected",
      webrtc: state.peer?.connectionState || "inactive",
      ice: state.peer?.iceConnectionState || "inactive",
      route: $("statRoute").textContent
    }
  };
  $("diagnosticsReport").textContent = JSON.stringify(report, null, 2);
  return report;
}

/* ---------- Paramètres ---------- */

async function testServer(url) {
  // Testé par le processus principal : pas de restriction CORS depuis l'interface.
  const result = await bridge.testServer(new URL(url).origin);
  if (!result.ok) throw new Error(result.error);
  return result.ms;
}

function bindSettings() {
  $("serverUrl").value = localStorage.getItem(KEYS.server) || "";
  $("serverUrl").placeholder = state.serverUrl;
  $("testServer").onclick = async () => {
    const value = $("serverUrl").value.trim() || state.serverUrl;
    $("serverTestResult").className = "muted";
    $("serverTestResult").textContent = "Test en cours… (un serveur gratuit en veille peut mettre jusqu’à une minute à répondre)";
    try {
      const ms = await testServer(value);
      $("serverTestResult").className = "ok";
      $("serverTestResult").textContent = `✓ Serveur joignable (${ms} ms).`;
    } catch (error) {
      $("serverTestResult").className = "bad";
      $("serverTestResult").textContent = `✗ ${error.message || "Adresse injoignable."}`;
    }
  };
  $("saveServer").onclick = () => {
    const value = $("serverUrl").value.trim();
    if (!value) {
      try { localStorage.removeItem(KEYS.server); } catch {}
      return location.reload();
    }
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      if (state.role && !confirm("La session en cours sera interrompue. Continuer ?")) return;
      localStorage.setItem(KEYS.server, url.origin);
      location.reload();
    } catch { notify("Adresse de serveur invalide.", "error"); }
  };
  $("qualitySelect").value = prefs.quality;
  $("qualitySelect").onchange = () => { prefs.quality = $("qualitySelect").value; savePrefs(); applyQuality(); notify("Qualité d’image mise à jour.", "success"); };
  $("themeSelect").value = prefs.theme;
  $("themeSelect").onchange = () => { prefs.theme = $("themeSelect").value; savePrefs(); applyTheme(); };
  $("prefNotifications").checked = prefs.notifications;
  $("prefStartup").checked = prefs.launchAtStartup;
  const pushPrefs = () => bridge.setPreferences({ notifications: prefs.notifications, launchAtStartup: prefs.launchAtStartup }).catch(() => notify("Réglage non appliqué.", "error"));
  $("prefNotifications").onchange = () => { prefs.notifications = $("prefNotifications").checked; savePrefs(); pushPrefs(); };
  $("prefStartup").onchange = () => { prefs.launchAtStartup = $("prefStartup").checked; savePrefs(); pushPrefs(); };
  $("refreshDiagnostics").onclick = () => renderDiagnostics().catch(() => notify("Diagnostic indisponible.", "error"));
  $("exportDiagnostics").onclick = async () => {
    const report = await renderDiagnostics();
    const result = await bridge.saveReceivedFile({ name: `madrador-diagnostic-${Date.now()}.json`, data: new TextEncoder().encode(JSON.stringify(report, null, 2)) });
    if (result.ok) notify("Rapport exporté.", "success");
  };
  $("updateButton").onclick = () => bridge.updateAction($("updateButton").dataset.action || "check")
    .then((result) => { if (!result.ok) notify(result.error, "info"); })
    .catch(() => notify("Mise à jour momentanément indisponible.", "error"));
  $("updateLater").onclick = () => {
    if (state.update.status === "downloaded") bridge.updateAction("later");
    $("updateDialog").close();
  };
  $("updatePrimary").onclick = () => bridge.updateAction(state.update.status === "downloaded" ? "install" : "download").catch(() => notify("Mise à jour impossible pour le moment.", "error"));
}

/* ---------- Démarrage ---------- */

function bindUi() {
  $$("[data-view]").forEach((button) => { button.onclick = () => showView(button.dataset.view); });
  $("openConnectionSettings").onclick = () => { showView("settings"); $("serverUrl").focus(); };

  // Accueil — partage
  for (const [id, key] of [["permControl", "control"], ["permClipboard", "clipboard"], ["permFiles", "files"]]) {
    $(id).checked = Boolean(prefs.permissions[key]);
    $(id).onchange = () => { prefs.permissions[key] = $(id).checked; savePrefs(); };
  }
  $("durationSelect").value = String(prefs.duration);
  $("durationSelect").onchange = () => { prefs.duration = Number($("durationSelect").value); savePrefs(); };
  $("chooseSource").onclick = () => openSourcePicker().catch((error) => notify(error.message, "error"));
  $("createCode").onclick = createHostCode;
  $("newCode").onclick = createHostCode;
  $("stopHosting").onclick = stopHosting;
  $("copyCode").onclick = async () => {
    await navigator.clipboard.writeText(state.hostCode || "");
    notify("Code copié : envoyez-le à la personne qui vous aide.", "success");
  };
  $("availability").onclick = async () => {
    const available = $("availability").getAttribute("aria-pressed") !== "true";
    await bridge.setAvailability(available);
    setAvailability(available);
  };
  $$("[data-close]").forEach((button) => { button.onclick = () => button.closest("dialog").close(); });

  // Accueil — connexion
  $("remoteCode").oninput = (event) => { event.target.value = formatCode(event.target.value); };
  $("connectForm").onsubmit = requestConnection;
  $("cancelConnect").onclick = cancelConnection;
  $("clearRecents").onclick = () => { writeJson(KEYS.recents, []); renderRecents(); };

  // Demande entrante
  let decided = false;
  $("requestDialog").addEventListener("close", () => {
    if (!decided && state.pendingViewer) state.socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: false });
    decided = false;
  });
  $("deny").onclick = () => $("requestDialog").close();
  $("accept").onclick = async () => {
    decided = true;
    state.permissions = { control: $("reqControl").checked, clipboard: $("reqClipboard").checked, files: $("reqFiles").checked };
    state.socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: true, permissions: state.permissions });
    await bridge.setControlEnabled({ enabled: state.permissions.control, bounds: state.selectedBounds });
    $("requestDialog").close();
  };

  // Session — aidant
  $("toggleControl").onclick = () => { state.inputPaused = !state.inputPaused; updateControlUi(); if (!state.inputPaused) $("remoteVideo").focus(); };
  $("keysMenuButton").onclick = () => toggleMenu("keysMenu", "keysMenuButton");
  $("screensButton").onclick = () => toggleMenu("screensMenu", "screensButton");
  $("toggleSound").onclick = () => setSound($("remoteVideo").muted);
  $("hostChangeScreen").onclick = () => openSourcePicker().catch((error) => notify(error.message, "error"));
  $("showReceivedFile").onclick = () => { if ($("showReceivedFile").dataset.path) bridge.showInFolder($("showReceivedFile").dataset.path); };
  $("permAudio").checked = Boolean(prefs.shareAudio);
  $("permAudio").onchange = async () => {
    prefs.shareAudio = $("permAudio").checked;
    savePrefs();
    // Recapture immédiate de l'écran choisi pour ajouter ou retirer le son.
    if (state.lastSource && state.stream) await selectSource(state.lastSource, state.sourceName).catch((error) => notify(error.message, "error"));
  };
  $$("[data-combo]").forEach((button) => {
    button.onclick = () => {
      sendPayload({ type: "keydown", ...{ ctrl: false, shift: false, alt: false, meta: false }, ...COMBOS[button.dataset.combo] });
      $("keysMenu").hidden = true;
      $("keysMenuButton").setAttribute("aria-expanded", "false");
      $("remoteVideo").focus();
    };
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".menu-wrap")) closeMenus(); });
  $("zoomFit").onclick = () => setZoom(0);
  $("zoomLabel").onclick = () => setZoom(1);
  $("zoomIn").onclick = () => setZoom(Math.min(2.5, (state.zoom || 1) + 0.25));
  $("zoomOut").onclick = () => setZoom(Math.max(0.25, (state.zoom || 1) - 0.25));
  $("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("stage").requestFullscreen()).catch(() => {});
  $("disconnect").onclick = () => endSession({ reason: "Vous avez quitté la session." });

  // Session — hôte
  $("hostStop").onclick = () => endSession({ reason: "Vous avez arrêté le partage." });
  for (const id of ["livePermControl", "livePermClipboard", "livePermFiles"]) $(id).onchange = () => applyLivePermissions();

  // Panneau latéral
  $$("[data-panel]").forEach((button) => { button.onclick = () => openSidePanel(button.dataset.panel); });
  $("closeSide").onclick = closeSidePanel;
  $("chatForm").onsubmit = (event) => {
    event.preventDefault();
    const text = $("messageInput").value.trim();
    if (!text || !sessionCode()) return;
    state.socket.emit("chat-message", { code: sessionCode(), text });
    addMessage(text, true);
    $("messageInput").value = "";
  };
  $("fileInput").onchange = () => {
    const file = $("fileInput").files[0];
    $("fileLabel").textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "Choisir un fichier";
  };
  $("sendFile").onclick = () => {
    const file = $("fileInput").files[0];
    if (!file) return notify("Choisissez d’abord un fichier.", "error");
    const direct = state.channels["file-transfer"]?.readyState === "open";
    if (file.size > (direct ? MAX_DIRECT_FILE_SIZE : MAX_FILE_SIZE)) return notify(`Le fichier dépasse ${direct ? "2 Go" : "25 Mo"}.`, "error");
    if (!state.permissions.files) return notify("Les fichiers ne sont pas autorisés dans cette session.", "error");
    if (state.transferOut) return notify("Un envoi est déjà en cours.", "error");
    state.socket.emit("file-offer", { code: sessionCode(), id: `${file.name}:${file.size}`, name: file.name, type: file.type, size: file.size, direct });
    $("fileStatus").textContent = "En attente de l’accord de l’autre personne…";
  };
  $("readClipboard").onclick = async () => { $("clipboardText").value = await bridge.clipboardRead(); };
  $("sendClipboard").onclick = () => {
    const text = $("clipboardText").value;
    if (!text) return notify("Le texte est vide.", "error");
    state.socket.emit("clipboard-share", { code: sessionCode(), text });
    notify("Texte envoyé.", "success");
  };
  $("writeClipboard").onclick = async () => {
    await bridge.clipboardWrite($("clipboardText").value);
    notify("Texte copié sur ce PC.", "success");
  };
  $("rejectFile").onclick = () => decideFile(false);
  $("acceptFile").onclick = () => decideFile(true);

  // Historique
  $("historySearch").oninput = renderHistory;
  $("historyFilter").onchange = renderHistory;
  $("clearHistory").onclick = () => { if (confirm("Effacer tout l’historique de cet ordinateur ?")) { writeJson(KEYS.history, []); renderHistory(); } };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
  bindRemoteInput();
}

async function decideFile(accepted) {
  const offer = state.pendingFileOffer;
  if (!offer) return;
  state.pendingFileOffer = null;
  $("fileDialog").close();
  accepted = accepted && state.permissions.files;
  if (accepted && offer.direct) {
    // Le fichier est écrit directement sur le disque : on choisit l'emplacement avant d'accepter.
    const begin = await bridge.fileBegin({ name: offer.name, size: offer.size }).catch(() => ({ ok: false }));
    if (!begin.ok) accepted = false;
    else state.transferIn = { offerId: offer.id, transferId: begin.transferId, name: offer.name, size: offer.size, received: 0, startedAt: performance.now(), queue: Promise.resolve() };
  }
  if (accepted && !offer.direct && offer.size > MAX_FILE_SIZE) accepted = false;
  state.socket.emit("file-decision", { code: sessionCode(), id: offer.id, accepted });
  if (accepted) {
    $("fileStatus").textContent = "Réception…";
    if (state.sidePanel !== "files") openSidePanel("files");
  } else $("fileStatus").textContent = "Fichier refusé.";
}

function setAvailability(available) {
  state.available = available;
  $("availability").setAttribute("aria-pressed", String(available));
  $("availability").querySelector("span").textContent = available ? "Disponible" : "Indisponible";
  if (state.hostCode) {
    state.socket.emit("host-availability", { code: state.hostCode, available });
    $("hostWaitingText").textContent = available ? "En attente d’une demande de connexion…" : "Indisponible : les demandes sont refusées.";
  }
}

async function init() {
  if (!bridge) throw new Error("API Electron indisponible");
  applyTheme();
  const info = await bridge.systemInfo();
  state.info = info;
  $("deviceName").textContent = info.hostname;
  $("avatar").textContent = initials(info.hostname);
  $("appVersion").textContent = `Version ${info.version}`;
  $("aboutVersion").textContent = `Version ${info.version} · Electron ${info.electron}`;

  let configured = "";
  try { configured = localStorage.getItem(KEYS.server) || ""; } catch {}
  configured ||= await bridge.getSignalUrl();
  if (!configured) throw new Error("Le serveur intégré n’a pas pu démarrer.");
  state.serverUrl = configured;
  const localOnly = isLocalServer(configured);
  $("serverHost").textContent = localOnly ? "Mode local (ce PC uniquement)" : new URL(configured).host;
  $("localModeBanner").hidden = !localOnly;

  bindUi();
  bindSettings();
  renderRecents();
  renderHistory();
  bridge.setPreferences({ notifications: prefs.notifications, launchAtStartup: prefs.launchAtStartup }).catch(() => {});

  state.socket = io(configured, { transports: ["websocket", "polling"], timeout: 10000, reconnectionDelayMax: 10000 });
  bindSocket(state.socket);
  if (!localOnly) setInterval(() => { fetch(`${configured}/api/health`, { cache: "no-store", mode: "no-cors" }).catch(() => {}); }, 4 * 60_000);

  bridge.onStopConnections(() => {
    if (state.role) endSession({ reason: "Connexions arrêtées depuis la zone de notification." });
    else if (state.hostCode) stopHosting();
  });
  bridge.onAvailabilityChanged((value) => setAvailability(value));
  bridge.onUpdaterStatus(updateUpdater);
  bridge.onOpenUpdateDialog(() => $("updateDialog").showModal());
  renderDiagnostics().catch(() => {});
}

init().catch((error) => notify(`Démarrage impossible : ${error.message}`, "error"));
