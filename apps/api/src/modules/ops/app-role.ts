import pg from 'pg';

/** Rol de la aplicación que crea la migración de RLS y al que da permisos. */
export const APP_ROLE = 'reservas_app';

export type AppRoleResult = 'created' | 'password-updated' | 'unchanged';

/**
 * Deja listo el usuario con el que se conecta la app, antes de migrar (pre-deploy): lo crea con LOGIN o
 * sincroniza su contraseña con la de DATABASE_URL. Así, en plataformas como Railway, no hay que ejecutar
 * SQL a mano. Se conecta como propietario (MIGRATION_DATABASE_URL).
 *
 * Nunca toca un rol privilegiado: si `reservas_app` fuese superusuario o tuviese BYPASSRLS, falla.
 */
export async function ensureAppRole(migrationUrl: string, databaseUrl: string): Promise<AppRoleResult> {
  const app = new URL(databaseUrl);
  const user = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  if (user !== APP_ROLE) {
    throw new Error(`DATABASE_URL debe usar el usuario ${APP_ROLE} (sujeto a Row-Level Security), no "${user}".`);
  }
  if (password.length < 16) {
    throw new Error(`La contraseña de ${APP_ROLE} en DATABASE_URL debe tener al menos 16 caracteres.`);
  }
  if (new URL(migrationUrl).username && decodeURIComponent(new URL(migrationUrl).username) === APP_ROLE) {
    throw new Error(`MIGRATION_DATABASE_URL debe ser el propietario del esquema, no ${APP_ROLE}.`);
  }

  // Si ya entra con esa contraseña, no hace falta tocar nada (ni permiso para crear roles).
  if (await canConnect(databaseUrl)) {
    await assertUnprivileged(migrationUrl);
    return 'unchanged';
  }

  const owner = new pg.Client({ connectionString: migrationUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [APP_ROLE],
    );
    const existing = rows[0];
    if (existing && (existing.rolsuper || existing.rolbypassrls)) {
      throw new Error(`El rol ${APP_ROLE} es superusuario o tiene BYPASSRLS: no se modifica. Revísalo a mano.`);
    }
    const role = owner.escapeIdentifier(APP_ROLE);
    const literal = owner.escapeLiteral(password);
    try {
      await owner.query(
        existing
          ? `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${literal}`
          : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${literal}`,
      );
    } catch (err) {
      throw new Error(
        `No se pudo ${existing ? 'actualizar' : 'crear'} el rol ${APP_ROLE} (${(err as Error).message}). ` +
          `Hazlo una vez como administrador: CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '…';`,
        { cause: err },
      );
    }
    return existing ? 'password-updated' : 'created';
  } finally {
    await owner.end();
  }
}

async function assertUnprivileged(migrationUrl: string): Promise<void> {
  const owner = new pg.Client({ connectionString: migrationUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ bad: boolean }>(
      'SELECT rolsuper OR rolbypassrls AS bad FROM pg_roles WHERE rolname = $1',
      [APP_ROLE],
    );
    if (rows[0]?.bad) throw new Error(`El rol ${APP_ROLE} es superusuario o tiene BYPASSRLS: RLS no le afectaría.`);
  } finally {
    await owner.end();
  }
}

async function canConnect(connectionString: string): Promise<boolean> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
