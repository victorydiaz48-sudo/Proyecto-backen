import { createHash } from 'node:crypto';

/**
 * Stable UUID-formatted id derived from an idempotency key (e.g. a Telegram
 * chat+message pair). The same input always yields the same job id.
 */
export function deterministicJobId(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  // Shape as RFC 4122 v5-style: version nibble 5, variant bits 10xx.
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
