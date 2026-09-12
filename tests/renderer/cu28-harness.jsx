import React from "react";
import { createRoot } from "react-dom/client";
import { ShiftCalendarView } from "../../src/renderer/src/views/ShiftCalendarView";
import { addDaysToDateKey, getWeekStartDateKey, isoDateToDisplay } from "../../src/shared/shifts";
import "../../src/renderer/src/styles.css";

const role = new URL(location.href).searchParams.get("role") ?? "trabajador";
const week = getWeekStartDateKey();
const workers = [
  { trabajadorId: 1, rut: "11111111-1", nombreCompleto: "Ana Soto" },
  { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas" },
];
const state = window.cu28 = {
  workers, fail: false, hold: false, pending: [], calls: [], navigated: null,
};
window.appApi = {
  invoke: (channel, payload) => {
    state.calls.push({ channel, payload });
    let response;
    if (state.fail) {
      response = { ok: false, error: { code: "TECHNICAL_ERROR", message: "Error de prueba CU28" } };
    } else if (channel === "trabajador:listar-activos") {
      response = { ok: true, data: [...state.workers] };
    } else if (channel === "turno:listar") {
      response = {
        ok: true,
        data: {
          inicioSemana: payload.inicioSemana,
          finSemana: addDaysToDateKey(payload.inicioSemana, 6),
          turnos: payload.inicioSemana === week ? state.workers
            .filter((w) => !payload.trabajadorId || w.trabajadorId === payload.trabajadorId)
            .map((w) => ({
              turnoId: `turno-${w.trabajadorId}`, trabajadorId: w.trabajadorId,
              trabajadorNombre: w.nombreCompleto, fechaIso: week, fecha: isoDateToDisplay(week),
              horaInicio: "08:00", horaTermino: "16:00",
              inicioAt: `${week}T11:00:00Z`, terminoAt: `${week}T19:00:00Z`,
              // Deliberately true even for workers: UI must also enforce the role.
              puedeModificar: true,
            })) : [],
        },
      };
    } else if (channel === "turno:editar" || channel === "turno:eliminar") {
      response = { ok: true, data: { turnoId: payload.turnoId } };
    } else {
      throw new Error(`Unexpected channel: ${channel}`);
    }
    return state.hold
      ? new Promise((resolve) => state.pending.push(() => resolve(response)))
      : Promise.resolve(response);
  },
};
createRoot(document.getElementById("root")).render(
  <ShiftCalendarView role={role} usuarioId="22222222-2" onNavigate={(path) => { state.navigated = path; }} />,
);
