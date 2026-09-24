import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, rlsBypassReason } from './db.ts';
import { ChannelTransport, createTelegramBot, startTelegramLinker, TelegramTransport } from './modules/notifications/telegram.ts';
import { LogTransport } from './modules/notifications/transport.ts';
import { startNotificationWorker } from './modules/notifications/worker.ts';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  // Error de configuración: solo el mensaje (sin traza), que dice qué variable corregir.
  console.error((err as Error).message);
  process.exit(1);
}
const db = createDb(config.DATABASE_URL);
const telegram = createTelegramBot(config);
const app = await buildApp({ config, db, telegram });

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
// WhatsApp: se registra y se envía a mano desde el panel (opción C). Telegram: se envía de verdad.
const logTransport = new LogTransport(app.log);
const transport = new ChannelTransport(telegram ? { telegram: new TelegramTransport(telegram) } : {}, logTransport);
const stopWorker = config.NOTIFICATIONS_WORKER ? startNotificationWorker(db, transport, app.log) : () => {};
// Recepción de las conexiones de chats (/start del enlace): solo en la instancia del worker.
const stopTelegram = config.NOTIFICATIONS_WORKER && telegram ? startTelegramLinker(db, telegram, app.log) : async () => {};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  stopWorker();
  await stopTelegram();
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
