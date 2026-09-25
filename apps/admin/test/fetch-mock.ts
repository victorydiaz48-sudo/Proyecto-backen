import { vi } from 'vitest';

type Handler = (body: unknown, url: URL) => { status?: number; json?: unknown };

/** Sustituye fetch por un enrutador de respuestas: `'GET /api/v1/auth/me': () => ({ json: … })`. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const handler = routes[`${method} ${url.pathname}`];
    const r = handler ? handler(body, url) : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'No encontrado.' } } };
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.json ?? {}), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}
