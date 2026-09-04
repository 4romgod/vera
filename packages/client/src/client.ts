import type { VeraApi } from './contracts/index.ts';

import { AutomationClient } from './domains/automation-client.ts';

export class VeraClient extends AutomationClient implements VeraApi {}
