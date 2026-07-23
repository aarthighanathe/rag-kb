/**
 * @file validate-swagger.ts
 * @description Validates the in-memory OpenAPI spec exported from src/swagger/spec.ts.
 *   Run with: npm run swagger-validate
 */

import swaggerParser from '@apidevtools/swagger-parser';
import { swaggerSpec } from '../src/swagger/spec.js';

void (async () => {
  try {
    await swaggerParser.validate(swaggerSpec as Parameters<typeof swaggerParser.validate>[0]);
    console.log('Swagger spec is valid');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
})();
