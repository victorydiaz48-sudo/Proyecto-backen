// Alta de un negocio por el operador de la plataforma.
//   npm run tenant:create -w apps/api -- --slug barbearia-central --name "Barbearia Central" \
//     --timezone America/Sao_Paulo --country 55 --currency BRL --locale pt-BR --admin-email dono@exemplo.com
// La contraseña del primer ADMIN se toma de TENANT_ADMIN_PASSWORD o se genera y se muestra una vez.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { createDb } from '../db.ts';
import { AppError } from '../lib/errors.ts';
import { generateTemporaryPassword } from '../lib/password.ts';
import { provisionTenant } from '../modules/tenants/provision.ts';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    timezone: { type: 'string' },
    country: { type: 'string' },
    currency: { type: 'string' },
    locale: { type: 'string' },
    location: { type: 'string' },
    'admin-email': { type: 'string' },
  },
});

const generated = !process.env.TENANT_ADMIN_PASSWORD;
const adminPassword = process.env.TENANT_ADMIN_PASSWORD ?? generateTemporaryPassword();
const db = createDb(loadConfig().DATABASE_URL);

try {
  const r = await provisionTenant(db, {
    slug: values.slug ?? '',
    name: values.name ?? '',
    timezone: values.timezone ?? '',
    defaultCountryCode: values.country ?? '',
    currency: values.currency ?? '',
    locale: values.locale ?? '',
    ...(values.location ? { locationName: values.location } : {}),
    adminEmail: values['admin-email'] ?? '',
    adminPassword,
  });
  console.log(`Negocio creado: ${r.tenant.slug} (${r.tenant.id})`);
  console.log(`ADMIN: ${r.admin.email}`);
  if (generated) console.log(`Contraseña inicial (cámbiala al entrar): ${adminPassword}`);
} catch (err) {
  if (err instanceof AppError) {
    console.error(`Error: ${err.message}`);
    const fields = (err.details?.fields ?? []) as { path: string; message: string }[];
    for (const f of fields) console.error(`  ${f.path}: ${f.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await db.$disconnect();
}
