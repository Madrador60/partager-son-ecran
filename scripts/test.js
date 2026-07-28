const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { io: connect } = require("socket.io-client");
const { SessionCode, ControlConfig, RemoteInput } = require("../src/shared/validation");
const { normalize } = require("../src/services/github-releases");
const { MemorySessionStore } = require("../src/server/sessions/memory-session-store");
const { createIceServers } = require("../src/server/turn/ice-config");
const { createTrustedIpc } = require("../src/main/ipc/trusted-ipc");
const { isMadradorServer } = require("../src/main/embedded-server");

const root = path.join(__dirname, "..");

function syntax(file) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Délai dépassé pour ${event}`)), 3000);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function run() {
  [
    "main.js",
    "preload.js",
    "server/index.js",
    "public/app.js",
    "website/site.js"
  ].forEach(syntax);

  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(html, /vendor\/socket\.io\.min\.js/);
  assert.ok(fs.existsSync(path.join(root, "public", "vendor", "socket.io.min.js")));
  assert.ok(require("../package.json").build.files.includes("preload.js"));
  const webRemote = fs.readFileSync(path.join(root, "website", "remote.js"), "utf8");
  assert.match(webRemote, /captureDisplay/);
  assert.match(webRemote, /MADRADOR_CONFIG/);
  assert.doesNotMatch(webRemote, /fetch\("\/api\//);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "website", "remote.html"), "utf8"), /(?:src|href)="\/(?!\/)/);
  assert.match(fs.readFileSync(path.join(root, "public", "shared", "capabilities.js"), "utf8"), /getDisplayMedia/);
  assert.equal(SessionCode.safeParse("123456789").success, true);
  assert.equal(SessionCode.safeParse("123").success, false);
  assert.equal(ControlConfig.safeParse({ enabled: true, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }).success, true);
  assert.equal(RemoteInput.safeParse({ type: "mousemove", x: 2, y: 0 }).success, false);
  const normalizedRelease = normalize({
    tag_name: "v6.1.0", draft: false, prerelease: false, published_at: "2026-01-01T00:00:00Z",
    assets: [
      { name: "Source.zip", browser_download_url: "https://github.com/example/source.zip", size: 1 },
      { name: "Madrador-Remote-Setup-6.1.0.exe", browser_download_url: "https://github.com/example/setup.exe", size: 42 }
    ]
  });
  assert.equal(normalizedRelease.version, "6.1.0");
  assert.equal(normalizedRelease.fileName, "Madrador-Remote-Setup-6.1.0.exe");
  assert.equal(normalizedRelease.releaseNotes, "");
  assert.throws(() => normalize({ draft: true, assets: [] }), /RELEASE_INVALID/);
  assert.throws(() => normalize({ draft: false, assets: [] }), /INSTALLER_NOT_FOUND/);
  const store = new MemorySessionStore();
  await store.set("123456789", { pending: new Set() });
  assert.equal(await store.has("123456789"), true);
  assert.equal((await store.get("123456789")).pending instanceof Set, true);
  await store.delete("123456789");
  assert.equal(await store.has("123456789"), false);
  const turn = createIceServers({
    MADRADOR_TURN_URL: "turn:turn.example.test:3478?transport=udp,turns:turn.example.test:443?transport=tcp",
    MADRADOR_TURN_USERNAME: "madrador",
    MADRADOR_TURN_CREDENTIAL: "server-side-secret"
  }, 0);
  assert.equal(turn.length, 2);
  assert.match(turn[1].username, /^\d+:madrador$/);
  assert.notEqual(turn[1].credential, "server-side-secret");
  let trustedListener;
  const trustedIpc = createTrustedIpc({ handle: (_channel, listener) => { trustedListener = listener; } }, (event) => event.ok);
  trustedIpc.handle("test", () => "ok");
  await assert.rejects(() => trustedListener({ ok: false }), /IPC_ORIGIN_DENIED/);
  assert.equal(await trustedListener({ ok: true }), "ok");

  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  const { server } = require("../server");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(await isMadradorServer(url), true);
  const siteResponse = await fetch(url);
  assert.equal(siteResponse.status, 200);
  assert.match(await siteResponse.text(), /Madrador Remote — Assistance à distance/);
  assert.equal((await fetch(`${url}/site.css`)).status, 200);
  assert.equal((await fetch(`${url}/release-notes.css`)).status, 200);
  assert.equal((await fetch(`${url}/remote`)).status, 200);
  assert.equal((await fetch(`${url}/remote.js`)).status, 200);
  assert.equal((await fetch(`${url}/runtime-config.js`)).status, 200);
  const corsResponse = await fetch(`${url}/api/ice`, { headers: { Origin: "http://localhost:3000" } });
  assert.equal(corsResponse.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const packagedFiles = require("../package.json").build.files;
  assert.ok(packagedFiles.includes("server/**/*"));
  assert.ok(packagedFiles.includes("src/server/**/*"));

  const host = connect(url, { transports: ["websocket"], forceNew: true });
  const viewer = connect(url, { transports: ["websocket"], forceNew: true });
  await Promise.all([once(host, "connect"), once(viewer, "connect")]);

  host.emit("host-create", { deviceName: "Test host", permissions: { control: true } });
  const session = await once(host, "host-created");
  assert.match(session.code, /^\d{9}$/);
  assert.equal(session.expiresAt, null);

  viewer.emit("viewer-request", { code: session.code, deviceName: "Test viewer" });
  const request = await once(host, "incoming-request");
  host.emit("host-decision", {
    viewerSocketId: request.viewerSocketId,
    approved: true,
    permissions: { control: true }
  });
  const approval = await once(viewer, "viewer-approved");
  assert.equal(approval.code, session.code);
  assert.equal(approval.permissions.control, true);

  const viewerSignal = once(viewer, "signal");
  host.emit("signal", { code: session.code, data: { type: "offer", sdp: { type: "offer", sdp: "test-host-offer" } } });
  assert.equal((await viewerSignal).data.sdp.sdp, "test-host-offer");
  const hostSignal = once(host, "signal");
  viewer.emit("signal", { code: session.code, data: { type: "answer", sdp: { type: "answer", sdp: "test-viewer-answer" } } });
  assert.equal((await hostSignal).data.sdp.sdp, "test-viewer-answer");

  const reconnecting = once(host, "peer-reconnecting");
  viewer.disconnect();
  await reconnecting;
  const recoveredViewer = connect(url, { transports: ["websocket"], forceNew: true });
  await once(recoveredViewer, "connect");
  recoveredViewer.emit("resume-session", { code: session.code, resumeToken: approval.resumeToken, role: "viewer" });
  const resumed = await once(recoveredViewer, "session-resumed");
  assert.equal(resumed.code, session.code);
  assert.equal(resumed.permissions.control, true);

  const limitedHost = connect(url, { transports: ["websocket"], forceNew: true });
  const rejectedViewer = connect(url, { transports: ["websocket"], forceNew: true });
  await Promise.all([once(limitedHost, "connect"), once(rejectedViewer, "connect")]);
  limitedHost.emit("host-create", { deviceName: "Limited browser", durationMinutes: 1, permissions: {} });
  const limitedSession = await once(limitedHost, "host-created");
  assert.ok(limitedSession.expiresAt > Date.now() + 50_000 && limitedSession.expiresAt <= Date.now() + 60_000);
  rejectedViewer.emit("viewer-request", { code: limitedSession.code, deviceName: "Rejected browser" });
  const rejectedRequest = await once(limitedHost, "incoming-request");
  limitedHost.emit("host-decision", { viewerSocketId: rejectedRequest.viewerSocketId, approved: false });
  assert.match((await once(rejectedViewer, "viewer-denied")).reason, /refusée/i);

  const unavailableHost = connect(url, { transports: ["websocket"], forceNew: true });
  await once(unavailableHost, "connect");
  unavailableHost.emit("host-create", { deviceName: "Unavailable", available: false });
  assert.match((await once(unavailableHost, "host-unavailable")).reason, /indisponible/i);

  recoveredViewer.emit("end-session", { code: session.code });
  recoveredViewer.disconnect();
  limitedHost.disconnect();
  rejectedViewer.disconnect();
  unavailableHost.disconnect();
  host.disconnect();
  await new Promise((resolve) => server.close(resolve));
  console.log("✓ Syntaxe, packaging, site, serveur et connexion de session validés.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
