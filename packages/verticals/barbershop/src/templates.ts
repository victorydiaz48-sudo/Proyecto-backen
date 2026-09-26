import { buildCatalog, TemplateCatalogError, type TemplateCatalog } from '@autocontent/templates';
import formatsFile from '../templates/formats.json' with { type: 'json' };
import freshCut from '../templates/fresh-cut/template.json' with { type: 'json' };
import videoStylesFile from '../templates/video-styles.json' with { type: 'json' };

export { TemplateCatalogError };
export const DEFAULT_TEMPLATE_SLUG = 'fresh-cut';

let cached: TemplateCatalog | undefined;

/** The barbershop module's built-in template catalogue (validated once, then cached). */
export function barbershopCatalog(): TemplateCatalog {
  cached ??= buildCatalog({ templates: [freshCut], formats: formatsFile, videoStyles: videoStylesFile });
  return cached;
}

export function getTemplate(slug: string) {
  const t = barbershopCatalog().templates.get(slug);
  if (!t) throw new TemplateCatalogError(`Unknown template "${slug}"`);
  return t;
}
