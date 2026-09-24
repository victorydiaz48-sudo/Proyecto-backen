// Datos de desarrollo: dos barberías casi idénticas (A y B) para probar el aislamiento a mano.
// Solo desarrollo. Usuarios: admin@<slug>.test (ADMIN) y carlos@<slug>.test (PROFESSIONAL),
// contraseña SEED_PASSWORD (por defecto "dev-password-123").
import 'dotenv/config';
import { loadConfig } from '../src/config.ts';
import { createDb, type Db } from '../src/db.ts';
import { hashPassword } from '../src/lib/password.ts';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password-123';

const SEED_TENANTS = [
  { slug: 'barberia-a', name: 'Barbería A', timezone: 'America/Sao_Paulo', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR' },
  { slug: 'barberia-b', name: 'Barbería B', timezone: 'Europe/Madrid', defaultCountryCode: '34', currency: 'EUR', locale: 'es-ES' },
] as const;

async function seedTenant(db: Db, t: (typeof SEED_TENANTS)[number]): Promise<void> {
  if (await db.tenant.findUnique({ where: { slug: t.slug } })) {
    console.log(`= ${t.slug} ya existe, se omite`);
    return;
  }
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: t });
    await tx.user.create({ data: { tenantId: tenant.id, email: `admin@${t.slug}.test`, passwordHash, role: 'ADMIN' } });
    const location = await tx.location.create({ data: { tenantId: tenant.id, name: 'Principal', isDefault: true } });
    const corte = await tx.service.create({ data: { tenantId: tenant.id, name: 'Corte', durationMinutes: 30, priceCents: 4500 } });
    const barba = await tx.service.create({ data: { tenantId: tenant.id, name: 'Barba', durationMinutes: 20, priceCents: 3000 } });
    const combo = await tx.service.create({ data: { tenantId: tenant.id, name: 'Corte + barba', durationMinutes: 50, priceCents: 6500 } });
    const pros = [
      { name: 'Carlos', services: [corte, barba, combo] },
      { name: 'André', services: [corte] },
    ];
    for (const [i, p] of pros.entries()) {
      const user =
        i === 0
          ? await tx.user.create({
              data: { tenantId: tenant.id, email: `carlos@${t.slug}.test`, passwordHash, role: 'PROFESSIONAL' },
            })
          : null;
      const pro = await tx.professional.create({
        data: { tenantId: tenant.id, displayName: p.name, sortOrder: i, userId: user?.id ?? null },
      });
      await tx.professionalService.createMany({
        data: p.services.map((s) => ({ tenantId: tenant.id, professionalId: pro.id, serviceId: s.id })),
      });
      // Lunes a viernes 09:00–13:00 y 14:00–19:00; sábado 09:00–15:00 (varios intervalos por día).
      const hours = [1, 2, 3, 4, 5].flatMap((weekday) => [
        { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
        { weekday, startMinute: 14 * 60, endMinute: 19 * 60 },
      ]);
      hours.push({ weekday: 6, startMinute: 9 * 60, endMinute: 15 * 60 });
      await tx.workingHour.createMany({
        data: hours.map((h) => ({ ...h, tenantId: tenant.id, professionalId: pro.id, locationId: location.id })),
      });
    }
  });
  console.log(`+ ${t.slug} creado`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('El seed de desarrollo no se ejecuta en producción.');
  const db = createDb(config.DATABASE_URL);
  try {
    // Segunda barrera, por si se apunta a la BD real sin NODE_ENV=production: si ya hay negocios que no
    // son los del seed, no se crean usuarios con una contraseña conocida.
    const foreign = await db.tenant.count({ where: { slug: { notIn: SEED_TENANTS.map((t) => t.slug) } } });
    if (foreign > 0) throw new Error(`La base de datos tiene ${foreign} negocio(s) reales: el seed de desarrollo no se ejecuta aquí.`);
    for (const t of SEED_TENANTS) await seedTenant(db, t);
  } finally {
    await db.$disconnect();
  }
}

await main();
