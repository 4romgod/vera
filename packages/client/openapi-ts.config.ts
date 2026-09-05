import { fileURLToPath } from 'node:url';

import { defineConfig, type UserConfig } from '@hey-api/openapi-ts';

const openApiDocumentPath = fileURLToPath(
  new URL('../../apps/api/openapi/vera.openapi.json', import.meta.url),
);
const generatedClientPath = fileURLToPath(
  new URL('./src/generated', import.meta.url),
);

export function createVeraClientGeneratorConfig(
  outputPath = generatedClientPath,
): UserConfig {
  return {
    input: openApiDocumentPath,
    output: {
      header: ({ defaultValue }) => [
        '/* eslint-disable */',
        '// @ts-nocheck -- generated code is checked through its typed public surface',
        ...defaultValue,
      ],
      module: { extension: '.ts' },
      path: outputPath,
      postProcess: ['prettier'],
    },
    plugins: [
      '@hey-api/typescript',
      {
        name: '@hey-api/client-axios',
        bundle: true,
      },
      {
        name: 'zod',
        compatibilityVersion: 4,
      },
      {
        name: '@hey-api/sdk',
        auth: false,
        client: '@hey-api/client-axios',
        validator: { response: 'zod' },
      },
    ],
  };
}

export default defineConfig(createVeraClientGeneratorConfig());
