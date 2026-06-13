export type AttendanceWorkerOption = {
  trabajadorId: number;
  rut: string;
  nombreCompleto: string;
};

export type AttendanceRequest = {
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
      status: 'requires_no_shift_confirmation';
      message: string;
      trabajador: AttendanceWorkerSummary;
    }
  | {
      status: 'registered';
      asistenciaId: string;
      entradaAt: string;
      trabajador: AttendanceWorkerSummary;
    };

export type AttendanceExitResult = {
  status: 'registered';
  asistenciaId: string;
  entradaAt: string;
  salidaAt: string;
  horasTrabajadas: string;
  trabajador: AttendanceWorkerSummary;
};

export function normalizeRut(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/\s/g, '')
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
