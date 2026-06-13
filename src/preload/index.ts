import { contextBridge, ipcRenderer } from 'electron';
import type { ControllerResponse } from '../shared/controllers';
import { DASHBOARD_UPDATED_EVENT } from '../shared/dashboard';
import { SESSION_EXPIRED_EVENT } from '../shared/auth';

export type AppApi = {
  invoke: <TData = unknown>(
    channel: string,
    payload?: unknown,
  ) => Promise<ControllerResponse<TData>>;
  onDashboardUpdated: (listener: () => void) => () => void;
  onSessionExpired: (listener: () => void) => () => void;
};

const api: AppApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onDashboardUpdated: (listener) => {
    const handleUpdate = (): void => listener();
    ipcRenderer.on(DASHBOARD_UPDATED_EVENT, handleUpdate);

    return () => {
      ipcRenderer.removeListener(DASHBOARD_UPDATED_EVENT, handleUpdate);
    };
  },
  onSessionExpired: (listener) => {
    const handleExpired = (): void => listener();
    ipcRenderer.on(SESSION_EXPIRED_EVENT, handleExpired);

    return () => {
      ipcRenderer.removeListener(SESSION_EXPIRED_EVENT, handleExpired);
    };
  },
};

contextBridge.exposeInMainWorld('appApi', api);
