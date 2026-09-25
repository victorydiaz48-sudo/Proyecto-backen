import { createServer, type Server } from 'node:http';
import type { Logger } from '@autocontent/shared';
import { webhookCallback, type Bot } from 'grammy';

export const WEBHOOK_PATH = '/telegram/webhook';

/**
 * HTTP surface of the bot service:
 *  - GET  /health            → liveness for Railway/Render health checks
 *  - POST /telegram/webhook  → Telegram updates (webhook mode only). grammY
 *    rejects requests whose X-Telegram-Bot-Api-Secret-Token header does not
 *    match TELEGRAM_WEBHOOK_SECRET.
 */
export function createHttpServer(opts: {
  bot: Bot;
  logger: Logger;
  mode: 'polling' | 'webhook';
  webhookSecret?: string;
  health: () => Record<string, unknown>;
}): Server {
  const handleUpdate =
    opts.mode === 'webhook'
      ? webhookCallback(opts.bot, 'http', { secretToken: opts.webhookSecret, onTimeout: 'return' })
      : null;

  return createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...opts.health() }));
      return;
    }
    if (handleUpdate && req.method === 'POST' && url === WEBHOOK_PATH) {
      handleUpdate(req, res).catch((err: unknown) => {
        opts.logger.error('webhook handling failed', { err });
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
  });
}
