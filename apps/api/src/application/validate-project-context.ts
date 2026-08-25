import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';

import {
  ProjectContextBundleSchema,
  type ProjectContextBundle,
} from '../domain/project-context.ts';
import { containsControlCharacter } from '../domain/text-safety.ts';

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
}
