const bridge = window.remoteAssist;
const $ = (id) => document.getElementById(id);
const SERVER_KEY = "madrador.server";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
  permissions: { control: false, clipboard: false, files: false }
};

function status(message) {
  $("status").textContent = message;
}

function showPanel(id) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.panel === id));
  $("pageTitle").textContent = { home: "Bonjour", session: "Session", transfer: "Échanges", settings: "Réglages" }[id];
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
      status("Connexion établie");
      showPanel("session");
      monitorStats(peer);
    }
    if (["failed", "closed"].includes(peer.connectionState)) stopSession(false);
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
        try { await bridge.sendRemoteInput(JSON.parse(data)); } catch (error) { status(`Commande refusée : ${error.message}`); }
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
  });
  socket.on("disconnect", () => {
    $("onlineDot").classList.remove("online");
    $("connectionLabel").textContent = "Serveur hors ligne";
  });
  socket.on("connect_error", () => status("Serveur inaccessible"));
  socket.on("host-created", ({ code }) => {
    state.sessionCode = code;
    $("localCode").textContent = formatCode(code);
    status("Code prêt pendant 10 minutes");
  });
  socket.on("session-expired", () => {
    state.sessionCode = null;
    $("localCode").textContent = "Code expiré";
  });
  socket.on("incoming-request", ({ viewerSocketId, deviceName }) => {
    state.pendingViewer = viewerSocketId;
    $("requester").textContent = `${deviceName || "Un ordinateur"} souhaite voir votre écran.`;
    $("requestDialog").showModal();
  });
  socket.on("viewer-approved", async ({ code, permissions }) => {
    state.remoteCode = code;
    state.permissions = permissions;
    await createPeer(false);
    status("Demande acceptée");
  });
  socket.on("viewer-denied", ({ reason }) => status(reason));
  socket.on("viewer-ready", async () => {
    if (!state.stream) return status("Sélectionnez d’abord un écran");
    const peer = await createPeer(true);
    state.stream.getTracks().forEach((track) => peer.addTrack(track, state.stream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("signal", { code: state.sessionCode, data: { type: "offer", sdp: peer.localDescription } });
  });
  socket.on("signal", (payload) => handleSignal(payload).catch((error) => status(`Connexion impossible : ${error.message}`)));
  socket.on("permissions-state", (permissions) => { state.permissions = permissions; });
  socket.on("remote-input", (payload) => bridge.sendRemoteInput(payload));
  socket.on("chat-message", ({ text }) => addMessage(text));
  socket.on("clipboard-share", ({ text }) => {
    $("clipboardText").value = text;
    status("Texte partagé reçu");
  });
  socket.on("file-offer", ({ id, name, size }) => {
    const accepted = state.permissions.files && confirm(`Accepter ${name} (${Math.ceil(size / 1024)} Ko) ?`);
    socket.emit("file-decision", { id, accepted });
    $("fileStatus").textContent = accepted ? "En attente du fichier…" : "Fichier refusé";
  });
  socket.on("file-decision", async ({ id, accepted }) => {
    const file = $("fileInput").files[0];
    if (!accepted || !file || id !== `${file.name}:${file.size}`) return status("Fichier refusé");
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
    status("Le correspondant a quitté la session");
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
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: source.id, maxWidth: 2560, maxHeight: 1440, maxFrameRate: 60 } }
      });
      state.selectedBounds = source.bounds;
      $("localVideo").srcObject = state.stream;
      $("sourceLabel").textContent = source.name;
      $("sourceDialog").close();
      status("Écran prêt à partager");
    };
    $("sourceGrid").appendChild(button);
  }
  $("sourceDialog").showModal();
}

async function stopSession(notify = true) {
  if (notify && activeCode()) state.socket.emit("end-session", { code: activeCode() });
  clearInterval(state.statsTimer);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.peer?.close();
  await bridge.setControlEnabled({ enabled: false, bounds: null });
  Object.assign(state, { peer: null, stream: null, remoteCode: null, selectedBounds: null, candidateQueue: [] });
  state.channels = {};
  state.incomingFile = null;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("screenEmpty").hidden = false;
  $("sessionState").textContent = "Aucune session";
  status("Session arrêtée");
  showPanel("home");
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
      }
      if (item.type === "candidate-pair" && item.state === "succeeded") $("latency").textContent = `${Math.round((item.currentRoundTripTime || 0) * 1000)} ms`;
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
  const info = await bridge.systemInfo();
  $("deviceLabel").textContent = `${info.hostname} · ${info.displays} écran(s)`;
  const configured = localStorage.getItem(SERVER_KEY) || await bridge.getSignalUrl() || "http://127.0.0.1:3000";
  $("serverUrl").value = configured;
  state.socket = io(configured, { transports: ["websocket", "polling"], timeout: 10000 });
  bindSocket(state.socket);

  document.querySelectorAll(".nav").forEach((button) => button.onclick = () => showPanel(button.dataset.panel));
  $("remoteCode").oninput = (event) => { event.target.value = formatCode(event.target.value); };
  $("chooseSource").onclick = () => chooseSource().catch((error) => status(error.message));
  $("createSession").onclick = () => {
    if (!state.stream) return status("Choisissez d’abord un écran");
    state.permissions = activePermissions();
    state.socket.emit("host-create", { deviceName: info.hostname, permissions: state.permissions });
    status("Création du code…");
  };
  $("connect").onclick = () => {
    const code = $("remoteCode").value.replace(/\D/g, "");
    if (code.length !== 9) return status("Le code doit contenir 9 chiffres");
    state.remoteCode = code;
    state.socket.emit("viewer-request", { code, deviceName: info.hostname });
    status("Demande envoyée");
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
    status("Permissions mises à jour");
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
    if (!file || !activeCode()) return status("Choisissez un fichier pendant une session");
    if (file.size > MAX_FILE_SIZE) return status("Le fichier dépasse 25 Mo");
    const id = `${file.name}:${file.size}`;
    state.socket.emit("file-offer", { code: activeCode(), id, name: file.name, type: file.type, size: file.size });
    $("fileStatus").textContent = "Proposition envoyée";
  };
  $("readClipboard").onclick = async () => {
    $("clipboardText").value = await bridge.clipboardRead();
  };
  $("sendClipboard").onclick = () => {
    if (!activeCode() || !state.permissions.clipboard) return status("Presse-papiers non autorisé");
    state.socket.emit("clipboard-share", { code: activeCode(), text: $("clipboardText").value });
    status("Texte partagé");
  };
  $("saveServer").onclick = () => {
    try {
      const url = new URL($("serverUrl").value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      localStorage.setItem(SERVER_KEY, url.origin);
      location.reload();
    } catch { status("Adresse de serveur invalide"); }
  };
  $("stop").onclick = () => stopSession();
  $("fullscreen").onclick = () => $("remoteVideo").requestFullscreen();
  ["mousedown", "mouseup"].forEach((type) => $("remoteVideo").addEventListener(type, (event) => sendInput(type, event, { button: event.button })));
  $("remoteVideo").addEventListener("mousemove", (event) => sendInput("mousemove", event));
  $("remoteVideo").addEventListener("wheel", (event) => { event.preventDefault(); sendInput("wheel", event, { deltaY: event.deltaY }); }, { passive: false });
  $("remoteVideo").addEventListener("keydown", (event) => { event.preventDefault(); sendInput("keydown", event, { key: event.key }); });
  $("remoteVideo").addEventListener("contextmenu", (event) => event.preventDefault());
}

init().catch((error) => status(`Démarrage impossible : ${error.message}`));
