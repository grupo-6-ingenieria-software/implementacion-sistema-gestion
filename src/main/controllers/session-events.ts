import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { SESSION_INVALIDATED_EVENT } from "../../shared/auth";

export function notifySessionInvalidated(usuarioId: string): void {
  let windows: BrowserWindow[];

  try {
    windows = BrowserWindow.getAllWindows();
  } catch (error) {
    logNotificationError(error);
    return;
  }

  for (const window of windows) {
    try {
      window.webContents.send(SESSION_INVALIDATED_EVENT, { usuarioId });
    } catch (error) {
      logNotificationError(error);
    }
  }
}

function logNotificationError(error: unknown): void {
  try {
    log.error(
      "No fue posible notificar la invalidacion de la sesion.",
      error,
    );
  } catch {}
}
