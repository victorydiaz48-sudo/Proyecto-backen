import type { Db } from '../../src/db.ts';
import type { Prisma } from '../../src/generated/prisma/client.ts';

export interface TenantFixture {
  tenantId: string;
  locationId: string;
  serviceId: string;
  professionalId: string;
  customerId: string;
}

/** Crea un tenant mínimo con un local, un servicio de 30 min, un profesional y un cliente. */
export async function createTenantFixture(db: Db, slug: string): Promise<TenantFixture> {
  const tenant = await db.tenant.create({
    data: { slug, name: slug, timezone: 'America/Sao_Paulo', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR' },
  });
  const location = await db.location.create({ data: { tenantId: tenant.id, name: 'Principal', isDefault: true } });
  const service = await db.service.create({
    data: { tenantId: tenant.id, name: 'Corte', durationMinutes: 30, priceCents: 4500 },
  });
  const professional = await db.professional.create({ data: { tenantId: tenant.id, displayName: 'Carlos' } });
  await db.professionalService.create({
    data: { tenantId: tenant.id, professionalId: professional.id, serviceId: service.id },
  });
  const customer = await db.customer.create({
    data: { tenantId: tenant.id, name: 'João', phoneE164: '+5541998765432' },
  });
  return {
    tenantId: tenant.id,
    locationId: location.id,
    serviceId: service.id,
    professionalId: professional.id,
    customerId: customer.id,
  };
}

/** Datos de una cita de 30 min que empieza en `start` (UTC). Sobrescribibles con `over`. */
export function bookingData(
  f: TenantFixture,
  start: Date,
  over: Partial<Prisma.BookingUncheckedCreateInput> = {},
): Prisma.BookingUncheckedCreateInput {
  return {
    tenantId: f.tenantId,
    locationId: f.locationId,
    professionalId: f.professionalId,
    serviceId: f.serviceId,
    customerId: f.customerId,
    startAt: start,
    endAt: new Date(start.getTime() + 30 * 60_000),
    status: 'CONFIRMED',
    serviceNameSnapshot: 'Corte',
    priceCentsSnapshot: 4500,
    durationMinutesSnapshot: 30,
    currencySnapshot: 'BRL',
    source: 'PUBLIC_WEB',
    ...over,
  };
}

export const at = (iso: string): Date => new Date(iso);

/** Lunes a sábado 09:00–13:00 y 14:00–19:00 en el local por defecto del fixture. */
export async function giveStandardHours(db: Db, f: TenantFixture, professionalId = f.professionalId): Promise<void> {
  const rows = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday, startMinute: 14 * 60, endMinute: 19 * 60 },
  ]);
  await db.workingHour.createMany({
    data: rows.map((r) => ({ ...r, tenantId: f.tenantId, professionalId, locationId: f.locationId })),
  });
}
