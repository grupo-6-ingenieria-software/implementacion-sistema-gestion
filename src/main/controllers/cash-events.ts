import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { DASHBOARD_UPDATED_EVENT } from "../../shared/dashboard";

export const CASH_UPDATED_EVENT = "caja:actualizada";

export function notifyCashUpdated(): void {
  let windows: BrowserWindow[];
  try {
    windows = BrowserWindow.getAllWindows();
  } catch (error) {
    logNotificationError(error);
    return;
  }

  for (const window of windows) {
    try {
      window.webContents.send(CASH_UPDATED_EVENT);
      window.webContents.send(DASHBOARD_UPDATED_EVENT);
    } catch (error) {
      logNotificationError(error);
    }
  }
}

function logNotificationError(error: unknown): void {
  try {
    log.error("No fue posible notificar la actualización de caja.", error);
  } catch {}
}
