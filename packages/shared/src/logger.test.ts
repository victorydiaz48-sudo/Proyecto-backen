import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('logger', () => {
  it('writes one JSON object per line with bindings and redacts secrets', () => {
    const lines: string[] = [];
    const token = '123456:SECRET_TOKEN_VALUE';
    const log = createLogger({ sink: (l) => lines.push(l), redact: [token] }).child({ jobId: 'j1' });
    log.error('failed', { err: new Error(`GET https://api.telegram.org/bot${token}/getFile`) });
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: 'error', msg: 'failed', jobId: 'j1' });
    expect(lines[0]).not.toContain('SECRET_TOKEN_VALUE');
    expect(lines[0]).toContain('[REDACTED]');
  });

  it('filters by level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
    log.info('hidden');
    log.warn('shown');
    expect(lines).toHaveLength(1);
  });
});
