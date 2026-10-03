/** Los timestamps SQL de SQLite están en UTC, aunque no indiquen la zona. */
export function parseDatabaseTimestamp(value: string): number {
  const timestamp = value.trim().replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return Date.parse(hasZone ? timestamp : `${timestamp}Z`);
}
