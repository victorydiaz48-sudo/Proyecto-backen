import { buildCatalog, TemplateCatalogError, type TemplateCatalog } from '@autocontent/templates';
import aggressiveSport from '../templates/aggressive-sport/template.json' with { type: 'json' };
import cinematicLuxury from '../templates/cinematic-luxury/template.json' with { type: 'json' };
import fastSale from '../templates/fast-sale/template.json' with { type: 'json' };
import formatsFile from '../templates/formats.json' with { type: 'json' };
import minimalist from '../templates/minimalist/template.json' with { type: 'json' };
import premiumDealership from '../templates/premium-dealership/template.json' with { type: 'json' };
import videoStylesFile from '../templates/video-styles.json' with { type: 'json' };

export { TemplateCatalogError };
export const DEFAULT_TEMPLATE_SLUG = 'premium-dealership';

let cached: TemplateCatalog | undefined;

/**
 * The dealership module's built-in template catalogue (validated once, then
 * cached). Templates live as JSON in `templates/<slug>/template.json` so
 * they can be edited from GitHub's web editor.
 */
export function automotiveCatalog(): TemplateCatalog {
  cached ??= buildCatalog({
    templates: [cinematicLuxury, aggressiveSport, premiumDealership, fastSale, minimalist],
    formats: formatsFile,
    videoStyles: videoStylesFile,
  });
  return cached;
}

export function getTemplate(slug: string) {
  const t = automotiveCatalog().templates.get(slug);
  if (!t) throw new TemplateCatalogError(`Unknown template "${slug}"`);
  return t;
}
