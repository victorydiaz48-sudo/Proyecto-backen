import { z } from 'zod';
import { zCountryCode, zCurrency, zLocale, zTimeZone } from '../../lib/validation.ts';

/** Ajustes que un ADMIN puede cambiar. El slug no se cambia (rompería las páginas publicadas). */
export const TenantSettingsPatch = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: zTimeZone,
    defaultCountryCode: zCountryCode,
    currency: zCurrency,
    locale: zLocale,
    slotIntervalMinutes: z.number().int().min(5).max(120),
    defaultBookingStatus: z.enum(['PENDING', 'CONFIRMED']),
    bookingLeadMinutes: z.number().int().min(0).max(10_080),
    bookingHorizonDays: z.number().int().min(1).max(365),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Indica al menos un campo.');

export const TENANT_SETTINGS_SELECT = {
  slug: true,
  name: true,
  timezone: true,
  defaultCountryCode: true,
  currency: true,
  locale: true,
  slotIntervalMinutes: true,
  defaultBookingStatus: true,
  bookingLeadMinutes: true,
  bookingHorizonDays: true,
} as const;
