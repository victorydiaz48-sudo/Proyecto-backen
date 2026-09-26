import { z } from 'zod';
import { formatSchema, templateSchema, videoStyleSchema, type ContentFormat, type ContentTemplate, type VideoStyle } from './schema.js';

export * from './schema.js';

/**
 * Generic template-catalogue machinery: validates a set of templates (plus
 * the formats/video styles they reference) at startup, including
 * cross-references. Each vertical module ships its own JSON templates
 * (e.g. `packages/verticals/dealership/templates/*`) and calls this to build
 * its own catalogue — this package has no opinion on what a template is for.
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
