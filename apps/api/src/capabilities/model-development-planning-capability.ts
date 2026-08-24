import {
  DevelopmentPlanContentJsonSchema,
  DevelopmentPlanContentSchema,
  type DevelopmentPlan,
} from '../domain/development-plan.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type {
  DevelopmentPlanningArguments,
  DevelopmentPlanningCapability,
} from '../ports/development-planning-capability.ts';

function buildPlanningPrompt(): string {
  return [
    'You are the development-planning specialist invoked by Vera.',
    'Produce an implementation plan only; do not claim to execute work.',
    'The plan must be concrete, ordered, testable, and scoped to the supplied project and ticket.',
    'Project, ticket, and objective are authoritative input and are added by Vera code; do not echo them in output.',
    'No repository files, architecture description, dependency inventory, or runtime topology have been supplied to this capability. Treat that absence as a hard evidence boundary.',
    'Do not claim or imply that a framework, service, middleware layer, logging system, deployment topology, protocol convention, provider, library, or repository path exists unless the approved input explicitly says so.',
    'Do not select or recommend a named technology before repository inspection. Record missing facts and technology choices in unresolvedQuestions, and make evidence gathering plus any resulting decision an explicit plan step.',
    'affectedProjectAreas must be empty because no repository evidence was supplied; never guess paths or components.',
    'assumptions may contain only constraints stated by the approved input. Unknown infrastructure belongs in unresolvedQuestions, not assumptions.',
    'Begin with inspection when implementation depends on repository facts. Keep later steps conditional on what that inspection establishes.',
    'State only material risks. Avoid generic filler and speculative architecture.',
    `Required output schema:\n${JSON.stringify(DevelopmentPlanContentJsonSchema)}`,
  ].join('\n\n');
}

export class ModelDevelopmentPlanningCapability
  implements DevelopmentPlanningCapability
{
  public constructor(private readonly provider: ModelProvider) {}

  public async execute(
    arguments_: DevelopmentPlanningArguments,
    invocationId: string,
  ): Promise<{
    plan: DevelopmentPlan;
    model: {
      provider: string;
      model: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    };
  }> {
    const generation = await this.provider.generateStructured({
      purpose: 'development_plan',
      systemPrompt: buildPlanningPrompt(),
      message: JSON.stringify({
        invocationId,
        project: arguments_.project,
        ticket: arguments_.ticket,
        objective: arguments_.objective,
      }),
      outputSchema: DevelopmentPlanContentJsonSchema,
    });
    const parsed = DevelopmentPlanContentSchema.safeParse(generation.candidate);
    if (!parsed.success) {
      throw new Error('Development planning output failed schema validation.');
    }
    if (parsed.data.affectedProjectAreas.length !== 0) {
      throw new Error(
        'Development planning output claimed project areas without repository evidence.',
      );
    }
    return {
      plan: {
        ...parsed.data,
        project: arguments_.project,
        ticket: arguments_.ticket,
        objective: arguments_.objective,
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
