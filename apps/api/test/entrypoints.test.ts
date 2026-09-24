// Puntos de entrada reales (Fase 14): el servidor arranca, responde y se detiene limpio; los scripts de
// operador (alta de negocio, importador) funcionan desde la línea de comandos contra la BD de test.
import { execFile, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, testAppDatabaseUrl, truncateAll } from './helpers/db.ts';
import { loadGenerator } from './generator/load.ts';

const run = promisify(execFile);
const db = createTestDb();
const cwd = join(import.meta.dirname, '..');
// Los procesos se conectan como en producción: con el rol de la aplicación (sujeto a RLS).
const env = { ...process.env, DATABASE_URL: testAppDatabaseUrl(), LOG_LEVEL: 'silent', NOTIFICATIONS_WORKER: 'false' };
const tsx = (script: string, args: string[], extraEnv: Record<string, string> = {}) =>
  run('npx', ['tsx', script, ...args], { cwd, env: { ...env, ...extraEnv } }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
  );

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('servidor', () => {
  it('arranca, responde en /healthz y /readyz, y se detiene limpio con SIGTERM', async () => {
    const port = 39_000 + Math.floor(Math.random() * 1000);
    // Node directo (no npx): la señal llega al proceso del servidor, que debe cerrar y salir con 0.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd, env: { ...env, PORT: String(port), HOST: '127.0.0.1', NOTIFICATIONS_WORKER: 'true' } });
    try {
      let health: Response | null = null;
      for (let i = 0; i < 60 && !health; i++) {
        await new Promise((r) => setTimeout(r, 250));
        health = await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => null);
      }
      expect(health?.status).toBe(200);
      expect(await (await fetch(`http://127.0.0.1:${port}/readyz`)).json()).toEqual({ status: 'ok' });
      const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 30_000);

  it('en producción se niega a arrancar si DATABASE_URL no está sujeta a RLS (propietario)', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd,
      env: { ...env, DATABASE_URL: process.env.TEST_DATABASE_URL!, NODE_ENV: 'production', LOG_LEVEL: 'fatal', PORT: String(40_000 + Math.floor(Math.random() * 1000)), HOST: '127.0.0.1' },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(1);
    expect(out).toContain('reservas_app');
  }, 30_000);
});

describe('scripts del operador', () => {
  it('seed de desarrollo: crea A y B, y se niega en producción o en una BD con negocios reales', async () => {
    const prod = await tsx('prisma/seed.ts', [], { NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    expect(prod.code).toBe(1);
    expect(await db.tenant.count()).toBe(0);

    await db.tenant.create({ data: { slug: 'negocio-real', name: 'Real', timezone: 'Europe/Madrid', defaultCountryCode: '34', currency: 'EUR', locale: 'es-ES' } });
    const foreign = await tsx('prisma/seed.ts', []);
    expect(foreign.code).toBe(1);
    expect(foreign.out).toContain('negocio(s) reales');
    expect(await db.user.count()).toBe(0);

    await truncateAll(db);
    const ok = await tsx('prisma/seed.ts', []);
    expect(ok.code).toBe(0);
    expect(await db.tenant.count()).toBe(2);
    expect((await tsx('prisma/seed.ts', [])).code).toBe(0); // idempotente
  }, 60_000);

  it('tenant:create crea el negocio y rechaza datos inválidos con código de salida 1', async () => {
    const ok = await tsx('src/cli/tenant-create.ts', ['--slug', 'cli-negocio', '--name', 'CLI', '--timezone', 'America/Sao_Paulo', '--country', '55', '--currency', 'BRL', '--locale', 'pt-BR', '--admin-email', 'dono@cli.test'], { TENANT_ADMIN_PASSWORD: 'clave-cli-segura-1' });
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('Negocio creado: cli-negocio');
    expect(ok.out).not.toContain('clave-cli-segura-1');
    expect(await db.user.count({ where: { email: 'dono@cli.test' } })).toBe(1);

    const bad = await tsx('src/cli/tenant-create.ts', ['--slug', 'admin', '--name', 'X', '--timezone', 'Nope', '--country', '55', '--currency', 'BRL', '--locale', 'pt-BR', '--admin-email', 'x']);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/slug: .*reservado/);
    expect(await db.tenant.count()).toBe(1);
  }, 60_000);

  it('import:generator: simulación sin guardar, importación real y negativa a sobrescribir', async () => {
    const lib = loadGenerator();
    const file = join(tmpdir(), `datos-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ app: 'gpc', v: 4, ...lib.sanitize({ ...lib.DEMO, nombre: 'Importada CLI', team: 'Rafa | Barbeiro' }) }));
    const args = ['--file', file, '--slug', 'importada-cli', '--admin-email', 'dono@importada.test'];

    const dry = await tsx('src/cli/import-generator.ts', [...args, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('Simulación (--dry-run)');
    expect(await db.tenant.count()).toBe(0);

    const real = await tsx('src/cli/import-generator.ts', args);
    expect(real.code).toBe(0);
    expect(real.out).toMatch(/Importado en "importada-cli" \(negocio nuevo\)/);
    expect(await db.service.count()).toBe(3);

    const again = await tsx('src/cli/import-generator.ts', args);
    expect(again.code).toBe(1);
    expect(again.out).toContain('no sobrescribe');

    const badDuration = await tsx('src/cli/import-generator.ts', [...args, '--duration', '3']);
    expect(badDuration.code).toBe(1);
  }, 90_000);
});
