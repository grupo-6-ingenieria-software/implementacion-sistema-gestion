export type ShiftFieldErrors = Partial<
  Record<
    | 'trabajadorId'
    | 'fecha'
    | 'horaInicio'
    | 'horaTermino'
    | 'turnoId'
    | 'confirmacion',
    string
  >
>;

export type ShiftFormValues = {
  usuarioId?: string;
  trabajadorId: number;
  fecha: string;
  horaInicio: string;
  horaTermino: string;
};

export type ShiftCreatePayload = ShiftFormValues;

export type ShiftEditPayload = Omit<ShiftFormValues, 'trabajadorId'> & {
  turnoId: string;
};

export type ShiftDeletePayload = {
  usuarioId?: string;
  turnoId: string;
  confirmacion: boolean;
};

export type ShiftListPayload = {
  usuarioId?: string;
  inicioSemana: string;
  trabajadorId?: number;
};

export type ShiftCalendarItem = {
  turnoId: string;
  trabajadorId: number;
  trabajadorNombre: string;
  fecha: string;
  fechaIso: string;
  horaInicio: string;
  horaTermino: string;
  inicioAt: string;
  terminoAt: string;
  puedeModificar: boolean;
};

export type ShiftListResponse = {
  inicioSemana: string;
  finSemana: string;
  turnos: ShiftCalendarItem[];
};

export type ShiftMutationResponse = {
  turnoId: string;
};

export function normalizeShiftCreatePayload(payload: unknown): ShiftCreatePayload {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId: normalizeText(record.usuarioId),
    trabajadorId: normalizeInteger(record.trabajadorId),
    fecha: normalizeText(record.fecha),
    horaInicio: normalizeText(record.horaInicio),
    horaTermino: normalizeText(record.horaTermino),
  };
}

export function normalizeShiftEditPayload(payload: unknown): ShiftEditPayload {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId: normalizeText(record.usuarioId),
    turnoId: normalizeText(record.turnoId),
    fecha: normalizeText(record.fecha),
    horaInicio: normalizeText(record.horaInicio),
    horaTermino: normalizeText(record.horaTermino),
  };
}

export function normalizeShiftDeletePayload(payload: unknown): ShiftDeletePayload {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId: normalizeText(record.usuarioId),
    turnoId: normalizeText(record.turnoId),
    confirmacion: record.confirmacion === true,
  };
}

export function normalizeShiftListPayload(payload: unknown): ShiftListPayload {
  const record = isRecord(payload) ? payload : {};
  const trabajadorId = normalizeInteger(record.trabajadorId);

  return {
    usuarioId: normalizeText(record.usuarioId),
    inicioSemana: normalizeText(record.inicioSemana),
    trabajadorId:
      Number.isInteger(trabajadorId) && trabajadorId > 0
        ? trabajadorId
        : undefined,
  };
}

export function validateShiftCreatePayload(
  values: ShiftCreatePayload,
): ShiftFieldErrors {
  const errors = validateShiftForm(values);

  if (!Number.isInteger(values.trabajadorId) || values.trabajadorId <= 0) {
    errors.trabajadorId = 'Seleccione un trabajador activo.';
  }

  return errors;
}

export function validateShiftEditPayload(
  values: ShiftEditPayload,
): ShiftFieldErrors {
  const errors = validateShiftForm(values);

  if (!values.turnoId) {
    errors.turnoId = 'No se pudo identificar el turno.';
  }

  return errors;
}

export function validateShiftDeletePayload(
  values: ShiftDeletePayload,
): ShiftFieldErrors {
  const errors: ShiftFieldErrors = {};

  if (!values.turnoId) {
    errors.turnoId = 'No se pudo identificar el turno.';
  }

  if (!values.confirmacion) {
    errors.confirmacion = 'Debe confirmar la eliminacion del turno.';
  }

  return errors;
}

export function validateShiftListPayload(
  values: ShiftListPayload,
): ShiftFieldErrors {
  const errors: ShiftFieldErrors = {};

  if (!isIsoDate(values.inicioSemana)) {
    errors.fecha = 'Ingrese un inicio de semana valido.';
  }

  return errors;
}

export function hasShiftFieldErrors(errors: ShiftFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function parseShiftRange(values: {
  fecha: string;
  horaInicio: string;
  horaTermino: string;
}): { inicioAt: string; terminoAt: string; fechaIso: string } | null {
  const fechaIso = displayDateToIso(values.fecha);

  if (
    !fechaIso ||
    !isTime(values.horaInicio) ||
    !isTime(values.horaTermino) ||
    values.horaTermino <= values.horaInicio
  ) {
    return null;
  }

  return {
    fechaIso,
    inicioAt: chileLocalDateTimeToIso(fechaIso, values.horaInicio),
    terminoAt: chileLocalDateTimeToIso(fechaIso, values.horaTermino),
  };
}

export function displayDateToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return isValidDateParts(year, month, day)
    ? `${year}-${month}-${day}`
    : null;
}

export function isoDateToDisplay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function getCurrentChileDateKey(now = new Date()): string {
  return formatChileParts(now).dateKey;
}

export function getWeekStartDateKey(now = new Date()): string {
  return getWeekStartForDateKey(getCurrentChileDateKey(now));
}

export function getWeekStartForDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatShiftTimestamp(value: string): {
  fecha: string;
  fechaIso: string;
  hora: string;
} {
  const parts = formatChileParts(new Date(value));

  return {
    fecha: isoDateToDisplay(parts.dateKey),
    fechaIso: parts.dateKey,
    hora: parts.time,
  };
}

function validateShiftForm(values: {
  fecha: string;
  horaInicio: string;
  horaTermino: string;
}): ShiftFieldErrors {
  const errors: ShiftFieldErrors = {};

  if (!displayDateToIso(values.fecha)) {
    errors.fecha = 'Ingrese la fecha en formato DD/MM/AAAA.';
  }

  if (!isTime(values.horaInicio)) {
    errors.horaInicio = 'Ingrese la hora de inicio en formato HH:MM.';
  }

  if (!isTime(values.horaTermino)) {
    errors.horaTermino = 'Ingrese la hora de termino en formato HH:MM.';
  } else if (isTime(values.horaInicio) && values.horaTermino <= values.horaInicio) {
    errors.horaTermino =
      'La hora de termino debe ser posterior a la hora de inicio.';
  }

  return errors;
}

function chileLocalDateTimeToIso(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatChileParts(new Date(candidate));
    const representedAsUtc = Date.UTC(
      Number(parts.dateKey.slice(0, 4)),
      Number(parts.dateKey.slice(5, 7)) - 1,
      Number(parts.dateKey.slice(8, 10)),
      Number(parts.time.slice(0, 2)),
      Number(parts.time.slice(3, 5)),
    );
    const correction = desiredAsUtc - representedAsUtc;

    if (correction === 0) {
      break;
    }

    candidate += correction;
  }

  return new Date(candidate).toISOString();
}

function formatChileParts(date: Date): { dateKey: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  return isValidDateParts(year, month, day);
}

function isValidDateParts(
  yearText: string,
  monthText: string,
  dayText: string,
): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInteger(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  return Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
