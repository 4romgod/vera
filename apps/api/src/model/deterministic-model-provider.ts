import type {
  GenerateStructuredInput,
  ModelGeneration,
  ModelProvider,
  ModelProviderReadiness,
} from './model-provider.ts';

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
      }
    } catch {
      // A plain owner message is the normal input when no project is selected.
    }

    const shouldDelegate = ownerMessage.toLowerCase().includes('plan');

    const candidate = shouldDelegate
      ? {
          schemaVersion: 1,
          kind: 'invoke_capability',
          decisionSummary: 'The request asks for specialist software planning.',
          capability: { name: 'development_planning', version: 1 },
          arguments: {
            objective: ownerMessage,
            ticket: { reference: 'untracked', details: ownerMessage },
            project: { name: projectName },
          },
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
