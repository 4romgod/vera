export type ModelGeneration = {
  candidate: unknown;
  provider: string;
  model: string;
  durationMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type StructuredGenerationPurpose =
  | 'orchestration_decision'
  | 'goal_continuation'
  | 'development_plan'
  | 'attachment_analysis';

export type ModelImageInput = {
  sourceId: string;
  filename: string;
  mediaType: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
};

export type GenerateStructuredInput = {
  purpose: StructuredGenerationPurpose;
  systemPrompt: string;
  message: string;
  images?: ModelImageInput[];
  outputSchema: Record<string, unknown>;
};

export type ModelProviderErrorCode =
  | 'model_not_found'
  | 'provider_request_rejected'
  | 'provider_response_invalid'
  | 'provider_timeout'
  | 'provider_unavailable';

export type ModelProviderReadiness = {
  provider: string;
  model: string;
  durationMs: number;
  providerVersion?: string;
};

export type ModelProvider = {
  readonly name: string;
  readonly model: string;
  readonly dataBoundary: 'owner_controlled' | 'third_party';
  checkReadiness(): Promise<ModelProviderReadiness>;
  generateStructured(input: GenerateStructuredInput): Promise<ModelGeneration>;
};

export class ModelProviderError extends Error {
  public constructor(
    message: string,
    public readonly code: ModelProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModelProviderError';
  }
}
