import type { AttentionDecision } from '../../../../domain/attention/attention.ts';
import type { AttentionDecisionStore } from '../../../../ports/persistence/attention-decision-store.ts';

export class InMemoryAttentionDecisionStore implements AttentionDecisionStore {
  private readonly decisions: AttentionDecision[] = [];

  public create(decision: AttentionDecision) {
    const existing = this.decisions.find(
      (candidate) =>
        candidate.principalId === decision.principalId &&
        candidate.requestKey === decision.requestKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        created: false,
        decision: structuredClone(existing),
      });
    }
    this.decisions.push(structuredClone(decision));
    return Promise.resolve({
      created: true,
      decision: structuredClone(decision),
    });
  }

  public findByRequestKey(principalId: string, requestKey: string) {
    const decision = this.decisions.find(
      (candidate) =>
        candidate.principalId === principalId &&
        candidate.requestKey === requestKey,
    );
    return Promise.resolve(
      decision === undefined ? null : structuredClone(decision),
    );
  }

  public listLatestByItem(principalId: string, attentionItemIds: string[]) {
    const ids = new Set(attentionItemIds);
    const result = new Map<string, AttentionDecision>();
    for (const decision of this.decisions) {
      if (
        decision.principalId !== principalId ||
        !ids.has(decision.attentionItemId)
      ) {
        continue;
      }
      result.set(decision.attentionItemId, structuredClone(decision));
    }
    return Promise.resolve(result);
  }

  public checkReadiness() {
    return Promise.resolve();
  }

  public close() {
    this.decisions.length = 0;
    return Promise.resolve();
  }
}
