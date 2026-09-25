import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.ts';
import { verifyPassword } from '../src/lib/password.ts';
import { provisionTenant, type ProvisionTenantInput } from '../src/modules/tenants/provision.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';

const db = createTestDb();
beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$disconnect();
});

const input: ProvisionTenantInput = {
  slug: 'barbearia-central',
  name: 'Barbearia Central',
  timezone: 'America/Sao_Paulo',
  defaultCountryCode: '55',
  currency: 'brl',
  locale: 'pt-BR',
  adminEmail: 'Dono@Central.test',
  adminPassword: 'uma-senha-bem-longa',
};

async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('se esperaba un AppError');
}

describe('provisionTenant (CLI del operador)', () => {
  it('crea tenant, local por defecto y ADMIN con contraseña Argon2id, y lo audita', async () => {
    const r = await provisionTenant(db, input);
    expect(r.tenant).toMatchObject({ slug: 'barbearia-central', currency: 'BRL', defaultBookingStatus: 'CONFIRMED' });
    const locations = await db.location.findMany({ where: { tenantId: r.tenant.id } });
    expect(locations).toEqual([expect.objectContaining({ isDefault: true, name: 'Principal' })]);
    const admin = await db.user.findFirstOrThrow({ where: { tenantId: r.tenant.id } });
    expect(admin).toMatchObject({ email: 'dono@central.test', role: 'ADMIN' });
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(admin.passwordHash, input.adminPassword)).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'tenant.provisioned' } });
    expect(JSON.stringify(audit)).not.toContain(input.adminPassword);
  });

  it('rechaza slug duplicado (también en paralelo) sin dejar datos a medias', async () => {
    const results = await Promise.allSettled([provisionTenant(db, input), provisionTenant(db, input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected');
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect(await db.tenant.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
    expect(await db.location.count()).toBe(1);
  });

  it('valida slug, zona horaria y contraseña', async () => {
    expect((await rejects(provisionTenant(db, { ...input, slug: 'admin' }))).code).toBe('VALIDATION_ERROR');
    expect((await rejects(provisionTenant(db, { ...input, slug: 'Con Espacios' }))).code).toBe('VALIDATION_ERROR');
    expect((await rejects(provisionTenant(db, { ...input, timezone: 'Europe/Nowhere' }))).code).toBe('VALIDATION_ERROR');
    expect((await rejects(provisionTenant(db, { ...input, adminPassword: '1234567890' }))).code).toBe('VALIDATION_ERROR');
    expect(await db.tenant.count()).toBe(0);
  });
});
