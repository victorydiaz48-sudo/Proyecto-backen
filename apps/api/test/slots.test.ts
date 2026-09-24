// Motor de disponibilidad (funciones puras, sin BD).
import { describe, expect, it } from 'vitest';
import { checkSlot } from '../src/domain/availability/check.ts';
import { computeSlots, findAlternatives, pickProfessional, type Candidate, type SlotsInput } from '../src/domain/availability/slots.ts';
import { localToInstant, workingRanges } from '../src/lib/time.ts';

const TZ = 'America/Sao_Paulo';
const L1 = 'loc-1';
const L2 = 'loc-2';
const at = (hhmm: string, date = '2026-10-01', tz = TZ): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return localToInstant(date, h * 60 + m, tz);
};
// Jueves 01/10 (weekday 4) y viernes 02/10 (weekday 5): 09–13 y 14–19.
const standardHours = (locationId = L1) =>
  [4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 13 * 60, locationId },
    { weekday, startMinute: 14 * 60, endMinute: 19 * 60, locationId },
  ]);
const pro = (id: string, over: Partial<Candidate> = {}): Candidate => ({ id, sortOrder: 0, workingIntervals: standardHours(), bookings: [], ...over });
const input = (over: Partial<SlotsInput> = {}): SlotsInput => ({
  timezone: TZ,
  now: new Date('2026-09-30T12:00:00Z'),
  slotIntervalMinutes: 30,
  leadMinutes: 0,
  horizonDays: null,
  occupiedMinutes: 45,
  candidates: [pro('p1')],
  blocks: [],
  fromDate: '2026-10-01',
  toDate: '2026-10-01',
  ...over,
});
const times = (over: Partial<SlotsInput> = {}, date = '2026-10-01') =>
  computeSlots(input(over)).find((d) => d.date === date)!.slots.map((s) => s.localTime);

describe('computeSlots', () => {
  it('genera inicios cada N minutos y solo donde cabe la duración completa (antes de la pausa y del cierre)', () => {
    expect(times()).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00',
    ]);
  });

  it('el intervalo de slot es configurable', () => {
    const t = times({ slotIntervalMinutes: 15 });
    expect(t).toContain('12:15');
    expect(t).not.toContain('12:30');
    expect(t.at(-1)).toBe('18:15');
  });

  it('respeta citas (solape parcial) y deja libres los huecos contiguos', () => {
    const t = times({ candidates: [pro('p1', { bookings: [{ start: at('10:30'), end: at('11:00') }] })] });
    expect(t).not.toContain('10:00'); // 10:00–10:45 pisaría 10:30
    expect(t).not.toContain('10:30');
    expect(t).toContain('09:30'); // 09:30–10:15
    expect(t).toContain('11:00');
  });

  it('respeta bloqueos del profesional, del local y generales; ignora los de otros', () => {
    const block = (professionalId: string | null, locationId: string | null) => ({ start: at('14:00'), end: at('19:00'), professionalId, locationId });
    expect(times({ blocks: [block('p1', null)] }).at(-1)).toBe('12:00');
    expect(times({ blocks: [block(null, null)] }).at(-1)).toBe('12:00');
    expect(times({ blocks: [block(null, L1)] }).at(-1)).toBe('12:00');
    expect(times({ blocks: [block('p2', null)] }).at(-1)).toBe('18:00');
    expect(times({ blocks: [block(null, L2)] }).at(-1)).toBe('18:00');
  });

  it('excluye el pasado, respeta la antelación mínima y el horizonte', () => {
    const now = at('10:10');
    expect(times({ now })[0]).toBe('10:30');
    expect(times({ now, leadMinutes: 60 })[0]).toBe('11:30');
    const days = computeSlots(input({ toDate: '2026-10-02', horizonDays: 1 }));
    expect(days.map((d) => [d.date, d.slots.length])).toEqual([['2026-10-01', 16], ['2026-10-02', 0]]);
  });

  it('día sin horario → lista vacía (nunca huecos inventados)', () => {
    expect(times({ fromDate: '2026-10-04', toDate: '2026-10-04' }, '2026-10-04')).toEqual([]);
  });

  it('"sin preferencia" une los huecos de varios profesionales e indica quién está libre', () => {
    const slots = computeSlots(
      input({
        candidates: [
          pro('p1', { bookings: [{ start: at('09:00'), end: at('09:45') }] }),
          pro('p2', { workingIntervals: [{ weekday: 4, startMinute: 8 * 60, endMinute: 10 * 60, locationId: L1 }] }),
        ],
      }),
    )[0]!.slots;
    const byTime = Object.fromEntries(slots.map((s) => [s.localTime, s.professionalIds]));
    expect(byTime['08:00']).toEqual(['p2']);
    expect(byTime['09:00']).toEqual(['p2']);
    expect(byTime['10:00']).toEqual(['p1']);
    expect(byTime['09:30']?.sort()).toBeUndefined(); // p1 ocupado hasta 09:45, p2 cierra a las 10:00
  });

  it('separa huecos por local y filtra por local', () => {
    const c = [pro('p1'), pro('p2', { workingIntervals: standardHours(L2) })];
    const slots = computeSlots(input({ candidates: c }))[0]!.slots;
    expect(slots.filter((s) => s.localTime === '09:00').map((s) => s.locationId).sort()).toEqual([L1, L2]);
    const onlyL2 = computeSlots(input({ candidates: c, locationId: L2 }))[0]!.slots;
    expect(new Set(onlyL2.map((s) => s.professionalIds[0]))).toEqual(new Set(['p2']));
  });

  it('un horario que cruza medianoche ofrece huecos en ambos días', () => {
    const workingIntervals = [
      { weekday: 5, startMinute: 22 * 60, endMinute: 1440, locationId: L1 },
      { weekday: 6, startMinute: 0, endMinute: 120, locationId: L1 },
    ];
    const days = computeSlots(input({ candidates: [pro('p1', { workingIntervals })], fromDate: '2026-10-02', toDate: '2026-10-03' }));
    expect(days.map((d) => d.slots.map((s) => s.localTime))).toEqual([
      ['22:00', '22:30', '23:00', '23:30'],
      ['00:00', '00:30', '01:00'],
    ]);
  });

  it('respeta la zona horaria del negocio y el cambio de hora (Madrid, 25/10/2026)', () => {
    const madrid = (date: string) =>
      computeSlots(
        input({
          timezone: 'Europe/Madrid',
          now: new Date('2026-10-01T00:00:00Z'),
          candidates: [pro('p1', { workingIntervals: [{ weekday: 0, startMinute: 9 * 60, endMinute: 10 * 60, locationId: L1 }] })],
          fromDate: date,
          toDate: date,
          occupiedMinutes: 30,
        }),
      )[0]!.slots.map((s) => s.startAt.toISOString());
    expect(madrid('2026-10-18')).toEqual(['2026-10-18T07:00:00.000Z', '2026-10-18T07:30:00.000Z']); // UTC+2
    expect(madrid('2026-10-25')).toEqual(['2026-10-25T08:00:00.000Z', '2026-10-25T08:30:00.000Z']); // UTC+1
  });

  it('coherencia con checkSlot: todo hueco ofrecido es reservable y todo inicio alineado reservable se ofrece', () => {
    const scenario = input({
      now: at('09:50'),
      leadMinutes: 30,
      slotIntervalMinutes: 15,
      candidates: [pro('p1', { bookings: [{ start: at('11:05'), end: at('11:50') }, { start: at('16:00'), end: at('16:30') }] })],
      blocks: [{ start: at('14:40'), end: at('15:10'), professionalId: null, locationId: L1 }],
    });
    const offered = new Set(computeSlots(scenario)[0]!.slots.map((s) => s.startAt.getTime()));
    const c = scenario.candidates[0]!;
    const ranges = workingRanges([...c.workingIntervals], '2026-09-30', '2026-10-02', TZ);
    let checked = 0;
    for (const r of ranges) {
      for (let t = r.start.getTime(); t < r.end.getTime(); t += 15 * 60_000) {
        const startAt = new Date(t);
        if (startAt.toISOString().slice(0, 10) !== '2026-10-01' && startAt < at('00:00')) continue;
        const res = checkSlot({
          timezone: TZ,
          now: scenario.now,
          professional: { id: 'p1', active: true, serviceIds: ['s'] },
          service: { id: 's', active: true, durationMinutes: 45, bufferAfterMinutes: 0 },
          workingIntervals: c.workingIntervals,
          blocks: scenario.blocks,
          bookings: c.bookings,
          startAt,
          leadMinutes: 30,
          horizonDays: null,
        });
        if (t >= at('00:00').getTime() && t < at('00:00', '2026-10-02').getTime()) {
          expect(offered.has(t), startAt.toISOString()).toBe(res.ok);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('pickProfessional', () => {
  it('elige al libre con menos citas ese día; desempata por orden y por id', () => {
    expect(pickProfessional([{ id: 'a', sortOrder: 0, bookingsThatDay: 3 }, { id: 'b', sortOrder: 1, bookingsThatDay: 1 }])).toBe('b');
    expect(pickProfessional([{ id: 'a', sortOrder: 1, bookingsThatDay: 1 }, { id: 'b', sortOrder: 0, bookingsThatDay: 1 }])).toBe('b');
    expect(pickProfessional([{ id: 'b', sortOrder: 0, bookingsThatDay: 0 }, { id: 'a', sortOrder: 0, bookingsThatDay: 0 }])).toBe('a');
    expect(pickProfessional([])).toBeNull();
  });
});

describe('findAlternatives', () => {
  it('devuelve los huecos más cercanos a la hora pedida y completa con días siguientes', () => {
    const days = computeSlots(input({ toDate: '2026-10-02', candidates: [pro('p1', { bookings: [{ start: at('10:00'), end: at('12:00') }] })] }));
    const alt = findAlternatives(days, at('10:30'), '2026-10-01', 4);
    expect(alt.map((s) => s.localTime)).toEqual(['09:00', '12:00', '14:00', '14:30']);
    const nextDays = findAlternatives(days, at('18:00'), '2026-10-01', 3);
    expect(nextDays.map((s) => `${s.localDate} ${s.localTime}`)).toEqual(['2026-10-01 17:30', '2026-10-01 17:00', '2026-10-01 16:30']);
    const empty = computeSlots(input({ fromDate: '2026-10-04', toDate: '2026-10-06' }));
    expect(findAlternatives(empty, at('10:00', '2026-10-04'), '2026-10-04').length).toBe(0);
  });

  it('nunca propone la misma hora pedida', () => {
    const days = computeSlots(input());
    expect(findAlternatives(days, at('10:00'), '2026-10-01').some((s) => s.localTime === '10:00')).toBe(false);
  });
});
