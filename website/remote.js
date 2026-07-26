const $ = (id) => document.getElementById(id);
const socket = io({ transports: ["websocket", "polling"], timeout: 10000 });
let peer;
let code;
let permissions = {};
let candidates = [];
let zoom = 1;
let statsTimer;
let durationTimer;
let startedAt;
const channels = {};
let incomingFile;

function setStatus(text) { $("status").textContent = text; }
function toast(text) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = text;
  $("toasts").append(item);
  setTimeout(() => item.remove(), 4000);
}
function setConnecting(active, title = "Demande envoyée", detail = "En attente de l’autorisation du PC distant…") {
  $("connectionProgress").hidden = !active;
  $("connect").disabled = active;
  $("progressTitle").textContent = title;
  $("progressDetail").textContent = detail;
}
function showError(message) {
  setConnecting(false);
  $("errorDetail").textContent = message;
  $("connectError").hidden = false;
}
function formatCode(value) { return value.replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 "); }
function end() {
  clearInterval(statsTimer);
  clearInterval(durationTimer);
  peer?.close();
  peer = null;
  $("video").srcObject = null;
  $("sessionPanel").hidden = true;
  $("connectPanel").hidden = false;
  $("leave").disabled = true;
  code = null;
  setStatus("Session terminée");
  setConnecting(false);
}

async function createPeer() {
  const response = await fetch("/api/ice");
  const iceServers = response.ok ? (await response.json()).iceServers : [{ urls: "stun:stun.l.google.com:19302" }];
  peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = ({ candidate }) => candidate && socket.emit("signal", { code, data: { type: "candidate", candidate } });
  peer.ontrack = ({ streams }) => {
    $("video").srcObject = streams[0];
    $("connectPanel").hidden = true;
    $("sessionPanel").hidden = false;
    $("leave").disabled = false;
    $("videoLoader").hidden = true;
    setConnecting(false);
    $("connectError").hidden = true;
    startedAt = Date.now();
    clearInterval(durationTimer);
    durationTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      $("sessionDuration").textContent = [Math.floor(elapsed / 3600), Math.floor(elapsed % 3600 / 60), elapsed % 60].map((part) => String(part).padStart(2, "0")).join(":");
    }, 1000);
    $("video").focus();
  };
  peer.onconnectionstatechange = () => {
    setStatus(peer.connectionState === "connected" ? "Session active" : peer.connectionState);
    if (peer.connectionState === "failed") showError("La liaison WebRTC n’a pas pu être établie.");
    if (["failed", "closed"].includes(peer.connectionState)) end();
  };
  peer.ondatachannel = ({ channel }) => {
    channels[channel.label] = channel;
    channel.onmessage = ({ data }) => {
      if (channel.label !== "file-transfer") return;
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message.type === "start") incomingFile = { name: message.name, size: message.size, chunks: [], received: 0 };
        if (message.type === "end" && incomingFile) {
          const url = URL.createObjectURL(new Blob(incomingFile.chunks));
          const link = document.createElement("a");
          link.href = url; link.download = incomingFile.name; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          incomingFile = null;
        }
      } else if (incomingFile) {
        incomingFile.chunks.push(data);
        incomingFile.received += data.byteLength;
        $("fileStatus").textContent = `${Math.round(incomingFile.received / incomingFile.size * 100)} % reçus`;
      }
    };
  };
  return peer;
}

socket.on("connect", () => { setStatus("Serveur connecté"); $("serverDot").classList.add("online"); });
socket.on("disconnect", () => setStatus("Reconnexion au serveur…"));
socket.on("disconnect", () => $("serverDot").classList.remove("online"));
socket.on("viewer-denied", ({ reason }) => { setStatus(reason); showError(reason); });
socket.on("viewer-approved", async (data) => {
  code = data.code;
  permissions = data.permissions;
  $("permissions").textContent = permissions.control ? "Contrôle autorisé" : "Lecture seule";
  await createPeer();
  setStatus("Négociation WebRTC…");
  setConnecting(true, "Autorisation reçue", "Négociation de la connexion WebRTC…");
});
socket.on("permissions-state", (value) => {
  permissions = value;
  $("permissions").textContent = permissions.control ? "Contrôle autorisé" : "Lecture seule";
});
socket.on("signal", async ({ data }) => {
  if (!peer) return;
  if (data.type === "offer") {
    await peer.setRemoteDescription(data.sdp);
    for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("signal", { code, data: { type: "answer", sdp: peer.localDescription } });
    monitor();
  } else if (data.type === "candidate") {
    if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
    else candidates.push(data.candidate);
  }
});
socket.on("chat-message", ({ text }) => {
  const line = document.createElement("div");
  line.textContent = text;
  $("messages").appendChild(line);
  toast("Nouveau message reçu");
});
socket.on("clipboard-share", ({ text }) => { $("clipboard").value = text; toast("Presse-papiers synchronisé"); });
socket.on("session-ended", end);

$("code").oninput = (event) => { event.target.value = formatCode(event.target.value); };
$("connect").onclick = () => {
  const value = $("code").value.replace(/\D/g, "");
  if (value.length !== 9) return setStatus("Le code doit contenir neuf chiffres");
  code = value;
  socket.emit("viewer-request", { code, deviceName: `Navigateur ${navigator.userAgentData?.brands?.[0]?.brand || ""}`.trim() });
  setStatus("Attente de l’autorisation du PC distant…");
  $("connectError").hidden = true;
  setConnecting(true);
};
$("cancelConnect").onclick = () => { if (code) socket.emit("end-session", { code }); end(); };
$("retryConnect").onclick = () => { $("connectError").hidden = true; $("connect").click(); };
$("leave").onclick = () => {
  if (code) socket.emit("end-session", { code });
  end();
};
$("fullscreen").onclick = () => $("stage").requestFullscreen();
$("fit").onclick = () => { zoom = 1; updateZoom(); };
$("actual").onclick = () => { zoom = 1; $("video").style.maxWidth = "none"; $("video").style.maxHeight = "none"; updateZoom(); };
$("zoomIn").onclick = () => { zoom = Math.min(3, zoom + .25); updateZoom(); };
$("zoomOut").onclick = () => { zoom = Math.max(.5, zoom - .25); updateZoom(); };
$("audio").onclick = () => { $("audio").classList.toggle("active"); toast("Préférence audio mise à jour"); };
document.querySelectorAll("[data-drawer]").forEach((button) => button.onclick = () => {
  $("drawer").classList.add("open");
  document.querySelectorAll(".drawer-panel").forEach((panel) => panel.classList.toggle("active", panel.id === button.dataset.drawer));
});
$("closeDrawer").onclick = () => $("drawer").classList.remove("open");
function updateZoom() {
  $("video").style.transform = `scale(${zoom})`;
  $("zoomLabel").textContent = `${Math.round(zoom * 100)} %`;
}
$("sendMessage").onclick = () => {
  const text = $("message").value.trim();
  if (text && code) socket.emit("chat-message", { code, text });
  $("message").value = "";
};
$("sendClipboard").onclick = () => {
  if (!permissions.clipboard) return setStatus("Presse-papiers non autorisé");
  socket.emit("clipboard-share", { code, text: $("clipboard").value });
};
$("sendFile").onclick = async () => {
  const file = $("file").files[0];
  const channel = channels["file-transfer"];
  if (!file || channel?.readyState !== "open") return setStatus("Canal fichier indisponible");
  channel.send(JSON.stringify({ type: "start", name: file.name, size: file.size }));
  for (let offset = 0; offset < file.size; offset += 64 * 1024) {
    while (channel.bufferedAmount > 4 * 1024 * 1024) await new Promise((resolve) => setTimeout(resolve, 20));
    channel.send(await file.slice(offset, offset + 64 * 1024).arrayBuffer());
    $("fileStatus").textContent = `${Math.round(Math.min(file.size, offset + 64 * 1024) / file.size * 100)} % envoyés`;
  }
  channel.send(JSON.stringify({ type: "end" }));
};

function videoPoint(event) {
  const video = $("video");
  const rect = video.getBoundingClientRect();
  const sourceRatio = video.videoWidth / video.videoHeight;
  const boxRatio = rect.width / rect.height;
  let width = rect.width, height = rect.height, left = rect.left, top = rect.top;
  if (boxRatio > sourceRatio) { width = height * sourceRatio; left += (rect.width - width) / 2; }
  else { height = width / sourceRatio; top += (rect.height - height) / 2; }
  return { x: Math.max(0, Math.min(1, (event.clientX - left) / width)), y: Math.max(0, Math.min(1, (event.clientY - top) / height)) };
}
for (const type of ["mousemove", "mousedown", "mouseup"]) {
  $("video").addEventListener(type, (event) => {
    if (!permissions.control || !code) return;
    const payload = type === "mousemove" ? { type, ...videoPoint(event) } : { type, ...videoPoint(event), button: event.button };
    const channel = channels[type === "mousemove" ? "input-fast" : "commands"];
    if (channel?.readyState === "open") channel.send(JSON.stringify(payload));
    else socket.emit("remote-input", { code, payload });
  });
}
$("video").addEventListener("keydown", (event) => {
  if (!permissions.control || !code) return;
  event.preventDefault();
  const payload = { type: "keydown", key: event.key, code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey };
  if (channels.commands?.readyState === "open") channels.commands.send(JSON.stringify(payload)); else socket.emit("remote-input", { code, payload });
});
$("video").addEventListener("keyup", (event) => {
  if (!permissions.control || !code) return;
  const payload = { type: "keyup", key: event.key, code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey };
  if (channels.commands?.readyState === "open") channels.commands.send(JSON.stringify(payload)); else socket.emit("remote-input", { code, payload });
});
$("video").addEventListener("contextmenu", (event) => event.preventDefault());

function monitor() {
  clearInterval(statsTimer);
  statsTimer = setInterval(async () => {
    const report = await peer?.getStats();
    report?.forEach((item) => {
      if (item.type === "inbound-rtp" && item.kind === "video") {
        $("resolution").textContent = `${item.frameWidth || 0}×${item.frameHeight || 0}`;
        $("codec").textContent = report.get(item.codecId)?.mimeType?.split("/")[1] || "—";
      }
      if (item.type === "candidate-pair" && item.state === "succeeded") {
        $("latency").textContent = `${Math.round((item.currentRoundTripTime || 0) * 1000)} ms`;
        const remote = report.get(item.remoteCandidateId);
        $("network").textContent = remote?.candidateType === "relay" ? "TURN" : "Directe";
        $("networkTop").textContent = remote?.candidateType === "relay" ? "Relais TURN" : "Directe";
      }
    });
  }, 1500);
}

if (!window.RTCPeerConnection || !window.WebSocket) {
  setStatus("Navigateur incompatible");
  showError("Ce navigateur ne prend pas en charge les technologies nécessaires.");
}
