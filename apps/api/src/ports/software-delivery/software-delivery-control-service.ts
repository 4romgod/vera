import type {
  SoftwareDeliveryActionArguments,
  SoftwareDeliveryManagementResult,
} from '../../domain/software-delivery/software-delivery-management.ts';

export type SoftwareDeliveryControlService = {
  invoke(input: {
    principalId: string;
    requestKey: string;
    arguments: SoftwareDeliveryActionArguments;
  }): Promise<SoftwareDeliveryManagementResult>;
};

export type SoftwareDeliveryControlServiceReference = {
  current?: SoftwareDeliveryControlService;
};
