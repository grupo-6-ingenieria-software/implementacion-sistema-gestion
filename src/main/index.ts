import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import log from "electron-log/main";
import { client, db } from "../db/client";
import { initializeDatabase, resolveDatabaseInitPaths } from "../db/init";
import { registerControllers } from "./controllers";
import {
  isDebugLoginEnabled,
  registerDebugLogin,
} from "./controllers/debug-login";
import { startAutoUpdater } from "./updater";

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  try {
    await initializeDatabase(
      db,
      client,
      resolveDatabaseInitPaths({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    );
  } catch (error) {
    log.error(
      "Fallo al inicializar la base de datos (migraciones/triggers):",
      error,
    );
    dialog.showErrorBox(
      "Error al iniciar la base de datos",
      "No se pudieron aplicar las migraciones o los triggers de la base de datos. " +
        "La aplicación se cerrará.\n\n" +
        String(error instanceof Error ? error.message : error),
    );
    app.quit();
    return;
  }

  registerControllers(ipcMain);

  if (isDebugLoginEnabled()) {
    registerDebugLogin(ipcMain);
  }

  createMainWindow();
  startAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
