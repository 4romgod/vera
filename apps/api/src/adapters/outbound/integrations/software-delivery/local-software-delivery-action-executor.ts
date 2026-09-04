import type { CapabilityAuthority } from '../../../../domain/capabilities/capability-registry.ts';
import {
  SoftwareDeliveryManagementArgumentsSchema,
  SoftwareDeliveryRepairArgumentsSchema,
  SoftwareDeliveryManagementResultSchema,
  type SoftwareDeliveryActionArguments,
  type SoftwareDeliveryManagementResult,
} from '../../../../domain/software-delivery/software-delivery-management.ts';
import type { IntegrationActionExecutor } from '../../../../ports/integrations/integration-action-executor.ts';
import type { SoftwareDeliveryControlServiceReference } from '../../../../ports/software-delivery/software-delivery-control-service.ts';

export class LocalSoftwareDeliveryActionExecutor
  implements
    IntegrationActionExecutor<
      SoftwareDeliveryActionArguments,
      SoftwareDeliveryManagementResult
    >
{
  public readonly integrationId;
  public readonly destination;
  public readonly maximumAuthority: CapabilityAuthority;

  public constructor(
    private readonly service: SoftwareDeliveryControlServiceReference,
    private readonly mode: 'management' | 'repair',
  ) {
    this.integrationId =
      mode === 'management'
        ? 'software_delivery_control'
        : 'software_delivery_repair';
    this.destination = {
      schemaVersion: 1 as const,
      adapterId: this.integrationId,
      provider: 'vera',
      transport: 'in_process' as const,
      dataBoundary: 'owner_controlled' as const,
    };
    this.maximumAuthority =
      mode === 'management'
        ? {
            approval: 'never',
            projectContext: 'none',
            networkAccess: 'none',
            dataClasses: ['owner_request', 'software_delivery_metadata'],
            sideEffects: [],
            credentials: 'none',
          }
        : {
            approval: 'never',
            projectContext: 'none',
            networkAccess: 'provider_api',
            dataClasses: ['owner_request', 'software_delivery_metadata'],
            sideEffects: ['campaign_repair_draft_write'],
            credentials: 'server_managed',
          };
  }

  public authorityFor(
    arguments_: SoftwareDeliveryActionArguments,
  ): CapabilityAuthority {
    this.argumentsSchema().parse(arguments_);
    return this.maximumAuthority;
  }

  public checkReadiness() {
    return this.service.current === undefined
      ? Promise.reject(
          new Error('Software delivery control is not initialized.'),
        )
      : Promise.resolve();
  }

  public async execute(input: {
    principalId: string;
    invocationId: string;
    arguments: SoftwareDeliveryActionArguments;
  }) {
    const service = this.service.current;
    if (service === undefined) {
      throw new Error('Software delivery control is not initialized.');
    }
    const result = await service.invoke({
      principalId: input.principalId,
      requestKey: input.invocationId,
      arguments: this.argumentsSchema().parse(input.arguments),
    });
    return SoftwareDeliveryManagementResultSchema.parse(result);
  }

  private argumentsSchema() {
    return this.mode === 'management'
      ? SoftwareDeliveryManagementArgumentsSchema
      : SoftwareDeliveryRepairArgumentsSchema;
  }
}
