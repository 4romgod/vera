import type {
  GenerateStructuredInput,
  ModelGeneration,
} from '../../../../ports/model/model-provider.ts';

export function generateKnowledgeAnswer(
  input: GenerateStructuredInput,
  provider: string,
  model: string,
): Promise<ModelGeneration> {
  const context = JSON.parse(input.message) as {
    query: string;
    sources: { sourceId: string; excerpt: string }[];
  };
  const firstSource = context.sources[0];
  if (firstSource === undefined) {
    throw new Error('Deterministic knowledge answers require evidence.');
  }
  return Promise.resolve({
    candidate: {
      answer: firstSource.excerpt,
      citationIds: [firstSource.sourceId],
      limitations: [],
    },
    provider: provider,
    model: model,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}

export function generateAttachmentAnalysis(
  input: GenerateStructuredInput,
  provider: string,
  model: string,
): Promise<ModelGeneration> {
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
    provider: provider,
    model: model,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}

export function generateDevelopmentPlan(
  input: GenerateStructuredInput,
  provider: string,
  model: string,
): Promise<ModelGeneration> {
  return Promise.resolve({
    candidate: {
      schemaVersion: 1,
      title: 'Deterministic implementation plan',
      summary:
        'A deterministic plan produced from the approved project context.',
      scope: ['Implement and verify the requested change.'],
      nonGoals: [],
      assumptions: ['Repository access and required tooling are available.'],
      unresolvedQuestions: [],
      affectedProjectAreas: [],
      phases: [
        {
          name: 'Implementation',
          objective: 'Implement the requested change end to end.',
          steps: ['Inspect the affected boundaries.', 'Implement the change.'],
          verification: ['Run automated and manual verification.'],
        },
      ],
      risks: ['Requirements may need refinement during implementation.'],
    },
    provider: provider,
    model: model,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}
