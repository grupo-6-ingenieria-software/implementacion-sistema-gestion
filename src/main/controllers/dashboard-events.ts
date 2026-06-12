import { BrowserWindow } from 'electron';
import { DASHBOARD_UPDATED_EVENT } from '../../shared/dashboard';

export function notifyDashboardUpdated(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DASHBOARD_UPDATED_EVENT);
  }
}
