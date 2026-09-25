import { z } from 'zod';
import aggressiveSport from '../automotive/aggressive-sport/template.json' with { type: 'json' };
import cinematicLuxury from '../automotive/cinematic-luxury/template.json' with { type: 'json' };
import fastSale from '../automotive/fast-sale/template.json' with { type: 'json' };
import formatsFile from '../automotive/formats.json' with { type: 'json' };
import minimalist from '../automotive/minimalist/template.json' with { type: 'json' };
import premiumDealership from '../automotive/premium-dealership/template.json' with { type: 'json' };
import videoStylesFile from '../automotive/video-styles.json' with { type: 'json' };
import { formatSchema, templateSchema, videoStyleSchema, type ContentFormat, type ContentTemplate, type VideoStyle } from './schema.js';

export * from './schema.js';

/**
 * Templates live as JSON in packages/templates/automotive/<slug>/template.json
 * so they can be edited from GitHub's web editor. Everything is validated
 * here at startup, including cross-references (formats, video styles).
 */
export class TemplateCatalogError extends Error {
  override readonly name = 'TemplateCatalogError';
}

export interface TemplateCatalog {
  templates: Map<string, ContentTemplate>;
  formats: Map<string, ContentFormat>;
  videoStyles: Map<string, VideoStyle>;
}

export function buildCatalog(raw: { templates: unknown[]; formats: unknown; videoStyles: unknown }): TemplateCatalog {
  const formats = z.object({ formats: z.array(formatSchema) }).parse(raw.formats).formats;
  const styles = z.object({ styles: z.array(videoStyleSchema) }).parse(raw.videoStyles).styles;
  const catalog: TemplateCatalog = {
    templates: new Map(),
    formats: new Map(formats.map((f) => [f.id, f])),
    videoStyles: new Map(styles.map((s) => [s.id, s])),
  };
  if (catalog.formats.size !== formats.length) throw new TemplateCatalogError('Duplicate format id');
  if (catalog.videoStyles.size !== styles.length) throw new TemplateCatalogError('Duplicate video style id');

  for (const t of raw.templates) {
    const parsed = templateSchema.safeParse(t);
    if (!parsed.success) {
      const slug = (t as { slug?: string })?.slug ?? '?';
      throw new TemplateCatalogError(`Template "${slug}" is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const tpl = parsed.data;
    if (catalog.templates.has(tpl.slug)) throw new TemplateCatalogError(`Duplicate template "${tpl.slug}"`);
    for (const f of tpl.formats) {
      if (!catalog.formats.has(f)) throw new TemplateCatalogError(`Template "${tpl.slug}" uses unknown format "${f}"`);
    }
    for (const s of tpl.videoStyles) {
      if (!catalog.videoStyles.has(s)) throw new TemplateCatalogError(`Template "${tpl.slug}" uses unknown video style "${s}"`);
    }
    catalog.templates.set(tpl.slug, tpl);
  }
  return catalog;
}

export const DEFAULT_TEMPLATE_SLUG = 'premium-dealership';

let cached: TemplateCatalog | undefined;

/** The built-in automotive catalogue (validated once, then cached). */
export function automotiveCatalog(): TemplateCatalog {
  cached ??= buildCatalog({
    templates: [cinematicLuxury, aggressiveSport, premiumDealership, fastSale, minimalist],
    formats: formatsFile,
    videoStyles: videoStylesFile,
  });
  return cached;
}

export function getTemplate(slug: string): ContentTemplate {
  const t = automotiveCatalog().templates.get(slug);
  if (!t) throw new TemplateCatalogError(`Unknown template "${slug}"`);
  return t;
}
