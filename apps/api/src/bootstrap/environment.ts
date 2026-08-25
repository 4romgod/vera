import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const ProfileNamePattern = /^[a-z0-9][a-z0-9_-]*$/u;

export type EnvironmentFileResult = {
  loaded: boolean;
  path: string;
};

export type EnvironmentFilesResult = {
  profile?: string;
  profileFile?: EnvironmentFileResult;
  baseFile: EnvironmentFileResult;
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function loadEnvironmentFile(
  path: string = join(repositoryRoot, '.env'),
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

export function loadEnvironmentFiles(
  options: {
    rootDirectory?: string;
    profile?: string;
  } = {},
): EnvironmentFilesResult {
  const rootDirectory = options.rootDirectory ?? repositoryRoot;
  const selectedProfile = options.profile ?? process.env.VERA_PROFILE;
  const profile = selectedProfile?.trim().toLowerCase();

  if (profile !== undefined && !ProfileNamePattern.test(profile)) {
    throw new Error(
      'VERA_PROFILE must contain only letters, numbers, underscores, or hyphens.',
    );
  }

  let profileFile: EnvironmentFileResult | undefined;
  if (profile !== undefined) {
    profileFile = loadEnvironmentFile(join(rootDirectory, `.env.${profile}`));
    if (!profileFile.loaded) {
      throw new Error(
        `Selected Vera environment profile "${profile}" does not exist.`,
      );
    }
  }

  // Node preserves variables that already exist. Loading the selected profile
  // before the shared file gives us: shell > profile > base.
  const baseFile = loadEnvironmentFile(join(rootDirectory, '.env'));
  return {
    ...(profile === undefined ? {} : { profile }),
    ...(profileFile === undefined ? {} : { profileFile }),
    baseFile,
  };
}
