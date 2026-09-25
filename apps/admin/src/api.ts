// Cliente de la API del panel. Mismo origen: la cookie de sesión (HttpOnly) viaja sola; el navegador
// añade Origin/Sec-Fetch-Site, que el servidor usa contra CSRF. Nunca se envía tenantId: sale de la sesión.

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body.code;
  }

  /** Errores de validación por campo (`details.fields`). */
  get fields(): { path: string; message: string }[] {
    const f = this.body.details?.fields;
    return Array.isArray(f) ? (f as { path: string; message: string }[]) : [];
  }
}

/** Se llama cuando cualquier petición devuelve 401 (sesión caducada): la app vuelve al login. */
let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHandler(fn: () => void): void {
  onUnauthenticated = fn;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Sin conexión con el servidor.' });
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: ApiErrorBody } | null)?.error ?? { code: 'INTERNAL', message: `Error ${res.status}` };
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthenticated();
    throw new ApiError(res.status, err);
  }
  return json as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);

export const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};
