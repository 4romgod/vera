import type {
  GenerateStructuredInput,
  ModelGeneration,
  ModelProvider,
  ModelProviderReadiness,
} from '../../../ports/model/model-provider.ts';

export class DeterministicModelProvider implements ModelProvider {
  public readonly name = 'deterministic';
  public readonly model = 'deterministic-v1';
  public readonly dataBoundary = 'owner_controlled';

  public checkReadiness(): Promise<ModelProviderReadiness> {
    return Promise.resolve({
      provider: this.name,
      model: this.model,
      durationMs: 0,
      providerVersion: '1',
    });
  }

  public generateStructured(
    input: GenerateStructuredInput,
  ): Promise<ModelGeneration> {
    if (input.purpose === 'attachment_analysis') {
      const context = JSON.parse(input.message) as {
        sources: {
          sourceId: string;
          kind: 'document' | 'image';
          filename: string;
          locator?: string;
          text?: string;
        }[];
      };
      const firstSource = context.sources[0];
      if (firstSource === undefined) {
        throw new Error('Deterministic attachment analysis requires evidence.');
      }
      return Promise.resolve({
        candidate: {
          summary: `Analyzed ${String(context.sources.length)} approved source segment(s).`,
          findings: [
            firstSource.kind === 'document'
              ? (firstSource.text ?? '').slice(0, 180).trim()
              : `The approved image ${firstSource.filename} was supplied for analysis.`,
          ],
          citations: [{ sourceId: firstSource.sourceId }],
          limitations: [],
        },
        provider: this.name,
        model: this.model,
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }

    if (input.purpose === 'development_plan') {
      return Promise.resolve({
        candidate: {
          schemaVersion: 1,
          title: 'Deterministic implementation plan',
          summary:
            'A deterministic plan produced from the approved project context.',
          scope: ['Implement and verify the requested change.'],
          nonGoals: [],
          assumptions: [
            'Repository access and required tooling are available.',
          ],
          unresolvedQuestions: [],
          affectedProjectAreas: [],
          phases: [
            {
              name: 'Implementation',
              objective: 'Implement the requested change end to end.',
              steps: [
                'Inspect the affected boundaries.',
                'Implement the change.',
              ],
              verification: ['Run automated and manual verification.'],
            },
          ],
          risks: ['Requirements may need refinement during implementation.'],
        },
        provider: this.name,
        model: this.model,
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }

    if (input.purpose === 'goal_continuation') {
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
          ({ capability }) =>
            `${capability.name}@${String(capability.version)}`,
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
        nextRequirement?.capability === 'software_change'
          ? context.observations
              .filter(({ artifact }) =>
                nextRequirement.capability === 'development_planning'
                  ? ['attachment_analysis', 'research_report'].includes(
                      artifact.type,
                    )
                  : [
                      'attachment_analysis',
                      'implementation_plan',
                      'research_report',
                    ].includes(artifact.type),
              )
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
                        Date.parse(context.temporalContext.currentTime) +
                          60_000,
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
              requirementResolutions: context.requirements.map(
                (requirement) => ({
                  requirementId: requirement.id,
                  status: 'satisfied' as const,
                  evidenceStepIds: context.observations
                    .filter(
                      (observation) =>
                        observation.capability.name ===
                          requirement.capability &&
                        observation.capability.version === requirement.version,
                    )
                    .map((observation) => observation.stepId),
                }),
              ),
            };
      return Promise.resolve({
        candidate,
        provider: this.name,
        model: this.model,
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }

    let ownerMessage = input.message;
    let projectName = 'vera';
    let projectId: string | undefined;
    let currentTime = '2030-01-01T00:00:00.000Z';
    let ownerTimeZone = 'UTC';
    let attachments: { filename: string }[] = [];
    try {
      const context = JSON.parse(input.message) as unknown;
      if (
        typeof context === 'object' &&
        context !== null &&
        'ownerMessage' in context &&
        typeof context.ownerMessage === 'string'
      ) {
        ownerMessage = context.ownerMessage;
        if (
          'selectedProject' in context &&
          typeof context.selectedProject === 'object' &&
          context.selectedProject !== null &&
          'displayName' in context.selectedProject &&
          typeof context.selectedProject.displayName === 'string'
        ) {
          projectName = context.selectedProject.displayName;
          if (
            'id' in context.selectedProject &&
            typeof context.selectedProject.id === 'string'
          ) {
            projectId = context.selectedProject.id;
          }
        }
        if ('attachments' in context && Array.isArray(context.attachments)) {
          attachments = context.attachments.filter(
            (value: unknown): value is { filename: string } =>
              typeof value === 'object' &&
              value !== null &&
              'filename' in value &&
              typeof value.filename === 'string',
          );
        }
        if (
          'temporalContext' in context &&
          typeof context.temporalContext === 'object' &&
          context.temporalContext !== null
        ) {
          if (
            'currentTime' in context.temporalContext &&
            typeof context.temporalContext.currentTime === 'string'
          ) {
            currentTime = context.temporalContext.currentTime;
          }
          if (
            'ownerTimeZone' in context.temporalContext &&
            typeof context.temporalContext.ownerTimeZone === 'string'
          ) {
            ownerTimeZone = context.temporalContext.ownerTimeZone;
          }
        }
      }
    } catch {
      // A plain owner message is the normal input when no project is selected.
    }

    const normalizedMessage = ownerMessage.toLowerCase();
    const requestsChange = /\b(implement|fix|modify|edit|write)\b/u.test(
      normalizedMessage,
    );
    const requestsPlan = normalizedMessage.includes('plan');
    const requestsResearch =
      /\b(research|investigate|look up|verify|compare)\b/u.test(
        normalizedMessage,
      ) && JSON.stringify(input.outputSchema).includes('web_research');
    const requestsAttachmentAnalysis =
      attachments.length > 0 &&
      JSON.stringify(input.outputSchema).includes('attachment_analysis');
    const canManagePersonalTasks = JSON.stringify(input.outputSchema).includes(
      'personal_task_management',
    );
    const personalTaskId = /personal_task_[a-z0-9-]+/u.exec(ownerMessage)?.[0];
    const personalTaskAction =
      canManagePersonalTasks &&
      personalTaskId !== undefined &&
      /\breopen\b/u.test(normalizedMessage)
        ? ({ action: 'reopen', taskId: personalTaskId } as const)
        : canManagePersonalTasks &&
            personalTaskId !== undefined &&
            /\b(complete|finish|done)\b/u.test(normalizedMessage)
          ? ({ action: 'complete', taskId: personalTaskId } as const)
          : canManagePersonalTasks &&
              /\b(list|show)\b.*\b(tasks?|todos?)\b/u.test(normalizedMessage)
            ? ({
                action: 'list',
                status: /\b(all)\b/u.test(normalizedMessage)
                  ? ('all' as const)
                  : /\b(completed|done)\b/u.test(normalizedMessage)
                    ? ('completed' as const)
                    : ('open' as const),
              } as const)
            : canManagePersonalTasks &&
                /\b(add|create|remember)\b.*\b(task|todo)\b/u.test(
                  normalizedMessage,
                )
              ? ({
                  action: 'create',
                  title: ownerMessage.includes(':')
                    ? ownerMessage.slice(ownerMessage.indexOf(':') + 1).trim()
                    : ownerMessage,
                } as const)
              : undefined;

    const canManageReminders = JSON.stringify(input.outputSchema).includes(
      'personal_reminder_management',
    );
    const reminderId = /reminder_[a-z0-9-]+/u.exec(ownerMessage)?.[0];
    const explicitInstant =
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/u.exec(
        ownerMessage,
      )?.[0];
    const scheduledFor =
      explicitInstant ??
      new Date(Date.parse(currentTime) + 60_000).toISOString();
    const reminderAction =
      canManageReminders &&
      reminderId !== undefined &&
      /\backnowledge\b/u.test(normalizedMessage)
        ? ({ action: 'acknowledge', reminderId } as const)
        : canManageReminders &&
            reminderId !== undefined &&
            /\bcancel\b/u.test(normalizedMessage)
          ? ({ action: 'cancel', reminderId } as const)
          : canManageReminders &&
              reminderId !== undefined &&
              /\breschedule\b/u.test(normalizedMessage)
            ? ({
                action: 'reschedule',
                reminderId,
                scheduledFor,
                timeZone: ownerTimeZone,
              } as const)
            : canManageReminders &&
                /\b(list|show)\b.*\breminders?\b/u.test(normalizedMessage)
              ? ({ action: 'list', status: 'scheduled' } as const)
              : canManageReminders && /\bremind\b/u.test(normalizedMessage)
                ? ({
                    action: 'create',
                    message: ownerMessage,
                    scheduledFor,
                    timeZone: ownerTimeZone,
                  } as const)
                : undefined;

    const canManageMemory = JSON.stringify(input.outputSchema).includes(
      'memory_management',
    );
    const memoryId = /memory_[a-z0-9-]+/u.exec(ownerMessage)?.[0];
    const memoryContent = ownerMessage.includes(':')
      ? ownerMessage.slice(ownerMessage.indexOf(':') + 1).trim()
      : ownerMessage.replace(/^remember(?: that)?\s+/iu, '').trim();
    const memoryAction =
      canManageMemory &&
      memoryId !== undefined &&
      /\bforget\b/u.test(normalizedMessage)
        ? ({ action: 'forget', memoryId } as const)
        : canManageMemory &&
            memoryId !== undefined &&
            /\b(correct|update)\b/u.test(normalizedMessage)
          ? ({ action: 'correct', memoryId, content: memoryContent } as const)
          : canManageMemory &&
              /\b(list|show|what)\b.*\b(memories|memory|remember)\b/u.test(
                normalizedMessage,
              )
            ? ({ action: 'list', status: 'active' } as const)
            : canManageMemory &&
                /^remember(?: that)?\b/u.test(normalizedMessage) &&
                personalTaskAction === undefined
              ? ({
                  action: 'remember',
                  kind: /\bprefer\b/u.test(normalizedMessage)
                    ? ('preference' as const)
                    : ('fact' as const),
                  subject: memoryContent.slice(0, 200),
                  content: memoryContent,
                  scope:
                    projectId === undefined ||
                    !/\b(this|the selected) project\b/u.test(normalizedMessage)
                      ? ({ kind: 'global' } as const)
                      : ({ kind: 'project', projectId } as const),
                  sensitivity: 'personal' as const,
                } as const)
              : undefined;

    // Management commands commonly contain words such as "fix", "plan", or
    // "verify" in the task/reminder payload. Those words describe the saved
    // subject; they do not authorize Vera to execute that subject now.
    const hasOwnerDataAction =
      personalTaskAction !== undefined ||
      reminderAction !== undefined ||
      memoryAction !== undefined;
    const shouldChange = requestsChange && !hasOwnerDataAction;
    const shouldPlan = requestsPlan && !hasOwnerDataAction;
    const shouldResearch = requestsResearch && !hasOwnerDataAction;

    const canExecuteGoal = JSON.stringify(input.outputSchema).includes(
      'execute_goal',
    );
    const canPursueGoal = JSON.stringify(input.outputSchema).includes(
      'pursue_goal',
    );
    const shouldPursueGoal =
      canPursueGoal &&
      requestsResearch &&
      reminderAction !== undefined &&
      /\b(if|depending|based on|then)\b/u.test(normalizedMessage);
    const shouldExecuteGoal =
      canExecuteGoal &&
      [
        shouldResearch,
        shouldPlan,
        shouldChange,
        personalTaskAction !== undefined,
        reminderAction !== undefined,
        memoryAction !== undefined,
      ].filter(Boolean).length >= 2;

    const projectArguments = {
      objective: ownerMessage,
      ticket: { reference: 'untracked', details: ownerMessage },
      project: { name: projectName },
    };
    const goalSteps = [
      ...(shouldResearch
        ? [
            {
              id: 'step_research',
              purpose: 'Gather current source-backed evidence.',
              inputStepIds: [],
              capability: 'web_research' as const,
              version: 1 as const,
              arguments: { objective: ownerMessage },
            },
          ]
        : []),
      ...(shouldPlan
        ? [
            {
              id: 'step_plan',
              purpose:
                'Turn the objective and evidence into an implementation plan.',
              inputStepIds: shouldResearch ? ['step_research'] : [],
              capability: 'development_planning' as const,
              version: 1 as const,
              arguments: projectArguments,
            },
          ]
        : []),
      ...(shouldChange
        ? [
            {
              id: 'step_change',
              purpose:
                'Implement the approved objective in an isolated workspace.',
              inputStepIds: shouldPlan
                ? ['step_plan']
                : shouldResearch
                  ? ['step_research']
                  : [],
              capability: 'software_change' as const,
              version: 1 as const,
              arguments: projectArguments,
            },
          ]
        : []),
      ...(personalTaskAction === undefined
        ? []
        : [
            {
              id: 'step_personal_task',
              purpose: 'Apply the requested owner-scoped personal task action.',
              inputStepIds: [],
              capability: 'personal_task_management' as const,
              version: 1 as const,
              arguments: personalTaskAction,
            },
          ]),
      ...(reminderAction === undefined
        ? []
        : [
            {
              id: 'step_reminder',
              purpose: 'Apply the requested owner-scoped reminder action.',
              inputStepIds: [],
              capability: 'personal_reminder_management' as const,
              version: 1 as const,
              arguments: reminderAction,
            },
          ]),
      ...(memoryAction === undefined
        ? []
        : [
            {
              id: 'step_memory',
              purpose: 'Apply the requested governed-memory action.',
              inputStepIds: [],
              capability: 'memory_management' as const,
              version: 1 as const,
              arguments: memoryAction,
            },
          ]),
    ];
    const boundedGoalSteps = goalSteps.slice(0, 3);
    const executeBoundedGoal =
      shouldExecuteGoal &&
      boundedGoalSteps.length >= 2 &&
      boundedGoalSteps.length <= 3;

    const candidate = shouldPursueGoal
      ? {
          schemaVersion: 1,
          kind: 'pursue_goal',
          decisionSummary:
            'The owner requested a later action that depends on evidence not available yet.',
          goal: {
            schemaVersion: 1,
            objective: ownerMessage,
            summary:
              'Observe the first capability result before deciding the next bounded action.',
            completionCriteria:
              'Use the research evidence to decide whether to create the requested reminder, then explain the outcome.',
            requirements: [
              {
                id: 'requirement_research',
                description:
                  'Gather the requested source-backed research evidence.',
                capability: 'web_research',
                version: 1,
                condition: { kind: 'always' },
              },
              {
                id: 'requirement_reminder',
                description:
                  'Create the requested reminder when the research condition is satisfied.',
                capability: 'personal_reminder_management',
                version: 1,
                condition: {
                  kind: 'evidence_dependent',
                  description:
                    'The research evidence satisfies the condition stated by the owner.',
                },
              },
            ],
            firstStep: {
              id: 'step_1',
              purpose:
                'Gather the source-backed evidence needed for the conditional action.',
              inputStepIds: [],
              capability: 'web_research',
              version: 1,
              arguments: { objective: ownerMessage },
            },
          },
        }
      : executeBoundedGoal
        ? {
            schemaVersion: 1,
            kind: 'execute_goal',
            decisionSummary:
              'The owner requested multiple dependent outcomes that require a bounded capability sequence.',
            goal: {
              schemaVersion: 1,
              objective: ownerMessage,
              summary: `Execute ${String(boundedGoalSteps.length)} bounded capability steps and carry approved artifacts forward.`,
              steps: boundedGoalSteps,
            },
          }
        : personalTaskAction !== undefined
          ? {
              schemaVersion: 1,
              kind: 'invoke_capability',
              decisionSummary:
                'The owner requested an action against durable personal tasks.',
              capability: { name: 'personal_task_management', version: 1 },
              arguments: personalTaskAction,
            }
          : reminderAction !== undefined
            ? {
                schemaVersion: 1,
                kind: 'invoke_capability',
                decisionSummary:
                  'The owner requested an action against durable reminders.',
                capability: {
                  name: 'personal_reminder_management',
                  version: 1,
                },
                arguments: reminderAction,
              }
            : memoryAction !== undefined
              ? {
                  schemaVersion: 1,
                  kind: 'invoke_capability',
                  decisionSummary:
                    'The owner requested an explicit governed-memory action.',
                  capability: { name: 'memory_management', version: 1 },
                  arguments: memoryAction,
                }
              : shouldResearch
                ? {
                    schemaVersion: 1,
                    kind: 'invoke_capability',
                    decisionSummary:
                      'The request asks for current, source-backed public-web research.',
                    capability: { name: 'web_research', version: 1 },
                    arguments: { objective: ownerMessage },
                  }
                : shouldPlan
                  ? {
                      schemaVersion: 1,
                      kind: 'invoke_capability',
                      decisionSummary:
                        'The request asks for specialist software planning.',
                      capability: { name: 'development_planning', version: 1 },
                      arguments: projectArguments,
                    }
                  : shouldChange
                    ? {
                        schemaVersion: 1,
                        kind: 'invoke_capability',
                        decisionSummary:
                          'The request asks for an isolated specialist software change.',
                        capability: { name: 'software_change', version: 1 },
                        arguments: projectArguments,
                      }
                    : requestsAttachmentAnalysis
                      ? {
                          schemaVersion: 1,
                          kind: 'invoke_capability',
                          decisionSummary:
                            'The supplied attachments must be analyzed before Vera makes claims about their contents.',
                          capability: {
                            name: 'attachment_analysis',
                            version: 1,
                          },
                          arguments: { objective: ownerMessage },
                        }
                      : {
                          schemaVersion: 1,
                          kind: 'respond',
                          decisionSummary:
                            'The request can be answered directly.',
                          message: `Vera received: ${ownerMessage}`,
                        };

    return Promise.resolve({
      candidate,
      provider: this.name,
      model: this.model,
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }
}
