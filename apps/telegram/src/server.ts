import { createServer, type Server } from 'node:http';
import type { Logger } from '@autocontent/shared';
import { webhookCallback, type Bot } from 'grammy';

export const WEBHOOK_PATH = '/telegram/webhook';

export interface HealthReport {
  /** 'ok' = everything required works; 'degraded' = running but something needs attention. */
  status: 'ok' | 'degraded';
  /** false → /ready answers 503 (e.g. database unreachable). */
  ready: boolean;
  [key: string]: unknown;
}

/**
 * HTTP surface of the service:
 *  - GET  /health            → status of every dependency (always 200, for dashboards)
 *  - GET  /ready             → 200 when the service can do work, 503 otherwise
 *  - POST /telegram/webhook  → Telegram updates (webhook mode only). grammY
 *    rejects requests whose X-Telegram-Bot-Api-Secret-Token header does not
 *    match TELEGRAM_WEBHOOK_SECRET.
 */
export function createHttpServer(opts: {
  bot?: Bot;
  logger: Logger;
  mode: 'polling' | 'webhook';
  webhookSecret?: string;
  health: () => Promise<HealthReport> | HealthReport;
}): Server {
  const handleUpdate =
    opts.bot && opts.mode === 'webhook'
      ? webhookCallback(opts.bot, 'http', { secretToken: opts.webhookSecret, onTimeout: 'return' })
      : null;

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  return createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/' || url === '/ready')) {
      Promise.resolve(opts.health())
        .then((h) => {
          const { ready, ...body } = h;
          json(res, url === '/ready' && !ready ? 503 : 200, body);
        })
        .catch((err: unknown) => {
          opts.logger.error('health check failed', { err });
          json(res, url === '/ready' ? 503 : 200, { status: 'degraded' });
        });
      return;
    }
    if (handleUpdate && req.method === 'POST' && url === WEBHOOK_PATH) {
      handleUpdate(req, res).catch((err: unknown) => {
        opts.logger.error('webhook handling failed', { err });
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });
}
