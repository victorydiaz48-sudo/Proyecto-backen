import { DateTime } from 'luxon';

// Utilidades de tiempo con zona horaria IANA (Luxon). Reglas:
// - En BD todo instante es UTC; las horas de trabajo son minutos desde medianoche en la zona del tenant.
// - Una fecha local "YYYY-MM-DD" + minuto local se convierte a instante con la zona del tenant.
// - Hora inexistente por cambio de horario (hueco de DST): Luxon la mueve hacia delante.
// - Hora ambigua (se repite al retrasar el reloj): Luxon toma la primera ocurrencia.

export const MINUTES_PER_DAY = 1440;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" → 570. `allowEndOfDay` acepta "24:00" (fin de un intervalo que llega a medianoche). */
export function parseClock(s: string, allowEndOfDay = false): number | null {
  if (allowEndOfDay && s === '24:00') return MINUTES_PER_DAY;
  const m = CLOCK_RE.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(s: string): boolean {
  return DATE_RE.test(s) && DateTime.fromISO(s, { zone: 'UTC' }).isValid;
}

/** 0 = domingo … 6 = sábado, como Date.getDay() y el generador. */
export function weekdayOf(localDate: string): number {
  return DateTime.fromISO(localDate, { zone: 'UTC' }).weekday % 7;
}

export function addDays(localDate: string, days: number): string {
  return DateTime.fromISO(localDate, { zone: 'UTC' }).plus({ days }).toISODate()!;
}

/** Fecha local (en `tz`) de un instante. */
export function localDateOf(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toISODate()!;
}

/** Minuto local (0–1439) de un instante en `tz`. */
export function localMinuteOf(instant: Date, tz: string): number {
  const d = DateTime.fromJSDate(instant, { zone: tz });
  return d.hour * 60 + d.minute;
}

/** Instante de una fecha local + minuto local (0–1440; 1440 = medianoche del día siguiente). */
export function localToInstant(localDate: string, minute: number, tz: string): Date {
  if (minute === MINUTES_PER_DAY) return localToInstant(addDays(localDate, 1), 0, tz);
  const [y, mo, d] = localDate.split('-').map(Number) as [number, number, number];
  const dt = DateTime.fromObject({ year: y, month: mo, day: d, hour: Math.floor(minute / 60), minute: minute % 60 }, { zone: tz });
  return dt.toJSDate();
}

/** true si la hora local no existe ese día (salto de DST) o se repite (retraso de DST). */
export function isAmbiguousOrMissingLocalTime(localDate: string, minute: number, tz: string): boolean {
  const instant = localToInstant(localDate, minute, tz);
  if (localDateOf(instant, tz) !== localDate || localMinuteOf(instant, tz) !== minute) return true;
  const hourLater = new Date(instant.getTime() + 60 * 60 * 1000);
  return localDateOf(hourLater, tz) === localDate && localMinuteOf(hourLater, tz) === minute;
}

export interface WeeklyInterval {
  weekday: number;
  startMinute: number;
  endMinute: number;
  locationId: string;
}

export interface WorkingRange {
  start: Date;
  end: Date;
  locationId: string;
}

/**
 * Tramos de trabajo reales (instantes) entre dos fechas locales, ambas incluidas. Los tramos contiguos
 * del mismo local se unen, también a través de la medianoche (un horario 22:00–24:00 + 00:00–02:00 del
 * día siguiente forma un único tramo de 22:00 a 02:00).
 */
export function workingRanges(intervals: WeeklyInterval[], fromDate: string, toDate: string, tz: string): WorkingRange[] {
  const ranges: WorkingRange[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    for (const i of intervals) {
      if (i.weekday !== wd) continue;
      ranges.push({ start: localToInstant(date, i.startMinute, tz), end: localToInstant(date, i.endMinute, tz), locationId: i.locationId });
    }
  }
  ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: WorkingRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && last.locationId === r.locationId && r.start.getTime() <= last.end.getTime()) {
      if (r.end > last.end) last.end = r.end;
    } else if (r.end > r.start) {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Intervalos semiabiertos [aStart, aEnd) y [bStart, bEnd) se solapan. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean =>
  aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
