import { createHash } from 'node:crypto';
import { assertProjectContextIntegrity } from '../../projects/validate-project-context.ts';
import {
  ArtifactSchema,
  type Artifact,
} from '../../../domain/artifacts/artifact.ts';
import { sameCapabilityDestination } from '../../../domain/capabilities/capability-destination.ts';
import {
  CapabilityInvocationSchema,
  type TaskAggregate,
} from '../../../domain/tasks/task-aggregate.ts';
import { appendEvent, type TaskLifecycleRuntime } from './contracts.ts';
import type { TaskLifecycleFoundation } from './foundation.ts';
import type { TaskLifecycleDecisionRecording } from './decision-recording.ts';

export function createExecutionOperations(
  runtime: TaskLifecycleRuntime,
  operations: TaskLifecycleFoundation & TaskLifecycleDecisionRecording,
) {
  const { options, observer, clock, createId, budget, activeInvocations } =
    runtime;
  const {
    artifactReference,
    artifactContentIsIntact,
    sameArtifactReferences,
    sameAttachmentReferences,
    authorityIsWithin,
    sameAuthorityOrLegacyDecisionEvidence,
    setCurrentGoalStepStatus,
    archiveCurrentGoalBoundary,
    prepareGoalStepApproval,
    update,
    recordFailure,
  } = operations;
  async function executeApproved(
    aggregate: TaskAggregate,
    resumeExistingInvocation: boolean,
  ): Promise<TaskAggregate> {
    const invocationId = createId('invocation');
    const now = clock();
    const claim = await update(
      aggregate.task.principalId,
      aggregate.task.id,
      (candidate) => {
        if (
          candidate.run.status !== 'awaiting_approval' ||
          candidate.run.approval?.status !== 'approved'
        ) {
          return false;
        }
        candidate.run.budget ??= structuredClone(budget);
        const elapsed = Date.parse(now) - Date.parse(candidate.run.createdAt);
        if (
          candidate.run.budget.consumed.capabilityInvocations >=
            candidate.run.budget.limits.capabilityInvocations ||
          elapsed >= candidate.run.budget.limits.maxDurationMs
        ) {
          candidate.run.status = 'failed';
          candidate.task.status = 'failed';
          if (candidate.run.goal !== undefined) {
            candidate.run.goal.status = 'failed';
            setCurrentGoalStepStatus(candidate, 'failed');
          }
          candidate.run.failure = {
            code: 'budget_exhausted',
            message:
              'The run exhausted its capability-invocation or duration budget.',
          };
          appendEvent(
            candidate,
            'budget_exhausted',
            now,
            { resource: 'capability_invocations_or_duration' },
            createId,
          );
          appendEvent(
            candidate,
            'run_failed',
            now,
            { code: 'budget_exhausted' },
            createId,
          );
          return true;
        }
        candidate.run.budget.consumed.capabilityInvocations += 1;
        candidate.run.status = 'executing';
        candidate.run.updatedAt = now;
        candidate.task.updatedAt = now;
        candidate.run.invocation = CapabilityInvocationSchema.parse({
          id: invocationId,
          status: 'executing',
          capability: candidate.run.approval.capability,
          arguments: candidate.run.approval.proposedArguments,
          ...(candidate.run.approval.project === undefined
            ? {}
            : { project: candidate.run.approval.project }),
          ...(candidate.run.approval.contextManifest === undefined
            ? {}
            : { contextManifest: candidate.run.approval.contextManifest }),
          ...(candidate.run.approval.destination === undefined
            ? {}
            : { destination: candidate.run.approval.destination }),
          ...(candidate.run.approval.authority === undefined
            ? {}
            : { authority: candidate.run.approval.authority }),
          ...(candidate.run.approval.inputArtifacts === undefined
            ? {}
            : { inputArtifacts: candidate.run.approval.inputArtifacts }),
          ...(candidate.run.approval.decisionEvidence === undefined
            ? {}
            : { decisionEvidence: candidate.run.approval.decisionEvidence }),
          ...(candidate.run.approval.attachments === undefined
            ? {}
            : { attachments: candidate.run.approval.attachments }),
          startedAt: now,
        });
        const goalStep =
          candidate.run.goal?.steps[candidate.run.goal.currentStepIndex];
        if (goalStep !== undefined) {
          if (goalStep.approvalId !== candidate.run.approval.id) {
            throw new Error('The goal step approval identity changed.');
          }
          goalStep.status = 'executing';
          goalStep.invocationId = invocationId;
        }
        appendEvent(
          candidate,
          'budget_consumed',
          now,
          {
            resource: 'capability_invocations',
            consumed: candidate.run.budget.consumed.capabilityInvocations,
            limit: candidate.run.budget.limits.capabilityInvocations,
          },
          createId,
        );
        appendEvent(
          candidate,
          'capability_invocation_started',
          now,
          { invocationId },
          createId,
        );
        return true;
      },
    );

    const claimedInvocation = claim.aggregate.run.invocation;
    if (claimedInvocation === undefined) {
      return claim.aggregate;
    }
    // Only the caller that won the awaiting-approval transition executes fresh
    // work. Startup recovery is the one exception: it may resume the already
    // persisted invocation ID without writing a second start event.
    const freshlyClaimed =
      claim.changed && claimedInvocation.id === invocationId;
    const resumingInterruptedInvocation =
      !claim.changed &&
      resumeExistingInvocation &&
      claim.aggregate.run.status === 'executing' &&
      claimedInvocation.status === 'executing';
    const shouldExecute = freshlyClaimed || resumingInterruptedInvocation;
    if (!shouldExecute) {
      return claim.aggregate;
    }

    const completeWithArtifact = async (
      artifact: Artifact,
    ): Promise<TaskAggregate> => {
      const completedAt = clock();
      const completion = await update(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
        (candidate) => {
          if (
            !['executing', 'cancellation_requested'].includes(
              candidate.run.status,
            ) ||
            candidate.run.invocation?.id !== claimedInvocation.id ||
            candidate.run.invocation.status !== 'executing'
          ) {
            return false;
          }
          candidate.run.updatedAt = completedAt;
          candidate.task.updatedAt = completedAt;
          candidate.run.invocation.status = 'succeeded';
          candidate.run.invocation.completedAt = completedAt;
          const { destination: ignoredDestination, ...producerModel } =
            artifact.producer;
          void ignoredDestination;
          candidate.run.invocation.model = producerModel;
          const reference = artifactReference(artifact);
          appendEvent(
            candidate,
            'artifact_created',
            completedAt,
            { artifactId: artifact.id, invocationId: claimedInvocation.id },
            createId,
          );
          appendEvent(
            candidate,
            'capability_invocation_succeeded',
            completedAt,
            { invocationId: claimedInvocation.id },
            createId,
          );
          const goal = candidate.run.goal;
          if (goal !== undefined) {
            const step = goal.steps[goal.currentStepIndex];
            if (step?.invocationId !== claimedInvocation.id) {
              throw new Error(
                'The completed invocation is not the active goal step.',
              );
            }
            step.status = 'succeeded';
            step.artifact = reference;
            appendEvent(
              candidate,
              'goal_step_succeeded',
              completedAt,
              {
                goalStepId: step.id,
                artifactId: artifact.id,
                capability: `${step.capability}@${String(step.version)}`,
              },
              createId,
            );
            if (goal.schemaVersion === 2) {
              candidate.run.status = 'deciding';
              delete candidate.run.output;
              appendEvent(
                candidate,
                'adaptive_goal_observation_recorded',
                completedAt,
                {
                  goalStepId: step.id,
                  artifactId: artifact.id,
                  capability: `${step.capability}@${String(step.version)}`,
                },
                createId,
              );
              return true;
            }
            const nextStepIndex = goal.currentStepIndex + 1;
            if (nextStepIndex < goal.steps.length) {
              archiveCurrentGoalBoundary(candidate);
              prepareGoalStepApproval(candidate, nextStepIndex, completedAt);
              return true;
            }
            const artifacts = goal.steps.map((goalStep) => {
              if (goalStep.artifact === undefined) {
                throw new Error('A completed goal is missing a step artifact.');
              }
              return goalStep.artifact;
            });
            goal.status = 'succeeded';
            candidate.run.status = 'succeeded';
            candidate.task.status = 'completed';
            candidate.run.output = {
              kind: 'goal_result',
              objective: goal.objective,
              summary: goal.summary,
              artifacts,
            };
            appendEvent(
              candidate,
              'goal_succeeded',
              completedAt,
              { artifactIds: artifacts.map((value) => value.id) },
              createId,
            );
            appendEvent(candidate, 'run_succeeded', completedAt, {}, createId);
            return true;
          }

          candidate.run.status = 'succeeded';
          candidate.task.status = 'completed';
          candidate.run.output =
            artifact.type === 'implementation_plan'
              ? {
                  kind: 'development_plan',
                  plan: artifact.content,
                  artifact: {
                    id: artifact.id,
                    version: artifact.version,
                    type: artifact.type,
                    mediaType: artifact.mediaType,
                    sha256: artifact.sha256,
                    byteLength: artifact.byteLength,
                  },
                }
              : artifact.type === 'software_change'
                ? {
                    kind: 'software_change',
                    change: artifact.content,
                    artifact: {
                      id: artifact.id,
                      version: artifact.version,
                      type: artifact.type,
                      mediaType: artifact.mediaType,
                      sha256: artifact.sha256,
                      byteLength: artifact.byteLength,
                    },
                  }
                : artifact.type === 'research_report'
                  ? {
                      kind: 'research_report',
                      report: artifact.content,
                      artifact: {
                        id: artifact.id,
                        version: artifact.version,
                        type: artifact.type,
                        mediaType: artifact.mediaType,
                        sha256: artifact.sha256,
                        byteLength: artifact.byteLength,
                      },
                    }
                  : artifact.type === 'personal_task_result'
                    ? {
                        kind: 'personal_task_result',
                        result: artifact.content,
                        artifact: {
                          id: artifact.id,
                          version: artifact.version,
                          type: artifact.type,
                          mediaType: artifact.mediaType,
                          sha256: artifact.sha256,
                          byteLength: artifact.byteLength,
                        },
                      }
                    : artifact.type === 'personal_reminder_result'
                      ? {
                          kind: 'personal_reminder_result',
                          result: artifact.content,
                          artifact: {
                            id: artifact.id,
                            version: artifact.version,
                            type: artifact.type,
                            mediaType: artifact.mediaType,
                            sha256: artifact.sha256,
                            byteLength: artifact.byteLength,
                          },
                        }
                      : artifact.type === 'memory_result'
                        ? {
                            kind: 'memory_result',
                            result: artifact.content,
                            artifact: {
                              id: artifact.id,
                              version: artifact.version,
                              type: artifact.type,
                              mediaType: artifact.mediaType,
                              sha256: artifact.sha256,
                              byteLength: artifact.byteLength,
                            },
                          }
                        : artifact.type === 'attachment_analysis'
                          ? {
                              kind: 'attachment_analysis',
                              analysis: artifact.content,
                              artifact: {
                                id: artifact.id,
                                version: artifact.version,
                                type: artifact.type,
                                mediaType: artifact.mediaType,
                                sha256: artifact.sha256,
                                byteLength: artifact.byteLength,
                              },
                            }
                          : artifact.type === 'machine_diagnostic'
                            ? {
                                kind: 'machine_diagnostic',
                                diagnostic: artifact.content,
                                artifact: {
                                  id: artifact.id,
                                  version: artifact.version,
                                  type: artifact.type,
                                  mediaType: artifact.mediaType,
                                  sha256: artifact.sha256,
                                  byteLength: artifact.byteLength,
                                },
                              }
                            : artifact.type === 'machine_service_action_result'
                              ? {
                                  kind: 'machine_service_action_result',
                                  result: artifact.content,
                                  artifact: {
                                    id: artifact.id,
                                    version: artifact.version,
                                    type: artifact.type,
                                    mediaType: artifact.mediaType,
                                    sha256: artifact.sha256,
                                    byteLength: artifact.byteLength,
                                  },
                                }
                              : artifact.type === 'mission_management_result'
                                ? {
                                    kind: 'mission_management_result',
                                    result: artifact.content,
                                    artifact: {
                                      id: artifact.id,
                                      version: artifact.version,
                                      type: artifact.type,
                                      mediaType: artifact.mediaType,
                                      sha256: artifact.sha256,
                                      byteLength: artifact.byteLength,
                                    },
                                  }
                                : artifact.type === 'knowledge_result'
                                  ? {
                                      kind: 'knowledge_result',
                                      result: artifact.content,
                                      artifact: {
                                        id: artifact.id,
                                        version: artifact.version,
                                        type: artifact.type,
                                        mediaType: artifact.mediaType,
                                        sha256: artifact.sha256,
                                        byteLength: artifact.byteLength,
                                      },
                                    }
                                  : artifact.type === 'attention_result'
                                    ? {
                                        kind: 'attention_result',
                                        result: artifact.content,
                                        artifact: {
                                          id: artifact.id,
                                          version: artifact.version,
                                          type: artifact.type,
                                          mediaType: artifact.mediaType,
                                          sha256: artifact.sha256,
                                          byteLength: artifact.byteLength,
                                        },
                                      }
                                    : {
                                        kind: 'routine_management_result',
                                        result: artifact.content,
                                        artifact: {
                                          id: artifact.id,
                                          version: artifact.version,
                                          type: artifact.type,
                                          mediaType: artifact.mediaType,
                                          sha256: artifact.sha256,
                                          byteLength: artifact.byteLength,
                                        },
                                      };
          appendEvent(candidate, 'run_succeeded', completedAt, {}, createId);
          return true;
        },
      );
      return completion.aggregate;
    };

    try {
      const existingArtifact =
        await options.resources.findArtifactByInvocationId(
          claim.aggregate.task.principalId,
          claimedInvocation.id,
        );
      if (existingArtifact !== null) {
        const approvedDestination = claim.aggregate.run.approval?.destination;
        const existingProjectId =
          'projectId' in existingArtifact
            ? existingArtifact.projectId
            : undefined;
        if (
          existingArtifact.taskId !== claim.aggregate.task.id ||
          existingArtifact.runId !== claim.aggregate.run.id ||
          existingProjectId !== claimedInvocation.project?.id ||
          (existingArtifact.producer.destination !== undefined &&
            approvedDestination !== undefined &&
            !sameCapabilityDestination(
              existingArtifact.producer.destination,
              approvedDestination,
            ))
        ) {
          throw new Error(
            'The idempotent artifact belongs to a different invocation context.',
          );
        }
        if (!artifactContentIsIntact(existingArtifact)) {
          throw new Error(
            'The idempotent artifact content failed integrity validation.',
          );
        }
        if (
          !sameArtifactReferences(
            existingArtifact.inputs,
            claimedInvocation.inputArtifacts,
          )
        ) {
          throw new Error(
            'The idempotent artifact lineage differs from the approved inputs.',
          );
        }
        return await completeWithArtifact(existingArtifact);
      }
      let executionAggregate = claim.aggregate;
      if (resumingInterruptedInvocation) {
        const retryAt = clock();
        const retryClaim = await update(
          claim.aggregate.task.principalId,
          claim.aggregate.task.id,
          (candidate) => {
            if (
              candidate.run.status !== 'executing' ||
              candidate.run.invocation?.id !== claimedInvocation.id
            ) {
              return false;
            }
            candidate.run.budget ??= structuredClone(budget);
            if (
              candidate.run.budget.consumed.retries >=
              candidate.run.budget.limits.retries
            ) {
              candidate.run.status = 'failed';
              candidate.task.status = 'failed';
              if (candidate.run.goal !== undefined) {
                candidate.run.goal.status = 'failed';
                setCurrentGoalStepStatus(candidate, 'failed');
              }
              candidate.run.failure = {
                code: 'budget_exhausted',
                message: 'The run exhausted its recovery retry budget.',
              };
              candidate.run.invocation.status = 'failed';
              candidate.run.invocation.completedAt = retryAt;
              candidate.run.updatedAt = retryAt;
              candidate.task.updatedAt = retryAt;
              appendEvent(
                candidate,
                'budget_exhausted',
                retryAt,
                { resource: 'retries' },
                createId,
              );
              appendEvent(
                candidate,
                'run_failed',
                retryAt,
                { code: 'budget_exhausted' },
                createId,
              );
              return true;
            }
            candidate.run.budget.consumed.retries += 1;
            candidate.run.updatedAt = retryAt;
            candidate.task.updatedAt = retryAt;
            appendEvent(
              candidate,
              'budget_consumed',
              retryAt,
              {
                resource: 'retries',
                consumed: candidate.run.budget.consumed.retries,
                limit: candidate.run.budget.limits.retries,
              },
              createId,
            );
            return true;
          },
        );
        if (retryClaim.aggregate.run.status !== 'executing') {
          return retryClaim.aggregate;
        }
        executionAggregate = retryClaim.aggregate;
      }
      const projectReference = claimedInvocation.project;
      const runBudget = executionAggregate.run.budget;
      const approvedDestination = executionAggregate.run.approval?.destination;
      const approvedAuthority = executionAggregate.run.approval?.authority;
      if (runBudget === undefined || approvedDestination === undefined) {
        throw new Error(
          'The approved invocation is missing its destination or limits.',
        );
      }
      if (
        claimedInvocation.destination !== undefined &&
        !sameCapabilityDestination(
          claimedInvocation.destination,
          approvedDestination,
        )
      ) {
        throw new Error(
          'The claimed invocation destination differs from the approved destination.',
        );
      }
      if (
        claimedInvocation.authority !== undefined &&
        approvedAuthority !== undefined &&
        JSON.stringify(claimedInvocation.authority) !==
          JSON.stringify(approvedAuthority)
      ) {
        throw new Error(
          'The claimed invocation authority differs from the approved authority.',
        );
      }
      if (
        !sameArtifactReferences(
          claimedInvocation.decisionEvidence,
          executionAggregate.run.approval?.decisionEvidence,
        )
      ) {
        throw new Error(
          'The claimed decision evidence differs from the approved evidence.',
        );
      }
      if (
        !sameAttachmentReferences(
          claimedInvocation.attachments,
          executionAggregate.run.approval?.attachments,
        )
      ) {
        throw new Error(
          'The claimed attachment inputs differ from the approved inputs.',
        );
      }
      const capabilityRuntime = options.capabilities.resolve(
        claimedInvocation.capability,
        approvedDestination,
      );
      if (capabilityRuntime === null) {
        throw new Error(
          `The approved capability adapter ${approvedDestination.adapterId} is unavailable or its destination configuration changed.`,
        );
      }
      const currentAuthority = capabilityRuntime.authorityFor({
        arguments: claimedInvocation.arguments,
        hasInputArtifacts: (claimedInvocation.inputArtifacts?.length ?? 0) > 0,
        hasDecisionEvidence:
          (claimedInvocation.decisionEvidence?.length ?? 0) > 0,
      });
      if (!authorityIsWithin(currentAuthority, capabilityRuntime.authority)) {
        throw new Error(
          'The capability resolved authority outside its declared maximum.',
        );
      }
      if (
        approvedAuthority !== undefined &&
        !sameAuthorityOrLegacyDecisionEvidence(
          approvedAuthority,
          currentAuthority,
          claimedInvocation,
        )
      ) {
        throw new Error('The capability authority changed after approval.');
      }
      const requiresProjectContext =
        capabilityRuntime.authority.projectContext === 'required';
      const context = requiresProjectContext
        ? executionAggregate.run.context
        : undefined;
      if (
        requiresProjectContext &&
        (context === undefined || projectReference === undefined)
      ) {
        throw new Error(
          'The approved project capability is missing authoritative context.',
        );
      }
      if (!requiresProjectContext && projectReference !== undefined) {
        throw new Error(
          'A project-independent capability contains unexpected project context.',
        );
      }
      if (context !== undefined && projectReference !== undefined) {
        assertProjectContextIntegrity(context, projectReference.id);
      }
      const activeGoal = executionAggregate.run.goal;
      if (activeGoal !== undefined) {
        const activeStep = activeGoal.steps[activeGoal.currentStepIndex];
        if (activeStep?.invocationId !== claimedInvocation.id) {
          throw new Error('The invocation is not the active goal step.');
        }
        const expectedInputs = activeStep.inputStepIds.map((stepId) => {
          const dependency = activeGoal.steps.find(
            (step) => step.id === stepId,
          );
          if (dependency?.artifact === undefined) {
            throw new Error(
              `The active goal step is missing completed dependency ${stepId}.`,
            );
          }
          return dependency.artifact;
        });
        if (
          !sameArtifactReferences(
            expectedInputs,
            claimedInvocation.inputArtifacts,
          )
        ) {
          throw new Error(
            'The claimed artifact inputs differ from the goal dependencies.',
          );
        }
      } else if (claimedInvocation.inputArtifacts?.length) {
        throw new Error(
          'A non-goal invocation cannot consume prior artifacts.',
        );
      }
      const inputArtifacts: Artifact[] = [];
      for (const reference of claimedInvocation.inputArtifacts ?? []) {
        const inputArtifact = await options.resources.findArtifactById(
          executionAggregate.task.principalId,
          reference.id,
        );
        if (inputArtifact === null) {
          throw new Error(
            `Approved input artifact ${reference.id} was not found.`,
          );
        }
        const inputProjectId =
          'projectId' in inputArtifact ? inputArtifact.projectId : undefined;
        if (
          inputArtifact.taskId !== executionAggregate.task.id ||
          inputArtifact.runId !== executionAggregate.run.id ||
          inputArtifact.type !== reference.type ||
          inputArtifact.mediaType !== reference.mediaType ||
          inputArtifact.sha256 !== reference.sha256 ||
          inputArtifact.byteLength !== reference.byteLength ||
          !artifactContentIsIntact(inputArtifact) ||
          (inputProjectId !== undefined &&
            inputProjectId !== executionAggregate.task.projectId) ||
          !capabilityRuntime.definition.acceptedInputArtifacts.includes(
            inputArtifact.type,
          )
        ) {
          throw new Error(
            `Approved input artifact ${reference.id} failed integrity, scope, or compatibility validation.`,
          );
        }
        inputArtifacts.push(inputArtifact);
      }
      const elapsedBeforeInvocation =
        Date.parse(clock()) - Date.parse(executionAggregate.run.createdAt);
      const remainingDurationMs =
        runBudget.limits.maxDurationMs - elapsedBeforeInvocation;
      if (remainingDurationMs <= 0) {
        const exhaustedAt = clock();
        const exhausted = await update(
          executionAggregate.task.principalId,
          executionAggregate.task.id,
          (candidate) => {
            if (
              candidate.run.status !== 'executing' ||
              candidate.run.invocation?.id !== claimedInvocation.id
            ) {
              return false;
            }
            candidate.run.status = 'failed';
            candidate.task.status = 'failed';
            if (candidate.run.goal !== undefined) {
              candidate.run.goal.status = 'failed';
              setCurrentGoalStepStatus(candidate, 'failed');
            }
            candidate.run.failure = {
              code: 'budget_exhausted',
              message: 'The run exhausted its duration budget.',
            };
            candidate.run.invocation.status = 'failed';
            candidate.run.invocation.completedAt = exhaustedAt;
            candidate.run.updatedAt = exhaustedAt;
            candidate.task.updatedAt = exhaustedAt;
            appendEvent(
              candidate,
              'budget_exhausted',
              exhaustedAt,
              { resource: 'duration' },
              createId,
            );
            appendEvent(
              candidate,
              'run_failed',
              exhaustedAt,
              { code: 'budget_exhausted' },
              createId,
            );
            return true;
          },
        );
        return exhausted.aggregate;
      }
      const controller = new AbortController();
      activeInvocations.set(claimedInvocation.id, controller);
      const latestBeforeInvocation = await options.store.findByTaskId(
        executionAggregate.task.principalId,
        executionAggregate.task.id,
      );
      if (latestBeforeInvocation?.run.status === 'cancellation_requested') {
        controller.abort();
      }
      const result = await capabilityRuntime.execute(
        {
          invocationId: claimedInvocation.id,
          principalId: executionAggregate.task.principalId,
          startedAt: claimedInvocation.startedAt,
          recovery: resumingInterruptedInvocation,
          arguments: claimedInvocation.arguments,
          source: {
            taskId: executionAggregate.task.id,
            ...(executionAggregate.task.conversationId === undefined
              ? {}
              : { conversationId: executionAggregate.task.conversationId }),
            ...(executionAggregate.task.messageId === undefined
              ? {}
              : { messageId: executionAggregate.task.messageId }),
          },
          ...(projectReference === undefined
            ? {}
            : { project: projectReference }),
          ...(context === undefined ? {} : { context }),
          ...(inputArtifacts.length === 0 ? {} : { artifacts: inputArtifacts }),
          ...(claimedInvocation.attachments === undefined
            ? {}
            : { attachments: claimedInvocation.attachments }),
          limits: {
            maxDurationMs: remainingDurationMs,
            maxArtifactBytes: runBudget.limits.maxArtifactBytes,
            maxChangedFiles: runBudget.limits.maxContextFiles,
            maxWebSearchCalls: currentAuthority.maxWebSearchCalls ?? 1,
          },
        },
        { signal: controller.signal },
      );
      const { type: artifactType, mediaType, content } = result.artifact;
      const producerModel = result.model;
      const contentJson = JSON.stringify(content);
      let artifact = ArtifactSchema.parse({
        schemaVersion: 1,
        id: `artifact_${claimedInvocation.id.slice('invocation_'.length)}`,
        version: 1,
        principalId: claim.aggregate.task.principalId,
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
        ...(projectReference === undefined
          ? {}
          : { projectId: projectReference.id }),
        type: artifactType,
        mediaType,
        sha256: createHash('sha256').update(contentJson).digest('hex'),
        byteLength: Buffer.byteLength(contentJson),
        producer: {
          destination: approvedDestination,
          ...producerModel,
        },
        ...(claimedInvocation.inputArtifacts === undefined
          ? {}
          : { inputs: claimedInvocation.inputArtifacts }),
        content,
        createdAt: clock(),
      });
      const normalizedContentJson = JSON.stringify(artifact.content);
      artifact = ArtifactSchema.parse({
        ...artifact,
        sha256: createHash('sha256')
          .update(normalizedContentJson)
          .digest('hex'),
        byteLength: Buffer.byteLength(normalizedContentJson),
      });
      if (artifact.byteLength > runBudget.limits.maxArtifactBytes) {
        throw new Error(
          'The capability artifact exceeded the artifact byte limit.',
        );
      }
      const storedArtifact = await options.resources.createArtifact(artifact);
      const storedProjectId =
        'projectId' in storedArtifact.artifact
          ? storedArtifact.artifact.projectId
          : undefined;
      if (
        storedArtifact.artifact.taskId !== claim.aggregate.task.id ||
        storedArtifact.artifact.runId !== claim.aggregate.run.id ||
        storedArtifact.artifact.invocationId !== claimedInvocation.id ||
        storedProjectId !== projectReference?.id ||
        storedArtifact.artifact.type !== artifactType ||
        storedArtifact.artifact.mediaType !== mediaType ||
        storedArtifact.artifact.producer.destination === undefined ||
        !sameCapabilityDestination(
          storedArtifact.artifact.producer.destination,
          approvedDestination,
        )
      ) {
        throw new Error(
          'The stored artifact belongs to a different invocation context.',
        );
      }
      if (!artifactContentIsIntact(storedArtifact.artifact)) {
        throw new Error(
          'The stored artifact content failed integrity validation.',
        );
      }
      if (
        !sameArtifactReferences(
          storedArtifact.artifact.inputs,
          claimedInvocation.inputArtifacts,
        )
      ) {
        throw new Error(
          'The stored artifact lineage differs from the approved inputs.',
        );
      }
      return await completeWithArtifact(storedArtifact.artifact);
    } catch (error) {
      observer.warning(error, {
        operation: 'capability_execution',
        taskId: claim.aggregate.task.id,
        runId: claim.aggregate.run.id,
        invocationId: claimedInvocation.id,
      });
      const current = await options.store.findByTaskId(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
      );
      if (current?.run.status === 'cancellation_requested') {
        const cancelledAt = clock();
        const cancellation = await update(
          current.task.principalId,
          current.task.id,
          (candidate) => {
            if (candidate.run.status !== 'cancellation_requested') return false;
            candidate.run.status = 'cancelled';
            candidate.task.status = 'cancelled';
            candidate.run.updatedAt = cancelledAt;
            candidate.task.updatedAt = cancelledAt;
            if (candidate.run.invocation?.status === 'executing') {
              candidate.run.invocation.status = 'failed';
              candidate.run.invocation.completedAt = cancelledAt;
            }
            candidate.run.failure = {
              code: 'cancelled',
              message: 'The run was cancelled before the capability completed.',
            };
            if (candidate.run.goal !== undefined) {
              candidate.run.goal.status = 'cancelled';
              setCurrentGoalStepStatus(candidate, 'cancelled');
            }
            appendEvent(
              candidate,
              'run_cancelled',
              cancelledAt,
              { invocationId: claimedInvocation.id },
              createId,
            );
            return true;
          },
        );
        return cancellation.aggregate;
      }
      return await recordFailure(
        claim.aggregate.task.principalId,
        claim.aggregate.task.id,
        'capability_execution_failure',
        `The ${claimedInvocation.capability.name.replaceAll('_', ' ')} capability could not complete the task.`,
        'capability_invocation_failed',
      );
    } finally {
      activeInvocations.delete(claimedInvocation.id);
    }
  }

  return { executeApproved };
}

export type TaskLifecycleExecutionOperations = ReturnType<
  typeof createExecutionOperations
>;
