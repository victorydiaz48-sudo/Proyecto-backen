import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';
import { currentTenantId } from './lib/tenant-context.ts';

export type Db = InstanceType<typeof PrismaClient>;
/** Cliente dentro de `db.$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

/**
 * Cliente de Prisma que aplica Row-Level Security: cada consulta se ejecuta con el negocio del contexto
 * (src/lib/tenant-context.ts) fijado en `app.tenant_id` DENTRO de su transacción (`set_config(…, true)`),
 * así el valor no puede quedarse en una conexión del pool ni mezclarse con otra petición.
 *
 * - Consulta suelta: `BEGIN; set_config; consulta; COMMIT` (el negocio se lee al llamar, no más tarde:
 *   Prisma no conserva el contexto asíncrono en su interior y agrupa `findUnique` de peticiones distintas).
 * - `$transaction(async (tx) => …)`: `set_config` como primera sentencia de la transacción; `tx` es un
 *   cliente sin la extensión, así sus consultas no abren transacciones propias.
 * - Sin negocio en el contexto: la consulta va sin `set_config` y RLS no devuelve filas (fallo cerrado).
 */
export function createDb(databaseUrl: string): Db {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const setTenant = (tenantId: string) => base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  const scoped = base.$extends({
    query: {
      async $allOperations({ args, query }): Promise<unknown> {
        const tenantId = currentTenantId();
        if (!tenantId) return (await query(args)) as unknown;
        const results: unknown[] = await base.$transaction([setTenant(tenantId), query(args)]);
        return results[1];
      },
    },
  });

  const transaction = (arg: unknown, options?: unknown): Promise<unknown> => {
    if (typeof arg !== 'function') throw new Error('Usa $transaction(async (tx) => …): las transacciones por lotes no fijan el negocio.');
    const tenantId = currentTenantId();
    const fn = arg as (tx: Tx) => Promise<unknown>;
    return base.$transaction(async (tx) => {
      if (tenantId) await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, options as Parameters<Db['$transaction']>[1]);
  };

  return new Proxy(scoped, {
    get(target, prop, receiver) {
      if (prop === '$transaction') return transaction;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as unknown as Db;
}

/**
 * Motivo por el que la conexión NO estaría sujeta a Row-Level Security (superusuario, BYPASSRLS o
 * propietario de las tablas), o null si RLS se aplica. El servidor se niega a arrancar en producción así.
 */
export async function rlsBypassReason(db: Db): Promise<string | null> {
  const [r] = await db.$queryRaw<{ role: string; superuser: boolean; bypass: boolean; owner: boolean }[]>`
    SELECT current_user AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
           pg_has_role(current_user, c.relowner, 'MEMBER') AS owner
    FROM pg_roles r, pg_class c
    WHERE r.rolname = current_user AND c.oid = '"Booking"'::regclass`;
  if (!r) return 'no se pudo comprobar el rol de la conexión';
  if (r.superuser) return `el usuario ${r.role} es superusuario`;
  if (r.bypass) return `el usuario ${r.role} tiene BYPASSRLS`;
  if (r.owner) return `el usuario ${r.role} es propietario de las tablas`;
  return null;
}

/** Cliente sin RLS de aplicación, para el propietario de la BD (tests, mantenimiento). */
export function createOwnerDb(databaseUrl: string): Db {
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
