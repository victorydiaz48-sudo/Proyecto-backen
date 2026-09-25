import { defineConfig } from 'prisma/config';

// DATABASE_URL is only needed for commands that talk to the database
// (migrate, seed). `prisma generate` works without it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@localhost:5432/invalid',
  },
});
