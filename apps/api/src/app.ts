import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { FailureLimiter } from './lib/failure-limiter.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { AuthService } from './modules/auth/service.ts';
import { tenantAdminRoutes } from './modules/tenants/routes.admin.ts';
import { registerAuth, requireAuth, sameOriginGuard } from './plugins/auth.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Reloj inyectable para los tests (sesiones, disponibilidad). */
  now?: () => Date;
}

/** Construye la aplicación sin escuchar en ningún puerto (los tests usan app.inject()). */
export async function buildApp({ config, db, now = () => new Date() }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    genReqId: () => randomUUID(),
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Solo JSON: text/plain es una petición "simple" que un sitio ajeno podría enviar sin preflight (CSRF).
  app.removeContentTypeParser('text/plain');

  registerErrorHandler(app);
  await app.register(helmet, { global: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuth(app, { db, now });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  const auth = new AuthService(db, new FailureLimiter(5, 15 * 60 * 1000, () => now().getTime()), now);
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', sameOriginGuard);
      await scope.register(authRoutes, { prefix: '/auth', auth, cookieSecure: config.COOKIE_SECURE });
      await scope.register(
        async (admin) => {
          admin.addHook('preHandler', requireAuth);
          await admin.register(tenantAdminRoutes, { db });
        },
        { prefix: '/admin' },
      );
    },
    { prefix: '/api/v1' },
  );

  return app;
}
