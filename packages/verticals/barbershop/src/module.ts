import { defineVerticalModule, type ContentTemplateSet, type MessageFragment, type VerticalModule } from '@autocontent/verticals-core';
import { z } from 'zod';
import { barbershopCatalog } from './templates.js';
import { haircutAnalysisSchema, type HaircutAnalysis } from './entities/haircut-analysis.js';
import { barbershopMessages } from './i18n.js';
import { barbershopWorkflow } from './workflow.js';

const configSchema = z.object({}).default({});
export type BarbershopConfig = z.infer<typeof configSchema>;

function contentTemplates(): ContentTemplateSet {
  const catalog = barbershopCatalog();
  return {
    templates: [...catalog.templates.values()],
    formats: [...catalog.formats.values()],
    videoStyles: [...catalog.videoStyles.values()],
  };
}

export const barbershopModule: VerticalModule<BarbershopConfig, HaircutAnalysis> = defineVerticalModule({
  slug: 'barbershop',
  displayName: 'Barbershop',
  configSchema,
  entities: [{ name: 'Haircut', zodSchema: haircutAnalysisSchema }],
  workflow: barbershopWorkflow,
  storagePathSegment: 'haircuts',
  contentTemplates: contentTemplates(),
  routes: [],
  messages: {
    es: barbershopMessages('es') as unknown as MessageFragment,
    pt: barbershopMessages('pt') as unknown as MessageFragment,
    en: barbershopMessages('en') as unknown as MessageFragment,
  },
});
