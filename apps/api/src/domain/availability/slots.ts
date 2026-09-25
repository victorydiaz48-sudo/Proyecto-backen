// Cálculo de huecos libres. Función pura (sin BD): recibe horarios, citas y bloqueos ya cargados.
// Los huecos se calculan siempre al vuelo a partir del horario; nunca se guardan (docs/ARCHITECTURE.md §5).
import { addDays, formatClock, localDateOf, localMinuteOf, overlaps, workingRanges, type WeeklyInterval } from '../../lib/time.ts';
import type { SlotBlock } from './check.ts';

const MINUTE = 60_000;

export interface Candidate {
  id: string;
  /** Orden de presentación del profesional (desempate al asignar "sin preferencia"). */
  sortOrder: number;
  workingIntervals: readonly WeeklyInterval[];
  /** Citas activas del profesional en la ventana consultada. */
  bookings: readonly { start: Date; end: Date }[];
}

export interface SlotsInput {
  timezone: string;
  now: Date;
  slotIntervalMinutes: number;
  leadMinutes: number;
  horizonDays: number | null;
  /** Duración + limpieza posterior del servicio. */
  occupiedMinutes: number;
  /** Solo profesionales activos que hacen el servicio (el llamador filtra). */
  candidates: readonly Candidate[];
  blocks: readonly SlotBlock[];
  fromDate: string;
  toDate: string;
  locationId?: string | null;
}

export interface Slot {
  startAt: Date;
  localDate: string;
  localTime: string;
  locationId: string;
  /** Profesionales libres en ese hueco (uno si se pidió un profesional concreto). */
  professionalIds: string[];
}

export interface DaySlots {
  date: string;
  slots: Slot[];
}

/**
 * Huecos por día local entre `fromDate` y `toDate` (incluidas). Los inicios se generan cada
 * `slotIntervalMinutes` desde el comienzo de cada tramo de trabajo, y un inicio solo es válido si la
 * duración completa (más limpieza) cabe dentro del tramo sin tocar citas ni bloqueos.
 * Con varios candidatos, se unen los huecos y cada uno lista qué profesionales están libres.
 */
export function computeSlots(input: SlotsInput): DaySlots[] {
  const { timezone: tz } = input;
  const step = input.slotIntervalMinutes * MINUTE;
  const length = input.occupiedMinutes * MINUTE;
  const earliest = input.now.getTime() + input.leadMinutes * MINUTE;
  const lastDate = input.horizonDays === null ? input.toDate : minDate(input.toDate, addDays(localDateOf(input.now, tz), input.horizonDays));

  const byKey = new Map<string, Slot>();
  for (const c of input.candidates) {
    const ranges = workingRanges([...c.workingIntervals], addDays(input.fromDate, -1), addDays(input.toDate, 1), tz).filter(
      (r) => !input.locationId || r.locationId === input.locationId,
    );
    for (const r of ranges) {
      const blocks = input.blocks.filter(
        (b) => (b.professionalId === null || b.professionalId === c.id) && (b.locationId === null || b.locationId === r.locationId),
      );
      for (let t = r.start.getTime(); t + length <= r.end.getTime(); t += step) {
        if (t < earliest) continue;
        const start = new Date(t);
        const localDate = localDateOf(start, tz);
        if (localDate < input.fromDate || localDate > lastDate) continue;
        const end = new Date(t + length);
        if (c.bookings.some((b) => overlaps(start, end, b.start, b.end))) continue;
        if (blocks.some((b) => overlaps(start, end, b.start, b.end))) continue;

        const key = `${t}|${r.locationId}`;
        const existing = byKey.get(key);
        if (existing) existing.professionalIds.push(c.id);
        else byKey.set(key, { startAt: start, localDate, localTime: formatClock(localMinuteOf(start, tz)), locationId: r.locationId, professionalIds: [c.id] });
      }
    }
  }

  const days = new Map<string, Slot[]>();
  for (let d = input.fromDate; d <= input.toDate; d = addDays(d, 1)) days.set(d, []);
  for (const s of byKey.values()) days.get(s.localDate)?.push(s);
  return [...days.entries()].map(([date, slots]) => ({
    date,
    slots: slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.locationId.localeCompare(b.locationId)),
  }));
}

/**
 * "Sin preferencia": entre los profesionales libres, el que tiene menos citas activas ese día (la
 * franja de trabajo del día); a igualdad, el primero en el orden del negocio y luego por id (estable).
 */
export function pickProfessional(
  free: readonly { id: string; sortOrder: number; bookingsThatDay: number }[],
): string | null {
  return rankProfessionals(free)[0]?.id ?? null;
}

/** Orden de intento para "sin preferencia": el mismo criterio que pickProfessional, completo. */
export function rankProfessionals<T extends { id: string; sortOrder: number; bookingsThatDay: number }>(free: readonly T[]): T[] {
  return [...free].sort((a, b) => a.bookingsThatDay - b.bookingsThatDay || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Alternativas reales a una hora pedida: los huecos libres más cercanos (antes o después) ese mismo
 * día; si no llegan a `limit`, se completan con los primeros de los días siguientes. Ordenadas por
 * cercanía a la hora pedida. Nunca se reserva nada: el cliente elige.
 */
export function findAlternatives(days: readonly DaySlots[], requested: Date, requestedDate: string, limit = 6): Slot[] {
  const t = requested.getTime();
  const sameDay = (days.find((d) => d.date === requestedDate)?.slots ?? []).filter((s) => s.startAt.getTime() !== t);
  const nearest = [...sameDay].sort((a, b) => Math.abs(a.startAt.getTime() - t) - Math.abs(b.startAt.getTime() - t) || a.startAt.getTime() - b.startAt.getTime());
  const result = nearest.slice(0, limit);
  for (const d of days) {
    if (result.length >= limit) break;
    if (d.date <= requestedDate) continue;
    for (const s of d.slots) {
      if (result.length >= limit) break;
      result.push(s);
    }
  }
  return result;
}

const minDate = (a: string, b: string): string => (a < b ? a : b);
