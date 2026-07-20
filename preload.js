const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteAssist", {
  systemInfo: () => ipcRenderer.invoke("system-info"),
  listSources: () => ipcRenderer.invoke("list-sources"),
  setControlEnabled: (enabled) => ipcRenderer.invoke("set-control-enabled", enabled),
  sendRemoteInput: (payload) => ipcRenderer.invoke("remote-input", payload),
  clipboardRead: () => ipcRenderer.invoke("clipboard-read"),
  clipboardWrite: (payload) => ipcRenderer.invoke("clipboard-write", payload),
  saveReceivedFile: (file) => ipcRenderer.invoke("save-received-file", file),
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath)
});
