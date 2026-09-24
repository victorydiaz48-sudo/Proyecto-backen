// Preparación del usuario de la app en el despliegue (pre-deploy, antes de migrar): ensureAppRole.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { ensureAppRole } from '../src/modules/ops/app-role.ts';
import { testAppDatabaseUrl } from './helpers/db.ts';

const owner = process.env.TEST_DATABASE_URL!;
const appUrl = testAppDatabaseUrl();
const withPassword = (url: string, password: string) => {
  const u = new URL(url);
  u.password = password;
  return u.toString();
};

async function ownerIsSuperuser(): Promise<boolean> {
  const c = new pg.Client({ connectionString: owner });
  await c.connect();
  try {
    return (await c.query<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user')).rows[0]!.s;
  } finally {
    await c.end();
  }
}

const superuser = await ownerIsSuperuser();

describe('ensureAppRole', () => {
  it('rechaza una DATABASE_URL que no use reservas_app (p. ej. el propietario)', async () => {
    await expect(ensureAppRole(owner, owner)).rejects.toThrow(/debe usar el usuario reservas_app/);
  });

  it('rechaza contraseñas cortas y una MIGRATION_DATABASE_URL con reservas_app', async () => {
    await expect(ensureAppRole(owner, withPassword(appUrl, 'corta'))).rejects.toThrow(/al menos 16/);
    const longApp = withPassword(appUrl, 'una-contraseña-larga-de-prueba');
    await expect(ensureAppRole(longApp, longApp)).rejects.toThrow(/propietario del esquema/);
  });

  it.runIf(superuser)('con un propietario superusuario sincroniza la contraseña; si ya coincide, no toca nada', async () => {
    const original = new URL(appUrl).password;
    const nueva = 'contraseña-nueva-de-prueba-123';
    expect(await ensureAppRole(owner, withPassword(appUrl, nueva))).toBe('password-updated');
    const c = new pg.Client({ connectionString: withPassword(appUrl, nueva) });
    await c.connect();
    await c.end();
    expect(await ensureAppRole(owner, withPassword(appUrl, nueva))).toBe('unchanged');
    // Restaurar (el resto de tests usa la original); la función exige ≥ 16, así que se hace a mano.
    const admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    await admin.query(`ALTER ROLE reservas_app WITH PASSWORD ${admin.escapeLiteral(decodeURIComponent(original))}`);
    await admin.end();
  });

  it.runIf(!superuser)('si el propietario no puede crear/modificar roles, lo dice con la instrucción', async () => {
    await expect(ensureAppRole(owner, withPassword(appUrl, 'contraseña-que-no-es-la-buena'))).rejects.toThrow(
      /No se pudo actualizar el rol reservas_app.*CREATE ROLE reservas_app LOGIN/,
    );
  });
});
