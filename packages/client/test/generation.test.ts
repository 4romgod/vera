import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { describe, it } from 'node:test';

const generatedDirectory = new URL('../src/generated/', import.meta.url);
const packageJsonUrl = new URL('../package.json', import.meta.url);

void describe('generated client source', () => {
  void it('uses TypeScript module specifiers that Metro can resolve', async () => {
    const entries = await readdir(generatedDirectory, { recursive: true });
    const sources = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => readFile(new URL(entry, generatedDirectory), 'utf8')),
    );

    assert.ok(sources.length > 0);
    for (const source of sources) {
      assert.doesNotMatch(source, /from ['"]\.{1,2}\/[^'"]+\.js['"]/u);
    }
  });

  void it('generates once before concurrent consumer lifecycle commands', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts;

    assert.ok(scripts);
    assert.equal(scripts.prepare, 'npm run client:generate');
    assert.equal(scripts.prebuild, undefined);
    assert.equal(scripts.pretest, undefined);
    assert.equal(scripts.pretypecheck, undefined);
  });
});
