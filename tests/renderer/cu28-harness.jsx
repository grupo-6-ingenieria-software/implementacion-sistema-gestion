import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../src/renderer/src/App";
import { evaluateRouteAccess } from "../../src/shared/navigation";
import { addDaysToDateKey, getWeekStartDateKey, isoDateToDisplay, displayDateToIso, parseShiftRange } from "../../src/shared/shifts";
import "../../src/renderer/src/styles.css";

// UI simulation only. Main/controller tests separately prove persistence and authorization.
const params = new URL(location.href).searchParams;
const role = params.get("role") ?? "trabajador";
const week = getWeekStartDateKey();
const workers = [
  { trabajadorId: 1, rut: "11111111-1", nombreCompleto: "Ana Soto" },
  { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas" },
];
const state = window.cu28 = {
  workers, fail: false, hold: false, pending: [], calls: [], navigated: null,
  shiftOverrides: {}, missingShiftIds: [], failAfterEdit: false, failAfterDelete: false,
  mutationError: null,
};
function shifts() {
  return state.workers.map((w) => ({
    turnoId: 'turno-' + w.trabajadorId, trabajadorId: w.trabajadorId,
    trabajadorNombre: w.nombreCompleto, fechaIso: week, fecha: isoDateToDisplay(week),
    horaInicio: "08:00", horaTermino: "16:00",
    inicioAt: week + 'T11:00:00Z', terminoAt: week + 'T19:00:00Z',
    // Deliberately true for both roles: React must also enforce the role.
    puedeModificar: true,
  })).filter((shift) => !state.missingShiftIds.includes(shift.turnoId))
    .map((shift) => ({ ...shift, ...state.shiftOverrides[shift.turnoId] }));
}
window.appApi = {
  invoke: (channel, payload) => {
    state.calls.push({ channel, payload });
    let response;
    if (state.fail) {
      response = { ok: false, error: { code: "TECHNICAL_ERROR", message: "Error de prueba CU28" } };
    } else if (channel === "trabajador:listar-activos") {
      response = { ok: true, data: [...state.workers] };
    } else if (channel === "turno:listar" && payload.consulta === "turno") {
      const turno = shifts().find((s) => s.turnoId === payload.turnoId);
      response = turno ? { ok: true, data: { turno } }
        : { ok: false, error: { code: "BUSINESS_RULE", message: "El turno solicitado no esta disponible." } };
    } else if (channel === "turno:listar") {
      const finSemana = addDaysToDateKey(payload.inicioSemana, 6);
      response = { ok: true, data: {
        inicioSemana: payload.inicioSemana, finSemana,
        turnos: shifts().filter((s) => s.fechaIso >= payload.inicioSemana && s.fechaIso <= finSemana)
          .filter((s) => !payload.trabajadorId || s.trabajadorId === payload.trabajadorId),
      } };
    } else if (["turno:crear", "turno:editar", "turno:eliminar"].includes(channel)) {
      response = state.mutationError
        ? { ok: false, error: { code: "BUSINESS_RULE", message: state.mutationError } }
        : { ok: true, data: { turnoId: payload.turnoId ?? "created" } };
      if (response.ok && channel === "turno:editar") {
        state.shiftOverrides[payload.turnoId] = {
          ...state.shiftOverrides[payload.turnoId], fecha: payload.fecha, fechaIso: displayDateToIso(payload.fecha),
          horaInicio: payload.horaInicio, horaTermino: payload.horaTermino, ...parseShiftRange(payload),
        };
        if (state.failAfterEdit) state.fail = true;
      }
      if (response.ok && channel === "turno:eliminar") {
        state.missingShiftIds.push(payload.turnoId);
        if (state.failAfterDelete) state.fail = true;
      }
    } else {
      throw new Error('Unexpected channel: ' + channel);
    }
    return state.hold
      ? new Promise((resolve) => state.pending.push(() => resolve(response)))
      : Promise.resolve(response);
  },
};
function Harness() {
  const [path, setPath] = useState(params.get("path") ?? "/app/personal/turnos");
  const session = { isAuthenticated: true, role, passwordChangeRequired: false, usuarioId: role === "dueno" ? "11111111-1" : "22222222-2" };
  const navigate = (next) => { state.navigated = next; setPath(next); };
  state.navigate = navigate;
  const access = evaluateRouteAccess(path, session);
  if (access.status !== "allow") {
    state.navigated = access.to;
    return <p role="alert">No tiene permiso para acceder a esta vista.</p>;
  }
  return <AppShell currentPath={path} session={session} onNavigate={navigate} onLogout={() => undefined} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
