import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from '../src/openapi.js';

// Regenerates docs/api/openapi.json. A test fails if the committed file is stale.
const out = join(import.meta.dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n');
console.log(`wrote ${out}`);
