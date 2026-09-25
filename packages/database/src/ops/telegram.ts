import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/client.js';
import type { Role } from '../generated/enums.js';
import { DEMO_DEALERSHIP_SLUG } from '../seed.js';

/**
 * Telegram access is invite-only. Two ways in:
 *  1. Bootstrap: the very first person opens t.me/<bot>?start=<BOOTSTRAP_CODE>
 *     and becomes OWNER of the demo dealership. Works once.
 *  2. Invites: an OWNER/ADMIN runs /invite and shares a one-time deep link.
 * Codes are shown once; only their SHA-256 is stored.
 */

export interface TelegramIdentity {
  telegramUserId: bigint;
  chatId: bigint;
  username?: string | null;
  firstName?: string | null;
}

export type LinkResult =
  | { status: 'linked'; dealershipId: string; role: Role; accountId: string }
  | { status: 'already_linked'; dealershipId: string }
  | { status: 'invalid' }
  | { status: 'already_claimed' };

export const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/** Telegram deep-link payloads allow 1-64 chars of A-Z a-z 0-9 _ - */
export const START_PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(hashCode(a));
  const y = Buffer.from(hashCode(b));
  return timingSafeEqual(x, y);
}

export async function findTelegramAccount(prisma: PrismaClient, telegramUserId: bigint) {
  return prisma.telegramAccount.findUnique({
    where: { telegramUserId },
    select: {
      id: true,
      dealershipId: true,
      role: true,
      status: true,
      localeOverride: true,
      userId: true,
      user: { select: { role: true, status: true } },
      dealership: { select: { status: true } },
    },
  });
}
export type TelegramAccountInfo = NonNullable<Awaited<ReturnType<typeof findTelegramAccount>>>;

/** Effective role: a linked dashboard user's role wins over the Telegram-only role. */
export function effectiveRole(a: Pick<TelegramAccountInfo, 'role' | 'user'>): Role {
  return a.user && a.user.status === 'ACTIVE' ? a.user.role : a.role;
}

async function lockDealership(tx: Prisma.TransactionClient, dealershipId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dealershipId}, 0))`;
}

async function audit(
  tx: Prisma.TransactionClient,
  dealershipId: string,
  accountId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      dealershipId,
      actorType: 'TELEGRAM',
      actorTelegramAccountId: accountId,
      action,
      entityType: 'TelegramAccount',
      entityId: accountId,
      metadata,
    },
  });
}

export async function claimBootstrap(
  prisma: PrismaClient,
  opts: { code: string; expectedCode: string | undefined; identity: TelegramIdentity; dealershipSlug?: string },
): Promise<LinkResult> {
  if (!opts.expectedCode || !safeEqual(opts.code, opts.expectedCode)) return { status: 'invalid' };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.telegramAccount.findUnique({ where: { telegramUserId: opts.identity.telegramUserId } });
    if (existing) return { status: 'already_linked', dealershipId: existing.dealershipId };

    const dealership = await tx.dealership.findUnique({ where: { slug: opts.dealershipSlug ?? DEMO_DEALERSHIP_SLUG } });
    if (!dealership) return { status: 'invalid' };
    await lockDealership(tx, dealership.id);

    const owners =
      (await tx.telegramAccount.count({ where: { dealershipId: dealership.id, role: 'OWNER' } })) +
      (await tx.user.count({ where: { dealershipId: dealership.id, role: 'OWNER', status: 'ACTIVE' } }));
    if (owners > 0) return { status: 'already_claimed' };

    const account = await tx.telegramAccount.create({
      data: {
        dealershipId: dealership.id,
        telegramUserId: opts.identity.telegramUserId,
        chatId: opts.identity.chatId,
        username: opts.identity.username ?? null,
        firstName: opts.identity.firstName ?? null,
        role: 'OWNER',
      },
    });
    await audit(tx, dealership.id, account.id, 'telegram.bootstrap_claimed', {});
    return { status: 'linked', dealershipId: dealership.id, role: 'OWNER', accountId: account.id };
  });
}

/** Who may invite whom. Nobody can mint another OWNER through Telegram. */
export function canInvite(inviter: Role, target: Role): boolean {
  if (target === 'OWNER') return false;
  if (inviter === 'OWNER') return true;
  if (inviter === 'ADMIN') return target === 'EDITOR' || target === 'OPERATOR';
  return false;
}

export async function createTelegramInvite(
  prisma: PrismaClient,
  opts: {
    dealershipId: string;
    inviterRole: Role;
    inviterAccountId: string;
    role: Role;
    maxUses?: number;
    expiresInHours?: number;
    now?: Date;
  },
): Promise<{ code: string; expiresAt: Date } | { error: 'forbidden' }> {
  if (!canInvite(opts.inviterRole, opts.role)) return { error: 'forbidden' };
  const code = randomBytes(18).toString('base64url'); // 24 chars, valid start payload
  const expiresAt = new Date((opts.now ?? new Date()).getTime() + (opts.expiresInHours ?? 72) * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.telegramInvite.create({
      data: {
        dealershipId: opts.dealershipId,
        codeHash: hashCode(code),
        role: opts.role,
        maxUses: opts.maxUses ?? 1,
        expiresAt,
      },
    });
    await audit(tx, opts.dealershipId, opts.inviterAccountId, 'telegram.invite_created', { role: opts.role });
  });
  return { code, expiresAt };
}

export async function redeemTelegramInvite(
  prisma: PrismaClient,
  opts: { code: string; identity: TelegramIdentity; now?: Date },
): Promise<LinkResult> {
  const now = opts.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.telegramAccount.findUnique({ where: { telegramUserId: opts.identity.telegramUserId } });
    if (existing) return { status: 'already_linked', dealershipId: existing.dealershipId };

    // Atomic consume: concurrent redemptions can never exceed maxUses.
    const rows = await tx.$queryRaw<{ dealershipId: string; role: Role }[]>`
      UPDATE "TelegramInvite" SET "uses" = "uses" + 1
      WHERE "codeHash" = ${hashCode(opts.code)} AND "uses" < "maxUses" AND "expiresAt" > ${now}
      RETURNING "dealershipId"::text AS "dealershipId", "role"::text AS "role"`;
    const invite = rows[0];
    if (!invite) return { status: 'invalid' };

    const account = await tx.telegramAccount.create({
      data: {
        dealershipId: invite.dealershipId,
        telegramUserId: opts.identity.telegramUserId,
        chatId: opts.identity.chatId,
        username: opts.identity.username ?? null,
        firstName: opts.identity.firstName ?? null,
        role: invite.role,
      },
    });
    await audit(tx, invite.dealershipId, account.id, 'telegram.invite_redeemed', { role: invite.role });
    return { status: 'linked', dealershipId: invite.dealershipId, role: invite.role, accountId: account.id };
  });
}
