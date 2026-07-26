const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { io: connect } = require("socket.io-client");

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

  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  const { server } = require("../server");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  const siteResponse = await fetch(url);
  assert.equal(siteResponse.status, 200);
  assert.match(await siteResponse.text(), /Madrador Remote — Assistance à distance/);
  assert.equal((await fetch(`${url}/site.css`)).status, 200);

  const host = connect(url, { transports: ["websocket"], forceNew: true });
  const viewer = connect(url, { transports: ["websocket"], forceNew: true });
  await Promise.all([once(host, "connect"), once(viewer, "connect")]);

  host.emit("host-create", { deviceName: "Test host", permissions: { control: true } });
  const session = await once(host, "host-created");
  assert.match(session.code, /^\d{9}$/);

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

  viewer.disconnect();
  host.disconnect();
  await new Promise((resolve) => server.close(resolve));
  console.log("✓ Syntaxe, packaging, site, serveur et connexion de session validés.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
