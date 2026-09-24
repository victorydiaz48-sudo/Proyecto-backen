import type { Db } from '../../db.ts';
import { AppError, conflict } from '../../lib/errors.ts';
import type { Actor } from '../audit/audit.ts';
import { LocationsService } from '../locations/service.ts';
import { ProfessionalsService } from '../professionals/service.ts';
import { WorkingHoursService } from '../schedule/working-hours.ts';
import { ServicesService } from '../services/service.ts';
import { provisionTenant } from '../tenants/provision.ts';
import type { ImportPlan } from './generator-json.ts';

export interface ApplyResult {
  tenantId: string;
  created: boolean;
  temporaryPassword: string | null;
  counts: { locations: number; services: number; professionals: number; workingIntervals: number };
}

/**
 * Aplica el plan usando los mismos servicios que el panel (mismas validaciones y auditoría). Solo importa
 * en un negocio nuevo o recién creado (sin servicios ni profesionales): nunca pisa datos existentes.
 */
export async function applyImport(
  db: Db,
  plan: ImportPlan,
  args: { slug: string; adminEmail?: string | undefined; adminPassword: string; now: () => Date },
): Promise<ApplyResult> {
  let tenant = await db.tenant.findUnique({ where: { slug: args.slug } });
  let created = false;
  if (!tenant) {
    if (!args.adminEmail) throw new AppError(400, 'VALIDATION_ERROR', 'El negocio no existe: indica --admin-email para crearlo.');
    const r = await provisionTenant(db, {
      slug: args.slug,
      ...plan.tenant,
      locationName: plan.locations[0]!.name,
      adminEmail: args.adminEmail,
      adminPassword: args.adminPassword,
    });
    tenant = r.tenant;
    created = true;
  } else {
    const [services, professionals] = await Promise.all([
      db.service.count({ where: { tenantId: tenant.id } }),
      db.professional.count({ where: { tenantId: tenant.id } }),
    ]);
    if (services || professionals) throw conflict('El negocio ya tiene servicios o profesionales: el importador no sobrescribe datos.');
  }

  const actor: Actor = { tenantId: tenant.id, actorType: 'SYSTEM', actorUserId: null, ip: null, requestId: null };
  const locationsSvc = new LocationsService(db, args.now);
  const servicesSvc = new ServicesService(db);
  const prosSvc = new ProfessionalsService(db, args.now);
  const hoursSvc = new WorkingHoursService(db, args.now);

  // Local principal = el local por defecto (existe siempre); los demás se crean.
  const main = await db.location.findFirstOrThrow({ where: { tenantId: tenant.id, isDefault: true } });
  const [first, ...rest] = plan.locations;
  await locationsSvc.update(actor, main.id, { name: first!.name, address: first!.address, mapsUrl: first!.mapsUrl, whatsapp: first!.whatsapp });
  for (const [i, loc] of rest.entries()) {
    await locationsSvc.create(actor, { name: loc.name, address: loc.address, mapsUrl: loc.mapsUrl, whatsapp: loc.whatsapp, sortOrder: i + 1 });
  }

  const serviceIds = new Map<string, string>();
  for (const s of plan.services) serviceIds.set(s.name, (await servicesSvc.create(actor, s)).id);

  let workingIntervals = 0;
  for (const p of plan.professionals) {
    const pro = await prosSvc.create(actor, {
      displayName: p.displayName,
      title: p.title,
      bio: p.bio,
      sortOrder: p.sortOrder,
      serviceIds: p.serviceNames.map((n) => serviceIds.get(n)!).filter(Boolean),
    });
    const intervals = first!.hours.map((h) => ({ locationId: main.id, weekday: h.weekday, start: h.startMinute, end: h.endMinute }));
    if (intervals.length) {
      await hoursSvc.replace(actor, pro.id, intervals);
      workingIntervals += intervals.length;
    }
  }

  return {
    tenantId: tenant.id,
    created,
    temporaryPassword: created ? args.adminPassword : null,
    counts: { locations: plan.locations.length, services: plan.services.length, professionals: plan.professionals.length, workingIntervals },
  };
}
