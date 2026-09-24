import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { pgErrorCode } from '../src/db.ts';

describe('loadConfig', () => {
  it('acepta una configuración válida', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(c.NODE_ENV).toBe('development');
  });

  it('falla sin revelar el valor de los secretos', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:secreto@h/db' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:secreto@h/db' })).not.toThrow(/secreto/);
  });
});

describe('pgErrorCode', () => {
  it('encuentra el SQLSTATE anidado e ignora los códigos propios de Prisma', () => {
    const err = { code: 'P2002', meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } };
    expect(pgErrorCode(err)).toBe('23P01');
    expect(pgErrorCode({ code: 'P2002' })).toBeUndefined();
    expect(pgErrorCode(new Error('x'))).toBeUndefined();
  });
});

describe('loadConfig en producción', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', NODE_ENV: 'production' };
  it('las cookies de sesión son Secure por defecto y no se puede desactivar', () => {
    expect(loadConfig(base).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(loadConfig({ DATABASE_URL: base.DATABASE_URL }).COOKIE_SECURE).toBe(false);
  });

  it('valores por defecto del servidor y del worker de avisos', () => {
    expect(loadConfig(base)).toMatchObject({ PORT: 3000, HOST: '0.0.0.0', NOTIFICATIONS_TRANSPORT: 'log', NOTIFICATIONS_WORKER: true, TRUST_PROXY: false });
    expect(loadConfig({ ...base, NOTIFICATIONS_WORKER: 'false', TRUST_PROXY: '1' })).toMatchObject({ NOTIFICATIONS_WORKER: false, TRUST_PROXY: true });
  });
});
