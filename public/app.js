import { captureDisplay, detectPlatform } from "./shared/capabilities.js";

const bridge = window.remoteAssist;
const $ = (id) => document.getElementById(id);
const SERVER_KEY = "madrador.server";
const HISTORY_KEY = "madrador.history";
const RECENTS_KEY = "madrador.recents";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const platform = detectPlatform(bridge);

const state = {
  socket: null,
  peer: null,
  stream: null,
  sessionCode: null,
  remoteCode: null,
  pendingViewer: null,
  selectedBounds: null,
  candidateQueue: [],
  channels: {},
  incomingFile: null,
  statsTimer: null,
  permissions: { control: false, clipboard: false, files: false },
  codeExpiresAt: 0,
  codeTimer: null,
  sessionStartedAt: 0,
  durationTimer: null,
  zoom: 1,
  pendingFileOffer: null,
  update: { status: "idle" }
  , available: true, resumeToken: null, role: null
};
let systemDiagnostics = null;

function notify(message, type = "info", title = "Madrador Remote") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === "error" ? "!" : type === "success" ? "✓" : "i"}</span>`;
  const content = document.createElement("div");
  const heading = document.createElement("b");
  const detail = document.createElement("small");
  heading.textContent = title;
  detail.textContent = message;
  content.append(heading, detail);
  toast.append(content);
  $("toastRegion").append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function showPanel(id) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.panel === id));
  $("pageTitle").textContent = { home: "Tableau de bord", session: "Session distante", history: "Historique", transfer: "Centre d’échanges", settings: "Paramètres" }[id];
  $("pageEyebrow").textContent = { home: "ESPACE PERSONNEL", session: "CONTRÔLE À DISTANCE", history: "ACTIVITÉ LOCALE", transfer: "OUTILS DE SESSION", settings: "PRÉFÉRENCES" }[id];
}

function formatCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
}

function addMessage(text, mine = false) {
  const bubble = document.createElement("div");
  bubble.className = `bubble${mine ? " mine" : ""}`;
  bubble.textContent = String(text).slice(0, 2000);
  $("messages").appendChild(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function renderRecents() {
  const recents = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  $("recentDevices").replaceChildren();
  if (!recents.length) {
    const empty = document.createElement("small");
    empty.textContent = "Aucun appareil récent";
    $("recentDevices").append(empty);
    return;
  }
  recents.slice(0, 4).forEach((item) => {
    const row = document.createElement("div");
    row.className = "recent-item";
    const name = document.createElement("span");
    const use = document.createElement("button");
    name.textContent = item.name || formatCode(item.code);
    use.textContent = "Connecter →";
    use.onclick = () => { $("remoteCode").value = formatCode(item.code); $("connect").click(); };
    row.append(name, use);
    $("recentDevices").append(row);
  });
}

function addHistory(entry) {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  history.unshift({ id: crypto.randomUUID(), date: new Date().toISOString(), ...entry });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  renderHistory();
}

function renderHistory() {
  const query = $("historySearch").value.toLowerCase();
  const filter = $("historyFilter").value;
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter((item) =>
    (!query || String(item.device).toLowerCase().includes(query)) && (filter === "all" || item.status === filter)
  );
  $("historyRows").replaceChildren();
  $("historyEmpty").hidden = Boolean(history.length);
  history.forEach((item) => {
    const row = document.createElement("tr");
    const values = [item.device, new Date(item.date).toLocaleString("fr-FR"), item.duration || "—", item.type || "Distante"];
    values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
    const statusCell = document.createElement("td");
    statusCell.innerHTML = `<span class="status-chip">${item.status === "failed" ? "Échouée" : "Terminée"}</span>`;
    const action = document.createElement("td");
    const retry = document.createElement("button");
    retry.className = "button secondary";
    retry.textContent = "Reconnecter";
    retry.onclick = () => { $("remoteCode").value = formatCode(item.code); showPanel("home"); };
    action.append(retry);
    row.append(statusCell, action);
    $("historyRows").append(row);
  });
}

function activeCode() {
  return state.remoteCode || state.sessionCode;
}

function activePermissions() {
  return {
    control: $("allowControl").checked,
    clipboard: $("allowClipboard").checked,
    files: $("allowFiles").checked
  };
}

async function flushCandidates() {
  if (!state.peer?.remoteDescription) return;
  for (const candidate of state.candidateQueue.splice(0)) {
    try { await state.peer.addIceCandidate(candidate); } catch (error) { console.warn(error); }
  }
}

async function createPeer(isHost) {
  const iceServers = await bridge.getIceServers();
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  state.peer = peer;
  state.channels = {};
  state.candidateQueue = [];

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) state.socket.emit("signal", { code: activeCode(), data: { type: "candidate", candidate } });
  };
  peer.onconnectionstatechange = () => {
    $("sessionState").textContent = peer.connectionState;
    if (peer.connectionState === "connected") {
      notify("Connexion établie", "success");
      bridge.setSessionActive(true);
      state.sessionStartedAt = Date.now();
      startDuration();
      $("sessionNavDot").classList.add("live");
      showPanel("session");
      monitorStats(peer);
    }
    if (peer.connectionState === "failed") {
      $("sessionState").textContent = "Reconnexion en cours";
      notify("La liaison est interrompue. Tentative de reprise…", "info", "Reconnexion");
      peer.restartIce();
    }
  };
  if (!isHost) {
    peer.ontrack = ({ streams }) => {
      $("remoteVideo").srcObject = streams[0];
      $("screenEmpty").hidden = true;
      $("remoteVideo").focus();
    };
  }
  const bindChannel = (channel) => {
    state.channels[channel.label] = channel;
    channel.onmessage = async ({ data }) => {
      if (channel.label === "input-fast" || channel.label === "commands") {
        try { await bridge.sendRemoteInput(JSON.parse(data)); } catch (error) { notify(`Commande refusée : ${error.message}`, "error"); }
      } else if (channel.label === "file-transfer") {
        if (typeof data === "string") {
          const message = JSON.parse(data);
          if (message.type === "start") state.incomingFile = { name: message.name, size: message.size, chunks: [], received: 0 };
          if (message.type === "end" && state.incomingFile) {
            const blob = new Blob(state.incomingFile.chunks);
            await bridge.saveReceivedFile({ name: state.incomingFile.name, data: await blob.arrayBuffer() });
            state.incomingFile = null;
          }
        } else if (state.incomingFile) {
          state.incomingFile.chunks.push(data);
          state.incomingFile.received += data.byteLength;
          $("fileStatus").textContent = `${Math.round(state.incomingFile.received / state.incomingFile.size * 100)} % reçus`;
        }
      }
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

async function handleSignal({ data }) {
  if (!state.peer) return;
  if (data.type === "offer") {
    await state.peer.setRemoteDescription(data.sdp);
    await flushCandidates();
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    state.socket.emit("signal", { code: activeCode(), data: { type: "answer", sdp: state.peer.localDescription } });
  } else if (data.type === "answer") {
    await state.peer.setRemoteDescription(data.sdp);
    await flushCandidates();
  } else if (data.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(data.candidate);
    else state.candidateQueue.push(data.candidate);
  }
}

function bindSocket(socket) {
  socket.on("connect", () => {
    $("onlineDot").classList.add("online");
    $("connectionLabel").textContent = "Serveur connecté";
    $("deviceStatus").textContent = "Prêt à recevoir";
    if (state.sessionCode && state.resumeToken && state.role) {
      socket.emit("resume-session", { code: state.sessionCode, resumeToken: state.resumeToken, role: state.role });
    }
  });
  socket.on("disconnect", () => {
    $("onlineDot").classList.remove("online");
    $("connectionLabel").textContent = "Serveur hors ligne";
  });
  socket.on("connect_error", () => notify("Serveur inaccessible. Nouvelle tentative automatique.", "error"));
  socket.on("host-created", ({ code, expiresAt, resumeToken }) => {
    state.sessionCode = code;
    state.resumeToken = resumeToken;
    state.role = "host";
    $("localCode").textContent = formatCode(code);
    $("copyCode").disabled = false;
    $("codeState").textContent = "Code actif";
    $("codeState").classList.remove("muted");
    state.codeExpiresAt = expiresAt || 0;
    startCodeTimer();
    bridge.setHostCode(code);
    notify("Code prêt pendant 10 minutes", "success");
  });
  socket.on("session-expired", () => {
    state.sessionCode = null;
    $("localCode").textContent = "Code expiré";
    $("copyCode").disabled = true;
    $("codeState").textContent = "Code expiré";
    $("codeState").classList.add("muted");
    bridge.setHostCode("");
  });
  socket.on("incoming-request", ({ viewerSocketId, deviceName }) => {
    state.pendingViewer = viewerSocketId;
    $("requester").textContent = `${deviceName || "Un ordinateur"} souhaite voir votre écran.`;
    $("requestDialog").showModal();
    bridge.showNotification({ title: "Demande de connexion", body: `${deviceName || "Un ordinateur"} souhaite se connecter.` });
  });
  socket.on("viewer-approved", async ({ code, permissions, resumeToken }) => {
    state.remoteCode = code;
    state.sessionCode = code;
    state.resumeToken = resumeToken;
    state.role = "viewer";
    state.permissions = permissions;
    await createPeer(false);
    $("remoteName").textContent = "Appareil distant";
    notify("Demande acceptée", "success");
  });
  socket.on("viewer-denied", ({ reason }) => { notify(reason, "error", "Connexion refusée"); addHistory({ device: formatCode(state.remoteCode), code: state.remoteCode, type: "Sortante", status: "failed" }); });
  socket.on("host-unavailable", ({ reason }) => notify(reason, "error", "Appareil indisponible"));
  socket.on("peer-reconnecting", () => notify("Connexion interrompue. Reprise automatique en cours…", "info", "Reconnexion"));
  socket.on("peer-resumed", async () => {
    notify("Connexion rétablie", "success");
    if (state.peer && state.role === "host") {
      state.peer.restartIce();
      const offer = await state.peer.createOffer({ iceRestart: true });
      await state.peer.setLocalDescription(offer);
      socket.emit("signal", { code: activeCode(), data: { type: "offer", sdp: state.peer.localDescription } });
    }
  });
  socket.on("session-resumed", () => notify("Session reprise", "success"));
  socket.on("resume-denied", () => {
    notify("La période de reprise est terminée.", "error", "Session expirée");
    stopSession(false);
  });
  socket.on("viewer-ready", async () => {
    if (!state.stream) return notify("Sélectionnez d’abord un écran", "error");
    const peer = await createPeer(true);
    state.stream.getTracks().forEach((track) => peer.addTrack(track, state.stream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("signal", { code: state.sessionCode, data: { type: "offer", sdp: peer.localDescription } });
  });
  socket.on("signal", (payload) => handleSignal(payload).catch((error) => notify(`Connexion impossible : ${error.message}`, "error")));
  socket.on("permissions-state", (permissions) => { state.permissions = permissions; });
  socket.on("remote-input", (payload) => bridge.sendRemoteInput(payload));
  socket.on("chat-message", ({ text }) => addMessage(text));
  socket.on("clipboard-share", ({ text }) => {
    $("clipboardText").value = text;
    notify("Presse-papiers synchronisé", "success");
  });
  socket.on("file-offer", ({ id, name, size }) => {
    state.pendingFileOffer = { id, name, size };
    $("fileOfferText").textContent = `${name} · ${Math.ceil(size / 1024)} Ko`;
    $("fileDialog").showModal();
  });
  socket.on("file-decision", async ({ id, accepted }) => {
    const file = $("fileInput").files[0];
    if (!accepted || !file || id !== `${file.name}:${file.size}`) return notify("Le fichier a été refusé", "error");
    socket.emit("file-data", { id, name: file.name, type: file.type, size: file.size, data: await file.arrayBuffer() });
    $("fileStatus").textContent = "Fichier envoyé";
  });
  socket.on("file-data", async ({ name, data }) => {
    const result = await bridge.saveReceivedFile({ name, data });
    $("fileStatus").textContent = result.ok ? "Fichier enregistré" : "Enregistrement annulé";
  });
  socket.on("session-ended", () => stopSession(false));
  socket.on("viewer-left", () => {
    bridge.setControlEnabled({ enabled: false, bounds: null });
    notify("Le correspondant a quitté la session", "error", "Session terminée");
  });
}

async function chooseSource() {
  const sources = await bridge.listSources();
  $("sourceGrid").replaceChildren();
  for (const source of sources) {
    const button = document.createElement("button");
    const image = document.createElement("img");
    const label = document.createElement("b");
    image.src = source.thumbnail;
    label.textContent = source.name;
    button.append(image, label);
    button.onclick = async (event) => {
      event.preventDefault();
      state.stream?.getTracks().forEach((track) => track.stop());
      state.stream = await captureDisplay({ bridge, sourceId: source.id });
      state.selectedBounds = source.bounds;
      $("localVideo").srcObject = state.stream;
      $("sourceLabel").textContent = source.name;
      $("sourceDialog").close();
      notify("Écran prêt à partager", "success");
    };
    $("sourceGrid").appendChild(button);
  }
  $("sourceDialog").showModal();
}

async function stopSession(shouldNotify = true) {
  const endedCode = activeCode();
  const wasRemote = Boolean(state.remoteCode);
  if (shouldNotify && endedCode) state.socket.emit("end-session", { code: endedCode });
  clearInterval(state.statsTimer);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.peer?.close();
  await bridge.setControlEnabled({ enabled: false, bounds: null });
  Object.assign(state, { peer: null, stream: null, sessionCode: null, remoteCode: null, resumeToken: null, role: null, selectedBounds: null, candidateQueue: [] });
  state.channels = {};
  state.incomingFile = null;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("screenEmpty").hidden = false;
  $("sessionState").textContent = "Aucune session";
  bridge.setSessionActive(false);
  $("sessionNavDot").classList.remove("live");
  clearInterval(state.durationTimer);
  if (state.sessionStartedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
    addHistory({ device: formatCode(endedCode || "000000000"), code: endedCode, duration: formatDuration(seconds), type: wasRemote ? "Sortante" : "Entrante", status: "completed" });
  }
  state.sessionStartedAt = 0;
  notifyUser("Session arrêtée");
  showPanel("home");
}

function notifyUser(message) { notify(message, "info"); }
function formatDuration(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
function startDuration() {
  clearInterval(state.durationTimer);
  const tick = () => { $("sessionDuration").textContent = formatDuration(Math.floor((Date.now() - state.sessionStartedAt) / 1000)); };
  tick();
  state.durationTimer = setInterval(tick, 1000);
}
function startCodeTimer() {
  clearInterval(state.codeTimer);
  if (!state.codeExpiresAt) {
    $("codeTimer").textContent = "Illimitée";
    return;
  }
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((state.codeExpiresAt - Date.now()) / 1000));
    $("codeTimer").textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    if (!remaining) clearInterval(state.codeTimer);
  };
  tick();
  state.codeTimer = setInterval(tick, 1000);
}

function monitorStats(peer) {
  clearInterval(state.statsTimer);
  let lastBytes = 0;
  let lastAt = performance.now();
  state.statsTimer = setInterval(async () => {
    const report = await peer.getStats();
    report.forEach((item) => {
      if (item.type === "inbound-rtp" && item.kind === "video") {
        const now = performance.now();
        const mbps = Math.max(0, (item.bytesReceived - lastBytes) * 8 / (now - lastAt) / 1000);
        lastBytes = item.bytesReceived;
        lastAt = now;
        $("bitrate").textContent = `${mbps.toFixed(1)} Mb/s`;
        $("resolution").textContent = item.frameWidth ? `${item.frameWidth}×${item.frameHeight}` : "—";
        $("sessionQuality").textContent = mbps > 3 ? "Excellente" : mbps > 1 ? "Bonne" : "Limitée";
      }
      if (item.type === "candidate-pair" && item.state === "succeeded") {
        $("latency").textContent = `${Math.round((item.currentRoundTripTime || 0) * 1000)} ms`;
        $("transport").textContent = item.localCandidateId ? "WebRTC" : "—";
      }
    });
  }, 1000);
}

function sendInput(type, event, extra = {}) {
  if (!state.remoteCode || !state.permissions.control) return;
  const rect = $("remoteVideo").getBoundingClientRect();
  state.socket.emit("remote-input", {
    code: state.remoteCode,
    payload: {
      type,
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      ...extra
    }
  });
}

async function init() {
  if (!bridge) throw new Error("API Electron indisponible");
  document.body.dataset.platform = platform.kind;
  const info = await bridge.systemInfo();
  systemDiagnostics = info;
  $("deviceLabel").textContent = `${info.hostname} · ${info.displays} écran(s)`;
  $("computerName").textContent = info.hostname;
  $("sidebarDevice").textContent = info.hostname;
  $("avatar").textContent = info.hostname.slice(0, 2).toUpperCase();
  $("localIp").textContent = info.localIp;
  $("installedVersion").textContent = `v${info.version}`;
  $("sidebarVersion").textContent = `Version ${info.version}`;
  $("aboutVersion").textContent = `Version ${info.version}`;
  const configured = localStorage.getItem(SERVER_KEY) || await bridge.getSignalUrl() || "http://127.0.0.1:3000";
  $("serverUrl").value = configured;
  $("serverDisplay").textContent = new URL(configured).host;
  $("sidebarServer").textContent = new URL(configured).host;
  state.socket = io(configured, { transports: ["websocket", "polling"], timeout: 10000 });
  bindSocket(state.socket);

  document.querySelectorAll(".nav").forEach((button) => button.onclick = () => showPanel(button.dataset.panel));
  $("remoteCode").oninput = (event) => { event.target.value = formatCode(event.target.value); };
  $("chooseSource").onclick = () => chooseSource().catch((error) => notify(error.message, "error"));
  $("createSession").onclick = () => {
    if (!state.stream) return notify("Choisissez d’abord un écran", "error");
    state.permissions = activePermissions();
    state.socket.emit("host-create", { deviceName: info.hostname, permissions: state.permissions, durationMinutes: Number($("sessionDurationSelect").value), available: state.available });
    notify("Création du code…");
  };
  $("connect").onclick = () => {
    const code = $("remoteCode").value.replace(/\D/g, "");
    if (code.length !== 9) return notify("Le code doit contenir 9 chiffres", "error");
    state.remoteCode = code;
    state.socket.emit("viewer-request", { code, deviceName: info.hostname });
    const recents = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]").filter((item) => item.code !== code);
    recents.unshift({ code, name: formatCode(code), favorite: false });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 8)));
    renderRecents();
    notify("Demande envoyée. En attente de l’appareil distant.");
  };
  $("deny").onclick = () => {
    state.socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: false });
    $("requestDialog").close();
  };
  $("accept").onclick = async () => {
    state.permissions = activePermissions();
    state.socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: true, permissions: state.permissions });
    await bridge.setControlEnabled({ enabled: state.permissions.control, bounds: state.selectedBounds });
    $("requestDialog").close();
  };
  $("applyPermissions").onclick = async () => {
    state.permissions = activePermissions();
    state.socket.emit("set-permissions", { code: state.sessionCode, permissions: state.permissions });
    await bridge.setControlEnabled({ enabled: state.permissions.control, bounds: state.selectedBounds });
    notify("Permissions mises à jour", "success");
  };
  $("sendMessage").onclick = () => {
    const text = $("messageInput").value.trim();
    if (!text || !activeCode()) return;
    state.socket.emit("chat-message", { code: activeCode(), text });
    addMessage(text, true);
    $("messageInput").value = "";
  };
  $("sendFile").onclick = () => {
    const file = $("fileInput").files[0];
    if (!file || !activeCode()) return notify("Choisissez un fichier pendant une session", "error");
    if (file.size > MAX_FILE_SIZE) return notify("Le fichier dépasse 25 Mo", "error");
    const id = `${file.name}:${file.size}`;
    state.socket.emit("file-offer", { code: activeCode(), id, name: file.name, type: file.type, size: file.size });
    $("fileStatus").textContent = "Proposition envoyée";
  };
  $("readClipboard").onclick = async () => {
    $("clipboardText").value = await bridge.clipboardRead();
  };
  $("sendClipboard").onclick = () => {
    if (!activeCode() || !state.permissions.clipboard) return notify("Presse-papiers non autorisé", "error");
    state.socket.emit("clipboard-share", { code: activeCode(), text: $("clipboardText").value });
    notify("Texte partagé", "success");
  };
  $("saveServer").onclick = () => {
    try {
      const url = new URL($("serverUrl").value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      localStorage.setItem(SERVER_KEY, url.origin);
      location.reload();
    } catch { notify("Adresse de serveur invalide", "error"); }
  };
  $("stop").onclick = () => stopSession();
  $("fullscreen").onclick = () => $("remoteVideo").requestFullscreen();
  $("fitScreen").onclick = () => { state.zoom = 1; updateZoom(); };
  $("actualSize").onclick = () => { state.zoom = 1; $("remoteVideo").style.maxWidth = "none"; $("remoteVideo").style.maxHeight = "none"; updateZoom(); };
  $("zoomIn").onclick = () => { state.zoom = Math.min(2.5, state.zoom + .25); updateZoom(); };
  $("zoomOut").onclick = () => { state.zoom = Math.max(.5, state.zoom - .25); updateZoom(); };
  $("audioToggle").onclick = () => { $("audioToggle").classList.toggle("active"); notify("Préférence audio mise à jour"); };
  $("controlToggle").onclick = () => { $("controlToggle").classList.toggle("active"); notify(state.permissions.control ? "Contrôle autorisé par l’hôte" : "Session en lecture seule"); };
  document.querySelectorAll("[data-session-panel]").forEach((button) => button.onclick = () => {
    $("sessionDrawer").classList.add("open");
    document.querySelectorAll(".drawer-content").forEach((content) => content.classList.toggle("active", content.id === button.dataset.sessionPanel));
  });
  $("closeDrawer").onclick = () => $("sessionDrawer").classList.remove("open");
  document.querySelectorAll(".setting-tab").forEach((button) => button.onclick = () => {
    document.querySelectorAll(".setting-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".setting-page").forEach((page) => page.classList.toggle("active", page.id === `setting-${button.dataset.setting}`));
  });
  $("copyCode").onclick = async () => {
    await navigator.clipboard.writeText(state.sessionCode);
    notify("ID copié dans le presse-papiers", "success");
  };
  $("clearRecents").onclick = () => { localStorage.removeItem(RECENTS_KEY); renderRecents(); };
  $("historySearch").oninput = renderHistory;
  $("historyFilter").onchange = renderHistory;
  $("availability").onclick = async () => {
    const off = $("availability").classList.toggle("off");
    state.available = !off;
    $("availability").querySelector("span").textContent = off ? "Indisponible" : "Disponible";
    $("availabilityText").textContent = off ? "Indisponible" : "Disponible";
    await bridge.setAvailability(state.available);
    if (state.sessionCode) state.socket.emit("host-availability", { code: state.sessionCode, available: state.available });
  };
  $("rejectFile").onclick = () => decideFile(false);
  $("acceptFile").onclick = () => decideFile(true);
  bridge.onStopConnections(() => stopSession());
  bridge.onAvailabilityChanged((value) => {
    state.available = value;
    $("availability").classList.toggle("off", !value);
    $("availability").querySelector("span").textContent = value ? "Disponible" : "Indisponible";
    $("availabilityText").textContent = value ? "Disponible" : "Indisponible";
    if (state.sessionCode) state.socket.emit("host-availability", { code: state.sessionCode, available: value });
  });
  const renderDiagnostics = async () => {
    const details = await bridge.systemInfo();
    systemDiagnostics = {
      generatedAt: new Date().toISOString(),
      application: { version: details.version, electron: details.electron, chromium: details.chromium, node: details.node },
      system: { platform: details.platform, release: details.platformRelease, memoryBytes: details.memoryBytes, cpu: details.cpu, cpuCores: details.cpuCores, gpu: details.gpu, gpuFeatures: details.gpuFeatures },
      connection: { server: $("serverDisplay").textContent, socketIo: state.socket?.connected ? "connected" : "disconnected", webrtc: state.peer?.connectionState || "inactive", ice: state.peer?.iceConnectionState || "inactive" },
      media: { resolution: state.stream?.getVideoTracks()[0]?.getSettings?.() || null }
    };
    $("diagnosticsReport").textContent = JSON.stringify(systemDiagnostics, null, 2);
  };
  $("refreshDiagnostics").onclick = () => renderDiagnostics().catch(() => notify("Diagnostics indisponibles", "error"));
  $("exportDiagnostics").onclick = async () => {
    await renderDiagnostics();
    const data = new TextEncoder().encode(JSON.stringify(systemDiagnostics, null, 2));
    const result = await bridge.saveReceivedFile({ name: `madrador-diagnostics-${Date.now()}.json`, data });
    notify(result.ok ? "Rapport de diagnostic exporté" : "Export annulé", result.ok ? "success" : "info");
  };
  await renderDiagnostics();
  bridge.onUpdaterStatus(updateUpdater);
  bridge.onOpenUpdateDialog(() => $("updateDialog").showModal());
  $("updateButton").onclick = () => bridge.updateAction($("updateButton").dataset.action || "check").then((result) => {
    if (!result.ok) notify(result.error, "error");
  }).catch(() => notify("La mise à jour est momentanément indisponible. Aucun fichier latest.yml n’est encore publié.", "error"));
  $("closeUpdateDialog").onclick = () => $("updateDialog").close();
  $("updateLater").onclick = () => {
    if (state.update.status === "downloaded") bridge.updateAction("later");
    $("updateDialog").close();
    notify(state.update.status === "downloaded" ? "La mise à jour sera installée à la fermeture de l’application." : "Nous vous le rappellerons plus tard.");
  };
  $("updatePrimary").onclick = () => {
    const action = state.update.status === "downloaded" ? "install" : "download";
    bridge.updateAction(action).catch(() => notify("Impossible de lancer cette mise à jour pour le moment.", "error"));
  };
  renderRecents();
  renderHistory();
  ["mousedown", "mouseup"].forEach((type) => $("remoteVideo").addEventListener(type, (event) => sendInput(type, event, { button: event.button })));
  $("remoteVideo").addEventListener("mousemove", (event) => sendInput("mousemove", event));
  $("remoteVideo").addEventListener("wheel", (event) => { event.preventDefault(); sendInput("wheel", event, { deltaY: event.deltaY }); }, { passive: false });
  $("remoteVideo").addEventListener("keydown", (event) => { event.preventDefault(); sendInput("keydown", event, { key: event.key }); });
  $("remoteVideo").addEventListener("contextmenu", (event) => event.preventDefault());
}

function decideFile(accepted) {
  const offer = state.pendingFileOffer;
  if (!offer) return;
  accepted = accepted && state.permissions.files;
  state.socket.emit("file-decision", { id: offer.id, accepted });
  $("fileStatus").textContent = accepted ? "En attente du fichier…" : "Fichier refusé";
  $("fileDialog").close();
  state.pendingFileOffer = null;
}
function updateZoom() {
  $("remoteVideo").style.transform = `scale(${state.zoom})`;
  $("zoomLevel").textContent = `${Math.round(state.zoom * 100)}%`;
}
function updateUpdater(data) {
  state.update = data;
  const labels = {
    idle: ["Mises à jour", "Vérification automatique au démarrage."],
    development: ["Mode développement", "Les mises à jour sont actives dans la version installée."],
    cached: ["Vérification récente", "La prochaine vérification automatique aura lieu plus tard."],
    checking: ["Recherche en cours…", "Connexion au service de mises à jour."],
    available: [`Version ${data.version} disponible`, "Une nouvelle version est prête à télécharger."],
    current: ["Madrador Remote est à jour", `Version ${data.version}`],
    downloading: ["Téléchargement en cours", `${data.percent}% téléchargés`],
    downloaded: [`Version ${data.version} prête`, "Installez maintenant ou au prochain redémarrage."],
    scheduled: ["Installation planifiée", "La mise à jour sera installée à la fermeture de l’application."],
    error: ["Mise à jour indisponible", "Aucune mise à jour complète n’est publiée pour le moment. Réessayez plus tard."]
  };
  const [title, description] = labels[data.status] || labels.error;
  $("updateTitle").textContent = title;
  $("updateDescription").textContent = description;
  $("updateProgress").hidden = data.status !== "downloading";
  $("updateProgress").value = data.percent || 0;
  const notes = typeof data.notes === "string" ? data.notes : Array.isArray(data.notes) ? data.notes.map((note) => note.note || "").join("\n") : "";
  $("releaseNotes").textContent = notes.slice(0, 1000);
  if (data.status === "available") { $("updateButton").textContent = "Télécharger"; $("updateButton").dataset.action = "download"; }
  else if (data.status === "downloaded") { $("updateButton").textContent = "Installer maintenant"; $("updateButton").dataset.action = "install"; }
  else if (["current", "cached", "development", "error"].includes(data.status)) { $("updateButton").textContent = "Rechercher une mise à jour"; $("updateButton").dataset.action = "check"; }

  if (["available", "downloading", "downloaded"].includes(data.status)) {
    if (!$("updateDialog").open) $("updateDialog").showModal();
    $("updateDialogTitle").textContent = data.status === "downloaded" ? "La mise à jour est prête." : data.status === "downloading" ? "Téléchargement en cours…" : "Nouvelle version disponible !";
    $("updateDialogDescription").textContent = data.status === "available" ? `Madrador Remote ${data.version} est disponible.` : data.status === "downloaded" ? `Madrador Remote ${data.version} a été téléchargé et vérifié.` : "Vous pouvez continuer à utiliser l’application.";
    $("updateDialogNotes").textContent = notes || "Corrections, améliorations et optimisations incluses dans cette version.";
    const downloading = data.status === "downloading";
    $("downloadMetrics").hidden = !downloading;
    $("updateDialogProgress").hidden = !downloading;
    $("updateDialogProgress").value = data.percent || 0;
    $("downloadPercent").textContent = `${data.percent || 0} %`;
    $("downloadSpeed").textContent = formatBytes(data.bytesPerSecond || 0) + "/s";
    $("downloadEta").textContent = data.secondsRemaining == null ? "Calcul…" : formatEta(data.secondsRemaining);
    $("integrityStatus").hidden = data.status !== "downloaded";
    $("integrityStatus").textContent = data.integrity?.verified ? `✓ Intégrité vérifiée (${data.integrity.algorithm})` : "✓ Téléchargement vérifié par electron-updater";
    $("updatePrimary").textContent = data.status === "downloaded" ? "Installer maintenant" : data.status === "downloading" ? "Téléchargement…" : "Télécharger maintenant";
    $("updatePrimary").disabled = downloading;
    $("updateLater").textContent = data.status === "downloaded" ? "Installer au prochain redémarrage" : "Plus tard";
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function formatEta(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

init().catch((error) => notify(`Démarrage impossible : ${error.message}`, "error"));
