export const defaultAuditLogPageSize = 25;
export const maxAuditLogPageSize = 100;
export const auditTimezone = 'America/Santiago';

export type AuditLogQueryPayload = {
  fechaDesde?: string;
  fechaHasta?: string;
  page?: number;
  pageSize?: number;
  tipoAccion?: string;
  usuarioFiltroId?: string;
  usuarioId?: string;
};

export type AuditLogEntry = {
  descripcion: string;
  fechaHora: string;
  id: string;
  modulo: string;
  rol: string;
  tipoAccion: string;
  usuarioId: string;
  usuarioNombre: string;
};

export type AuditLogUserOption = {
  id: string;
  nombre: string;
  rol: string;
};

export type AuditLogQueryResponse = {
  entries: AuditLogEntry[];
  filters: {
    tiposAccion: string[];
    usuarios: AuditLogUserOption[];
  };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type NormalizedAuditLogQuery = {
  fechaDesde?: string;
  fechaHasta?: string;
  page: number;
  pageSize: number;
  tipoAccion?: string;
  usuarioFiltroId?: string;
  usuarioId?: string;
};

export type AuditLogFieldErrors = Partial<
  Record<
    'fechaDesde' | 'fechaHasta' | 'page' | 'pageSize' | 'usuarioId',
    string
  >
>;

export class AuditLogValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: AuditLogFieldErrors = {},
  ) {
    super(message);
  }
}

export function getAuditTimestamp(date = new Date()): string {
  const parts = getChileDateTimeParts(date);
  const offsetMinutes = getChileOffsetMinutes(date);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, '0');

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}${sign}${offsetHours}:${offsetRemainder}`;
}

export function normalizeAuditLogQueryPayload(
  payload: unknown,
): NormalizedAuditLogQuery {
  const input =
    payload && typeof payload === 'object'
      ? (payload as AuditLogQueryPayload)
      : {};
  const usuarioId = normalizeOptionalText(input.usuarioId);
  const usuarioFiltroId = normalizeOptionalText(input.usuarioFiltroId);
  const tipoAccion = normalizeOptionalText(input.tipoAccion);
  const fechaDesde = normalizeOptionalText(input.fechaDesde);
  const fechaHasta = normalizeOptionalText(input.fechaHasta);
  const page = normalizeInteger(input.page, 1);
  const pageSize = normalizeInteger(input.pageSize, defaultAuditLogPageSize);
  const fieldErrors: AuditLogFieldErrors = {};

  if (!usuarioId) {
    fieldErrors.usuarioId = 'No hay un usuario autenticado para esta accion.';
  }

  if (fechaDesde && !isValidDateInput(fechaDesde)) {
    fieldErrors.fechaDesde = 'Ingrese una fecha desde valida.';
  }

  if (fechaHasta && !isValidDateInput(fechaHasta)) {
    fieldErrors.fechaHasta = 'Ingrese una fecha hasta valida.';
  }

  if (
    fechaDesde &&
    fechaHasta &&
    isValidDateInput(fechaDesde) &&
    isValidDateInput(fechaHasta) &&
    fechaDesde > fechaHasta
  ) {
    fieldErrors.fechaHasta =
      'La fecha hasta debe ser igual o posterior a la fecha desde.';
  }

  if (!Number.isInteger(page) || page < 1) {
    fieldErrors.page = 'La pagina solicitada no es valida.';
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > maxAuditLogPageSize
  ) {
    fieldErrors.pageSize = `El tamano de pagina debe estar entre 1 y ${maxAuditLogPageSize}.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AuditLogValidationError(
      'Revise los filtros antes de consultar el log de auditoria.',
      fieldErrors,
    );
  }

  return {
    fechaDesde,
    fechaHasta,
    page,
    pageSize,
    tipoAccion,
    usuarioFiltroId,
    usuarioId,
  };
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return Number(value);
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function getChileDateTimeParts(date: Date): {
  day: string;
  hour: string;
  millisecond: string;
  minute: string;
  month: string;
  second: string;
  year: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: auditTimezone,
    year: 'numeric',
  });
  const formatted = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    day: formatted.day,
    hour: formatted.hour,
    millisecond: String(date.getMilliseconds()).padStart(3, '0'),
    minute: formatted.minute,
    month: formatted.month,
    second: formatted.second,
    year: formatted.year,
  };
}

function getChileOffsetMinutes(date: Date): number {
  const parts = getChileDateTimeParts(date);
  const chileTimeAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    Number(parts.millisecond),
  );

  return Math.round((chileTimeAsUtc - date.getTime()) / 60000);
}
