// Campos sensibles aceptados por la entrada de TODAS las rutas (Fase 15).
// Los esquemas salen de la propia aplicación (app.routeList): si una ruta nueva acepta tenantId, un precio,
// una duración, un rol, un estado… este test falla hasta que alguien lo justifique en ALLOWED.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.ts';
import { createTestDb } from './helpers/db.ts';

const SENSITIVE = /tenant|price|duration|role|status|endat|assign|currency|password|admin|active|token|professionalid/i;

/** Campo sensible → por qué se acepta ahí. Todo lo demás está prohibido. */
const ALLOWED: Record<string, string[]> = {
  'POST /api/v1/auth/login body': ['tenantSlug', 'password'], // login: el negocio se elige por slug
  'POST /api/v1/auth/password body': ['currentPassword', 'newPassword'],
  'PATCH /api/v1/admin/settings body': ['currency', 'defaultBookingStatus', 'bookingLeadMinutes'], // solo ADMIN
  'GET /api/v1/admin/services querystring': ['includeInactive'],
  'POST /api/v1/admin/services body': ['durationMinutes', 'priceCents'], // solo ADMIN: define el catálogo
  'PATCH /api/v1/admin/services/:id body': ['durationMinutes', 'priceCents', 'active'],
  'GET /api/v1/admin/professionals querystring': ['includeInactive'],
  'PATCH /api/v1/admin/professionals/:id body': ['active'],
  'GET /api/v1/admin/locations querystring': ['includeInactive'],
  'PATCH /api/v1/admin/locations/:id body': ['active'],
  'GET /api/v1/admin/time-blocks querystring': ['professionalId'], // filtro; PROFESSIONAL limitado a lo suyo
  'POST /api/v1/admin/time-blocks body': ['professionalId', 'endAt'], // un bloqueo es un rango elegido
  'GET /api/v1/admin/bookings querystring': ['professionalId', 'status'], // filtros
  'POST /api/v1/admin/bookings body': ['professionalId', 'status'], // status solo PENDING|CONFIRMED
  'PATCH /api/v1/admin/bookings/:id body': ['professionalId'], // reasignar; PROFESSIONAL solo a sí mismo (403)
  'POST /api/v1/admin/bookings/:id/status body': ['status'], // transiciones validadas en el servidor
  'GET /api/v1/admin/availability querystring': ['professionalId'],
  'POST /api/v1/admin/users body': ['role', 'password', 'professionalId'], // solo ADMIN
  'PATCH /api/v1/admin/users/:id body': ['role', 'active', 'professionalId'], // solo ADMIN, último ADMIN protegido
  'GET /api/v1/admin/notifications querystring': ['status'],
  'GET /api/v1/public/:tenantSlug/availability querystring': ['professionalId'], // 'any' o un id del negocio
  'POST /api/v1/public/:tenantSlug/bookings body': ['professionalId'],
};

function fieldNames(js: unknown, out: string[] = []): string[] {
  if (!js || typeof js !== 'object') return out;
  const o = js as Record<string, unknown>;
  if (o.properties && typeof o.properties === 'object') {
    for (const [k, v] of Object.entries(o.properties)) {
      out.push(k);
      fieldNames(v, out);
    }
  }
  for (const c of ['items', 'anyOf', 'oneOf', 'allOf', 'additionalProperties']) {
    const v = o[c];
    if (Array.isArray(v)) v.forEach((x) => fieldNames(x, out));
    else fieldNames(v, out);
  }
  return out;
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp(createTestDb());
});
afterAll(() => app.close());

describe('campos sensibles en la entrada', () => {
  it('ninguna ruta acepta un campo sensible que no esté justificado', () => {
    const found: Record<string, string[]> = {};
    for (const r of app.routeList) {
      for (const part of ['body', 'querystring'] as const) {
        const schema = r.schema?.[part];
        if (!schema) continue;
        const json = z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' });
        const hits = [...new Set(fieldNames(json).filter((k) => SENSITIVE.test(k)))];
        if (hits.length) found[`${r.method} ${r.url} ${part}`] = hits.sort();
      }
    }
    const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([k, v]) => [k, [...v].sort()]));
    expect(found).toEqual(allowed);
  });

  it('ningún esquema de entrada acepta tenantId', () => {
    for (const r of app.routeList) {
      for (const part of ['body', 'querystring', 'params'] as const) {
        const schema = r.schema?.[part];
        if (!schema) continue;
        expect(fieldNames(z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' })), `${r.method} ${r.url}`).not.toContain('tenantId');
      }
    }
  });

  it('las rutas públicas no aceptan precio, duración, estado ni rol', () => {
    const pub = Object.keys(ALLOWED).filter((k) => k.includes('/public/'));
    for (const k of pub) expect(ALLOWED[k]).toEqual(['professionalId']);
  });
});
