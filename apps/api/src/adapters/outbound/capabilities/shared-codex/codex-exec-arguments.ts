export type CodexExecArgumentsOptions = {
  sandbox: 'read-only' | 'workspace-write';
  workspace: string;
  schemaPath: string;
  outputPath: string;
  prompt: string;
  model?: string;
  skipGitRepositoryCheck?: boolean;
};

export function codexExecReadinessArguments(): string[] {
  return ['--ask-for-approval', 'never', 'exec', '--help'];
}

export function codexExecArguments(
  options: CodexExecArgumentsOptions,
): string[] {
  const arguments_: string[] = [
    '--ask-for-approval',
    'never',
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    options.sandbox,
    ...(options.skipGitRepositoryCheck === true
      ? ['--skip-git-repo-check']
      : []),
    '--color',
    'never',
    '--cd',
    options.workspace,
    '--output-schema',
    options.schemaPath,
    '--output-last-message',
    options.outputPath,
  ];
  if (options.model !== undefined) {
    arguments_.push('--model', options.model);
  }
  arguments_.push(options.prompt);
  return arguments_;
}
