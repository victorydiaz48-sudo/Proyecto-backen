import type { FieldSource, Locale, Tagged, VehicleAnalysis } from '@autocontent/shared';
import { escapeHtml, messages } from '@autocontent/shared';

const SOURCE_ICON: Record<FieldSource, string> = {
  detected: '✅',
  inferred: '🔎',
  'user-provided': '👤',
  unknown: '❔',
};

/**
 * Human-readable analysis for the dealership employee. Unlike public copy,
 * this shows inferred values too, each clearly labelled with its source.
 */
export function formatAnalysis(a: VehicleAnalysis, locale: Locale, opts: { mock: boolean }): string {
  const m = messages(locale);
  const L = m.labels;
  const tag = (s: FieldSource) => `${SOURCE_ICON[s]} <i>${m.sources[s]}</i>`;
  const row = <T,>(label: string, f: Tagged<T>, render: (v: T) => string = (v) => String(v)) =>
    f.value === null ? null : `<b>${label}:</b> ${escapeHtml(render(f.value))} · ${tag(f.source)}`;

  const name = [a.make.value, a.model.value].filter(Boolean).join(' ');
  const lines: (string | null)[] = [
    `🚗 <b>${escapeHtml(name || L.unidentified)}</b>`,
    '',
    row(L.version, a.version),
    row(L.year, a.year, (y) => (a.year.source === 'inferred' ? `${y} (${L.approx})` : String(y))),
    row(L.color, a.color),
    row(L.bodyType, a.body_type, (b) => m.bodyTypes[b]),
    row(L.segment, a.estimated_segment, (s) => m.segments[s]),
    `<b>${L.confidence}:</b> ${Math.round(a.confidence * 100)}%`,
  ];

  if (a.visual_features.length > 0) {
    lines.push('', `<b>${L.features}:</b>`);
    for (const f of a.visual_features) lines.push(`• ${escapeHtml(f.value)} ${SOURCE_ICON[f.source]}`);
  }

  lines.push('', `<b>${L.missing}:</b> ${a.missing_information.map((k) => m.missingFields[k]).join(', ')}`);
  if (opts.mock) lines.push('', m.mockNotice);

  return lines.filter((l): l is string => l !== null).join('\n');
}
