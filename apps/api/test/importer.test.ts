// Importador del JSON exportado por el generador (Fase 13).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyImport } from '../src/modules/importer/apply.ts';
import { parseDayRange, parsePrice, planImport } from '../src/modules/importer/generator-json.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { buildTestApp } from './helpers/app.ts';
import { createTenantFixture } from './helpers/fixtures.ts';
import { loadGenerator } from './generator/load.ts';

const db = createTestDb();
const lib = loadGenerator();
beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$disconnect();
});

/** JSON como el que exporta el generador ("Exportar datos"): sanitize + app/v. */
const exported = (over: object = {}) => ({ app: 'gpc', v: 4, ...lib.sanitize({ ...lib.DEMO, ...over }) });
const barber = () =>
  exported({
    nombre: 'Barbearia Central',
    wa: '41 98888-7777',
    servicios: '## Cabelo\nCorte | R$ 45 | Tesoura ou máquina\nBarba | R$ 30,50\nCorte + barba | R$ 65 | | destacado\nPacote | sob consulta',
    team: 'Carlos | Barbeiro sênior | 10 anos | Corte, Barba, Inexistente\nAndré | Barbeiro',
    hd1: '09:00-19:00', hd5: '18:00-02:00', hd6: '09:00-15:00', hd0: '',
    locName: 'Centro',
    locations: 'Batel | Av. Batel, 1000 | ,10:00-20:00,,,,, | https://maps.app.goo.gl/x | 41 97777-0000',
  });
const opts = { durationMinutes: 30 };

describe('planImport (interpretación de los textos del generador)', () => {
  it('servicios con categoría, precio en céntimos y avisos de lo que no se puede interpretar', () => {
    const plan = planImport(barber(), opts);
    expect(plan.tenant).toEqual({ name: 'Barbearia Central', timezone: 'America/Sao_Paulo', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR' });
    expect(plan.services.map((s) => [s.name, s.category, s.priceCents, s.durationMinutes])).toEqual([
      ['Corte', 'Cabelo', 4500, 30],
      ['Barba', 'Cabelo', 3050, 30],
      ['Corte + barba', 'Cabelo', 6500, 30],
      ['Pacote', 'Cabelo', 0, 30],
    ]);
    expect(plan.warnings.join('\n')).toMatch(/"Pacote": precio "sob consulta" no interpretable/);
    expect(plan.warnings.join('\n')).toMatch(/ajusta la duración real/);
  });

  it('equipo con servicios por nombre (vacío = todos) y aviso de servicios inexistentes', () => {
    const plan = planImport(barber(), opts);
    expect(plan.professionals).toEqual([
      { displayName: 'Carlos', title: 'Barbeiro sênior', bio: '10 anos', sortOrder: 0, serviceNames: ['Corte', 'Barba'] },
      { displayName: 'André', title: 'Barbeiro', bio: null, sortOrder: 1, serviceNames: ['Corte', 'Barba', 'Corte + barba', 'Pacote'] },
    ]);
    expect(plan.warnings.join('\n')).toMatch(/Carlos: el servicio "inexistente" no existe/);
  });

  it('horarios: normal, 24 h y cruce de medianoche partido en dos días', () => {
    expect(parseDayRange(1, '09:00-19:00')).toEqual([{ weekday: 1, startMinute: 540, endMinute: 1140 }]);
    expect(parseDayRange(3, '00:00-00:00')).toEqual([{ weekday: 3, startMinute: 0, endMinute: 1440 }]);
    expect(parseDayRange(6, '22:00-02:00')).toEqual([
      { weekday: 6, startMinute: 1320, endMinute: 1440 },
      { weekday: 0, startMinute: 0, endMinute: 120 },
    ]);
    expect(parseDayRange(1, '')).toEqual([]);
    const plan = planImport(barber(), opts);
    expect(plan.locations.map((l) => [l.name, l.whatsapp, l.hours.length])).toEqual([
      ['Centro', '+5541988887777', 7], // lu–ju 09–19, vi 18–24 + sá 00–02, sá 09–15
      ['Batel', '+5541977770000', 1],
    ]);
    expect(plan.warnings.join('\n')).toMatch(/varios locales/);
  });

  it('precios y monedas', () => {
    expect(parsePrice('R$ 1.234,56')).toBe(123456);
    expect(parsePrice('€12.5')).toBe(1250);
    expect(parsePrice('grátis')).toBeNull();
    expect(planImport(exported({ cc: '34', lang: 'es', tz: 'Europe/Madrid' }), opts).tenant).toMatchObject({ currency: 'EUR', locale: 'es-ES' });
    expect(() => planImport(exported({ cc: '999' }), opts)).toThrow(/--currency/);
    expect(planImport(exported({ cc: '999' }), { ...opts, currency: 'usd' }).tenant.currency).toBe('USD');
    expect(() => planImport({ nombre: '' }, opts)).toThrow(/nombre/);
  });
});

describe('applyImport', () => {
  it('crea el negocio con locales, servicios, profesionales y horarios, y se puede reservar', async () => {
    const plan = planImport(barber(), opts);
    const r = await applyImport(db, plan, { slug: 'barbearia-central', adminEmail: 'dono@central.test', adminPassword: 'senha-temporaria-1', now: () => new Date('2026-09-30T12:00:00Z') });
    expect(r).toMatchObject({ created: true, counts: { locations: 2, services: 4, professionals: 2, workingIntervals: 14 } });

    const t = r.tenantId;
    const locations = await db.location.findMany({ where: { tenantId: t }, orderBy: { sortOrder: 'asc' } });
    expect(locations.map((l) => [l.name, l.isDefault, l.whatsapp])).toEqual([
      ['Centro', true, '+5541988887777'],
      ['Batel', false, '+5541977770000'],
    ]);
    const carlos = await db.professional.findFirstOrThrow({ where: { tenantId: t, displayName: 'Carlos' }, include: { services: { include: { service: true } }, workingHours: true } });
    expect(carlos.services.map((s) => s.service.name).sort()).toEqual(['Barba', 'Corte']);
    // Viernes 18:00–24:00 + sábado 00:00–02:00 y sábado 09:00–15:00 (sin solapes).
    expect(carlos.workingHours.filter((h) => h.weekday === 6).map((h) => [h.startMinute, h.endMinute]).sort()).toEqual([[0, 120], [540, 900]]);
    expect(await db.auditLog.count({ where: { tenantId: t, actorType: 'SYSTEM' } })).toBeGreaterThan(5);

    // Y se puede reservar por la API pública: lunes 05/10/2026 a las 10:00 con "sin preferencia".
    const app = await buildTestApp(db, () => new Date('2026-09-30T12:00:00Z'));
    const corte = await db.service.findFirstOrThrow({ where: { tenantId: t, name: 'Corte' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/barbearia-central/bookings',
      payload: { serviceId: corte.id, professionalId: 'any', date: '2026-10-05', time: '10:00', customer: { name: 'Primeiro', phone: '41 96666-5555' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().booking).toMatchObject({ localTime: '10:00', service: { priceCents: 4500 }, location: { name: 'Centro' } });
    await app.close();
  });

  it('en un negocio existente vacío importa; con datos, se niega y no toca nada', async () => {
    const a = await createTenantFixture(db, 'barberia-a');
    const plan = planImport(barber(), opts);
    await expect(applyImport(db, plan, { slug: 'barberia-a', adminPassword: 'x-x-x-x-x-x', now: () => new Date() })).rejects.toThrow(/no sobrescribe/);
    expect(await db.service.count({ where: { tenantId: a.tenantId } })).toBe(1);

    const empty = await db.tenant.create({ data: { slug: 'vacia', name: 'Vacía', timezone: 'America/Sao_Paulo', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR' } });
    await db.location.create({ data: { tenantId: empty.id, name: 'Principal', isDefault: true } });
    const r = await applyImport(db, plan, { slug: 'vacia', adminPassword: 'x-x-x-x-x-x', now: () => new Date() });
    expect(r).toMatchObject({ created: false, temporaryPassword: null });
    // El otro negocio no se ve afectado.
    expect(await db.service.count({ where: { tenantId: a.tenantId } })).toBe(1);
    expect(await db.professional.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('negocio nuevo sin email de ADMIN → error claro, nada creado', async () => {
    await expect(applyImport(db, planImport(barber(), opts), { slug: 'nuevo', adminPassword: 'x-x-x-x-x-x', now: () => new Date() })).rejects.toThrow(/--admin-email/);
    expect(await db.tenant.count()).toBe(0);
  });
});
