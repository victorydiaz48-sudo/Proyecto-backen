/**
 * Calendar helpers in an organization's time zone. Daily/monthly limits and the
 * Usage.day column follow the organization's local calendar, not UTC.
 */

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(f.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight for the local date (y, m, d). DST-safe. */
function localMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  const first = new Date(guess.getTime() - offsetMs(guess, tz));
  return new Date(guess.getTime() - offsetMs(first, tz));
}

export function startOfLocalDay(date: Date, tz: string): Date {
  const p = parts(date, tz);
  return localMidnight(p.y, p.m, p.d, tz);
}

export function startOfLocalMonth(date: Date, tz: string): Date {
  const p = parts(date, tz);
  return localMidnight(p.y, p.m, 1, tz);
}

/** The local calendar day as a UTC-midnight Date, for @db.Date columns. */
export function localDay(date: Date, tz: string): Date {
  const p = parts(date, tz);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}
