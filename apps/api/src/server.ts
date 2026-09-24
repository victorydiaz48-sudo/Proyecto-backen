import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, rlsBypassReason } from './db.ts';
import { LogTransport } from './modules/notifications/transport.ts';
import { startNotificationWorker } from './modules/notifications/worker.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({ config, db });

// Row-Level Security solo protege si la app NO se conecta como propietario/superusuario.
const bypass = await rlsBypassReason(db);
if (bypass) {
  if (config.NODE_ENV === 'production') {
    app.log.fatal({ reason: bypass }, 'DATABASE_URL debe usar el rol reservas_app (sujeto a RLS); no se arranca');
    await db.$disconnect();
    process.exit(1);
  }
  app.log.warn({ reason: bypass }, 'la conexión no está sujeta a Row-Level Security (solo se permite fuera de producción)');
}
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
