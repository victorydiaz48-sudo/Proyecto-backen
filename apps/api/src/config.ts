import { isIP } from 'node:net';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Alias de proxy-addr: redes de loopback, link-local y privadas (10/8, 172.16/12, 192.168/16, fc00::/7). */
const PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isIpOrCidr(value: string): boolean {
  const [addr = '', prefix, extra] = value.split('/');
  const version = isIP(addr);
  if (!version || extra !== undefined) return false;
  if (prefix === undefined) return true;
  const n = Number(prefix);
  return /^\d+$/.test(prefix) && n >= 0 && n <= (version === 4 ? 32 : 128);
}

/**
 * Proxies de confianza. `false`: nadie (X-Forwarded-For se ignora). Si no, lista de IPs/CIDR o alias de
 * los proxies propios: la IP del cliente es la última de X-Forwarded-For que NO sea de un proxy de
 * confianza. `true` (confiar en todos) está prohibido: tomaría la primera IP de la cabecera, que escribe el
 * cliente, y cualquiera podría saltarse los límites de peticiones cambiándola.
 */
const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((v, ctx): false | string => {
    if (v === 'false' || v === '0' || v === '') return false;
    if (v === 'true' || v === '1') {
      ctx.addIssue({ code: 'custom', message: 'usa la lista de IPs/CIDR de tus proxies (p. ej. "uniquelocal" o "10.0.0.0/8"), no true' });
      return z.NEVER;
    }
    const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
    const bad = parts.filter((p) => !PROXY_PRESETS.has(p) && !isIpOrCidr(p));
    if (bad.length) {
      ctx.addIssue({ code: 'custom', message: `no son IPs, CIDR ni alias válidos: ${bad.join(', ')}` });
      return z.NEVER;
    }
    return parts.join(',');
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Detrás de un proxy/balanceador que termina TLS (X-Forwarded-*): sus IPs/CIDR. Ver trustProxy. */
  TRUST_PROXY: trustProxy,
  /** Cookie de sesión solo por HTTPS. Por defecto: activado en producción. */
  COOKIE_SECURE: bool.optional(),
  /** Cómo se entregan los avisos. 'log' = opción C: se registran sin enviarse (ver docs/ARCHITECTURE.md). */
  NOTIFICATIONS_TRANSPORT: z.enum(['log']).default('log'),
  /** Worker de avisos dentro del proceso de la API. false si se ejecuta aparte o en varias réplicas. */
  NOTIFICATIONS_WORKER: bool.default(true),
  /**
   * Activa /operator (alta de negocios desde el navegador, sin terminal). Sin definir: desactivado (404).
   * Mínimo 32 caracteres; se puede quitar después de crear el primer negocio.
   */
  OPERATOR_TOKEN: z.string().min(32, 'mínimo 32 caracteres').optional(),
  /** Build del panel (apps/admin/dist). Si no existe, la API funciona sin servir el panel. */
  ADMIN_DIST_DIR: z.string().optional(),
});

export type Config = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

/** Lee y valida la configuración. Falla al arrancar si falta algo, sin imprimir valores secretos. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Nombre de la variable y motivo; los mensajes de validación no incluyen el valor (puede ser secreto).
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join(', ');
    throw new Error(`Configuración inválida en variables de entorno: ${fields}`);
  }
  const c = parsed.data;
  const cookieSecure = c.COOKIE_SECURE ?? c.NODE_ENV === 'production';
  if (c.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('COOKIE_SECURE no puede desactivarse en producción.');
  }
  return { ...c, COOKIE_SECURE: cookieSecure };
}
