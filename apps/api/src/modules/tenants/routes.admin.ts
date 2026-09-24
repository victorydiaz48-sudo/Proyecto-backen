import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db.ts';
import { requireAuthContext, requireRole } from '../../plugins/auth.ts';
import { writeAudit } from '../audit/audit.ts';
import { TENANT_SETTINGS_SELECT, TenantSettingsPatch } from './schemas.ts';

/** /admin/settings: ajustes del tenant de la sesión (nunca de otro). */
export const tenantAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
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
};
