import type { Db } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { sha256 } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';

const TTL_MS = 24 * 60 * 60 * 1000;
/** responseStatus 0 = la petición original sigue en curso. */
const IN_PROGRESS = 0;

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

/** JSON con claves ordenadas: el mismo cuerpo produce siempre el mismo hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export type IdempotencyOutcome =
  | { kind: 'new'; complete: (status: number, body: Prisma.InputJsonValue) => Promise<void>; abandon: () => Promise<void> }
  | { kind: 'replay'; status: number; body: unknown };

/**
 * Reintentos seguros de POST /bookings (p. ej. se cortó la red tras enviar). Primero se reserva la clave
 * con INSERT … ON CONFLICT (atómico): de dos peticiones simultáneas con la misma clave solo una avanza.
 * - Misma clave y mismo cuerpo, ya terminada → se devuelve la misma respuesta (sin crear otra cita).
 * - Misma clave, cuerpo distinto → 422 IDEMPOTENCY_KEY_REUSED.
 * - Misma clave aún en curso → 409 IDEMPOTENCY_IN_PROGRESS.
 * Solo se guardan respuestas de éxito: tras un error (p. ej. hueco ocupado) la clave se libera y el
 * cliente puede reintentar con ella.
 */
export async function beginIdempotent(db: Db, tenantId: string, key: string, body: unknown, now: Date): Promise<IdempotencyOutcome> {
  const requestHash = sha256(canonical(body));
  await db.idempotencyKey.deleteMany({ where: { tenantId, key, createdAt: { lt: new Date(now.getTime() - TTL_MS) } } });
  const inserted = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "IdempotencyKey" ("tenantId", key, "requestHash", "responseStatus", "responseBody", "createdAt")
    VALUES (${tenantId}::uuid, ${key}, ${requestHash}, ${IN_PROGRESS}, '{}'::jsonb, ${now})
    ON CONFLICT ("tenantId", key) DO NOTHING
    RETURNING key`;
  const where = { tenantId_key: { tenantId, key } };
  if (inserted.length) {
    return {
      kind: 'new',
      complete: async (status, responseBody) => {
        await db.idempotencyKey.update({ where, data: { responseStatus: status, responseBody } });
      },
      abandon: async () => {
        await db.idempotencyKey.deleteMany({ where: { tenantId, key, responseStatus: IN_PROGRESS } });
      },
    };
  }
  const existing = await db.idempotencyKey.findUnique({ where });
  if (!existing) throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'La petición original aún se está procesando. Reintenta en unos segundos.');
  if (existing.requestHash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Esa Idempotency-Key ya se usó con otros datos.');
  }
  if (existing.responseStatus === IN_PROGRESS) {
    throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'La petición original aún se está procesando. Reintenta en unos segundos.');
  }
  return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
}
