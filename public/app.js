const $ = (id) => document.getElementById(id);
const Perf = window.RAPerf;
const SIGNALING_KEY = "madrador-signaling-url";
const defaultSignalingUrl = window.location.origin;
let signalingUrl = localStorage.getItem(SIGNALING_KEY) || defaultSignalingUrl;
const socketOptions = { transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: 10, timeout: 12000 };
let host = io(signalingUrl, socketOptions);

let viewer = null;
let code = null;
let viewerCode = null;
let stream = null;
let hostPeer = null;
let viewerPeer = null;
let pendingViewer = null;
let statsTimer = null;
let pendingFile = null;
let outgoingFile = null;
let deviceName = "PC";
let clipboardPayload = { text: "", image: null };
let permissions = { control:false, clipboard:false, files:false, audio:false };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setSocketStatus(socket) {
  socket.on("connect", () => setStatus(`Serveur connecté • ${signalingUrl}`));
  socket.on("connect_error", () => setStatus("Serveur de connexion inaccessible"));
  socket.on("disconnect", (reason) => setStatus(`Serveur déconnecté • ${reason}`));
}
setSocketStatus(host);

function setStatus(text) {
  $("status").textContent = text;
}

function formatCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
}

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.viewJump));
});

function getHistory() {
  return JSON.parse(localStorage.getItem("madrador-history") || "[]");
}

function saveHistory(type, detail) {
  const history = getHistory();
  history.unshift({ type, detail, at: new Date().toISOString() });
  localStorage.setItem("madrador-history", JSON.stringify(history.slice(0, 50)));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  $("historyList").innerHTML = history.length
    ? history.map((item) => `
      <div class="history-item">
        <b>${escapeHtml(item.type)}</b>
        <div>${escapeHtml(item.detail)}</div>
        <small>${new Date(item.at).toLocaleString()}</small>
      </div>`).join("")
    : "<p>Aucune connexion enregistrée.</p>";

  $("recentCards").innerHTML = history.length
    ? history.slice(0, 6).map((item) => `
      <div class="recent-card">
        <b>${escapeHtml(item.type)}</b>
        <span>${escapeHtml(item.detail)}</span>
        <small>${new Date(item.at).toLocaleString()}</small>
      </div>`).join("")
    : `<div class="recent-card"><b>Aucune connexion</b><small>Vos sessions apparaîtront ici.</small></div>`;
}

window.remoteAssist.systemInfo().then((info) => {
  deviceName = info.hostname;
  $("deviceInfo").textContent = `${info.hostname} • ${info.displays} écran(s) • ${info.memoryGb} Go RAM`;
});

renderHistory();

$("remoteCode").addEventListener("input", (event) => {
  event.target.value = formatCode(event.target.value);
});

$("createCode").onclick = () => {
  host.emit("host-create", { deviceName, permissions });
  setStatus("Création du code…");
};

host.on("host-created", ({ code: newCode }) => {
  code = newCode;
  $("hostCode").textContent = formatCode(code);
  setStatus("Code prêt");
  saveHistory("Code créé", formatCode(code));
});

host.on("session-expired", () => {
  code = null;
  $("hostCode").textContent = "Code expiré";
  setStatus("Code expiré");
});

$("chooseScreen").onclick = async () => {
  const sources = await window.remoteAssist.listSources();
  $("sourceGrid").innerHTML = "";
  $("picker").classList.remove("hidden");

  for (const source of sources) {
    const button = document.createElement("button");
    button.className = "source";
    button.innerHTML = `<img src="${source.thumbnail}" alt=""><b>${escapeHtml(source.name)}</b>`;
    button.onclick = async () => {
      const profile = Perf.profiles[$("profile").value];
      stream?.getTracks().forEach((track) => track.stop());

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: permissions.audio,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: source.id,
              maxWidth: profile.width,
              maxHeight: profile.height,
              maxFrameRate: profile.fps
            }
          }
        });

        $("localVideo").srcObject = stream;
        $("selectedSource").textContent = source.name;
        $("picker").classList.add("hidden");
        setStatus("Écran prêt");
      } catch (error) {
        setStatus(`Capture impossible : ${error.message}`);
      }
    };
    $("sourceGrid").appendChild(button);
  }
};

$("closePicker").onclick = () => $("picker").classList.add("hidden");

host.on("incoming-request", ({ viewerSocketId, deviceName: requesterName }) => {
  pendingViewer = viewerSocketId;
  $("requester").textContent = `${requesterName || "Un ordinateur"} veut se connecter`;
  $("incoming").classList.remove("hidden");
  setStatus("Demande reçue");
});

$("deny").onclick = () => {
  $("incoming").classList.add("hidden");
  host.emit("host-decision", { viewerSocketId: pendingViewer, approved: false });
  setStatus("Connexion refusée");
};

$("accept").onclick = () => {
  if (!stream) {
    setStatus("Choisissez d’abord un écran");
    return;
  }

  permissions = {
    control: $("acceptControl").checked,
    clipboard: $("acceptClipboard").checked,
    files: $("acceptFiles").checked,
    audio: $("acceptAudio").checked
  };

  $("incoming").classList.add("hidden");
  host.emit("host-decision", {
    viewerSocketId: pendingViewer,
    approved: true,
    permissions
  });

  window.remoteAssist.setControlEnabled(permissions.control);
  saveHistory("Connexion acceptée", `Contrôle ${permissions.control ? "autorisé" : "refusé"} • documents ${permissions.files ? "autorisés" : "refusés"}`);
  setStatus("Connexion acceptée");
};

function createPeer(socket, sessionCode, isHost) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { code: sessionCode, data: { type:"candidate", candidate:event.candidate } });
    }
  };

  peer.onconnectionstatechange = () => {
    setStatus(peer.connectionState);
    if (peer.connectionState === "connected") {
      showView("session");
      startStats(peer);
      saveHistory("Connexion établie", formatCode(sessionCode));
    }
  };

  if (!isHost) {
    peer.ontrack = (event) => {
      $("remoteVideo").srcObject = event.streams[0];
      $("remoteVideo").focus();
    };
  }

  return peer;
}

host.on("viewer-ready", async () => {
  hostPeer = createPeer(host, code, true);
  stream.getTracks().forEach((track) => hostPeer.addTrack(track, stream));
  await Perf.apply(hostPeer, Perf.profiles[$("profile").value]);

  const offer = await hostPeer.createOffer();
  await hostPeer.setLocalDescription(offer);
  host.emit("signal", { code, data: { type:"offer", sdp:hostPeer.localDescription } });
});

host.on("signal", async ({ data }) => {
  if (!hostPeer) return;
  if (data.type === "answer") await hostPeer.setRemoteDescription(data.sdp);
  if (data.type === "candidate") {
    try { await hostPeer.addIceCandidate(data.candidate); } catch {}
  }
});

host.on("remote-input", (payload) => window.remoteAssist.sendRemoteInput(payload));
host.on("viewer-left", () => setStatus("Le correspondant a quitté la session"));

$("connect").onclick = () => {
  viewerCode = $("remoteCode").value.replace(/\D/g, "");
  if (viewerCode.length !== 9) {
    setStatus("Code invalide");
    return;
  }

  viewer?.disconnect();
  viewer = io(signalingUrl, socketOptions);
  setSocketStatus(viewer);
  viewer.emit("viewer-request", { code: viewerCode, deviceName });
  setStatus("Demande envoyée");

  viewer.on("viewer-denied", ({ reason }) => setStatus(reason));

  viewer.on("viewer-approved", ({ code: approvedCode, permissions: allowed }) => {
    permissions = allowed;
    viewerPeer = createPeer(viewer, approvedCode, false);
    saveHistory("Demande acceptée", formatCode(viewerCode));
    setStatus("Accepté, connexion en cours…");
  });

  viewer.on("signal", async ({ data }) => {
    if (!viewerPeer) return;

    if (data.type === "offer") {
      await viewerPeer.setRemoteDescription(data.sdp);
      const answer = await viewerPeer.createAnswer();
      await viewerPeer.setLocalDescription(answer);
      viewer.emit("signal", { code:viewerCode, data:{ type:"answer", sdp:viewerPeer.localDescription } });
    }

    if (data.type === "candidate") {
      try { await viewerPeer.addIceCandidate(data.candidate); } catch {}
    }
  });

  viewer.on("permissions-state", (allowed) => permissions = allowed);
  viewer.on("session-ended", stopAll);
  bindRelay(viewer);
};

function activeSocket() {
  return viewer || host;
}

function addMessage(text, mine) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${mine ? "me" : ""}`;
  bubble.textContent = text;
  $("messages").appendChild(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function bindRelay(socket) {
  socket.on("chat-message", ({ text }) => addMessage(text, false));

  socket.on("clipboard-share", async (payload = {}) => {
    if (!permissions.clipboard) return;
    await window.remoteAssist.clipboardWrite(payload);
    addMessage(payload.image ? "Image copiée reçue dans le presse-papiers." : "Texte copié reçu.", false);
    $("clipboardStatus").textContent = "Presse-papiers distant appliqué.";
  });

  socket.on("file-offer", (file) => {
    pendingFile = file;
    $("fileOfferText").textContent = `${file.name} • ${(file.size / 1048576).toFixed(1)} Mo`;
    $("fileOffer").classList.remove("hidden");
  });

  socket.on("file-decision", ({ id, accepted }) => {
    if (!outgoingFile || outgoingFile.id !== id) return;
    if (!accepted) {
      $("fileStatus").textContent = "Le document a été refusé.";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      socket.emit("file-data", {
        id,
        name: outgoingFile.file.name,
        size: outgoingFile.file.size,
        data: Array.from(new Uint8Array(reader.result))
      });
      $("fileStatus").textContent = "Document envoyé.";
      saveHistory("Document envoyé", outgoingFile.file.name);
    };
    reader.readAsArrayBuffer(outgoingFile.file);
    $("fileStatus").textContent = "Envoi en cours…";
  });

  socket.on("file-data", async (payload) => {
    const result = await window.remoteAssist.saveReceivedFile({
      name: payload.name,
      data: payload.data
    });

    $("fileStatus").textContent = result.ok
      ? `Document enregistré : ${result.path}`
      : "Enregistrement annulé.";

    if (result.ok) saveHistory("Document reçu", payload.name);
  });
}

bindRelay(host);

$("sendChat").onclick = () => {
  const text = $("chatInput").value.trim();
  if (!text) return;
  activeSocket().emit("chat-message", { text });
  addMessage(text, true);
  $("chatInput").value = "";
};

$("readClipboard").onclick = async () => {
  clipboardPayload = await window.remoteAssist.clipboardRead();
  $("clipboardText").value = clipboardPayload.text || "";

  if (clipboardPayload.image) {
    $("clipboardPreview").innerHTML = `<img src="${clipboardPayload.image}" alt="Image copiée">`;
  } else {
    $("clipboardPreview").textContent = "Aucune image copiée";
  }

  $("clipboardStatus").textContent = "Presse-papiers local chargé.";
};

$("shareClipboard").onclick = () => {
  if (!permissions.clipboard) {
    $("clipboardStatus").textContent = "Le presse-papiers n’est pas autorisé pour cette session.";
    return;
  }

  const payload = clipboardPayload.image
    ? { image: clipboardPayload.image }
    : { text: $("clipboardText").value };

  activeSocket().emit("clipboard-share", payload);
  $("clipboardStatus").textContent = payload.image ? "Image partagée." : "Texte partagé.";
};

function selectFile(file) {
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("fileInput").files = transfer.files;
  $("fileStatus").textContent = `${file.name} • ${(file.size / 1048576).toFixed(1)} Mo`;
}

$("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dropZone").classList.add("drag");
});

$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("drag"));

$("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropZone").classList.remove("drag");
  selectFile(event.dataTransfer.files[0]);
});

$("sendFile").onclick = () => {
  const file = $("fileInput").files[0];
  if (!file) {
    $("fileStatus").textContent = "Choisissez d’abord un document.";
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    $("fileStatus").textContent = "La taille maximale est de 25 Mo.";
    return;
  }
  if (!permissions.files) {
    $("fileStatus").textContent = "Le transfert de documents n’est pas autorisé.";
    return;
  }

  outgoingFile = { id:crypto.randomUUID(), file };
  activeSocket().emit("file-offer", {
    id:outgoingFile.id,
    name:file.name,
    type:file.type,
    size:file.size
  });
  $("fileStatus").textContent = "Demande d’acceptation envoyée…";
};

$("acceptFile").onclick = () => {
  $("fileOffer").classList.add("hidden");
  activeSocket().emit("file-decision", { id:pendingFile.id, accepted:true });
};

$("declineFile").onclick = () => {
  $("fileOffer").classList.add("hidden");
  activeSocket().emit("file-decision", { id:pendingFile.id, accepted:false });
};

$("applyPermissions").onclick = () => {
  permissions = {
    control:$("permControl").checked,
    clipboard:$("permClipboard").checked,
    files:$("permFiles").checked,
    audio:$("permAudio").checked
  };

  window.remoteAssist.setControlEnabled(permissions.control);
  if (code) host.emit("set-permissions", { code, permissions });
  saveHistory("Permissions modifiées", `Contrôle ${permissions.control ? "oui" : "non"} • presse-papiers ${permissions.clipboard ? "oui" : "non"} • documents ${permissions.files ? "oui" : "non"}`);
  setStatus("Permissions appliquées");
};

$("profile").onchange = () => {
  if (hostPeer) Perf.apply(hostPeer, Perf.profiles[$("profile").value]);
};

function startStats(peer) {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = Perf.monitor(peer, (stats) => {
    $("sent").textContent = Math.round(stats.sent);
    $("recv").textContent = Math.round(stats.recv);
    $("ping").textContent = `${stats.rtt} ms`;
    $("rate").textContent = `${stats.mbps.toFixed(1)} Mb/s`;
    $("loss").textContent = `${stats.loss.toFixed(1)} %`;
    $("codec").textContent = stats.codec;
    $("resolution").textContent = stats.resolution;

    if ($("profile").value === "auto" && hostPeer) {
      Perf.apply(hostPeer, Perf.adaptive(stats));
    }
  });
}

function videoPosition(event) {
  const video = $("remoteVideo");
  const rect = video.getBoundingClientRect();
  return {
    x:Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y:Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

let queuedMouse = null;
let mouseFrame = false;

$("remoteVideo").addEventListener("mousemove", (event) => {
  queuedMouse = event;
  if (mouseFrame) return;
  mouseFrame = true;

  requestAnimationFrame(() => {
    mouseFrame = false;
    if (viewer && permissions.control) {
      viewer.emit("remote-input", {
        code:viewerCode,
        payload:{ type:"mousemove", ...videoPosition(queuedMouse) }
      });
    }
  });
});

["mousedown", "mouseup"].forEach((type) => {
  $("remoteVideo").addEventListener(type, (event) => {
    if (viewer && permissions.control) {
      viewer.emit("remote-input", {
        code:viewerCode,
        payload:{ type, button:event.button, ...videoPosition(event) }
      });
    }
  });
});

$("remoteVideo").addEventListener("contextmenu", (event) => event.preventDefault());

$("remoteVideo").addEventListener("wheel", (event) => {
  if (!viewer || !permissions.control) return;
  event.preventDefault();
  viewer.emit("remote-input", {
    code:viewerCode,
    payload:{ type:"wheel", deltaY:event.deltaY }
  });
}, { passive:false });

$("remoteVideo").addEventListener("keydown", (event) => {
  if (!viewer || !permissions.control) return;
  event.preventDefault();
  viewer.emit("remote-input", {
    code:viewerCode,
    payload:{ type:"keydown", key:event.key }
  });
});

$("fullscreen").onclick = async () => {
  if ($("remoteVideo").srcObject) await $("remoteVideo").requestFullscreen();
};

function stopAll() {
  if (statsTimer) clearInterval(statsTimer);
  stream?.getTracks().forEach((track) => track.stop());
  hostPeer?.close();
  viewerPeer?.close();
  viewer?.disconnect();

  stream = null;
  hostPeer = null;
  viewerPeer = null;
  viewer = null;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  setStatus("Prêt");
  showView("home");
}

$("stop").onclick = stopAll;
$("clearHistory").onclick = () => {
  localStorage.removeItem("madrador-history");
  renderHistory();
};


// Serveur de signalisation partagé (nécessaire entre deux PC différents)
const signalingInput = $("signalingUrl");
if (signalingInput) signalingInput.value = signalingUrl;
$("saveSignaling")?.addEventListener("click", () => {
  const value = signalingInput.value.trim().replace(/\/$/, "");
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Protocole invalide");
    localStorage.setItem(SIGNALING_KEY, parsed.origin);
    signalingUrl = parsed.origin;
    $("signalingStatus").textContent = "Adresse enregistrée. Redémarre l’application sur les deux PC.";
  } catch {
    $("signalingStatus").textContent = "Adresse invalide. Exemple : https://serveur.example.com";
  }
});
$("resetSignaling")?.addEventListener("click", () => {
  localStorage.removeItem(SIGNALING_KEY);
  signalingUrl = defaultSignalingUrl;
  signalingInput.value = signalingUrl;
  $("signalingStatus").textContent = "Serveur local restauré.";
});

// Madrador Remote V5 modules
let lastV5Stats = null;
let recIndicator = null;

document.addEventListener("DOMContentLoaded", async () => {
  window.MadradorV5.setTheme(window.MadradorV5.state.theme);

  try {
    const response = await fetch("/v5-modules.json");
    if (response.ok) {
      const modules = await response.json();
      const matrix = $("moduleMatrix");
      if (matrix) {
        matrix.innerHTML = modules.map((module) => `
          <div class="module-item">
            <strong>${module.id}. ${module.name}</strong>
            <small>${module.detail}</small>
            <span class="state ${module.status}">${module.status}</span>
          </div>
        `).join("");
      }
    }
  } catch (error) {
    console.warn("Matrice V5 indisponible", error);
  }
});

const originalStartStats = startStats;
startStats = function(peer) {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = Perf.monitor(peer, (stats) => {
    lastV5Stats = stats;
    $("sent").textContent = Math.round(stats.sent);
    $("recv").textContent = Math.round(stats.recv);
    $("ping").textContent = `${stats.rtt} ms`;
    $("rate").textContent = `${stats.mbps.toFixed(1)} Mb/s`;
    $("loss").textContent = `${stats.loss.toFixed(1)} %`;
    $("codec").textContent = stats.codec;
    $("resolution").textContent = stats.resolution;

    const diagnostic = window.MadradorV5.diagnose(stats);
    if ($("aiDiagnostic")) $("aiDiagnostic").textContent = diagnostic;

    if ($("profile").value === "auto" && hostPeer) {
      Perf.apply(hostPeer, Perf.adaptive(stats));
    }
  });
};

$("runDiagnostic")?.addEventListener("click", () => {
  $("aiDiagnostic").textContent = window.MadradorV5.diagnose(lastV5Stats);
});

$("themeDark")?.addEventListener("click", () => window.MadradorV5.setTheme("dark"));
$("themeLight")?.addEventListener("click", () => window.MadradorV5.setTheme("light"));

$("enableGaming")?.addEventListener("click", async () => {
  $("profile").value = "ultra";
  if (hostPeer) await Perf.apply(hostPeer, Perf.profiles.ultra);
  setStatus("Mode Gaming activé");
});

$("startRecording")?.addEventListener("click", async () => {
  try {
    await window.MadradorV5.startRecording($("remoteVideo"));
    $("recordingStatus").textContent = "Enregistrement en cours…";
    recIndicator = document.createElement("div");
    recIndicator.className = "rec-indicator";
    recIndicator.textContent = "● REC";
    document.body.appendChild(recIndicator);
  } catch (error) {
    $("recordingStatus").textContent = error.message;
  }
});

$("stopRecording")?.addEventListener("click", async () => {
  try {
    const blob = await window.MadradorV5.stopRecording();
    window.MadradorV5.downloadRecording(blob);
    $("recordingStatus").textContent = "Enregistrement exporté.";
    recIndicator?.remove();
    recIndicator = null;
  } catch (error) {
    $("recordingStatus").textContent = error.message;
  }
});
