import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadEnvironmentFile,
  loadEnvironmentFiles,
} from '../../src/bootstrap/environment.ts';

void describe('environment file loading', () => {
  void it('resolves the default environment file from the repository root', () => {
    const result = loadEnvironmentFile();

    assert.equal(
      result.path,
      fileURLToPath(new URL('../../../../.env', import.meta.url)),
    );
  });

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

  void it('loads shell, selected profile, and shared values in that order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-profiles-'));
    const shellKey = `VERA_TEST_SHELL_${randomUUID().replaceAll('-', '_')}`;
    const profileKey = `VERA_TEST_PROFILE_${randomUUID().replaceAll('-', '_')}`;
    const baseKey = `VERA_TEST_BASE_${randomUUID().replaceAll('-', '_')}`;
    process.env[shellKey] = 'shell';

    try {
      await writeFile(
        join(directory, '.env'),
        `${shellKey}=base\n${profileKey}=base\n${baseKey}=base\n`,
        'utf8',
      );
      await writeFile(
        join(directory, '.env.openai'),
        `${shellKey}=profile\n${profileKey}=profile\n`,
        'utf8',
      );

      const result = loadEnvironmentFiles({
        rootDirectory: directory,
        profile: 'OpenAI',
      });

      assert.equal(result.profile, 'openai');
      assert.equal(result.profileFile?.loaded, true);
      assert.equal(result.baseFile.loaded, true);
      assert.equal(process.env[shellKey], 'shell');
      assert.equal(process.env[profileKey], 'profile');
      assert.equal(process.env[baseKey], 'base');
    } finally {
      Reflect.deleteProperty(process.env, shellKey);
      Reflect.deleteProperty(process.env, profileKey);
      Reflect.deleteProperty(process.env, baseKey);
      await rm(directory, { recursive: true, force: true });
    }
  });

  void it('fails closed when a selected profile is missing or unsafe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-profiles-'));
    try {
      assert.throws(
        () =>
          loadEnvironmentFiles({
            rootDirectory: directory,
            profile: 'missing',
          }),
        /does not exist/u,
      );
      assert.throws(
        () =>
          loadEnvironmentFiles({
            rootDirectory: directory,
            profile: '../openai',
          }),
        /must contain only/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
