import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for API keys stored in the database (APIKeyReference with
 * source=DATABASE). AES-256-GCM with a random 96-bit IV per secret.
 *
 * Key rotation: ENCRYPTION_KEYS holds "version:base64key" pairs, comma
 * separated (e.g. "2:…,1:…"). New secrets use the highest version; old ones
 * stay readable until re-encrypted.
 *
 * The additional authenticated data binds a ciphertext to its owner
 * ("{dealershipId|platform}:{providerId}"): copying an encrypted key into
 * another dealership's row makes decryption fail.
 */

export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyVersion: number;
  /** The only part of the secret ever shown in the UI. */
  last4: string;
}

export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

export function parseEncryptionKeys(spec: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+):(.+)$/.exec(part);
    if (!m) throw new SecretBoxError('ENCRYPTION_KEYS entries must look like "1:<base64 key>"');
    const key = Buffer.from(m[2]!, 'base64');
    if (key.length !== 32) throw new SecretBoxError(`Encryption key version ${m[1]} must be 32 bytes (base64)`);
    keys.set(Number(m[1]), key);
  }
  if (keys.size === 0) throw new SecretBoxError('ENCRYPTION_KEYS is empty');
  return keys;
}

export function secretAad(dealershipId: string | null, providerId: string): string {
  return `${dealershipId ?? 'platform'}:${providerId}`;
}

export class SecretBox {
  private readonly currentVersion: number;

  constructor(private readonly keys: Map<number, Buffer>) {
    if (keys.size === 0) throw new SecretBoxError('No encryption keys');
    this.currentVersion = Math.max(...keys.keys());
  }

  encrypt(plaintext: string, aad: string): EncryptedSecret {
    if (!plaintext) throw new SecretBoxError('Refusing to encrypt an empty secret');
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: new Uint8Array(ciphertext),
      iv: new Uint8Array(iv),
      authTag: new Uint8Array(cipher.getAuthTag()),
      keyVersion: this.currentVersion,
      last4: plaintext.slice(-4),
    };
  }

  decrypt(secret: Omit<EncryptedSecret, 'last4'>, aad: string): string {
    const key = this.keys.get(secret.keyVersion);
    if (!key) throw new SecretBoxError(`Encryption key version ${secret.keyVersion} is not configured`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, secret.iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(secret.authTag);
      return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Never include key material or ciphertext in the error.
      throw new SecretBoxError('Secret could not be decrypted (wrong key, owner or tampered data)');
    }
  }

  needsRotation(keyVersion: number): boolean {
    return keyVersion !== this.currentVersion;
  }
}
