import { defineVerticalModule, type ContentTemplateSet, type MessageFragment, type VerticalModule } from '@autocontent/verticals-core';
import { z } from 'zod';
import { automotiveCatalog } from './templates.js';
import { dealershipRoutes } from './contracts.js';
import { vehicleAnalysisSchema, type VehicleAnalysis } from './entities/vehicle-analysis.js';
import { dealershipMessages } from './i18n.js';
import { dealershipWorkflow } from './workflow.js';

const configSchema = z.object({}).default({});
export type DealershipConfig = z.infer<typeof configSchema>;

function contentTemplates(): ContentTemplateSet {
  const catalog = automotiveCatalog();
  return {
    templates: [...catalog.templates.values()],
    formats: [...catalog.formats.values()],
    videoStyles: [...catalog.videoStyles.values()],
  };
}

export const dealershipModule: VerticalModule<DealershipConfig, VehicleAnalysis> = defineVerticalModule({
  slug: 'dealership',
  displayName: 'Car dealership',
  configSchema,
  entities: [{ name: 'Vehicle', zodSchema: vehicleAnalysisSchema }],
  workflow: dealershipWorkflow,
  storagePathSegment: 'vehicles',
  contentTemplates: contentTemplates(),
  // Not yet merged into the live core route table at server startup — no
  // handler consumes any REST route before Phase 6 — but declared here so
  // that whichever phase wires route merging finds them.
  routes: dealershipRoutes,
  messages: {
    es: dealershipMessages('es') as unknown as MessageFragment,
    pt: dealershipMessages('pt') as unknown as MessageFragment,
    en: dealershipMessages('en') as unknown as MessageFragment,
  },
});
