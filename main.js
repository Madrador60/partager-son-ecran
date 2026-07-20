const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, dialog, shell, nativeImage, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { startEmbeddedServer } = require("./signaling-server");

let mainWindow;
let embedded;
let controlEnabled = false;

function createWindow(port) {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    title: "Madrador Remote",
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: "#090b0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.setAppUserModelId("com.madrador.remote");

app.whenReady().then(async () => {
  embedded = await startEmbeddedServer();
  createWindow(embedded.port);
});

app.on("window-all-closed", () => {
  embedded?.server?.close();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("system-info", () => ({
  hostname: os.hostname(),
  platform: os.platform(),
  release: os.release(),
  memoryGb: Math.round(os.totalmem() / 1073741824),
  displays: screen.getAllDisplays().length
}));

ipcMain.handle("list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 560, height: 315 },
    fetchWindowIcons: true
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon?.toDataURL() || null
  }));
});

ipcMain.handle("set-control-enabled", (_event, enabled) => {
  controlEnabled = Boolean(enabled);
  return { ok: true, enabled: controlEnabled };
});

ipcMain.handle("clipboard-read", () => ({
  text: clipboard.readText(),
  image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL()
}));

ipcMain.handle("clipboard-write", (_event, payload = {}) => {
  if (payload.image) {
    const image = nativeImage.createFromDataURL(payload.image);
    clipboard.writeImage(image);
  } else {
    clipboard.writeText(String(payload.text || ""));
  }
  return { ok: true };
});

ipcMain.handle("save-received-file", async (_event, { name, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Enregistrer le document reçu",
    defaultPath: name
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, Buffer.from(data));
  return { ok: true, path: result.filePath };
});

ipcMain.handle("open-path", (_event, filePath) => shell.showItemInFolder(filePath));

ipcMain.handle("remote-input", async (_event, payload) => {
  if (!controlEnabled) return { ok: false, error: "Contrôle non autorisé" };

  try {
    const { mouse, keyboard, Button, Key, Point } = require("@nut-tree-fork/nut-js");
    const display = screen.getPrimaryDisplay();
    const width = display.bounds.width;
    const height = display.bounds.height;

    if (payload.type === "mousemove") {
      await mouse.setPosition(new Point(
        Math.max(0, Math.min(width - 1, Math.round(payload.x * width))),
        Math.max(0, Math.min(height - 1, Math.round(payload.y * height)))
      ));
    } else if (payload.type === "mousedown" || payload.type === "mouseup") {
      const button = payload.button === 2 ? Button.RIGHT : Button.LEFT;
      if (payload.type === "mousedown") await mouse.pressButton(button);
      else await mouse.releaseButton(button);
    } else if (payload.type === "wheel") {
      const amount = Math.min(16, Math.max(1, Math.round(Math.abs(payload.deltaY) / 70)));
      if (payload.deltaY < 0) await mouse.scrollUp(amount);
      else await mouse.scrollDown(amount);
    } else if (payload.type === "keydown") {
      const map = {
        Enter: Key.ENTER, Escape: Key.ESCAPE, Backspace: Key.BACKSPACE, Tab: Key.TAB,
        ArrowUp: Key.UP, ArrowDown: Key.DOWN, ArrowLeft: Key.LEFT, ArrowRight: Key.RIGHT,
        Delete: Key.DELETE, " ": Key.SPACE, Home: Key.HOME, End: Key.END,
        PageUp: Key.PAGE_UP, PageDown: Key.PAGE_DOWN
      };
      if (map[payload.key]) await keyboard.type(map[payload.key]);
      else if (typeof payload.key === "string" && payload.key.length === 1) await keyboard.type(payload.key);
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
