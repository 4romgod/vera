import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { loadEnvironmentFile } from '../src/environment.ts';

void describe('environment file loading', () => {
  void it('loads variables from an explicit environment file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-env-'));
    const path = join(directory, '.env');
    const key = `VERA_TEST_${randomUUID().replaceAll('-', '_')}`;

    try {
      await writeFile(path, `${key}=loaded\n`, 'utf8');
      const result = loadEnvironmentFile(path);

      assert.deepEqual(result, { loaded: true, path });
      assert.equal(process.env[key], 'loaded');
    } finally {
      Reflect.deleteProperty(process.env, key);
      await rm(directory, { recursive: true, force: true });
    }
  });

  void it('allows the project environment file to be absent', () => {
    const path = join(tmpdir(), `missing-${randomUUID()}`, '.env');
    assert.deepEqual(loadEnvironmentFile(path), { loaded: false, path });
  });
});
