const $ = (id) => document.getElementById(id);

const hostSocket = io();
let viewerSocket = null;
let hostCode = null;
let pendingViewerSocketId = null;
let localStream = null;
let hostPeer = null;
let viewerPeer = null;
let viewerCode = null;
let controlAllowed = false;

function setStatus(text) {
  $("status").innerHTML = `<span></span>${text}`;
}

function formatCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(?=\d)/g, "$1 ");
}

$("remoteCode").addEventListener("input", (event) => {
  event.target.value = formatCode(event.target.value);
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
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: source.id,
              maxFrameRate: 60
            }
          }
        });

        $("localVideo").srcObject = localStream;
        $("sourcePicker").classList.add("hidden");
        $("stageHint").textContent = "Écran prêt à être partagé";
        setStatus("Écran prêt");
        localStream.getVideoTracks()[0].onended = stopAll;
      } catch {
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
  $("incoming").classList.add("hidden");
  hostSocket.emit("host-decision", {
    viewerSocketId: pendingViewerSocketId,
    approved: true
  });
  setStatus("Connexion acceptée");
};

$("refuse").onclick = () => {
  $("incoming").classList.add("hidden");
  hostSocket.emit("host-decision", {
    viewerSocketId: pendingViewerSocketId,
    approved: false
  });
  setStatus("Connexion refusée");
};

function createPeer(socket, code, isHost) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        code,
        data: { type: "candidate", candidate: event.candidate }
      });
    }
  };

  peer.onconnectionstatechange = () => {
    setStatus(peer.connectionState === "connected" ? "Connecté" : peer.connectionState);
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
  if (!hostCode || !localStream) {
    setStatus("Choisissez d’abord un écran");
    return;
  }

  hostPeer = createPeer(hostSocket, hostCode, true);
  for (const track of localStream.getTracks()) {
    hostPeer.addTrack(track, localStream);
  }

  const offer = await hostPeer.createOffer({
    offerToReceiveVideo: false,
    offerToReceiveAudio: false
  });
  await hostPeer.setLocalDescription(offer);

  hostSocket.emit("signal", {
    code: hostCode,
    data: { type: "offer", sdp: hostPeer.localDescription }
  });
});

hostSocket.on("signal", async ({ data }) => {
  if (!hostPeer) return;
  if (data.type === "answer") await hostPeer.setRemoteDescription(data.sdp);
  if (data.type === "candidate") await hostPeer.addIceCandidate(data.candidate);
});

$("allowControl").onchange = async (event) => {
  controlAllowed = event.target.checked;
  await window.remoteAssist.setControlEnabled(controlAllowed);

  if (hostCode) {
    hostSocket.emit("set-control", {
      code: hostCode,
      allowed: controlAllowed
    });
  }

  $("controlBadge").textContent = controlAllowed ? "Contrôle autorisé" : "Contrôle désactivé";
  $("controlBadge").className = `badge ${controlAllowed ? "on" : "off"}`;
  setStatus(controlAllowed ? "Contrôle autorisé" : "Contrôle désactivé");
};

hostSocket.on("remote-input", (payload) => {
  window.remoteAssist.sendRemoteInput(payload);
});

$("connect").onclick = async () => {
  viewerCode = $("remoteCode").value.replace(/\D/g, "");

  if (viewerCode.length !== 9) {
    $("viewerMessage").textContent = "Entrez un code à 9 chiffres.";
    return;
  }

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
      setStatus("PC introuvable");
      return;
    }

    viewerSocket = io(result.url, { transports: ["websocket", "polling"] });

    viewerSocket.on("connect", () => {
      viewerSocket.emit("viewer-request", { code: viewerCode });
      $("viewerMessage").textContent = "Demande envoyée. Cliquez sur Oui sur l’autre PC.";
    });

    viewerSocket.on("viewer-denied", ({ reason }) => {
      $("viewerMessage").textContent = reason;
      setStatus("Connexion refusée");
    });

    viewerSocket.on("viewer-approved", async ({ code }) => {
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

        viewerSocket.emit("signal", {
          code: viewerCode,
          data: { type: "answer", sdp: viewerPeer.localDescription }
        });
      }

      if (data.type === "candidate") {
        await viewerPeer.addIceCandidate(data.candidate);
      }
    });

    viewerSocket.on("control-state", ({ allowed }) => {
      controlAllowed = allowed;
      $("controlBadge").textContent = allowed ? "Contrôle autorisé" : "Contrôle désactivé";
      $("controlBadge").className = `badge ${allowed ? "on" : "off"}`;
      $("viewerMessage").textContent = allowed
        ? "Vous pouvez utiliser le clavier et la souris."
        : "Le PC distant n’a pas autorisé le contrôle.";
    });

    viewerSocket.on("session-ended", () => {
      $("viewerMessage").textContent = "La session distante a été arrêtée.";
      stopAll();
    });
  } catch (error) {
    $("viewerMessage").textContent = "Erreur de recherche : " + error.message;
    setStatus("Erreur");
  }
};

function positionFromEvent(event) {
  const rect = $("remoteVideo").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

$("remoteVideo").addEventListener("mousemove", (event) => {
  if (!viewerSocket || !controlAllowed || !viewerCode) return;
  viewerSocket.emit("remote-input", {
    code: viewerCode,
    payload: { type: "mousemove", ...positionFromEvent(event) }
  });
});

for (const type of ["mousedown", "mouseup"]) {
  $("remoteVideo").addEventListener(type, (event) => {
    if (!viewerSocket || !controlAllowed || !viewerCode) return;
    viewerSocket.emit("remote-input", {
      code: viewerCode,
      payload: { type, button: event.button }
    });
  });
}

$("remoteVideo").addEventListener("contextmenu", (event) => event.preventDefault());

$("remoteVideo").addEventListener("wheel", (event) => {
  if (!viewerSocket || !controlAllowed || !viewerCode) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", {
    code: viewerCode,
    payload: { type: "wheel", deltaY: event.deltaY }
  });
}, { passive: false });

$("remoteVideo").addEventListener("keydown", (event) => {
  if (!viewerSocket || !controlAllowed || !viewerCode) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", {
    code: viewerCode,
    payload: { type: "keydown", key: event.key }
  });
});

function stopAll() {
  if (localStream) localStream.getTracks().forEach((track) => track.stop());
  if (hostPeer) hostPeer.close();
  if (viewerPeer) viewerPeer.close();
  if (viewerSocket) viewerSocket.disconnect();

  localStream = null;
  hostPeer = null;
  viewerPeer = null;
  viewerSocket = null;
  controlAllowed = false;

  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("allowControl").checked = false;
  $("controlBadge").textContent = "Contrôle désactivé";
  $("controlBadge").className = "badge off";
  $("stageHint").textContent = "Aucune connexion active";
  window.remoteAssist.setControlEnabled(false);
  setStatus("Prêt");
}

$("stopSession").onclick = stopAll;
