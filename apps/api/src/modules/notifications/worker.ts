import type { Db } from '../../db.ts';
import type { NotificationTransport } from './transport.ts';

export const MAX_ATTEMPTS = 5;
/** Espera antes de reintentar tras el intento N (1, 5, 15, 60 min). */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** Mientras un worker envía un aviso, nadie más lo toma; si el proceso muere, se reintenta al vencer. */
const LEASE_MS = 5 * 60_000;

export interface ProcessResult {
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Envía los avisos vencidos. Seguro con varios workers a la vez: cada aviso se reclama con
 * `FOR UPDATE SKIP LOCKED` y un plazo de alquiler, así dos procesos nunca envían el mismo. La entrega es
 * "al menos una vez": si el proceso muere tras enviar y antes de marcarlo, se reintentará.
 */
export async function processDueNotifications(db: Db, transport: NotificationTransport, now: Date, batch = 20): Promise<ProcessResult> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const claimed = await db.$queryRaw<{ id: string; tenantId: string; channel: string; payload: { to: string; text: string }; attempts: number }[]>`
    UPDATE "NotificationOutbox" SET attempts = attempts + 1, "nextAttemptAt" = ${lease}, "updatedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "NotificationOutbox"
      WHERE status = 'PENDING' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt", id
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "tenantId", channel, payload, attempts`;

  const result: ProcessResult = { sent: 0, failed: 0, retried: 0 };
  for (const n of claimed) {
    try {
      await transport.send({ id: n.id, tenantId: n.tenantId, channel: n.channel, to: n.payload.to, text: n.payload.text });
      await db.notificationOutbox.updateMany({ where: { id: n.id, status: 'PENDING' }, data: { status: 'SENT', sentAt: now, lastError: null } });
      result.sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      if (n.attempts >= MAX_ATTEMPTS) {
        await db.notificationOutbox.updateMany({ where: { id: n.id, status: 'PENDING' }, data: { status: 'FAILED', lastError: message } });
        result.failed++;
      } else {
        const wait = BACKOFF_MS[Math.min(n.attempts - 1, BACKOFF_MS.length - 1)]!;
        await db.notificationOutbox.updateMany({
          where: { id: n.id, status: 'PENDING' },
          data: { lastError: message, nextAttemptAt: new Date(now.getTime() + wait) },
        });
        result.retried++;
      }
    }
  }
  return result;
}

/** Bucle del worker dentro del proceso de la API (separable a otro proceso más adelante). */
export function startNotificationWorker(
  db: Db,
  transport: NotificationTransport,
  log: { error: (obj: unknown, msg: string) => void },
  intervalMs = 15_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Vacía la cola por lotes en cada vuelta.
      for (let i = 0; i < 10; i++) {
        const r = await processDueNotifications(db, transport, new Date());
        if (r.sent + r.failed + r.retried === 0) break;
      }
    } catch (err) {
      log.error({ err }, 'error en el worker de avisos');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
