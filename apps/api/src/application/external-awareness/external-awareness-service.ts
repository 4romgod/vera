import { createHash } from 'node:crypto';

import {
  ExternalSignalObservationSchema,
  ExternalSignalSchema,
  type ExternalSignal,
  type ExternalSignalObservation,
} from '../../domain/external-awareness/external-signal.ts';
import type {
  ExternalAwarenessOperations,
  IntegrationAwarenessAction,
} from '../../ports/external-awareness/external-awareness-operations.ts';
import type { ExternalAwarenessSource } from '../../ports/external-awareness/external-awareness-source.ts';
import type { IntegrationConnectionAuthorizer } from '../../ports/integrations/integration-connection-authorizer.ts';
import type { ExternalSignalStore } from '../../ports/persistence/external-signal-store.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';

export type ExternalAwarenessErrorCode =
  | 'awareness_project_not_found'
  | 'awareness_source_unavailable'
  | 'awareness_source_invalid'
  | 'awareness_scope_changed';

export class ExternalAwarenessError extends Error {
  public constructor(
    message: string,
    public readonly code: ExternalAwarenessErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExternalAwarenessError';
  }
}

export function createExternalAwarenessService(options: {
  projects: ProjectStore;
  connections: IntegrationConnectionAuthorizer;
  signals: ExternalSignalStore;
  sources: ExternalAwarenessSource[];
  resolveRepository(project: {
    source: { kind: 'local_git'; rootPath: string };
  }): Promise<{ provider: 'github'; owner: string; name: string }>;
}): ExternalAwarenessOperations {
  const sourceFor = (integrationId: string) =>
    options.sources.find((source) => source.integrationId === integrationId);

  return {
    list: (principalId, limit = 100) =>
      options.signals.listActive(principalId, limit),
    listByRoutine: (principalId, routineId, limit = 100) =>
      options.signals.listByRoutine(principalId, routineId, limit),
    async freeze(input) {
      const project = await options.projects.findProjectById(
        input.principalId,
        input.projectId,
      );
      if (project === null) {
        throw new ExternalAwarenessError(
          `Project ${input.projectId} was not found.`,
          'awareness_project_not_found',
        );
      }
      if (sourceFor(input.integrationId) === undefined) {
        throw new ExternalAwarenessError(
          `${input.integrationId} awareness is not available on this Vera host.`,
          'awareness_source_unavailable',
        );
      }
      const connection = await options.connections.requireActive(
        input.principalId,
        input.integrationId,
      );
      let repository: Awaited<ReturnType<typeof options.resolveRepository>>;
      try {
        repository = await options.resolveRepository(project);
      } catch (error) {
        throw new ExternalAwarenessError(
          'The registered project does not resolve to one credential-free GitHub origin.',
          'awareness_scope_changed',
          { cause: error },
        );
      }
      return {
        kind: 'integration_awareness',
        integrationId: input.integrationId,
        connectionId: connection.id,
        account: {
          providerAccountId: connection.account.providerAccountId,
          login: connection.account.login,
        },
        project: { id: project.id, displayName: project.displayName },
        repository,
        categories: [...input.categories].sort(),
      };
    },

    async execute(input) {
      const source = sourceFor(input.action.integrationId);
      if (source === undefined) {
        throw new ExternalAwarenessError(
          `${input.action.integrationId} awareness is unavailable.`,
          'awareness_source_unavailable',
        );
      }
      const connection = await options.connections.requireActive(
        input.principalId,
        input.action.integrationId,
      );
      const project = await options.projects.findProjectById(
        input.principalId,
        input.action.project.id,
      );
      if (
        connection.id !== input.action.connectionId ||
        connection.account.providerAccountId !==
          input.action.account.providerAccountId ||
        project?.displayName !== input.action.project.displayName
      ) {
        throw new ExternalAwarenessError(
          'The approved connection or project identity has changed.',
          'awareness_scope_changed',
        );
      }
      let repository: IntegrationAwarenessAction['repository'];
      try {
        repository = await options.resolveRepository(project);
      } catch (error) {
        throw new ExternalAwarenessError(
          'The registered project origin can no longer be verified.',
          'awareness_scope_changed',
          { cause: error },
        );
      }
      if (!sameRepository(repository, input.action.repository)) {
        throw new ExternalAwarenessError(
          'The project repository differs from the approved watch scope.',
          'awareness_scope_changed',
        );
      }
      const observed = await source.observe({
        principalId: input.principalId,
        connectionId: connection.id,
        account: input.action.account,
        repository,
        categories: input.action.categories,
      });
      const observations = validateObservations(
        observed.observations,
        input.action,
      );
      let created = 0;
      let changed = 0;
      const activeIds: string[] = [];
      for (const observation of observations) {
        const signal = signalFrom({
          principalId: input.principalId,
          routineId: input.routineId,
          action: input.action,
          observation,
          observedAt: input.observedAt,
        });
        activeIds.push(signal.id);
        const stored = await options.signals.upsert(signal);
        if (stored.created) created += 1;
        else if (stored.changed) changed += 1;
      }
      const resolved = observed.complete
        ? await options.signals.resolveMissing({
            principalId: input.principalId,
            routineId: input.routineId,
            activeIds,
            resolvedAt: input.observedAt,
          })
        : 0;
      return { observations, created, changed, resolved };
    },
  };
}

function validateObservations(
  observations: ExternalSignalObservation[],
  action: IntegrationAwarenessAction,
) {
  if (observations.length > 300) {
    throw new ExternalAwarenessError(
      'The external awareness source exceeded the bounded observation limit.',
      'awareness_source_invalid',
    );
  }
  const keys = new Set<string>();
  return observations.map((candidate) => {
    const parsed = ExternalSignalObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ExternalAwarenessError(
        'The external awareness source returned invalid observation data.',
        'awareness_source_invalid',
      );
    }
    const observation = parsed.data;
    if (
      keys.has(observation.externalKey) ||
      !action.categories.includes(observation.category) ||
      !isApprovedUrl(observation.url, action)
    ) {
      throw new ExternalAwarenessError(
        'The external awareness source returned data outside the approved scope.',
        'awareness_source_invalid',
      );
    }
    keys.add(observation.externalKey);
    return observation;
  });
}

function isApprovedUrl(urlValue: string, action: IntegrationAwarenessAction) {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:') return false;
  const repositoryPrefix = `/${action.repository.owner}/${action.repository.name}`;
  return (
    url.origin === 'https://github.com' &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    (url.pathname.toLowerCase() === repositoryPrefix.toLowerCase() ||
      url.pathname
        .toLowerCase()
        .startsWith(`${repositoryPrefix.toLowerCase()}/`))
  );
}

function signalFrom(input: {
  principalId: string;
  routineId: string;
  action: IntegrationAwarenessAction;
  observation: {
    externalKey: string;
    category: 'review_requested' | 'mentioned' | 'assigned' | 'failed_check';
    title: string;
    summary: string;
    url: string;
    occurredAt: string;
  };
  observedAt: string;
}): ExternalSignal {
  const digest = createHash('sha256')
    .update(
      [
        input.principalId,
        input.routineId,
        input.action.integrationId,
        input.observation.externalKey,
      ].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 32);
  return ExternalSignalSchema.parse({
    schemaVersion: 1,
    version: 1,
    id: `external_signal_${digest}`,
    principalId: input.principalId,
    routineId: input.routineId,
    integrationId: input.action.integrationId,
    connectionId: input.action.connectionId,
    project: input.action.project,
    repository: input.action.repository,
    ...input.observation,
    status: 'active',
    firstObservedAt: input.observedAt,
    lastObservedAt: input.observedAt,
  });
}

function sameRepository(
  left: IntegrationAwarenessAction['repository'],
  right: IntegrationAwarenessAction['repository'],
) {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}
