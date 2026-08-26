import type { CapabilityDestination } from '../../domain/capabilities/capability-destination.ts';
import type { CapabilityAuthority } from '../../domain/capabilities/capability-registry.ts';

/**
 * Provider-neutral boundary for an approved action against an owner service.
 * An adapter may be local or remote; orchestration sees only its destination,
 * exact authority, typed arguments, and typed result.
 */
export type IntegrationActionExecutor<Arguments, Result> = {
  readonly integrationId: string;
  readonly destination: CapabilityDestination;
  readonly maximumAuthority: CapabilityAuthority;
  authorityFor(arguments_: Arguments): CapabilityAuthority;
  checkReadiness(): Promise<void>;
  execute(
    input: {
      principalId: string;
      invocationId: string;
      startedAt: string;
      recovery: boolean;
      arguments: Arguments;
      source?: {
        taskId: string;
        conversationId?: string;
        messageId?: string;
      };
    },
    options?: { signal?: AbortSignal },
  ): Promise<Result>;
};
