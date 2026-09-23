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
