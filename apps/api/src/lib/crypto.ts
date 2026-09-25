import { createHash, randomBytes } from 'node:crypto';

/** Token opaco para cookies de sesión y enlaces (256 bits). */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** En BD solo se guarda el hash del token: una filtración de la BD no da sesiones válidas. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
