import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  displayDateToIso,
  getWeekStartForDateKey,
  parseShiftRange,
  shiftStateLabel,
  validateShiftCreatePayload,
  validateShiftDeletePayload,
  validateShiftEditPayload,
  validateShiftListPayload,
} from "../../src/shared/shifts";

describe("contratos de turnos", () => {
  it("valida los formatos de fecha y hora documentados", () => {
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: "13/06/2026",
        horaInicio: "09:00",
        horaTermino: "08:00",
      }),
    ).toMatchObject({
      horaTermino: "La hora de termino debe ser posterior a la hora de inicio.",
    });
    expect(displayDateToIso("31/02/2026")).toBeNull();
    expect(displayDateToIso("13/06/2026")).toBe("2026-06-13");
  });

  it("rechaza horas inválidas y turnos que cruzan la medianoche", () => {
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: "13/06/2026",
        horaInicio: "8:00",
        horaTermino: "16:60",
      }),
    ).toMatchObject({
      horaInicio: "Ingrese la hora de inicio en formato HH:MM.",
      horaTermino: "Ingrese la hora de termino en formato HH:MM.",
    });
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: "13/06/2026",
        horaInicio: "22:00",
        horaTermino: "02:00",
      }),
    ).toMatchObject({
      horaTermino: "La hora de termino debe ser posterior a la hora de inicio.",
    });
  });

  it("exige identificador de turno y confirmación antes de eliminar", () => {
    expect(
      validateShiftDeletePayload({
        turnoId: "",
        confirmacion: false,
      }),
    ).toEqual({
      turnoId: "No se pudo identificar el turno.",
      confirmacion: "Debe confirmar la eliminacion del turno.",
    });
  });

  it("aplica la misma validación de fecha y hora al editar", () => {
    expect(
      validateShiftEditPayload({
        turnoId: "turno-1",
        fecha: "31/02/2026",
        horaInicio: "10:00",
        horaTermino: "09:00",
      }),
    ).toMatchObject({
      fecha: "Ingrese la fecha en formato DD/MM/AAAA.",
      horaTermino: "La hora de termino debe ser posterior a la hora de inicio.",
    });
  });

  it.each(["13/13/2026", "00/01/2026", "31/02/2026", "01/00/2026"])(
    "rechaza la fecha de visualización imposible %s sin lanzar excepciones",
    (fecha) => {
      expect(() => displayDateToIso(fecha)).not.toThrow();
      expect(displayDateToIso(fecha)).toBeNull();
      expect(
        validateShiftCreatePayload({
          trabajadorId: 1,
          fecha,
          horaInicio: "08:00",
          horaTermino: "16:00",
        }),
      ).toMatchObject({
        fecha: "Ingrese la fecha en formato DD/MM/AAAA.",
      });
    },
  );

  it.each(["2026-13-01", "2026-00-01", "2026-02-31"])(
    "rechaza la fecha ISO imposible %s sin lanzar excepciones",
    (inicioSemana) => {
      expect(() =>
        validateShiftListPayload({
          inicioSemana,
        }),
      ).not.toThrow();
      expect(
        validateShiftListPayload({
          inicioSemana,
        }),
      ).toMatchObject({
        fecha: "Ingrese un inicio de semana valido.",
      });
    },
  );

  it("convierte horas locales de Chile a marcas de tiempo UTC", () => {
    expect(
      parseShiftRange({
        fecha: "13/06/2026",
        horaInicio: "08:00",
        horaTermino: "16:00",
      }),
    ).toEqual({
      fechaIso: "2026-06-13",
      inicioAt: "2026-06-13T12:00:00.000Z",
      terminoAt: "2026-06-13T20:00:00.000Z",
    });
  });

  it("calcula semanas que comienzan el lunes", () => {
    expect(getWeekStartForDateKey("2026-06-13")).toBe("2026-06-08");
    expect(getWeekStartForDateKey("2026-06-14")).toBe("2026-06-08");
    expect(addDaysToDateKey("2026-06-08", 6)).toBe("2026-06-14");
  });

  it("asigna el estado inicial persistido a la etiqueta Pendiente documentada", () => {
    expect(shiftStateLabel("planificado")).toBe("Pendiente");
  });
});
