import type { Locale, Tagged } from '@autocontent/shared';
import { dealershipMessages } from '../i18n.js';
import type { AnalysisField, Segment, VehicleAnalysis } from '../entities/vehicle-analysis.js';
import { publishable } from './publishable.js';

/**
 * Phase 0 caption generator: deterministic, template-based, and restricted to
 * publishable facts. Phase 5 replaces this with the LLM-backed copywriting
 * engine; this version stays as the offline fallback used in MOCK_MODE.
 */

interface CaptionPack {
  fallbackTitle: string;
  hooks: Record<Segment | 'default', string>;
  color: string;
  cta: string;
  tag: string;
}

const PACKS: Record<Locale, CaptionPack> = {
  es: {
    fallbackTitle: 'Vehículo disponible',
    hooks: {
      economy: 'Práctico, eficiente y listo para el día a día.',
      'mid-range': 'El equilibrio perfecto entre confort y estilo.',
      premium: 'Calidad que se nota en cada detalle.',
      luxury: 'Elegancia y presencia en cada detalle.',
      sport: 'Diseñado para quienes disfrutan conducir.',
      utility: 'Preparado para el trabajo y la aventura.',
      default: 'Listo para su próximo dueño.',
    },
    color: 'Color',
    cta: '📩 Escríbenos para conocer precio y disponibilidad.',
    tag: 'AutosEnVenta',
  },
  pt: {
    fallbackTitle: 'Veículo disponível',
    hooks: {
      economy: 'Prático, econômico e pronto para o dia a dia.',
      'mid-range': 'O equilíbrio perfeito entre conforto e estilo.',
      premium: 'Qualidade que aparece em cada detalhe.',
      luxury: 'Elegância e presença em cada detalhe.',
      sport: 'Feito para quem gosta de dirigir.',
      utility: 'Pronto para o trabalho e para a aventura.',
      default: 'Pronto para o próximo dono.',
    },
    color: 'Cor',
    cta: '📩 Fale com a gente para saber preço e disponibilidade.',
    tag: 'CarrosAVenda',
  },
  en: {
    fallbackTitle: 'Vehicle available',
    hooks: {
      economy: 'Practical, efficient and ready for every day.',
      'mid-range': 'The perfect balance of comfort and style.',
      premium: 'Quality you can see in every detail.',
      luxury: 'Elegance and presence in every detail.',
      sport: 'Built for people who love to drive.',
      utility: 'Ready for work and adventure.',
      default: 'Ready for its next owner.',
    },
    color: 'Color',
    cta: '📩 Message us for price and availability.',
    tag: 'CarsForSale',
  },
};

export interface Caption {
  text: string;
  /** Analysis fields that ended up in the text, for traceability and QA. */
  usedFields: AnalysisField[];
}

function hashtag(s: string): string {
  const cleaned = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');
  return cleaned ? `#${cleaned}` : '';
}

export function generateCaption(a: VehicleAnalysis, locale: Locale): Caption {
  const pack = PACKS[locale];
  const used: AnalysisField[] = [];
  const pick = <T>(k: AnalysisField, tagged: Tagged<T>): T | null => {
    const v = publishable(k, tagged);
    if (v !== null) used.push(k);
    return v;
  };

  const make = pick('make', a.make);
  const model = pick('model', a.model);
  const version = pick('version', a.version);
  const year = pick('year', a.year);
  const color = pick('color', a.color);
  const body = pick('body_type', a.body_type);
  const segment = pick('estimated_segment', a.estimated_segment);

  const nameParts = [make, model, model ? version : null, year?.toString()].filter(Boolean);
  if (!model && body) nameParts.push(dealershipMessages(locale).bodyTypes[body]);
  const title = nameParts.length > 0 ? nameParts.join(' ') : pack.fallbackTitle;

  const lines = [`🚗 ${title}`, '', pack.hooks[segment ?? 'default'], ''];
  if (color) lines.push(`🎨 ${pack.color}: ${color}`);
  // Only features actually seen in the photo; inferred ones are not claims we can make.
  for (const f of a.visual_features.filter((f) => f.source === 'detected').slice(0, 3)) {
    lines.push(`✔️ ${f.value.charAt(0).toUpperCase()}${f.value.slice(1)}`);
  }
  lines.push('', pack.cta, '');
  lines.push([make, model].filter((x): x is string => !!x).map(hashtag).concat(`#${pack.tag}`).filter(Boolean).join(' '));

  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), usedFields: used };
}
