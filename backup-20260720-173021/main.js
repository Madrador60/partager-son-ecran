const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");
const path = require("path");
const { startEmbeddedServer } = require("./signaling-server");

let mainWindow = null;
let embedded = null;
let controlEnabled = false;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 650,
    title: "RemoteAssist",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  embedded = await startEmbeddedServer();
  createWindow(embedded.port);
});

app.on("window-all-closed", () => {
  if (embedded?.server) embedded.server.close();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 420, height: 240 }
  });

  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

ipcMain.handle("set-control-enabled", (_event, enabled) => {
  controlEnabled = Boolean(enabled);
  return { ok: true, enabled: controlEnabled };
});

ipcMain.handle("remote-input", async (_event, payload) => {
  if (!controlEnabled) return { ok: false, error: "Contrôle non autorisé" };

  try {
    const { mouse, keyboard, Button, Key, Point } = require("@nut-tree-fork/nut-js");
    const display = screen.getPrimaryDisplay();
    const width = display.bounds.width;
    const height = display.bounds.height;

    if (payload.type === "mousemove") {
      const x = Math.max(0, Math.min(width - 1, Math.round(payload.x * width)));
      const y = Math.max(0, Math.min(height - 1, Math.round(payload.y * height)));
      await mouse.setPosition(new Point(x, y));
    }

    if (payload.type === "mousedown" || payload.type === "mouseup") {
      const button = payload.button === 2 ? Button.RIGHT : Button.LEFT;
      if (payload.type === "mousedown") await mouse.pressButton(button);
      else await mouse.releaseButton(button);
    }

    if (payload.type === "wheel") {
      const amount = Math.min(10, Math.max(1, Math.round(Math.abs(payload.deltaY) / 100)));
      if (payload.deltaY < 0) await mouse.scrollUp(amount);
      else await mouse.scrollDown(amount);
    }

    if (payload.type === "keydown") {
      const keyMap = {
        Enter: Key.ENTER,
        Escape: Key.ESCAPE,
        Backspace: Key.BACKSPACE,
        Tab: Key.TAB,
        ArrowUp: Key.UP,
        ArrowDown: Key.DOWN,
        ArrowLeft: Key.LEFT,
        ArrowRight: Key.RIGHT,
        Delete: Key.DELETE,
        Space: Key.SPACE
      };
      const mapped = keyMap[payload.key];
      if (mapped) await keyboard.type(mapped);
      else if (typeof payload.key === "string" && payload.key.length === 1) {
        await keyboard.type(payload.key);
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
