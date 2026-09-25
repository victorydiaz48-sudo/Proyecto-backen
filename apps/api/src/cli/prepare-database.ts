// Paso previo a las migraciones en el despliegue (pre-deploy): crea o actualiza el usuario de la app
// (reservas_app) con la contraseña de DATABASE_URL. Después, `prisma migrate deploy`.
// Usa MIGRATION_DATABASE_URL (propietario del esquema) y DATABASE_URL (la de la app).
import 'dotenv/config';
import { APP_ROLE, ensureAppRole } from '../modules/ops/app-role.ts';

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;
if (!migrationUrl) {
  console.error('Falta MIGRATION_DATABASE_URL (propietario del esquema).');
  process.exit(1);
}
if (!databaseUrl) {
  console.error(`Falta DATABASE_URL (usuario ${APP_ROLE}).`);
  process.exit(1);
}
try {
  const result = await ensureAppRole(migrationUrl, databaseUrl);
  const messages = { created: 'creado', 'password-updated': 'contraseña actualizada', unchanged: 'ya estaba listo' };
  console.log(`Usuario ${APP_ROLE}: ${messages[result]}.`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
