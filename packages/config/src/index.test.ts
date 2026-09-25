import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index.js';

const TOKEN = '123456789:AAEhBP0av28mLr6s7m4k0Q_Bk1vM2m3n4o5';

describe('loadConfig', () => {
  it('defaults to MOCK_MODE, polling and Spanish', () => {
    const c = loadConfig({});
    expect(c.MOCK_MODE).toBe(true);
    expect(c.TELEGRAM_MODE).toBe('polling');
    expect(c.DEFAULT_LOCALE).toBe('es');
  });

  it('treats blank values as unset', () => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: '  ', MOCK_MODE: '' }).TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it('parses booleans', () => {
    expect(loadConfig({ MOCK_MODE: 'false' }).MOCK_MODE).toBe(false);
  });

  it('requires webhook URL and secret in webhook mode', () => {
    expect(() => loadConfig({ TELEGRAM_MODE: 'webhook', TELEGRAM_BOT_TOKEN: TOKEN })).toThrow(/TELEGRAM_WEBHOOK_URL/);
    expect(
      loadConfig({
        TELEGRAM_MODE: 'webhook',
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_WEBHOOK_URL: 'https://bot.example.com',
        TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
      }).TELEGRAM_MODE,
    ).toBe('webhook');
  });

  it('never echoes secret values in errors', () => {
    const bad = 'not-a-token-SECRET123';
    try {
      loadConfig({ TELEGRAM_BOT_TOKEN: bad });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain('TELEGRAM_BOT_TOKEN');
      expect((e as Error).message).not.toContain(bad);
    }
  });

  it('validates infrastructure URLs and encryption keys without echoing them', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/db' }).DATABASE_URL).toContain('postgresql://');
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:SECRETPW@h/db' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://u:SECRETPW@h/db' })).not.toThrow(/SECRETPW/);
    expect(() => loadConfig({ REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({ ENCRYPTION_KEYS: `1:${key}` }).ENCRYPTION_KEYS).toBe(`1:${key}`);
    expect(() => loadConfig({ ENCRYPTION_KEYS: 'short' })).toThrow(/ENCRYPTION_KEYS/);
    expect(loadConfig({}).JOB_MAX_RETRIES).toBe(3);
  });
});
