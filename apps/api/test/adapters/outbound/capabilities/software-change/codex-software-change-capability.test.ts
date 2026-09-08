import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CodexSoftwareChangeCapability } from '../../../../../src/adapters/outbound/capabilities/software-change/codex-software-change-capability.ts';
import { workingTreeSnapshotHashPayload } from '../../../../../src/domain/projects/project-context.ts';
import type { SoftwareChangeInvocation } from '../../../../../src/ports/capabilities/software-change-capability.ts';

const temporaryDirectories: string[] = [];
const approvedContent = "export const marker = 'approved-only';\n";

function invocation(): SoftwareChangeInvocation {
  const sha256 = createHash('sha256').update(approvedContent).digest('hex');
  return {
    schemaVersion: 1,
    invocationId: 'invocation_codex_change_test',
    arguments: {
      objective: 'Update the approved marker.',
      ticket: { reference: 'TEST-2', details: 'Change the feature marker.' },
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
            sha256,
            bytes: Buffer.byteLength(approvedContent),
            selectionReason: 'Synthetic approved evidence.',
            classification: 'source_code',
          },
        ],
        totalFiles: 1,
        totalBytes: Buffer.byteLength(approvedContent),
        limits: { maxFiles: 10, maxBytes: 10_000, maxFileBytes: 1_000 },
        exclusions: ['Synthetic test exclusions.'],
      },
      documents: [
        { relativePath: 'src/feature.ts', sha256, content: approvedContent },
      ],
    },
    limits: {
      maxDurationMs: 10_000,
      maxArtifactBytes: 50_000,
      maxChangedFiles: 10,
    },
  };
}

function invocationWithOwnerChanges(): SoftwareChangeInvocation {
  const value = invocation();
  const revision = 'a'.repeat(40);
  const ownerContent = "export const marker = 'owner-started';\n";
  const patch = [
    'diff --git a/src/feature.ts b/src/feature.ts',
    '--- a/src/feature.ts',
    '+++ b/src/feature.ts',
    '@@ -1 +1 @@',
    "-export const marker = 'approved-only';",
    "+export const marker = 'owner-started';",
    '',
  ].join('\n');
  const files = [
    {
      relativePath: 'src/feature.ts',
      operation: 'update' as const,
      beforeSha256: createHash('sha256').update(approvedContent).digest('hex'),
      afterSha256: createHash('sha256').update(ownerContent).digest('hex'),
      bytes: Buffer.byteLength(ownerContent),
      staged: true,
      unstaged: false,
      untracked: false,
    },
  ];
  const patchSha256 = createHash('sha256').update(patch).digest('hex');
  value.context.manifest.revision = revision;
  value.context.workingTree = {
    schemaVersion: 1,
    baseRevision: revision,
    patch,
    patchSha256,
    snapshotSha256: createHash('sha256')
      .update(
        JSON.stringify(
          workingTreeSnapshotHashPayload({
            baseRevision: revision,
            patchSha256,
            files,
          }),
        ),
      )
      .digest('hex'),
    files,
    totalFiles: 1,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    capturedAt: '2026-08-24T18:00:00.000Z',
  };
  return value;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

void describe('Codex software-change adapter', () => {
  void it('uses an ephemeral writable snapshot and returns Vera-computed patch metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-fake-codex-change-'));
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
if (!args.includes('--ephemeral') || !args.includes('--ignore-user-config') || !args.includes('--ignore-rules')) process.exit(21);
if (valueAfter('--sandbox') !== 'workspace-write' || args.slice(3).includes('--ask-for-approval')) process.exit(22);
const workspace = valueAfter('--cd');
const source = await readFile(workspace + '/src/feature.ts', 'utf8');
if (!source.includes('approved-only')) process.exit(23);
await writeFile(workspace + '/src/feature.ts', "export const marker = 'implemented';\\n");
await writeFile(valueAfter('--output-last-message'), JSON.stringify({
  schemaVersion: 1,
  summary: 'Updated the approved marker.',
  verification: [{ command: 'npm test', status: 'not_run', details: 'Dependencies were not present in the approved snapshot.' }],
  risks: []
}));
`,
      'utf8',
    );
    await chmod(command, 0o755);
    const capability = new CodexSoftwareChangeCapability({ command });

    const result = await capability.execute(invocation());

    assert.equal(result.change.project.id, 'project_synthetic');
    assert.equal(result.change.project.revision, 'abc123');
    assert.deepEqual(result.change.files, [
      {
        relativePath: 'src/feature.ts',
        operation: 'update',
        beforeSha256: createHash('sha256')
          .update(approvedContent)
          .digest('hex'),
        afterSha256: createHash('sha256')
          .update("export const marker = 'implemented';\n")
          .digest('hex'),
        bytes: Buffer.byteLength("export const marker = 'implemented';\n"),
      },
    ]);
    assert.match(
      result.change.patch,
      /-export const marker = 'approved-only'/u,
    );
    assert.match(result.change.patch, /\+export const marker = 'implemented'/u);
    assert.equal(result.model.provider, 'codex');
  });

  void it('rejects forbidden instruction-file mutations', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'vera-fake-codex-forbidden-'),
    );
    temporaryDirectories.push(directory);
    const command = join(directory, 'fake-codex.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
await writeFile(valueAfter('--cd') + '/AGENTS.md', '# Override');
await writeFile(valueAfter('--output-last-message'), JSON.stringify({ schemaVersion: 1, summary: 'Unsafe change.', verification: [], risks: [] }));
`,
      'utf8',
    );
    await chmod(command, 0o755);
    const capability = new CodexSoftwareChangeCapability({ command });

    await assert.rejects(
      capability.execute(invocation()),
      /forbidden path AGENTS\.md/u,
    );
  });

  void it('materializes frozen owner changes and returns one combined base-relative patch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vera-fake-codex-adopted-'));
    temporaryDirectories.push(directory);
    const command = join(directory, 'fake-codex.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const workspace = valueAfter('--cd');
const source = await readFile(workspace + '/src/feature.ts', 'utf8');
if (!source.includes('owner-started')) process.exit(23);
await writeFile(workspace + '/src/feature.ts', "export const marker = 'completed';\\n");
await writeFile(valueAfter('--output-last-message'), JSON.stringify({
  schemaVersion: 1,
  summary: 'Reviewed and completed the owner change.',
  verification: [{ command: 'npm test', status: 'not_run', details: 'Synthetic fixture.' }],
  risks: []
}));
`,
      'utf8',
    );
    await chmod(command, 0o755);
    const capability = new CodexSoftwareChangeCapability({ command });

    const result = await capability.execute(invocationWithOwnerChanges());

    assert.equal(result.change.files.length, 1);
    const changedFile = result.change.files[0];
    assert.ok(changedFile);
    assert.equal(changedFile.operation, 'update');
    assert.equal(
      changedFile.beforeSha256,
      createHash('sha256').update(approvedContent).digest('hex'),
    );
    assert.equal(
      changedFile.afterSha256,
      createHash('sha256')
        .update("export const marker = 'completed';\n")
        .digest('hex'),
    );
    assert.match(result.change.patch, /approved-only/u);
    assert.match(result.change.patch, /completed/u);
    assert.doesNotMatch(result.change.patch, /owner-started/u);
  });
});
