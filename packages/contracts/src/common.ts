import { LOCALES } from '@autocontent/shared';
import { z } from 'zod';

/**
 * Building blocks shared by every endpoint. Conventions:
 *  - ids are UUIDs; timestamps ISO-8601 strings
 *  - money is micro-USD as a decimal string (JSON has no bigint), plus a
 *    display value in the organization's currency where useful
 *  - lists use cursor pagination
 *  - errors: { error: { code, message, details? } }
 *  - organizationId never appears in requests: it comes from the session
 */
export const uuid = z.uuid();
/** http(s) only — rejects javascript:, data:, file: and friends. */
export const httpUrl = z.url({ protocol: /^https?$/, hostname: z.regexes.domain });
export const isoDate = z.iso.datetime();
export const microsUsd = z.string().regex(/^\d+$/).describe('Amount in micro-USD (1 USD = 1,000,000)');
export const locale = z.enum(LOCALES);
export const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'OPERATOR'] as const;
export const role = z.enum(ROLES);
export type Role = z.infer<typeof role>;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'PROVIDER_NOT_CONFIGURED',
  'INTERNAL',
] as const;

export const errorResponse = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const idParams = z.object({ id: uuid });
export const okResponse = z.object({ ok: z.literal(true) });

/** Role hierarchy: a role can do everything the roles to its right can. */
export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLES.indexOf(actual) <= ROLES.indexOf(required);
}
