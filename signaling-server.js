const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Server } = require("socket.io");

const SESSION_TTL = 10 * 60 * 1000;
const MAX_CHAT = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function randomDigits(length) {
  let value = "";
  for (let i = 0; i < length; i += 1) value += crypto.randomInt(0, 10);
  return value;
}
function getLocalIp() {
  for (const values of Object.values(os.networkInterfaces())) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "127.0.0.1";
}
function safeText(value, max = MAX_CHAT) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

async function startEmbeddedServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: MAX_FILE_BYTES + 1024 * 1024,
    pingInterval: 10000,
    pingTimeout: 15000
  });
  const sessions = new Map();

  app.use(express.json({ limit: "128kb" }));
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/v5-modules.json", (_req, res) => {
    res.sendFile(path.join(__dirname, "v5-modules.json"));
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, sessions: sessions.size }));
  app.get("/api/local-info", (_req, res) => {
    const address = server.address();
    res.json({ ip: getLocalIp(), port: address?.port || null, hostname: os.hostname() });
  });

  function getSessionForSocket(socketId) {
    return [...sessions.entries()].find(([, s]) =>
      s.hostSocketId === socketId || s.approvedViewer === socketId
    );
  }
  function relayToPeer(socket, event, payload) {
    const entry = getSessionForSocket(socket.id);
    if (!entry) return;
    const [code, session] = entry;
    const peer = socket.id === session.hostSocketId ? session.approvedViewer : session.hostSocketId;
    if (peer) io.to(peer).emit(event, { ...payload, code });
  }

  io.on("connection", (socket) => {
    socket.data.lastInput = 0;

    socket.on("host-create", ({ permissions = {}, deviceName = "" } = {}) => {
      let code;
      do code = randomDigits(9); while (sessions.has(code));
      const expiresAt = Date.now() + SESSION_TTL;
      sessions.set(code, {
        hostSocketId: socket.id,
        approvedViewer: null,
        createdAt: Date.now(),
        expiresAt,
        deviceName: safeText(deviceName, 80),
        permissions: {
          control: Boolean(permissions.control),
          clipboard: Boolean(permissions.clipboard),
          files: Boolean(permissions.files),
          audio: Boolean(permissions.audio)
        }
      });
      socket.join(code);
      socket.emit("host-created", { code, expiresAt });
    });

    socket.on("viewer-request", ({ code, deviceName = "" } = {}) => {
      const session = sessions.get(String(code));
      if (!session || session.expiresAt < Date.now()) {
        socket.emit("viewer-denied", { reason: "Code invalide ou expiré." });
        return;
      }
      socket.data.pendingCode = String(code);
      io.to(session.hostSocketId).emit("incoming-request", {
        viewerSocketId: socket.id,
        deviceName: safeText(deviceName, 80)
      });
    });

    socket.on("host-decision", ({ viewerSocketId, approved, permissions = {} } = {}) => {
      const entry = [...sessions.entries()].find(([, s]) => s.hostSocketId === socket.id);
      if (!entry) return;
      const [code, session] = entry;
      if (!approved) {
        io.to(viewerSocketId).emit("viewer-denied", { reason: "Connexion refusée par le PC distant." });
        return;
      }
      session.approvedViewer = viewerSocketId;
      session.permissions = {
        control: Boolean(permissions.control),
        clipboard: Boolean(permissions.clipboard),
        files: Boolean(permissions.files),
        audio: Boolean(permissions.audio)
      };
      io.sockets.sockets.get(viewerSocketId)?.join(code);
      io.to(viewerSocketId).emit("viewer-approved", { code, permissions: session.permissions });
      io.to(session.hostSocketId).emit("viewer-ready", { viewerSocketId });
    });

    socket.on("signal", ({ code, data } = {}) => {
      const session = sessions.get(String(code));
      if (!session) return;
      if (![session.hostSocketId, session.approvedViewer].includes(socket.id)) return;
      socket.to(String(code)).emit("signal", { data });
    });

    socket.on("set-permissions", ({ code, permissions = {} } = {}) => {
      const session = sessions.get(String(code));
      if (!session || socket.id !== session.hostSocketId) return;
      session.permissions = {
        control: Boolean(permissions.control),
        clipboard: Boolean(permissions.clipboard),
        files: Boolean(permissions.files),
        audio: Boolean(permissions.audio)
      };
      if (session.approvedViewer) io.to(session.approvedViewer).emit("permissions-state", session.permissions);
    });

    socket.on("remote-input", ({ code, payload } = {}) => {
      const session = sessions.get(String(code));
      if (!session || !session.permissions.control || socket.id !== session.approvedViewer) return;
      const now = Date.now();
      if (payload?.type === "mousemove" && now - socket.data.lastInput < 6) return;
      socket.data.lastInput = now;
      io.to(session.hostSocketId).emit("remote-input", payload);
    });

    socket.on("chat-message", ({ text } = {}) => relayToPeer(socket, "chat-message", {
      text: safeText(text),
      at: Date.now()
    }));

    socket.on("clipboard-share", ({ text } = {}) => {
      const entry = getSessionForSocket(socket.id);
      if (!entry || !entry[1].permissions.clipboard) return;
      relayToPeer(socket, "clipboard-share", { text: safeText(text, 100000) });
    });

    socket.on("file-offer", (payload = {}) => {
      const entry = getSessionForSocket(socket.id);
      if (!entry || !entry[1].permissions.files) return;
      const size = Number(payload.size || 0);
      if (size <= 0 || size > MAX_FILE_BYTES) return;
      relayToPeer(socket, "file-offer", {
        id: safeText(payload.id, 80),
        name: safeText(payload.name, 200),
        type: safeText(payload.type, 100),
        size
      });
    });
    socket.on("file-decision", (payload = {}) => relayToPeer(socket, "file-decision", {
      id: safeText(payload.id, 80),
      accepted: Boolean(payload.accepted)
    }));
    socket.on("file-data", (payload = {}) => {
      const entry = getSessionForSocket(socket.id);
      if (!entry || !entry[1].permissions.files) return;
      if (!payload.data || Number(payload.size || 0) > MAX_FILE_BYTES) return;
      relayToPeer(socket, "file-data", payload);
    });

    socket.on("disconnect", () => {
      for (const [code, session] of sessions.entries()) {
        if (session.hostSocketId === socket.id) {
          if (session.approvedViewer) io.to(session.approvedViewer).emit("session-ended");
          sessions.delete(code);
        } else if (session.approvedViewer === socket.id) {
          session.approvedViewer = null;
          io.to(session.hostSocketId).emit("viewer-left");
        }
      }
    });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions.entries()) {
      if (session.expiresAt < now && !session.approvedViewer) {
        io.to(session.hostSocketId).emit("session-expired");
        sessions.delete(code);
      }
    }
  }, 30000);
  server.on("close", () => clearInterval(cleanup));

  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, port: server.address().port };
}

if (require.main === module) {
  startEmbeddedServer().then(({ port }) => console.log(`RemoteAssist: http://0.0.0.0:${port}`));
}
module.exports = { startEmbeddedServer };
