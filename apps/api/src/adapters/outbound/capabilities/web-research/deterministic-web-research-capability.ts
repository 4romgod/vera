import type {
  WebResearchCapability,
  WebResearchInvocation,
} from '../../../../ports/capabilities/web-research-capability.ts';

export class DeterministicWebResearchCapability
  implements WebResearchCapability
{
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'deterministic_research',
    provider: 'deterministic',
    transport: 'in_process',
    dataBoundary: 'owner_controlled' as const,
  };

  public checkReadiness(): Promise<void> {
    return Promise.resolve();
  }

  public execute(invocation: WebResearchInvocation) {
    return Promise.resolve({
      report: {
        schemaVersion: 1 as const,
        objective: invocation.arguments.objective,
        report:
          'Deterministic research evidence confirms the capability lifecycle and source persistence contract.',
        sources: [
          {
            title: 'Deterministic research fixture',
            url: 'https://example.com/vera/research-fixture',
          },
        ],
        searchedAt: '2026-08-25T00:00:00.000Z',
      },
      model: {
        provider: 'deterministic',
        model: 'deterministic-research-v1',
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
  }
}
