import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox, SecretBoxError, parseEncryptionKeys, secretAad } from './crypto.js';
import { providerConfigSchema } from './json.js';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

describe('SecretBox', () => {
  const box = new SecretBox(parseEncryptionKeys(`1:${k1}`));
  const aad = secretAad('dealer-a', 'provider-1');

  it('round-trips and exposes only the last 4 characters', () => {
    const enc = box.encrypt('blt_live_1234567890abcd', aad);
    expect(enc.last4).toBe('abcd');
    expect(Buffer.from(enc.ciphertext).toString('utf8')).not.toContain('blt_live');
    expect(box.decrypt(enc, aad)).toBe('blt_live_1234567890abcd');
  });

  it('uses a fresh IV every time', () => {
    const a = box.encrypt('same-secret', aad);
    const b = box.encrypt('same-secret', aad);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
  });

  it('refuses a ciphertext copied to another organization or tampered with', () => {
    const enc = box.encrypt('secret-value', aad);
    expect(() => box.decrypt(enc, secretAad('dealer-b', 'provider-1'))).toThrow(SecretBoxError);
    const tampered = { ...enc, ciphertext: Uint8Array.from(enc.ciphertext, (x, i) => (i === 0 ? x ^ 1 : x)) };
    expect(() => box.decrypt(tampered, aad)).toThrow(SecretBoxError);
  });

  it('supports key rotation', () => {
    const old = box.encrypt('rotate-me', aad);
    const rotated = new SecretBox(parseEncryptionKeys(`2:${k2},1:${k1}`));
    expect(rotated.decrypt(old, aad)).toBe('rotate-me');
    expect(rotated.needsRotation(old.keyVersion)).toBe(true);
    expect(rotated.encrypt('new', aad).keyVersion).toBe(2);
  });

  it('validates key configuration without echoing keys', () => {
    expect(() => parseEncryptionKeys('1:dG9vLXNob3J0')).toThrow(/32 bytes/);
    expect(() => parseEncryptionKeys('nonsense')).toThrow(SecretBoxError);
  });
});

describe('providerConfigSchema', () => {
  it('rejects secrets in non-secret provider config', () => {
    expect(providerConfigSchema.safeParse({ model: 'x', baseUrl: 'https://api' }).success).toBe(true);
    expect(providerConfigSchema.safeParse({ apiKey: 'sk-123' }).success).toBe(false);
  });
});
