import type { AddressInfo } from 'node:net';
import { silentLogger } from '@autocontent/shared';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_PATH, createHttpServer } from './server.js';

const SECRET = 'webhook_secret_1234567890';
const bot = new Bot('123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz', {
  botInfo: { id: 1, is_bot: true, first_name: 'T', username: 't_bot' } as UserFromGetMe,
});
const received: number[] = [];
bot.use((ctx) => {
  received.push(ctx.update.update_id);
});

const server = createHttpServer({
  bot,
  logger: silentLogger,
  mode: 'webhook',
  webhookSecret: SECRET,
  health: () => ({ mockMode: true }),
});
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (headers: Record<string, string>) =>
  fetch(base + WEBHOOK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ update_id: 99 }),
  });

describe('http server', () => {
  it('serves /health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', mockMode: true });
  });

  it('rejects webhook calls without the secret token', async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ 'x-telegram-bot-api-secret-token': 'wrong' })).status).toBe(401);
    expect(received).toEqual([]);
  });

  it('accepts webhook calls with the secret token', async () => {
    expect((await post({ 'x-telegram-bot-api-secret-token': SECRET })).status).toBe(200);
    expect(received).toEqual([99]);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
