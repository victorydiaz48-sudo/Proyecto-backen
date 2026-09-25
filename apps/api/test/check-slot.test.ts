// Motor de validación de franjas (función pura, sin BD).
import { describe, expect, it } from 'vitest';
import { checkSlot, type SlotCheckInput } from '../src/domain/availability/check.ts';
import { localToInstant } from '../src/lib/time.ts';

const TZ = 'America/Sao_Paulo';
const L1 = 'loc-1';
const L2 = 'loc-2';
// Jueves 2026-10-01 (weekday 4): 09:00–13:00 y 14:00–19:00 en L1.
const base = (over: Partial<SlotCheckInput> = {}): SlotCheckInput => ({
  timezone: TZ,
  now: new Date('2026-09-30T12:00:00Z'),
  professional: { id: 'p1', active: true, serviceIds: ['s1'] },
  service: { id: 's1', active: true, durationMinutes: 45, bufferAfterMinutes: 0 },
  workingIntervals: [
    { weekday: 4, startMinute: 9 * 60, endMinute: 13 * 60, locationId: L1 },
    { weekday: 4, startMinute: 14 * 60, endMinute: 19 * 60, locationId: L1 },
  ],
  blocks: [],
  bookings: [],
  startAt: at('10:00'),
  leadMinutes: 60,
  horizonDays: 60,
  ...over,
});
function at(hhmm: string, date = '2026-10-01'): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return localToInstant(date, h * 60 + m, TZ);
}
const reason = (over: Partial<SlotCheckInput>) => {
  const r = checkSlot(base(over));
  return r.ok ? 'OK' : r.reason;
};

describe('checkSlot', () => {
  it('acepta una franja válida y calcula fin y local en el servidor', () => {
    const r = checkSlot(base());
    expect(r).toEqual({ ok: true, startAt: at('10:00'), endAt: at('10:45'), locationId: L1 });
  });

  it('valida en orden: profesional, servicio, relación entre ambos', () => {
    expect(reason({ professional: null })).toBe('PROFESSIONAL_NOT_FOUND');
    expect(reason({ professional: { id: 'p1', active: false, serviceIds: ['s1'] }, service: null })).toBe('PROFESSIONAL_INACTIVE');
    expect(reason({ service: null })).toBe('SERVICE_NOT_FOUND');
    expect(reason({ service: { id: 's1', active: false, durationMinutes: 45, bufferAfterMinutes: 0 } })).toBe('SERVICE_NOT_FOUND');
    expect(reason({ professional: { id: 'p1', active: true, serviceIds: ['otro'] } })).toBe('PROFESSIONAL_DOES_NOT_OFFER_SERVICE');
  });

  it('día sin horario y hora fuera de horario (incluida la pausa del mediodía)', () => {
    expect(reason({ startAt: at('10:00', '2026-10-02') })).toBe('NOT_WORKING_THAT_DAY');
    expect(reason({ startAt: at('08:30') })).toBe('OUTSIDE_WORKING_HOURS');
    expect(reason({ startAt: at('13:30') })).toBe('OUTSIDE_WORKING_HOURS');
    expect(reason({ startAt: at('19:00') })).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('la duración completa debe caber antes del cierre (también antes de la pausa)', () => {
    expect(reason({ startAt: at('18:15') })).toBe('OK');
    expect(reason({ startAt: at('18:30') })).toBe('EXCEEDS_CLOSING_TIME');
    expect(reason({ startAt: at('12:15') })).toBe('OK');
    expect(reason({ startAt: at('12:30') })).toBe('EXCEEDS_CLOSING_TIME');
  });

  it('el tiempo de limpieza posterior cuenta para el cierre y los solapes', () => {
    const service = { id: 's1', active: true, durationMinutes: 45, bufferAfterMinutes: 15 };
    expect(reason({ service, startAt: at('18:15') })).toBe('EXCEEDS_CLOSING_TIME');
    expect(reason({ service, startAt: at('18:00') })).toBe('OK');
    const r = checkSlot(base({ service }));
    expect(r.ok && r.endAt).toEqual(at('11:00'));
  });

  it('solapes con citas: parcial rechazado, contiguo aceptado', () => {
    const bookings = [{ start: at('11:00'), end: at('11:30') }];
    expect(reason({ bookings, startAt: at('10:30') })).toBe('OVERLAPS_BOOKING');
    expect(reason({ bookings, startAt: at('11:15') })).toBe('OVERLAPS_BOOKING');
    expect(reason({ bookings, startAt: at('10:15') })).toBe('OK');
    expect(reason({ bookings, startAt: at('11:30') })).toBe('OK');
  });

  it('bloqueos del profesional, generales y del local; los de otro profesional o local no afectan', () => {
    const block = (professionalId: string | null, locationId: string | null) => [{ start: at('10:00'), end: at('11:00'), professionalId, locationId }];
    expect(reason({ blocks: block('p1', null) })).toBe('OVERLAPS_TIME_BLOCK');
    expect(reason({ blocks: block(null, null) })).toBe('OVERLAPS_TIME_BLOCK');
    expect(reason({ blocks: block(null, L1) })).toBe('OVERLAPS_TIME_BLOCK');
    expect(reason({ blocks: block('p2', null) })).toBe('OK');
    expect(reason({ blocks: block(null, L2) })).toBe('OK');
    expect(reason({ blocks: block('p1', null), startAt: at('11:00') })).toBe('OK');
  });

  it('pasado, antelación mínima y horizonte', () => {
    const now = at('10:00');
    expect(reason({ now, startAt: at('09:00') })).toBe('IN_THE_PAST');
    expect(reason({ now, startAt: at('10:30') })).toBe('TOO_SOON');
    expect(reason({ now, startAt: at('11:00') })).toBe('OK');
    expect(reason({ now, startAt: at('10:30'), leadMinutes: 0 })).toBe('OK');
    expect(reason({ horizonDays: 0 })).toBe('BEYOND_HORIZON');
    expect(reason({ horizonDays: 1 })).toBe('OK');
    expect(reason({ horizonDays: null })).toBe('OK');
  });

  it('respeta el local pedido', () => {
    expect(reason({ locationId: L1 })).toBe('OK');
    expect(reason({ locationId: L2 })).toBe('NOT_WORKING_THAT_DAY');
    const workingIntervals = [
      { weekday: 4, startMinute: 9 * 60, endMinute: 12 * 60, locationId: L1 },
      { weekday: 4, startMinute: 14 * 60, endMinute: 19 * 60, locationId: L2 },
    ];
    expect(reason({ workingIntervals, locationId: L2, startAt: at('10:00') })).toBe('OUTSIDE_WORKING_HOURS');
    const r = checkSlot(base({ workingIntervals, startAt: at('15:00') }));
    expect(r.ok && r.locationId).toBe(L2);
  });

  it('un horario que cruza medianoche admite citas que la atraviesan', () => {
    // Viernes 2/10 18:00–24:00 + sábado 00:00–02:00.
    const workingIntervals = [
      { weekday: 5, startMinute: 18 * 60, endMinute: 1440, locationId: L1 },
      { weekday: 6, startMinute: 0, endMinute: 120, locationId: L1 },
    ];
    expect(reason({ workingIntervals, startAt: at('23:30', '2026-10-02') })).toBe('OK');
    expect(reason({ workingIntervals, startAt: at('01:00', '2026-10-03') })).toBe('OK');
    expect(reason({ workingIntervals, startAt: at('01:30', '2026-10-03') })).toBe('EXCEEDS_CLOSING_TIME');
  });

  it('usa la zona del tenant: la misma hora UTC es otro día/hora en Madrid', () => {
    const madrid = base({
      timezone: 'Europe/Madrid',
      workingIntervals: [{ weekday: 4, startMinute: 9 * 60, endMinute: 19 * 60, locationId: L1 }],
    });
    expect(checkSlot({ ...madrid, startAt: new Date('2026-10-01T07:00:00Z') }).ok).toBe(true); // 09:00 Madrid
    expect(checkSlot({ ...madrid, startAt: new Date('2026-10-01T06:30:00Z') })).toEqual({ ok: false, reason: 'OUTSIDE_WORKING_HOURS' });
  });
});
