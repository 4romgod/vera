import {
  WorkItemActionArgumentsSchema,
  WorkItemResultSchema,
  type WorkItemActionArguments,
  type WorkItemResult,
} from '../../../../domain/work-items/work-item.ts';
import { sameCapabilityDestination } from '../../../../domain/capabilities/capability-destination.ts';
import type {
  CapabilityRuntime,
  CapabilityRuntimeRegistration,
} from '../../../../ports/capabilities/capability-runtime.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import { definition } from './runtime-support.ts';

export function workItemRegistration(
  executor: IntegrationActionExecutor<WorkItemActionArguments, WorkItemResult>,
): CapabilityRuntimeRegistration {
  const capabilityDefinition = definition('work_item_management');
  const runtime = (): CapabilityRuntime => ({
    definition: capabilityDefinition,
    destination: executor.destination,
    authority: executor.maximumAuthority,
    authorityFor: ({
      arguments: arguments_,
    }: {
      arguments: Record<string, unknown>;
    }) =>
      executor.authorityFor(WorkItemActionArgumentsSchema.parse(arguments_)),
    checkReadiness: () => executor.checkReadiness(),
    async execute(invocation, options) {
      if (
        invocation.project === undefined ||
        invocation.context === undefined ||
        invocation.artifacts !== undefined ||
        invocation.attachments !== undefined
      ) {
        throw new Error(
          'Work-item management requires only frozen project context.',
        );
      }
      const result = await executor.execute(
        {
          principalId: invocation.principalId,
          invocationId: invocation.invocationId,
          startedAt: invocation.startedAt,
          recovery: invocation.recovery,
          arguments: WorkItemActionArgumentsSchema.parse(invocation.arguments),
          project: invocation.project,
          context: invocation.context,
          ...(invocation.source === undefined
            ? {}
            : { source: invocation.source }),
        },
        options,
      );
      return {
        artifact: {
          type: 'work_item_result' as const,
          mediaType: 'application/vnd.vera.work-item-result+json' as const,
          content: WorkItemResultSchema.parse(result),
        },
        model: {
          provider: 'vera',
          model: executor.integrationId,
          durationMs: Math.max(
            0,
            Date.now() - Date.parse(invocation.startedAt),
          ),
        },
      };
    },
  });
  return {
    definition: capabilityDefinition,
    catalog: {
      authority: executor.maximumAuthority,
      destination: executor.destination,
    },
    selected: runtime,
    resolve: (destination) =>
      sameCapabilityDestination(destination, executor.destination)
        ? runtime()
        : null,
  };
}
