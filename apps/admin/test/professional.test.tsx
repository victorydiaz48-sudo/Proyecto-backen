import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { I18nProvider } from '../src/i18n';
import { localDate } from '../src/format';
import type { Booking, Me } from '../src/types';
import { mockFetch } from './fetch-mock';

// Panel del profesional (Fase 11): lo que un barbero usa en el día a día, sobre todo desde el móvil.
const TZ = 'America/Sao_Paulo';
const pro: Me = {
  user: { id: 'u2', email: 'andre@a.test', role: 'PROFESSIONAL', professionalId: 'p2' },
  tenant: { id: 't1', slug: 'barberia-a', name: 'Barbería A', timezone: TZ, currency: 'BRL', locale: 'pt-BR' },
};
const professionals = {
  items: [
    { id: 'p1', displayName: 'Carlos', serviceIds: ['s1', 's2'] },
    { id: 'p2', displayName: 'André', serviceIds: ['s1'] },
  ],
};
const services = {
  items: [
    { id: 's1', name: 'Corte', durationMinutes: 30, priceCents: 4500 },
    { id: 's2', name: 'Barba', durationMinutes: 20, priceCents: 3000 },
  ],
};
const today = localDate(new Date(), TZ);
const booking = (id: string, over: Partial<Booking>): Booking => ({
  id,
  status: 'CONFIRMED',
  startAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 5_400_000).toISOString(),
  localDate: today,
  localTime: '15:00',
  service: { id: 's1', name: 'Corte', durationMinutes: 30 },
  priceCents: 4500,
  currency: 'BRL',
  professional: { id: 'p2', displayName: 'André' },
  location: { id: 'l1', name: 'Principal' },
  customer: { id: 'c1', name: 'Pedro', phoneE164: '+5541988887777' },
  customerNotes: null,
  source: 'PUBLIC_WEB',
  cancelReason: null,
  ...over,
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const renderApp = () => render(<I18nProvider><App /></I18nProvider>);

describe('panel del profesional', () => {
  it('resumen del día: número de citas y total, sin contar las canceladas', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: pro }),
      'GET /api/v1/admin/professionals': () => ({ json: professionals }),
      'GET /api/v1/admin/bookings': () => ({
        json: { items: [booking('b1', {}), booking('b2', { localTime: '16:00', priceCents: 3000 }), booking('b3', { localTime: '17:00', status: 'CANCELLED' })] },
      }),
    });
    renderApp();
    expect((await screen.findByText(/2 agendamentos/)).textContent?.replace(/\s/g, ' ')).toBe('2 agendamentos · R$ 75,00');
    // Solo su columna.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['André']);
  });

  it('"Próximos 7 dias" pide ese rango y agrupa por día, sin canceladas', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const { calls } = mockFetch({
      'GET /api/v1/auth/me': () => ({ json: pro }),
      'GET /api/v1/admin/professionals': () => ({ json: professionals }),
      'GET /api/v1/admin/bookings': (_b, url) =>
        url.searchParams.get('from')?.includes('T12:00:00Z')
          ? { json: { items: [] } }
          : {
              json: {
                items: [
                  booking('b1', {}),
                  booking('b2', { localDate: localDate(tomorrow, TZ), customer: { id: 'c2', name: 'Maria', phoneE164: '+5541911112222' } }),
                  booking('b3', { status: 'CANCELLED', customer: { id: 'c3', name: 'Cancelado', phoneE164: '+5541900000000' } }),
                ],
              },
            },
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Próximos 7 dias' }));
    expect(await screen.findByText(/Maria/)).toBeTruthy();
    expect(screen.getByText(/Pedro/)).toBeTruthy();
    expect(screen.queryByText(/Cancelado/)).toBeNull();
    const last = calls.filter((c) => c.path.startsWith('/api/v1/admin/bookings')).at(-1)!;
    const q = new URL(last.path, 'http://x').searchParams;
    const days = (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('nueva cita: solo ofrece los servicios que hace el profesional y su propia agenda', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: pro }),
      'GET /api/v1/admin/professionals': () => ({ json: professionals }),
      'GET /api/v1/admin/bookings': () => ({ json: { items: [] } }),
      'GET /api/v1/admin/services': () => ({ json: services }),
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Escolha primeiro o serviço.')).toBeTruthy();
    const options = within(within(dialog).getByLabelText('Serviço')).getAllByRole('option').map((o) => o.textContent);
    // André solo hace Corte: Barba no aparece.
    expect(options).toHaveLength(2);
    expect(options[1]).toMatch(/^Corte · 30 min/);
    expect(options.some((o) => o?.includes('Barba'))).toBe(false);
    const proSelect = within(dialog).getByLabelText<HTMLSelectElement>('Profissional');
    expect(proSelect.disabled).toBe(true);
    expect(proSelect.value).toBe('p2');
  });

  it('usuario PROFESSIONAL sin ficha vinculada: aviso claro en agenda, bloqueos y horario', async () => {
    mockFetch({
      'GET /api/v1/auth/me': () => ({ json: { ...pro, user: { ...pro.user, professionalId: null } } }),
      'GET /api/v1/admin/professionals': () => ({ json: professionals }),
      'GET /api/v1/admin/bookings': () => ({ json: { items: [] } }),
    });
    renderApp();
    expect(await screen.findByText(/ainda não está vinculado/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Bloqueios' }));
    expect(await screen.findByText(/ainda não está vinculado/)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Meu horário' }));
    expect(await screen.findByText(/ainda não está vinculado/)).toBeTruthy();
  });
});
