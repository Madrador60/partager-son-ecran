const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteAssist", Object.freeze({
  systemInfo: () => ipcRenderer.invoke("system-info"),
  listSources: () => ipcRenderer.invoke("list-sources"),
  setControlEnabled: (value) => ipcRenderer.invoke("set-control-enabled", value),
  sendRemoteInput: (value) => ipcRenderer.invoke("remote-input", value),
  clipboardRead: () => ipcRenderer.invoke("clipboard-read"),
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard-write", text),
  saveReceivedFile: (file) => ipcRenderer.invoke("save-file", file),
  getSignalUrl: () => ipcRenderer.invoke("get-signal-url"),
  getIceServers: () => ipcRenderer.invoke("get-ice-servers"),
  setHostCode: (code) => ipcRenderer.invoke("set-host-code", code),
  setSessionActive: (active) => ipcRenderer.invoke("set-session-active", active),
  showNotification: (payload) => ipcRenderer.invoke("show-notification", payload),
  updateAction: (action) => ipcRenderer.invoke("update-action", action),
  onAvailabilityChanged: (callback) => ipcRenderer.on("availability-changed", (_event, value) => callback(value)),
  onStopConnections: (callback) => ipcRenderer.on("stop-connections", callback),
  onUpdaterStatus: (callback) => ipcRenderer.on("updater-status", (_event, value) => callback(value)),
  onOpenUpdateDialog: (callback) => ipcRenderer.on("open-update-dialog", callback)
}));
