import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import type { Db } from '../../src/db.ts';
import type { Role } from '../../src/generated/prisma/enums.ts';
import { hashPassword } from '../../src/lib/password.ts';

export const TEST_PASSWORD = 'clave-de-prueba-segura';

export async function buildTestApp(
  db: Db,
  now?: () => Date,
  env: Record<string, string> = {},
  logStream?: { write(line: string): void },
): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_LEVEL: 'silent',
    // Por defecto sin panel: los tests no dependen de que apps/admin esté compilado.
    ADMIN_DIST_DIR: '/nonexistent-admin-dist',
    ...env,
  });
  return buildApp({ config, db, ...(now ? { now } : {}), ...(logStream ? { logStream } : {}) });
}

// Hash calculado una sola vez: Argon2 es lento a propósito y no aporta nada repetirlo en cada fixture.
let cachedHash: Promise<string> | undefined;
export async function createUser(
  db: Db,
  tenantId: string,
  email: string,
  role: Role,
  opts: { professionalId?: string } = {},
): Promise<{ id: string; email: string }> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  const user = await db.user.create({ data: { tenantId, email, role, passwordHash: await cachedHash } });
  if (opts.professionalId) {
    await db.professional.update({ where: { id: opts.professionalId }, data: { userId: user.id } });
  }
  return user;
}

/** Cookie `sid=…` extraída de una respuesta (para reenviarla en las siguientes peticiones). */
export function sessionCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'sid');
  if (!c) throw new Error(`No hay cookie de sesión (status ${res.statusCode}: ${res.body})`);
  return `sid=${c.value}`;
}

export async function login(app: FastifyInstance, tenantSlug: string, email: string, password = TEST_PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantSlug, email, password } });
  return { res, cookie: res.statusCode === 200 ? sessionCookie(res) : '' };
}
