import { randomBytes } from 'node:crypto';
import { PgErrorCode, pgErrorCode, type Db, type Tx } from '../../db.ts';
import type { Role } from '../../generated/prisma/enums.ts';
import { AppError, conflict, notFound, validationError } from '../../lib/errors.ts';
import { hashPassword, passwordProblem } from '../../lib/password.ts';
import { writeAudit, type Actor } from '../audit/audit.ts';

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  professional: { select: { id: true, displayName: true } },
} as const;

type Row = { id: string; email: string; role: Role; active: boolean; lastLoginAt: Date | null; createdAt: Date; professional: { id: string; displayName: string } | null };
const toDto = (u: Row) => ({ ...u, professionalId: u.professional?.id ?? null });
export type UserDto = ReturnType<typeof toDto>;

/** Contraseña temporal legible (20 caracteres, ~120 bits). */
const temporaryPassword = (): string => randomBytes(15).toString('base64url');

/**
 * Usuarios del panel de un tenant. Reglas: siempre queda al menos un ADMIN activo; desactivar o bajar
 * de rol corta sus sesiones; una ficha de profesional solo se vincula a un usuario PROFESSIONAL.
 */
export class UsersService {
  constructor(private readonly db: Db) {}

  async list(tenantId: string): Promise<UserDto[]> {
    const rows = await this.db.user.findMany({ where: { tenantId }, select: USER_SELECT, orderBy: [{ role: 'asc' }, { email: 'asc' }] });
    return rows.map(toDto);
  }

  async create(
    actor: Actor,
    input: { email: string; role: Role; password?: string | undefined; professionalId?: string | null | undefined },
  ): Promise<{ user: UserDto; temporaryPassword: string | null }> {
    const generated = input.password === undefined;
    const password = input.password ?? temporaryPassword();
    const problem = passwordProblem(password, input.email);
    if (problem) throw validationError([{ path: 'body.password', message: problem }]);
    if (input.professionalId && input.role !== 'PROFESSIONAL') {
      throw validationError([{ path: 'body.professionalId', message: 'Solo un usuario PROFESSIONAL se vincula a una ficha.' }]);
    }
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { tenantId: actor.tenantId, email: input.email, role: input.role, passwordHash }, select: { id: true } });
        if (input.professionalId) await this.link(tx, actor.tenantId, created.id, input.professionalId);
        const dto = toDto(await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: created.id }, select: USER_SELECT }));
        await writeAudit(tx, { ...actor, action: 'user.created', entityType: 'User', entityId: created.id, after: { email: dto.email, role: dto.role, professionalId: dto.professionalId } });
        return dto;
      });
      return { user, temporaryPassword: generated ? password : null };
    } catch (err) {
      if (pgErrorCode(err) === PgErrorCode.UNIQUE_VIOLATION) throw conflict('Ya existe un usuario con ese email en este negocio.');
      throw err;
    }
  }

  async update(actor: Actor, id: string, input: { role?: Role; active?: boolean; professionalId?: string | null }): Promise<UserDto> {
    return this.db.$transaction(async (tx) => {
      // Serializa los cambios de usuarios del tenant: dos ADMIN no pueden degradarse a la vez y dejar cero.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
      const before = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id }, select: USER_SELECT });
      if (!before) throw notFound();
      const role = input.role ?? before.role;
      const active = input.active ?? before.active;

      if (before.role === 'ADMIN' && before.active && (role !== 'ADMIN' || !active)) {
        const admins = await tx.user.count({ where: { tenantId: actor.tenantId, role: 'ADMIN', active: true } });
        if (admins <= 1) throw conflict('Debe quedar al menos un ADMIN activo en el negocio.');
      }
      if (input.professionalId && role !== 'PROFESSIONAL') {
        throw validationError([{ path: 'body.professionalId', message: 'Solo un usuario PROFESSIONAL se vincula a una ficha.' }]);
      }

      await tx.user.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { role, active } });
      // Se desvincula si cambia la ficha o si deja de ser PROFESSIONAL; luego se vincula la nueva.
      if (input.professionalId !== undefined || role !== 'PROFESSIONAL') {
        await tx.professional.updateMany({ where: { tenantId: actor.tenantId, userId: id }, data: { userId: null } });
      }
      if (input.professionalId) await this.link(tx, actor.tenantId, id, input.professionalId);
      // Cambiar rol o desactivar corta las sesiones abiertas: los permisos nuevos rigen ya.
      if (role !== before.role || !active) await tx.session.deleteMany({ where: { userId: id } });

      const after = toDto(await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, select: USER_SELECT }));
      const view = (u: UserDto) => ({ role: u.role, active: u.active, professionalId: u.professionalId });
      await writeAudit(tx, { ...actor, action: 'user.updated', entityType: 'User', entityId: id, before: view(toDto(before)), after: view(after) });
      return after;
    });
  }

  /** Un ADMIN fija una contraseña temporal (p. ej. el profesional la olvidó). Cierra sus sesiones. */
  async resetPassword(actor: Actor, id: string): Promise<{ temporaryPassword: string }> {
    const user = await this.db.user.findFirst({ where: { tenantId: actor.tenantId, id }, select: { id: true } });
    if (!user) throw notFound();
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: id } });
      await writeAudit(tx, { ...actor, action: 'user.password_reset', entityType: 'User', entityId: id });
    });
    return { temporaryPassword: password };
  }

  private async link(tx: Tx, tenantId: string, userId: string, professionalId: string): Promise<void> {
    const pro = await tx.professional.findFirst({ where: { tenantId, id: professionalId }, select: { userId: true } });
    if (!pro) throw validationError([{ path: 'body.professionalId', message: 'Profesional no encontrado.' }]);
    if (pro.userId && pro.userId !== userId) throw new AppError(409, 'CONFLICT', 'Esa ficha ya está vinculada a otro usuario.');
    await tx.professional.update({ where: { tenantId_id: { tenantId, id: professionalId } }, data: { userId } });
  }
}
