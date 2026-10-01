export type AttendanceWorkerOption = {
  trabajadorId: number;
  rut: string;
  nombreCompleto: string;
};

export type AttendanceRequest = {
  fase?: "prevalidar" | "confirmar";
  usuarioId?: string;
  trabajadorRut?: string;
};

export type AttendanceWorkerSummary = AttendanceWorkerOption & {
  turnoId?: string;
  turnoInicio?: string;
  turnoFin?: string;
};

export type AttendanceEntryResult =
  | {
      status: "ready_for_confirmation";
      message: string;
      trabajador: AttendanceWorkerSummary;
    }
  | {
      status: "requires_no_shift_confirmation";
      message: string;
      trabajador: AttendanceWorkerSummary;
    }
  | {
      status: "registered";
      asistenciaId: string;
      entradaAt: string;
      trabajador: AttendanceWorkerSummary;
    };

export type AttendanceExitResult =
  | {
      status: "ready_for_confirmation";
      asistenciaId: string;
      entradaAt: string;
      trabajador: AttendanceWorkerSummary;
    }
  | {
      status: "registered";
      asistenciaId: string;
      entradaAt: string;
      salidaAt: string;
      horasTrabajadas: string;
      trabajador: AttendanceWorkerSummary;
    };

export function normalizeRut(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);

  if (!body || !verifier) {
    return cleaned;
  }

  return `${body}-${verifier}`;
}

export function isValidRutFormat(value: string): boolean {
  return /^[1-9][0-9]{6,7}-[0-9K]$/.test(normalizeRut(value));
}

export function getWorkedMinutes(entradaAt: string, salidaAt: string): number {
  return Math.floor(Math.max(0, Date.parse(salidaAt) - Date.parse(entradaAt)) / 60_000);
}

export function formatWorkedMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatWorkedHours(entradaAt: string, salidaAt: string): string {
  return formatWorkedMinutes(getWorkedMinutes(entradaAt, salidaAt));
}
