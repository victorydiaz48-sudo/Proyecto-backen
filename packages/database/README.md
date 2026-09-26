# @autocontent/database

PostgreSQL schema (Prisma 7), migrations, seed data and the tenant-scoped
data-access layer.

## Rules for anyone changing the database

1. **Tenant code uses `forOrganization(prisma, organizationId)`, never the raw
   client.** Reads/updates/deletes are filtered by `organizationId` automatically;
   creates must pass `organizationId: db.$organizationId` and anything else throws.
   The raw client is for platform code only (seed, provider catalogue, admin
   jobs).
2. **Never drop a `tenant_*` constraint.** The init migration adds composite
   `(childId, organizationId)` foreign keys, partial unique indexes and CHECKs
   that Prisma's schema language cannot express. Because Prisma doesn't know
   about them, `prisma migrate dev` will put `DROP CONSTRAINT "tenant_…"`
   statements into every new migration it generates — **delete those lines**
   (and `DROP INDEX "APIKeyReference_id_organizationId_key"`) before committing.
   `migrations.test.ts` fails the build if you forget, and the live-database
   test checks every constraint still exists. Example: migration
   `…_content_job_telegram_source` keeps only its `ADD COLUMN` lines.
3. **New tenant table?** Give it a required `organizationId`, a
   `@@unique([id, organizationId])`, add it to `TENANT_MODELS` in `tenant.ts`
   (a test checks this), and add composite foreign keys for its relations in
   the migration SQL (name them `tenant_<Table>_<relation>`, and list them in
   `migrations.test.ts`).
4. **Json columns are validated** with the schemas in `json.ts` /
   `settings.ts` before they are written.
5. **Money is micro-USD in `BigInt` columns.** Never floats.
6. Requires **PostgreSQL 15+** (`ON DELETE SET NULL (column)`).
7. **Renaming a table/column/type on a database with data?** `prisma migrate
   dev` diffs schemas structurally and will propose `DROP`+`CREATE` for a
   rename it can't detect as one — never apply that. Instead, hand-write the
   migration as `ALTER TABLE/TYPE/INDEX … RENAME …` statements (zero data
   loss, trivially reversible), then verify it against a disposable clone of
   a real database:
   ```bash
   createdb -T <existing_db> -O app <clone>
   psql postgresql://app:app@localhost:5432/<clone> -f your_migration.sql
   SHADOW_DATABASE_URL=postgresql://app:app@localhost:5432/<shadow> \
     DATABASE_URL=postgresql://app:app@localhost:5432/<clone> \
     pnpm --filter @autocontent/database exec prisma migrate diff \
       --from-config-datasource --to-schema prisma --script
   ```
   An empty diff (or only the already-known `tenant_*`/`APIKeyReference_id_…_key`
   noise from rule 2) means the rename is exactly right. `prisma.config.ts`'s
   `shadowDatabaseUrl` only needs `SHADOW_DATABASE_URL` set when you run this;
   it's unused otherwise. See migration `…_rename_dealership_to_organization`
   for a worked example (Phase 3a). The same clone-and-diff recipe applies to
   a genuine structural drop too (unlike a rename, Prisma's own proposed SQL
   *is* trustworthy there) — see `…_drop_vehicle_id_complete_subject_reference`
   (Phase 3c) for a worked example, including the one sanctioned exception to
   rule 2: that migration explicitly drops `tenant_ContentJob_vehicle`,
   `tenant_ContentAsset_vehicle` and `tenant_VideoPlan_vehicle`, since the
   `vehicleId` column they guarded no longer exists. `migrations.test.ts`
   allows only those three names to be dropped, by name.
8. **A vertical module owns its own tables.** `prisma.config.ts`'s `schema`
   points at the `prisma/` *folder*, not a single file — Prisma 7.10 natively
   merges every `.prisma` file in it. A module keeps its own schema fragment
   under its own package (e.g.
   `packages/verticals/dealership/prisma/schema.prisma`); `pnpm run
   sync-verticals` (wired into `generate`/`migrate:dev`/`migrate:deploy`/
   `postinstall`) copies each one into `prisma/<slug>.prisma` here — never
   hand-edit the copy, and never commit it (`.gitignore`d). This package
   never imports a concrete vertical module (only the filesystem walk in
   `scripts/sync-vertical-schemas.ts` knows the `verticals/` folder exists) —
   see `ARCHITECTURE.md`'s "Vertical modules" section.

## Commands

These run automatically: in CI, and on every deploy (`apps/server/docker/start.sh`
runs `prisma migrate deploy` before the app starts; the app runs the
idempotent seed at startup). You only need them with a local terminal.

```bash
pnpm --filter @autocontent/database generate         # Prisma client (also runs on install)
DATABASE_URL=… pnpm --filter @autocontent/database migrate:deploy
DATABASE_URL=… pnpm --filter @autocontent/database seed   # idempotent
DATABASE_URL=… pnpm --filter @autocontent/database migrate:dev --name <change> --create-only
```

Database tests run when `TEST_DATABASE_URL` points at a migrated database
(CI sets it, plus `REQUIRE_DB_TESTS=1` so they can never be skipped silently).
