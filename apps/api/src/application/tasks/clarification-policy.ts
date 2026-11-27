import type { ClarificationRequest } from '../../domain/tasks/intent-clarification.ts';
import type { TaskAggregate } from '../../domain/tasks/task-aggregate.ts';

export const DEFAULT_MAX_CLARIFICATION_ROUNDS = 6;
export const MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS = 2;

type ClarificationAdmission =
  | { kind: 'ask'; consecutiveNoProgressRounds: number }
  | { kind: 'stall'; message: string };

export function answeredClarificationRounds(aggregate: TaskAggregate): number {
  return (
    aggregate.run.clarification?.rounds.filter(
      (round) => round.answer !== undefined,
    ).length ?? 0
  );
}

function normalizedQuestion(question: string): string {
  return question.trim().toLocaleLowerCase().replaceAll(/\s+/gu, ' ');
}

export function admitClarificationRequest(
  aggregate: TaskAggregate,
  request: ClarificationRequest,
): ClarificationAdmission {
  const existing = aggregate.run.clarification;
  if ((existing?.rounds.length ?? 0) >= DEFAULT_MAX_CLARIFICATION_ROUNDS) {
    return {
      kind: 'stall',
      message:
        'I could not resolve the remaining ambiguity within the clarification limit. Please restate the outcome you want, including the missing details, or start a new request.',
    };
  }

  const question = normalizedQuestion(request.question);
  if (
    existing?.rounds.some(
      (round) => normalizedQuestion(round.question) === question,
    ) === true
  ) {
    return {
      kind: 'stall',
      message:
        'I would need to repeat an earlier question, so I stopped instead of looping. Please restate the outcome and the unresolved detail in one message.',
    };
  }

  const previous = existing?.rounds.at(-1);
  if (previous === undefined) {
    return { kind: 'ask', consecutiveNoProgressRounds: 0 };
  }
  const currentMissing = new Set(
    request.missingInformation.map(({ key }) => key),
  );
  const resolved = new Set(request.resolvedFacts.map(({ key }) => key));
  const madeProgress = previous.missingInformation.some(
    ({ key }) => !currentMissing.has(key) || resolved.has(key),
  );
  const noProgress = madeProgress
    ? 0
    : (existing?.consecutiveNoProgressRounds ?? 0) + 1;
  if (noProgress >= MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS) {
    return {
      kind: 'stall',
      message:
        'I still do not have enough information to act safely, and the last answers did not resolve the same ambiguity. Please restate the desired outcome and that missing detail, or cancel the request.',
    };
  }
  return { kind: 'ask', consecutiveNoProgressRounds: noProgress };
}
