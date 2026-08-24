import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const rootEnvironmentFile = fileURLToPath(
  new URL('../../../.env', import.meta.url),
);

export type EnvironmentFileResult = {
  loaded: boolean;
  path: string;
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function loadEnvironmentFile(
  path: string = rootEnvironmentFile,
): EnvironmentFileResult {
  try {
    loadEnvFile(path);
    return { loaded: true, path };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { loaded: false, path };
    }
    throw error;
  }
}
