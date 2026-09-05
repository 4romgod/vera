import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export type GitHubCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitHubCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean; timeoutMs?: number },
) => Promise<GitHubCommandResult>;

const environmentKeys = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'USERPROFILE',
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
  'SSH_AUTH_SOCK',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_HOST',
  'GH_ENTERPRISE_TOKEN',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
] as const;

export function githubCliProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
  };
  for (const key of environmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export const defaultGitHubCommandRunner: GitHubCommandRunner = async (
  command,
  args,
  options = {},
) => {
  try {
    const result = await executeFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: options.timeoutMs ?? 30_000,
      env: githubCliProcessEnvironment(),
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (options.allowFailure === true && typeof failure.code === 'number') {
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        exitCode: failure.code,
      };
    }
    throw error;
  }
};

export function parseGitHubRepositoryRemote(value: string): {
  owner: string;
  name: string;
} {
  const remote = value.trim();
  let path: string | undefined;
  const scp = /^(?:git@)?github\.com:([^?#]+)$/u.exec(remote);
  if (scp?.[1] !== undefined) {
    path = scp[1];
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new Error('The origin remote is not a supported GitHub URL.');
    }
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      !['https:', 'ssh:', 'git:'].includes(url.protocol) ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.protocol === 'https:' && url.username.length > 0)
    ) {
      throw new Error(
        'The origin remote must be a credential-free GitHub URL.',
      );
    }
    path = url.pathname.replace(/^\/+|\/+$/gu, '');
  }
  const parts = path.replace(/\.git$/u, '').split('/');
  const [owner, name] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    name === undefined ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(name)
  ) {
    throw new Error(
      'The origin remote does not identify one GitHub repository.',
    );
  }
  return { owner, name };
}
