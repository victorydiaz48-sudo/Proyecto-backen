import type { Db } from '../../db.ts';
import { newToken, sha256 } from '../../lib/crypto.ts';
import { AppError, validationError } from '../../lib/errors.ts';
import type { FailureLimiter } from '../../lib/failure-limiter.ts';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from '../../lib/password.ts';
import { SESSION_IDLE_MS, type AuthContext } from '../../plugins/auth.ts';
import { writeAudit } from '../audit/audit.ts';

export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
  requestId: string;
}

const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email, contraseña o negocio incorrectos.');
const tooManyAttempts = (): AppError =>
  new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly limiter: FailureLimiter,
    private readonly now: () => Date,
  ) {}

  /** Devuelve el token en claro (va a la cookie) y el contexto de la nueva sesión. */
  async login(
    input: { tenantSlug: string; email: string; password: string },
    meta: RequestMeta,
  ): Promise<{ token: string; auth: AuthContext }> {
    const key = `${input.tenantSlug}|${input.email}`;
    if (this.limiter.isBlocked(key)) throw tooManyAttempts();

    const tenant = await this.db.tenant.findUnique({ where: { slug: input.tenantSlug } });
    const user =
      tenant && tenant.status === 'ACTIVE'
        ? await this.db.user.findUnique({
            where: { tenantId_email: { tenantId: tenant.id, email: input.email } },
            include: { professional: { select: { id: true } } },
          })
        : null;

    // Siempre se ejecuta una verificación Argon2 (real o ficticia): mismo coste exista o no el usuario.
    let ok = false;
    if (user && user.active) ok = await verifyPassword(user.passwordHash, input.password);
    else await burnPasswordCheck(input.password);

    if (!ok || !user || !tenant) {
      this.limiter.fail(key);
      if (tenant) {
        await writeAudit(this.db, {
          tenantId: tenant.id,
          actorType: 'PUBLIC',
          action: 'auth.login_failed',
          entityType: 'User',
          entityId: user?.id ?? null,
          after: { email: input.email },
          ip: meta.ip,
          requestId: meta.requestId,
        });
      }
      throw invalidCredentials();
    }

    this.limiter.reset(key);
    const token = newToken();
    const now = this.now();
    const session = await this.db.$transaction(async (tx) => {
      const s = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
          lastSeenAt: now,
          createdAt: now,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      await writeAudit(tx, {
        tenantId: tenant.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      });
      return s;
    });
    return {
      token,
      auth: {
        sessionId: session.id,
        user: { id: user.id, email: user.email, role: user.role, professionalId: user.professional?.id ?? null },
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone, currency: tenant.currency, locale: tenant.locale },
      },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }

  /** Cambia la contraseña y cierra todas las demás sesiones del usuario. */
  async changePassword(
    ctx: { tenantId: string; userId: string; sessionId: string },
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.db.user.findFirstOrThrow({ where: { id: ctx.userId, tenantId: ctx.tenantId } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta.');
    }
    const problem = passwordProblem(input.newPassword, user.email);
    if (problem) throw validationError([{ path: 'body.newPassword', message: problem }]);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id, id: { not: ctx.sessionId } } });
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      });
    });
  }
}
