import { hash, verify } from '@node-rs/argon2';

// Parámetros mínimos recomendados por OWASP para Argon2id (19 MiB, 2 iteraciones, 1 hilo).
// `algorithm: 2` = Algorithm.Argon2id (const enum ambiental, no importable con verbatimModuleSyntax).
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  '1234567890', '12345678910', '0123456789', 'qwertyuiop', 'password123', 'password1234', 'senha12345',
  'contraseña', 'contrasena1', 'iloveyou12', 'abcdefghij', 'aaaaaaaaaa', '1111111111', 'barbearia1', 'barberia123',
]);

/** Devuelve el motivo por el que la contraseña no es aceptable, o null si lo es. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `Debe tener como máximo ${PASSWORD_MAX} caracteres.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'Es demasiado común.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'No puede contener tu email.';
  return null;
}

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hash de una contraseña aleatoria: se verifica contra él cuando el usuario no existe, para que el
// tiempo de respuesta no revele qué emails están registrados.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash(`dummy-${Math.random()}`, OPTIONS);
  await verifyPassword(await dummyHash, password);
}
