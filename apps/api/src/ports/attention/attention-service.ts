import type {
  AttentionBriefing,
  AttentionDecisionRequest,
} from '../../domain/attention/attention.ts';

export type AttentionService = {
  getBriefing(principalId: string): Promise<AttentionBriefing>;
  decide(input: {
    principalId: string;
    attentionItemId: string;
    requestKey: string;
    request: AttentionDecisionRequest;
  }): Promise<AttentionBriefing>;
};
