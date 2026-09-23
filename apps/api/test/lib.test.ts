import { describe, expect, it } from 'vitest';
import { FailureLimiter } from '../src/lib/failure-limiter.ts';
import { passwordProblem } from '../src/lib/password.ts';
import { isValidTimeZone, zSlug } from '../src/lib/validation.ts';

describe('passwordProblem', () => {
  it('aplica longitud, lista de comunes y email', () => {
    expect(passwordProblem('corta')).toMatch(/al menos/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/como máximo/);
    expect(passwordProblem('1234567890')).toMatch(/común/);
    expect(passwordProblem('zzzzzzzzzzzz')).toMatch(/común/);
    expect(passwordProblem('carlos-2026-ok', 'carlos@a.test')).toMatch(/email/);
    expect(passwordProblem('una frase larga y rara', 'carlos@a.test')).toBeNull();
  });
});

describe('FailureLimiter', () => {
  it('bloquea al llegar al máximo dentro de la ventana y se libera al pasar', () => {
    let t = 0;
    const l = new FailureLimiter(3, 1000, () => t);
    l.fail('k');
    l.fail('k');
    expect(l.isBlocked('k')).toBe(false);
    l.fail('k');
    expect(l.isBlocked('k')).toBe(true);
    expect(l.isBlocked('otra')).toBe(false);
    t = 1001;
    expect(l.isBlocked('k')).toBe(false);
    l.fail('k');
    l.reset('k');
    expect(l.isBlocked('k')).toBe(false);
  });
});

describe('validación', () => {
  it('zonas horarias', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('slugs', () => {
    expect(zSlug.parse('  Barberia-Central ')).toBe('barberia-central');
    for (const bad of ['a', '-abc', 'abc-', 'con espacio', 'ñandu', 'api', 'x'.repeat(51)]) {
      expect(zSlug.safeParse(bad).success, bad).toBe(false);
    }
  });
});
