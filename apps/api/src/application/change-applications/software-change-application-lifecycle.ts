import { randomUUID } from 'node:crypto';

import {
  SoftwareChangeApplicationSchema,
  type ChangeApplicationEvent,
  type SoftwareChangeApplication,
} from '../../domain/changes/software-change-application.ts';
import type { ChangeApplicationStore } from '../../ports/persistence/change-application-store.ts';
import type { ArtifactStore } from '../../ports/persistence/artifact-store.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import {
  ChangeApplicationExecutionError,
  type SoftwareChangeApplicationExecutor,
} from '../../ports/change-applications/software-change-application-executor.ts';

export type ChangeApplicationErrorCode =
  | 'change_application_not_found'
  | 'change_application_approval_already_decided'
  | 'change_application_idempotency_key_reused'
  | 'change_application_concurrent_transition_failed'
  | 'software_change_artifact_required'
  | 'change_application_not_cancellable';

export class ChangeApplicationError extends Error {
  public constructor(
    message: string,
    public readonly code: ChangeApplicationErrorCode,
  ) {
    super(message);
    this.name = 'ChangeApplicationError';
  }
}

type IdFactory = (prefix: string) => string;
type Clock = () => string;

export type SoftwareChangeApplicationLifecycle = {
  create(input: {
    principalId: string;
    requestKey: string;
    artifactId: string;
  }): Promise<SoftwareChangeApplication>;
  get(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication>;
  listForArtifact(
    principalId: string,
    artifactId: string,
  ): Promise<SoftwareChangeApplication[]>;
  decideApproval(input: {
    principalId: string;
    applicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<SoftwareChangeApplication>;
  cancel(input: {
    principalId: string;
    applicationId: string;
  }): Promise<SoftwareChangeApplication>;
  progress(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication>;
};

function appendEvent(
  application: SoftwareChangeApplication,
  type: ChangeApplicationEvent['type'],
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
): void {
  application.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: application.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

export function createSoftwareChangeApplicationLifecycle(options: {
  store: ChangeApplicationStore;
  resources: ArtifactStore & ProjectStore;
  executor: SoftwareChangeApplicationExecutor;
  clock?: Clock;
  createId?: IdFactory;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
}): SoftwareChangeApplicationLifecycle {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const observer = options.observer ?? { warning: () => undefined };
  const active = new Map<string, AbortController>();

  async function requireApplication(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangeApplication> {
    const application = await options.store.findById(
      principalId,
      applicationId,
    );
    if (application === null) {
      throw new ChangeApplicationError(
        `Change application ${applicationId} was not found.`,
        'change_application_not_found',
      );
    }
    return application;
  }

  async function update(
    principalId: string,
    applicationId: string,
    transition: (candidate: SoftwareChangeApplication) => boolean,
  ): Promise<SoftwareChangeApplication> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await requireApplication(principalId, applicationId);
      const candidate = structuredClone(current);
      if (!transition(candidate)) return current;
      candidate.version = current.version + 1;
      SoftwareChangeApplicationSchema.parse(candidate);
      if (await options.store.replace(candidate, current.version)) {
        return candidate;
      }
    }
    throw new ChangeApplicationError(
      `Change application ${applicationId} changed too frequently to apply the transition.`,
      'change_application_concurrent_transition_failed',
    );
  }

  async function loadDependencies(application: SoftwareChangeApplication) {
    const [artifact, project] = await Promise.all([
      options.resources.findArtifactById(
        application.principalId,
        application.sourceArtifact.id,
      ),
      options.resources.findProjectById(
        application.principalId,
        application.project.id,
      ),
    ]);
    if (
      artifact?.type !== 'software_change' ||
      artifact.sha256 !== application.sourceArtifact.sha256
    ) {
      throw new ChangeApplicationExecutionError(
        'The source software-change artifact is missing or failed its integrity check.',
        'application_conflict',
      );
    }
    if (project === null) {
      throw new ChangeApplicationExecutionError(
        'The registered project is no longer available.',
        'stale_source',
      );
    }
    return { artifact, project };
  }

  async function recordFailure(
    application: SoftwareChangeApplication,
    error: unknown,
  ): Promise<SoftwareChangeApplication> {
    const now = clock();
    const classified =
      error instanceof ChangeApplicationExecutionError
        ? error
        : new ChangeApplicationExecutionError(
            'Vera could not apply the approved software change.',
            'application_failed',
          );
    observer.warning(error, {
      operation: 'software_change_application',
      applicationId: application.id,
      effectId: application.effect.id,
      errorCode: classified.code,
    });
    return update(application.principalId, application.id, (candidate) => {
      if (
        candidate.status !== 'applying' &&
        candidate.status !== 'cancellation_requested'
      ) {
        return false;
      }
      candidate.status =
        classified.code === 'review_required' ? 'review_required' : 'failed';
      candidate.effect.status =
        classified.code === 'review_required' ? 'review_required' : 'failed';
      candidate.effect.completedAt = now;
      candidate.failure = {
        code: classified.code,
        message: classified.message,
      };
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        classified.code === 'review_required'
          ? 'change_application_review_required'
          : 'change_application_failed',
        now,
        { code: classified.code },
        createId,
      );
      return true;
    });
  }

  return {
    async listForArtifact(principalId, artifactId) {
      return options.store.listBySourceArtifact(principalId, artifactId, 20);
    },
    async create(input) {
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        if (existing.sourceArtifact.id !== input.artifactId) {
          throw new ChangeApplicationError(
            `Idempotency key ${input.requestKey} is already associated with another software-change artifact.`,
            'change_application_idempotency_key_reused',
          );
        }
        return existing;
      }
      const artifact = await options.resources.findArtifactById(
        input.principalId,
        input.artifactId,
      );
      if (artifact?.type !== 'software_change') {
        throw new ChangeApplicationError(
          `Artifact ${input.artifactId} is not an applicable software-change artifact.`,
          'software_change_artifact_required',
        );
      }
      const project = await options.resources.findProjectById(
        input.principalId,
        artifact.projectId,
      );
      if (project === null) {
        throw new ChangeApplicationError(
          `The project for artifact ${input.artifactId} was not found.`,
          'software_change_artifact_required',
        );
      }
      const applicationId = createId('application');
      const approvalId = createId('approval');
      const prepared = await options.executor.prepare({
        applicationId,
        artifact,
        project,
      });
      const now = clock();
      const application = SoftwareChangeApplicationSchema.parse({
        schemaVersion: 1,
        version: 1,
        id: applicationId,
        requestKey: input.requestKey,
        principalId: input.principalId,
        status: 'awaiting_approval',
        sourceArtifact: { id: artifact.id, sha256: artifact.sha256 },
        project: { id: project.id, displayName: project.displayName },
        approval: {
          id: approvalId,
          status: 'pending',
          reason: 'software_change_application',
          sourceArtifact: { id: artifact.id, sha256: artifact.sha256 },
          project: { id: project.id, displayName: project.displayName },
          effect: prepared,
          requestedAt: now,
        },
        effect: { id: createId('effect'), status: 'pending' },
        events: [
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 1,
            type: 'change_application_created',
            occurredAt: now,
            data: { artifactId: artifact.id, projectId: project.id },
          },
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 2,
            type: 'change_application_approval_requested',
            occurredAt: now,
            data: {
              approvalId,
              adapterId: prepared.adapterId,
              patchSha256: prepared.patchSha256,
            },
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const created = await options.store.create(application);
      if (
        !created.created &&
        created.application.sourceArtifact.id !== input.artifactId
      ) {
        throw new ChangeApplicationError(
          `Idempotency key ${input.requestKey} is already associated with another software-change artifact.`,
          'change_application_idempotency_key_reused',
        );
      }
      return created.application;
    },

    get: requireApplication,

    async decideApproval(input) {
      const now = clock();
      return update(input.principalId, input.applicationId, (candidate) => {
        if (candidate.approval.status !== 'pending') {
          if (
            candidate.approval.status === input.decision &&
            candidate.approval.decidedBy === input.principalId
          ) {
            return false;
          }
          throw new ChangeApplicationError(
            `Approval ${candidate.approval.id} has already been decided.`,
            'change_application_approval_already_decided',
          );
        }
        candidate.approval.status = input.decision;
        candidate.approval.decidedAt = now;
        candidate.approval.decidedBy = input.principalId;
        candidate.updatedAt = now;
        if (input.decision === 'rejected') {
          candidate.status = 'rejected';
          appendEvent(
            candidate,
            'change_application_approval_rejected',
            now,
            { approvalId: candidate.approval.id },
            createId,
          );
        } else {
          candidate.status = 'approved';
          appendEvent(
            candidate,
            'change_application_approval_approved',
            now,
            { approvalId: candidate.approval.id },
            createId,
          );
        }
        return true;
      });
    },

    async cancel(input) {
      const now = clock();
      const application = await update(
        input.principalId,
        input.applicationId,
        (candidate) => {
          if (
            [
              'succeeded',
              'rejected',
              'failed',
              'review_required',
              'cancelled',
            ].includes(candidate.status)
          ) {
            throw new ChangeApplicationError(
              `Change application ${candidate.id} is already terminal.`,
              'change_application_not_cancellable',
            );
          }
          if (candidate.status === 'cancellation_requested') return false;
          if (
            candidate.status === 'awaiting_approval' ||
            candidate.status === 'approved'
          ) {
            candidate.status = 'cancelled';
            candidate.effect.status = 'cancelled';
            candidate.effect.completedAt = now;
            candidate.failure = {
              code: 'cancelled',
              message: 'The owner cancelled the change before application.',
            };
            if (candidate.approval.status === 'pending') {
              candidate.approval.status = 'rejected';
              candidate.approval.decidedAt = now;
              candidate.approval.decidedBy = input.principalId;
            }
            appendEvent(
              candidate,
              'change_application_cancelled',
              now,
              {},
              createId,
            );
          } else {
            candidate.status = 'cancellation_requested';
            appendEvent(
              candidate,
              'change_application_cancellation_requested',
              now,
              {},
              createId,
            );
          }
          candidate.updatedAt = now;
          return true;
        },
      );
      if (application.status === 'cancellation_requested') {
        active
          .get(application.effect.id)
          ?.abort(
            new DOMException(
              'The owner cancelled the application.',
              'AbortError',
            ),
          );
      }
      return application;
    },

    async progress(principalId, applicationId) {
      let application = await requireApplication(principalId, applicationId);
      if (application.status === 'cancellation_requested') {
        try {
          const { artifact, project } = await loadDependencies(application);
          const reconciliation = await options.executor.reconcileCancellation({
            application,
            artifact,
            project,
          });
          const now = clock();
          return await update(principalId, applicationId, (candidate) => {
            if (candidate.status !== 'cancellation_requested') return false;
            candidate.effect.completedAt = now;
            candidate.updatedAt = now;
            if (reconciliation.outcome === 'succeeded') {
              candidate.status = 'succeeded';
              candidate.effect.status = 'succeeded';
              candidate.result = reconciliation.result;
              delete candidate.failure;
              appendEvent(
                candidate,
                'change_application_succeeded',
                now,
                {
                  effectId: candidate.effect.id,
                  workspacePath: reconciliation.result.workspacePath,
                  branchName: reconciliation.result.branchName,
                  reconciledAfterCancellation: true,
                },
                createId,
              );
            } else {
              candidate.status = 'cancelled';
              candidate.effect.status = 'cancelled';
              candidate.failure = {
                code: 'cancelled',
                message: 'The owner cancelled the change application.',
              };
              appendEvent(
                candidate,
                'change_application_cancelled',
                now,
                {},
                createId,
              );
            }
            return true;
          });
        } catch (error) {
          return recordFailure(application, error);
        }
      }
      if (application.status === 'approved') {
        const startedAt = clock();
        application = await update(principalId, applicationId, (candidate) => {
          if (candidate.status !== 'approved') return false;
          candidate.status = 'applying';
          candidate.effect.status = 'executing';
          candidate.effect.startedAt = startedAt;
          candidate.updatedAt = startedAt;
          appendEvent(
            candidate,
            'change_application_started',
            startedAt,
            { effectId: candidate.effect.id },
            createId,
          );
          return true;
        });
      }
      if (application.status !== 'applying') return application;

      const controller = new AbortController();
      active.set(application.effect.id, controller);
      try {
        const latest = await requireApplication(principalId, applicationId);
        if (latest.status === 'cancellation_requested') controller.abort();
        const { artifact, project } = await loadDependencies(application);
        const result = await options.executor.execute({
          application,
          artifact,
          project,
          signal: controller.signal,
        });
        const completedAt = clock();
        return await update(principalId, applicationId, (candidate) => {
          if (
            candidate.status !== 'applying' &&
            candidate.status !== 'cancellation_requested'
          ) {
            return false;
          }
          candidate.status = 'succeeded';
          candidate.effect.status = 'succeeded';
          candidate.effect.completedAt = completedAt;
          candidate.result = result;
          delete candidate.failure;
          candidate.updatedAt = completedAt;
          appendEvent(
            candidate,
            'change_application_succeeded',
            completedAt,
            {
              effectId: candidate.effect.id,
              workspacePath: result.workspacePath,
              branchName: result.branchName,
            },
            createId,
          );
          return true;
        });
      } catch (error) {
        if (
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          const now = clock();
          return await update(principalId, applicationId, (candidate) => {
            if (
              candidate.status !== 'applying' &&
              candidate.status !== 'cancellation_requested'
            ) {
              return false;
            }
            candidate.status = 'cancelled';
            candidate.effect.status = 'cancelled';
            candidate.effect.completedAt = now;
            candidate.failure = {
              code: 'cancelled',
              message: 'The owner cancelled the change application.',
            };
            candidate.updatedAt = now;
            appendEvent(
              candidate,
              'change_application_cancelled',
              now,
              {},
              createId,
            );
            return true;
          });
        }
        return await recordFailure(application, error);
      } finally {
        active.delete(application.effect.id);
      }
    },
  };
}
