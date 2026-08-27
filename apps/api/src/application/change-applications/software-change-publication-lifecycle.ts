import { randomUUID } from 'node:crypto';

import {
  SoftwareChangePublicationSchema,
  type SoftwareChangePublication,
  type SoftwareChangePublicationEvent,
} from '../../domain/changes/software-change-publication.ts';
import {
  SoftwareChangePublicationExecutionError,
  type SoftwareChangePublicationExecutor,
} from '../../ports/change-applications/software-change-publication-executor.ts';
import type { ChangeApplicationStore } from '../../ports/persistence/change-application-store.ts';
import type { ProjectStore } from '../../ports/persistence/project-store.ts';
import type { SoftwareChangePublicationStore } from '../../ports/persistence/software-change-publication-store.ts';

export type SoftwareChangePublicationErrorCode =
  | 'software_change_publication_not_found'
  | 'software_change_publication_source_required'
  | 'software_change_publication_idempotency_key_reused'
  | 'software_change_publication_approval_already_decided'
  | 'software_change_publication_concurrent_transition_failed'
  | 'software_change_publication_not_cancellable';

export class SoftwareChangePublicationError extends Error {
  public constructor(
    message: string,
    public readonly code: SoftwareChangePublicationErrorCode,
  ) {
    super(message);
    this.name = 'SoftwareChangePublicationError';
  }
}

type Clock = () => string;
type IdFactory = (prefix: string) => string;

export type SoftwareChangePublicationLifecycle = {
  create(input: {
    principalId: string;
    requestKey: string;
    applicationId: string;
    baseBranch: string;
    commitMessage: string;
    pullRequest: { title: string; body: string; draft: boolean };
  }): Promise<SoftwareChangePublication>;
  get(
    principalId: string,
    publicationId: string,
  ): Promise<SoftwareChangePublication>;
  listForApplication(
    principalId: string,
    applicationId: string,
  ): Promise<SoftwareChangePublication[]>;
  decideApproval(input: {
    principalId: string;
    publicationId: string;
    decision: 'approved' | 'rejected';
  }): Promise<SoftwareChangePublication>;
  cancel(input: {
    principalId: string;
    publicationId: string;
  }): Promise<SoftwareChangePublication>;
  progress(
    principalId: string,
    publicationId: string,
  ): Promise<SoftwareChangePublication>;
};

function appendEvent(
  publication: SoftwareChangePublication,
  type: SoftwareChangePublicationEvent['type'],
  occurredAt: string,
  data: Record<string, unknown>,
  createId: IdFactory,
) {
  publication.events.push({
    schemaVersion: 1,
    id: createId('event'),
    sequence: publication.events.length + 1,
    type,
    occurredAt,
    data,
  });
}

export function createSoftwareChangePublicationLifecycle(options: {
  store: SoftwareChangePublicationStore;
  applications: ChangeApplicationStore;
  projects: ProjectStore;
  executor: SoftwareChangePublicationExecutor;
  clock?: Clock;
  createId?: IdFactory;
  observer?: {
    warning(error: unknown, context: Record<string, unknown>): void;
  };
}): SoftwareChangePublicationLifecycle {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const observer = options.observer ?? { warning: () => undefined };

  async function requirePublication(
    principalId: string,
    publicationId: string,
  ) {
    const publication = await options.store.findById(
      principalId,
      publicationId,
    );
    if (publication === null) {
      throw new SoftwareChangePublicationError(
        `Software-change publication ${publicationId} was not found.`,
        'software_change_publication_not_found',
      );
    }
    return publication;
  }

  async function update(
    principalId: string,
    publicationId: string,
    transition: (candidate: SoftwareChangePublication) => boolean,
  ) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await requirePublication(principalId, publicationId);
      const candidate = structuredClone(current);
      if (!transition(candidate)) return current;
      candidate.version = current.version + 1;
      SoftwareChangePublicationSchema.parse(candidate);
      if (await options.store.replace(candidate, current.version))
        return candidate;
    }
    throw new SoftwareChangePublicationError(
      `Software-change publication ${publicationId} changed too frequently.`,
      'software_change_publication_concurrent_transition_failed',
    );
  }

  async function dependencies(publication: SoftwareChangePublication) {
    const application = await options.applications.findById(
      publication.principalId,
      publication.sourceApplication.id,
    );
    if (
      application?.status !== 'succeeded' ||
      application.result === undefined ||
      application.effect.id !== publication.sourceApplication.effectId ||
      application.version !== publication.sourceApplication.version
    ) {
      throw new SoftwareChangePublicationExecutionError(
        'The staged source application is missing or changed after approval.',
        'publication_conflict',
      );
    }
    const project = await options.projects.findProjectById(
      publication.principalId,
      publication.project.id,
    );
    if (project === null) {
      throw new SoftwareChangePublicationExecutionError(
        'The registered project is no longer available.',
        'publication_conflict',
      );
    }
    return { application, project };
  }

  async function fail(publication: SoftwareChangePublication, error: unknown) {
    const classified =
      error instanceof SoftwareChangePublicationExecutionError
        ? error
        : new SoftwareChangePublicationExecutionError(
            'Vera could not complete the approved publication.',
            'publication_failed',
          );
    observer.warning(classified, {
      operation: 'software_change_publication',
      publicationId: publication.id,
      effectId: publication.effect.id,
      errorCode: classified.code,
    });
    const now = clock();
    return update(publication.principalId, publication.id, (candidate) => {
      if (candidate.status !== 'publishing') return false;
      const reviewRequired = classified.code === 'review_required';
      candidate.status = reviewRequired ? 'review_required' : 'failed';
      candidate.effect.status = reviewRequired ? 'review_required' : 'failed';
      candidate.effect.completedAt = now;
      candidate.failure = {
        code: classified.code,
        message: classified.message,
      };
      candidate.updatedAt = now;
      appendEvent(
        candidate,
        reviewRequired
          ? 'software_change_publication_review_required'
          : 'software_change_publication_failed',
        now,
        { code: classified.code },
        createId,
      );
      return true;
    });
  }

  function matchesRequest(
    publication: SoftwareChangePublication,
    input: {
      applicationId: string;
      baseBranch: string;
      commitMessage: string;
      pullRequest: { title: string; body: string; draft: boolean };
    },
  ) {
    const effect = publication.approval.effect;
    return (
      publication.sourceApplication.id === input.applicationId &&
      effect.baseBranch === input.baseBranch &&
      effect.commitMessage === input.commitMessage.trim() &&
      effect.pullRequest.title === input.pullRequest.title.trim() &&
      effect.pullRequest.body === input.pullRequest.body &&
      effect.pullRequest.draft === input.pullRequest.draft
    );
  }

  return {
    async listForApplication(principalId, applicationId) {
      return options.store.listBySourceApplication(
        principalId,
        applicationId,
        20,
      );
    },
    async create(input) {
      const existing = await options.store.findByRequestKey(
        input.principalId,
        input.requestKey,
      );
      if (existing !== null) {
        if (!matchesRequest(existing, input)) {
          throw new SoftwareChangePublicationError(
            `Idempotency key ${input.requestKey} is already associated with another publication request.`,
            'software_change_publication_idempotency_key_reused',
          );
        }
        return existing;
      }
      const application = await options.applications.findById(
        input.principalId,
        input.applicationId,
      );
      if (
        application?.status !== 'succeeded' ||
        application.result === undefined
      ) {
        throw new SoftwareChangePublicationError(
          `Change application ${input.applicationId} is not a successfully staged change.`,
          'software_change_publication_source_required',
        );
      }
      const project = await options.projects.findProjectById(
        input.principalId,
        application.project.id,
      );
      if (project === null) {
        throw new SoftwareChangePublicationError(
          `The project for change application ${input.applicationId} was not found.`,
          'software_change_publication_source_required',
        );
      }
      const effect = await options.executor.prepare({
        application,
        project,
        baseBranch: input.baseBranch,
        commitMessage: input.commitMessage,
        pullRequest: input.pullRequest,
      });
      const publicationId = createId('publication');
      const approvalId = createId('approval');
      const now = clock();
      const publication = SoftwareChangePublicationSchema.parse({
        schemaVersion: 1,
        version: 1,
        id: publicationId,
        requestKey: input.requestKey,
        principalId: input.principalId,
        status: 'awaiting_approval',
        sourceApplication: {
          id: application.id,
          effectId: application.effect.id,
          version: application.version,
        },
        project: structuredClone(application.project),
        approval: {
          id: approvalId,
          status: 'pending',
          reason: 'software_change_publication',
          effect,
          requestedAt: now,
        },
        effect: { id: createId('effect'), status: 'pending' },
        events: [
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 1,
            type: 'software_change_publication_created',
            occurredAt: now,
            data: { applicationId: application.id, projectId: project.id },
          },
          {
            schemaVersion: 1,
            id: createId('event'),
            sequence: 2,
            type: 'software_change_publication_approval_requested',
            occurredAt: now,
            data: {
              approvalId,
              repository: `${effect.repository.owner}/${effect.repository.name}`,
              baseBranch: effect.baseBranch,
              headBranch: effect.headBranch,
              treeRevision: effect.treeRevision,
            },
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const created = await options.store.create(publication);
      if (!created.created && !matchesRequest(created.publication, input)) {
        throw new SoftwareChangePublicationError(
          `Idempotency key ${input.requestKey} is already associated with another publication request.`,
          'software_change_publication_idempotency_key_reused',
        );
      }
      return created.publication;
    },

    get: requirePublication,

    async decideApproval(input) {
      const now = clock();
      return update(input.principalId, input.publicationId, (candidate) => {
        if (candidate.approval.status !== 'pending') {
          if (
            candidate.approval.status === input.decision &&
            candidate.approval.decidedBy === input.principalId
          )
            return false;
          throw new SoftwareChangePublicationError(
            `Approval ${candidate.approval.id} has already been decided.`,
            'software_change_publication_approval_already_decided',
          );
        }
        candidate.approval.status = input.decision;
        candidate.approval.decidedAt = now;
        candidate.approval.decidedBy = input.principalId;
        candidate.status =
          input.decision === 'approved' ? 'approved' : 'rejected';
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          input.decision === 'approved'
            ? 'software_change_publication_approval_approved'
            : 'software_change_publication_approval_rejected',
          now,
          { approvalId: candidate.approval.id },
          createId,
        );
        return true;
      });
    },

    async cancel(input) {
      const now = clock();
      return update(input.principalId, input.publicationId, (candidate) => {
        if (!['awaiting_approval', 'approved'].includes(candidate.status)) {
          throw new SoftwareChangePublicationError(
            `Publication ${candidate.id} can no longer be cancelled safely.`,
            'software_change_publication_not_cancellable',
          );
        }
        candidate.status = 'cancelled';
        candidate.effect.status = 'cancelled';
        candidate.effect.completedAt = now;
        candidate.failure = {
          code: 'cancelled',
          message: 'The owner cancelled publication before execution began.',
        };
        if (candidate.approval.status === 'pending') {
          candidate.approval.status = 'rejected';
          candidate.approval.decidedAt = now;
          candidate.approval.decidedBy = input.principalId;
        }
        candidate.updatedAt = now;
        appendEvent(
          candidate,
          'software_change_publication_cancelled',
          now,
          {},
          createId,
        );
        return true;
      });
    },

    async progress(principalId, publicationId) {
      let publication = await requirePublication(principalId, publicationId);
      if (publication.status === 'approved') {
        const now = clock();
        publication = await update(principalId, publicationId, (candidate) => {
          if (candidate.status !== 'approved') return false;
          candidate.status = 'publishing';
          candidate.effect.status = 'executing';
          candidate.effect.startedAt = now;
          candidate.updatedAt = now;
          appendEvent(
            candidate,
            'software_change_publication_started',
            now,
            {
              effectId: candidate.effect.id,
            },
            createId,
          );
          return true;
        });
      }
      if (publication.status !== 'publishing') return publication;
      try {
        const { application, project } = await dependencies(publication);
        const result = await options.executor.execute({
          publication,
          application,
          project,
        });
        const now = clock();
        return await update(principalId, publicationId, (candidate) => {
          if (candidate.status !== 'publishing') return false;
          candidate.status = 'succeeded';
          candidate.effect.status = 'succeeded';
          candidate.effect.completedAt = now;
          candidate.result = result;
          delete candidate.failure;
          candidate.updatedAt = now;
          appendEvent(
            candidate,
            'software_change_publication_succeeded',
            now,
            {
              effectId: candidate.effect.id,
              commitRevision: result.commitRevision,
              pullRequestNumber: result.pullRequest.number,
              pullRequestUrl: result.pullRequest.url,
            },
            createId,
          );
          return true;
        });
      } catch (error) {
        return fail(publication, error);
      }
    },
  };
}
