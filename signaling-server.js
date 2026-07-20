const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const dgram = require("dgram");
const { Server } = require("socket.io");

const DISCOVERY_PORT = 41234;

function randomCode() {
  return String(crypto.randomInt(100000000, 999999999));
}

function localIPv4() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
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
  app.get("/api/info", (_req, res) => {
    res.json({ ip: localIPv4(), port: server.address()?.port || null });
  });

  io.on("connection", (socket) => {
    socket.on("host-create", () => {
      let code;
      do code = randomCode();
      while (sessions.has(code));

      sessions.set(code, {
        hostSocketId: socket.id,
        viewerSocketId: null,
        controlAllowed: false
      });

      socket.data.hostCode = code;
      socket.join(code);
      socket.emit("host-created", { code });
    });

    socket.on("viewer-request", ({ code }) => {
      const session = sessions.get(String(code));
      if (!session) {
        socket.emit("viewer-denied", { reason: "Code introuvable sur ce réseau." });
        return;
      }

      socket.data.pendingCode = String(code);
      io.to(session.hostSocketId).emit("incoming-request", {
        viewerSocketId: socket.id,
        code: String(code)
      });
    });

    socket.on("host-decision", ({ viewerSocketId, approved }) => {
      const code = socket.data.hostCode;
      const session = sessions.get(code);
      if (!session || session.hostSocketId !== socket.id) return;

      if (!approved) {
        io.to(viewerSocketId).emit("viewer-denied", {
          reason: "Connexion refusée par le PC distant."
        });
        return;
      }

      session.viewerSocketId = viewerSocketId;
      io.sockets.sockets.get(viewerSocketId)?.join(code);
      io.to(viewerSocketId).emit("viewer-approved", { code });
      io.to(session.hostSocketId).emit("viewer-ready");
    });

    socket.on("signal", ({ code, data }) => {
      const session = sessions.get(String(code));
      if (!session) return;
      const allowed =
        socket.id === session.hostSocketId ||
        socket.id === session.viewerSocketId;
      if (!allowed) return;
      socket.to(String(code)).emit("signal", { data });
    });

    socket.on("set-control", ({ code, allowed }) => {
      const session = sessions.get(String(code));
      if (!session || session.hostSocketId !== socket.id) return;
      session.controlAllowed = Boolean(allowed);
      if (session.viewerSocketId) {
        io.to(session.viewerSocketId).emit("control-state", {
          allowed: session.controlAllowed
        });
      }
    });

    socket.on("remote-input", ({ code, payload }) => {
      const session = sessions.get(String(code));
      if (!session || !session.controlAllowed) return;
      if (socket.id !== session.viewerSocketId) return;
      io.to(session.hostSocketId).emit("remote-input", payload);
    });

    socket.on("disconnect", () => {
      for (const [code, session] of sessions.entries()) {
        if (session.hostSocketId === socket.id) {
          if (session.viewerSocketId) {
            io.to(session.viewerSocketId).emit("session-ended");
          }
          sessions.delete(code);
        } else if (session.viewerSocketId === socket.id) {
          session.viewerSocketId = null;
          session.controlAllowed = false;
          io.to(session.hostSocketId).emit("viewer-left");
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;

  const discoverySocket = dgram.createSocket("udp4");
  discoverySocket.on("message", (message, remote) => {
    try {
      const data = JSON.parse(message.toString("utf8"));
      if (data.type !== "REMOTEASSIST_LOOKUP") return;

      const session = sessions.get(String(data.code));
      if (!session) return;

      const response = Buffer.from(JSON.stringify({
        type: "REMOTEASSIST_FOUND",
        code: String(data.code),
        url: `http://${localIPv4()}:${port}`
      }));

      discoverySocket.send(response, remote.port, remote.address);
    } catch {}
  });

  discoverySocket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
    discoverySocket.setBroadcast(true);
  });

  app.post("/api/discover/:code", express.json(), async (req, res) => {
    const code = String(req.params.code || "").trim();
    const probe = dgram.createSocket("udp4");
    const message = Buffer.from(JSON.stringify({
      type: "REMOTEASSIST_LOOKUP",
      code
    }));

    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { probe.close(); } catch {}
      res.json(payload);
    };

    probe.on("message", (buffer) => {
      try {
        const data = JSON.parse(buffer.toString("utf8"));
        if (data.type === "REMOTEASSIST_FOUND" && data.code === code) {
          finish({ ok: true, url: data.url });
        }
      } catch {}
    });

    probe.bind(0, "0.0.0.0", () => {
      probe.setBroadcast(true);
      probe.send(message, DISCOVERY_PORT, "255.255.255.255");
    });

    const timer = setTimeout(() => finish({
      ok: false,
      error: "PC introuvable sur le même réseau."
    }), 3500);
  });

  return { server, discoverySocket, port };
}

if (require.main === module) {
  startEmbeddedServer().then(({ port }) => {
    console.log(`RemoteAssist démarré sur le port ${port}`);
  });
}

module.exports = { startEmbeddedServer };
