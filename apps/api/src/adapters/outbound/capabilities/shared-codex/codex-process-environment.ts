const allowedEnvironmentKeys = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'CODEX_HOME',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
] as const;

export function codexProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowedEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
