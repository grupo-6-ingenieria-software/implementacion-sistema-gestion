import { contextBridge, ipcRenderer } from "electron";
import type { ControllerResponse } from "../shared/controllers";
import { DASHBOARD_UPDATED_EVENT } from "../shared/dashboard";
import { SESSION_EXPIRED_EVENT } from "../shared/auth";

export type AppApi = {
  debugMode: boolean;
  invoke: <TData = unknown>(
    channel: string,
    payload?: unknown,
  ) => Promise<ControllerResponse<TData>>;

  setSessionToken: (token: string | null) => void;
  onDashboardUpdated: (listener: () => void) => () => void;
  onSessionExpired: (listener: () => void) => () => void;
};

let sessionToken: string | null = null;

const api: AppApi = {
  debugMode: process.env.HUASCAR_DEBUG_LOGIN === "1",
  invoke: (channel, payload) => {
    if (payload === undefined || payload === null) {
      return ipcRenderer.invoke(channel, { __authToken: sessionToken });
    }

    if (typeof payload === "object" && !Array.isArray(payload)) {
      return ipcRenderer.invoke(channel, {
        ...(payload as Record<string, unknown>),
        __authToken: sessionToken,
      });
    }

    return ipcRenderer.invoke(channel, payload);
  },
  setSessionToken: (token) => {
    sessionToken = token;
  },
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

contextBridge.exposeInMainWorld("appApi", api);
