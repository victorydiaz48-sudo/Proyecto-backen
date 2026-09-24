import { describe, expect, it } from 'vitest';
import { addDays, localDate, money, parseMoney, zonedIso } from '../src/format';

describe('formato', () => {
  it('importes: texto → céntimos y céntimos → moneda', () => {
    expect(parseMoney('45')).toBe(4500);
    expect(parseMoney('45,50')).toBe(4550);
    expect(parseMoney('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(money(4500, 'BRL', 'pt').replace(/\s/g, ' ')).toBe('R$ 45,00');
  });

  it('fecha y hora del negocio → ISO con su desfase (también con cambio de hora)', () => {
    expect(zonedIso('2026-10-01', '14:00', 'America/Sao_Paulo')).toBe('2026-10-01T14:00:00-03:00');
    expect(zonedIso('2026-10-01', '14:00', 'Europe/Madrid')).toBe('2026-10-01T14:00:00+02:00');
    expect(zonedIso('2026-10-26', '14:00', 'Europe/Madrid')).toBe('2026-10-26T14:00:00+01:00');
  });

  it('"hoy" se calcula en la zona del negocio, no la del navegador', () => {
    const instant = new Date('2026-10-01T02:00:00Z');
    expect(localDate(instant, 'America/Sao_Paulo')).toBe('2026-09-30');
    expect(localDate(instant, 'Europe/Madrid')).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
