import { createHash } from 'node:crypto';

import type {
  SoftwareChangeCapability,
  SoftwareChangeInvocation,
} from '../../../../ports/capabilities/software-change-capability.ts';

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
    change: {
      schemaVersion: 1;
      project: { id: string; name: string; revision: string };
      ticket: { reference: string; details: string };
      objective: string;
      summary: string;
      files: {
        relativePath: string;
        operation: 'create';
        afterSha256: string;
        bytes: number;
      }[];
      patch: string;
      verification: {
        command: string;
        status: 'not_run';
        details: string;
      }[];
      risks: string[];
    };
    model: {
      provider: string;
      model: string;
      durationMs: number;
    };
  }> {
    throwIfAborted(options?.signal);
    const relativePath = 'VERA_DETERMINISTIC_CHANGE.md';
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
          {
            relativePath,
            operation: 'create',
            afterSha256: createHash('sha256').update(content).digest('hex'),
            bytes: Buffer.byteLength(content),
          },
        ],
        patch,
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
