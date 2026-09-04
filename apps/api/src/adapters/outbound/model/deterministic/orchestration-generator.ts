import type {
  GenerateStructuredInput,
  ModelGeneration,
} from '../../../../ports/model/model-provider.ts';
import { requestedKnowledgeTitle } from './support.ts';

export function generateOrchestrationDecision(
  input: GenerateStructuredInput,
  provider: string,
  model: string,
): Promise<ModelGeneration> {
  let ownerMessage = input.message;
  let projectName = 'vera';
  let projectId: string | undefined;
  let currentTime = '2030-01-01T00:00:00.000Z';
  let ownerTimeZone = 'UTC';
  let attachments: { filename: string }[] = [];
  let registeredMachines: {
    id: string;
    services: { id: string; actions: string[] }[];
  }[] = [];
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
        'registeredMachines' in context &&
        Array.isArray(context.registeredMachines)
      ) {
        registeredMachines =
          context.registeredMachines as typeof registeredMachines;
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
  const selectedMachine =
    registeredMachines.find(({ id }) =>
      normalizedMessage.includes(id.toLowerCase()),
    ) ?? registeredMachines[0];
  const selectedService =
    selectedMachine?.services.find(({ id }) =>
      normalizedMessage.includes(id.toLowerCase()),
    ) ?? selectedMachine?.services[0];
  const canInspectMachines = JSON.stringify(input.outputSchema).includes(
    'machine_inspection',
  );
  const canManageMachineServices = JSON.stringify(input.outputSchema).includes(
    'machine_service_management',
  );
  const requestsMachineInspection =
    canInspectMachines &&
    selectedMachine !== undefined &&
    /\b(inspect|check|diagnose|status|health)\b/u.test(normalizedMessage);
  const requestedMachineAction =
    canManageMachineServices &&
    selectedMachine !== undefined &&
    selectedService !== undefined
      ? (['restart', 'start', 'stop'] as const).find(
          (action) =>
            new RegExp(`\\b${action}\\b`, 'u').test(normalizedMessage) &&
            selectedService.actions.includes(action),
        )
      : undefined;
  const requestsChange = /\b(implement|fix|modify|edit|write)\b/u.test(
    normalizedMessage,
  );
  const requestsMission =
    JSON.stringify(input.outputSchema).includes('mission_management') &&
    projectId !== undefined &&
    (/\bmission\b/u.test(normalizedMessage) ||
      (/\b(while i(?:'m| am) away|independently|autonomously)\b/u.test(
        normalizedMessage,
      ) &&
        /\b(pull request|pr)\b/u.test(normalizedMessage)));
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
  const requestsAttention =
    JSON.stringify(input.outputSchema).includes('attention_management') &&
    /\b(what needs my attention|brief me|my briefing|what should i focus on|what needs me)\b/u.test(
      normalizedMessage,
    );
  const canManageRoutines = JSON.stringify(input.outputSchema).includes(
    'routine_management',
  );
  const routineId = /routine_[a-z0-9-]+/u.exec(ownerMessage)?.[0];
  const routineTime = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/u.exec(ownerMessage)?.[0];
  const routineAction =
    canManageRoutines &&
    routineId !== undefined &&
    /\bpause\b/u.test(normalizedMessage)
      ? ({ action: 'pause', routineId } as const)
      : canManageRoutines &&
          routineId !== undefined &&
          /\bresume\b/u.test(normalizedMessage)
        ? ({ action: 'resume', routineId } as const)
        : canManageRoutines &&
            routineId !== undefined &&
            /\brun(?: it)? now\b/u.test(normalizedMessage)
          ? ({ action: 'run_now', routineId } as const)
          : canManageRoutines &&
              /\b(list|show)\b.*\broutines?\b/u.test(normalizedMessage)
            ? ({ action: 'list' } as const)
            : canManageRoutines &&
                selectedMachine !== undefined &&
                /\b(every (?:day|morning|evening)|daily|routine|standing instruction)\b/u.test(
                  normalizedMessage,
                )
              ? ({
                  action: 'create',
                  routine: {
                    title: 'Daily machine health check',
                    schedule: {
                      kind: 'daily',
                      timeZone: ownerTimeZone,
                      localTime: routineTime ?? '08:00',
                      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    },
                    action: {
                      kind: 'machine_health_check',
                      machineId: selectedMachine.id,
                      ...(selectedService === undefined
                        ? {}
                        : { serviceIds: [selectedService.id] }),
                    },
                  },
                } as const)
              : undefined;
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
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/u.exec(ownerMessage)?.[0];
  const scheduledFor =
    explicitInstant ?? new Date(Date.parse(currentTime) + 60_000).toISOString();
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
  const canManageKnowledge = JSON.stringify(input.outputSchema).includes(
    'knowledge_management',
  );
  const knowledgeSourceId = /knowledge_[a-z0-9_-]+/u.exec(ownerMessage)?.[0];
  const knowledgeAction =
    canManageKnowledge &&
    knowledgeSourceId !== undefined &&
    /\b(remove|delete)\b/u.test(normalizedMessage)
      ? ({ action: 'remove', sourceId: knowledgeSourceId } as const)
      : canManageKnowledge &&
          /\b(list|show)\b.*\b(knowledge|sources|library)\b/u.test(
            normalizedMessage,
          )
        ? ({ action: 'list', status: 'active' } as const)
        : canManageKnowledge &&
            /\b(search|find|look up|ask)\b.*\b(knowledge|library|my (?:documents|files))\b/u.test(
              normalizedMessage,
            )
          ? ({
              action: 'search',
              query: ownerMessage,
              ...(projectId === undefined
                ? {}
                : {
                    scope: {
                      kind: 'project' as const,
                      projectId,
                    },
                  }),
            } as const)
          : canManageKnowledge &&
              attachments.length > 0 &&
              /\b(add|save|store)\b.*\b(knowledge|library|my (?:documents|files))\b/u.test(
                normalizedMessage,
              )
            ? ({
                action: 'add',
                title: requestedKnowledgeTitle(ownerMessage),
                scope:
                  projectId === undefined
                    ? ({ kind: 'global' } as const)
                    : ({ kind: 'project', projectId } as const),
                sensitivity: 'personal' as const,
              } as const)
            : undefined;
  const hasOwnerDataAction =
    personalTaskAction !== undefined ||
    reminderAction !== undefined ||
    memoryAction !== undefined ||
    knowledgeAction !== undefined;
  const machineAction =
    requestedMachineAction === undefined ||
    selectedMachine === undefined ||
    selectedService === undefined
      ? undefined
      : {
          machineId: selectedMachine.id,
          serviceId: selectedService.id,
          action: requestedMachineAction,
        };
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
  const shouldPursueMachineGoal =
    canPursueGoal &&
    requestsMachineInspection &&
    machineAction !== undefined &&
    /\b(if|when|unless|then)\b/u.test(normalizedMessage);
  const shouldExecuteGoal =
    canExecuteGoal &&
    [
      shouldResearch,
      shouldPlan,
      shouldChange,
      personalTaskAction !== undefined,
      reminderAction !== undefined,
      memoryAction !== undefined,
      knowledgeAction !== undefined,
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
    ...(knowledgeAction === undefined
      ? []
      : [
          {
            id: 'step_knowledge',
            purpose: 'Apply the requested grounded-knowledge action.',
            inputStepIds: [],
            capability: 'knowledge_management' as const,
            version: 1 as const,
            arguments: knowledgeAction,
          },
        ]),
  ];
  const boundedGoalSteps = goalSteps.slice(0, 3);
  const executeBoundedGoal =
    shouldExecuteGoal &&
    boundedGoalSteps.length >= 2 &&
    boundedGoalSteps.length <= 3;
  const candidate =
    routineAction !== undefined
      ? {
          schemaVersion: 1,
          kind: 'invoke_capability',
          decisionSummary:
            'The owner requested management of a recurring standing instruction.',
          capability: { name: 'routine_management', version: 1 },
          arguments: routineAction,
        }
      : requestsAttention
        ? {
            schemaVersion: 1,
            kind: 'invoke_capability',
            decisionSummary:
              'The owner requested a current evidence-owned attention briefing.',
            capability: { name: 'attention_management', version: 1 },
            arguments: { action: 'brief' },
          }
        : shouldPursueMachineGoal
          ? {
              schemaVersion: 1,
              kind: 'pursue_goal',
              decisionSummary:
                'The requested machine action depends on current registered service health.',
              goal: {
                schemaVersion: 1,
                objective: ownerMessage,
                summary:
                  'Inspect the registered service, then separately approve an action only when evidence requires it.',
                completionCriteria:
                  'Report service health and perform the requested registered action only when its condition is met.',
                requirements: [
                  {
                    id: 'requirement_machine_inspection',
                    description:
                      'Inspect the current registered service health.',
                    capability: 'machine_inspection',
                    version: 1,
                    condition: { kind: 'always' },
                  },
                  {
                    id: 'requirement_machine_action',
                    description:
                      'Apply the requested service action if the health condition is met.',
                    capability: 'machine_service_management',
                    version: 1,
                    condition: {
                      kind: 'evidence_dependent',
                      description:
                        'The registered service inspection reports unhealthy.',
                    },
                  },
                ],
                firstStep: {
                  id: 'step_1',
                  purpose:
                    'Inspect the registered service before any mutation.',
                  inputStepIds: [],
                  capability: 'machine_inspection',
                  version: 1,
                  arguments: {
                    machineId: selectedMachine.id,
                    serviceIds: [machineAction.serviceId],
                  },
                },
              },
            }
          : shouldPursueGoal
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
            : requestsMission
              ? {
                  schemaVersion: 1,
                  kind: 'invoke_capability',
                  decisionSummary:
                    'The owner requested one bounded autonomous software outcome ending at a reviewable pull request.',
                  capability: { name: 'mission_management', version: 1 },
                  arguments: {
                    action: 'create',
                    objective: ownerMessage,
                    completionCriteria:
                      'Produce one verified, non-draft pull request that satisfies the stated objective, and do not merge it.',
                    project: { name: projectName },
                    delivery: {
                      commitMessage: 'feat: complete bounded mission',
                      pullRequestTitle: 'Complete bounded mission',
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
                : machineAction !== undefined
                  ? {
                      schemaVersion: 1,
                      kind: 'invoke_capability',
                      decisionSummary:
                        'The owner requested an exact registered service action.',
                      capability: {
                        name: 'machine_service_management',
                        version: 1,
                      },
                      arguments: machineAction,
                    }
                  : requestsMachineInspection
                    ? {
                        schemaVersion: 1,
                        kind: 'invoke_capability',
                        decisionSummary:
                          'The owner requested bounded registered machine diagnostics.',
                        capability: {
                          name: 'machine_inspection',
                          version: 1,
                        },
                        arguments: {
                          machineId: selectedMachine.id,
                          ...(selectedService === undefined
                            ? {}
                            : { serviceIds: [selectedService.id] }),
                        },
                      }
                    : personalTaskAction !== undefined
                      ? {
                          schemaVersion: 1,
                          kind: 'invoke_capability',
                          decisionSummary:
                            'The owner requested an action against durable personal tasks.',
                          capability: {
                            name: 'personal_task_management',
                            version: 1,
                          },
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
                              capability: {
                                name: 'memory_management',
                                version: 1,
                              },
                              arguments: memoryAction,
                            }
                          : knowledgeAction !== undefined
                            ? {
                                schemaVersion: 1,
                                kind: 'invoke_capability',
                                decisionSummary:
                                  'The owner requested an action against grounded personal knowledge.',
                                capability: {
                                  name: 'knowledge_management',
                                  version: 1,
                                },
                                arguments: knowledgeAction,
                              }
                            : shouldResearch
                              ? {
                                  schemaVersion: 1,
                                  kind: 'invoke_capability',
                                  decisionSummary:
                                    'The request asks for current, source-backed public-web research.',
                                  capability: {
                                    name: 'web_research',
                                    version: 1,
                                  },
                                  arguments: { objective: ownerMessage },
                                }
                              : shouldPlan
                                ? {
                                    schemaVersion: 1,
                                    kind: 'invoke_capability',
                                    decisionSummary:
                                      'The request asks for specialist software planning.',
                                    capability: {
                                      name: 'development_planning',
                                      version: 1,
                                    },
                                    arguments: projectArguments,
                                  }
                                : shouldChange
                                  ? {
                                      schemaVersion: 1,
                                      kind: 'invoke_capability',
                                      decisionSummary:
                                        'The request asks for an isolated specialist software change.',
                                      capability: {
                                        name: 'software_change',
                                        version: 1,
                                      },
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
                                        arguments: {
                                          objective: ownerMessage,
                                        },
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
    provider: provider,
    model: model,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}
