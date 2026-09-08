import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';

import {
  ProjectContextBundleSchema,
  workingTreeSnapshotHashPayload,
  type ProjectContextBundle,
} from '../../domain/projects/project-context.ts';
import { containsControlCharacter } from '../../domain/shared/text-safety.ts';

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes('\\') &&
    !containsControlCharacter(path) &&
    !isAbsolute(path) &&
    posix.normalize(path) === path &&
    path !== '..' &&
    !path.startsWith('../')
  );
}

export function assertProjectContextIntegrity(
  value: ProjectContextBundle,
  expectedProjectId: string,
): void {
  const context = ProjectContextBundleSchema.parse(value);
  if (context.manifest.projectId !== expectedProjectId) {
    throw new Error('Project context belongs to a different project.');
  }
  if (
    context.manifest.totalFiles !== context.manifest.entries.length ||
    context.documents.length !== context.manifest.entries.length
  ) {
    throw new Error('Project context file counts are inconsistent.');
  }

  const entries = new Map(
    context.manifest.entries.map((entry) => [entry.relativePath, entry]),
  );
  const documents = new Map(
    context.documents.map((document) => [document.relativePath, document]),
  );
  if (
    entries.size !== context.manifest.entries.length ||
    documents.size !== context.documents.length
  ) {
    throw new Error('Project context contains duplicate paths.');
  }

  let totalBytes = 0;
  for (const [relativePath, entry] of entries) {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error('Project context contains an unsafe relative path.');
    }
    const document = documents.get(relativePath);
    if (document === undefined) {
      throw new Error('Project context manifest has no matching document.');
    }
    const bytes = Buffer.from(document.content, 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      document.sha256 !== entry.sha256 ||
      sha256 !== entry.sha256 ||
      bytes.byteLength !== entry.bytes
    ) {
      throw new Error('Project context content does not match its manifest.');
    }
    totalBytes += bytes.byteLength;
  }
  if (totalBytes !== context.manifest.totalBytes) {
    throw new Error('Project context total byte count is inconsistent.');
  }
  const workingTree = context.workingTree;
  if (workingTree === undefined) return;
  if (
    workingTree.baseRevision !== context.manifest.revision ||
    workingTree.totalFiles !== workingTree.files.length ||
    workingTree.totalFiles > context.manifest.limits.maxFiles ||
    workingTree.totalBytes > context.manifest.limits.maxBytes ||
    Buffer.byteLength(workingTree.patch) > context.manifest.limits.maxBytes ||
    createHash('sha256').update(workingTree.patch).digest('hex') !==
      workingTree.patchSha256
  ) {
    throw new Error('Working-tree evidence does not match its context.');
  }
  const workingPaths = new Set<string>();
  let workingBytes = 0;
  for (const file of workingTree.files) {
    if (
      !isSafeRelativePath(file.relativePath) ||
      workingPaths.has(file.relativePath) ||
      (!file.staged && !file.unstaged) ||
      file.bytes > context.manifest.limits.maxFileBytes ||
      (file.untracked &&
        (file.operation !== 'create' || file.staged || !file.unstaged))
    ) {
      throw new Error('Working-tree evidence contains an invalid file entry.');
    }
    workingPaths.add(file.relativePath);
    workingBytes += file.bytes;
    const baseline = entries.get(file.relativePath);
    if (file.operation !== 'create' && file.beforeSha256 !== baseline?.sha256) {
      throw new Error(
        'Working-tree evidence is missing an approved baseline document.',
      );
    }
    if (file.operation === 'create' && baseline !== undefined) {
      throw new Error(
        'Working-tree evidence creates a path already present in the baseline.',
      );
    }
  }
  if (
    workingBytes !== workingTree.totalBytes ||
    createHash('sha256')
      .update(JSON.stringify(workingTreeSnapshotHashPayload(workingTree)))
      .digest('hex') !== workingTree.snapshotSha256
  ) {
    throw new Error('Working-tree evidence failed its integrity check.');
  }
}
