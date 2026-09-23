import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
