import { describe, expect, it } from 'vitest';
import { FailureLimiter } from '../src/lib/failure-limiter.ts';
import { generateTemporaryPassword, passwordProblem } from '../src/lib/password.ts';
import { isValidTimeZone, toSlugInput, zSlug } from '../src/lib/validation.ts';

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

describe('FailureLimiter con muchas claves', () => {
  it('limpia las claves caducadas para no crecer sin límite', () => {
    let t = 0;
    const l = new FailureLimiter(3, 1000, () => t);
    for (let i = 0; i < 10_001; i++) l.fail(`k${i}`);
    t = 5000;
    l.fail('nueva'); // dispara la limpieza
    expect(l.isBlocked('k1')).toBe(false);
    expect((l as unknown as { failures: Map<string, number[]> }).failures.size).toBeLessThan(10);
  });
});

describe('entradas escritas a mano', () => {
  it('toSlugInput: nombre del negocio → identificador', () => {
    expect(toSlugInput('Barbearia Alpha Clube')).toBe('barbearia-alpha-clube');
    expect(toSlugInput('  Barbería  São João! ')).toBe('barberia-sao-joao');
    expect(toSlugInput('barbearia-alpha-clube')).toBe('barbearia-alpha-clube');
    expect(toSlugInput('***')).toBe('');
  });

  it('contraseñas temporales: 4 grupos de 4 sin caracteres confusos, válidas y distintas', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/);
      expect(p).not.toMatch(/[il1o0]/);
      expect(passwordProblem(p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
