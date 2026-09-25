import { PgErrorCode, pgErrorCode, type Db, type Tx } from '../../db.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { AppError, notFound, validationError } from '../../lib/errors.ts';
import { toE164 } from '../../lib/phone.ts';
import { toAuditJson, writeAudit, type Actor } from '../audit/audit.ts';
import { CUSTOMER_SELECT } from './schemas.ts';

export type CustomerDto = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export function normalizePhoneOrThrow(phone: string, defaultCountryCode: string, path: string): string {
  const e164 = toE164(phone, defaultCountryCode);
  if (!e164) throw validationError([{ path, message: 'Teléfono inválido.' }]);
  return e164;
}

/**
 * Busca el cliente del tenant con ese teléfono o lo crea. Seguro ante peticiones simultáneas y dentro
 * de una transacción (INSERT … ON CONFLICT DO NOTHING no aborta la transacción como lo haría un error
 * de unicidad). Un cliente existente conserva su nombre: una reserva anónima no puede renombrarlo.
 */
export async function findOrCreateCustomer(
  tx: Tx,
  tenantId: string,
  input: { name: string; phoneE164: string; email?: string | null },
): Promise<{ id: string; created: boolean }> {
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Customer" (id, "tenantId", name, "phoneE164", email, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${input.name}, ${input.phoneE164}, ${input.email ?? null}, now(), now())
    ON CONFLICT ("tenantId", "phoneE164") DO NOTHING
    RETURNING id`;
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const existing = await tx.customer.findUniqueOrThrow({
    where: { tenantId_phoneE164: { tenantId, phoneE164: input.phoneE164 } },
    select: { id: true, email: true },
  });
  if (!existing.email && input.email) await tx.customer.update({ where: { id: existing.id }, data: { email: input.email } });
  return { id: existing.id, created: false };
}

const duplicatePhone = (customerId?: string) =>
  new AppError(409, 'CONFLICT', 'Ya existe un cliente con ese teléfono.', customerId ? { customerId } : undefined);

/** Clientes de un tenant. Nunca se busca un cliente sin tenantId. */
export class CustomersService {
  constructor(private readonly db: Db) {}

  async list(
    tenantId: string,
    q: { search?: string | undefined; cursor?: string | undefined; limit: number },
    onlyProfessional?: string,
  ): Promise<{ items: CustomerDto[]; nextCursor: string | null }> {
    const and: Prisma.CustomerWhereInput[] = [{ tenantId }];
    if (onlyProfessional) and.push({ bookings: { some: { professionalId: onlyProfessional } } });
    if (q.search) {
      const digits = q.search.replace(/\D/g, '');
      and.push({
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
        ],
      });
    }
    const rows = await this.db.customer.findMany({
      where: { AND: and },
      select: CUSTOMER_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(tenantId: string, id: string, onlyProfessional?: string): Promise<CustomerDto> {
    const row = await this.db.customer.findFirst({
      where: { tenantId, id, ...(onlyProfessional ? { bookings: { some: { professionalId: onlyProfessional } } } : {}) },
      select: CUSTOMER_SELECT,
    });
    if (!row) throw notFound();
    return row;
  }

  async create(actor: Actor, input: { name: string; phone: string; email?: string | null | undefined; notes?: string | null | undefined }) {
    const phoneE164 = normalizePhoneOrThrow(input.phone, await this.countryCode(actor.tenantId), 'body.phone');
    const existing = await this.db.customer.findUnique({ where: { tenantId_phoneE164: { tenantId: actor.tenantId, phoneE164 } }, select: { id: true } });
    if (existing) throw duplicatePhone(existing.id);
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: { tenantId: actor.tenantId, name: input.name, phoneE164, email: input.email ?? null, notes: input.notes ?? null },
          select: CUSTOMER_SELECT,
        });
        await writeAudit(tx, { ...actor, action: 'customer.created', entityType: 'Customer', entityId: created.id, after: toAuditJson(created) });
        return created;
      });
    } catch (err) {
      if (pgErrorCode(err) === PgErrorCode.UNIQUE_VIOLATION) throw duplicatePhone();
      throw err;
    }
  }

  async update(
    actor: Actor,
    id: string,
    input: { name?: string; phone?: string; email?: string | null; notes?: string | null },
  ): Promise<CustomerDto> {
    const { phone, ...rest } = input;
    const data: Prisma.CustomerUncheckedUpdateInput = { ...rest };
    if (phone !== undefined) data.phoneE164 = normalizePhoneOrThrow(phone, await this.countryCode(actor.tenantId), 'body.phone');
    try {
      return await this.db.$transaction(async (tx) => {
        const before = await tx.customer.findFirst({ where: { tenantId: actor.tenantId, id }, select: CUSTOMER_SELECT });
        if (!before) throw notFound();
        const after = await tx.customer.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data, select: CUSTOMER_SELECT });
        await writeAudit(tx, { ...actor, action: 'customer.updated', entityType: 'Customer', entityId: id, before: toAuditJson(before), after: toAuditJson(after) });
        return after;
      });
    } catch (err) {
      if (pgErrorCode(err) === PgErrorCode.UNIQUE_VIOLATION) throw duplicatePhone();
      throw err;
    }
  }

  private async countryCode(tenantId: string): Promise<string> {
    return (await this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCountryCode: true } })).defaultCountryCode;
  }
}
