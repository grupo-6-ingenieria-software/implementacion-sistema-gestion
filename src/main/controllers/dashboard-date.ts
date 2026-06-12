const DASHBOARD_TIME_ZONE = 'America/Santiago';

export type DashboardDay = {
  dateKey: string;
  startUtc: string;
  endUtc: string;
};

export function getDashboardDay(now = new Date()): DashboardDay {
  const dateKey = formatDateKey(now);
  const nextDateKey = addCalendarDays(dateKey, 1);

  return {
    dateKey,
    startUtc: zonedMidnightToSqlUtc(dateKey),
    endUtc: zonedMidnightToSqlUtc(nextDateKey),
  };
}

export function differenceInCalendarDays(
  dateKey: string,
  referenceDateKey: string,
): number {
  return Math.round(
    (Date.parse(`${dateKey}T00:00:00Z`) -
      Date.parse(`${referenceDateKey}T00:00:00Z`)) /
      86_400_000,
  );
}

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedMidnightToSqlUtc(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day);
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedParts(new Date(candidate));
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = desiredAsUtc - representedAsUtc;

    if (correction === 0) {
      break;
    }

    candidate += correction;
  }

  return new Date(candidate).toISOString().slice(0, 19).replace('T', ' ');
}

function getZonedParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}
