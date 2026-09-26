import { z } from 'zod';
import { errorResponse } from './common.js';
import { ROUTES, type RouteContract } from './routes.js';

const ERROR_STATUSES: Record<string, string> = {
  '400': 'Invalid request (BAD_REQUEST)',
  '401': 'Not signed in (UNAUTHENTICATED)',
  '403': 'Role too low or other organization (FORBIDDEN)',
  '404': 'Not found in this organization (NOT_FOUND)',
  '409': 'Conflict / duplicate (CONFLICT)',
  '429': 'Rate limited or usage limit reached (RATE_LIMITED, LIMIT_EXCEEDED)',
};

// Output shape for responses; input shape (with defaults optional) for requests.
const schema = (s: z.ZodType, io: 'input' | 'output') => z.toJSONSchema(s, { io, unrepresentable: 'any' });

function toOpenApiPath(path: string) {
  return path.replace(/:([A-Za-z]+)/g, '{$1}');
}

function parameters(c: RouteContract) {
  const out: unknown[] = [];
  for (const [where, obj] of [
    ['path', c.params],
    ['query', c.query],
  ] as const) {
    if (!obj) continue;
    const json = schema(obj, 'input') as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, s] of Object.entries(json.properties ?? {})) {
      out.push({ name, in: where, required: where === 'path' || (json.required ?? []).includes(name), schema: s });
    }
  }
  return out;
}

/** OpenAPI 3.1 document for /api/v1, generated from the route table. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const c of ROUTES as readonly RouteContract[]) {
    const p = (paths[toOpenApiPath(c.path)] ??= {});
    const status = String(c.status ?? 200);
    p[c.method.toLowerCase()] = {
      operationId: c.id,
      summary: c.summary,
      tags: [c.tag],
      description: c.auth === 'public' ? 'No session required.' : `Requires a session with role ${c.auth} or higher.`,
      security: c.auth === 'public' ? [] : [{ session: [] }],
      'x-min-role': c.auth,
      parameters: parameters(c),
      ...(c.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(c.body, 'input') } } } } : {}),
      responses: {
        [status]: { description: 'OK', content: { 'application/json': { schema: schema(c.response, 'output') } } },
        ...Object.fromEntries(
          Object.entries(ERROR_STATUSES)
            .filter(([code]) => (code === '401' || code === '403' ? c.auth !== 'public' : true))
            .map(([code, description]) => [code, { $ref: `#/components/responses/E${code}`, description }]),
        ),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Dealer Content Platform API',
      version: '1.0.0',
      description:
        'REST API used by the dashboard. The organization is always taken from the session; requests never carry a organizationId. Money is micro-USD as decimal strings.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'sid' } },
      responses: Object.fromEntries(
        Object.entries(ERROR_STATUSES).map(([code, description]) => [
          `E${code}`,
          { description, content: { 'application/json': { schema: schema(errorResponse, 'output') } } },
        ]),
      ),
    },
    paths,
  };
}
