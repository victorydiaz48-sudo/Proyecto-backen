import type { Prisma } from '../../generated/prisma/client.ts';
import type { AuditActorType } from '../../generated/prisma/enums.ts';

/** Cliente Prisma o transacción: la auditoría se escribe en la misma transacción que el cambio. */
type Writer = { auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> } };

export interface AuditEntry {
  tenantId: string;
  actorType: AuditActorType;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  requestId?: string | null;
}

// Nunca se registran secretos aunque lleguen por error en before/after.
const SECRET_KEYS = new Set(['password', 'passwordHash', 'currentPassword', 'newPassword', 'tokenHash', 'manageTokenHash']);

function scrub(value: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v as Prisma.InputJsonValue) ?? null);
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SECRET_KEYS.has(k) && v !== undefined) out[k] = scrub(v as Prisma.InputJsonValue) ?? null;
  }
  return out;
}

export async function writeAudit(db: Writer, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: e.tenantId,
      actorType: e.actorType,
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      ...(e.before !== undefined ? { before: scrub(e.before) } : {}),
      ...(e.after !== undefined ? { after: scrub(e.after) } : {}),
      ip: e.ip ?? null,
      requestId: e.requestId ?? null,
    },
  });
}

/** Datos comunes de auditoría para una acción de un usuario autenticado. */
export function userActor(
  auth: { tenant: { id: string }; user: { id: string } },
  request: { ip: string; id: string },
): Pick<AuditEntry, 'tenantId' | 'actorType' | 'actorUserId' | 'ip' | 'requestId'> {
  return { tenantId: auth.tenant.id, actorType: 'USER', actorUserId: auth.user.id, ip: request.ip, requestId: request.id };
}
