const $ = (id) => document.getElementById(id);
const Perf = window.RemoteAssistPerformance;

const hostSocket = io();
let viewerSocket = null;
let hostCode = null;
let pendingViewerSocketId = null;
let localStream = null;
let hostPeer = null;
let viewerPeer = null;
let viewerCode = null;
let controlAllowed = false;
let statsTimer = null;
let activeProfileId = "auto";
let lastAppliedAdaptiveProfile = "";
let reconnectAttempts = 0;
let mouseFramePending = false;
let latestMouseEvent = null;

function setStatus(text) {
  $("status").innerHTML = `<span></span>${text}`;
}

function formatCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
}

function selectedProfile() {
  return Perf.PROFILES[$("qualityProfile").value] || Perf.PROFILES.auto;
}

function captureConstraints(sourceId) {
  const profile = selectedProfile();
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: profile.width,
        maxHeight: profile.height,
        minFrameRate: Math.min(30, profile.fps),
        maxFrameRate: profile.fps
      }
    }
  };
}

function updateStats(stats) {
  $("statSentFps").textContent = Math.round(stats.sentFps || 0);
  $("statRecvFps").textContent = Math.round(stats.receivedFps || 0);
  $("statPing").textContent = `${Math.round(stats.rttMs || 0)} ms`;
  $("statBitrate").textContent = `${(stats.bitrateMbps || 0).toFixed(1)} Mb/s`;
  $("statLoss").textContent = `${(stats.packetLossPercent || 0).toFixed(1)} %`;
  $("statCodec").textContent = stats.codec || "—";
  $("statResolution").textContent = stats.width && stats.height ? `${stats.width}×${stats.height}` : "—";

  const badge = $("networkBadge");
  if (stats.rttMs > 100 || stats.packetLossPercent > 4) {
    badge.textContent = "Réseau faible";
    badge.className = "badge bad";
  } else if (stats.rttMs > 55 || stats.packetLossPercent > 1.5) {
    badge.textContent = "Réseau moyen";
    badge.className = "badge warn";
  } else {
    badge.textContent = "Réseau bon";
    badge.className = "badge good";
  }

  if (activeProfileId === "auto" && hostPeer) {
    const profile = Perf.getAdaptiveProfile(stats);
    if (profile.id !== lastAppliedAdaptiveProfile) {
      lastAppliedAdaptiveProfile = profile.id;
      Perf.optimizeSender(hostPeer, profile);
      $("statProfile").textContent = profile.name;
    }
  }
}

function startStats(peer) {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = Perf.monitor(peer, updateStats);
}

$("remoteCode").addEventListener("input", (event) => {
  event.target.value = formatCode(event.target.value);
});

$("qualityProfile").addEventListener("change", async () => {
  activeProfileId = $("qualityProfile").value;
  const profile = selectedProfile();
  $("statProfile").textContent = profile.name;
  if (hostPeer) await Perf.optimizeSender(hostPeer, profile);
});

$("createSession").onclick = () => {
  hostSocket.emit("host-create");
  setStatus("Création du code…");
};

hostSocket.on("host-created", ({ code }) => {
  hostCode = code;
  $("hostCode").textContent = formatCode(code);
  setStatus("Code prêt");
});

$("chooseScreen").onclick = async () => {
  const sources = await window.remoteAssist.listSources();
  const grid = $("sourceGrid");
  grid.innerHTML = "";
  $("sourcePicker").classList.remove("hidden");

  for (const source of sources) {
    const button = document.createElement("button");
    button.className = "source";
    button.innerHTML = `<img src="${source.thumbnail}" alt=""><strong>${source.name}</strong>`;
    button.onclick = async () => {
      try {
        if (localStream) localStream.getTracks().forEach((track) => track.stop());
        localStream = await navigator.mediaDevices.getUserMedia(captureConstraints(source.id));
        $("localVideo").srcObject = localStream;
        $("sourcePicker").classList.add("hidden");
        $("stageHint").textContent = "Écran prêt à être partagé";
        setStatus("Écran prêt");
        localStream.getVideoTracks()[0].contentHint = "motion";
        localStream.getVideoTracks()[0].onended = stopAll;
      } catch (error) {
        $("viewerMessage").textContent = error.message;
        setStatus("Partage refusé");
      }
    };
    grid.appendChild(button);
  }
};

$("closePicker").onclick = () => $("sourcePicker").classList.add("hidden");

hostSocket.on("incoming-request", ({ viewerSocketId }) => {
  pendingViewerSocketId = viewerSocketId;
  $("incoming").classList.remove("hidden");
  setStatus("Demande reçue");
});

$("accept").onclick = () => {
  if (!localStream) {
    $("incoming").classList.add("hidden");
    setStatus("Choisissez d’abord un écran");
    return;
  }
  $("incoming").classList.add("hidden");
  hostSocket.emit("host-decision", { viewerSocketId: pendingViewerSocketId, approved: true });
  setStatus("Connexion acceptée");
};

$("refuse").onclick = () => {
  $("incoming").classList.add("hidden");
  hostSocket.emit("host-decision", { viewerSocketId: pendingViewerSocketId, approved: false });
  setStatus("Connexion refusée");
};

function createPeer(socket, code, isHost) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) socket.emit("signal", { code, data: { type: "candidate", candidate: event.candidate } });
  };

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    if (state === "connected") {
      reconnectAttempts = 0;
      setStatus("Connecté");
      startStats(peer);
    } else if (state === "disconnected" || state === "failed") {
      setStatus("Reconnexion…");
      if (!isHost && viewerCode && reconnectAttempts < 3) {
        reconnectAttempts += 1;
        setTimeout(() => $("connect").click(), 1500 * reconnectAttempts);
      }
    } else {
      setStatus(state);
    }
  };

  if (!isHost) {
    peer.ontrack = (event) => {
      $("remoteVideo").srcObject = event.streams[0];
      $("remoteVideo").focus();
      $("stageHint").textContent = "Connexion active";
    };
  }

  return peer;
}

hostSocket.on("viewer-ready", async () => {
  if (!hostCode || !localStream) return setStatus("Choisissez d’abord un écran");

  hostPeer = createPeer(hostSocket, hostCode, true);
  for (const track of localStream.getTracks()) hostPeer.addTrack(track, localStream);

  const profile = selectedProfile();
  await Perf.optimizeSender(hostPeer, profile);
  $("statProfile").textContent = profile.name;

  const offer = await hostPeer.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
  await hostPeer.setLocalDescription(offer);
  hostSocket.emit("signal", { code: hostCode, data: { type: "offer", sdp: hostPeer.localDescription } });
});

hostSocket.on("signal", async ({ data }) => {
  if (!hostPeer) return;
  if (data.type === "answer") await hostPeer.setRemoteDescription(data.sdp);
  if (data.type === "candidate") {
    try { await hostPeer.addIceCandidate(data.candidate); } catch {}
  }
});

$("allowControl").onchange = async (event) => {
  controlAllowed = event.target.checked;
  await window.remoteAssist.setControlEnabled(controlAllowed);
  if (hostCode) hostSocket.emit("set-control", { code: hostCode, allowed: controlAllowed });
  $("controlBadge").textContent = controlAllowed ? "Contrôle autorisé" : "Contrôle désactivé";
  $("controlBadge").className = `badge ${controlAllowed ? "on" : "off"}`;
};

hostSocket.on("remote-input", (payload) => window.remoteAssist.sendRemoteInput(payload));

$("connect").onclick = async () => {
  viewerCode = $("remoteCode").value.replace(/\D/g, "");
  if (viewerCode.length !== 9) return $("viewerMessage").textContent = "Entrez un code à 9 chiffres.";

  if (viewerSocket) viewerSocket.disconnect();
  $("viewerMessage").textContent = "Recherche du PC…";
  setStatus("Recherche…");

  try {
    const result = await fetch(`/api/discover/${viewerCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then((response) => response.json());

    if (!result.ok) {
      $("viewerMessage").textContent = result.error;
      return setStatus("PC introuvable");
    }

    viewerSocket = io(result.url, { transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: 4 });

    viewerSocket.on("connect", () => {
      viewerSocket.emit("viewer-request", { code: viewerCode });
      $("viewerMessage").textContent = "Demande envoyée. Cliquez sur Oui sur l’autre PC.";
    });

    viewerSocket.on("viewer-denied", ({ reason }) => {
      $("viewerMessage").textContent = reason;
      setStatus("Connexion refusée");
    });

    viewerSocket.on("viewer-approved", ({ code }) => {
      viewerPeer = createPeer(viewerSocket, code, false);
      $("viewerMessage").textContent = "Connexion acceptée.";
      setStatus("Connexion acceptée");
    });

    viewerSocket.on("signal", async ({ data }) => {
      if (!viewerPeer) return;
      if (data.type === "offer") {
        await viewerPeer.setRemoteDescription(data.sdp);
        const answer = await viewerPeer.createAnswer();
        await viewerPeer.setLocalDescription(answer);
        viewerSocket.emit("signal", { code: viewerCode, data: { type: "answer", sdp: viewerPeer.localDescription } });
      }
      if (data.type === "candidate") {
        try { await viewerPeer.addIceCandidate(data.candidate); } catch {}
      }
    });

    viewerSocket.on("control-state", ({ allowed }) => {
      controlAllowed = allowed;
      $("controlBadge").textContent = allowed ? "Contrôle autorisé" : "Contrôle désactivé";
      $("controlBadge").className = `badge ${allowed ? "on" : "off"}`;
      $("viewerMessage").textContent = allowed ? "Clavier et souris autorisés." : "Contrôle non autorisé.";
    });

    viewerSocket.on("session-ended", () => {
      $("viewerMessage").textContent = "La session distante a été arrêtée.";
      stopAll();
    });
  } catch (error) {
    $("viewerMessage").textContent = `Erreur : ${error.message}`;
    setStatus("Erreur");
  }
};

function positionFromEvent(event) {
  const video = $("remoteVideo");
  const rect = video.getBoundingClientRect();
  const videoRatio = (video.videoWidth || rect.width) / (video.videoHeight || rect.height);
  const boxRatio = rect.width / rect.height;
  let displayWidth = rect.width, displayHeight = rect.height, offsetX = 0, offsetY = 0;

  if (boxRatio > videoRatio) {
    displayWidth = rect.height * videoRatio;
    offsetX = (rect.width - displayWidth) / 2;
  } else {
    displayHeight = rect.width / videoRatio;
    offsetY = (rect.height - displayHeight) / 2;
  }

  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - offsetX) / displayWidth)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top - offsetY) / displayHeight))
  };
}

function flushMouseMove() {
  mouseFramePending = false;
  if (!latestMouseEvent || !viewerSocket || !controlAllowed || !viewerCode) return;
  viewerSocket.emit("remote-input", {
    code: viewerCode,
    payload: { type: "mousemove", ...positionFromEvent(latestMouseEvent) }
  });
}

$("remoteVideo").addEventListener("mousemove", (event) => {
  latestMouseEvent = event;
  if (!mouseFramePending) {
    mouseFramePending = true;
    requestAnimationFrame(flushMouseMove);
  }
});

for (const type of ["mousedown", "mouseup"]) {
  $("remoteVideo").addEventListener(type, (event) => {
    if (!viewerSocket || !controlAllowed || !viewerCode) return;
    viewerSocket.emit("remote-input", { code: viewerCode, payload: { type, button: event.button, ...positionFromEvent(event) } });
  });
}

$("remoteVideo").addEventListener("contextmenu", (event) => event.preventDefault());
$("remoteVideo").addEventListener("wheel", (event) => {
  if (!viewerSocket || !controlAllowed || !viewerCode) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", { code: viewerCode, payload: { type: "wheel", deltaY: event.deltaY } });
}, { passive: false });

$("remoteVideo").addEventListener("keydown", (event) => {
  if (!viewerSocket || !controlAllowed || !viewerCode) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", {
    code: viewerCode,
    payload: {
      type: "keydown",
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey
    }
  });
});

$("fullscreenBtn").onclick = async () => {
  if (!$("remoteVideo").srcObject) return;
  try { await $("remoteVideo").requestFullscreen(); } catch {}
};

function resetStats() {
  $("statSentFps").textContent = "0";
  $("statRecvFps").textContent = "0";
  $("statPing").textContent = "0 ms";
  $("statBitrate").textContent = "0 Mb/s";
  $("statLoss").textContent = "0 %";
  $("statCodec").textContent = "—";
  $("statResolution").textContent = "—";
}

function stopAll() {
  if (statsTimer) clearInterval(statsTimer);
  if (localStream) localStream.getTracks().forEach((track) => track.stop());
  if (hostPeer) hostPeer.close();
  if (viewerPeer) viewerPeer.close();
  if (viewerSocket) viewerSocket.disconnect();

  localStream = null; hostPeer = null; viewerPeer = null; viewerSocket = null;
  controlAllowed = false; reconnectAttempts = 0;
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("allowControl").checked = false;
  $("controlBadge").textContent = "Contrôle désactivé";
  $("controlBadge").className = "badge off";
  $("stageHint").textContent = "Aucune connexion active";
  resetStats();
  window.remoteAssist.setControlEnabled(false);
  setStatus("Prêt");
}

$("stopSession").onclick = stopAll;
activeProfileId = $("qualityProfile").value;
$("statProfile").textContent = selectedProfile().name;
