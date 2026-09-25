// Importa en el backend el JSON exportado por el generador de páginas ("Exportar datos").
//   npm run import:generator -w apps/api -- --file datos-barbearia.json --slug barbearia-central \
//     --admin-email dono@exemplo.com [--duration 30] [--currency BRL] [--dry-run]
// Sin --dry-run crea el negocio (si no existe) con sus locales, servicios, profesionales y horarios.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { generateTemporaryPassword } from '../lib/password.ts';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { createDb } from '../db.ts';
import { AppError } from '../lib/errors.ts';
import { applyImport } from '../modules/importer/apply.ts';
import { planImport } from '../modules/importer/generator-json.ts';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    slug: { type: 'string' },
    'admin-email': { type: 'string' },
    duration: { type: 'string', default: '30' },
    currency: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.file || !values.slug) {
  console.error('Uso: --file <datos.json> --slug <identificador> [--admin-email <email>] [--duration 30] [--currency BRL] [--dry-run]');
  process.exit(1);
}
const duration = Number(values.duration);
if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
  console.error('--duration debe ser un número de minutos entre 5 y 600.');
  process.exit(1);
}

const plan = planImport(JSON.parse(readFileSync(values.file, 'utf8').replace(/^\uFEFF/, '')), { durationMinutes: duration, currency: values.currency });
console.log(`Negocio: ${plan.tenant.name} (${plan.tenant.timezone}, ${plan.tenant.currency}, ${plan.tenant.locale})`);
console.log(`Locales: ${plan.locations.map((l) => l.name).join(', ')}`);
console.log(`Servicios: ${plan.services.length} · Profesionales: ${plan.professionals.length}`);
for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
if (values['dry-run']) {
  console.log('Simulación (--dry-run): no se ha guardado nada.');
  process.exit(0);
}

const db = createDb(loadConfig().DATABASE_URL);
try {
  const r = await applyImport(db, plan, {
    slug: values.slug,
    adminEmail: values['admin-email'],
    adminPassword: process.env.TENANT_ADMIN_PASSWORD ?? generateTemporaryPassword(),
    now: () => new Date(),
  });
  console.log(`Importado en "${values.slug}"${r.created ? ' (negocio nuevo)' : ''}: ${JSON.stringify(r.counts)}`);
  if (r.temporaryPassword && !process.env.TENANT_ADMIN_PASSWORD) console.log(`Contraseña inicial del ADMIN (cámbiala al entrar): ${r.temporaryPassword}`);
} catch (err) {
  if (err instanceof AppError) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } else throw err;
} finally {
  await db.$disconnect();
}
