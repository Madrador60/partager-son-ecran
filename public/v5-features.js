window.MadradorV5 = (() => {
  const state = {
    recording: false,
    recorder: null,
    chunks: [],
    diagnostic: "En attente",
    theme: localStorage.getItem("madrador-theme") || "dark"
  };

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("madrador-theme", theme);
  }

  function diagnose(stats) {
    if (!stats) return "Aucune donnée";
    if (stats.rtt > 120 || stats.loss > 5) return "Connexion faible : passez en 720p.";
    if (stats.rtt > 60 || stats.loss > 2) return "Connexion moyenne : utilisez 1080p60.";
    if (stats.sent < 45 && stats.recv < 45) return "FPS faibles : vérifiez le GPU et la capture.";
    return "Connexion excellente.";
  }

  async function startRecording(videoElement) {
    if (!videoElement?.srcObject) throw new Error("Aucun flux vidéo actif.");
    const mimeTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm"
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
    state.chunks = [];
    state.recorder = new MediaRecorder(videoElement.srcObject, mimeType ? { mimeType } : undefined);
    state.recorder.ondataavailable = (event) => {
      if (event.data?.size) state.chunks.push(event.data);
    };
    state.recorder.start(1000);
    state.recording = true;
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!state.recorder || !state.recording) {
        reject(new Error("Aucun enregistrement actif."));
        return;
      }
      state.recorder.onstop = () => {
        const blob = new Blob(state.chunks, { type: state.recorder.mimeType || "video/webm" });
        state.recording = false;
        resolve(blob);
      };
      state.recorder.stop();
    });
  }

  function downloadRecording(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Madrador-Session-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return { state, setTheme, diagnose, startRecording, stopRecording, downloadRecording };
})();
