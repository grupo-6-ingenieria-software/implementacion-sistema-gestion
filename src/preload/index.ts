import { contextBridge, ipcRenderer } from "electron";
import type { ControllerResponse } from "../shared/controllers";
import { DASHBOARD_UPDATED_EVENT } from "../shared/dashboard";
import { SESSION_EXPIRED_EVENT, SESSION_INVALIDATED_EVENT } from "../shared/auth";
import { SUPPLIER_ORDERS_UPDATED_EVENT } from "../shared/supplier-orders";

export type AppApi = {
  debugMode: boolean;
  invoke: <TData = unknown>(
    channel: string,
    payload?: unknown,
  ) => Promise<ControllerResponse<TData>>;

  setSessionToken: (token: string | null) => void;
  onDashboardUpdated: (listener: () => void) => () => void;
  onSessionExpired: (listener: () => void) => () => void;
  onSessionInvalidated: (
    listener: (payload: { usuarioId: string }) => void,
  ) => () => void;
  onSupplierOrdersUpdated: (listener: () => void) => () => void;
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
  onSessionInvalidated: (listener) => {
    const handleInvalidated = (
      _event: Electron.IpcRendererEvent,
      payload: { usuarioId: string },
    ): void => listener(payload);
    ipcRenderer.on(SESSION_INVALIDATED_EVENT, handleInvalidated);

    return () => {
      ipcRenderer.removeListener(SESSION_INVALIDATED_EVENT, handleInvalidated);
    };
  },
  onSupplierOrdersUpdated: (listener) => {
    const handleUpdate = (): void => listener();
    ipcRenderer.on(SUPPLIER_ORDERS_UPDATED_EVENT, handleUpdate);

    return () => {
      ipcRenderer.removeListener(SUPPLIER_ORDERS_UPDATED_EVENT, handleUpdate);
    };
  },
};

contextBridge.exposeInMainWorld("appApi", api);
