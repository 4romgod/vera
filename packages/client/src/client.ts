import { AutomationClient } from './domains/automation-client.ts';

export class VeraClient extends AutomationClient {}

export type VeraApi = Pick<VeraClient, keyof VeraClient>;
