import { execFile } from 'node:child_process';

export type CodexSubprocessOptions = {
  maxBuffer: number;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};

export function executeCodexSubprocess(
  command: string,
  arguments_: string[],
  options: CodexSubprocessOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      arguments_,
      { ...options, encoding: 'utf8' },
      (error) => {
        if (error === null) {
          resolve();
          return;
        }
        reject(
          error instanceof Error
            ? error
            : new Error('Codex subprocess failed.', { cause: error }),
        );
      },
    );

    // `codex exec` checks non-interactive stdin while resolving its root
    // prompt. An open, unused pipe makes it wait for EOF before starting a
    // model session even when the prompt was supplied as an argument.
    child.stdin?.end();
  });
}
