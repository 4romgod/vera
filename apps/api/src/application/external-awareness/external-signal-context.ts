import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  ExternalSignalContextBundleSchema,
  type ExternalSignalContextBundle,
} from '../../domain/external-awareness/external-signal-context.ts';
import type { ExternalSignal } from '../../domain/external-awareness/external-signal.ts';
import type { ExternalSignalStore } from '../../ports/persistence/external-signal-store.ts';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function signalPayload(signal: ExternalSignal) {
  const {
    schemaVersion: ignoredSchemaVersion,
    principalId: ignoredPrincipalId,
    ...payload
  } = signal;
  void ignoredSchemaVersion;
  void ignoredPrincipalId;
  return payload;
}

export function assembleExternalSignalContext(input: {
  signal: ExternalSignal;
  assembledAt: string;
}): ExternalSignalContextBundle {
  const payload = signalPayload(input.signal);
  const characters = input.signal.title.length + input.signal.summary.length;
  const signal = {
    ...payload,
    characters,
    sha256: sha256(payload),
  };
  const manifestPayload = {
    schemaVersion: 1 as const,
    principalId: input.signal.principalId,
    signalId: input.signal.id,
    signalVersion: input.signal.version,
    projectId: input.signal.project.id,
    assembledAt: input.assembledAt,
    characters,
  };
  return ExternalSignalContextBundleSchema.parse({
    schemaVersion: 1,
    signal,
    manifest: { ...manifestPayload, sha256: sha256(manifestPayload) },
  });
}

export async function assertExternalSignalContextIntegrity(input: {
  context: ExternalSignalContextBundle;
  store: ExternalSignalStore;
  principalId: string;
  projectId?: string;
}): Promise<void> {
  const context = ExternalSignalContextBundleSchema.parse(input.context);
  const stored = await input.store.findById(
    input.principalId,
    context.manifest.signalId,
  );
  if (
    stored?.status !== 'active' ||
    input.projectId === undefined ||
    context.manifest.principalId !== input.principalId ||
    context.manifest.projectId !== input.projectId ||
    context.manifest.signalVersion !== stored.version ||
    context.signal.id !== stored.id ||
    context.signal.version !== stored.version ||
    context.signal.project.id !== input.projectId
  ) {
    throw new Error(
      'External signal context is missing, stale, or out of scope.',
    );
  }
  const payload = signalPayload(stored);
  const characters = stored.title.length + stored.summary.length;
  const expectedSignal = {
    ...payload,
    characters,
    sha256: sha256(payload),
  };
  const manifestPayload = {
    schemaVersion: 1 as const,
    principalId: input.principalId,
    signalId: stored.id,
    signalVersion: stored.version,
    projectId: stored.project.id,
    assembledAt: context.manifest.assembledAt,
    characters,
  };
  if (
    !isDeepStrictEqual(context.signal, expectedSignal) ||
    context.manifest.characters !== characters ||
    context.signal.characters !== characters ||
    context.manifest.sha256 !== sha256(manifestPayload)
  ) {
    throw new Error('External signal context failed integrity validation.');
  }
}
