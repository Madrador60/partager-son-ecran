"use strict";

function createTrustedIpc(ipcMain, isTrustedEvent) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("IPC_MAIN_REQUIRED");
  if (typeof isTrustedEvent !== "function") throw new TypeError("IPC_TRUST_VALIDATOR_REQUIRED");

  const registered = new Set();

  function handle(channel, listener) {
    if (registered.has(channel)) throw new Error(`IPC_CHANNEL_ALREADY_REGISTERED:${channel}`);
    registered.add(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedEvent(event)) throw new Error("IPC_ORIGIN_DENIED");
      return listener(event, ...args);
    });
  }

  return Object.freeze({ handle, channels: () => [...registered] });
}

module.exports = { createTrustedIpc };
