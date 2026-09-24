// Deja la BD de test vacía y con todas las migraciones aplicadas (igual que producción:
// `prisma migrate deploy`, nunca `db push`).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { testAppDatabaseUrl } from './db.ts';

export async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL (ver apps/api/.env.example).');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL no puede ser la misma BD que DATABASE_URL.');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
    stdio: 'pipe',
  });

  // La app en los tests se conecta como en producción: con el rol reservas_app (sujeto a RLS).
  const appUrl = testAppDatabaseUrl();
  if (!(await canConnect(appUrl))) {
    // Primera vez: se le da login con la contraseña de la URL (requiere un usuario con CREATEROLE).
    const app = new URL(appUrl);
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      const password = decodeURIComponent(app.password).replaceAll("'", "''");
      await admin.query(`ALTER ROLE ${pg.escapeIdentifier(decodeURIComponent(app.username))} WITH LOGIN PASSWORD '${password}'`);
    } catch (err) {
      throw new Error(
        `No se puede entrar como ${app.username} ni activarlo (${(err as Error).message}). ` +
          `Como administrador: CREATE ROLE reservas_app LOGIN PASSWORD 'reservas_app'; o define TEST_APP_DATABASE_URL.`,
        { cause: err },
      );
    } finally {
      await admin.end();
    }
  }
}

async function canConnect(connectionString: string): Promise<boolean> {
  const c = new pg.Client({ connectionString });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
