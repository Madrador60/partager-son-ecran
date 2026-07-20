const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteAssist", {
  listSources: () => ipcRenderer.invoke("list-sources"),
  setControlEnabled: enabled => ipcRenderer.invoke("set-control-enabled", enabled),
  sendRemoteInput: payload => ipcRenderer.invoke("remote-input", payload)
});
