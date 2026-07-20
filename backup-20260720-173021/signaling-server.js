const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Server } = require("socket.io");

function randomDigits(length) {
  let result = "";
  for (let i = 0; i < length; i++) result += crypto.randomInt(0, 10);
  return result;
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "127.0.0.1";
}

async function startEmbeddedServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  const sessions = new Map();

  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/local-info", (_req, res) => {
    const address = server.address();
    res.json({
      ip: getLocalIp(),
      port: address?.port || null
    });
  });

  io.on("connection", socket => {
    socket.on("host-create", () => {
      const id = randomDigits(9);
      const password = randomDigits(6);
      sessions.set(id, {
        hostSocketId: socket.id,
        password,
        approvedViewer: null,
        controlAllowed: false
      });
      socket.join(id);
      socket.emit("host-created", { id, password });
    });

    socket.on("viewer-request", ({ id, password }) => {
      const session = sessions.get(String(id));
      if (!session || session.password !== String(password)) {
        socket.emit("viewer-denied", { reason: "Identifiant ou mot de passe incorrect." });
        return;
      }

      socket.data.pendingSessionId = String(id);
      io.to(session.hostSocketId).emit("incoming-request", {
        viewerSocketId: socket.id
      });
    });

    socket.on("host-decision", ({ viewerSocketId, approved }) => {
      const sessionEntry = [...sessions.entries()].find(([, s]) => s.hostSocketId === socket.id);
      if (!sessionEntry) return;
      const [id, session] = sessionEntry;

      if (!approved) {
        io.to(viewerSocketId).emit("viewer-denied", { reason: "Connexion refusée par le PC distant." });
        return;
      }

      session.approvedViewer = viewerSocketId;
      io.sockets.sockets.get(viewerSocketId)?.join(id);
      io.to(viewerSocketId).emit("viewer-approved", { id });
      io.to(session.hostSocketId).emit("viewer-ready", { viewerSocketId });
    });

    socket.on("signal", ({ id, data }) => {
      const session = sessions.get(String(id));
      if (!session) return;
      const allowed = socket.id === session.hostSocketId || socket.id === session.approvedViewer;
      if (!allowed) return;
      socket.to(String(id)).emit("signal", { from: socket.id, data });
    });

    socket.on("set-control", ({ id, allowed }) => {
      const session = sessions.get(String(id));
      if (!session || socket.id !== session.hostSocketId) return;
      session.controlAllowed = Boolean(allowed);
      if (session.approvedViewer) {
        io.to(session.approvedViewer).emit("control-state", { allowed: session.controlAllowed });
      }
    });

    socket.on("remote-input", ({ id, payload }) => {
      const session = sessions.get(String(id));
      if (!session || !session.controlAllowed || socket.id !== session.approvedViewer) return;
      io.to(session.hostSocketId).emit("remote-input", payload);
    });

    socket.on("disconnect", () => {
      for (const [id, session] of sessions.entries()) {
        if (session.hostSocketId === socket.id) {
          if (session.approvedViewer) io.to(session.approvedViewer).emit("session-ended");
          sessions.delete(id);
        } else if (session.approvedViewer === socket.id) {
          session.approvedViewer = null;
          session.controlAllowed = false;
          io.to(session.hostSocketId).emit("viewer-left");
        }
      }
    });
  });

  await new Promise(resolve => server.listen(0, "0.0.0.0", resolve));
  return { server, port: server.address().port };
}

if (require.main === module) {
  startEmbeddedServer().then(({ port }) => {
    console.log(`Serveur RemoteAssist : http://0.0.0.0:${port}`);
  });
}

module.exports = { startEmbeddedServer };
