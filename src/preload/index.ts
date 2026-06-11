import { contextBridge, ipcRenderer } from 'electron';
import type { ControllerResponse } from '../shared/controllers';

export type AppApi = {
  invoke: <TData = unknown>(
    channel: string,
    payload?: unknown,
  ) => Promise<ControllerResponse<TData>>;
};

const api: AppApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
};

contextBridge.exposeInMainWorld('appApi', api);
