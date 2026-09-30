import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_RETENTION_INTERVAL_MS,
  startAuditRetentionMaintenance,
} from "../../../src/main/controllers/audit-retention-service";

afterEach(() => vi.useRealTimers());

describe("RF58 automatic retention maintenance", () => {
  it("runs on startup, every 24 hours and stops on shutdown", async () => {
    vi.useFakeTimers();
    const purge = vi.fn(async () => 2);
    const reportError = vi.fn();
    const stop = startAuditRetentionMaintenance({ purge, reportError });
    expect(purge).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INTERVAL_MS - 1);
    expect(purge).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(purge).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports persistence failures and retries on the next cycle", async () => {
    vi.useFakeTimers();
    const error = new Error("database unavailable");
    const purge = vi.fn<() => Promise<number>>()
      .mockRejectedValueOnce(error).mockResolvedValue(1);
    const reportError = vi.fn();
    const stop = startAuditRetentionMaintenance({ purge, reportError });
    await vi.advanceTimersByTimeAsync(0);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(error);
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledOnce();
    stop();
  });

  it("does not overlap a purge that is still running", async () => {
    vi.useFakeTimers();
    let finish: (count: number) => void = () => undefined;
    const pending = new Promise<number>((resolve) => { finish = resolve; });
    const purge = vi.fn<() => Promise<number>>()
      .mockReturnValueOnce(pending).mockResolvedValue(0);
    const stop = startAuditRetentionMaintenance({ purge, reportError: vi.fn() });
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INTERVAL_MS * 2);
    expect(purge).toHaveBeenCalledOnce();
    finish(1);
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    stop();
  });
});
