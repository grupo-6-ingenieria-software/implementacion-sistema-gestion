import { contextBridge, ipcRenderer } from 'electron';
import type { ControllerResponse } from '../shared/controllers';
import { DASHBOARD_UPDATED_EVENT } from '../shared/dashboard';
import { SESSION_EXPIRED_EVENT } from '../shared/auth';

export type AppApi = {
  invoke: <TData = unknown>(
    channel: string,
    payload?: unknown,
  ) => Promise<ControllerResponse<TData>>;
  /**
   * Guarda (o limpia con null) el JWT de sesión emitido en el login. El token
   * se adjunta automáticamente a cada invoke como `__authToken`, de modo que el
   * dispatcher del proceso principal pueda verificar identidad y rol sin que el
   * renderer pueda falsificar el usuarioId. Ver controllers/index.ts.
   */
  setSessionToken: (token: string | null) => void;
  onDashboardUpdated: (listener: () => void) => () => void;
  onSessionExpired: (listener: () => void) => () => void;
};

// Token de sesión vigente. Vive sólo en el contexto del preload (aislado del
// renderer), por lo que no es accesible ni manipulable desde la página web.
let sessionToken: string | null = null;

const api: AppApi = {
  invoke: (channel, payload) => {
    // Fusiona el token en el payload sin alterar su forma existente. Los
    // payloads son objetos (o ausentes) en todos los call sites del renderer;
    // un eventual primitivo/array se reenvía tal cual (sólo aplica a canales
    // públicos que no requieren token).
    if (payload === undefined || payload === null) {
      return ipcRenderer.invoke(channel, { __authToken: sessionToken });
    }

    if (typeof payload === 'object' && !Array.isArray(payload)) {
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

contextBridge.exposeInMainWorld('appApi', api);
