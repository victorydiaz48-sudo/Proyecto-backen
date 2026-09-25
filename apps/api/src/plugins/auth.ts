import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { Db } from '../db.ts';
import type { Role } from '../generated/prisma/enums.ts';
import { sha256 } from '../lib/crypto.ts';
import { AppError, forbidden, unauthenticated } from '../lib/errors.ts';
import { setRequestTenant } from '../lib/tenant-context.ts';

export const SESSION_COOKIE = 'sid';
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // caducidad deslizante
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // caducidad absoluta desde el login
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** Todo lo que una ruta autenticada necesita saber. Sale de la BD vía la sesión, nunca del cliente. */
export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; role: Role; professionalId: string | null };
  tenant: { id: string; slug: string; name: string; timezone: string; currency: string; locale: string };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface AuthOptions {
  db: Db;
  now: () => Date;
}

/** Carga la sesión desde la cookie en cada petición (o deja `request.auth = null`). */
export function registerAuth(app: FastifyInstance, { db, now }: AuthOptions): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token || token.length > 100) return;
    const tokenHash = sha256(token);
    // Con RLS, la sesión solo es visible con su negocio fijado: una función acotada de la BD devuelve el
    // negocio del token (y nada más) para poder fijarlo antes de leerla.
    const [owner] = await db.$queryRaw<{ tenantId: string | null }[]>`SELECT app_session_tenant(${tokenHash}) AS "tenantId"`;
    if (!owner?.tenantId) return;
    setRequestTenant(owner.tenantId);
    const session = await db.session.findUnique({
      where: { tokenHash },
      include: { user: { include: { tenant: true, professional: { select: { id: true } } } } },
    });
    if (!session) return;
    const t = now().getTime();
    const { user } = session;
    const expired =
      session.expiresAt.getTime() <= t || session.createdAt.getTime() + SESSION_ABSOLUTE_MS <= t;
    if (expired || !user.active || user.tenant.status !== 'ACTIVE') return;

    if (t - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      const expiresAt = new Date(Math.min(t + SESSION_IDLE_MS, session.createdAt.getTime() + SESSION_ABSOLUTE_MS));
      await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(t), expiresAt } });
    }

    request.auth = {
      sessionId: session.id,
      user: { id: user.id, email: user.email, role: user.role, professionalId: user.professional?.id ?? null },
      tenant: {
        id: user.tenant.id,
        slug: user.tenant.slug,
        name: user.tenant.name,
        timezone: user.tenant.timezone,
        currency: user.tenant.currency,
        locale: user.tenant.locale,
      },
    };
  });
}

/** Contexto autenticado o 401. Úsalo en los handlers en vez de leer `request.auth` directamente. */
export function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}

/*
 * Sesión, rol y CSRF se comprueban en onRequest, ANTES de validar el cuerpo: así una petición anónima o
 * sin permiso recibe 401/403 y nunca un 400 que revele el esquema del endpoint.
 */
export const requireAuth: onRequestAsyncHookHandler = async (request) => {
  requireAuthContext(request);
};

export function requireRole(...roles: Role[]): onRequestAsyncHookHandler {
  return async (request) => {
    const auth = requireAuthContext(request);
    if (!roles.includes(auth.user.role)) throw forbidden();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protección CSRF para las rutas con cookie (panel y auth). Además de SameSite=Strict, las peticiones
 * que modifican estado deben venir del mismo origen según Sec-Fetch-Site u Origin. Los clientes que no
 * son navegadores no envían esas cabeceras y no pueden ser víctimas de CSRF.
 */
export async function sameOriginGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;
  // Sec-Fetch-Site lo pone el navegador y una página no puede falsearlo: si viene, decide él. Así no se
  // depende de la cabecera Host, que un proxy (p. ej. el de Railway) puede reescribir.
  const site = request.headers['sec-fetch-site'];
  if (site) {
    if (site !== 'same-origin' && site !== 'none') throw csrfError();
    return;
  }
  // Navegadores sin Sec-Fetch-Site: Origin debe coincidir con el host.
  const origin = request.headers.origin;
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw csrfError();
    }
    if (host !== request.host) throw csrfError();
  }
}

const csrfError = (): AppError => new AppError(403, 'CSRF_REJECTED', 'Origen de la petición no permitido.');
