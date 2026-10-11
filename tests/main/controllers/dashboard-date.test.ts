import { describe, expect, it } from "vitest";
import {
  differenceInCalendarDays,
  getChileDateRange,
  getDashboardDay,
  parseDatabaseTimestamp,
} from "../../../src/main/controllers/dashboard-date";

describe("límites de fecha del dashboard", () => {
  it.each([
    "2026-10-03 21:19:15.123",
    "2026-10-03T21:19:15.123",
    "2026-10-03T21:19:15.123Z",
    "2026-10-03T18:19:15.123-03:00",
  ])("interpreta la marca de tiempo de base de datos %s como el mismo instante UTC", (value) => {
    expect(parseDatabaseTimestamp(value)).toBe(Date.UTC(2026, 9, 3, 21, 19, 15, 123));
  });
  it("conserva años civiles históricos menores que 100", () => {
    expect(getChileDateRange("0095-09-08", "0095-09-08")).toEqual({
      startUtc: "0095-09-08 04:42:45",
      endUtc: "0095-09-09 04:42:45",
    });
  });
  it("usa la hora de invierno de Chile para el día local actual", () => {
    expect(getDashboardDay(new Date("2026-06-11T12:00:00Z"))).toEqual({
      dateKey: "2026-06-11",
      startUtc: "2026-06-11 04:00:00",
      endUtc: "2026-06-12 04:00:00",
    });
  });

  it("usa la hora de verano de Chile para el día local actual", () => {
    expect(getDashboardDay(new Date("2026-01-15T12:00:00Z"))).toEqual({
      dateKey: "2026-01-15",
      startUtc: "2026-01-15 03:00:00",
      endUtc: "2026-01-16 03:00:00",
    });
  });

  it("calcula días calendario sin desfase por cambio de horario", () => {
    expect(differenceInCalendarDays("2026-06-18", "2026-06-11")).toBe(7);
    expect(differenceInCalendarDays("2026-06-10", "2026-06-11")).toBe(-1);
  });

  it("construye un rango chileno inclusivo a través de un cambio de horario", () => {
    expect(getChileDateRange("2026-04-04", "2026-04-05")).toEqual({
      startUtc: "2026-04-04 03:00:00",
      endUtc: "2026-04-06 04:00:00",
    });
  });
});
