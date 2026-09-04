import type {
  GenerateStructuredInput,
  ModelGeneration,
} from '../../../../ports/model/model-provider.ts';
import { requestedKnowledgeTitle } from './support.ts';

export function generateGoalContinuation(
  input: GenerateStructuredInput,
  provider: string,
  model: string,
): Promise<ModelGeneration> {
  const context = JSON.parse(input.message) as {
    ownerMessage: string;
    nextStepId: string;
    temporalContext: { currentTime: string; ownerTimeZone: string };
    selectedProject?: { id: string; displayName: string };
    requirements: {
      id: string;
      capability: string;
      version: number;
      condition: { kind: 'always' | 'evidence_dependent' };
    }[];
    observations: {
      stepId: string;
      capability: { name: string; version: number };
      artifact: { type: string; content?: unknown };
    }[];
  };
  const completed = new Set(
    context.observations.map(
      ({ capability }) => `${capability.name}@${String(capability.version)}`,
    ),
  );
  const nextRequirement = context.requirements.find(
    ({ capability, version }) =>
      !completed.has(`${capability}@${String(version)}`),
  );
  const explicitInstant =
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/u.exec(
      context.ownerMessage,
    )?.[0];
  const attachmentObservation = context.observations.find(
    ({ artifact }) => artifact.type === 'attachment_analysis',
  );
  const attachmentContent = attachmentObservation?.artifact.content as
    | { summary?: string; findings?: string[] }
    | undefined;
  const evidenceText =
    attachmentContent?.findings?.[0] ??
    attachmentContent?.summary ??
    context.ownerMessage;
  const compatibleInputStepIds =
    nextRequirement?.capability === 'development_planning' ||
    nextRequirement?.capability === 'software_change' ||
    nextRequirement?.capability === 'knowledge_management'
      ? context.observations
          .filter(({ artifact }) =>
            nextRequirement.capability === 'development_planning'
              ? ['attachment_analysis', 'research_report'].includes(
                  artifact.type,
                )
              : nextRequirement.capability === 'knowledge_management'
                ? artifact.type === 'attachment_analysis'
                : [
                    'attachment_analysis',
                    'implementation_plan',
                    'research_report',
                  ].includes(artifact.type),
          )
          .map(({ stepId }) => stepId)
      : nextRequirement?.capability === 'machine_service_management'
        ? context.observations
            .filter(({ artifact }) => artifact.type === 'machine_diagnostic')
            .map(({ stepId }) => stepId)
        : [];
  const projectArguments = {
    objective: context.ownerMessage,
    ticket: {
      reference: 'untracked',
      details: context.ownerMessage,
    },
    project: {
      name: context.selectedProject?.displayName ?? 'vera',
    },
  };
  const nextArguments =
    nextRequirement?.capability === 'development_planning' ||
    nextRequirement?.capability === 'software_change'
      ? projectArguments
      : nextRequirement?.capability === 'web_research'
        ? { objective: context.ownerMessage }
        : nextRequirement?.capability === 'personal_task_management'
          ? {
              action: 'create',
              title: evidenceText.slice(0, 500),
              notes:
                `Derived from approved attachment analysis for: ${context.ownerMessage}`.slice(
                  0,
                  5_000,
                ),
            }
          : nextRequirement?.capability === 'personal_reminder_management'
            ? {
                action: 'create',
                message: evidenceText.slice(0, 1_000),
                scheduledFor:
                  explicitInstant ??
                  new Date(
                    Date.parse(context.temporalContext.currentTime) + 60_000,
                  ).toISOString(),
                timeZone: context.temporalContext.ownerTimeZone,
              }
            : nextRequirement?.capability === 'memory_management'
              ? {
                  action: 'remember',
                  kind: 'fact',
                  subject: evidenceText.slice(0, 200),
                  content: evidenceText.slice(0, 2_000),
                  scope: { kind: 'global' },
                  sensitivity: 'personal',
                }
              : nextRequirement?.capability === 'knowledge_management'
                ? {
                    action: 'add',
                    title: requestedKnowledgeTitle(context.ownerMessage),
                    scope:
                      context.selectedProject === undefined
                        ? ({ kind: 'global' } as const)
                        : ({
                            kind: 'project',
                            projectId: context.selectedProject.id,
                          } as const),
                    sensitivity: 'personal' as const,
                  }
                : nextRequirement?.capability === 'machine_service_management'
                  ? (() => {
                      const diagnosticObservation = context.observations.find(
                        ({ artifact }) =>
                          artifact.type === 'machine_diagnostic',
                      );
                      const diagnostic = diagnosticObservation?.artifact
                        .content as
                        | {
                            machine?: { id?: string };
                            services?: {
                              id?: string;
                              observation?: { status?: string };
                            }[];
                          }
                        | undefined;
                      const service = diagnostic?.services?.[0];
                      if (
                        diagnostic?.machine?.id === undefined ||
                        service?.id === undefined ||
                        service.observation?.status !== 'unhealthy'
                      ) {
                        return undefined;
                      }
                      const action = /\b(stop)\b/u.test(
                        context.ownerMessage.toLowerCase(),
                      )
                        ? ('stop' as const)
                        : /\b(start)\b/u.test(
                              context.ownerMessage.toLowerCase(),
                            )
                          ? ('start' as const)
                          : ('restart' as const);
                      return {
                        machineId: diagnostic.machine.id,
                        serviceId: service.id,
                        action,
                      };
                    })()
                  : undefined;
  const evidenceStepIds = context.observations
    .map(({ stepId }) => stepId)
    .slice(-3);
  const candidate =
    nextRequirement !== undefined && nextArguments !== undefined
      ? {
          schemaVersion: 1,
          kind: 'continue_goal',
          decisionSummary:
            'The validated evidence supports the next requested bounded action.',
          evidenceStepIds,
          step: {
            id: context.nextStepId,
            purpose: `Complete the requested ${nextRequirement.capability.replaceAll('_', ' ')} outcome using validated evidence.`,
            inputStepIds: compatibleInputStepIds,
            capability: nextRequirement.capability,
            version: nextRequirement.version,
            arguments: nextArguments,
          },
        }
      : {
          schemaVersion: 1,
          kind: 'complete_goal',
          decisionSummary:
            'The validated observations satisfy the goal completion criteria.',
          message: `I completed the requested adaptive goal using ${String(context.observations.length)} verified capability result(s).`,
          evidenceStepIds,
          requirementResolutions: context.requirements.map((requirement) => {
            const matching = context.observations
              .filter(
                (observation) =>
                  observation.capability.name === requirement.capability &&
                  observation.capability.version === requirement.version,
              )
              .map((observation) => observation.stepId);
            return matching.length > 0
              ? {
                  requirementId: requirement.id,
                  status: 'satisfied' as const,
                  evidenceStepIds: matching,
                }
              : {
                  requirementId: requirement.id,
                  status: 'not_applicable' as const,
                  reason:
                    'The registered machine diagnostic showed that the conditional service action was unnecessary.',
                  evidenceStepIds,
                };
          }),
        };
  return Promise.resolve({
    candidate,
    provider: provider,
    model: model,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}
