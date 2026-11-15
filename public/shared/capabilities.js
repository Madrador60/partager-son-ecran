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
    const video = { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 2560, maxHeight: 1440, maxFrameRate: 60 } };
    if (audio) {
      // Sous Windows, « desktop » sans identifiant capture le son de tout l'ordinateur.
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "desktop" } }, video });
      } catch {
        // Son indisponible (pilote, autre système) : on partage au moins l'image.
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Le partage d’écran n’est pas disponible dans ce navigateur.");
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio });
}
