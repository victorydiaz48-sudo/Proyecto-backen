import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_SLUG, TemplateCatalogError, automotiveCatalog, buildCatalog, getTemplate } from './index.js';

describe('automotive template catalogue', () => {
  const catalog = automotiveCatalog();

  it('ships the five required templates, all valid', () => {
    expect([...catalog.templates.keys()].sort()).toEqual(
      ['aggressive-sport', 'cinematic-luxury', 'fast-sale', 'minimalist', 'premium-dealership'].sort(),
    );
    expect(getTemplate(DEFAULT_TEMPLATE_SLUG).name).toBe('Premium Dealership');
  });

  it('ships the seven selectable video styles', () => {
    expect([...catalog.videoStyles.keys()].sort()).toEqual(
      ['aggressive-sport', 'cinematic-luxury', 'fast-sales', 'minimalist', 'night-luxury', 'premium-dealership', 'urban'].sort(),
    );
  });

  it('has CTA examples in every supported language and no invented claims', () => {
    for (const t of catalog.templates.values()) {
      for (const lang of ['es', 'pt', 'en'] as const) {
        for (const cta of t.ctaStrategy.examples[lang]) {
          // CTAs must not promise facts the dealership didn't give (price, financing, warranty…).
          expect(cta, `${t.slug}/${lang}`).not.toMatch(/\d|%|\$|€|financ|garant|warrant|últim|last unit/i);
        }
      }
    }
  });

  it('rejects templates that reference unknown formats or styles', () => {
    const good = getTemplate('minimalist');
    const files = { formats: { formats: [...catalog.formats.values()] }, videoStyles: { styles: [...catalog.videoStyles.values()] } };
    expect(() => buildCatalog({ ...files, templates: [{ ...good, formats: ['tiktok_dance'] }] })).toThrow(TemplateCatalogError);
    expect(() => buildCatalog({ ...files, templates: [{ ...good, videoStyles: ['vaporwave'] }] })).toThrow(TemplateCatalogError);
    expect(() => buildCatalog({ ...files, templates: [{ ...good, version: 'v1' }] })).toThrow(/version/);
  });

  it('rejects unknown template slugs', () => {
    expect(() => getTemplate('nope')).toThrow(TemplateCatalogError);
  });
});
