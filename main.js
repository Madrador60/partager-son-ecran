require("dotenv").config();
const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, ipcMain, desktopCapturer, screen, clipboard, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const { ControlConfig, RemoteInput, SaveFile } = require("./src/shared/validation");
const { createTrustedIpc } = require("./src/main/ipc/trusted-ipc");
const { createIceServers } = require("./src/server/turn/ice-config");
const { startEmbeddedServer, stopEmbeddedServer } = require("./src/main/embedded-server");

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let window;
let splash;
let tray;
let currentHostCode = "";
let available = true;
let sessionActive = false;
let rendererReady = false;
let lastUpdaterStatus = { status: "idle" };
let remoteControl = { enabled: false, bounds: null };
let embeddedServer = null;

function isTrusted(event) {
  const url = event.senderFrame?.url || "";
  const expected = pathToFileURL(path.join(__dirname, "public", "index.html")).href;
  return url === expected;
}

const trustedIpc = createTrustedIpc(ipcMain, isTrusted);

function createWindow() {
  Menu.setApplicationMenu(null);
  splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  splash.loadFile(path.join(__dirname, "public", "splash.html"), { query: { version: app.getVersion() } });
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "Madrador Remote",
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: "#070b17",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.once("ready-to-show", () => {
    splash?.close();
    splash = null;
    window.maximize();
    window.show();
  });
  window.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    rendererReady = true;
    sendToRenderer("updater-status", lastUpdaterStatus);
    checkForUpdates(false).catch((error) => publishUpdaterStatus("error", { message: error.message }));
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.loadFile(path.join(__dirname, "public", "index.html"));
}

function sendToRenderer(channel, payload) {
  if (rendererReady && window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icon.ico");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  const rebuild = () => {
    tray.setToolTip(`Madrador Remote — ${sessionActive ? "Session active" : available ? "Disponible" : "Indisponible"}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Ouvrir Madrador Remote", click: () => { window.show(); window.focus(); } },
      { label: currentHostCode ? `Copier mon ID · ${currentHostCode}` : "Copier mon ID", enabled: Boolean(currentHostCode), click: () => clipboard.writeText(currentHostCode) },
      { type: "separator" },
      { label: "Disponible", type: "checkbox", checked: available, click: (item) => { available = item.checked; sendToRenderer("availability-changed", available); rebuild(); } },
      { label: "Arrêter les connexions", enabled: sessionActive || Boolean(currentHostCode), click: () => sendToRenderer("stop-connections") },
      { type: "separator" },
      { label: "Quitter", click: () => { app.isQuiting = true; app.quit(); } }
    ]));
  };
  tray.on("double-click", () => { window.show(); window.focus(); });
  tray.rebuild = rebuild;
  rebuild();
}

function publishUpdaterStatus(status, extra = {}) {
  lastUpdaterStatus = { status, ...extra };
  sendToRenderer("updater-status", lastUpdaterStatus);
}

async function checkForUpdates(force = false) {
  if (!app.isPackaged) {
    publishUpdaterStatus("development", { version: app.getVersion() });
    return;
  }
  const marker = path.join(app.getPath("userData"), "last-update-check.json");
  if (!force) {
    try {
      const saved = JSON.parse(await fs.readFile(marker, "utf8"));
      if (Date.now() - Number(saved.checkedAt) < UPDATE_CHECK_INTERVAL_MS) {
        publishUpdaterStatus("cached", { checkedAt: saved.checkedAt });
        return;
      }
    } catch {}
  }
  await fs.writeFile(marker, JSON.stringify({ checkedAt: Date.now() }), "utf8");
  await autoUpdater.checkForUpdates();
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => publishUpdaterStatus("checking"));
  autoUpdater.on("update-available", (info) => {
    publishUpdaterStatus("available", { version: info.version, notes: info.releaseNotes || "" });
    if (Notification.isSupported()) {
      const notification = new Notification({ title: "Nouvelle version disponible", body: `Madrador Remote ${info.version} est disponible.`, icon: path.join(__dirname, "assets", "icon.ico") });
      notification.on("click", () => { window.show(); window.focus(); sendToRenderer("open-update-dialog"); });
      notification.show();
    }
  });
  autoUpdater.on("update-not-available", (info) => publishUpdaterStatus("current", { version: info.version }));
  autoUpdater.on("download-progress", (progress) => {
    const remainingBytes = Math.max(0, progress.total - progress.transferred);
    const secondsRemaining = progress.bytesPerSecond > 0 ? Math.ceil(remainingBytes / progress.bytesPerSecond) : null;
    publishUpdaterStatus("downloading", { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond, secondsRemaining });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    try {
      const integrity = await verifyOptionalSha256(info);
      publishUpdaterStatus("downloaded", { version: info.version, notes: info.releaseNotes || "", integrity });
    } catch (error) {
      publishUpdaterStatus("error", { message: `Échec de la vérification d’intégrité : ${error.message}` });
    }
  });
  autoUpdater.on("error", (error) => {
    console.error("Updater:", error.message);
    publishUpdaterStatus("error", { message: "Aucune mise à jour complète n’est publiée pour le moment. Réessayez après la prochaine Release." });
  });
}

async function verifyOptionalSha256(info) {
  const downloadedFile = info.downloadedFile;
  if (!downloadedFile) return { algorithm: "SHA-512", verified: true, source: "latest.yml" };
  const assetName = path.basename(downloadedFile);
  const checksumUrl = `https://github.com/Madrador60/partager-son-ecran/releases/download/v${info.version}/${encodeURIComponent(assetName)}.sha256`;
  const response = await fetch(checksumUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return { algorithm: "SHA-512", verified: true, source: "latest.yml" };
  if (!response.ok) throw new Error(`SHA256_HTTP_${response.status}`);
  const expected = (await response.text()).match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase();
  if (!expected) throw new Error("SHA256_INVALID");
  const actual = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(downloadedFile).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
  if (actual !== expected) throw new Error("SHA256_MISMATCH");
  return { algorithm: "SHA-256", verified: true, source: `${assetName}.sha256` };
}

app.setAppUserModelId("com.madrador.remote");
app.whenReady().then(async () => {
  embeddedServer = await startEmbeddedServer();
  createWindow();
  createTray();
  configureUpdater();
}).catch((error) => {
  console.error("Embedded server startup:", error.message);
  app.quit();
});
app.on("before-quit", () => {
  app.isQuiting = true;
  stopEmbeddedServer(embeddedServer).catch(() => {});
});
app.on("window-all-closed", () => { if (process.platform === "darwin") app.quit(); });

trustedIpc.handle("system-info", async () => {
  const gpu = await app.getGPUInfo("basic").catch(() => ({}));
  return {
    hostname: os.hostname(),
    displays: screen.getAllDisplays().length,
    platform: os.platform(),
    platformRelease: os.release(),
    localIp: Object.values(os.networkInterfaces()).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address || "Indisponible",
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    memoryBytes: os.totalmem(),
    cpu: os.cpus()[0]?.model || "Indisponible",
    cpuCores: os.cpus().length,
    gpu: gpu.gpuDevice?.[0]?.deviceString || "Indisponible",
    gpuFeatures: app.getGPUFeatureStatus()
  };
});
trustedIpc.handle("set-host-code", (_event, code) => {
  currentHostCode = z.string().max(16).parse(code || "");
  tray?.rebuild();
  return { ok: true };
});
trustedIpc.handle("set-session-active", (_event, active) => {
  sessionActive = Boolean(active);
  tray?.rebuild();
  if (sessionActive && Notification.isSupported()) new Notification({ title: "Madrador Remote", body: "Une session distante est maintenant active.", icon: path.join(__dirname, "assets", "icon.ico") }).show();
  return { ok: true };
});
trustedIpc.handle("set-availability", (_event, value) => {
  available = Boolean(value);
  tray?.rebuild();
  sendToRenderer("availability-changed", available);
  return { ok: true, available };
});
trustedIpc.handle("show-notification", (_event, payload = {}) => {
  const title = z.string().max(80).parse(payload.title || "Madrador Remote");
  const body = z.string().max(240).parse(payload.body || "");
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, "assets", "icon.ico") }).show();
  return { ok: true };
});
trustedIpc.handle("update-action", async (_event, action) => {
  if (!app.isPackaged) return { ok: false, error: "Disponible dans la version installée" };
  if (action === "check") await checkForUpdates(true);
  else if (action === "download") await autoUpdater.downloadUpdate();
  else if (action === "install") autoUpdater.quitAndInstall(false, true);
  else if (action === "later") publishUpdaterStatus("scheduled", { version: lastUpdaterStatus.version });
  else throw new Error("UPDATE_ACTION_INVALID");
  return { ok: true };
});

trustedIpc.handle("list-sources", async () => {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    bounds: displays.find((display) => String(display.id) === source.display_id)?.bounds || null,
    display: (() => {
      const display = displays.find((item) => String(item.id) === source.display_id);
      return display ? {
        id: String(display.id),
        resolution: { width: display.size.width, height: display.size.height },
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        primary: display.id === screen.getPrimaryDisplay().id
      } : null;
    })()
  }));
});

trustedIpc.handle("set-control-enabled", (_event, value = {}) => {
  value = ControlConfig.parse(value);
  remoteControl = { enabled: Boolean(value.enabled), bounds: value.bounds || null };
  return { ok: true };
});

trustedIpc.handle("remote-input", async (_event, payload = {}) => {
  payload = RemoteInput.parse(payload);
  if (!remoteControl.enabled) return { ok: false, error: "Contrôle non autorisé" };
  const { mouse, keyboard, Button, Key, Point } = require("@nut-tree-fork/nut-js");
  const bounds = remoteControl.bounds || screen.getPrimaryDisplay().bounds;
  const x = bounds.x + Math.round(Math.max(0, Math.min(1, Number(payload.x) || 0)) * (bounds.width - 1));
  const y = bounds.y + Math.round(Math.max(0, Math.min(1, Number(payload.y) || 0)) * (bounds.height - 1));
  if (payload.type === "mousemove") await mouse.setPosition(new Point(x, y));
  else if (payload.type === "mousedown") await mouse.pressButton(payload.button === 2 ? Button.RIGHT : Button.LEFT);
  else if (payload.type === "mouseup") await mouse.releaseButton(payload.button === 2 ? Button.RIGHT : Button.LEFT);
  else if (payload.type === "wheel") {
    const amount = Math.max(1, Math.min(12, Math.round(Math.abs(payload.deltaY) / 80)));
    if (payload.deltaY < 0) await mouse.scrollUp(amount); else await mouse.scrollDown(amount);
  } else if (payload.type === "keydown") {
    const keys = { Enter: Key.ENTER, Escape: Key.ESCAPE, Backspace: Key.BACKSPACE, Tab: Key.TAB, ArrowUp: Key.UP, ArrowDown: Key.DOWN, ArrowLeft: Key.LEFT, ArrowRight: Key.RIGHT, Delete: Key.DELETE, " ": Key.SPACE };
    if (keys[payload.key]) await keyboard.type(keys[payload.key]);
    else if (typeof payload.key === "string" && payload.key.length === 1) await keyboard.type(payload.key);
  }
  return { ok: true };
});

trustedIpc.handle("clipboard-read", () => clipboard.readText());
trustedIpc.handle("clipboard-write", (_event, text) => {
  clipboard.writeText(z.string().max(100_000).parse(text));
  return { ok: true };
});
trustedIpc.handle("save-file", async (_event, file = {}) => {
  file = SaveFile.parse(file);
  const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(String(file.name || "document")) });
  if (result.canceled || !result.filePath) return { ok: false };
  const data = Buffer.from(file.data);
  if (data.length > 25 * 1024 * 1024) return { ok: false, error: "Fichier trop volumineux" };
  await fs.writeFile(result.filePath, data);
  return { ok: true, path: result.filePath };
});
trustedIpc.handle("get-signal-url", () => process.env.MADRADOR_SIGNAL_URL || embeddedServer?.url || "");
trustedIpc.handle("get-embedded-signal-url", () => embeddedServer?.url || "");
trustedIpc.handle("get-ice-servers", () => createIceServers());
