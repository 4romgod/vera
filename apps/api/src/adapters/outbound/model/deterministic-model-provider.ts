import type {
  GenerateStructuredInput,
  ModelGeneration,
  ModelProvider,
  ModelProviderReadiness,
} from '../../../ports/model/model-provider.ts';
import { generateGoalContinuation } from './deterministic/goal-continuation-generator.ts';
import { generateOrchestrationDecision } from './deterministic/orchestration-generator.ts';
import {
  generateAttachmentAnalysis,
  generateDevelopmentPlan,
  generateKnowledgeAnswer,
} from './deterministic/specialized-generators.ts';

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
    switch (input.purpose) {
      case 'knowledge_answer':
        return generateKnowledgeAnswer(input, this.name, this.model);
      case 'attachment_analysis':
        return generateAttachmentAnalysis(input, this.name, this.model);
      case 'development_plan':
        return generateDevelopmentPlan(input, this.name, this.model);
      case 'goal_continuation':
        return generateGoalContinuation(input, this.name, this.model);
      default:
        return generateOrchestrationDecision(input, this.name, this.model);
    }
  }
}
