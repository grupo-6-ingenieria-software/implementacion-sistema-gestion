import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { DASHBOARD_UPDATED_EVENT } from "../../shared/dashboard";
import {
  SALE_ANNULLED_EVENT,
  type SaleAnnulmentResult,
} from "../../shared/sales";

export function notifySaleAnnulled(result: SaleAnnulmentResult): void {
  let windows: BrowserWindow[];

  try {
    windows = BrowserWindow.getAllWindows();
  } catch (error) {
    logNotificationError(error);
    return;
  }

  for (const window of windows) {
    try {
      window.webContents.send(SALE_ANNULLED_EVENT, result);
    } catch (error) {
      logNotificationError(error);
    }
    try {
      window.webContents.send(DASHBOARD_UPDATED_EVENT);
    } catch (error) {
      logNotificationError(error);
    }
  }
}

function logNotificationError(error: unknown): void {
  try {
    log.error("No fue posible notificar la anulación de venta.", error);
  } catch {}
}
