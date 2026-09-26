import type { FieldSource, Locale, Tagged } from '@autocontent/shared';
import { escapeHtml, messages } from '@autocontent/shared';
import { barbershopMessages } from './i18n.js';
import type { HaircutAnalysis } from './entities/haircut-analysis.js';

const SOURCE_ICON: Record<FieldSource, string> = {
  detected: '✅',
  inferred: '🔎',
  'user-provided': '👤',
  unknown: '❔',
};

/** Human-readable analysis for the barbershop employee. */
export function formatSubjectForDisplay(a: HaircutAnalysis, locale: Locale, opts: { mock: boolean }): string {
  const m = messages(locale);
  const bm = barbershopMessages(locale);
  const tag = (s: FieldSource) => `${SOURCE_ICON[s]} <i>${m.sources[s]}</i>`;
  const row = <T,>(label: string, f: Tagged<T>, render: (v: T) => string = (v) => String(v)) =>
    f.value === null ? null : `<b>${label}:</b> ${escapeHtml(render(f.value))} · ${tag(f.source)}`;

  const lines: (string | null)[] = [
    `💇 <b>${escapeHtml(a.style.value ? bm.hairstyles[a.style.value] : bm.labels.unidentified)}</b>`,
    '',
    row(bm.labels.color, a.color),
    `<b>${bm.labels.confidence}:</b> ${Math.round(a.confidence * 100)}%`,
    '',
    `<b>${bm.labels.missing}:</b> ${a.missing_information.map((k) => bm.missingFields[k]).join(', ')}`,
  ];
  if (opts.mock) lines.push('', m.mockNotice);

  return lines.filter((l): l is string => l !== null).join('\n');
}
