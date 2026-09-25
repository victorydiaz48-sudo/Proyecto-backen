import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { I18nProvider } from '../src/i18n';
import type { Me } from '../src/types';
import { mockFetch } from './fetch-mock';

const admin: Me = {
  user: { id: 'u1', email: 'admin@a.test', role: 'ADMIN', professionalId: null },
  tenant: { id: 't1', slug: 'barberia-a', name: 'Barbería A', timezone: 'America/Sao_Paulo', currency: 'BRL', locale: 'pt-BR' },
};
const pro: Me = { ...admin, user: { id: 'u2', email: 'carlos@a.test', role: 'PROFESSIONAL', professionalId: 'p1' } };
const empty = () => ({ json: { items: [] } });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderApp = () => render(<I18nProvider><App /></I18nProvider>);

describe('panel', () => {
  it('sin sesión muestra el login; al entrar carga el panel del negocio', async () => {
    let loggedIn = false;
    const { calls } = mockFetch({
      'GET /api/v1/auth/me': () => (loggedIn ? { json: admin } : { status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      'POST /api/v1/auth/login': () => {
        loggedIn = true;
        return { json: admin };
      },
      'GET /api/v1/admin/bookings': empty,
      'GET /api/v1/admin/professionals': empty,
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Negócio/), 'barberia-a');
    await user.type(screen.getByLabelText('E-mail'), 'admin@a.test');
    await user.type(screen.getByLabelText('Senha'), 'clave-segura-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Barbería A')).toBeTruthy();
    expect(calls.find((c) => c.path === '/api/v1/auth/login')!.body).toEqual({ tenantSlug: 'barberia-a', email: 'admin@a.test', password: 'clave-segura-123' });
    expect(screen.getByRole('link', { name: 'Serviços' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Usuários' })).toBeTruthy();
  });

  it('credenciales incorrectas → mensaje genérico traducido', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      'POST /api/v1/auth/login': () => ({ status: 401, json: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } } }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Negócio/), 'barberia-a');
    await user.type(screen.getByLabelText('E-mail'), 'a@a.test');
    await user.type(screen.getByLabelText('Senha'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail, senha ou negócio incorretos.');
  });

  it('demasiados intentos y origen rechazado → mensajes propios traducidos (no "datos incorrectos")', async () => {
    let code = 'RATE_LIMITED';
    mockFetch({
      'GET /api/v1/auth/me': () => ({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      'POST /api/v1/auth/login': () => ({ status: code === 'RATE_LIMITED' ? 429 : 403, json: { error: { code, message: 'Mensaje del servidor' } } }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Negócio/), 'Barbearia A');
    await user.type(screen.getByLabelText('E-mail'), 'a@a.test');
    await user.type(screen.getByLabelText('Senha'), 'clave-larga-1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Muitas tentativas. Espere alguns minutos e tente de novo.');
    code = 'CSRF_REJECTED';
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByText(/bloqueou o envio por segurança/);
  });

  it('un PROFESSIONAL solo ve su agenda, bloqueos, horario, clientes y cuenta', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: pro }),
      'GET /api/v1/admin/bookings': empty,
      'GET /api/v1/admin/professionals': () => ({ json: { items: [{ id: 'p1', displayName: 'Carlos', serviceIds: [] }, { id: 'p2', displayName: 'André', serviceIds: [] }] } }),
    });
    renderApp();
    await screen.findByText('Barbería A');
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links).toEqual(['Agenda', 'Bloqueios', 'Meu horário', 'Clientes', 'Minha conta']);
    // Su agenda muestra solo su columna, no la de otros profesionales.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Carlos' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'André' })).toBeNull();
  });

  it('el idioma por defecto es el del negocio (es-ES → español)', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: { ...admin, tenant: { ...admin.tenant, locale: 'es-ES' } } }),
      'GET /api/v1/admin/bookings': empty,
      'GET /api/v1/admin/professionals': empty,
    });
    renderApp();
    expect(await screen.findByRole('link', { name: 'Servicios' })).toBeTruthy();
  });
});

describe('avisos', () => {
  it('ADMIN ve los avisos con su enlace de WhatsApp para enviarlos a mano', async () => {
    window.history.replaceState(null, '', '/notifications');
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: admin }),
      'GET /api/v1/admin/notifications': () => ({
        json: {
          items: [
            {
              id: 'n1', bookingId: 'b1', channel: 'whatsapp', audience: 'BUSINESS', template: 'business.booking_created', status: 'SENT', to: '+5541999990000',
              text: 'Novo agendamento pelo site', waUrl: 'https://wa.me/5541999990000?text=Novo', attempts: 1, lastError: null,
              scheduledFor: '2026-09-30T12:00:00.000Z', sentAt: '2026-09-30T12:00:05.000Z', createdAt: '2026-09-30T12:00:00.000Z',
            },
            {
              id: 'n2', bookingId: 'b1', channel: 'telegram', audience: 'BUSINESS', template: 'business.booking_created', status: 'SENT', to: '777',
              text: 'Novo agendamento pelo site', waUrl: null, attempts: 1, lastError: null,
              scheduledFor: '2026-09-30T12:00:00.000Z', sentAt: '2026-09-30T12:00:05.000Z', createdAt: '2026-09-30T12:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }),
    });
    renderApp();
    const link = await screen.findByRole('link', { name: 'Abrir no WhatsApp' });
    expect(link.getAttribute('href')).toBe('https://wa.me/5541999990000?text=Novo');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('Negócio · WhatsApp')).toBeTruthy();
    // El de Telegram lo envía el servidor: sin enlace de WhatsApp.
    expect(screen.getByText('Negócio · Telegram')).toBeTruthy();
    expect(screen.getByText('Enviado automaticamente pelo Telegram')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Abrir no WhatsApp' })).toHaveLength(1);
  });
});
