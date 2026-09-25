import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PASSWORD_MAX } from '../../lib/password.ts';
import { toSlugInput, zEmail } from '../../lib/validation.ts';
import { requireAuth, requireAuthContext, SESSION_ABSOLUTE_MS, SESSION_COOKIE, type AuthContext } from '../../plugins/auth.ts';
import type { AuthService, RequestMeta } from './service.ts';

export interface AuthRoutesOptions {
  auth: AuthService;
  cookieSecure: boolean;
}

const meResponse = (a: AuthContext) => ({ user: a.user, tenant: a.tenant });

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, { auth, cookieSecure }) => {
  const meta = (req: { ip: string; headers: Record<string, unknown>; id: string }): RequestMeta => ({
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    requestId: req.id,
  });
  const cookieOptions = { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/' } as const;

  app.post(
    '/login',
    {
      config: {
        // Por IP y negocio, después de validar el cuerpo: detrás de un proxy mal configurado todos los
        // visitantes comparten IP, y así los intentos de un negocio no bloquean el login de los demás.
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) => `${req.ip}|${(req.body as { tenantSlug?: string } | undefined)?.tenantSlug ?? ''}`,
        },
      },
      schema: {
        body: z
          .object({
            tenantSlug: z.string().max(100).transform(toSlugInput).pipe(z.string().min(1).max(50)),
            email: zEmail,
            password: z.string().min(1).max(PASSWORD_MAX),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      const { token, auth: ctx } = await auth.login(request.body, meta(request));
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_ABSOLUTE_MS / 1000 });
      return meResponse(ctx);
    },
  );

  app.post('/logout', { onRequest: requireAuth }, async (request, reply) => {
    await auth.logout(requireAuthContext(request).sessionId);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/me', { onRequest: requireAuth }, async (request) => meResponse(requireAuthContext(request)));

  app.post(
    '/password',
    {
      onRequest: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        body: z
          .object({ currentPassword: z.string().min(1).max(PASSWORD_MAX), newPassword: z.string().min(1).max(PASSWORD_MAX) })
          .strict(),
      },
    },
    async (request, reply) => {
      const a = requireAuthContext(request);
      await auth.changePassword({ tenantId: a.tenant.id, userId: a.user.id, sessionId: a.sessionId }, request.body, meta(request));
      return reply.status(204).send();
    },
  );
};
