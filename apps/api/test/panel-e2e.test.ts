/// <reference lib="dom" />
// Panel (React) en Chromium contra la API real, servido por la propia API como en producción (Fase 14).
// Requiere el build del panel (npm run build) y Chromium; si falta alguno, se salta (en CI hay ambos).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, TEST_PASSWORD } from './helpers/app.ts';
import { createTestDb, truncateAll } from './helpers/db.ts';
import { createTenantFixture, giveStandardHours, type TenantFixture } from './helpers/fixtures.ts';

const ADMIN_DIST = join(import.meta.dirname, '../../admin/dist');
const ready = existsSync(chromium.executablePath()) && existsSync(join(ADMIN_DIST, 'index.html'));
const db = createTestDb();
let app: FastifyInstance;
let base: string;
let browser: Browser;
let a: TenantFixture;

/** Próximo día laborable (lunes a sábado), a 2+ días vista. */
function nextWorkday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function loginAs(email: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto(base);
  await page.getByLabel('Negócio').fill('barberia-a');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Agenda' }).waitFor();
  return page;
}

beforeAll(async () => {
  if (!ready) return;
  app = await buildTestApp(db, undefined, { ADMIN_DIST_DIR: ADMIN_DIST });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  if (!ready) return;
  await browser.close();
  await app.close();
  await db.$disconnect();
});
beforeEach(async () => {
  if (!ready) return;
  await truncateAll(db);
  a = await createTenantFixture(db, 'barberia-a');
  await giveStandardHours(db, a);
  await createUser(db, a.tenantId, 'admin@a.test', 'ADMIN');
  await createUser(db, a.tenantId, 'carlos@a.test', 'PROFESSIONAL', { professionalId: a.professionalId });
});

describe.skipIf(!ready)('panel en el navegador', () => {
  it('ADMIN: crea un servicio y un profesional con horario, reserva desde la agenda y cancela', async () => {
    const page = await loginAs('admin@a.test');

    // Servicio nuevo
    await page.getByRole('link', { name: 'Serviços' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    const svc = page.getByRole('dialog');
    await svc.getByLabel('Nome').fill('Barba');
    await svc.getByLabel('Duração (min)').fill('20');
    await svc.getByLabel('Preço').fill('30,00');
    await svc.getByRole('button', { name: 'Salvar' }).click();
    await page.getByRole('cell', { name: 'Barba' }).waitFor();
    expect(await db.service.findFirstOrThrow({ where: { name: 'Barba' } })).toMatchObject({ priceCents: 3000, durationMinutes: 20 });

    // Profesional nuevo que solo hace Barba, con horario de lunes a sábado 09:00–13:00
    await page.getByRole('link', { name: 'Profissionais' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    const pro = page.getByRole('dialog');
    await pro.getByLabel('Nome exibido').fill('André');
    await pro.getByLabel('Corte').uncheck();
    await pro.getByRole('button', { name: 'Salvar' }).click();
    await page.getByRole('cell', { name: 'André' }).waitFor();
    await page.getByRole('row', { name: /André/ }).getByRole('button', { name: 'Horário de trabalho' }).click();
    const hours = page.getByRole('dialog');
    for (let i = 0; i < 6; i++) await hours.getByRole('button', { name: '+ Adicionar intervalo' }).nth(i).click();
    const ends = hours.getByLabel('Até');
    for (let i = 0; i < 6; i++) await ends.nth(i).fill('13:00');
    await hours.getByRole('button', { name: 'Salvar' }).click();
    await hours.getByText('Salvo').waitFor();
    const andre = await db.professional.findFirstOrThrow({ where: { displayName: 'André' }, include: { services: true, workingHours: true } });
    expect(andre.services).toHaveLength(1);
    expect(andre.workingHours.map((h) => [h.startMinute, h.endMinute])).toEqual(Array(6).fill([540, 780]));
    await hours.getByRole('button', { name: 'Fechar' }).click();

    // Cita desde la agenda, con "sin preferencia" y una hora que ofrece el servidor
    await page.getByRole('link', { name: 'Agenda' }).click();
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    const bk = page.getByRole('dialog');
    const corte = await bk.getByLabel('Serviço').locator('option').evaluateAll((o) => (o as HTMLOptionElement[]).find((x) => x.textContent?.startsWith('Corte'))!.value);
    await bk.getByLabel('Serviço').selectOption(corte);
    await bk.getByLabel('Data').fill(nextWorkday());
    await bk.getByRole('button', { name: '10:00' }).click();
    await bk.getByLabel('Nome').fill('Pedro Panel');
    await bk.getByLabel('Telefone').fill('41 98888-1111');
    await bk.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Pedro Panel').waitFor();
    expect(await db.booking.findFirstOrThrow()).toMatchObject({ source: 'ADMIN', status: 'CONFIRMED', professionalId: a.professionalId });

    // Cancelar con motivo (prompt del navegador)
    page.once('dialog', (d) => void d.accept('Cliente avisou'));
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await page.getByText('Cancelado').first().waitFor();
    expect(await db.booking.findFirstOrThrow()).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cliente avisou' });

    // Queda en la auditoría
    await page.getByRole('link', { name: 'Auditoria' }).click();
    await page.getByText('booking.status_changed').waitFor();
    await page.close();
  });

  it('PROFESSIONAL en el móvil: solo su agenda y sus bloqueos; sin menús de administración', async () => {
    const page = await loginAs('carlos@a.test', { width: 390, height: 844 });
    const links = await page.getByRole('link').allTextContents();
    expect(links).toEqual(['Agenda', 'Bloqueios', 'Meu horário', 'Clientes', 'Minha conta']);

    await page.getByRole('link', { name: 'Bloqueios' }).click();
    await page.getByRole('button', { name: 'Novo bloqueio' }).click();
    const dlg = page.getByRole('dialog');
    expect(await dlg.getByLabel('Profissional').count()).toBe(0);
    const day = nextWorkday();
    await dlg.getByLabel('Início').fill(day);
    await dlg.getByLabel('Fim').fill(day);
    await dlg.getByRole('button', { name: 'Salvar' }).click();
    await dlg.waitFor({ state: 'detached' });
    expect(await db.timeBlock.findFirstOrThrow()).toMatchObject({ professionalId: a.professionalId, createdByUserId: expect.any(String) });

    await page.getByRole('link', { name: 'Meu horário' }).click();
    await page.getByText('Segunda').waitFor();
    expect(await page.getByRole('button', { name: 'Salvar' }).count()).toBe(0); // solo lectura
    await page.close();
  });

  it('una ruta directa del panel (recarga en /services) carga la SPA; sin sesión muestra el login', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/services`);
    await page.getByRole('button', { name: 'Entrar' }).waitFor();
    expect(await page.title()).toBe('Painel de reservas');
    await page.close();
  });
});
