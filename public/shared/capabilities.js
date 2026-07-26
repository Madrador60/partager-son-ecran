export function detectPlatform(bridge = window.remoteAssist) {
  const electron = Boolean(bridge?.listSources);
  return {
    kind: electron ? "electron" : "browser",
    displayCapture: electron || Boolean(navigator.mediaDevices?.getDisplayMedia),
    systemControl: electron,
    unattendedAccess: electron,
    clipboardRead: electron || Boolean(navigator.clipboard?.readText),
    audioCapture: Boolean(navigator.mediaDevices?.getDisplayMedia)
  };
}

export async function captureDisplay({ bridge = window.remoteAssist, sourceId, audio = false } = {}) {
  if (bridge?.listSources && sourceId) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 2560, maxHeight: 1440, maxFrameRate: 60 } }
    });
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Le partage d’écran n’est pas disponible dans ce navigateur.");
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio });
}
