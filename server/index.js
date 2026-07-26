require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const express = require("express");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { z } = require("zod");
const { Server } = require("socket.io");
const { SessionCode, Permissions, SessionDuration } = require("../src/shared/validation");
const releases = require("../src/services/github-releases");

const SESSION_TTL = 10 * 60_000;
const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_FILE_MB || 25)) * 1024 * 1024;
const configuredOrigins = process.env.PUBLIC_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) || [];
if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
  throw new Error("PUBLIC_ORIGIN est obligatoire en production");
}
const allowedOrigins = configuredOrigins.length ? configuredOrigins : ["http://127.0.0.1:3000", "http://localhost:3000"];
const sessions = new Map();
const socketSession = new Map();

function clean(value, max = 2000) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").slice(0, max);
}

function permissions(value = {}) {
  const control = Boolean(value.control || value.mouse || value.keyboard);
  return { control, mouse: Boolean(value.mouse || control), keyboard: Boolean(value.keyboard || control), clipboard: Boolean(value.clipboard), files: Boolean(value.files), audio: Boolean(value.audio) };
}

function code() {
  let value;
  do value = Array.from({ length: 9 }, () => crypto.randomInt(10)).join("");
  while (sessions.has(value));
  return value;
}

function sessionFor(socket, requestedCode) {
  const currentCode = socketSession.get(socket.id);
  if (!currentCode || (requestedCode && String(requestedCode) !== currentCode)) return null;
  const session = sessions.get(currentCode);
  if (!session || ![session.host, session.viewer].includes(socket.id)) return null;
  return [currentCode, session];
}

function peerOf(socket, session) {
  return socket.id === session.host ? session.viewer : session.host;
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cross-Origin-Resource-Policy": "same-site" });
  next();
});
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "..", "website")));
app.get("/shared/capabilities.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "shared", "capabilities.js")));
app.get("/logo.png", (_req, res) => res.sendFile(path.join(__dirname, "..", "assets", "logo.png")));
app.get("/remote", (_req, res) => res.sendFile(path.join(__dirname, "..", "website", "remote.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "madrador-signal" }));
app.get("/api/ice", (_req, res) => {
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  res.json({ iceServers });
});
app.get("/api/releases/latest", async (_req, res, next) => {
  try {
    const release = await releases.latest("stable");
    res.json({ ...release, directUrl: undefined, downloadUrl: "/api/download/latest/windows" });
  } catch (error) { next(error); }
});
app.get("/api/download/:channel/windows", async (req, res) => {
  try {
    const channel = req.params.channel === "beta" ? "beta" : "stable";
    const release = await releases.latest(channel);
    res.redirect(302, release.directUrl);
  } catch {
    res.redirect(302, "/download-error.html");
  }
});
app.use((error, _req, res, _next) => {
  console.error(JSON.stringify({ level: "error", code: error.message, at: new Date().toISOString() }));
  res.status(503).json({ error: "RELEASE_UNAVAILABLE", message: "La dernière version est momentanément indisponible." });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins },
  maxHttpBufferSize: MAX_FILE_BYTES + 1024 * 1024,
  pingInterval: 10_000,
  pingTimeout: 15_000
});

io.on("connection", (socket) => {
  socket.data.lastInput = 0;

  socket.on("host-create", ({ deviceName, permissions: allowed, durationMinutes = 0 } = {}) => {
    const parsed = z.object({ deviceName: z.string().max(80).optional(), permissions: Permissions.optional(), durationMinutes: SessionDuration }).safeParse({ deviceName, permissions: allowed, durationMinutes });
    if (!parsed.success) return socket.emit("protocol-error", { code: "INVALID_HOST_CREATE" });
    const previous = socketSession.get(socket.id);
    if (previous) sessions.delete(previous);
    const sessionCode = code();
    const expiresAt = parsed.data.durationMinutes === 0 ? null : Date.now() + parsed.data.durationMinutes * 60_000;
    sessions.set(sessionCode, { host: socket.id, viewer: null, pending: new Set(), expiresAt, deviceName: clean(deviceName, 80), permissions: permissions(allowed) });
    socketSession.set(socket.id, sessionCode);
    socket.join(sessionCode);
    socket.emit("host-created", { code: sessionCode, expiresAt });
  });

  socket.on("viewer-request", ({ code: requestedCode, deviceName } = {}) => {
    const parsedCode = SessionCode.safeParse(String(requestedCode || ""));
    if (!parsedCode.success) return socket.emit("viewer-denied", { reason: "Code invalide." });
    const sessionCode = parsedCode.data;
    const session = sessions.get(sessionCode);
    if (!session || (session.expiresAt && session.expiresAt < Date.now()) || session.viewer) return socket.emit("viewer-denied", { reason: "Code invalide, expiré ou déjà utilisé." });
    session.pending.add(socket.id);
    socket.data.pendingCode = sessionCode;
    io.to(session.host).emit("incoming-request", { viewerSocketId: socket.id, deviceName: clean(deviceName, 80) });
  });

  socket.on("host-decision", ({ viewerSocketId, approved, permissions: allowed } = {}) => {
    const entry = sessionFor(socket);
    if (!entry || socket.id !== entry[1].host || !entry[1].pending.has(viewerSocketId)) return;
    const [sessionCode, session] = entry;
    session.pending.delete(viewerSocketId);
    if (!approved) return io.to(viewerSocketId).emit("viewer-denied", { reason: "Connexion refusée." });
    const viewer = io.sockets.sockets.get(viewerSocketId);
    if (!viewer || viewer.data.pendingCode !== sessionCode) return;
    session.viewer = viewerSocketId;
    session.permissions = permissions(allowed);
    socketSession.set(viewerSocketId, sessionCode);
    viewer.join(sessionCode);
    io.to(viewerSocketId).emit("viewer-approved", { code: sessionCode, permissions: session.permissions });
    io.to(session.host).emit("viewer-ready");
  });

  socket.on("signal", ({ code, data } = {}) => {
    const entry = sessionFor(socket, code);
    if (entry && data && ["offer", "answer", "candidate"].includes(data.type)) socket.to(entry[0]).emit("signal", { data });
  });
  socket.on("set-permissions", ({ code, permissions: allowed } = {}) => {
    const entry = sessionFor(socket, code);
    if (!entry || socket.id !== entry[1].host) return;
    entry[1].permissions = permissions(allowed);
    if (entry[1].viewer) io.to(entry[1].viewer).emit("permissions-state", entry[1].permissions);
  });
  socket.on("remote-input", ({ code, payload } = {}) => {
    const entry = sessionFor(socket, code);
    if (!entry || socket.id !== entry[1].viewer || !entry[1].permissions.control) return;
    const now = Date.now();
    if (payload?.type === "mousemove" && now - socket.data.lastInput < 12) return;
    socket.data.lastInput = now;
    io.to(entry[1].host).emit("remote-input", payload);
  });

  for (const event of ["chat-message", "file-offer", "file-decision"]) {
    socket.on(event, (payload = {}) => {
      const entry = sessionFor(socket, payload.code);
      if (!entry) return;
      if (event.startsWith("file") && !entry[1].permissions.files) return;
      const peer = peerOf(socket, entry[1]);
      if (!peer) return;
      if (event === "chat-message") io.to(peer).emit(event, { text: clean(payload.text) });
      else if (event === "file-offer" && Number(payload.size) > 0 && Number(payload.size) <= MAX_FILE_BYTES) io.to(peer).emit(event, { id: clean(payload.id, 150), name: clean(payload.name, 200), type: clean(payload.type, 100), size: Number(payload.size) });
      else if (event === "file-decision") io.to(peer).emit(event, { id: clean(payload.id, 150), accepted: Boolean(payload.accepted) });
    });
  }
  socket.on("clipboard-share", ({ code, text } = {}) => {
    const entry = sessionFor(socket, code);
    if (!entry || !entry[1].permissions.clipboard) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("clipboard-share", { text: clean(text, 100_000) });
  });
  socket.on("file-data", (payload = {}) => {
    const entry = sessionFor(socket, payload.code);
    const bytes = payload.data?.byteLength || payload.data?.length || 0;
    if (!entry || !entry[1].permissions.files || bytes <= 0 || bytes > MAX_FILE_BYTES) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("file-data", { name: clean(payload.name, 200), type: clean(payload.type, 100), size: bytes, data: payload.data });
  });
  socket.on("end-session", ({ code } = {}) => {
    const entry = sessionFor(socket, code);
    if (!entry) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("session-ended");
    sessions.delete(entry[0]);
  });
  socket.on("disconnect", () => {
    const sessionCode = socketSession.get(socket.id);
    socketSession.delete(socket.id);
    const session = sessions.get(sessionCode);
    if (!session) return;
    if (socket.id === session.host) {
      if (session.viewer) io.to(session.viewer).emit("session-ended");
      sessions.delete(sessionCode);
    } else if (socket.id === session.viewer) {
      session.viewer = null;
      io.to(session.host).emit("viewer-left");
    }
  });
});

const cleanup = setInterval(() => {
  for (const [sessionCode, session] of sessions) {
    if (session.expiresAt && session.expiresAt < Date.now() && !session.viewer) {
      io.to(session.host).emit("session-expired");
      sessions.delete(sessionCode);
    }
  }
}, 30_000);
server.on("close", () => clearInterval(cleanup));

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`Madrador Signal listening on ${host}:${server.address().port}`));
}

module.exports = { app, server, io };
