require("dotenv").config();
const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, ipcMain, desktopCapturer, screen, clipboard, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const { ControlConfig, RemoteInput, SaveFile } = require("./src/shared/validation");
const { createTrustedIpc } = require("./src/main/ipc/trusted-ipc");
const { createIceServers } = require("./src/server/turn/ice-config");
const { startEmbeddedServer, stopEmbeddedServer } = require("./src/main/embedded-server");
const { planKeydown, buttonName } = require("./src/main/remote-input");

// Chromium remplace les IP locales par des noms « .local » (mDNS). Entre deux PC d'une
// même box, cette résolution échoue souvent et la connexion reste bloquée : l'application
// étant utilisée entre personnes qui se font confiance, on expose les adresses locales.
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

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
let preferences = { notifications: true, launchAtStartup: false };
const startHidden = process.argv.includes("--hidden");

// Serveur public partagé par tous les utilisateurs : indispensable pour relier
// deux PC sur des réseaux Internet différents. Injecté au build (package.json →
// "madrador.signalUrl") ou via MADRADOR_SIGNAL_URL ; sinon serveur local intégré.
function defaultSignalUrl() {
  const candidates = [process.env.MADRADOR_SIGNAL_URL, require("./package.json").madrador?.signalUrl];
  for (const value of candidates) {
    try {
      const url = new URL(String(value || ""));
      if (["http:", "https:"].includes(url.protocol)) return url.origin;
    } catch {}
  }
  return "";
}

function isTrusted(event) {
  const url = event.senderFrame?.url || "";
  const expected = pathToFileURL(path.join(__dirname, "public", "index.html")).href;
  return url === expected;
}

const trustedIpc = createTrustedIpc(ipcMain, isTrusted);

function notifyUser(title, body, onClick) {
  if (!preferences.notifications || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: path.join(__dirname, "assets", "icon.ico") });
  if (onClick) notification.on("click", onClick);
  notification.show();
}

function showMainWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow() {
  Menu.setApplicationMenu(null);
  if (!startHidden) splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  splash?.loadFile(path.join(__dirname, "public", "splash.html"), { query: { version: app.getVersion() } });
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
    if (startHidden) return;
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
      { label: "Ouvrir Madrador Remote", click: showMainWindow },
      { label: currentHostCode ? `Copier mon ID · ${currentHostCode}` : "Copier mon ID", enabled: Boolean(currentHostCode), click: () => clipboard.writeText(currentHostCode) },
      { type: "separator" },
      { label: "Disponible", type: "checkbox", checked: available, click: (item) => { available = item.checked; sendToRenderer("availability-changed", available); rebuild(); } },
      { label: "Arrêter les connexions", enabled: sessionActive || Boolean(currentHostCode), click: () => sendToRenderer("stop-connections") },
      { type: "separator" },
      { label: "Quitter", click: () => { app.isQuiting = true; app.quit(); } }
    ]));
  };
  tray.on("double-click", showMainWindow);
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
    notifyUser("Nouvelle version disponible", `Madrador Remote ${info.version} est disponible.`, () => { showMainWindow(); sendToRenderer("open-update-dialog"); });
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
// Une seule instance : relancer l'application ramène simplement la fenêtre existante.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", showMainWindow);
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
  for (const id of transfers.keys()) abortTransfer(id);
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
  if (sessionActive) notifyUser("Madrador Remote", "Une session distante est maintenant active.");
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
  notifyUser(title, body, showMainWindow);
  return { ok: true };
});
trustedIpc.handle("set-preferences", (_event, value = {}) => {
  preferences = z.object({ notifications: z.boolean(), launchAtStartup: z.boolean() }).strict().parse(value);
  // En développement, cela enregistrerait electron.exe : on ne le fait que dans la version installée.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: preferences.launchAtStartup, args: ["--hidden"] });
  return { ok: true, applied: app.isPackaged };
});
trustedIpc.handle("test-server", async (_event, value) => {
  try {
    const url = new URL(z.string().max(500).parse(value));
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, error: "Adresse http(s) attendue." };
    const started = Date.now();
    // Délai long : un serveur gratuit en veille met jusqu'à une minute à démarrer.
    const response = await fetch(new URL("/api/health", url.origin), { signal: AbortSignal.timeout(70_000) });
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (body?.service !== "madrador-signal") return { ok: false, error: "Ce n’est pas un serveur Madrador Remote." };
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error.name === "TimeoutError" ? "Pas de réponse du serveur." : "Adresse injoignable." };
  }
});
trustedIpc.handle("focus-window", () => {
  showMainWindow();
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

let nut = null;
const pressedButtons = new Set();
let inputQueue = Promise.resolve();
let pendingMove = null;

function loadNut() {
  if (!nut) {
    nut = require("@nut-tree-fork/nut-js");
    nut.mouse.config.autoDelayMs = 0;
    nut.keyboard.config.autoDelayMs = 0;
    // nut-js fixe 300 ms de délai natif par touche au démarrage : on le supprime.
    try { if (nut.providerRegistry.hasKeyboard()) nut.providerRegistry.getKeyboard().setKeyboardDelay(0); } catch {}
  }
  return nut;
}

async function releaseAllButtons() {
  if (!nut || !pressedButtons.size) return;
  for (const name of pressedButtons) await nut.mouse.releaseButton(nut.Button[name]).catch(() => {});
  pressedButtons.clear();
}

async function executeRemoteInput(payload) {
  const { mouse, keyboard, Button, Key, Point } = loadNut();
  const bounds = remoteControl.bounds || screen.getPrimaryDisplay().bounds;
  const point = () => new Point(
    bounds.x + Math.round(Math.max(0, Math.min(1, Number(payload.x) || 0)) * (bounds.width - 1)),
    bounds.y + Math.round(Math.max(0, Math.min(1, Number(payload.y) || 0)) * (bounds.height - 1))
  );
  if (payload.type === "mousemove") await mouse.setPosition(point());
  else if (payload.type === "mousedown" || payload.type === "mouseup") {
    const name = buttonName(payload.button);
    await mouse.setPosition(point());
    if (payload.type === "mousedown") { await mouse.pressButton(Button[name]); pressedButtons.add(name); }
    else { await mouse.releaseButton(Button[name]); pressedButtons.delete(name); }
  } else if (payload.type === "wheel") {
    const amount = Math.max(1, Math.min(12, Math.round(Math.abs(payload.deltaY) / 40)));
    if (payload.deltaY < 0) await mouse.scrollUp(amount); else await mouse.scrollDown(amount);
  } else if (payload.type === "keydown") {
    const plan = planKeydown(payload);
    if (plan?.kind === "text") await keyboard.type(plan.text);
    else if (plan?.kind === "combo") {
      const keys = plan.keys.map((name) => Key[name]).filter((value) => value !== undefined);
      if (keys.length !== plan.keys.length) return;
      try { await keyboard.pressKey(...keys); } finally { await keyboard.releaseKey(...keys.reverse()); }
    }
  }
}

trustedIpc.handle("set-control-enabled", async (_event, value = {}) => {
  value = ControlConfig.parse(value);
  remoteControl = { enabled: Boolean(value.enabled), bounds: value.bounds || null };
  if (!remoteControl.enabled) await releaseAllButtons();
  return { ok: true };
});

trustedIpc.handle("remote-input", async (_event, payload = {}) => {
  payload = RemoteInput.parse(payload);
  if (!remoteControl.enabled) return { ok: false, error: "Contrôle non autorisé" };
  // Les mouvements en attente sont fusionnés pour éviter tout retard cumulé.
  if (payload.type === "mousemove") {
    const alreadyQueued = Boolean(pendingMove);
    pendingMove = payload;
    if (alreadyQueued) return { ok: true };
  }
  // Exécution séquentielle : l'ordre clic/relâchement/frappe est garanti.
  const run = inputQueue.then(() => {
    if (payload.type !== "mousemove") return executeRemoteInput(payload);
    const move = pendingMove;
    pendingMove = null;
    return move ? executeRemoteInput(move) : undefined;
  });
  inputQueue = run.catch(() => {});
  await run;
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
// Gros fichiers : reçus par morceaux et écrits directement sur le disque.
const MAX_TRANSFER_BYTES = 2 * 1024 ** 3;
const transfers = new Map();
const TransferBegin = z.object({ name: z.string().min(1).max(200), size: z.number().int().positive().max(MAX_TRANSFER_BYTES) }).strict();
const TransferId = z.string().uuid();

async function abortTransfer(id) {
  const transfer = transfers.get(id);
  if (!transfer) return;
  transfers.delete(id);
  await transfer.handle.close().catch(() => {});
  await fs.rm(transfer.path, { force: true }).catch(() => {});
}

trustedIpc.handle("file-begin", async (_event, value = {}) => {
  const { name, size } = TransferBegin.parse(value);
  const safeName = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "fichier";
  const result = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath("downloads"), safeName) });
  if (result.canceled || !result.filePath) return { ok: false };
  const id = randomUUID();
  transfers.set(id, { handle: await fs.open(result.filePath, "w"), path: result.filePath, size, written: 0 });
  return { ok: true, transferId: id, path: result.filePath };
});
trustedIpc.handle("file-chunk", async (_event, value = {}) => {
  const id = TransferId.parse(value.transferId);
  const transfer = transfers.get(id);
  if (!transfer) return { ok: false, error: "TRANSFER_UNKNOWN" };
  const data = Buffer.from(z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]).parse(value.data));
  if (transfer.written + data.length > transfer.size) {
    await abortTransfer(id);
    return { ok: false, error: "TRANSFER_TOO_LARGE" };
  }
  await transfer.handle.write(data);
  transfer.written += data.length;
  return { ok: true, written: transfer.written };
});
trustedIpc.handle("file-end", async (_event, value = {}) => {
  const id = TransferId.parse(value.transferId);
  const transfer = transfers.get(id);
  if (!transfer) return { ok: false, error: "TRANSFER_UNKNOWN" };
  if (transfer.written !== transfer.size) {
    await abortTransfer(id);
    return { ok: false, error: "TRANSFER_INCOMPLETE" };
  }
  transfers.delete(id);
  await transfer.handle.close();
  return { ok: true, path: transfer.path };
});
trustedIpc.handle("file-abort", async (_event, value = {}) => {
  await abortTransfer(TransferId.parse(value.transferId));
  return { ok: true };
});
trustedIpc.handle("show-in-folder", (_event, value) => {
  const filePath = z.string().max(1000).parse(value);
  shell.showItemInFolder(filePath);
  return { ok: true };
});

trustedIpc.handle("get-signal-url", () => defaultSignalUrl() || embeddedServer?.url || "");
trustedIpc.handle("get-embedded-signal-url", () => embeddedServer?.url || "");
trustedIpc.handle("get-ice-servers", async (_event, serverUrl) => {
  // Les identifiants TURN sont générés par le serveur partagé : le secret ne quitte jamais le serveur.
  try {
    const url = new URL(z.string().max(500).parse(serverUrl || ""));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("SIGNAL_PROTOCOL");
    const response = await fetch(new URL("/api/ice", url.origin), { signal: AbortSignal.timeout(5000) });
    const body = response.ok ? await response.json() : null;
    if (Array.isArray(body?.iceServers) && body.iceServers.length) return body.iceServers.slice(0, 10);
  } catch {}
  return createIceServers();
});
