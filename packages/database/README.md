# @autocontent/database

PostgreSQL schema (Prisma 7), migrations, seed data and the tenant-scoped
data-access layer.

## Rules for anyone changing the database

1. **Tenant code uses `forDealership(prisma, dealershipId)`, never the raw
   client.** Reads/updates/deletes are filtered by `dealershipId` automatically;
   creates must pass `dealershipId: db.$dealershipId` and anything else throws.
   The raw client is for platform code only (seed, provider catalogue, admin
   jobs).
2. **Never drop a `tenant_*` constraint.** The init migration adds composite
   `(childId, dealershipId)` foreign keys, partial unique indexes and CHECKs
   that Prisma's schema language cannot express. Because Prisma doesn't know
   about them, `prisma migrate dev` will put `DROP CONSTRAINT "tenant_…"`
   statements into every new migration it generates — **delete those lines**
   before committing. `migrations.test.ts` fails the build if you forget, and
   the live-database test checks every constraint still exists.
3. **New tenant table?** Give it a required `dealershipId`, a
   `@@unique([id, dealershipId])`, add it to `TENANT_MODELS` in `tenant.ts`
   (a test checks this), and add composite foreign keys for its relations in
   the migration SQL (name them `tenant_<Table>_<relation>`, and list them in
   `migrations.test.ts`).
4. **Json columns are validated** with the schemas in `json.ts` /
   `settings.ts` before they are written.
5. **Money is micro-USD in `BigInt` columns.** Never floats.
6. Requires **PostgreSQL 15+** (`ON DELETE SET NULL (column)`).

## Commands

These run automatically in CI and (from Phase 2) on deploy; you only need them
with a local terminal.

```bash
pnpm --filter @autocontent/database generate         # Prisma client (also runs on install)
DATABASE_URL=… pnpm --filter @autocontent/database migrate:deploy
DATABASE_URL=… pnpm --filter @autocontent/database seed   # idempotent
DATABASE_URL=… pnpm --filter @autocontent/database migrate:dev --name <change> --create-only
```

Database tests run when `TEST_DATABASE_URL` points at a migrated database
(CI sets it, plus `REQUIRE_DB_TESTS=1` so they can never be skipped silently).
