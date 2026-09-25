import type { Tx } from '../../db.ts';

/**
 * Bloquea (SELECT … FOR UPDATE) las filas de los profesionales indicados hasta el fin de la transacción.
 * Toda operación que cambie la agenda de un profesional (crear cita, bloqueo, cambiar horario) pasa por
 * aquí, así dos operaciones concurrentes sobre el mismo profesional se ejecutan en serie y cada una ve
 * lo que hizo la otra. Orden por id para evitar interbloqueos.
 */
export async function lockProfessionals(tx: Tx, tenantId: string, professionalIds: string[] | 'all'): Promise<void> {
  if (professionalIds === 'all') {
    await tx.$queryRaw`SELECT id FROM "Professional" WHERE "tenantId" = ${tenantId}::uuid ORDER BY id FOR UPDATE`;
    return;
  }
  if (professionalIds.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "Professional"
    WHERE "tenantId" = ${tenantId}::uuid AND id = ANY(${professionalIds}::uuid[])
    ORDER BY id FOR UPDATE`;
}
