import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { I18nProvider } from '../src/i18n';
import type { Me } from '../src/types';
import { mockFetch } from './fetch-mock';

// Cada pantalla del panel del ADMIN con datos realistas: se abre sin errores y envía lo correcto.
const admin: Me = {
  user: { id: 'u1', email: 'admin@a.test', role: 'ADMIN', professionalId: null },
  tenant: { id: 't1', slug: 'barberia-a', name: 'Barbería A', timezone: 'America/Sao_Paulo', currency: 'BRL', locale: 'pt-BR' },
};
const services = { items: [{ id: 's1', name: 'Corte', description: null, category: 'Cabelo', durationMinutes: 30, bufferAfterMinutes: 5, priceCents: 4500, active: true, sortOrder: 0 }] };
const professionals = { items: [{ id: 'p1', displayName: 'Carlos', title: 'Barbeiro', bio: null, photoUrl: null, active: true, sortOrder: 0, userId: 'u2', serviceIds: ['s1'] }] };
const locations = { items: [{ id: 'l1', name: 'Centro', address: 'Rua 1', mapsUrl: null, whatsapp: '+5541999990000', isDefault: true, active: true, sortOrder: 0 }] };
const settings = { slug: 'barberia-a', name: 'Barbería A', timezone: 'America/Sao_Paulo', defaultCountryCode: '55', currency: 'BRL', locale: 'pt-BR', slotIntervalMinutes: 15, defaultBookingStatus: 'CONFIRMED', bookingLeadMinutes: 60, bookingHorizonDays: 60 };

const base = {
  'GET /api/v1/auth/me': () => ({ json: admin }),
  'GET /api/v1/admin/services': () => ({ json: services }),
  'GET /api/v1/admin/professionals': () => ({ json: professionals }),
  'GET /api/v1/admin/locations': () => ({ json: locations }),
  'GET /api/v1/admin/bookings': () => ({ json: { items: [] } }),
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(<I18nProvider><App /></I18nProvider>);
};

describe('pantallas del ADMIN', () => {
  it('Serviços: lista con precio y crea uno convirtiendo "30,00" a céntimos', async () => {
    const { calls } = mockFetch({ ...base, 'POST /api/v1/admin/services': () => ({ status: 201, json: {} }) });
    open('/services');
    expect((await screen.findByText(/R\$\s45,00/)).tagName).toBe('TD');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Novo' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Nome'), 'Barba');
    await user.clear(within(dlg).getByLabelText('Duração (min)'));
    await user.type(within(dlg).getByLabelText('Duração (min)'), '20');
    await user.type(within(dlg).getByLabelText('Preço'), '30,00');
    await user.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    const sent = calls.find((c) => c.method === 'POST')!.body;
    expect(sent).toMatchObject({ name: 'Barba', durationMinutes: 20, priceCents: 3000, bufferAfterMinutes: 0 });
  });

  it('Serviços: un precio ilegible no se puede guardar', async () => {
    mockFetch(base);
    open('/services');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Nome'), 'X');
    await user.type(within(dlg).getByLabelText('Preço'), 'abc');
    expect(within(dlg).getByRole<HTMLButtonElement>('button', { name: 'Salvar' }).disabled).toBe(true);
  });

  it('Profissionais: editor de horario envía HH:MM (admite 24:00) y el local', async () => {
    const { calls } = mockFetch({
      ...base,
      'GET /api/v1/admin/professionals/p1/working-hours': () => ({ json: { items: [{ id: 'w1', locationId: 'l1', weekday: 5, start: '18:00', end: '24:00' }] } }),
      'PUT /api/v1/admin/professionals/p1/working-hours': (body) => ({ json: { items: (body as { intervals: unknown[] }).intervals } }),
    });
    open('/professionals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Horário de trabalho' }));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByDisplayValue('24:00');
    await user.click(within(dlg).getAllByRole('button', { name: '+ Adicionar intervalo' })[0]!); // segunda
    await user.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await within(dlg).findByText('Salvo');
    const put = calls.find((c) => c.method === 'PUT')!.body as { intervals: object[] };
    expect(put.intervals).toEqual([
      { locationId: 'l1', weekday: 5, start: '18:00', end: '24:00' },
      { locationId: 'l1', weekday: 1, start: '09:00', end: '18:00' },
    ]);
  });

  it('Configurações: guarda sin enviar el slug y avisa de guardado', async () => {
    const { calls } = mockFetch({
      ...base,
      'GET /api/v1/admin/settings': () => ({ json: settings }),
      'PATCH /api/v1/admin/settings': (body) => ({ json: { ...settings, ...(body as object) } }),
    });
    open('/settings');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Estado inicial dos agendamentos'), 'PENDING');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Salvo');
    const sent = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(sent.defaultBookingStatus).toBe('PENDING');
    expect(sent).not.toHaveProperty('slug');
  });

  it('Configurações → Telegram: conectar con el enlace, comprobar y desconectar', async () => {
    let linked = false;
    const { calls } = mockFetch({
      ...base,
      'GET /api/v1/admin/settings': () => ({ json: settings }),
      'GET /api/v1/admin/settings/telegram': () => ({ json: { available: true, linked, linkedAt: linked ? '2026-09-30T12:00:00.000Z' : null } }),
      'POST /api/v1/admin/settings/telegram/link': () => ({ json: { url: 'https://t.me/ReservasBot?start=abc', expiresAt: '2026-09-30T12:30:00.000Z' } }),
      'DELETE /api/v1/admin/settings/telegram': () => {
        linked = false;
        return { status: 204 };
      },
    });
    open('/settings');
    const user = userEvent.setup();
    const card = within(await screen.findByTestId('telegram'));
    await user.click(await card.findByRole('button', { name: 'Conectar Telegram' }));
    expect(card.getByRole('link', { name: 'Abrir o Telegram' }).getAttribute('href')).toBe('https://t.me/ReservasBot?start=abc');
    // Aún no pulsó Iniciar: se le dice.
    await user.click(card.getByRole('button', { name: 'Já toquei em Iniciar' }));
    await card.findByText(/Ainda não está conectado/);
    // Ya conectado.
    linked = true;
    await user.click(card.getByRole('button', { name: 'Já toquei em Iniciar' }));
    await card.findByText(/Conectado desde/);
    await user.click(card.getByRole('button', { name: 'Desconectar' }));
    await card.findByRole('button', { name: 'Conectar Telegram' });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/v1/admin/settings/telegram']);
  });

  it('Configurações → Telegram: sin bot en el servidor lo explica y no ofrece conectar', async () => {
    mockFetch({
      ...base,
      'GET /api/v1/admin/settings': () => ({ json: settings }),
      'GET /api/v1/admin/settings/telegram': () => ({ json: { available: false, linked: false, linkedAt: null } }),
    });
    open('/settings');
    const card = within(await screen.findByTestId('telegram'));
    await card.findByText(/não estão ativados neste servidor/);
    expect(card.queryByRole('button', { name: 'Conectar Telegram' })).toBeNull();
  });

  it('Usuários: la contraseña temporal se muestra una sola vez al crear', async () => {
    mockFetch({
      ...base,
      'GET /api/v1/admin/users': () => ({ json: { items: [{ id: 'u1', email: 'admin@a.test', role: 'ADMIN', active: true, lastLoginAt: null, professionalId: null, professional: null }] } }),
      'POST /api/v1/admin/users': () => ({ status: 201, json: { user: { email: 'andre@a.test' }, temporaryPassword: 'Tmp-abc-123-xyz-000' } }),
    });
    open('/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('E-mail'), 'andre@a.test');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Tmp-abc-123-xyz-000')).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Fechar' }).at(-1)!);
    expect(screen.queryByText('Tmp-abc-123-xyz-000')).toBeNull();
  });

  it('Clientes: búsqueda y "cargar más" con cursor', async () => {
    const { calls } = mockFetch({
      ...base,
      'GET /api/v1/admin/customers': (_b, url) =>
        url.searchParams.get('cursor')
          ? { json: { items: [{ id: 'c2', name: 'Bruno', phoneE164: '+5541911110002', email: null, notes: null }], nextCursor: null } }
          : { json: { items: [{ id: 'c1', name: 'Ana', phoneE164: '+5541911110001', email: null, notes: null }], nextCursor: 'c1' } },
    });
    open('/customers');
    const user = userEvent.setup();
    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Bruno');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
    await user.type(screen.getByLabelText('Buscar'), '9111');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(calls.some((c) => c.path.includes('search=9111'))).toBe(true);
  });

  it('Locais, Bloqueios, Auditoria y Minha conta se abren sin errores', async () => {
    mockFetch({
      ...base,
      'GET /api/v1/admin/time-blocks': () => ({ json: { items: [{ id: 'tb1', professionalId: null, locationId: null, startAt: '2026-10-01T15:00:00.000Z', endAt: '2026-10-01T16:00:00.000Z', reason: 'Feriado' }] } }),
      'GET /api/v1/admin/audit-logs': () => ({ json: { items: [{ id: 'a1', createdAt: '2026-10-01T12:00:00.000Z', action: 'service.created', entityType: 'Service', entityId: 's1', actorType: 'USER', actor: { id: 'u1', email: 'admin@a.test' }, before: null, after: { name: 'Corte' } }], nextCursor: null } }),
    });
    open('/locations');
    expect(await screen.findByText(/Centro · Local padrão/)).toBeTruthy();
    cleanup();
    open('/blocks');
    expect(await screen.findByText('Feriado')).toBeTruthy();
    expect(screen.getByText('Todos os profissionais')).toBeTruthy();
    cleanup();
    open('/audit');
    expect(await screen.findByText('service.created')).toBeTruthy();
    cleanup();
    open('/account');
    expect(await screen.findByRole('heading', { name: 'Alterar senha' })).toBeTruthy();
  });

  it('Minha conta: cambia la contraseña con la actual', async () => {
    const { calls } = mockFetch({ ...base, 'POST /api/v1/auth/password': () => ({ status: 204 }) });
    open('/account');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Senha atual'), 'vieja-clave-123');
    await user.type(screen.getByLabelText('Nova senha'), 'nueva-clave-456');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Salvo');
    expect(calls.find((c) => c.path === '/api/v1/auth/password')!.body).toEqual({ currentPassword: 'vieja-clave-123', newPassword: 'nueva-clave-456' });
  });
});
