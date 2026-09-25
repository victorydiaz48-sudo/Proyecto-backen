import 'dotenv/config';
import { createDb, createOwnerDb, pgErrorCode, type Db } from '../../src/db.ts';

/**
 * Cliente del PROPIETARIO de la BD de test (no sujeto a RLS): para preparar datos de varios negocios y
 * comprobar resultados. La app bajo prueba usa `createTestAppDb()` (rol reservas_app, con RLS).
 */
export function createTestDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL');
  return createOwnerDb(url);
}

/** URL de la BD de test con el rol de la aplicación (TEST_APP_DATABASE_URL o la de test con reservas_app). */
export function testAppDatabaseUrl(): string {
  if (process.env.TEST_APP_DATABASE_URL) return process.env.TEST_APP_DATABASE_URL;
  const url = new URL(process.env.TEST_DATABASE_URL ?? '');
  url.username = 'reservas_app';
  url.password = 'reservas_app';
  return url.toString();
}

/** Cliente con el rol de la aplicación y RLS, como en producción. */
export function createTestAppDb(): Db {
  return createDb(testAppDatabaseUrl());
}

/** Vacía todas las tablas de negocio (conserva el esquema y las migraciones). */
export async function truncateAll(db: Db): Promise<void> {
  await db.$executeRaw`
    TRUNCATE "IdempotencyKey", "NotificationOutbox", "AuditLog", "Booking", "Customer", "TimeBlock",
      "WorkingHour", "ProfessionalService", "Service", "Professional", "Session", "User", "Location", "Tenant"
    RESTART IDENTITY CASCADE`;
}

/** Ejecuta la promesa y devuelve el SQLSTATE con el que falló (o lanza si no falló). */
export async function expectPgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return pgErrorCode(err);
  }
  throw new Error('Se esperaba un error de PostgreSQL y la operación tuvo éxito');
}
