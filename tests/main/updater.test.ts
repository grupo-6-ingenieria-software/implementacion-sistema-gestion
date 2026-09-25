import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { autoUpdater, showMessageBox, logError } = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  const updater = Object.assign(new Emitter(), {
    logger: null as unknown,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  });
  return {
    autoUpdater: updater,
    showMessageBox: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox },
}));

vi.mock("electron-log/main", () => ({
  default: { error: logError },
}));

vi.mock("electron-updater", () => ({
  default: { autoUpdater },
}));

import {
  shouldCheckForUpdates,
  startAutoUpdater,
  UPDATE_CHECK_INTERVAL_MS,
} from "../../src/main/updater";

const windowsInstalled = { platform: "win32", isPackaged: true } as const;

describe("shouldCheckForUpdates", () => {
  it("sólo habilita la build empaquetada de Windows", () => {
    expect(shouldCheckForUpdates(windowsInstalled)).toBe(true);
    expect(shouldCheckForUpdates({ platform: "win32", isPackaged: false })).toBe(
      false,
    );
    expect(shouldCheckForUpdates({ platform: "darwin", isPackaged: true })).toBe(
      false,
    );
  });
});

describe("startAutoUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autoUpdater.removeAllListeners();
    autoUpdater.checkForUpdates.mockReset().mockResolvedValue(null);
    autoUpdater.quitAndInstall.mockReset();
    showMessageBox.mockReset();
    logError.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("no consulta actualizaciones fuera de Windows empaquetado", () => {
    startAutoUpdater({ platform: "darwin", isPackaged: true });
    startAutoUpdater({ platform: "win32", isPackaged: false });

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("consulta al arrancar y luego periódicamente", () => {
    startAutoUpdater(windowsInstalled);

    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("registra los errores sin propagar el rechazo", async () => {
    const failure = new Error("sin red");
    autoUpdater.checkForUpdates.mockRejectedValue(failure);

    startAutoUpdater(windowsInstalled);
    autoUpdater.emit("error", failure);
    await vi.runOnlyPendingTimersAsync();

    expect(logError).toHaveBeenCalledWith(
      "Fallo al buscar o descargar la actualización:",
      failure,
    );
  });

  it("reinicia e instala si el usuario acepta", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });

    startAutoUpdater(windowsInstalled);
    autoUpdater.emit("update-downloaded", { version: "0.4.0" });
    await vi.waitFor(() =>
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true),
    );

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "La versión 0.4.0 está lista para instalarse.",
      }),
    );
  });

  it("posterga la instalación y no vuelve a preguntar", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });

    startAutoUpdater(windowsInstalled);
    autoUpdater.emit("update-downloaded", { version: "0.4.0" });
    autoUpdater.emit("update-downloaded", { version: "0.4.0" });
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalled());

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
