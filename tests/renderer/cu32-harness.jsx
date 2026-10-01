import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../src/renderer/src/App";
import { evaluateRouteAccess } from "../../src/shared/navigation";
import "../../src/renderer/src/styles.css";

// Browser simulation; absence-service.test.ts proves real persistence and access.
const params = new URL(location.href).searchParams;
const role = params.get("role") ?? "dueno";
const workers = [
  { trabajadorId: 1, rut: "11111111-1", nombreCompleto: "Ana Soto", estado: "activo", rol: "dueno" },
  { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas", estado: "activo", rol: "trabajador" },
  { trabajadorId: 3, rut: "33333333-3", nombreCompleto: "Inés Pérez", estado: "inactivo", rol: "trabajador" },
];
const state = window.cu32 = {
  workers, calls: [], navigated: null, hold: false, pending: [], writes: [],
  loadError: null, saveError: null, rejectLoad: false, rejectSave: false,
};
window.appApi = {
  invoke: async (channel, payload) => {
    state.calls.push({ channel, payload });
    if (channel === "trabajador:listar-activos") {
      if (state.rejectLoad) throw new Error("Load communication failure");
      return state.loadError ? { ok: false, error: { code: "TECHNICAL_ERROR", message: state.loadError } }
        : { ok: true, data: state.workers.filter((w) => w.estado === "activo").map(({ trabajadorId, rut, nombreCompleto }) => ({ trabajadorId, rut, nombreCompleto })) };
    }
    if (channel === "trabajador:listar") {
      return { ok: true, data: { users: state.workers.map((worker) => ({ ...worker, usuarioId: worker.rut, telefono: "987654321", fechaIngreso: "2024-01-01" })) } };
    }
    if (channel !== "ausencia:registrar") throw new Error("Unexpected channel " + channel);
    const respond = () => {
      if (state.rejectSave) throw new Error("Save communication failure");
      if (state.saveError) return { ok: false, error: state.saveError };
      const worker = state.workers.find((w) => w.trabajadorId === payload.trabajadorId);
      state.writes.push(payload);
      return { ok: true, data: { ausenciaId: "absence-" + state.writes.length, trabajadorId: worker.trabajadorId,
        trabajadorNombre: worker.nombreCompleto, fecha: payload.fecha, tipo: payload.tipo, registradoAt: new Date().toISOString() } };
    };
    if (state.hold) return new Promise((resolve, reject) => state.pending.push(() => { try { resolve(respond()); } catch (error) { reject(error); } }));
    return respond();
  },
};

function Harness() {
  const [path, setPath] = useState(params.get("path") ?? "/app/personal/ausencias/nueva");
  const session = { isAuthenticated: true, role, usuarioId: "11111111-1", passwordChangeRequired: false, displayName: "Ana Soto" };
  const navigate = (next) => { state.navigated = next; setPath(next); };
  state.navigate = navigate;
  const access = evaluateRouteAccess(path, session);
  if (access.status !== "allow") return <p role="alert">No tiene permiso para acceder a esta vista.</p>;
  return <AppShell currentPath={path} session={session} onNavigate={navigate}
    onLogout={() => undefined} onAuthenticationRequired={() => undefined} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
