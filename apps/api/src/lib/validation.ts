import { z } from 'zod';

/** Zona horaria IANA que el runtime reconoce (misma comprobación que okTz() en el generador). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'auth', 'public', 'static', 'assets', 'www', 'login', 'healthz', 'readyz']);

export const zSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE, 'Solo minúsculas, números y guiones (3–50 caracteres).')
  .refine((s) => !RESERVED_SLUGS.has(s), 'Ese identificador está reservado.');

export const zTimeZone = z.string().trim().refine(isValidTimeZone, 'Zona horaria desconocida.');
export const zCountryCode = z.string().trim().regex(/^[1-9]\d{0,2}$/, 'Código de país sin +, p. ej. 55.');
export const zCurrency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Código ISO 4217, p. ej. BRL.');
export const zLocale = z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Formato como pt-BR o es-ES.');
export const zEmail = z.string().trim().toLowerCase().max(254).pipe(z.email('Email inválido.'));

export const zIdParams = z.object({ id: z.uuid('Identificador inválido.') });

/** Texto opcional: cadena vacía o solo espacios → null (para poder borrar un campo con PATCH). */
export const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();

export const zHttpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((s) => {
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Debe ser una URL https://');
