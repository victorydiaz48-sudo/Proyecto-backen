import { createHash } from 'node:crypto';
import {
  computeMissingInformation,
  vehicleAnalysisSchema,
  type BodyType,
  type Locale,
  type Segment,
  type Tagged,
  type VehicleAnalysis,
} from '@autocontent/shared';
import type { ProviderStatus } from '../status.js';
import type { VisionInput, VisionProvider } from './types.js';

type L10n = Record<Locale, string>;

interface MockSample {
  make: Tagged<string>;
  model: Tagged<string>;
  version: Tagged<string>;
  year: Tagged<number>;
  color: Tagged<L10n>;
  body_type: Tagged<BodyType>;
  estimated_segment: Tagged<Segment>;
  features: { value: L10n; source: 'detected' | 'inferred' }[];
  details: L10n[];
  confidence: number;
}

const unknown = { value: null, source: 'unknown' } as const;

/**
 * Fixed catalogue of plausible results. The same photo always maps to the same
 * sample (hash of the bytes), so a demo is repeatable. One sample deliberately
 * leaves fields unknown to exercise the "never invent facts" path.
 */
const SAMPLES: MockSample[] = [
  {
    make: { value: 'Toyota', source: 'detected', confidence: 0.94 },
    model: { value: 'Corolla', source: 'detected', confidence: 0.9 },
    version: { value: 'XEI', source: 'inferred', confidence: 0.55 },
    year: { value: 2021, source: 'inferred', confidence: 0.6 },
    color: { value: { es: 'blanco perla', pt: 'branco pérola', en: 'pearl white' }, source: 'detected', confidence: 0.92 },
    body_type: { value: 'sedan', source: 'detected', confidence: 0.97 },
    estimated_segment: { value: 'mid-range', source: 'inferred', confidence: 0.8 },
    features: [
      { value: { es: 'faros LED', pt: 'faróis de LED', en: 'LED headlights' }, source: 'detected' },
      { value: { es: 'llantas de aleación', pt: 'rodas de liga leve', en: 'alloy wheels' }, source: 'detected' },
      { value: { es: 'parrilla cromada', pt: 'grade cromada', en: 'chrome grille' }, source: 'detected' },
    ],
    details: [{ es: 'vista frontal tres cuartos', pt: 'vista frontal três quartos', en: 'front three-quarter view' }],
    confidence: 0.9,
  },
  {
    make: { value: 'BMW', source: 'detected', confidence: 0.96 },
    model: { value: 'X5', source: 'detected', confidence: 0.88 },
    version: { value: 'M Sport', source: 'inferred', confidence: 0.6 },
    year: { value: 2022, source: 'inferred', confidence: 0.55 },
    color: { value: { es: 'negro zafiro', pt: 'preto safira', en: 'sapphire black' }, source: 'detected', confidence: 0.9 },
    body_type: { value: 'suv', source: 'detected', confidence: 0.98 },
    estimated_segment: { value: 'luxury', source: 'inferred', confidence: 0.85 },
    features: [
      { value: { es: 'parrilla de doble riñón', pt: 'grade duplo rim', en: 'kidney grille' }, source: 'detected' },
      { value: { es: 'llantas de 21 pulgadas', pt: 'rodas aro 21', en: '21-inch wheels' }, source: 'inferred' },
      { value: { es: 'faros láser', pt: 'faróis a laser', en: 'laser headlights' }, source: 'inferred' },
      { value: { es: 'techo panorámico', pt: 'teto panorâmico', en: 'panoramic roof' }, source: 'detected' },
    ],
    details: [{ es: 'vista lateral', pt: 'vista lateral', en: 'side view' }],
    confidence: 0.88,
  },
  {
    make: { value: 'Ford', source: 'detected', confidence: 0.95 },
    model: { value: 'Ranger', source: 'detected', confidence: 0.87 },
    version: { value: 'Raptor', source: 'detected', confidence: 0.8 },
    year: unknown,
    color: { value: { es: 'gris conquista', pt: 'cinza conquista', en: 'conquer grey' }, source: 'detected', confidence: 0.85 },
    body_type: { value: 'pickup', source: 'detected', confidence: 0.99 },
    estimated_segment: { value: 'sport', source: 'inferred', confidence: 0.75 },
    features: [
      { value: { es: 'neumáticos todoterreno', pt: 'pneus off-road', en: 'all-terrain tyres' }, source: 'detected' },
      { value: { es: 'pasos de rueda ensanchados', pt: 'para-lamas alargados', en: 'flared wheel arches' }, source: 'detected' },
    ],
    details: [{ es: 'vista frontal', pt: 'vista frontal', en: 'front view' }],
    confidence: 0.86,
  },
  {
    // Low-confidence case: brand visible, model not identifiable.
    make: { value: 'Volkswagen', source: 'detected', confidence: 0.7 },
    model: unknown,
    version: unknown,
    year: unknown,
    color: { value: { es: 'rojo', pt: 'vermelho', en: 'red' }, source: 'detected', confidence: 0.9 },
    body_type: { value: 'hatchback', source: 'detected', confidence: 0.8 },
    estimated_segment: unknown,
    features: [{ value: { es: 'logotipo VW visible', pt: 'logotipo VW visível', en: 'visible VW badge' }, source: 'detected' }],
    details: [{ es: 'vista trasera parcial', pt: 'vista traseira parcial', en: 'partial rear view' }],
    confidence: 0.45,
  },
];

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock-vision';

  constructor(private readonly opts: { latencyMs?: number } = {}) {}

  async analyze(input: VisionInput): Promise<VehicleAnalysis> {
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const digest = createHash('sha256').update(input.image).digest();
    const sample = SAMPLES[digest.readUInt32BE(0) % SAMPLES.length]!;
    const loc = input.locale;
    const base = {
      make: sample.make,
      model: sample.model,
      version: sample.version,
      year: sample.year,
      color:
        sample.color.value === null
          ? { value: null, source: 'unknown' as const }
          : { ...sample.color, value: sample.color.value[loc] },
      body_type: sample.body_type,
      estimated_segment: sample.estimated_segment,
      visual_features: sample.features.map((f) => ({ value: f.value[loc], source: f.source })),
      visible_details: sample.details.map((d) => d[loc]),
      confidence: sample.confidence,
      provider: this.name,
    };
    // Validate against the same contract a real provider must meet.
    return vehicleAnalysisSchema.parse({ ...base, missing_information: computeMissingInformation(base) });
  }

  async testConnection(): Promise<ProviderStatus> {
    return { provider: this.name, state: 'CONNECTED', detail: 'Mock provider (MOCK_MODE)', latencyMs: 0 };
  }
}
