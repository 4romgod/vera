import type { AttentionDecision } from '../../domain/attention/attention.ts';

export type AttentionDecisionStore = {
  create(
    decision: AttentionDecision,
  ): Promise<{ created: boolean; decision: AttentionDecision }>;
  findByRequestKey(
    principalId: string,
    requestKey: string,
  ): Promise<AttentionDecision | null>;
  listLatestByItem(
    principalId: string,
    attentionItemIds: string[],
  ): Promise<Map<string, AttentionDecision>>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
};
