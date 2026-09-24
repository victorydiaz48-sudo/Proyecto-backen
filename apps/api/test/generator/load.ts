// Carga la librería del generador (todo lo que va antes de /*ENDLIB*/ en generador-pagina-contacto.html)
// para probarla en Node: sanitize, analyze y buildPage no tocan el DOM (solo lo hace el runtime de la
// página generada, que se ejecuta en el navegador).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GENERATOR_PATH = join(import.meta.dirname, '../../../../generador-pagina-contacto.html');

export interface GeneratorLib {
  buildPage: (raw: object, opt?: object) => string;
  sanitize: (raw: object) => Record<string, unknown>;
  analyze: (raw: object) => { iss: Record<string, { level: string; code: string }>; [k: string]: unknown };
  DEMO: Record<string, unknown>;
}

export function loadGenerator(source = readFileSync(GENERATOR_PATH, 'utf8')): GeneratorLib {
  const start = source.indexOf('/*LIB*/');
  const end = source.indexOf('/*ENDLIB*/');
  if (start < 0 || end < 0) throw new Error('No se encuentran los marcadores /*LIB*/ … /*ENDLIB*/ del generador');
  const code = source.slice(start, end);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${code}\nreturn { buildPage, sanitize, analyze, DEMO };`)() as GeneratorLib;
}

/** Entradas representativas para comprobar que el generador no cambia sin los campos nuevos. */
export function baselineInputs(lib: GeneratorLib): Record<string, object> {
  const demo = { ...lib.DEMO };
  return {
    barberia_demo: demo,
    barberia_reserva_formulario: { ...demo, cta: 'book', team: 'Carlos | Barbeiro sênior | | Corte, Barba\nAndré | Barbeiro', tz: 'America/Sao_Paulo' },
    barberia_multilocal: {
      ...demo,
      locName: 'Centro',
      locations: 'Batel | Av. Batel, 1000 | ,09:00-19:00,09:00-19:00,09:00-19:00,09:00-19:00,09:00-19:00,09:00-14:00 | | 41 98888-0000',
    },
    barberia_es: { ...demo, lang: 'es', nombre: 'Barbería Norte', cc: '34', wa: '612 34 56 78', tz: 'Europe/Madrid', hd6: '18:00-02:00' },
    restaurante_carrito: {
      v: 4, nombre: 'Cantina Boa', cat: 'restaurant', lang: 'pt', wa: '41 97777-6666', cta: 'menu', modeDelivery: true, modePickup: true,
      servicios: '## Pratos\nFeijoada | R$ 42 | Completa | destacado\nPizza | tam: P:30, G:45 | sab: Calabresa, Queijo',
    },
    vacio: {},
  };
}
