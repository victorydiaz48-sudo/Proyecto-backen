// Deja la BD de test vacía y con todas las migraciones aplicadas (igual que producción:
// `prisma migrate deploy`, nunca `db push`).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

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
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
