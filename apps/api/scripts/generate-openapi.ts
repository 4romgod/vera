import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

import { createOpenApiDocument } from '../src/adapters/inbound/http/openapi-document.ts';

const outputPath = resolve(process.cwd(), 'openapi/vera.openapi.json');
const document = await createOpenApiDocument();
const serialized = await format(JSON.stringify(document), {
  parser: 'json',
});
void JSON.parse(serialized);

if (process.argv.includes('--check')) {
  let existing: string;
  try {
    existing = await readFile(outputPath, 'utf8');
  } catch {
    throw new Error(
      `The generated OpenAPI artifact is missing. Run npm run openapi:generate.`,
    );
  }
  if (existing !== serialized)
    throw new Error(
      `The generated OpenAPI artifact is stale. Run npm run openapi:generate.`,
    );
  process.stdout.write(`OpenAPI artifact is up to date: ${outputPath}\n`);
  process.exit(0);
}

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, serialized, 'utf8');

process.stdout.write(`Generated ${outputPath}\n`);
