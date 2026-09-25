import { app, dialog } from "electron";
import log from "electron-log/main";
// electron-updater es CJS y define `autoUpdater` como getter perezoso: desde ESM
// hay que pasar por el export default.
import electronUpdater from "electron-updater";

/** Cada cuánto se vuelve a consultar GitHub Releases mientras la app sigue abierta. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdaterEnvironment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}

/**
 * Sólo la build instalada de Windows (NSIS) se actualiza sola. En dev no hay
 * `app-update.yml` y el .dmg de macOS no está firmado, así que ahí no se consulta.
 */
export function shouldCheckForUpdates(env: UpdaterEnvironment): boolean {
  return env.platform === "win32" && env.isPackaged;
}

/**
 * Consulta el último GitHub Release (config `build.publish` de package.json),
 * descarga la actualización en segundo plano y ofrece reiniciar al terminar.
 * Si el usuario la posterga, se instala al cerrar la app.
 */
export function startAutoUpdater(
  env: UpdaterEnvironment = {
    platform: process.platform,
    isPackaged: app.isPackaged,
  },
): void {
  if (!shouldCheckForUpdates(env)) {
    return;
  }

  const { autoUpdater } = electronUpdater;
  let restartPrompted = false;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    log.error("Fallo al buscar o descargar la actualización:", error);
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (restartPrompted) {
      return;
    }
    restartPrompted = true;
    void promptRestart(info.version);
  });

  const check = (): void => {
    // Los rechazos ya se registran en el evento "error".
    autoUpdater.checkForUpdates().catch(() => undefined);
  };

  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

async function promptRestart(version: string): Promise<void> {
  const { autoUpdater } = electronUpdater;
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Actualización disponible",
    message: `La versión ${version} está lista para instalarse.`,
    detail:
      "Reinicia ahora para aplicarla, o se instalará automáticamente al cerrar la aplicación.",
    buttons: ["Reiniciar ahora", "Más tarde"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    // Instalación silenciosa y relanzar la app al terminar.
    autoUpdater.quitAndInstall(true, true);
  }
}
