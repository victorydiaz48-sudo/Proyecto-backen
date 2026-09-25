import { describe, expect, it } from 'vitest';
import { toE164 } from '../src/lib/phone.ts';
import {
  formatClock,
  isAmbiguousOrMissingLocalTime,
  localToInstant,
  parseClock,
  weekdayOf,
  workingRanges,
} from '../src/lib/time.ts';

describe('reloj', () => {
  it('parsea y formatea HH:MM, con 24:00 solo como fin', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('24:00', true)).toBe(1440);
    for (const bad of ['9:30', '25:00', '12:60', '', '09:30:00']) expect(parseClock(bad, true), bad).toBeNull();
    expect(formatClock(570)).toBe('09:30');
    expect(formatClock(1440)).toBe('24:00');
  });

  it('día de la semana como el generador (0 = domingo)', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-10')).toBe(6);
  });
});

describe('zona horaria', () => {
  it('la misma hora local es un instante distinto en São Paulo y Madrid', () => {
    expect(localToInstant('2026-10-01', 9 * 60, 'America/Sao_Paulo').toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(localToInstant('2026-10-01', 9 * 60, 'Europe/Madrid').toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('respeta el cambio de horario de Madrid (25 oct 2026: 03:00 → 02:00)', () => {
    expect(localToInstant('2026-10-24', 9 * 60, 'Europe/Madrid').toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect(localToInstant('2026-10-25', 9 * 60, 'Europe/Madrid').toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('detecta horas inexistentes (29 mar 2026, 02:30) y repetidas (25 oct 2026, 02:30) en Madrid', () => {
    expect(isAmbiguousOrMissingLocalTime('2026-03-29', 150, 'Europe/Madrid')).toBe(true);
    expect(isAmbiguousOrMissingLocalTime('2026-10-25', 150, 'Europe/Madrid')).toBe(true);
    expect(isAmbiguousOrMissingLocalTime('2026-10-25', 10 * 60, 'Europe/Madrid')).toBe(false);
    expect(isAmbiguousOrMissingLocalTime('2026-10-25', 150, 'America/Sao_Paulo')).toBe(false);
  });
});

describe('workingRanges', () => {
  const loc = 'L1';
  it('convierte intervalos semanales en tramos reales y une los contiguos', () => {
    const r = workingRanges(
      [
        { weekday: 4, startMinute: 540, endMinute: 780, locationId: loc },
        { weekday: 4, startMinute: 780, endMinute: 840, locationId: loc },
        { weekday: 4, startMinute: 900, endMinute: 1140, locationId: loc },
      ],
      '2026-10-01',
      '2026-10-01',
      'America/Sao_Paulo',
    );
    expect(r.map((x) => [x.start.toISOString(), x.end.toISOString()])).toEqual([
      ['2026-10-01T12:00:00.000Z', '2026-10-01T17:00:00.000Z'],
      ['2026-10-01T18:00:00.000Z', '2026-10-01T22:00:00.000Z'],
    ]);
  });

  it('une un horario que cruza la medianoche guardado como dos intervalos', () => {
    const r = workingRanges(
      [
        { weekday: 5, startMinute: 22 * 60, endMinute: 1440, locationId: loc },
        { weekday: 6, startMinute: 0, endMinute: 120, locationId: loc },
      ],
      '2026-10-02',
      '2026-10-03',
      'America/Sao_Paulo',
    );
    expect(r).toHaveLength(1);
    expect([r[0]!.start.toISOString(), r[0]!.end.toISOString()]).toEqual(['2026-10-03T01:00:00.000Z', '2026-10-03T05:00:00.000Z']);
  });

  it('no une tramos contiguos de locales distintos', () => {
    const r = workingRanges(
      [
        { weekday: 4, startMinute: 540, endMinute: 780, locationId: 'L1' },
        { weekday: 4, startMinute: 780, endMinute: 900, locationId: 'L2' },
      ],
      '2026-10-01',
      '2026-10-01',
      'UTC',
    );
    expect(r.map((x) => x.locationId)).toEqual(['L1', 'L2']);
  });
});

describe('toE164', () => {
  it('normaliza formatos variados al mismo número', () => {
    for (const raw of ['41 99876-5432', '(41) 99876-5432', '+55 41 99876-5432', '0055 41998765432', '5541998765432']) {
      expect(toE164(raw, '55'), raw).toBe('+5541998765432');
    }
    expect(toE164('612 34 56 78', '34')).toBe('+34612345678');
  });

  it('un código de país inexistente no rompe nada: el número simplemente no es válido', () => {
    expect(toE164('41 99876-5432', '999')).toBeNull();
    expect(toE164('+55 41 99876-5432', '999')).toBe('+5541998765432');
  });

  it('rechaza números inválidos', () => {
    for (const raw of ['', '123', 'abc', '+55 41 9', '9'.repeat(41)]) expect(toE164(raw, '55'), raw).toBeNull();
  });
});
