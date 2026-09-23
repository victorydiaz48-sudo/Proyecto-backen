import 'dotenv/config';
import { createDb, pgErrorCode, type Db } from '../../src/db.ts';

export function createTestDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL');
  return createDb(url);
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
