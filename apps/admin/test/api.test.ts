import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setUnauthenticatedHandler } from '../src/api';
import { mockFetch } from './fetch-mock';

afterEach(() => vi.unstubAllGlobals());

describe('cliente de la API', () => {
  it('convierte el error uniforme de la API en ApiError con sus campos', async () => {
    mockFetch({
      'POST /api/v1/admin/services': () => ({
        status: 400,
        json: { error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.', details: { fields: [{ path: 'body.name', message: 'requerido' }] } } },
      }),
    });
    const err = await api('POST', '/admin/services', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_ERROR');
    expect((err as ApiError).fields).toEqual([{ path: 'body.name', message: 'requerido' }]);
  });

  it('un 401 fuera del login avisa a la app (sesión caducada)', async () => {
    const onUnauth = vi.fn();
    setUnauthenticatedHandler(onUnauth);
    mockFetch({ 'GET /api/v1/admin/services': () => ({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }) });
    await api('GET', '/admin/services').catch(() => undefined);
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it('sin red → código NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await api('GET', '/auth/me').catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('NETWORK');
  });

  it('nunca envía tenantId: solo el cuerpo indicado, con la cookie del mismo origen', async () => {
    const { calls } = mockFetch({ 'POST /api/v1/admin/bookings': () => ({ status: 201, json: {} }) });
    await api('POST', '/admin/bookings', { serviceId: 's' });
    expect(calls[0]!.body).toEqual({ serviceId: 's' });
  });
});
