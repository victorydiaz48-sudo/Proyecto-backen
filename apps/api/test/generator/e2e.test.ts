/// <reference lib="dom" />
// Fase 13, de punta a punta: la página generada, abierta como archivo (file://) en Chromium, reserva
// contra una API real. Cubre el modo conectado, el choque de horario con alternativas, la caída de la
// API (vuelta a WhatsApp) y el botón "Probar conexión" del generador.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app.ts';
import { createTestDb, truncateAll } from '../helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from '../helpers/fixtures.ts';
import { GENERATOR_PATH, loadGenerator } from './load.ts';

const hasBrowser = existsSync(chromium.executablePath());
const db = createTestDb();
const lib = loadGenerator();
let app: FastifyInstance;
let apiBase: string;
let browser: Browser;
let dir: string;
let a: TenantFixture;
let andre: string;

/** Próximo día laborable (lunes a sábado) a 2+ días vista, en la zona del negocio. */
function nextWorkday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function writePage(name: string, input: object): string {
  const file = join(dir, `${name}.html`);
  writeFileSync(file, lib.buildPage({ ...lib.DEMO, nombre: 'Barbearia Teste', cta: 'book', team: 'Carlos | Barbeiro\nAndré | Barbeiro', ...input }));
  return `file://${file}`;
}

async function openBooking(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('.cta[data-bkopen]').first().click();
  await page.locator('#bkDlg[open]').waitFor();
}

/** Elige en un <select> la primera opción cuyo texto empieza por `prefix`. */
async function selectByPrefix(page: Page, selector: string, prefix: string): Promise<void> {
  const value = await page.locator(`${selector} option`).evaluateAll(
    (opts, p) => (opts as HTMLOptionElement[]).find((o) => (o.textContent ?? '').startsWith(p))?.value,
    prefix,
  );
  if (value === undefined) throw new Error(`No hay opción que empiece por "${prefix}" en ${selector}`);
  await page.locator(selector).selectOption(value);
}

/** El modo conectado está listo cuando aparece el selector de horas reales. */
const connected = (page: Page) => page.locator('.bkf[data-f="slot"]:not([hidden])').waitFor();

async function chooseInConnectedForm(page: Page, date: string, professional?: string): Promise<void> {
  await connected(page);
  await selectByPrefix(page, '#bkService', 'Corte');
  if (professional) await page.locator('#bkPro').selectOption({ label: professional });
  await page.locator('#bkDate').fill(date);
  await page.locator('.bkslot').first().waitFor();
}

beforeAll(async () => {
  if (!hasBrowser) return;
  app = await buildTestApp(db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), 'paginas-'));
});
afterAll(async () => {
  if (!hasBrowser) return;
  await browser.close();
  await app.close();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  if (!hasBrowser) return;
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  andre = (await db.professional.create({ data: { tenantId: a.tenantId, displayName: 'André', sortOrder: 1 } })).id;
  await db.professionalService.create({ data: { tenantId: a.tenantId, professionalId: andre, serviceId: a.serviceId } });
  await giveStandardHours(db, a);
  await giveStandardHours(db, a, andre);
  await db.location.update({ where: { id: a.locationId }, data: { whatsapp: '+5541999990000' } });
});

describe.skipIf(!hasBrowser)('página generada conectada al backend (Chromium, file://)', () => {
  it('reserva con horas reales del servidor: la cita queda creada y se ofrece avisar por WhatsApp', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openBooking(page, writePage('conectada', { apiUrl: apiBase, apiSlug: 'barberia-a' }));
    const date = nextWorkday();
    await chooseInConnectedForm(page, date);
    expect(await page.locator('.bkf[data-f="time"]').isHidden()).toBe(true);
    expect(await page.locator('.bkslot').first().textContent()).toBe('09:00');
    await page.locator('.bkslot').first().click();
    await page.locator('#bkName').fill('Cliente Web');
    await page.locator('#bkPhone').fill('41 97777-1234');
    await page.locator('#bkForm button[type="submit"]').click();
    await page.locator('#bkConfirm').waitFor();
    expect(await page.locator('#bkGo').isHidden()).toBe(true);
    await page.locator('#bkConfirm').click();
    await page.locator('#bkDone').waitFor();

    expect(await page.locator('#bkDoneT').textContent()).toBe('Agendamento confirmado!');
    expect(await page.locator('#bkDoneWa').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5541999990000\?text=/);
    const booking = await db.booking.findFirstOrThrow({ include: { customer: true } });
    expect(booking).toMatchObject({ source: 'PUBLIC_WEB', priceCentsSnapshot: 4500, status: 'CONFIRMED' });
    expect(booking.customer.phoneE164).toBe('+5541977771234');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('si otra persona se adelanta: aviso, alternativas reales y reserva con una de ellas', async () => {
    const page = await browser.newPage();
    await openBooking(page, writePage('choque', { apiUrl: apiBase, apiSlug: 'barberia-a' }));
    const date = nextWorkday();
    await chooseInConnectedForm(page, date, 'Carlos');
    await page.locator('.bkslot').first().click();
    await page.locator('#bkName').fill('Cliente Lento');
    await page.locator('#bkPhone').fill('41 97777-0000');
    await page.locator('#bkForm button[type="submit"]').click();
    await page.locator('#bkConfirm').waitFor();

    // Mientras revisa, alguien reserva esa misma hora con Carlos.
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/public/barberia-a/bookings',
      payload: { serviceId: a.serviceId, professionalId: a.professionalId, date, time: '09:00', customer: { name: 'Rápido', phone: '41 96666-0000' } },
    });
    expect(other.statusCode).toBe(201);

    await page.locator('#bkConfirm').click();
    await page.locator('#bkMsg.err').waitFor();
    expect(await page.locator('#bkMsg').textContent()).toContain('não está mais disponível');
    expect(await page.locator('#bkForm').isVisible()).toBe(true);
    const alternatives = await page.locator('.bkslot').allTextContents();
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives).not.toContain('09:00');
    expect(await db.booking.count()).toBe(1); // no se reservó otra hora automáticamente

    await page.locator('.bkslot').first().click();
    await page.locator('#bkForm button[type="submit"]').click();
    await page.locator('#bkConfirm').click();
    await page.locator('#bkDone').waitFor();
    expect(await db.booking.count()).toBe(2);
    await page.close();
  });

  it('si el cliente elige el servicio antes de que termine de cargar, la elección se mantiene', async () => {
    const page = await browser.newPage();
    // La API tarda: se retrasan sus respuestas para abrir la ventana de carrera.
    await page.route(`${apiBase}/**`, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await openBooking(page, writePage('carrera', { apiUrl: apiBase, apiSlug: 'barberia-a' }));
    await page.locator('#bkService').selectOption('Corte'); // lista de la página (modo WhatsApp): valor = nombre
    await connected(page);
    expect(await page.locator('#bkService option:checked').textContent()).toMatch(/^Corte — /);
    await page.close();
  });

  it('con varios locales en el backend, el cliente elige local', async () => {
    const batel = await db.location.create({ data: { tenantId: a.tenantId, name: 'Batel' } });
    await db.workingHour.updateMany({ where: { professionalId: andre }, data: { locationId: batel.id } });
    const page = await browser.newPage();
    await openBooking(page, writePage('multilocal', { apiUrl: apiBase, apiSlug: 'barberia-a' }));
    await connected(page);
    await page.locator('.bkf[data-f="loc"]:not([hidden])').waitFor();
    expect(await page.locator('#bkLoc option').allTextContents()).toEqual(['Qualquer unidade', 'Principal', 'Batel']);
    await selectByPrefix(page, '#bkService', 'Corte');
    await page.locator('#bkLoc').selectOption({ label: 'Batel' });
    // En Batel solo trabaja André (el backend lo sabe por su horario).
    await page.waitForFunction(() => document.querySelectorAll('#bkPro option').length === 2);
    expect(await page.locator('#bkPro option').allTextContents()).toEqual(['Sem preferência', 'André']);
    await page.locator('#bkDate').fill(nextWorkday());
    await page.locator('.bkslot').first().click();
    await page.locator('#bkName').fill('Cliente Batel');
    await page.locator('#bkPhone').fill('41 97777-5555');
    await page.locator('#bkForm button[type="submit"]').click();
    await page.locator('#bkConfirm').click();
    await page.locator('#bkDone').waitFor();
    const booking = await db.booking.findFirstOrThrow();
    expect(booking).toMatchObject({ locationId: batel.id, professionalId: andre });
    await page.close();
  });

  it('si la API no responde, la página sigue funcionando por WhatsApp como siempre (sin horas inventadas)', async () => {
    const page = await browser.newPage();
    await openBooking(page, writePage('caida', { apiUrl: 'http://127.0.0.1:9', apiSlug: 'barberia-a' }));
    await page.waitForTimeout(500);
    expect(await page.locator('.bkf[data-f="time"]').isVisible()).toBe(true);
    expect(await page.locator('.bkf[data-f="slot"]').isHidden()).toBe(true);
    expect(await page.locator('.bkslot').count()).toBe(0);
    await page.locator('#bkName').fill('Cliente');
    await page.locator('#bkPhone').fill('41 97777-0000');
    await page.locator('#bkService').selectOption({ index: 1 });
    await page.locator('#bkDate').fill(nextWorkday());
    await page.locator('#bkTime').fill('10:00');
    await page.locator('#bkForm button[type="submit"]').click();
    await page.locator('#bkReview:not([hidden])').waitFor();
    expect(await page.locator('#bkGo').getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
    expect(await page.locator('#bkConfirm').isHidden()).toBe(true);
    expect(await db.booking.count()).toBe(0);
    await page.close();
  });

  it('una página sin conexión configurada funciona exactamente como antes (WhatsApp)', async () => {
    const page = await browser.newPage();
    await openBooking(page, writePage('sin-api', {}));
    expect(await page.locator('#bkSlots').count()).toBe(0);
    await page.locator('#bkName').fill('Cliente');
    await page.locator('#bkPhone').fill('41 97777-0000');
    await page.locator('#bkService').selectOption({ index: 1 });
    await page.locator('#bkDate').fill(nextWorkday());
    await page.locator('#bkTime').fill('10:00');
    await page.locator('#bkForm button[type="submit"]').click();
    expect(await page.locator('#bkGo').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5541999999999\?text=/);
    await page.close();
  });
});

describe.skipIf(!hasBrowser)('generador: "Testar conexão"', () => {
  it('comprueba la conexión con el backend sin crear nada', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`file://${GENERATOR_PATH}`);
    await page.locator('#apiBox summary').click();
    await page.locator('#apiUrl').fill(apiBase);
    await page.locator('#apiSlug').fill('barberia-a');
    await page.locator('#apiTest').click();
    await page.locator('#apiTestMsg:has-text("Conectado")').waitFor();
    // La herramienta está en español o portugués según el navegador: se comprueba el dato, no el idioma.
    expect(await page.locator('#apiTestMsg').textContent()).toMatch(/^Conectado: barberia-a · 1 /);
    await page.locator('#apiSlug').fill('no-existe');
    await page.locator('#apiTest').click();
    await page.locator('#apiTestMsg:not(:has-text("Conectado"))').waitFor();
    expect(await db.booking.count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});
