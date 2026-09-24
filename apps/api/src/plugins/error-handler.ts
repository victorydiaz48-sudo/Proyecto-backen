import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.ts';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
}

// Errores 4xx de Fastify/plugins que se exponen con un código estable (sin su mensaje interno).
const FASTIFY_4XX: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Petición inválida.'],
  404: ['NOT_FOUND', 'No encontrado.'],
  413: ['PAYLOAD_TOO_LARGE', 'La petición es demasiado grande.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Usa Content-Type: application/json.'],
  429: ['RATE_LIMITED', 'Demasiadas peticiones. Inténtalo más tarde.'],
};

/** Respuesta de error uniforme `{ error: { code, message, details? }, requestId }` sin detalles internos. */
export function registerErrorHandler(app: FastifyInstance, opts: { spaFallback?: boolean } = {}): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const send = (status: number, code: string, message: string, details?: Record<string, unknown>) => {
      const body: ErrorBody = { error: { code, message, ...(details ? { details } : {}) }, requestId: request.id };
      return reply.status(status).send(body);
    };

    if (err instanceof AppError) return send(err.statusCode, err.code, err.message, err.details);

    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields = err.validation.map((v) => ({
        path: [err.validationContext, ...String(v.instancePath).split('/').filter(Boolean)].join('.'),
        message: v.message ?? 'inválido',
      }));
      return send(400, 'VALIDATION_ERROR', 'Datos inválidos.', { fields });
    }

    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const known = FASTIFY_4XX[status];
    if (status >= 400 && status < 500) {
      request.log.info({ err: { code: err.code, message: err.message } }, 'petición rechazada');
      const [code, message] = known ?? ['BAD_REQUEST', 'Petición inválida.'];
      return send(status, code, message);
    }

    request.log.error({ err }, 'error no controlado');
    return send(500, 'INTERNAL', 'Error interno. Inténtalo de nuevo más tarde.');
  });

  app.setNotFoundHandler((request, reply) => {
    // Rutas del panel (SPA): cualquier GET de navegador fuera de /api devuelve index.html.
    if (opts.spaFallback && request.method === 'GET' && !request.url.startsWith('/api/') && (request.headers.accept ?? '').includes('text/html')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'No encontrado.' }, requestId: request.id };
    return reply.status(404).send(body);
  });
}
