import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_INVALIDATED_EVENT } from "../../../src/shared/auth";

const { send, getAllWindows, logError } = vi.hoisted(() => ({
  send: vi.fn(),
  getAllWindows: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock("electron-log/main", () => ({
  default: {
    error: logError,
  },
}));

import { notifySessionInvalidated } from "../../../src/main/controllers/session-events";

function windowWithSend(impl?: () => void) {
  return { webContents: { send: impl ?? send } };
}

describe("notifySessionInvalidated (CU23, D10)", () => {
  beforeEach(() => {
    send.mockReset();
    getAllWindows.mockReset();
    logError.mockReset();
  });

  it("broadcasts the usuarioId to every window with the fixed event name", () => {
    getAllWindows.mockReturnValue([windowWithSend(), windowWithSend()]);

    notifySessionInvalidated("23456789-0");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(SESSION_INVALIDATED_EVENT, {
      usuarioId: "23456789-0",
    });
  });

  it("keeps notifying the remaining windows when one send fails", () => {
    getAllWindows.mockReturnValue([
      windowWithSend(() => {
        throw new Error("sender destroyed");
      }),
      windowWithSend(),
    ]);

    notifySessionInvalidated("23456789-0");

    expect(send).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("logs and returns when the window list cannot be read", () => {
    getAllWindows.mockImplementation(() => {
      throw new Error("app not ready");
    });

    expect(() => notifySessionInvalidated("23456789-0")).not.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
