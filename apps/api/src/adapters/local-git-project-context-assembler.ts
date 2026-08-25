import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  ProjectContextBundleSchema,
  type ProjectContextBundle,
} from '../domain/project-context.ts';
import type { ProjectContextAssembler } from '../ports/project-context-assembler.ts';

const executeFile = promisify(execFile);
const gitCommandTimeoutMs = 30_000;

const alwaysUsefulNames = new Set([
  'readme',
  'readme.md',
  'package.json',
  'package-lock.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'dockerfile',
  'compose.yaml',
  'compose.yml',
]);

const allowedExtensions = new Set([
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.css',
  '.go',
  '.graphql',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mdx',
  '.mjs',
  '.prisma',
  '.properties',
  '.proto',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const blockedSegments = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

const instructionFileNames = new Set([
  '.cursorrules',
  '.clinerules',
  '.windsurfrules',
  'agents.md',
  'claude.md',
  'copilot-instructions.md',
  'gemini.md',
  'skill.md',
]);

const secretName =
  /(^|\/)(\.env($|\.)|.*(?:credential|credentials|secret|secrets|private[-_.]?key|id_rsa|id_ed25519|\.pem$|\.p12$|\.pfx$))/i;

function extension(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

function isEligiblePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const segments = path.split('/');
  if (segments.some((segment) => blockedSegments.has(segment))) {
    return false;
  }
  if (secretName.test(path)) {
    return false;
  }
  const name = segments.at(-1)?.toLowerCase() ?? '';
  if (
    instructionFileNames.has(name) ||
    name.endsWith('.prompt.md') ||
    lowerPath.startsWith('.github/prompts/') ||
    lowerPath.startsWith('.github/instructions/') ||
    lowerPath.startsWith('.cursor/rules/') ||
    lowerPath.startsWith('.windsurf/rules/')
  ) {
    return false;
  }
  return alwaysUsefulNames.has(name) || allowedExtensions.has(extension(path));
}

function classify(
  path: string,
): 'documentation' | 'source_code' | 'test' | 'configuration' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.startsWith('docs/')) {
    return 'documentation';
  }
  if (/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./.test(lower)) {
    return 'test';
  }
  if (
    alwaysUsefulNames.has(lower.split('/').at(-1) ?? '') ||
    ['.json', '.toml', '.yaml', '.yml', '.properties'].includes(
      extension(lower),
    )
  ) {
    return 'configuration';
  }
  return 'source_code';
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function rank(path: string, requestTokens: Set<string>): number {
  const lower = path.toLowerCase();
  const name = lower.split('/').at(-1) ?? lower;
  let score = alwaysUsefulNames.has(name) ? 100 : 0;
  if (lower.startsWith('docs/')) score += 35;
  if (classify(path) === 'test') score += 20;
  if (lower.includes('src/')) score += 15;
  for (const token of requestTokens) {
    if (lower.includes(token)) score += 30;
  }
  score -= lower.split('/').length;
  return score;
}

function selectionReason(path: string, requestTokens: Set<string>): string {
  const matches = [...requestTokens].filter((token) =>
    path.toLowerCase().includes(token),
  );
  if (matches.length > 0) {
    return `Path matches request terms: ${matches.slice(0, 5).join(', ')}.`;
  }
  const name = path.split('/').at(-1)?.toLowerCase() ?? '';
  if (alwaysUsefulNames.has(name)) {
    return 'Repository-level architecture or dependency evidence.';
  }
  if (classify(path) === 'test') {
    return 'Existing verification evidence near the requested work.';
  }
  return 'Bounded repository evidence selected by deterministic ranking.';
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
  const result = await executeFile('git', ['-C', rootPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: gitCommandTimeoutMs,
  });
  return result.stdout;
}

export async function resolveLocalGitRoot(rootPath: string): Promise<string> {
  if (!isAbsolute(rootPath)) {
    throw new Error('A local Git project root must be absolute.');
  }
  const configuredRoot = await realpath(rootPath);
  const repositoryRoot = (
    await runGit(configuredRoot, ['rev-parse', '--show-toplevel'])
  ).trim();
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  if (configuredRoot !== canonicalRepositoryRoot) {
    throw new Error(
      'The registered project path must be the Git repository root.',
    );
  }
  return configuredRoot;
}

export class LocalGitProjectContextAssembler
  implements ProjectContextAssembler
{
  public async assemble(input: {
    project: Parameters<ProjectContextAssembler['assemble']>[0]['project'];
    objective: string;
    ticket: { reference: string; details: string };
    limits: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  }): Promise<ProjectContextBundle> {
    const configuredRoot = await resolveLocalGitRoot(
      input.project.source.rootPath,
    );

    const head = (await runGit(configuredRoot, ['rev-parse', 'HEAD'])).trim();
    const dirty =
      (
        await runGit(configuredRoot, [
          'status',
          '--porcelain',
          '--untracked-files=no',
        ])
      ).trim().length > 0;
    const tracked = (
      await runGit(configuredRoot, ['ls-files', '--cached', '-z'])
    )
      .split('\u0000')
      .filter((path) => path.length > 0 && isEligiblePath(path));
    const requestTokens = tokenize(
      `${input.objective} ${input.ticket.reference} ${input.ticket.details}`,
    );
    const candidates = tracked.sort((left, right) => {
      const scoreDifference =
        rank(right, requestTokens) - rank(left, requestTokens);
      return scoreDifference === 0
        ? left.localeCompare(right)
        : scoreDifference;
    });

    const entries: ProjectContextBundle['manifest']['entries'] = [];
    const documents: ProjectContextBundle['documents'] = [];
    let totalBytes = 0;
    let skippedOversize = 0;
    let skippedBinary = 0;
    let skippedInvalidText = 0;
    let skippedUnsafe = 0;

    for (const relativePath of candidates) {
      if (documents.length >= input.limits.maxFiles) break;
      const absolutePath = resolve(configuredRoot, relativePath);
      const relativeToRoot = relative(configuredRoot, absolutePath);
      if (
        relativeToRoot.startsWith(`..${sep}`) ||
        relativeToRoot === '..' ||
        isAbsolute(relativeToRoot)
      ) {
        skippedUnsafe += 1;
        continue;
      }
      let fileInfo;
      try {
        fileInfo = await lstat(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // `git ls-files --cached` includes tracked files deleted in the
          // working tree. The bundle represents the current working tree, so
          // an absent path is intentionally omitted.
          continue;
        }
        throw error;
      }
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        skippedUnsafe += 1;
        continue;
      }
      const canonicalFile = await realpath(absolutePath);
      if (!canonicalFile.startsWith(`${configuredRoot}${sep}`)) {
        skippedUnsafe += 1;
        continue;
      }
      if (fileInfo.size > input.limits.maxFileBytes) {
        skippedOversize += 1;
        continue;
      }
      const buffer = await readFile(canonicalFile);
      if (buffer.byteLength > input.limits.maxFileBytes) {
        skippedOversize += 1;
        continue;
      }
      if (buffer.includes(0)) {
        skippedBinary += 1;
        continue;
      }
      if (totalBytes + buffer.byteLength > input.limits.maxBytes) {
        skippedOversize += 1;
        continue;
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        skippedInvalidText += 1;
        continue;
      }
      totalBytes += buffer.byteLength;
      entries.push({
        relativePath,
        sha256,
        bytes: buffer.byteLength,
        selectionReason: selectionReason(relativePath, requestTokens),
        classification: classify(relativePath),
      });
      documents.push({ relativePath, sha256, content });
    }

    return ProjectContextBundleSchema.parse({
      manifest: {
        schemaVersion: 1,
        projectId: input.project.id,
        sourceKind: 'local_git',
        revision: dirty ? `${head}+working-tree` : head,
        generatedAt: new Date().toISOString(),
        entries,
        totalFiles: entries.length,
        totalBytes,
        limits: input.limits,
        exclusions: [
          'Only Git-tracked regular text files are eligible.',
          'Environment files, credential-like paths, agent instruction files, dependencies, build output, binaries, and symlinks are excluded.',
          `${String(skippedOversize)} candidate files were excluded by byte limits.`,
          `${String(skippedBinary)} candidate files were excluded as binary.`,
          `${String(skippedInvalidText)} candidate files were excluded as invalid UTF-8 text.`,
          `${String(skippedUnsafe)} candidate files were excluded by path safety checks.`,
        ],
      },
      documents,
    });
  }
}
