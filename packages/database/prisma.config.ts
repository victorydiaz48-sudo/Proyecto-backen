import { defineConfig } from 'prisma/config';

// DATABASE_URL is only needed for commands that talk to the database
// (migrate, seed). `prisma generate` works without it.
export default defineConfig({
  // A folder, not a single file: Prisma 7.10 merges every `.prisma` file in
  // it (native multi-file support, confirmed by spike in Phase 3a) — this is
  // how packages/database/prisma/dealership.prisma (synced from the
  // dealership module by sync-vertical-schemas.ts) gets picked up.
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed-cli.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@localhost:5432/invalid',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
