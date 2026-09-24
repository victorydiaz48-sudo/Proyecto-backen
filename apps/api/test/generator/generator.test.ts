// Fase 13: el generador gana "URL del sistema de reservas" + "identificador del negocio".
// Regla principal: sin esos campos, la página generada es EXACTAMENTE la misma que antes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baselineInputs, loadGenerator } from './load.ts';

const lib = loadGenerator();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Hashes de las páginas generadas con el generador ANTES de la Fase 13 (congelados). */
const BASELINE = JSON.parse(readFileSync(join(import.meta.dirname, 'baseline-hashes.json'), 'utf8')) as Record<string, string>;
const api = { apiUrl: 'https://reservas.example.com/', apiSlug: 'Barbearia-Central' };
const cfgOf = (html: string) => {
  const m = /var cfg=(\{.*?\});run\(document,cfg\)/.exec(html) ?? /run\(document,(\{.*\})\);\}\)\(\);/.exec(html);
  return JSON.parse(m![1]!) as { book: null | { api?: { base: string; slug: string } } };
};

describe('sin conexión al backend nada cambia', () => {
  for (const [name, input] of Object.entries(baselineInputs(lib))) {
    it(`"${name}" genera byte a byte la misma página que antes de la Fase 13`, () => {
      expect(sha(lib.buildPage(input))).toBe(BASELINE[name]);
    });
  }

  it('un JSON exportado antes de la Fase 13 (sin los campos nuevos) sigue funcionando igual', () => {
    const old = { app: 'gpc', v: 4, ...lib.DEMO };
    expect(lib.sanitize(old)).toMatchObject({ apiUrl: '', apiSlug: '' });
    expect(sha(lib.buildPage(old))).toBe(BASELINE.barberia_demo);
  });
});

describe('con conexión al backend', () => {
  it('añade la configuración de la API (URL sin barra final, slug en minúsculas) y el runtime conectado', () => {
    const html = lib.buildPage({ ...lib.DEMO, cta: 'book', ...api });
    expect(cfgOf(html).book?.api).toMatchObject({ base: 'https://reservas.example.com', slug: 'barbearia-central' });
    expect(html).toContain('function bookingApiRuntime(');
    expect(html).toContain('id="bkSlots"');
    expect(html).toContain('id="bkConfirm"');
    // Se mantiene el flujo de WhatsApp como alternativa (si la API no responde).
    expect(html).toContain('id="bkGo"');
    expect(html).toContain('id="bkTime"');
  });

  it('permite la reserva aunque la página no tenga WhatsApp ni servicios escritos (los da el backend)', () => {
    const html = lib.buildPage({ nombre: 'Barbería X', cat: 'barber', cta: 'book', ...api });
    expect(html).toContain('class="cta" data-bkopen');
    expect(cfgOf(html).book?.api?.slug).toBe('barbearia-central');
    const withoutApi = lib.buildPage({ nombre: 'Barbería X', cat: 'barber', cta: 'book' });
    expect(withoutApi).not.toContain('class="cta" data-bkopen');
  });

  it('con varios locales: botón de reserva además de los botones de WhatsApp por local', () => {
    const inputs = baselineInputs(lib);
    const multi = { ...inputs.barberia_multilocal!, cta: 'book' };
    expect(lib.buildPage(multi)).not.toContain('class="cta" data-bkopen');
    const html = lib.buildPage({ ...multi, ...api });
    expect(html).toContain('class="cta" data-bkopen');
    expect(html).toContain('id="bkLoc"');
    expect(html.match(/class="cta" href="https:\/\/wa\.me\//g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('valida la dirección y el identificador; con datos incompletos no conecta nada', () => {
    const iss = (over: object) => lib.analyze({ ...lib.DEMO, ...over }).iss;
    expect(iss({ apiUrl: 'reservas.example.com', apiSlug: 'ok-slug' }).apiUrl?.code).toBe('apiUrl');
    expect(iss({ apiUrl: 'http://reservas.example.com', apiSlug: 'ok-slug' }).apiUrl?.code).toBe('apiUrl');
    expect(iss({ apiUrl: 'https://x.com?a=1', apiSlug: 'ok-slug' }).apiUrl?.code).toBe('apiUrl');
    expect(iss({ apiUrl: 'https://u:p@x.com', apiSlug: 'ok-slug' }).apiUrl?.code).toBe('apiUrl');
    expect(iss({ apiUrl: '', apiSlug: 'ok-slug' }).apiUrl?.code).toBe('apiUrl_empty');
    expect(iss({ apiUrl: 'https://x.com', apiSlug: 'Con Espacios' }).apiSlug?.code).toBe('apiSlug');
    expect(iss({ apiUrl: 'https://x.com', apiSlug: '' }).apiSlug?.code).toBe('apiSlug_empty');
    expect(iss({ apiUrl: 'https://x.com/reservas/', apiSlug: 'ok-slug' }).apiUrl).toBeUndefined();
    // http solo para pruebas en local
    expect(iss({ apiUrl: 'http://localhost:3000', apiSlug: 'ok-slug' }).apiUrl).toBeUndefined();
    expect(iss({ apiUrl: 'http://127.0.0.1:3000', apiSlug: 'ok-slug' }).apiUrl).toBeUndefined();
    const broken = lib.buildPage({ ...lib.DEMO, cta: 'book', apiUrl: 'nada', apiSlug: 'ok-slug' });
    expect(broken).not.toContain('bookingApiRuntime');
  });

  it('el identificador y la URL se escapan: no se puede inyectar HTML ni JS en la página', () => {
    const html = lib.buildPage({ ...lib.DEMO, cta: 'book', apiUrl: 'https://x.com/</script><script>alert(1)</script>', apiSlug: 'ok-slug' });
    expect(html).not.toContain('<script>alert(1)');
  });
});
