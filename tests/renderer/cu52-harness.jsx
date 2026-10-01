import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/src/App";
import "../../src/renderer/src/styles.css";

// UI transport simulation; attendance-report-service.test.ts exercises the real database.
const role = new URL(location.href).searchParams.get("role") ?? "dueno";
const state = window.cu52 = { calls: [], hold: false, pending: [], empty: false, queryError: null,
  rejectQuery: false, exportError: false, cancelled: false, token: null };
const rows = [
  { trabajadorId: 1, nombreCompleto: "Ana Soto", rol: "dueno", diasTrabajados: 0, ausenciasJustificadas: 0, ausenciasInjustificadas: 0, minutosTrabajados: 0, promedioMinutosPorDia: null },
  { trabajadorId: 3, nombreCompleto: "Inés Pérez", rol: null, diasTrabajados: 1, ausenciasJustificadas: 1, ausenciasInjustificadas: 0, minutosTrabajados: 0, promedioMinutosPorDia: null },
  { trabajadorId: 2, nombreCompleto: "Luis Rojas", rol: "trabajador", diasTrabajados: 3, ausenciasJustificadas: 4, ausenciasInjustificadas: 1, minutosTrabajados: 961, promedioMinutosPorDia: 480 },
];
window.appApi = {
  debugMode: false,
  setSessionToken: (token) => { state.token = token; },
  onSessionExpired: (callback) => { state.expire = callback; return () => { state.expire = null; }; },
  onSessionInvalidated: () => () => undefined,
  onDashboardUpdated: () => () => undefined,
  onSupplierOrdersUpdated: () => () => undefined,
  invoke: async (channel, payload) => {
    state.calls.push({ channel, payload });
    if (channel === "auth:login") return { ok: true, data: { token: "test-token", role, usuarioId: "11111111-1", trabajadorNombre: "Ana Soto", usuarioRol: role, passwordChangeRequired: false } };
    if (channel === "auth:verificar-sesion") return { ok: true, data: { active: true } };
    if (channel === "access:validate") return role === "trabajador" && payload.ruta.startsWith("/app/reportes")
      ? { ok: false, error: { code: "FORBIDDEN", message: "Acceso denegado" } } : { ok: true, data: {} };
    if (channel === "reporte:asistencia") {
      const response = state.queryError ? { ok: false, error: state.queryError } : { ok: true, data: {
        periodo: { mes: payload.mes, anio: payload.anio }, rol: payload.rol ?? null,
        filas: state.empty ? [] : rows.filter((row) => !payload.rol || row.rol === payload.rol),
      } };
      const reject = state.rejectQuery;
      const respond = () => { if (reject) throw Error("Query connection failure"); return response; };
      if (state.hold) return new Promise((resolve, reject) => state.pending.push(() => { try { resolve(respond()); } catch (error) { reject(error); } }));
      return respond();
    }
    if (channel.startsWith("reporte:exportar-")) {
      const response = state.exportError ? { ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible generar el archivo" } }
        : { ok: true, data: { estado: state.cancelled ? "cancelled" : "saved" } };
      if (state.hold) return new Promise((resolve) => state.pending.push(() => resolve(response)));
      return response;
    }
    return { ok: false, error: { code: "TECHNICAL_ERROR", message: "Unavailable in this harness" } };
  },
};
createRoot(document.getElementById("root")).render(<App />);
