import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src',
);

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(root, entry.name);
        return entry.isDirectory()
          ? sourceFiles(path)
          : path.endsWith('.ts')
            ? [path]
            : [];
      }),
    )
  ).flat();
}

function moduleRole(path: string): string {
  const parts = relative(sourceRoot, path).split(sep);
  if (parts[0] === 'adapters') return parts.slice(0, 2).join('/');
  return parts[0] ?? '';
}

const allowedDependencies = new Map<string, Set<string>>([
  ['domain', new Set(['domain'])],
  ['ports', new Set(['domain', 'ports'])],
  ['application', new Set(['application', 'domain', 'ports'])],
  ['adapters/outbound', new Set(['adapters/outbound', 'domain', 'ports'])],
  [
    'adapters/inbound',
    new Set(['adapters/inbound', 'application', 'domain', 'ports']),
  ],
  [
    'bootstrap',
    new Set([
      'adapters/inbound',
      'adapters/outbound',
      'application',
      'bootstrap',
      'domain',
      'ports',
    ]),
  ],
  ['server.ts', new Set(['bootstrap'])],
]);

void describe('API module boundaries', () => {
  void it('keeps source files in explicit architectural roles', async () => {
    const files = await sourceFiles(sourceRoot);
    const topLevel = new Set(
      files.map((path) => relative(sourceRoot, path).split(sep)[0]),
    );
    assert.deepEqual([...topLevel].sort(), [
      'adapters',
      'application',
      'bootstrap',
      'domain',
      'ports',
      'server.ts',
    ]);
  });

  void it('prevents inward layers from depending on outward implementations', async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(sourceRoot)) {
      const sourceRole = moduleRole(file);
      const allowed = allowedDependencies.get(sourceRole);
      assert.ok(allowed, `No dependency rule exists for ${sourceRole}.`);
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(
        /(?:from\s+|import\()(['"])(\.\.?\/[^'"\n]+\.ts)\1/gu,
      )) {
        const specifier = match[2];
        if (specifier === undefined) {
          throw new Error(`Could not parse a relative import in ${file}.`);
        }
        const target = resolve(dirname(file), specifier);
        const targetRole = moduleRole(target);
        if (!allowed.has(targetRole)) {
          violations.push(
            `${relative(sourceRoot, file)} (${sourceRole}) -> ${relative(sourceRoot, target)} (${targetRole})`,
          );
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
