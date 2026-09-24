import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Detrás de un proxy/balanceador que termina TLS (X-Forwarded-*). */
  TRUST_PROXY: bool.default(false),
  /** Cookie de sesión solo por HTTPS. Por defecto: activado en producción. */
  COOKIE_SECURE: bool.optional(),
  /** Cómo se entregan los avisos. 'log' = opción C: se registran sin enviarse (ver docs/ARCHITECTURE.md). */
  NOTIFICATIONS_TRANSPORT: z.enum(['log']).default('log'),
  /** Worker de avisos dentro del proceso de la API. false si se ejecuta aparte o en varias réplicas. */
  NOTIFICATIONS_WORKER: bool.default(true),
  /** Build del panel (apps/admin/dist). Si no existe, la API funciona sin servir el panel. */
  ADMIN_DIST_DIR: z.string().optional(),
});

export type Config = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

/** Lee y valida la configuración. Falla al arrancar si falta algo, sin imprimir valores secretos. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración inválida en variables de entorno: ${fields}`);
  }
  const c = parsed.data;
  const cookieSecure = c.COOKIE_SECURE ?? c.NODE_ENV === 'production';
  if (c.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('COOKIE_SECURE no puede desactivarse en producción.');
  }
  return { ...c, COOKIE_SECURE: cookieSecure };
}
