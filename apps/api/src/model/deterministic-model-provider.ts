import type {
  GenerateStructuredInput,
  ModelGeneration,
  ModelProvider,
  ModelProviderReadiness,
} from './model-provider.ts';

export class DeterministicModelProvider implements ModelProvider {
  public readonly name = 'deterministic';
  public readonly model = 'deterministic-v1';

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
          summary: `Plan for ${input.message}`,
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

    const shouldDelegate = input.message.toLowerCase().includes('plan');

    const candidate = shouldDelegate
      ? {
          schemaVersion: 1,
          kind: 'invoke_capability',
          decisionSummary: 'The request asks for specialist software planning.',
          capability: { name: 'development_planning', version: 1 },
          arguments: {
            objective: input.message,
            ticket: { reference: 'untracked', details: input.message },
            project: { name: 'vera' },
          },
        }
      : {
          schemaVersion: 1,
          kind: 'respond',
          decisionSummary: 'The request can be answered directly.',
          message: `Vera received: ${input.message}`,
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
