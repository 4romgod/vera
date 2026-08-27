import {
  MissionManagementResultSchema,
  MissionProposalArgumentsSchema,
  type MissionManagementResult,
  type MissionProposalArguments,
} from '../../../../domain/missions/mission.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import type { MissionDraftServiceReference } from '../../../../ports/missions/mission-draft-service.ts';

export class LocalMissionActionExecutor
  implements
    IntegrationActionExecutor<MissionProposalArguments, MissionManagementResult>
{
  public readonly integrationId = 'bounded_mission';
  public readonly destination = {
    schemaVersion: 1 as const,
    adapterId: 'bounded_mission',
    provider: 'vera',
    transport: 'in_process' as const,
    dataBoundary: 'owner_controlled' as const,
  };
  public readonly maximumAuthority: CapabilityAuthority = {
    approval: 'never',
    projectContext: 'none',
    networkAccess: 'none',
    dataClasses: ['owner_request', 'mission_data'],
    sideEffects: ['mission_draft_write'],
    credentials: 'none',
  };

  public constructor(
    private readonly lifecycle: MissionDraftServiceReference,
  ) {}

  public authorityFor() {
    return this.maximumAuthority;
  }

  public checkReadiness() {
    if (this.lifecycle.current === undefined) {
      return Promise.reject(new Error('Mission lifecycle is not initialized.'));
    }
    return Promise.resolve();
  }

  public async execute(input: {
    principalId: string;
    invocationId: string;
    arguments: MissionProposalArguments;
    source?: {
      taskId: string;
      conversationId?: string;
      messageId?: string;
    };
  }) {
    const lifecycle = this.lifecycle.current;
    if (lifecycle === undefined) {
      throw new Error('Mission lifecycle is not initialized.');
    }
    const mission = await lifecycle.createFromProposal({
      principalId: input.principalId,
      requestKey: input.invocationId,
      proposal: MissionProposalArgumentsSchema.parse(input.arguments),
      ...(input.source === undefined ? {} : { source: input.source }),
    });
    return MissionManagementResultSchema.parse({
      schemaVersion: 1,
      action: 'create',
      summary:
        'I drafted a bounded mission. Review its exact scope and approve it once to let Vera produce one pull request; Vera cannot merge it.',
      mission: {
        id: mission.id,
        status: 'awaiting_approval',
        objective: mission.approval.effect.objective,
      },
    });
  }
}
