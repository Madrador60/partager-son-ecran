const $ = id => document.getElementById(id);

let hostSocket = io();
let viewerSocket = null;
let hostSessionId = null;
let pendingViewerSocketId = null;
let localStream = null;
let peer = null;
let viewerPeer = null;
let controlAllowed = false;

function setStatus(text) {
  $("status").textContent = text;
}

async function loadLocalInfo() {
  const info = await fetch("/api/local-info").then(r => r.json());
  $("localUrl").textContent = `http://${info.ip}:${info.port}`;
}
loadLocalInfo();

$("createSession").onclick = () => {
  hostSocket.emit("host-create");
};

hostSocket.on("host-created", ({ id, password }) => {
  hostSessionId = id;
  $("hostId").textContent = id;
  $("hostPassword").textContent = password;
  setStatus("Session créée");
});

$("chooseScreen").onclick = async () => {
  const sources = await window.remoteAssist.listSources();
  const container = $("sourcePicker");
  container.innerHTML = "";
  container.classList.remove("hidden");

  for (const source of sources) {
    const card = document.createElement("button");
    card.className = "source";
    card.innerHTML = `<img src="${source.thumbnail}" alt=""><strong>${source.name}</strong>`;
    card.onclick = async () => {
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
        container.classList.add("hidden");
        setStatus("Écran prêt");

        localStream.getVideoTracks()[0].onended = stopAll;
      } catch (error) {
        setStatus("Partage refusé");
      }
    };
    container.appendChild(card);
  }
};

hostSocket.on("incoming-request", ({ viewerSocketId }) => {
  pendingViewerSocketId = viewerSocketId;
  $("incoming").classList.remove("hidden");
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
};

function createPeer(socket, roomId, isHost) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("signal", {
        id: roomId,
        data: { type: "candidate", candidate: event.candidate }
      });
    }
  };

  pc.onconnectionstatechange = () => setStatus(pc.connectionState);

  if (!isHost) {
    pc.ontrack = event => {
      $("remoteVideo").srcObject = event.streams[0];
      $("remoteVideo").focus();
      setStatus("Connecté");
    };
  }

  return pc;
}

hostSocket.on("viewer-ready", async () => {
  if (!hostSessionId || !localStream) {
    setStatus("Choisis d’abord un écran");
    return;
  }

  peer = createPeer(hostSocket, hostSessionId, true);
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  hostSocket.emit("signal", {
    id: hostSessionId,
    data: { type: "offer", sdp: peer.localDescription }
  });
});

hostSocket.on("signal", async ({ data }) => {
  if (!peer) return;
  if (data.type === "answer") await peer.setRemoteDescription(data.sdp);
  if (data.type === "candidate") await peer.addIceCandidate(data.candidate);
});

$("allowControl").onchange = async event => {
  controlAllowed = event.target.checked;
  await window.remoteAssist.setControlEnabled(controlAllowed);

  if (hostSessionId) {
    hostSocket.emit("set-control", {
      id: hostSessionId,
      allowed: controlAllowed
    });
  }

  setStatus(controlAllowed ? "Contrôle autorisé" : "Contrôle désactivé");
};

hostSocket.on("remote-input", payload => {
  window.remoteAssist.sendRemoteInput(payload);
});

$("connect").onclick = () => {
  const base = $("serverUrl").value.trim().replace(/\/$/, "");
  const id = $("remoteId").value.trim();
  const password = $("remotePassword").value.trim();

  if (!base || !id || !password) {
    $("viewerMessage").textContent = "Remplis l’adresse, l’identifiant et le mot de passe.";
    return;
  }

  viewerSocket = io(base, { transports: ["websocket", "polling"] });

  viewerSocket.on("connect", () => {
    viewerSocket.emit("viewer-request", { id, password });
    $("viewerMessage").textContent = "Demande envoyée. Attends l’acceptation.";
  });

  viewerSocket.on("connect_error", error => {
    $("viewerMessage").textContent = "Connexion impossible : " + error.message;
  });

  viewerSocket.on("viewer-denied", ({ reason }) => {
    $("viewerMessage").textContent = reason;
  });

  viewerSocket.on("viewer-approved", async ({ id: approvedId }) => {
    viewerPeer = createPeer(viewerSocket, approvedId, false);
    $("viewerMessage").textContent = "Connexion acceptée.";
  });

  viewerSocket.on("signal", async ({ data }) => {
    if (!viewerPeer) return;

    if (data.type === "offer") {
      await viewerPeer.setRemoteDescription(data.sdp);
      const answer = await viewerPeer.createAnswer();
      await viewerPeer.setLocalDescription(answer);

      viewerSocket.emit("signal", {
        id,
        data: { type: "answer", sdp: viewerPeer.localDescription }
      });
    }

    if (data.type === "candidate") {
      await viewerPeer.addIceCandidate(data.candidate);
    }
  });

  viewerSocket.on("control-state", ({ allowed }) => {
    controlAllowed = allowed;
    $("viewerMessage").textContent = allowed
      ? "Le contrôle clavier/souris est autorisé."
      : "Le contrôle clavier/souris est désactivé.";
  });
};

function normalizedPosition(event) {
  const rect = $("remoteVideo").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

$("remoteVideo").addEventListener("mousemove", event => {
  if (!viewerSocket || !controlAllowed) return;
  const pos = normalizedPosition(event);
  viewerSocket.emit("remote-input", {
    id: $("remoteId").value.trim(),
    payload: { type: "mousemove", ...pos }
  });
});

for (const type of ["mousedown", "mouseup"]) {
  $("remoteVideo").addEventListener(type, event => {
    if (!viewerSocket || !controlAllowed) return;
    viewerSocket.emit("remote-input", {
      id: $("remoteId").value.trim(),
      payload: { type, button: event.button }
    });
  });
}

$("remoteVideo").addEventListener("wheel", event => {
  if (!viewerSocket || !controlAllowed) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", {
    id: $("remoteId").value.trim(),
    payload: { type: "wheel", deltaY: event.deltaY }
  });
}, { passive: false });

$("remoteVideo").addEventListener("keydown", event => {
  if (!viewerSocket || !controlAllowed) return;
  event.preventDefault();
  viewerSocket.emit("remote-input", {
    id: $("remoteId").value.trim(),
    payload: { type: "keydown", key: event.key }
  });
});

function stopAll() {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (peer) peer.close();
  if (viewerPeer) viewerPeer.close();
  localStream = null;
  peer = null;
  viewerPeer = null;
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("allowControl").checked = false;
  window.remoteAssist.setControlEnabled(false);
  setStatus("Session arrêtée");
}

$("stopSession").onclick = stopAll;
