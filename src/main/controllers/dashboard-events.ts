import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { DASHBOARD_UPDATED_EVENT } from '../../shared/dashboard';

export function notifyDashboardUpdated(): void {
  let windows: BrowserWindow[];

  try {
    windows = BrowserWindow.getAllWindows();
  } catch (error) {
    logNotificationError(error);
    return;
  }

  for (const window of windows) {
    try {
      window.webContents.send(DASHBOARD_UPDATED_EVENT);
    } catch (error) {
      logNotificationError(error);
    }
  }
}

function logNotificationError(error: unknown): void {
  try {
    log.error(
      'No fue posible notificar la actualizacion del dashboard.',
      error,
    );
  } catch {
    // La notificacion no debe alterar el resultado de la operacion confirmada.
  }
}
