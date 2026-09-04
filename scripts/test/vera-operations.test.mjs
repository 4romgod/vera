import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertInside,
  backupArchiveName,
  createLaunchAgentPlist,
  parseArguments,
  serviceDefinitions,
  xmlEscape,
} from '../lib/vera-operations.mjs';
import { contentType, resolveFrontendPath } from '../static-frontend.mjs';

test('escapes launch-agent XML without interpolating secret configuration', () => {
  assert.equal(xmlEscape(`a&<b>"'`), 'a&amp;&lt;b&gt;&quot;&apos;');
  const plist = createLaunchAgentPlist({
    Label: 'dev.vera.test',
    ProgramArguments: ['/tmp/a&b/node', 'server.js'],
    EnvironmentVariables: { VERA_PROFILE: 'ollama' },
    KeepAlive: true,
  });
  assert.match(plist, /\/tmp\/a&amp;b\/node/u);
  assert.match(plist, /<true\/>/u);
  assert.doesNotMatch(plist, /API_KEY|TOKEN|PASSWORD/u);
});

test('defines user services with bounded non-secret environments', () => {
  const definitions = serviceDefinitions({
    nodePath: '/opt/vera/bin/node',
    npmPath: '/opt/vera/bin/npm',
    ownerHome: '/Users/tester',
    profile: 'ollama',
  });
  assert.deepEqual(
    definitions.map(({ name }) => name),
    ['api', 'frontend', 'backup'],
  );
  const serialized = JSON.stringify(definitions);
  assert.doesNotMatch(serialized, /API_KEY|TOKEN|PASSWORD/u);
  assert.match(serialized, /VERA_PROFILE/u);
  assert.match(serialized, /127\.0\.0\.1/u);
});

test('keeps destructive maintenance inside the Vera state directory', () => {
  assert.equal(
    assertInside('/Users/tester/.vera', '/Users/tester/.vera/backups/a'),
    '/Users/tester/.vera/backups/a',
  );
  assert.throws(() => assertInside('/Users/tester/.vera', '/Users/tester'));
  assert.throws(() =>
    assertInside('/Users/tester/.vera', '/Users/tester/.vera'),
  );
});

test('uses portable, sortable backup names', () => {
  assert.equal(
    backupArchiveName(new Date('2026-09-04T12:34:56.000Z')),
    'vera-2026-09-04T12-34-56.000Z.archive.gz',
  );
});

test('parses an explicit service profile and rejects unknown arguments', () => {
  assert.deepEqual(parseArguments(['install', '--profile', 'OpenAI']), {
    action: 'install',
    profile: 'openai',
    follow: true,
  });
  assert.equal(parseArguments(['logs', '--no-follow']).follow, false);
  assert.throws(() => parseArguments(['install', '--profile', '../secret']));
  assert.throws(() => parseArguments(['install', '--unexpected']));
});

test('resolves static assets and falls back to the SPA without traversal', () => {
  const root = '/tmp/vera-frontend-test';
  assert.equal(resolveFrontendPath('/../../.env', root), undefined);
  assert.equal(resolveFrontendPath('/%2e%2e/%2eenv', root), undefined);
  assert.equal(contentType('/asset.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('/asset.unknown'), 'application/octet-stream');
});
