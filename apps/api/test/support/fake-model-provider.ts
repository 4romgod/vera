import type {
  GenerateStructuredInput,
  ModelGeneration,
  ModelProvider,
  ModelProviderReadiness,
} from '../../src/ports/model/model-provider.ts';

export class FakeModelProvider implements ModelProvider {
  public readonly name = 'fake';
  public readonly model = 'fake-v1';
  public readonly dataBoundary = 'owner_controlled';
  public readonly inputs: GenerateStructuredInput[] = [];

  public constructor(
    private readonly candidate: unknown,
    private readonly readinessError?: Error,
    private readonly generationError?: Error,
  ) {}

  public checkReadiness(): Promise<ModelProviderReadiness> {
    if (this.readinessError !== undefined) {
      return Promise.reject(this.readinessError);
    }
    return Promise.resolve({
      provider: this.name,
      model: this.model,
      durationMs: 1,
      providerVersion: 'test',
    });
  }

  public generateStructured(
    input: GenerateStructuredInput,
  ): Promise<ModelGeneration> {
    this.inputs.push(input);
    if (this.generationError !== undefined) {
      return Promise.reject(this.generationError);
    }
    return Promise.resolve({
      candidate: this.candidate,
      provider: this.name,
      model: this.model,
      durationMs: 1,
      usage: { inputTokens: 4, outputTokens: 8 },
    });
  }
}
