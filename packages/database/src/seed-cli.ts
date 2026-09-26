// CLI entry for the idempotent seed: `pnpm --filter @autocontent/database seed`.
// Kept separate from seed.ts so bundling seed() into an app never runs it as a side effect.
import { createPrismaClient } from './client.js';
import { seed } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const prisma = createPrismaClient(url);
seed(prisma)
  .then((r) => console.log(JSON.stringify({ level: 'info', msg: 'seed complete', ...r })))
  .catch((err: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'seed failed', err: String(err) }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
