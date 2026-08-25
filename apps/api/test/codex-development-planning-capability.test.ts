import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CodexDevelopmentPlanningCapability } from '../src/capabilities/codex-development-planning-capability.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

void describe('Codex development planning adapter', () => {
  void it('checks both CLI availability and authentication readiness', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-fake-codex-ready-'));
    temporaryDirectories.push(directory);
    const command = join(directory, 'fake-codex.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') process.exit(0);
if (args.length === 4 && args[0] === '--ask-for-approval' && args[1] === 'never' && args[2] === 'exec' && args[3] === '--help') process.exit(0);
if (args.length === 2 && args[0] === 'login' && args[1] === 'status') process.exit(0);
process.exit(20);
`,
      'utf8',
    );
    await chmod(command, 0o755);
    const capability = new CodexDevelopmentPlanningCapability({ command });

    await capability.checkReadiness();
    assert.deepEqual(capability.destination, {
      schemaVersion: 1,
      adapterId: 'codex_cli',
      provider: 'openai',
      transport: 'local_process',
      dataBoundary: 'third_party',
    });
  });

  void it('uses an ephemeral read-only snapshot and returns schema-valid output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-fake-codex-'));
    temporaryDirectories.push(directory);
    const command = join(directory, 'fake-codex.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const stdinTimeout = setTimeout(() => process.exit(19), 1000);
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
clearTimeout(stdinTimeout);
if (stdin !== '') process.exit(19);
if (args[0] !== '--ask-for-approval' || args[1] !== 'never' || args[2] !== 'exec') process.exit(20);
if (!args.includes('--ephemeral') || valueAfter('--sandbox') !== 'read-only' || args.slice(3).includes('--ask-for-approval')) process.exit(21);
const workspace = valueAfter('--cd');
const source = await readFile(workspace + '/src/feature.ts', 'utf8');
if (!source.includes('approved-only')) process.exit(22);
const output = {
  schemaVersion: 1,
  title: 'Approved snapshot plan',
  summary: 'Plan derived from the bounded snapshot.',
  scope: ['Update the approved feature source.'],
  nonGoals: [],
  assumptions: [],
  unresolvedQuestions: [],
  affectedProjectAreas: [{ area: 'src/feature.ts', rationale: 'Approved evidence.' }],
  phases: [{ name: 'Implement', objective: 'Implement the feature.', steps: ['Update src/feature.ts.'], verification: ['Test the feature.'] }],
  risks: []
};
await writeFile(valueAfter('--output-last-message'), JSON.stringify(output));
`,
      'utf8',
    );
    await chmod(command, 0o755);
    const capability = new CodexDevelopmentPlanningCapability({ command });

    const result = await capability.execute({
      schemaVersion: 1,
      invocationId: 'invocation_codex_test',
      arguments: {
        objective: 'Implement the approved feature.',
        ticket: { reference: 'TEST-1', details: 'Update the feature.' },
        project: { name: 'Synthetic' },
      },
      project: { id: 'project_synthetic', displayName: 'Synthetic' },
      context: {
        manifest: {
          schemaVersion: 1,
          projectId: 'project_synthetic',
          sourceKind: 'local_git',
          revision: 'abc123',
          generatedAt: '2026-08-24T18:00:00.000Z',
          entries: [
            {
              relativePath: 'src/feature.ts',
              sha256:
                'dadd81937298468522b8048a1e2248ca71dbc62d36d9e9f16207cd3819854eae',
              bytes: 39,
              selectionReason: 'Synthetic approved evidence.',
              classification: 'source_code',
            },
          ],
          totalFiles: 1,
          totalBytes: 39,
          limits: { maxFiles: 10, maxBytes: 10_000, maxFileBytes: 1_000 },
          exclusions: ['Synthetic test exclusions.'],
        },
        documents: [
          {
            relativePath: 'src/feature.ts',
            sha256:
              'dadd81937298468522b8048a1e2248ca71dbc62d36d9e9f16207cd3819854eae',
            content: "export const marker = 'approved-only';\n",
          },
        ],
      },
      limits: { maxDurationMs: 10_000, maxArtifactBytes: 50_000 },
    });

    assert.equal(result.model.provider, 'codex');
    assert.equal(result.plan.project.id, 'project_synthetic');
    assert.equal(result.plan.project.revision, 'abc123');
    assert.equal(result.plan.affectedProjectAreas[0]?.area, 'src/feature.ts');
  });
});
