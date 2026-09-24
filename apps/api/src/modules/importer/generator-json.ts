// Importa en el backend los datos exportados por el generador (JSON {"app":"gpc","v":4,...}).
// Interpreta los textos libres igual que el generador (servicios "Nombre | Precio | Descripción",
// equipo "Nombre | Cargo | Bio | servicios", horarios hd0..hd6, locales adicionales) y avisa de todo lo
// que no puede interpretar con seguridad, sin inventar datos.
import { z } from 'zod';
import { toE164 } from '../../lib/phone.ts';
import { isValidTimeZone } from '../../lib/validation.ts';

export interface ImportOptions {
  /** Duración que se asigna a todos los servicios (el generador no la tiene). */
  durationMinutes: number;
  /** Moneda si no se puede deducir del país. */
  currency?: string | undefined;
}

export interface PlannedLocation {
  name: string;
  address: string | null;
  mapsUrl: string | null;
  whatsapp: string | null;
  /** Horario del local (semana) como lo escribió el negocio. */
  hours: { weekday: number; startMinute: number; endMinute: number }[];
}

export interface ImportPlan {
  tenant: { name: string; timezone: string; defaultCountryCode: string; currency: string; locale: string };
  locations: PlannedLocation[];
  services: { name: string; description: string | null; category: string | null; priceCents: number; durationMinutes: number; sortOrder: number }[];
  professionals: { displayName: string; title: string | null; bio: string | null; sortOrder: number; serviceNames: string[] }[];
  warnings: string[];
}

const Raw = z
  .object({
    app: z.literal('gpc').optional(),
    v: z.number().optional(),
    nombre: z.string().default(''),
    lang: z.enum(['pt', 'es']).catch('pt'),
    cc: z.string().default('55'),
    wa: z.string().default(''),
    tz: z.string().default('America/Sao_Paulo'),
    cat: z.string().default('general'),
    servicios: z.string().default(''),
    team: z.string().default(''),
    dir: z.string().default(''),
    mapsUrl: z.string().default(''),
    locName: z.string().default(''),
    locations: z.string().default(''),
  })
  .passthrough();

const CURRENCY_BY_CC: Record<string, string> = {
  '55': 'BRL', '351': 'EUR', '34': 'EUR', '52': 'MXN', '54': 'ARS', '56': 'CLP', '57': 'COP', '51': 'PEN', '598': 'UYU', '1': 'USD',
};

function localeFor(lang: 'pt' | 'es', cc: string): string {
  if (lang === 'pt') return cc === '351' ? 'pt-PT' : 'pt-BR';
  return ({ '52': 'es-MX', '54': 'es-AR' } as Record<string, string>)[cc] ?? 'es-ES';
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s: string): number | null => {
  const m = CLOCK.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** "HH:MM-HH:MM" del generador → intervalos del backend. "00:00-00:00" = 24 h; cierre ≤ apertura = cruza medianoche. */
export function parseDayRange(weekday: number, text: string): { weekday: number; startMinute: number; endMinute: number }[] {
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(text.trim());
  if (!m) return [];
  const a = toMin(m[1]!);
  const b = toMin(m[2]!);
  if (a === null || b === null) return [];
  if (a === b) return [{ weekday, startMinute: 0, endMinute: 1440 }];
  if (a < b) return [{ weekday, startMinute: a, endMinute: b }];
  const out = [{ weekday, startMinute: a, endMinute: 1440 }];
  if (b > 0) out.push({ weekday: (weekday + 1) % 7, startMinute: 0, endMinute: b });
  return out;
}

/** Precio escrito a mano → céntimos. "R$ 45" → 4500, "45,50" → 4550, "€12.5" → 1250. */
export function parsePrice(text: string): number | null {
  const s = text.replace(/[^\d,.]/g, '');
  if (!/\d/.test(s)) return null;
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const normalized = last >= 0 && s.length - last - 1 <= 2 ? `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}` : s.replace(/[.,]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const MARKER = /^(destacado|destaque|hot|top)$|^tam(anho|año)?\s*:|^(sab(or)?|op(c|ç)(i[oó]n|ão)?)\s*:/i;

export function planImport(json: unknown, opts: ImportOptions): ImportPlan {
  const parsed = Raw.safeParse(json);
  if (!parsed.success) throw new Error('El archivo no parece un JSON exportado por el generador.');
  const d = parsed.data;
  const warnings: string[] = [];
  const cc = d.cc.replace(/\D/g, '') || '55';

  const name = d.nombre.trim().slice(0, 80);
  if (!name) throw new Error('El JSON no tiene nombre de negocio.');
  const timezone = isValidTimeZone(d.tz) ? d.tz : 'America/Sao_Paulo';
  if (timezone !== d.tz) warnings.push(`Zona horaria "${d.tz}" no válida: se usa ${timezone}.`);
  const currency = (opts.currency ?? CURRENCY_BY_CC[cc])?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error(`No se puede deducir la moneda del país ${cc}: indica --currency (p. ej. BRL).`);
  if (['food', 'restaurant', 'cafe', 'bakery'].includes(d.cat)) warnings.push('El negocio es de comida: las reservas por cita pueden no aplicar.');

  // Servicios
  const services: ImportPlan['services'] = [];
  let category: string | null = null;
  for (const line of d.servicios.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const cat = /^##\s*(.+)/.exec(line);
    if (cat) {
      category = cat[1]!.trim().slice(0, 40);
      continue;
    }
    const parts = line.split('|').map((p) => p.trim());
    const hasSizes = parts.some((p) => /^tam(anho|año)?\s*:/i.test(p)) || (parts[3]?.includes(':') ?? false);
    const clean = parts.filter((p) => !MARKER.test(p));
    const sname = (clean[0] ?? '').slice(0, 80);
    if (!sname) continue;
    if (services.some((s) => s.name.toLowerCase() === sname.toLowerCase())) {
      warnings.push(`Servicio repetido "${sname}": se importa una sola vez.`);
      continue;
    }
    let price = parsePrice(clean[1] ?? '');
    if (hasSizes) {
      warnings.push(`"${sname}" tiene tamaños/opciones: no se importan; precio a revisar.`);
      price = null;
    }
    if (price === null) {
      warnings.push(`"${sname}": precio "${clean[1] ?? ''}" no interpretable; se importa a 0, revísalo en el panel.`);
      price = 0;
    }
    services.push({ name: sname, description: clean[2] ? clean[2].slice(0, 200) : null, category, priceCents: price, durationMinutes: opts.durationMinutes, sortOrder: services.length });
  }
  if (services.length) warnings.push(`Todos los servicios se importan con ${opts.durationMinutes} min: ajusta la duración real de cada uno en el panel.`);

  // Equipo
  const professionals: ImportPlan['professionals'] = [];
  for (const line of d.team.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10)) {
    const parts = line.split('|').map((p) => p.trim());
    const displayName = (parts[0] ?? '').slice(0, 80);
    if (!displayName) continue;
    const wanted = (parts[3] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    let serviceNames = services.map((s) => s.name);
    if (wanted.length) {
      serviceNames = services.filter((s) => wanted.includes(s.name.toLowerCase())).map((s) => s.name);
      for (const w of wanted) if (!services.some((s) => s.name.toLowerCase() === w)) warnings.push(`${displayName}: el servicio "${w}" no existe en la lista de servicios.`);
    }
    professionals.push({ displayName, title: parts[1] || null, bio: parts[2] ? parts[2].slice(0, 400) : null, sortOrder: professionals.length, serviceNames });
  }
  if (!professionals.length) warnings.push('No hay equipo en el JSON: crea al menos un profesional en el panel para poder reservar.');

  // Locales y horarios
  const phone = (raw: string): string | null => {
    if (!raw.trim()) return null;
    const e = toE164(raw, cc);
    if (!e) warnings.push(`WhatsApp "${raw}" no válido: no se importa.`);
    return e;
  };
  const hoursOf = (texts: string[]) => texts.flatMap((t, weekday) => parseDayRange(weekday, t ?? ''));
  const mainHours = hoursOf(
    [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const v = (d as Record<string, unknown>)[`hd${i}`];
      return typeof v === 'string' ? v : '';
    }),
  );
  const locations: PlannedLocation[] = [
    { name: (d.locName.trim() || (d.lang === 'es' ? 'Principal' : 'Principal')).slice(0, 40), address: d.dir.trim().slice(0, 200) || null, mapsUrl: /^https:\/\//.test(d.mapsUrl) ? d.mapsUrl : null, whatsapp: phone(d.wa), hours: mainHours },
  ];
  for (const line of d.locations.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 7)) {
    const parts = line.split('|').map((p) => p.trim());
    if (!parts[0]) continue;
    locations.push({
      name: parts[0].slice(0, 40),
      address: parts[1] || null,
      mapsUrl: /^https:\/\//.test(parts[3] ?? '') ? parts[3]! : null,
      whatsapp: phone(parts[4] ?? ''),
      hours: hoursOf((parts[2] ?? '').split(',')),
    });
  }
  if (!mainHours.length) warnings.push('El local principal no tiene horario: los profesionales quedan sin horas de trabajo.');
  if (locations.length > 1) {
    warnings.push(
      'Hay varios locales: el generador no dice qué profesional trabaja en cada uno. Los profesionales se asignan al local principal; asigna los demás locales desde el panel (Profesionales → Horario).',
    );
  }

  return { tenant: { name, timezone, defaultCountryCode: cc, currency, locale: localeFor(d.lang, cc) }, locations, services, professionals, warnings };
}
