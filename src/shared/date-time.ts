/** Los timestamps SQL de SQLite están en UTC, aunque no indiquen la zona. */
export function parseDatabaseTimestamp(value: string): number {
  const timestamp = value.trim().replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return Date.parse(hasZone ? timestamp : `${timestamp}Z`);
}

/** Convierte una fecha ISO (AAAA-MM-DD o DD-MM-AAAA) al formato estándar DD/MM/AAAA. */
export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const dashMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (dashMatch) {
    return `${dashMatch[1]}/${dashMatch[2]}/${dashMatch[3]}`;
  }
  return trimmed;
}

/** Formatea una marca temporal con fecha y hora para que la fecha quede en DD/MM/AAAA. */
export function formatDisplayDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](.+)$/.exec(trimmed);
  if (isoMatch) {
    const timePart = isoMatch[4].replace(/Z$/, "").replace(/\.\d+$/, "");
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]} ${timePart}`;
  }
  const dashMatch = /^(\d{2})-(\d{2})-(\d{4})[ T](.+)$/.exec(trimmed);
  if (dashMatch) {
    const timePart = dashMatch[4].replace(/Z$/, "").replace(/\.\d+$/, "");
    return `${dashMatch[1]}/${dashMatch[2]}/${dashMatch[3]} ${timePart}`;
  }
  return formatDisplayDate(trimmed);
}

/** Parsea una fecha en formato DD/MM/AAAA (o YYYY-MM-DD) al formato ISO estándar AAAA-MM-DD. */
export function parseDisplayDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return trimmed;
  }
  return null;
}
