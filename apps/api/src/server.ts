import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { LogTransport } from './modules/notifications/transport.ts';
import { startNotificationWorker } from './modules/notifications/worker.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({ config, db });
const stopWorker = config.NOTIFICATIONS_WORKER ? startNotificationWorker(db, new LogTransport(app.log), app.log) : () => {};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  stopWorker();
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
