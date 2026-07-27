import { captureDisplay, detectPlatform } from "./shared/capabilities.js";

const $ = (id) => document.getElementById(id);
const runtimeConfig = window.MADRADOR_CONFIG || {};
const onStaticPages = location.hostname === "madrador60.github.io";
const apiUrl = String(runtimeConfig.apiUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const signalUrl = String(runtimeConfig.signalUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const socket = signalUrl
  ? io(signalUrl, { transports: ["websocket", "polling"], timeout: 10000 })
  : io({ autoConnect: false });
const platform = detectPlatform();
const state = {
  role: null, peer: null, code: null, stream: null, permissions: {}, candidates: [],
  channels: {}, incomingFile: null, pendingViewer: null, statsTimer: null,
  durationTimer: null, expiryTimer: null, startedAt: 0, zoom: 1, resumeToken: null
};

const formatCode = (value) => String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
const setStatus = (text) => { $("status").textContent = String(text).slice(0, 120); };
function toast(text) {
  const item = document.createElement("div");
  item.className = "toast"; item.textContent = String(text).slice(0, 220);
  $("toasts").append(item); setTimeout(() => item.remove(), 4000);
}
function showOnly(id) {
  ["modePanel", "hostPanel", "connectPanel", "sessionPanel"].forEach((panel) => { $(panel).hidden = panel !== id; });
  $("leave").disabled = id !== "sessionPanel";
}
function webPermissions() {
  return {
    control: false, mouse: false, keyboard: false,
    clipboard: $("webClipboard").checked, files: $("webFiles").checked,
    audio: $("webAudio").checked
  };
}
function setConnecting(active, title = "Demande envoyée", detail = "En attente de l’autorisation du PC distant…") {
  $("connectionProgress").hidden = !active; $("connect").disabled = active;
  $("progressTitle").textContent = title; $("progressDetail").textContent = detail;
}
function showError(message) {
  setConnecting(false); $("errorDetail").textContent = String(message).slice(0, 180); $("connectError").hidden = false;
}
function startClock() {
  state.startedAt = Date.now(); clearInterval(state.durationTimer);
  const tick = () => {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    $("sessionDuration").textContent = [Math.floor(elapsed / 3600), Math.floor(elapsed % 3600 / 60), elapsed % 60].map((part) => String(part).padStart(2, "0")).join(":");
  };
  tick(); state.durationTimer = setInterval(tick, 1000);
}
function startExpiry(expiresAt) {
  clearInterval(state.expiryTimer);
  if (!expiresAt) { $("hostExpiry").textContent = "Illimitée"; return; }
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    $("hostExpiry").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  tick(); state.expiryTimer = setInterval(tick, 1000);
}
async function iceServers() {
  if (!apiUrl) return [{ urls: "stun:stun.l.google.com:19302" }];
  const response = await fetch(`${apiUrl}/api/ice`);
  return response.ok ? (await response.json()).iceServers : [{ urls: "stun:stun.l.google.com:19302" }];
}
function bindChannel(channel) {
  state.channels[channel.label] = channel;
  channel.onmessage = async ({ data }) => {
    if (["input-fast", "commands"].includes(channel.label)) {
      toast("Le contrôle du système n’est pas autorisé depuis un hôte navigateur.");
      return;
    }
    if (channel.label !== "file-transfer") return;
    if (typeof data === "string") {
      const message = JSON.parse(data);
      if (message.type === "start") state.incomingFile = { name: message.name, size: message.size, chunks: [], received: 0 };
      if (message.type === "end" && state.incomingFile) {
        const url = URL.createObjectURL(new Blob(state.incomingFile.chunks));
        const link = document.createElement("a");
        link.href = url; link.download = state.incomingFile.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        state.incomingFile = null; toast("Fichier reçu");
      }
    } else if (state.incomingFile) {
      state.incomingFile.chunks.push(data); state.incomingFile.received += data.byteLength;
      $("fileStatus").textContent = `${Math.round(state.incomingFile.received / state.incomingFile.size * 100)} % reçus`;
    }
  };
}
async function createPeer(isHost) {
  state.peer?.close(); state.candidates = []; state.channels = {};
  const peer = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
  state.peer = peer;
  peer.onicecandidate = ({ candidate }) => candidate && socket.emit("signal", { code: state.code, data: { type: "candidate", candidate } });
  peer.ondatachannel = ({ channel }) => bindChannel(channel);
  if (isHost) {
    bindChannel(peer.createDataChannel("input-fast", { ordered: false, maxRetransmits: 0 }));
    bindChannel(peer.createDataChannel("commands", { ordered: true }));
    bindChannel(peer.createDataChannel("file-transfer", { ordered: true }));
  }
  peer.ontrack = ({ streams }) => {
    $("video").srcObject = streams[0]; enterSession("Appareil distant");
  };
  peer.onconnectionstatechange = () => {
    setStatus(peer.connectionState === "connected" ? "Session active" : peer.connectionState);
    if (peer.connectionState === "connected") {
      if (isHost) enterSession("Partage en cours");
      monitor(peer, isHost); toast("Connexion WebRTC établie");
    }
    if (peer.connectionState === "failed") {
      setStatus("Reconnexion WebRTC en cours…");
      peer.restartIce();
    }
  };
  return peer;
}
function enterSession(name) {
  showOnly("sessionPanel"); $("sessionDeviceName").textContent = name; $("videoLoader").hidden = true;
  if (state.role === "host") $("video").srcObject = state.stream;
  $("permissions").textContent = state.permissions.control ? "Contrôle autorisé" : "Lecture seule";
  $("participants").innerHTML = "<span>● 1 participant connecté</span>";
  startClock(); $("video").focus();
}
async function handleSignal(data) {
  if (!state.peer) return;
  if (data.type === "offer") {
    await state.peer.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate);
    const answer = await state.peer.createAnswer(); await state.peer.setLocalDescription(answer);
    socket.emit("signal", { code: state.code, data: { type: "answer", sdp: state.peer.localDescription } });
  } else if (data.type === "answer") {
    await state.peer.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate);
  } else if (data.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(data.candidate); else state.candidates.push(data.candidate);
  }
}
function end(emit = true) {
  if (emit && state.code) socket.emit("end-session", { code: state.code });
  clearInterval(state.statsTimer); clearInterval(state.durationTimer); clearInterval(state.expiryTimer);
  state.peer?.close(); state.stream?.getTracks().forEach((track) => track.stop());
  Object.assign(state, { role: null, peer: null, code: null, resumeToken: null, stream: null, candidates: [], channels: {}, startedAt: 0 });
  $("video").srcObject = null; $("hostPreview").srcObject = null; $("hostCodeArea").hidden = true;
  $("generateHostCode").disabled = true; $("regenerateHostCode").disabled = true; $("stopHosting").hidden = true;
  showOnly("modePanel"); setStatus("Serveur connecté");
}

socket.on("connect", () => {
  setStatus("Serveur connecté"); $("serverDot").classList.add("online");
  if (state.code && state.resumeToken && state.role) socket.emit("resume-session", { code: state.code, resumeToken: state.resumeToken, role: state.role });
});
socket.on("disconnect", () => { setStatus("Reconnexion au serveur…"); $("serverDot").classList.remove("online"); });
socket.on("host-created", ({ code, expiresAt, resumeToken }) => {
  state.code = code; state.resumeToken = resumeToken; $("hostCode").textContent = formatCode(code); $("hostCodeArea").hidden = false;
  $("regenerateHostCode").disabled = false; $("stopHosting").hidden = false; startExpiry(expiresAt);
  toast("Code de partage créé");
});
socket.on("session-expired", () => { toast("Le code a expiré"); end(false); });
socket.on("incoming-request", ({ viewerSocketId, deviceName }) => {
  state.pendingViewer = viewerSocketId; $("webRequester").textContent = `${deviceName || "Un appareil"} souhaite se connecter`;
  $("webRequestDialog").showModal();
});
socket.on("viewer-ready", async () => {
  if (!state.stream) return;
  const peer = await createPeer(true); state.stream.getTracks().forEach((track) => peer.addTrack(track, state.stream));
  const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
  socket.emit("signal", { code: state.code, data: { type: "offer", sdp: peer.localDescription } });
});
socket.on("viewer-approved", async ({ code, permissions, resumeToken }) => {
  state.code = code; state.resumeToken = resumeToken; state.permissions = permissions; await createPeer(false);
  setConnecting(true, "Autorisation reçue", "Négociation de la connexion WebRTC…");
});
socket.on("viewer-denied", ({ reason }) => showError(reason));
socket.on("host-unavailable", ({ reason }) => showError(reason));
socket.on("peer-reconnecting", () => setStatus("Reconnexion en cours…"));
socket.on("peer-resumed", async () => {
  setStatus("Connexion rétablie");
  if (state.peer && state.role === "host") {
    state.peer.restartIce();
    const offer = await state.peer.createOffer({ iceRestart: true });
    await state.peer.setLocalDescription(offer);
    socket.emit("signal", { code: state.code, data: { type: "offer", sdp: state.peer.localDescription } });
  }
});
socket.on("session-resumed", () => toast("Session reprise"));
socket.on("resume-denied", () => { toast("La période de reprise est terminée."); end(false); });
socket.on("permissions-state", (permissions) => { state.permissions = permissions; $("permissions").textContent = permissions.control ? "Contrôle autorisé" : "Lecture seule"; });
socket.on("signal", ({ data }) => handleSignal(data).catch(() => showError("La négociation WebRTC a échoué.")));
socket.on("chat-message", ({ text }) => addMessage(text, false));
socket.on("clipboard-share", ({ text }) => { $("clipboard").value = text; toast("Presse-papiers synchronisé"); });
socket.on("session-ended", () => end(false));
socket.on("viewer-left", () => { toast("Le participant a quitté la session"); $("participants").innerHTML = "<small>Aucun participant connecté</small>"; showOnly("hostPanel"); });
if (!signalUrl) {
  setStatus("Serveur public à configurer");
  $("capabilityNotice").textContent = "Le site est en ligne, mais les sessions distantes nécessitent encore l’URL du serveur public.";
}

$("openHost").onclick = () => { state.role = "host"; showOnly("hostPanel"); };
$("openViewer").onclick = () => { state.role = "viewer"; showOnly("connectPanel"); };
document.querySelectorAll("[data-back]").forEach((button) => button.onclick = () => end());
$("selectDisplay").onclick = async () => {
  try {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = await captureDisplay({ audio: $("webAudio").checked });
    $("hostPreview").srcObject = state.stream; $("generateHostCode").disabled = false;
    state.stream.getVideoTracks()[0].addEventListener("ended", () => end());
    toast("Source sélectionnée");
  } catch (error) { toast(error.name === "NotAllowedError" ? "Partage annulé." : error.message); }
};
function createHostCode() {
  if (!state.stream) return toast("Choisissez d’abord un écran, une fenêtre ou un onglet.");
  state.permissions = webPermissions();
  socket.emit("host-create", { deviceName: `Navigateur ${navigator.userAgentData?.brands?.[0]?.brand || ""}`.trim(), permissions: state.permissions, durationMinutes: Number($("webDuration").value), available: true });
  $("hostWaiting").textContent = "En attente d’une connexion…";
}
$("generateHostCode").onclick = createHostCode; $("regenerateHostCode").onclick = createHostCode;
$("copyHostCode").onclick = () => navigator.clipboard.writeText(state.code).then(() => toast("Code copié"));
$("stopHosting").onclick = () => end();
$("webDeny").onclick = () => { socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: false }); $("webRequestDialog").close(); };
$("webAccept").onclick = () => { state.permissions = webPermissions(); socket.emit("host-decision", { viewerSocketId: state.pendingViewer, approved: true, permissions: state.permissions }); $("webRequestDialog").close(); $("hostWaiting").textContent = "Connexion en cours…"; };
$("code").oninput = (event) => { event.target.value = formatCode(event.target.value); };
$("connect").onclick = () => {
  const value = $("code").value.replace(/\D/g, ""); if (value.length !== 9) return setStatus("Le code doit contenir neuf chiffres");
  state.code = value; state.role = "viewer"; socket.emit("viewer-request", { code: value, deviceName: `Navigateur ${navigator.userAgentData?.brands?.[0]?.brand || ""}`.trim() });
  $("connectError").hidden = true; setConnecting(true); setStatus("Attente de l’autorisation…");
};
$("cancelConnect").onclick = () => end(); $("retryConnect").onclick = () => { $("connectError").hidden = true; $("connect").click(); };
$("leave").onclick = () => end(); $("fullscreen").onclick = () => $("stage").requestFullscreen();
$("fit").onclick = () => { state.zoom = 1; updateZoom(); }; $("actual").onclick = () => { state.zoom = 1; $("video").style.maxWidth = "none"; updateZoom(); };
$("zoomIn").onclick = () => { state.zoom = Math.min(3, state.zoom + .25); updateZoom(); }; $("zoomOut").onclick = () => { state.zoom = Math.max(.5, state.zoom - .25); updateZoom(); };
function updateZoom() { $("video").style.transform = `scale(${state.zoom})`; $("zoomLabel").textContent = `${Math.round(state.zoom * 100)} %`; }
$("audio").onclick = () => toast("L’audio dépend de la source choisie et du navigateur.");
document.querySelectorAll("[data-drawer]").forEach((button) => button.onclick = () => {
  $("drawer").classList.add("open"); document.querySelectorAll(".drawer-panel").forEach((panel) => panel.classList.toggle("active", panel.id === button.dataset.drawer));
});
$("closeDrawer").onclick = () => $("drawer").classList.remove("open");
function addMessage(text, mine) {
  const line = document.createElement("div"); line.textContent = text; if (mine) line.className = "mine"; $("messages").append(line);
}
$("sendMessage").onclick = () => { const text = $("message").value.trim(); if (text && state.code) { socket.emit("chat-message", { code: state.code, text }); addMessage(text, true); } $("message").value = ""; };
$("sendClipboard").onclick = () => { if (!state.permissions.clipboard) return toast("Presse-papiers non autorisé."); socket.emit("clipboard-share", { code: state.code, text: $("clipboard").value }); };
$("sendFile").onclick = async () => {
  const file = $("file").files[0], channel = state.channels["file-transfer"];
  if (!state.permissions.files || !file || channel?.readyState !== "open") return toast("Canal fichier indisponible.");
  if (file.size > 25 * 1024 * 1024) return toast("Le fichier dépasse 25 Mo.");
  channel.send(JSON.stringify({ type: "start", name: file.name, size: file.size }));
  for (let offset = 0; offset < file.size; offset += 64 * 1024) {
    while (channel.bufferedAmount > 4 * 1024 * 1024) await new Promise((resolve) => setTimeout(resolve, 20));
    channel.send(await file.slice(offset, offset + 64 * 1024).arrayBuffer());
    $("fileStatus").textContent = `${Math.round(Math.min(file.size, offset + 64 * 1024) / file.size * 100)} % envoyés`;
  }
  channel.send(JSON.stringify({ type: "end" }));
};
function videoPoint(event) {
  const rect = $("video").getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}
for (const type of ["mousemove", "mousedown", "mouseup"]) $("video").addEventListener(type, (event) => {
  if (state.role !== "viewer" || !state.permissions.control || !state.code) return;
  const payload = { type, ...videoPoint(event), ...(type === "mousemove" ? {} : { button: event.button }) };
  const channel = state.channels[type === "mousemove" ? "input-fast" : "commands"];
  if (channel?.readyState === "open") channel.send(JSON.stringify(payload)); else socket.emit("remote-input", { code: state.code, payload });
});
$("video").addEventListener("keydown", (event) => {
  if (state.role !== "viewer" || !state.permissions.control || !state.code) return;
  event.preventDefault(); const payload = { type: "keydown", key: event.key, code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey };
  if (state.channels.commands?.readyState === "open") state.channels.commands.send(JSON.stringify(payload)); else socket.emit("remote-input", { code: state.code, payload });
});
$("video").addEventListener("contextmenu", (event) => event.preventDefault());
function monitor(peer, host) {
  clearInterval(state.statsTimer); let lastBytes = 0, lastAt = performance.now();
  state.statsTimer = setInterval(async () => {
    const report = await peer.getStats();
    report.forEach((item) => {
      if (item.type === (host ? "outbound-rtp" : "inbound-rtp") && item.kind === "video") {
        $("resolution").textContent = `${item.frameWidth || 0}×${item.frameHeight || 0}`; $("codec").textContent = report.get(item.codecId)?.mimeType?.split("/")[1] || "—";
        const bytes = host ? item.bytesSent : item.bytesReceived, now = performance.now();
        const mbps = Math.max(0, (bytes - lastBytes) * 8 / (now - lastAt) / 1000); lastBytes = bytes; lastAt = now;
        $("networkTop").textContent = mbps > 3 ? "Excellente" : mbps > 1 ? "Bonne" : "Limitée";
      }
      if (item.type === "candidate-pair" && item.state === "succeeded") { $("latency").textContent = `${Math.round((item.currentRoundTripTime || 0) * 1000)} ms`; $("network").textContent = report.get(item.remoteCandidateId)?.candidateType === "relay" ? "TURN" : "Directe"; }
    });
  }, 1500);
}

$("capabilityNotice").textContent = platform.displayCapture ? "✓ Partage d’écran disponible. Le contrôle système nécessite l’application Windows." : "⚠ Ce navigateur ne permet pas le partage d’écran.";
if (!platform.displayCapture) $("openHost").disabled = true;
if (!window.RTCPeerConnection || !window.WebSocket) { setStatus("Navigateur incompatible"); $("openHost").disabled = true; $("openViewer").disabled = true; }
