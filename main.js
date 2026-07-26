require("dotenv").config();
const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, screen, clipboard, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const { ControlConfig, RemoteInput, SaveFile } = require("./src/shared/validation");

let window;
let remoteControl = { enabled: false, bounds: null };

function assertTrusted(event) {
  const url = event.senderFrame?.url || "";
  const expected = pathToFileURL(path.join(__dirname, "public", "index.html")).href;
  if (url !== expected) throw new Error("IPC_ORIGIN_DENIED");
}

function createWindow() {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "Madrador Remote",
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: "#111827",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.loadFile(path.join(__dirname, "public", "index.html"));
}

app.setAppUserModelId("com.madrador.remote");
app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error(error.message));
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());

ipcMain.handle("system-info", () => ({
  hostname: os.hostname(),
  displays: screen.getAllDisplays().length
}));

ipcMain.handle("list-sources", async () => {
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
    bounds: displays.find((display) => String(display.id) === source.display_id)?.bounds || null
  }));
});

ipcMain.handle("set-control-enabled", (event, value = {}) => {
  assertTrusted(event);
  value = ControlConfig.parse(value);
  remoteControl = { enabled: Boolean(value.enabled), bounds: value.bounds || null };
  return { ok: true };
});

ipcMain.handle("remote-input", async (event, payload = {}) => {
  assertTrusted(event);
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

ipcMain.handle("clipboard-read", () => clipboard.readText());
ipcMain.handle("clipboard-write", (event, text) => {
  assertTrusted(event);
  clipboard.writeText(z.string().max(100_000).parse(text));
  return { ok: true };
});
ipcMain.handle("save-file", async (event, file = {}) => {
  assertTrusted(event);
  file = SaveFile.parse(file);
  const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(String(file.name || "document")) });
  if (result.canceled || !result.filePath) return { ok: false };
  const data = Buffer.from(file.data);
  if (data.length > 25 * 1024 * 1024) return { ok: false, error: "Fichier trop volumineux" };
  await fs.writeFile(result.filePath, data);
  return { ok: true, path: result.filePath };
});
ipcMain.handle("get-signal-url", () => process.env.MADRADOR_SIGNAL_URL || "");
ipcMain.handle("get-ice-servers", () => {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.MADRADOR_TURN_URL && process.env.MADRADOR_TURN_USERNAME && process.env.MADRADOR_TURN_CREDENTIAL) {
    servers.push({ urls: process.env.MADRADOR_TURN_URL, username: process.env.MADRADOR_TURN_USERNAME, credential: process.env.MADRADOR_TURN_CREDENTIAL });
  }
  return servers;
});
