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

    let ownerMessage = input.message;
    let projectName = 'vera';
    let currentTime = '2030-01-01T00:00:00.000Z';
    let ownerTimeZone = 'UTC';
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

    // Management commands commonly contain words such as "fix", "plan", or
    // "verify" in the task/reminder payload. Those words describe the saved
    // subject; they do not authorize Vera to execute that subject now.
    const hasOwnerDataAction =
      personalTaskAction !== undefined || reminderAction !== undefined;
    const shouldChange = requestsChange && !hasOwnerDataAction;
    const shouldPlan = requestsPlan && !hasOwnerDataAction;
    const shouldResearch = requestsResearch && !hasOwnerDataAction;

    const canExecuteGoal = JSON.stringify(input.outputSchema).includes(
      'execute_goal',
    );
    const shouldExecuteGoal =
      canExecuteGoal &&
      [
        shouldResearch,
        shouldPlan,
        shouldChange,
        personalTaskAction !== undefined,
        reminderAction !== undefined,
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
    ];
    const boundedGoalSteps = goalSteps.slice(0, 3);
    const executeBoundedGoal =
      shouldExecuteGoal &&
      boundedGoalSteps.length >= 2 &&
      boundedGoalSteps.length <= 3;

    const candidate = executeBoundedGoal
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
                : {
                    schemaVersion: 1,
                    kind: 'respond',
                    decisionSummary: 'The request can be answered directly.',
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
