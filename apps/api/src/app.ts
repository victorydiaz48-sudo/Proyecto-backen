import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { FailureLimiter } from './lib/failure-limiter.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { AuthService } from './modules/auth/service.ts';
import { availabilityAdminRoutes } from './modules/availability/routes.admin.ts';
import { bookingAdminRoutes } from './modules/bookings/routes.admin.ts';
import { customerAdminRoutes } from './modules/customers/routes.admin.ts';
import { locationAdminRoutes } from './modules/locations/routes.admin.ts';
import { professionalAdminRoutes } from './modules/professionals/routes.admin.ts';
import { publicRoutes } from './modules/public/routes.ts';
import { scheduleAdminRoutes } from './modules/schedule/routes.admin.ts';
import { serviceAdminRoutes } from './modules/services/routes.admin.ts';
import { tenantAdminRoutes } from './modules/tenants/routes.admin.ts';
import { userAdminRoutes } from './modules/users/routes.admin.ts';
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

  const adminDist = resolve(config.ADMIN_DIST_DIR ?? join(import.meta.dirname, '../../admin/dist'));
  const serveAdmin = existsSync(join(adminDist, 'index.html'));
  registerErrorHandler(app, { spaFallback: serveAdmin });
  await app.register(helmet, { global: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuth(app, { db, now });

  if (serveAdmin) {
    // Panel React en el mismo origen que la API (un solo despliegue). Los assets llevan hash en el
    // nombre: caché larga; index.html nunca se cachea para que un despliegue nuevo se vea al instante.
    await app.register(fastifyStatic, {
      root: adminDist,
      prefix: '/',
      index: 'index.html',
      wildcard: false,
      setHeaders: (res, path) => {
        res.header('cache-control', path.startsWith(join(adminDist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

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
      // Rutas con cookie de sesión (panel): protección CSRF por origen. No se aplica a /public.
      await scope.register(async (session) => {
        session.addHook('preHandler', sameOriginGuard);
        await session.register(authRoutes, { prefix: '/auth', auth, cookieSecure: config.COOKIE_SECURE });
        await session.register(
          async (admin) => {
            admin.addHook('preHandler', requireAuth);
            await admin.register(tenantAdminRoutes, { db });
            await admin.register(serviceAdminRoutes, { db });
            await admin.register(professionalAdminRoutes, { db, now });
            await admin.register(locationAdminRoutes, { db, now });
            await admin.register(scheduleAdminRoutes, { db, now });
            await admin.register(customerAdminRoutes, { db });
            await admin.register(bookingAdminRoutes, { db, now });
            await admin.register(availabilityAdminRoutes, { db, now });
            await admin.register(userAdminRoutes, { db });
          },
          { prefix: '/admin' },
        );
      });
      // API pública: las páginas generadas pueden abrirse desde cualquier dominio o desde file://
      // (Origin: null). Sin cookies ni credenciales, así que '*' no expone ninguna sesión.
      await scope.register(
        async (pub) => {
          await pub.register(cors, {
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Idempotency-Key'],
            exposedHeaders: ['Idempotent-Replayed', 'Retry-After'],
            credentials: false,
            maxAge: 600,
          });
          await pub.register(publicRoutes, { db, now });
        },
        { prefix: '/public' },
      );
    },
    { prefix: '/api/v1' },
  );

  return app;
}
