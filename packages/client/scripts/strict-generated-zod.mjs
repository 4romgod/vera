import { readFile, writeFile } from 'node:fs/promises';

const generatedSchemaPath = new URL(
  '../src/generated/zod.gen.ts',
  import.meta.url,
);
const generated = await readFile(generatedSchemaPath, 'utf8');
const strict = generated.replace(/z\s*\.object\(/gu, 'z.strictObject(');
const serializable = strict.replace(
  'export const zTaskResource =',
  "export const zTaskResource: z.ZodType<import('./types.gen.ts').TaskResource> =",
);

if (strict === generated) {
  throw new Error('The generated Zod module contained no object schemas.');
}
if (serializable === strict) {
  throw new Error(
    'The generated Zod module contained no task resource schema.',
  );
}

await writeFile(generatedSchemaPath, serializable);
