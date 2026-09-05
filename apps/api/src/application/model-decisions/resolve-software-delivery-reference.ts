import type { ConversationContextBundle } from '../../domain/conversations/conversation-context.ts';
import type { ExternalSignalContextBundle } from '../../domain/external-awareness/external-signal-context.ts';
import type {
  SoftwareDeliveryContext,
  SoftwareDeliveryActionArguments,
  SoftwareDeliveryResourceSummary,
} from '../../domain/software-delivery/software-delivery-management.ts';

type Resolution = { accepted: true } | { accepted: false; message: string };

function candidateDescription(resource: SoftwareDeliveryResourceSummary) {
  const label =
    resource.kind === 'mission' ? 'mission' : 'development campaign';
  const pullRequest =
    resource.kind === 'development_campaign' &&
    resource.pullRequest !== undefined
      ? ` (PR #${String(resource.pullRequest.number)})`
      : '';
  return `${resource.id} — ${label}${pullRequest}: ${resource.objective.slice(0, 120)}`;
}

function clarification(
  candidates: readonly SoftwareDeliveryResourceSummary[],
  purpose: string,
) {
  if (candidates.length === 0) {
    return `I couldn't find an owner-scoped software delivery that is currently eligible to ${purpose}.`;
  }
  const onlyCandidate = candidates.at(0);
  if (candidates.length === 1 && onlyCandidate !== undefined) {
    return `I couldn't deterministically match your request to a software delivery that is eligible to ${purpose}. Did you mean ${candidateDescription(onlyCandidate)}?`;
  }
  return [
    `I found more than one software delivery that could be used to ${purpose}. Which one do you mean?`,
    ...candidates
      .slice(0, 5)
      .map((candidate) => candidateDescription(candidate)),
  ].join('\n');
}

function idsIn(text: string): string[] {
  return (text.match(/(?:mission|campaign)_[a-z0-9-]+/giu) ?? []).map((id) =>
    id.toLowerCase(),
  );
}

function resourceKindIn(message: string) {
  const mentionsMission = /\bmissions?\b/iu.test(message);
  const mentionsCampaign = /\b(campaigns?|pull requests?|pr)\b/iu.test(message);
  if (mentionsMission === mentionsCampaign) return undefined;
  return mentionsMission
    ? ('mission' as const)
    : ('development_campaign' as const);
}

function resolveExpected(
  ownerMessage: string,
  conversationContext: ConversationContextBundle | undefined,
  candidates: readonly SoftwareDeliveryResourceSummary[],
) {
  const exactIds = [...new Set(idsIn(ownerMessage))];
  if (exactIds.length > 0) {
    const matches = candidates.filter((candidate) =>
      exactIds.includes(candidate.id.toLowerCase()),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  const prNumber = /\b(?:pull request|pr)\s*#?\s*(\d+)\b/iu.exec(
    ownerMessage,
  )?.[1];
  if (prNumber !== undefined) {
    const matches = candidates.filter(
      (candidate) =>
        candidate.kind === 'development_campaign' &&
        candidate.pullRequest?.number === Number(prNumber),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  if (/\b(latest|last|newest|most recent)\b/iu.test(ownerMessage)) {
    return candidates[0];
  }

  if (/\b(it|that|this|the one)\b/iu.test(ownerMessage)) {
    for (const message of [
      ...(conversationContext?.messages ?? []),
    ].reverse()) {
      const mentioned = idsIn(message.content).filter((id) =>
        candidates.some((candidate) => candidate.id === id),
      );
      if (mentioned.length === 1) {
        return candidates.find((candidate) => candidate.id === mentioned[0]);
      }
    }
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveSignalBoundRepair(
  externalSignalContext: ExternalSignalContextBundle | undefined,
  candidates: readonly SoftwareDeliveryResourceSummary[],
) {
  if (
    externalSignalContext?.signal.category !== 'failed_check' ||
    externalSignalContext.signal.status !== 'active'
  ) {
    return undefined;
  }
  const signal = externalSignalContext.signal;
  const matches = candidates.filter(
    (candidate) =>
      candidate.kind === 'development_campaign' &&
      candidate.project.id === signal.project.id &&
      candidate.repository.owner === signal.repository.owner &&
      candidate.repository.name === signal.repository.name &&
      candidate.pullRequest?.url === signal.url,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function validateSoftwareDeliveryReference(input: {
  arguments: SoftwareDeliveryActionArguments;
  ownerMessage: string;
  conversationContext?: ConversationContextBundle;
  externalSignalContext?: ExternalSignalContextBundle;
  context?: SoftwareDeliveryContext;
}): Resolution {
  if (input.arguments.action === 'list') return { accepted: true };
  const resources = input.context?.resources ?? [];
  const arguments_ = input.arguments;
  const mentionedKind = resourceKindIn(input.ownerMessage);
  const expectedKind =
    arguments_.action === 'prepare_repair'
      ? 'development_campaign'
      : (mentionedKind ?? arguments_.target.kind);
  const candidates = resources.filter((resource) => {
    if (arguments_.action === 'prepare_repair') {
      return (
        resource.kind === 'development_campaign' && resource.repairAvailable
      );
    }
    return resource.kind === expectedKind;
  });
  const selectedId =
    arguments_.action === 'prepare_repair'
      ? arguments_.campaignId
      : arguments_.target.id;
  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const purpose =
    arguments_.action === 'prepare_repair'
      ? 'prepare a pull-request repair'
      : 'inspect';
  if (selected === undefined) {
    return { accepted: false, message: clarification(candidates, purpose) };
  }
  const expected =
    arguments_.action === 'prepare_repair'
      ? input.externalSignalContext === undefined
        ? resolveExpected(
            input.ownerMessage,
            input.conversationContext,
            candidates,
          )
        : resolveSignalBoundRepair(input.externalSignalContext, candidates)
      : resolveExpected(
          input.ownerMessage,
          input.conversationContext,
          candidates,
        );
  if (
    arguments_.action === 'prepare_repair' &&
    input.externalSignalContext !== undefined &&
    expected === undefined
  ) {
    return {
      accepted: false,
      message:
        "I couldn't match this signal's exact project, repository, and pull request to one repairable development campaign, so I did not prepare a repair approval.",
    };
  }
  if (expected?.id !== selected.id) {
    return { accepted: false, message: clarification(candidates, purpose) };
  }
  return { accepted: true };
}
