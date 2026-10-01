import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../src/renderer/src/App";
import { evaluateRouteAccess } from "../../src/shared/navigation";
import "../../src/renderer/src/styles.css";

// Browser simulation; monthly-attendance-service.test.ts verifies real queries.
const params = new URL(location.href).searchParams;
const role = params.get("role") ?? "dueno";
const workers = [
  { trabajadorId: 1, rut: "11111111-1", nombreCompleto: "Ana Soto", estado: "activo", rol: "dueno" },
  { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas", estado: "activo", rol: "trabajador" },
  { trabajadorId: 3, rut: "33333333-3", nombreCompleto: "Inés Pérez", estado: "inactivo", rol: "trabajador", cuenta: false },
  { trabajadorId: 4, rut: "44444444-4", nombreCompleto: "Pedro Díaz", estado: "inactivo", rol: "trabajador" },
];
const state = window.cu33 = {
  workers, calls: [], navigated: null, pending: [], hold: false, empty: false,
  queryError: null, rejectQuery: false, loadError: params.has("loadError"), rejectLoad: false,
};
function summary(request) {
  const trabajador = workers.find((worker) => worker.trabajadorId === request.trabajadorId);
  const key = `${request.anio}-${String(request.mes).padStart(2, "0")}`;
  return { trabajador, periodo: { mes: request.mes, anio: request.anio },
    dias: state.empty ? [] : [
      { fecha: `${key}-01`, entradaAt: "2026-09-01T12:00:00Z", salidaAt: "2026-09-01T20:00:00Z", minutosTrabajados: 480, estado: "presente" },
      { fecha: `${key}-02`, entradaAt: "2026-09-02T12:00:00Z", salidaAt: null, minutosTrabajados: null, estado: "pendiente" },
      { fecha: `${key}-03`, entradaAt: null, salidaAt: null, minutosTrabajados: null, estado: "licencia" },
      { fecha: `${key}-30`, entradaAt: "2026-10-01T02:00:00Z", salidaAt: "2026-10-01T05:00:00Z", minutosTrabajados: 180, estado: "presente" },
    ],
    totales: { diasTrabajados: state.empty ? 0 : 3, minutosTrabajados: state.empty ? 0 : 660, ausenciasJustificadas: state.empty ? 0 : 1, ausenciasInjustificadas: 0 },
    semanas: [ ["01", "06", 480], ["07", "13", 0], ["14", "20", 0], ["21", "27", 0], ["28", "30", 180] ]
      .map(([desde, hasta, minutes]) => ({ desde: `${key}-${desde}`, hasta: `${key}-${hasta}`, minutosTrabajados: state.empty ? 0 : minutes })),
  };
}
window.appApi = {
  invoke: async (channel, payload) => {
    state.calls.push({ channel, payload });
    if (channel === "trabajador:listar-para-resumen") {
      if (state.rejectLoad) throw new Error("Worker load communication failure");
      return state.loadError ? { ok: false, error: { code: "DATABASE_ERROR", message: "No fue posible cargar los trabajadores." } } : { ok: true, data: workers };
    }
    if (channel === "trabajador:listar-activos") return { ok: true, data: workers.filter((worker) => worker.estado === "activo") };
    if (channel === "trabajador:listar") return { ok: true, data: { users: workers.filter((worker) => worker.cuenta !== false).map((worker) => ({ ...worker, usuarioId: worker.rut, telefono: "987654321", fechaIngreso: "2024-01-01" })) } };
    if (channel !== "asistencia:resumen-mensual") return { ok: false, error: { code: "TECHNICAL_ERROR", message: "Unavailable in this harness" } };
    const response = state.queryError ? { ok: false, error: state.queryError } : { ok: true, data: summary(payload) };
    const reject = state.rejectQuery;
    const respond = () => { if (reject) throw new Error("Summary communication failure"); return response; };
    if (state.hold) return new Promise((resolve, reject) => state.pending.push(() => { try { resolve(respond()); } catch (error) { reject(error); } }));
    return respond();
  },
};
function Harness() {
  const [path, setPath] = useState(params.get("path") ?? "/app/personal/asistencia/resumen-mensual");
  const [, setRefresh] = useState(0);
  const session = { isAuthenticated: true, role, usuarioId: "11111111-1", passwordChangeRequired: false, displayName: "Ana Soto" };
  const navigate = (next) => { state.navigated = next; setPath(next); };
  state.navigate = navigate;
  state.rerender = () => setRefresh((value) => value + 1);
  if (evaluateRouteAccess(path, session).status !== "allow") return <p role="alert">No tiene permiso para acceder a esta vista.</p>;
  return <AppShell currentPath={path} session={session} onNavigate={navigate} onLogout={() => undefined} onAuthenticationRequired={() => undefined} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
