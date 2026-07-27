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
const { createSessionStore } = require("../src/server/sessions/create-session-store");
const { createIceServers } = require("../src/server/turn/ice-config");

const SESSION_TTL = 10 * 60_000;
const RECONNECT_GRACE_MS = Math.max(10_000, Number(process.env.RECONNECT_GRACE_MS || 60_000));
const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_FILE_MB || 25)) * 1024 * 1024;
const configuredOrigins = process.env.PUBLIC_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) || [];
if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
  throw new Error("PUBLIC_ORIGIN est obligatoire en production");
}
const allowedOrigins = configuredOrigins.length ? configuredOrigins : ["http://127.0.0.1:3000", "http://localhost:3000"];
const socketSession = new Map();
const sessionStorePromise = createSessionStore();

function clean(value, max = 2000) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").slice(0, max);
}

function permissions(value = {}) {
  const control = Boolean(value.control || value.mouse || value.keyboard);
  return { control, mouse: Boolean(value.mouse || control), keyboard: Boolean(value.keyboard || control), clipboard: Boolean(value.clipboard), files: Boolean(value.files), audio: Boolean(value.audio) };
}

async function code(store) {
  let value;
  do value = Array.from({ length: 9 }, () => crypto.randomInt(10)).join("");
  while (await store.has(value));
  return value;
}

async function sessionFor(socket, requestedCode) {
  const sessions = await sessionStorePromise;
  const currentCode = socketSession.get(socket.id);
  if (!currentCode || (requestedCode && String(requestedCode) !== currentCode)) return null;
  const session = await sessions.get(currentCode);
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
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
  next();
});
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return res.sendStatus(403);
    res.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.sendStatus(204);
  }
  next();
});
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "..", "website")));
app.get("/shared/capabilities.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "shared", "capabilities.js")));
app.get("/vendor/socket.io.min.js", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "vendor", "socket.io.min.js")));
app.get("/logo.png", (_req, res) => res.sendFile(path.join(__dirname, "..", "assets", "logo.png")));
app.get("/runtime-config.js", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const publicUrl = process.env.MADRADOR_PUBLIC_API_URL || origin;
  const signalUrl = process.env.MADRADOR_SIGNAL_URL || publicUrl;
  res.type("application/javascript").send(`window.MADRADOR_CONFIG=${JSON.stringify({ apiUrl: publicUrl, signalUrl })};`);
});
app.get("/remote", (_req, res) => res.sendFile(path.join(__dirname, "..", "website", "remote.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "madrador-signal" }));
app.get("/api/ice", (_req, res) => {
  res.set("Cache-Control", "private, max-age=240");
  res.json({ iceServers: createIceServers(), temporaryCredentials: Boolean(process.env.MADRADOR_TURN_URL) });
});
app.get("/api/ice/capabilities", (_req, res) => res.json({
  temporaryCredentials: true,
  protocols: ["udp", "tcp", "tls"],
  configured: Boolean(process.env.MADRADOR_TURN_URL)
}));
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

  socket.on("host-create", async ({ deviceName, permissions: allowed, durationMinutes = 0, available = true } = {}) => {
    const parsed = z.object({ deviceName: z.string().max(80).optional(), permissions: Permissions.optional(), durationMinutes: SessionDuration, available: z.boolean() }).safeParse({ deviceName, permissions: allowed, durationMinutes, available });
    if (!parsed.success) return socket.emit("protocol-error", { code: "INVALID_HOST_CREATE" });
    if (!parsed.data.available) return socket.emit("host-unavailable", { reason: "Cet appareil est indisponible." });
    const sessions = await sessionStorePromise;
    const previous = socketSession.get(socket.id);
    if (previous) await sessions.delete(previous);
    const sessionCode = await code(sessions);
    const expiresAt = parsed.data.durationMinutes === 0 ? null : Date.now() + parsed.data.durationMinutes * 60_000;
    const hostResumeToken = crypto.randomBytes(32).toString("base64url");
    await sessions.set(sessionCode, {
      id: crypto.randomUUID(),
      host: socket.id,
      viewer: null,
      pending: new Set(),
      expiresAt,
      available: true,
      hostResumeToken,
      viewerResumeToken: null,
      disconnectedAt: null,
      deviceName: clean(deviceName, 80),
      permissions: permissions(allowed)
    });
    socketSession.set(socket.id, sessionCode);
    socket.join(sessionCode);
    socket.emit("host-created", { code: sessionCode, expiresAt, resumeToken: hostResumeToken });
  });

  socket.on("host-availability", async ({ code: requestedCode, available } = {}) => {
    const entry = await sessionFor(socket, requestedCode);
    if (!entry || socket.id !== entry[1].host) return;
    entry[1].available = Boolean(available);
    const sessions = await sessionStorePromise;
    await sessions.set(entry[0], entry[1]);
    if (!entry[1].available) {
      for (const pendingId of entry[1].pending) io.to(pendingId).emit("viewer-denied", { reason: "Cet appareil est indisponible." });
      entry[1].pending.clear();
      await sessions.set(entry[0], entry[1]);
    }
  });

  socket.on("viewer-request", async ({ code: requestedCode, deviceName } = {}) => {
    const parsedCode = SessionCode.safeParse(String(requestedCode || ""));
    if (!parsedCode.success) return socket.emit("viewer-denied", { reason: "Code invalide." });
    const sessionCode = parsedCode.data;
    const sessions = await sessionStorePromise;
    const session = await sessions.get(sessionCode);
    if (!session || (session.expiresAt && session.expiresAt < Date.now()) || session.viewer) return socket.emit("viewer-denied", { reason: "Code invalide, expiré ou déjà utilisé." });
    if (!session.available || !session.host) return socket.emit("viewer-denied", { reason: "Cet appareil est indisponible." });
    session.pending.add(socket.id);
    socket.data.pendingCode = sessionCode;
    await sessions.set(sessionCode, session);
    io.to(session.host).emit("incoming-request", { viewerSocketId: socket.id, deviceName: clean(deviceName, 80) });
  });

  socket.on("host-decision", async ({ viewerSocketId, approved, permissions: allowed } = {}) => {
    const entry = await sessionFor(socket);
    if (!entry || socket.id !== entry[1].host || !entry[1].pending.has(viewerSocketId)) return;
    const [sessionCode, session] = entry;
    session.pending.delete(viewerSocketId);
    const sessions = await sessionStorePromise;
    if (!approved) {
      await sessions.set(sessionCode, session);
      return io.to(viewerSocketId).emit("viewer-denied", { reason: "Connexion refusée." });
    }
    const viewer = io.sockets.sockets.get(viewerSocketId);
    if (!viewer || viewer.data.pendingCode !== sessionCode) return;
    session.viewer = viewerSocketId;
    session.viewerResumeToken = crypto.randomBytes(32).toString("base64url");
    session.permissions = permissions(allowed);
    await sessions.set(sessionCode, session);
    socketSession.set(viewerSocketId, sessionCode);
    viewer.join(sessionCode);
    io.to(viewerSocketId).emit("viewer-approved", { code: sessionCode, permissions: session.permissions, resumeToken: session.viewerResumeToken });
    io.to(session.host).emit("viewer-ready");
  });

  socket.on("resume-session", async ({ code: requestedCode, resumeToken, role } = {}) => {
    const parsedCode = SessionCode.safeParse(String(requestedCode || ""));
    if (!parsedCode.success || !["host", "viewer"].includes(role)) return socket.emit("resume-denied");
    const sessions = await sessionStorePromise;
    const session = await sessions.get(parsedCode.data);
    const expected = role === "host" ? session?.hostResumeToken : session?.viewerResumeToken;
    const suppliedToken = Buffer.from(String(resumeToken || ""));
    const expectedToken = Buffer.from(String(expected || ""));
    if (!session || !expected || suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(suppliedToken, expectedToken)) return socket.emit("resume-denied");
    session[role] = socket.id;
    session.disconnectedAt = null;
    await sessions.set(parsedCode.data, session);
    socketSession.set(socket.id, parsedCode.data);
    socket.join(parsedCode.data);
    socket.emit("session-resumed", { code: parsedCode.data, permissions: session.permissions, role });
    const peer = role === "host" ? session.viewer : session.host;
    if (peer) io.to(peer).emit("peer-resumed", { role });
  });

  socket.on("signal", async ({ code, data } = {}) => {
    const entry = await sessionFor(socket, code);
    if (entry && data && ["offer", "answer", "candidate"].includes(data.type)) socket.to(entry[0]).emit("signal", { data });
  });
  socket.on("set-permissions", async ({ code, permissions: allowed } = {}) => {
    const entry = await sessionFor(socket, code);
    if (!entry || socket.id !== entry[1].host) return;
    entry[1].permissions = permissions(allowed);
    const sessions = await sessionStorePromise;
    await sessions.set(entry[0], entry[1]);
    if (entry[1].viewer) io.to(entry[1].viewer).emit("permissions-state", entry[1].permissions);
  });
  socket.on("remote-input", async ({ code, payload } = {}) => {
    const entry = await sessionFor(socket, code);
    if (!entry || socket.id !== entry[1].viewer || !entry[1].permissions.control) return;
    const now = Date.now();
    if (payload?.type === "mousemove" && now - socket.data.lastInput < 12) return;
    socket.data.lastInput = now;
    io.to(entry[1].host).emit("remote-input", payload);
  });

  for (const event of ["chat-message", "file-offer", "file-decision"]) {
    socket.on(event, async (payload = {}) => {
      const entry = await sessionFor(socket, payload.code);
      if (!entry) return;
      if (event.startsWith("file") && !entry[1].permissions.files) return;
      const peer = peerOf(socket, entry[1]);
      if (!peer) return;
      if (event === "chat-message") io.to(peer).emit(event, { text: clean(payload.text) });
      else if (event === "file-offer" && Number(payload.size) > 0 && Number(payload.size) <= MAX_FILE_BYTES) io.to(peer).emit(event, { id: clean(payload.id, 150), name: clean(payload.name, 200), type: clean(payload.type, 100), size: Number(payload.size) });
      else if (event === "file-decision") io.to(peer).emit(event, { id: clean(payload.id, 150), accepted: Boolean(payload.accepted) });
    });
  }
  socket.on("clipboard-share", async ({ code, text } = {}) => {
    const entry = await sessionFor(socket, code);
    if (!entry || !entry[1].permissions.clipboard) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("clipboard-share", { text: clean(text, 100_000) });
  });
  socket.on("file-data", async (payload = {}) => {
    const entry = await sessionFor(socket, payload.code);
    const bytes = payload.data?.byteLength || payload.data?.length || 0;
    if (!entry || !entry[1].permissions.files || bytes <= 0 || bytes > MAX_FILE_BYTES) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("file-data", { name: clean(payload.name, 200), type: clean(payload.type, 100), size: bytes, data: payload.data });
  });
  socket.on("end-session", async ({ code } = {}) => {
    const entry = await sessionFor(socket, code);
    if (!entry) return;
    const peer = peerOf(socket, entry[1]);
    if (peer) io.to(peer).emit("session-ended");
    const sessions = await sessionStorePromise;
    await sessions.delete(entry[0]);
  });
  socket.on("disconnect", async () => {
    const sessionCode = socketSession.get(socket.id);
    socketSession.delete(socket.id);
    const sessions = await sessionStorePromise;
    const session = await sessions.get(sessionCode);
    if (!session) return;
    if (socket.id === session.host) {
      session.host = null;
      session.disconnectedAt = Date.now();
      if (session.viewer) io.to(session.viewer).emit("peer-reconnecting", { role: "host", graceMs: RECONNECT_GRACE_MS });
    } else if (socket.id === session.viewer) {
      session.viewer = null;
      session.disconnectedAt = Date.now();
      if (session.host) io.to(session.host).emit("peer-reconnecting", { role: "viewer", graceMs: RECONNECT_GRACE_MS });
    }
    await sessions.set(sessionCode, session);
  });
});

const cleanup = setInterval(async () => {
  const sessions = await sessionStorePromise;
  for (const [sessionCode, session] of await sessions.entries()) {
    const reconnectExpired = session.disconnectedAt && Date.now() - session.disconnectedAt > RECONNECT_GRACE_MS;
    if ((session.expiresAt && session.expiresAt < Date.now() && !session.viewer) || reconnectExpired) {
      if (session.host) io.to(session.host).emit(reconnectExpired ? "session-ended" : "session-expired");
      if (session.viewer) io.to(session.viewer).emit(reconnectExpired ? "session-ended" : "session-expired");
      await sessions.delete(sessionCode);
    }
  }
}, 30_000);
server.on("close", async () => {
  clearInterval(cleanup);
  const sessions = await sessionStorePromise;
  await sessions.close();
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`Madrador Signal listening on ${host}:${server.address().port}`));
}

module.exports = { app, server, io };
