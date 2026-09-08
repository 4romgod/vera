import { createHash } from 'node:crypto';

import type { SoftwareChange } from '../../../../domain/changes/software-change.ts';
import type {
  SoftwareChangeCapability,
  SoftwareChangeInvocation,
} from '../../../../ports/capabilities/software-change-capability.ts';

function adoptedFiles(invocation: SoftwareChangeInvocation) {
  return (invocation.context.workingTree?.files ?? []).map((file) => {
    const identity = { relativePath: file.relativePath, bytes: file.bytes };
    if (file.operation === 'create') {
      return {
        ...identity,
        operation: 'create' as const,
        afterSha256: file.afterSha256,
      };
    }
    if (file.operation === 'delete') {
      return {
        ...identity,
        operation: 'delete' as const,
        beforeSha256: file.beforeSha256,
        bytes: 0 as const,
      };
    }
    return {
      ...identity,
      operation: 'update' as const,
      beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256,
    };
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new DOMException('The software change was aborted.', 'AbortError');
  }
}

export class DeterministicSoftwareChangeCapability
  implements SoftwareChangeCapability
{
  public readonly destination = {
    schemaVersion: 1,
    adapterId: 'deterministic_change',
    provider: 'deterministic',
    transport: 'in_process',
    dataBoundary: 'owner_controlled',
  } as const;

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public execute(
    invocation: SoftwareChangeInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<{
    change: SoftwareChange;
    model: {
      provider: string;
      model: string;
      durationMs: number;
    };
  }> {
    throwIfAborted(options?.signal);
    const relativePath = 'VERA_DETERMINISTIC_CHANGE.md';
    if (
      invocation.context.workingTree?.files.some(
        (file) => file.relativePath === relativePath,
      ) === true
    ) {
      throw new Error(
        'The deterministic change conflicts with an adopted working-tree path.',
      );
    }
    const content = `# Deterministic software change\n\n${invocation.arguments.objective}\n`;
    const addedLines = content
      .slice(0, -1)
      .split('\n')
      .map((line) => `+${line}`);
    const patch = [
      `diff --git a/${relativePath} b/${relativePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${relativePath}`,
      `@@ -0,0 +1,${String(addedLines.length)} @@`,
      ...addedLines,
      '',
    ].join('\n');
    return Promise.resolve({
      change: {
        schemaVersion: 1,
        project: {
          id: invocation.project.id,
          name: invocation.project.displayName,
          revision: invocation.context.manifest.revision,
        },
        ticket: invocation.arguments.ticket,
        objective: invocation.arguments.objective,
        summary: 'Produced a deterministic review-only change artifact.',
        files: [
          ...adoptedFiles(invocation),
          {
            relativePath,
            operation: 'create',
            afterSha256: createHash('sha256').update(content).digest('hex'),
            bytes: Buffer.byteLength(content),
          },
        ],
        patch:
          invocation.context.workingTree === undefined
            ? patch
            : `${invocation.context.workingTree.patch}\n${patch}`,
        verification: [
          {
            command: 'not run by deterministic adapter',
            status: 'not_run',
            details:
              'The deterministic adapter proves orchestration and persistence without executing project commands.',
          },
        ],
        risks: [],
      },
      model: {
        provider: 'deterministic',
        model: 'deterministic-change-v1',
        durationMs: 0,
      },
    });
  }
}
