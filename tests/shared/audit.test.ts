import { describe, expect, it } from "vitest";
import {
  getAuditLogWindow, getAuditDateInput, getAuditDayStart, getAuditTimestamp,
  normalizeAuditLogQueryPayload,
} from "../../src/shared/audit";

describe("RF58 audit dates and filters", () => {
  it("uses twelve calendar months and clamps leap day", () => {
    expect(getAuditLogWindow(new Date("2024-02-29T15:16:17.123Z"))).toEqual({
      desde: "2023-02-28T15:16:17.123Z", hasta: "2024-02-29T15:16:17.123Z",
    });
    expect(getAuditLogWindow(new Date("2026-09-29T15:00:00Z")).desde)
      .toBe("2025-09-29T15:00:00.000Z");
  });

  it("converts Chilean days, including both daylight saving transitions", () => {
    expect(getAuditDayStart("2026-06-11")).toBe("2026-06-11T04:00:00.000Z");
    expect(getAuditDayStart("2026-06-11", true)).toBe("2026-06-12T04:00:00.000Z");
    expect(getAuditDayStart("2026-09-06")).toBe("2026-09-06T04:00:00.000Z");
    expect(getAuditDayStart("2026-09-06", true)).toBe("2026-09-07T03:00:00.000Z");
    expect(getAuditDayStart("2026-04-04")).toBe("2026-04-04T03:00:00.000Z");
    expect(getAuditDayStart("2026-04-04", true)).toBe("2026-04-05T04:00:00.000Z");
    expect(getAuditDateInput("2026-06-12T02:00:00.000Z")).toBe("2026-06-11");
  });

  it("records Chilean time with an explicit seasonal offset", () => {
    expect(getAuditTimestamp(new Date("2026-06-11T04:00:00.123Z")))
      .toBe("2026-06-11T00:00:00.123-04:00");
    expect(getAuditTimestamp(new Date("2026-09-29T15:00:00Z")))
      .toBe("2026-09-29T12:00:00.000-03:00");
  });

  it.each([
    { fechaDesde: "2026-02-29" }, { fechaHasta: "2026-13-01" },
    { fechaDesde: "2026-09-30", fechaHasta: "2026-09-29" },
    { page: 0 }, { pageSize: 101 },
  ])("rejects invalid query %j", (filters) => {
    expect(() => normalizeAuditLogQueryPayload({ usuarioId: "owner", ...filters })).toThrow();
  });
});
