import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { AppError } from '../../lib/errors.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { userActor, writeAudit } from '../audit/audit.ts';
import { createTelegramLink, unlinkTelegram, type TelegramBot } from '../notifications/telegram.ts';
import { TENANT_SETTINGS_SELECT, TenantSettingsPatch } from './schemas.ts';

/** /admin/settings: ajustes del tenant de la sesión (nunca de otro). */
export const tenantAdminRoutes: FastifyPluginAsyncZod<{ db: Db; telegram: TelegramBot | null; now: () => Date }> = async (
  app,
  { db, telegram, now },
) => {
  app.get('/settings', { onRequest: requireRole('ADMIN') }, async (request) => {
    const { tenant } = requireAuthContext(request);
    return db.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: TENANT_SETTINGS_SELECT });
  });

  app.patch('/settings', { onRequest: requireRole('ADMIN'), schema: { body: TenantSettingsPatch } }, async (request) => {
    const { tenant, user } = requireAuthContext(request);
    return db.$transaction(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: TENANT_SETTINGS_SELECT });
      const after = await tx.tenant.update({ where: { id: tenant.id }, data: request.body, select: TENANT_SETTINGS_SELECT });
      await writeAudit(tx, {
        tenantId: tenant.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'tenant.settings_updated',
        entityType: 'Tenant',
        entityId: tenant.id,
        before,
        after,
        ip: request.ip,
        requestId: request.id,
      });
      return after;
    });
  });

  // Avisos al negocio por Telegram (docs/ARCHITECTURE.md §7c).
  app.get('/settings/telegram', { onRequest: requireRole('ADMIN') }, async (request) => {
    const { tenant } = requireAuthContext(request);
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { telegramChatId: true, telegramLinkedAt: true } });
    return { available: telegram !== null, linked: t.telegramChatId !== null, linkedAt: t.telegramLinkedAt };
  });

  app.post('/settings/telegram/link', { onRequest: requireRole('ADMIN') }, async (request) => {
    const auth = requireAuthContext(request);
    if (!telegram) throw new AppError(409, 'TELEGRAM_NOT_CONFIGURED', 'Los avisos por Telegram no están activados en este servidor.');
    return createTelegramLink(db, telegram, userActor(auth, request), now());
  });

  app.delete('/settings/telegram', { onRequest: requireRole('ADMIN') }, async (request, reply) => {
    await unlinkTelegram(db, userActor(requireAuthContext(request), request));
    return reply.status(204).send();
  });
};
