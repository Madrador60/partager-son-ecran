"use strict";

const DEFAULT_PORT = 3000;

async function isMadradorServer(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = response.ok ? await response.json() : null;
    return body?.ok === true && body?.service === "madrador-signal";
  } catch {
    return false;
  }
}

async function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function startEmbeddedServer({ port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  const requestedUrl = `http://${host}:${port}`;
  if (await isMadradorServer(requestedUrl)) {
    return { url: requestedUrl, managed: false, server: null };
  }

  const { server } = require("../../server");
  try {
    await listen(server, port, host);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    await listen(server, 0, host);
  }

  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    managed: true,
    server
  };
}

async function stopEmbeddedServer(instance) {
  if (!instance?.managed || !instance.server?.listening) return;
  await new Promise((resolve) => instance.server.close(resolve));
}

module.exports = { DEFAULT_PORT, isMadradorServer, startEmbeddedServer, stopEmbeddedServer };
