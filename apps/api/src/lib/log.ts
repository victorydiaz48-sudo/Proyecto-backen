import type { FastifyRequest } from 'fastify';

/** Parámetros de query que pueden llevar datos personales (búsqueda de clientes por nombre/teléfono). */
const PII_QUERY_PARAMS = new Set(['search']);

/** Quita de la URL los valores de parámetros con datos personales antes de escribirla en el log. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const key of params.keys()) {
    if (PII_QUERY_PARAMS.has(key)) {
      params.set(key, '[REDACTED]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

/** Igual que el serializador `req` por defecto de Fastify, con la URL sin datos personales. */
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}
