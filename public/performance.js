window.RemoteAssistPerformance = (() => {
  const PROFILES = {
    auto: {
      id: "auto",
      name: "Automatique",
      width: 1920,
      height: 1080,
      fps: 120,
      maxBitrate: 45_000_000
    },
    ultra: {
      id: "ultra",
      name: "Ultra fluidité",
      width: 1920,
      height: 1080,
      fps: 120,
      maxBitrate: 45_000_000
    },
    balanced: {
      id: "balanced",
      name: "Équilibré",
      width: 1920,
      height: 1080,
      fps: 60,
      maxBitrate: 24_000_000
    },
    quality: {
      id: "quality",
      name: "Qualité",
      width: 2560,
      height: 1440,
      fps: 60,
      maxBitrate: 40_000_000
    },
    low: {
      id: "low",
      name: "Connexion faible",
      width: 1280,
      height: 720,
      fps: 60,
      maxBitrate: 10_000_000
    }
  };

  async function optimizeSender(peer, profile) {
    const sender = peer?.getSenders?.().find((item) => item.track?.kind === "video");
    if (!sender) return false;

    const params = sender.getParameters();
    params.degradationPreference = "maintain-framerate";
    params.encodings = params.encodings?.length ? params.encodings : [{}];

    params.encodings[0].maxBitrate = profile.maxBitrate;
    params.encodings[0].maxFramerate = profile.fps;
    params.encodings[0].priority = "high";
    params.encodings[0].networkPriority = "high";

    try {
      await sender.setParameters(params);
      return true;
    } catch (error) {
      console.warn("Réglages WebRTC avancés indisponibles :", error);
      return false;
    }
  }

  function getAdaptiveProfile(stats) {
    if (stats.rttMs > 100 || stats.packetLossPercent > 4) return PROFILES.low;
    if (stats.rttMs > 55 || stats.packetLossPercent > 1.5) return PROFILES.balanced;
    return PROFILES.ultra;
  }

  function monitor(peer, callback) {
    let previousBytes = 0;
    let previousTime = performance.now();

    return setInterval(async () => {
      if (!peer || peer.connectionState === "closed") return;

      const stats = await peer.getStats();
      const report = {
        sentFps: 0,
        receivedFps: 0,
        bitrateMbps: 0,
        rttMs: 0,
        packetsLost: 0,
        packetsReceived: 0,
        packetLossPercent: 0,
        codec: "—",
        width: 0,
        height: 0
      };

      stats.forEach((item) => {
        if (item.type === "outbound-rtp" && item.kind === "video") {
          const now = performance.now();
          const elapsedSeconds = Math.max(0.001, (now - previousTime) / 1000);
          const bytes = item.bytesSent || 0;
          report.bitrateMbps = Math.max(0, ((bytes - previousBytes) * 8 / elapsedSeconds) / 1_000_000);
          report.sentFps = item.framesPerSecond || 0;
          report.width = item.frameWidth || report.width;
          report.height = item.frameHeight || report.height;
          previousBytes = bytes;
          previousTime = now;
        }

        if (item.type === "inbound-rtp" && item.kind === "video") {
          report.receivedFps = item.framesPerSecond || 0;
          report.packetsLost = item.packetsLost || 0;
          report.packetsReceived = item.packetsReceived || 0;
          report.width = item.frameWidth || report.width;
          report.height = item.frameHeight || report.height;
        }

        if (item.type === "remote-inbound-rtp" && item.kind === "video") {
          report.rttMs = Math.round((item.roundTripTime || 0) * 1000);
          report.packetsLost = item.packetsLost || report.packetsLost;
        }

        if (item.type === "candidate-pair" && item.state === "succeeded" && item.currentRoundTripTime) {
          report.rttMs = Math.round(item.currentRoundTripTime * 1000);
        }

        if (item.type === "codec" && item.mimeType?.startsWith("video/")) {
          report.codec = item.mimeType.replace("video/", "");
        }
      });

      const totalPackets = report.packetsReceived + Math.max(0, report.packetsLost);
      report.packetLossPercent = totalPackets
        ? Math.max(0, report.packetsLost / totalPackets * 100)
        : 0;

      callback(report);
    }, 1000);
  }

  return { PROFILES, optimizeSender, getAdaptiveProfile, monitor };
})();
