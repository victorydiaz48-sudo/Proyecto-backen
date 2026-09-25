import { LOCALES, LOG_LEVELS } from '@autocontent/shared';
import { z } from 'zod';

/**
 * Single source of truth for runtime configuration. Every variable is
 * documented in .env.example. Values are validated once at startup so a
 * misconfigured deploy fails loudly with a readable message instead of
 * misbehaving later.
 */

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    /** Run the whole flow with mock providers (no paid APIs). */
    MOCK_MODE: bool.default(true),
    /** Artificial delay for mock providers so the UX feels realistic. */
    MOCK_LATENCY_MS: z.coerce.number().int().min(0).max(60_000).default(800),

    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DEFAULT_LOCALE: z.enum(LOCALES).default('es'),

    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'does not look like a BotFather token (123456:ABC...)')
      .optional(),
    TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
    TELEGRAM_WEBHOOK_URL: z
      .url()
      .refine((u) => u.startsWith('https://'), 'must start with https://')
      .optional(),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,256}$/, 'must be 16-256 chars of A-Z, a-z, 0-9, _ or -')
      .optional(),

    /** Vision provider credentials (real provider arrives in Phase 4). */
    AI_API_KEY: z.string().min(1).optional(),

    /** PostgreSQL. Optional until Phase 2 wires the bot to the database. */
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// URL')
      .optional(),
    /** Redis for the BullMQ queue (Phase 2). Without it, the in-memory queue is used. */
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// URL')
      .optional(),
    /** "version:base64key" pairs (32-byte keys), comma separated. Encrypts stored API keys. */
    ENCRYPTION_KEYS: z
      .string()
      .regex(/^\d+:[A-Za-z0-9+/]{43}=(,\s*\d+:[A-Za-z0-9+/]{43}=)*$/, 'must look like "1:<44-char base64 key>"')
      .optional(),
    /** Retries after the first attempt (spec: MAX_RETRIES = 3 → up to 4 attempts). */
    JOB_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

    MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    MIN_IMAGE_DIMENSION: z.coerce.number().int().positive().default(320),
    MAX_IMAGE_DIMENSION: z.coerce.number().int().positive().default(10_000),
  })
  .superRefine((c, ctx) => {
    if (c.TELEGRAM_MODE === 'webhook') {
      if (!c.TELEGRAM_WEBHOOK_URL) {
        ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_URL'], message: 'required when TELEGRAM_MODE=webhook' });
      }
      if (!c.TELEGRAM_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_WEBHOOK_SECRET'],
          message: 'required when TELEGRAM_MODE=webhook',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Hosting dashboards often keep a variable with an empty value instead of
 * deleting it; treat blank as "not set".
 */
function clean(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = configSchema.safeParse(clean(env));
  if (!result.success) {
    // Never echo values: they may be secrets.
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
