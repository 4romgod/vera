import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  ProjectContextBundleSchema,
  type ProjectContextBundle,
} from '../../../domain/projects/project-context.ts';
import { containsControlCharacter } from '../../../domain/shared/text-safety.ts';
import type { ProjectContextAssembler } from '../../../ports/projects/project-context-assembler.ts';

const executeFile = promisify(execFile);
const gitCommandTimeoutMs = 30_000;

const alwaysUsefulNames = new Set([
  '.editorconfig',
  '.prettierignore',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
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
  'prettier.config.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.ts',
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

const lowSignalRequestTokens = new Set([
  'all',
  'and',
  'add',
  'are',
  'api',
  'been',
  'being',
  'but',
  'can',
  'change',
  'create',
  'delete',
  'does',
  'edit',
  'existing',
  'field',
  'fields',
  'fix',
  'for',
  'from',
  'get',
  'has',
  'have',
  'implement',
  'implementation',
  'into',
  'its',
  'manual',
  'modify',
  'not',
  'only',
  'patch',
  'plan',
  'planning',
  'post',
  'prepare',
  'preserve',
  'preserving',
  'project',
  'put',
  'relevant',
  'response',
  'responses',
  'should',
  'than',
  'that',
  'the',
  'their',
  'then',
  'this',
  'ticket',
  'use',
  'used',
  'using',
  'update',
  'vera',
  'was',
  'were',
  'while',
  'with',
]);

const documentationIntentTokens = new Set([
  'adr',
  'documentation',
  'document',
  'docs',
  'readme',
]);

const implementationIntentTokens = new Set([
  'code',
  'debug',
  'fix',
  'implement',
  'implementation',
  'refactor',
  'test',
  'tests',
]);

type ContextClassification =
  | 'documentation'
  | 'source_code'
  | 'test'
  | 'configuration';

type RankedCandidate = {
  relativePath: string;
  classification: ContextClassification;
  anchorMatches: string[];
  pathMatches: string[];
  contentMatches: string[];
  relatedToMatchedFile: boolean;
  score: number;
};

function extension(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

function isEligiblePath(path: string): boolean {
  if (containsControlCharacter(path)) return false;
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

function classify(path: string): ContextClassification {
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

function requestTokens(value: string): Set<string> {
  return new Set(
    [...tokenize(value)]
      .filter((token) => !lowSignalRequestTokens.has(token))
      .slice(0, 12),
  );
}

function requestAnchors(value: string): Set<string> {
  return new Set(
    [
      ...value.matchAll(
        /(?<![a-z0-9:/])(\/[a-z0-9][a-z0-9._~!$&'()*+=:@%/-]*)/gi,
      ),
    ]
      .map((match) => match[1]?.toLowerCase())
      .filter((anchor): anchor is string => anchor !== undefined),
  );
}

function pathMatches(path: string, terms: Set<string>): string[] {
  const tokens = tokenize(path);
  return [...terms].filter((term) => tokens.has(term));
}

function isRootEvidence(path: string): boolean {
  if (path.includes('/')) return false;
  return alwaysUsefulNames.has(path.toLowerCase());
}

function isRelatedPath(
  path: string,
  classification: ContextClassification,
  matchedPaths: Set<string>,
): boolean {
  if (classification === 'documentation' || classification === 'test') {
    return false;
  }
  const directory = posix.dirname(path);
  if (directory === '.') return false;
  for (const matchedPath of matchedPaths) {
    const matchedClassification = classify(matchedPath);
    if (
      matchedClassification === 'documentation' ||
      matchedClassification === 'test'
    ) {
      continue;
    }
    const matchedDirectory = posix.dirname(matchedPath);
    if (directory === matchedDirectory) {
      return true;
    }
  }
  return false;
}

function rankCandidate(input: {
  path: string;
  classification: ContextClassification;
  anchorMatches: string[];
  pathMatches: string[];
  contentMatches: string[];
  relatedToMatchedFile: boolean;
}): number {
  const baseScore: Record<ContextClassification, number> = {
    source_code: 50,
    test: 45,
    configuration: 30,
    documentation: 0,
  };
  const relevant =
    input.anchorMatches.length > 0 ||
    input.pathMatches.length > 0 ||
    input.contentMatches.length > 0;
  return (
    baseScore[input.classification] +
    input.anchorMatches.length * 180 +
    input.pathMatches.length * 120 +
    input.contentMatches.length * 90 +
    (isRootEvidence(input.path) ? 35 : 0) +
    (input.relatedToMatchedFile ? 25 : 0) +
    (input.classification === 'test' && relevant ? 25 : 0) -
    (input.classification === 'documentation' && !relevant ? 40 : 0) -
    input.path.split('/').length
  );
}

function selectionReason(candidate: RankedCandidate): string {
  if (candidate.anchorMatches.length > 0) {
    return `File content matches exact request anchors: ${candidate.anchorMatches.slice(0, 5).join(', ')}.`;
  }
  if (candidate.pathMatches.length > 0) {
    return `Path tokens match request terms: ${candidate.pathMatches.slice(0, 5).join(', ')}.`;
  }
  if (candidate.contentMatches.length > 0) {
    return `File content matches request terms: ${candidate.contentMatches.slice(0, 5).join(', ')}.`;
  }
  if (isRootEvidence(candidate.relativePath)) {
    return 'Repository-level architecture or dependency evidence.';
  }
  if (candidate.relatedToMatchedFile) {
    return 'Configuration, source, or verification evidence near a request-matched file.';
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

async function grepTrackedPaths(
  rootPath: string,
  term: string,
): Promise<string[]> {
  try {
    return (
      await runGit(rootPath, [
        'grep',
        '-I',
        '-i',
        '-l',
        '-z',
        '-F',
        '-e',
        term,
        '--',
      ])
    )
      .split('\u0000')
      .filter(Boolean);
  } catch (error) {
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
}

async function discoverContentMatches(
  rootPath: string,
  terms: Set<string>,
): Promise<Map<string, Set<string>>> {
  const matches = new Map<string, Set<string>>();
  const discoveries = await Promise.all(
    [...terms].map(async (term) => ({
      term,
      paths: await grepTrackedPaths(rootPath, term),
    })),
  );
  for (const discovery of discoveries) {
    for (const path of discovery.paths) {
      if (!isEligiblePath(path)) continue;
      const pathMatches = matches.get(path) ?? new Set<string>();
      pathMatches.add(discovery.term);
      matches.set(path, pathMatches);
    }
  }
  return matches;
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
    const requestText = `${input.objective} ${input.ticket.reference} ${input.ticket.details}`;
    const rawRequestTokens = tokenize(requestText);
    const relevantRequestTokens = requestTokens(requestText);
    const relevantRequestAnchors = requestAnchors(requestText);
    const [contentMatches, anchorMatches] = await Promise.all([
      discoverContentMatches(configuredRoot, relevantRequestTokens),
      discoverContentMatches(configuredRoot, relevantRequestAnchors),
    ]);
    const pathMatchedPaths = new Set<string>();
    for (const path of tracked) {
      if (pathMatches(path, relevantRequestTokens).length > 0) {
        pathMatchedPaths.add(path);
      }
    }
    const hasMatchedAnchors = anchorMatches.size > 0;
    const primaryMatchedPaths = hasMatchedAnchors
      ? new Set(anchorMatches.keys())
      : new Set([...contentMatches.keys(), ...pathMatchedPaths]);
    const candidates: RankedCandidate[] = tracked
      .map((relativePath) => {
        const classification = classify(relativePath);
        const candidateAnchorMatches = [
          ...(anchorMatches.get(relativePath) ?? []),
        ];
        // Exact route/path anchors are materially stronger than individual
        // prose tokens such as "process" or "http". Once an anchor resolves,
        // do not let those broad tokens pull unrelated directories back into
        // the bundle or distort ordering within the anchored evidence set.
        const candidatePathMatches = hasMatchedAnchors
          ? []
          : pathMatches(relativePath, relevantRequestTokens);
        const candidateContentMatches = hasMatchedAnchors
          ? []
          : [...(contentMatches.get(relativePath) ?? [])];
        const relatedToMatchedFile = isRelatedPath(
          relativePath,
          classification,
          primaryMatchedPaths,
        );
        const candidate = {
          relativePath,
          classification,
          anchorMatches: candidateAnchorMatches,
          pathMatches: candidatePathMatches,
          contentMatches: candidateContentMatches,
          relatedToMatchedFile,
        };
        return {
          ...candidate,
          score: rankCandidate({ path: relativePath, ...candidate }),
        };
      })
      .filter((candidate) =>
        primaryMatchedPaths.size === 0
          ? isRootEvidence(candidate.relativePath)
          : candidate.anchorMatches.length > 0 ||
            candidate.pathMatches.length > 0 ||
            (!hasMatchedAnchors && candidate.contentMatches.length > 0) ||
            candidate.relatedToMatchedFile ||
            isRootEvidence(candidate.relativePath),
      )
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        return scoreDifference === 0
          ? left.relativePath.localeCompare(right.relativePath)
          : scoreDifference;
      });

    // A request may require documentation as one part of an implementation.
    // Only relax the documentation budget when documentation is the primary
    // intent, not merely because the owner also asked to document a code change.
    const documentationIntent =
      [...rawRequestTokens].some((token) =>
        documentationIntentTokens.has(token),
      ) &&
      ![...rawRequestTokens].some((token) =>
        implementationIntentTokens.has(token),
      );
    const maxDocumentationFiles = documentationIntent
      ? input.limits.maxFiles
      : Math.max(1, Math.floor(input.limits.maxFiles / 5));
    const maxDocumentationBytes = documentationIntent
      ? input.limits.maxBytes
      : Math.max(1, Math.floor(input.limits.maxBytes / 5));

    const entries: ProjectContextBundle['manifest']['entries'] = [];
    const documents: ProjectContextBundle['documents'] = [];
    let totalBytes = 0;
    let documentationFiles = 0;
    let documentationBytes = 0;
    let skippedOversize = 0;
    let skippedBinary = 0;
    let skippedInvalidText = 0;
    let skippedUnsafe = 0;
    let skippedDocumentationBudget = 0;

    for (const candidate of candidates) {
      if (documents.length >= input.limits.maxFiles) break;
      const { relativePath } = candidate;
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
      if (
        candidate.classification === 'documentation' &&
        (documentationFiles >= maxDocumentationFiles ||
          documentationBytes + buffer.byteLength > maxDocumentationBytes)
      ) {
        skippedDocumentationBudget += 1;
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
      if (candidate.classification === 'documentation') {
        documentationFiles += 1;
        documentationBytes += buffer.byteLength;
      }
      entries.push({
        relativePath,
        sha256,
        bytes: buffer.byteLength,
        selectionReason: selectionReason(candidate),
        classification: candidate.classification,
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
          `${String(skippedDocumentationBudget)} documentation candidates were excluded by the non-documentation context budget.`,
        ],
      },
      documents,
    });
  }
}
