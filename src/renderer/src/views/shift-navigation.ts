import {
  getWeekStartDateKey, getWeekStartForDateKey, validateShiftListPayload,
} from "../../../shared/shifts";

export type ShiftCalendarContext = { inicioSemana: string; trabajadorId?: number };

export function getShiftCalendarContext(path: string): ShiftCalendarContext {
  const params = new URLSearchParams(path.split("?")[1] ?? "");
  const inicioSemana = params.get("inicioSemana") ?? "";
  const rawWorker = params.get("trabajadorId") ?? "";
  const trabajadorId = /^\d+$/.test(rawWorker) ? Number(rawWorker) : undefined;
  return {
    inicioSemana: validateShiftListPayload({ inicioSemana }).fecha
      ? getWeekStartDateKey() : getWeekStartForDateKey(inicioSemana),
    trabajadorId: trabajadorId !== undefined && Number.isSafeInteger(trabajadorId) && trabajadorId > 0
      ? trabajadorId : undefined,
  };
}

export function buildShiftCalendarPath(context: ShiftCalendarContext): string {
  const params = new URLSearchParams({ inicioSemana: context.inicioSemana });
  if (context.trabajadorId) params.set("trabajadorId", String(context.trabajadorId));
  return `/app/personal/turnos?${params}`;
}

export function buildShiftEditPath(turnoId: string, context: ShiftCalendarContext): string {
  return buildShiftCalendarPath(context).replace(
    "/turnos?", `/turnos/${encodeURIComponent(turnoId)}/editar?`,
  );
}

export function getShiftEditId(path: string): string | undefined {
  const match = /^\/app\/personal\/turnos\/([^/]+)\/editar\/?$/.exec(path.split("?")[0]);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]).trim(); } catch { return ""; }
}
