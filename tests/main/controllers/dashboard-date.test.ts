import { describe, expect, it } from 'vitest';
import {
  differenceInCalendarDays,
  getDashboardDay,
} from '../../../src/main/controllers/dashboard-date';

describe('dashboard date boundaries', () => {
  it('uses Chile winter time for the current local day', () => {
    expect(getDashboardDay(new Date('2026-06-11T12:00:00Z'))).toEqual({
      dateKey: '2026-06-11',
      startUtc: '2026-06-11 04:00:00',
      endUtc: '2026-06-12 04:00:00',
    });
  });

  it('uses Chile summer time for the current local day', () => {
    expect(getDashboardDay(new Date('2026-01-15T12:00:00Z'))).toEqual({
      dateKey: '2026-01-15',
      startUtc: '2026-01-15 03:00:00',
      endUtc: '2026-01-16 03:00:00',
    });
  });

  it('calculates calendar days without daylight-saving drift', () => {
    expect(differenceInCalendarDays('2026-06-18', '2026-06-11')).toBe(7);
    expect(differenceInCalendarDays('2026-06-10', '2026-06-11')).toBe(-1);
  });
});
