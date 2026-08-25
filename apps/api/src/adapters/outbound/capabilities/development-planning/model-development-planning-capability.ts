import {
  DevelopmentPlanContentJsonSchema,
  DevelopmentPlanContentSchema,
  type DevelopmentPlan,
} from '../../../../domain/plans/development-plan.ts';
import type { ModelProvider } from '../../../../ports/model/model-provider.ts';
import type {
  DevelopmentPlanningCapability,
  DevelopmentPlanningInvocation,
} from '../../../../ports/capabilities/development-planning-capability.ts';

function buildPlanningPrompt(hasRepositoryEvidence: boolean): string {
  const evidenceRule = hasRepositoryEvidence
    ? 'This invocation has approved repository entries. affectedProjectAreas may contain only an exact approved file path or one of its parent directories.'
    : 'CRITICAL FOR THIS INVOCATION: the approved context contains zero repository entries. You MUST return affectedProjectAreas as [], assumptions as [], at least one unresolvedQuestions item about the missing repository evidence, and an inspection or discovery phase before proposing implementation locations.';
  return [
    'You are the development-planning specialist invoked by Vera.',
    'Produce an implementation plan only; do not claim to execute work.',
    'The plan must be concrete, ordered, testable, and scoped to the supplied project and ticket.',
    'Project, ticket, and objective are authoritative input and are added by Vera code; do not echo them in output.',
    'Repository evidence is supplied as an exact approved context bundle. Treat it as the complete evidence boundary.',
    'Do not claim or imply that a framework, service, path, or dependency exists unless the approved context establishes it.',
    'affectedProjectAreas may name only paths or components supported by the approved context manifest.',
    'assumptions may contain only constraints stated by the approved input. Unknown infrastructure belongs in unresolvedQuestions, not assumptions.',
    'Call out important missing evidence in unresolvedQuestions instead of inventing it.',
    evidenceRule,
    'State only material risks. Avoid generic filler and speculative architecture.',
    `Required output schema:\n${JSON.stringify(DevelopmentPlanContentJsonSchema)}`,
  ].join('\n\n');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new DOMException(
      'The planning invocation was aborted.',
      'AbortError',
    );
  }
}

export class ModelDevelopmentPlanningCapability
  implements DevelopmentPlanningCapability
{
  public readonly destination: {
    schemaVersion: 1;
    adapterId: string;
    provider: string;
    transport: string;
    dataBoundary: 'owner_controlled' | 'third_party';
  };

  public constructor(private readonly provider: ModelProvider) {
    this.destination = {
      schemaVersion: 1,
      adapterId: 'structured_model',
      provider: provider.name,
      transport: 'in_process',
      dataBoundary: provider.dataBoundary,
    };
  }

  public async checkReadiness(): Promise<void> {
    await this.provider.checkReadiness();
  }

  public async execute(
    invocation: DevelopmentPlanningInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<{
    plan: DevelopmentPlan;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }> {
    throwIfAborted(options?.signal);
    const generation = await this.provider.generateStructured({
      purpose: 'development_plan',
      systemPrompt: buildPlanningPrompt(
        invocation.context.manifest.entries.length > 0,
      ),
      message: JSON.stringify({
        invocationId: invocation.invocationId,
        project: invocation.project,
        ticket: invocation.arguments.ticket,
        objective: invocation.arguments.objective,
        context: invocation.context,
      }),
      outputSchema: DevelopmentPlanContentJsonSchema,
    });
    throwIfAborted(options?.signal);
    const parsed = DevelopmentPlanContentSchema.safeParse(generation.candidate);
    if (!parsed.success) {
      throw new Error('Development planning output failed schema validation.');
    }
    const approvedPaths = new Set(
      invocation.context.manifest.entries.map((entry) => entry.relativePath),
    );
    const unsupportedArea = parsed.data.affectedProjectAreas.find(
      (area) =>
        ![...approvedPaths].some(
          (path) => path === area.area || path.startsWith(`${area.area}/`),
        ),
    );
    if (unsupportedArea !== undefined) {
      throw new Error(
        `Development planning output claimed unapproved project area ${unsupportedArea.area}.`,
      );
    }
    return {
      plan: {
        ...parsed.data,
        project: {
          name: invocation.project.displayName,
          id: invocation.project.id,
          revision: invocation.context.manifest.revision,
        },
        ticket: invocation.arguments.ticket,
        objective: invocation.arguments.objective,
      },
      model: {
        provider: generation.provider,
        model: generation.model,
        durationMs: generation.durationMs,
        ...(generation.usage === undefined ? {} : { usage: generation.usage }),
      },
    };
  }
}
