import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDatabaseTimestamp } from "../../src/shared/date-time";

afterEach(() => vi.unstubAllEnvs());

describe("database timestamps in renderer date formatting", () => {
  it.each(["America/Santiago", "Asia/Tokyo", "UTC"])("preserves UTC instants when the system timezone is %s", (timezone) => {
    vi.stubEnv("TZ", timezone);
    for (const value of ["2026-10-03 21:18:05.123", "2026-10-03T21:18:05.123Z", "2026-10-03T18:18:05.123-03:00"]) {
      expect(parseDatabaseTimestamp(value)).toBe(Date.UTC(2026, 9, 3, 21, 18, 5, 123));
    }
  });

  it.each([
    ["2026-10-03 21:18:05", "18:18"],
    ["2026-06-12 21:18:05", "17:18"],
  ])("formats SQL timestamp %s using the Chilean seasonal offset", (value, expected) => {
    const formatted = new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(parseDatabaseTimestamp(value));
    expect(formatted).toBe(expected);
  });
});
