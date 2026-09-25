import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../../db.ts';
import { sha256 } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import { generateTemporaryPassword } from '../../lib/password.ts';
import { provisionTenant } from '../tenants/provision.ts';

/*
 * /operator: alta de negocios desde el navegador (p. ej. el móvil), para quien no tiene terminal.
 * Solo existe si OPERATOR_TOKEN está definido. Formulario HTML sin JavaScript (compatible con la CSP):
 * el token va en el formulario, así que un sitio ajeno no puede enviarlo (no hay cookie que aprovechar).
 * Misma lógica y validación que `npm run tenant:create` (provisionTenant, auditoría como SYSTEM).
 */

interface Fields {
  slug: string;
  name: string;
  timezone: string;
  country: string;
  currency: string;
  locale: string;
  location: string;
  adminEmail: string;
}

const DEFAULTS: Fields = {
  slug: '',
  name: '',
  timezone: 'America/Sao_Paulo',
  country: '55',
  currency: 'BRL',
  locale: 'pt-BR',
  location: 'Principal',
  adminEmail: '',
};

/** Nombre del campo del esquema de alta → campo del formulario (para mostrar los errores al lado). */
const FIELD_OF: Record<string, keyof Fields> = {
  slug: 'slug',
  name: 'name',
  timezone: 'timezone',
  defaultCountryCode: 'country',
  currency: 'currency',
  locale: 'locale',
  locationName: 'location',
  adminEmail: 'adminEmail',
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || !given) return false;
  // Comparación en tiempo constante sobre hashes de igual longitud.
  return timingSafeEqual(Buffer.from(sha256(expected), 'hex'), Buffer.from(sha256(given), 'hex'));
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f6f6f4;color:#1c1c1a}
  main{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px #0002}
  h1{font-size:1.3rem;margin:0 0 12px}
  label{display:block;margin:12px 0 4px;font-weight:600}
  input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #bbb;border-radius:8px}
  .hint{font-size:.85rem;color:#666;margin:2px 0 0}
  .err{color:#b3261e;font-size:.9rem;margin:4px 0 0}
  .box{padding:12px;border-radius:8px;margin:12px 0}
  .bad{background:#fdecea;color:#b3261e}
  .ok{background:#e7f5ea}
  code{font-size:1.1rem;word-break:break-all;background:#f1f1f1;padding:2px 6px;border-radius:4px}
  button{margin-top:18px;width:100%;padding:12px;font-size:16px;border:0;border-radius:8px;background:#1c1c1a;color:#fff}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function formPage(values: Fields, errors: Partial<Record<keyof Fields | 'token' | 'general', string>> = {}): string {
  const err = (k: keyof Fields | 'token') => (errors[k] ? `<p class="err">${escapeHtml(errors[k])}</p>` : '');
  // Campos técnicos: sin mayúsculas automáticas ni autocorrector del móvil (cambian "barbearia-x" o el email).
  const TEXT_FIELDS: (keyof Fields)[] = ['name', 'location'];
  const input = (k: keyof Fields, label: string, hint = '', type = 'text') =>
    `<label for="${k}">${label}</label><input id="${k}" name="${k}" type="${type}" value="${escapeHtml(values[k])}" autocomplete="off"${
      TEXT_FIELDS.includes(k) ? '' : ' autocapitalize="none" autocorrect="off" spellcheck="false"'
    } required>${
      hint ? `<p class="hint">${hint}</p>` : ''
    }${err(k)}`;
  return page(
    'Crear negocio',
    `<h1>Crear negocio</h1>
${errors.general ? `<div class="box bad">${escapeHtml(errors.general)}</div>` : ''}
<form method="post" action="/operator/tenants">
<label for="token">Token de operador</label><input id="token" name="token" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required>${err('token')}
${input('name', 'Nombre del negocio')}
${input('slug', 'Identificador (slug)', 'Minúsculas, números y guiones. Va en la dirección de la página y en el login.')}
${input('adminEmail', 'Email del primer ADMIN', '', 'email')}
${input('timezone', 'Zona horaria', 'Formato IANA, p. ej. America/Sao_Paulo o Europe/Madrid.')}
${input('country', 'Código de país (sin +)', 'Para normalizar teléfonos: 55 Brasil, 351 Portugal, 34 España…')}
${input('currency', 'Moneda', 'ISO 4217: BRL, EUR, MXN…')}
${input('locale', 'Idioma y región', 'pt-BR, pt-PT, es-ES, es-MX…')}
${input('location', 'Nombre del local principal')}
<button type="submit">Crear negocio</button>
</form>`,
  );
}

function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8');
}

export const operatorRoutes: FastifyPluginAsync<{ db: Db; token: string }> = async (app, { db, token }) => {
  // Solo aquí se aceptan formularios HTML (el resto de la API es JSON).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get('/operator', async (_request, reply) => noStore(reply).send(formPage(DEFAULTS)));

  app.post(
    '/operator/tenants',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const raw = (request.body ?? {}) as Record<string, unknown>;
      const str = (k: keyof Fields) => (typeof raw[k] === 'string' ? (raw[k]) : DEFAULTS[k]);
      const values: Fields = {
        slug: str('slug'),
        name: str('name'),
        timezone: str('timezone'),
        country: str('country'),
        currency: str('currency'),
        locale: str('locale'),
        location: str('location'),
        adminEmail: str('adminEmail'),
      };

      if (!tokenMatches(token, raw.token)) {
        request.log.warn({ ip: request.ip }, 'operator: token incorrecto');
        return noStore(reply).status(403).send(formPage(values, { token: 'Token incorrecto.' }));
      }

      const adminPassword = generateTemporaryPassword();
      try {
        const r = await provisionTenant(db, {
          slug: values.slug.trim().toLowerCase(),
          name: values.name,
          timezone: values.timezone,
          defaultCountryCode: values.country,
          currency: values.currency,
          locale: values.locale,
          locationName: values.location,
          adminEmail: values.adminEmail,
          adminPassword,
        });
        request.log.info({ tenantId: r.tenant.id, slug: r.tenant.slug }, 'operator: negocio creado');
        return noStore(reply)
          .status(201)
          .send(
            page(
              'Negocio creado',
              `<h1>Negocio creado</h1>
<div class="box ok">«${escapeHtml(r.tenant.name)}» está listo.</div>
<p>Entra en el panel con:</p>
<p>Negocio: <code>${escapeHtml(r.tenant.slug)}</code><br>Email: <code>${escapeHtml(r.admin.email)}</code><br>
Contraseña inicial: <code>${escapeHtml(adminPassword)}</code></p>
<p><strong>Apunta la contraseña ahora: no se vuelve a mostrar.</strong> Cámbiala en «Cuenta» al entrar.</p>
<p><a href="/">Ir al panel</a> · <a href="/operator">Crear otro negocio</a></p>`,
            ),
          );
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const errors: Partial<Record<keyof Fields | 'general', string>> = {};
        const fields = (err.details as { fields?: { path: string; message: string }[] } | undefined)?.fields ?? [];
        for (const f of fields) {
          const key = FIELD_OF[f.path.split('.').pop() ?? ''];
          if (key) errors[key] ??= f.message;
          else errors.general ??= f.message;
        }
        if (!fields.length) errors.general = err.message;
        return noStore(reply).status(err.statusCode).send(formPage(values, errors));
      }
    },
  );
};
