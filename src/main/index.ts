import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { INACTIVITY_MS, SESSION_EXPIRED_EVENT } from '../shared/auth';
import { registerControllers } from './controllers';

let mainWindow: BrowserWindow | null = null;
let lastActivityMs = 0;
let sessionActive = false;

/**
 * Marca actividad del usuario (RF55). Una sesión se considera iniciada cuando
 * se procesa un auth:login; cada IPC posterior renueva la marca de actividad.
 */
function noteActivity(channel: string): void {
  lastActivityMs = Date.now();

  if (channel === 'auth:login') {
    sessionActive = true;
  }
}

/**
 * Vigila la inactividad de 30 minutos y avisa al renderer con un push
 * session:expirada (webContents.send), tal como define el diagrama CU56 e4.
 */
function startInactivityWatcher(): void {
  setInterval(() => {
    if (!sessionActive || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (Date.now() - lastActivityMs > INACTIVITY_MS) {
      sessionActive = false;
      mainWindow.webContents.send(SESSION_EXPIRED_EVENT);
    }
  }, 60_000);
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = window;

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerControllers(ipcMain, noteActivity);
  createMainWindow();
  startInactivityWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
