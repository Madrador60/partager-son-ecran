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
  getIceServers: () => ipcRenderer.invoke("get-ice-servers")
}));
