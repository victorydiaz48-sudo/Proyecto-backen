import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

export type Db = InstanceType<typeof PrismaClient>;
/** Cliente dentro de `db.$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Códigos SQLSTATE de PostgreSQL que la aplicación traduce a errores de dominio. */
export const PgErrorCode = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

/**
 * Extrae el SQLSTATE de un error lanzado por Prisma con el adaptador pg.
 * Prisma envuelve el error del driver; el código original viaja en `cause.originalCode`
 * o en `meta.driverAdapterError.cause.originalCode` según la versión.
 */
export function pgErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    const o = cur as Record<string, unknown>;
    for (const key of ['originalCode', 'code']) {
      const v = o[key];
      // SQLSTATE: 5 caracteres. Se excluyen los códigos propios de Prisma (P1xxx, P2xxx…).
      if (typeof v === 'string' && /^[0-9A-Z]{5}$/.test(v) && !/^P[1-9]\d{3}$/.test(v)) return v;
    }
    stack.push(o.cause, o.meta, o.driverAdapterError);
  }
  return undefined;
}
