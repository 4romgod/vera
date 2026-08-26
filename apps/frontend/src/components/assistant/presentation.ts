import type {
  ConversationSummaryResource,
  ProjectResource,
} from '@vera/client';

export type ConversationGroup = {
  label: 'Today' | 'Previous 7 days' | 'Earlier';
  conversations: ConversationSummaryResource[];
};

const DAY_MS = 86_400_000;

export function displayConversationTitle(
  title: string | undefined,
  maxLength = 72,
): string {
  const normalized = title?.trim().replace(/\s+/gu, ' ') ?? '';
  if (normalized.length === 0) return 'New conversation';
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, Math.max(1, maxLength - 1));
  const boundary = candidate.lastIndexOf(' ');
  const clipped =
    boundary >= Math.floor(maxLength * 0.58)
      ? candidate.slice(0, boundary)
      : candidate;
  return `${clipped.trimEnd()}…`;
}

export function formatConversationTime(
  updatedAt: string,
  now = new Date(),
): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.valueOf())) return '';
  const sameDay = updated.toDateString() === now.toDateString();
  return sameDay
    ? updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : updated.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function groupConversations(
  conversations: ConversationSummaryResource[],
  now = new Date(),
): ConversationGroup[] {
  const groups: Record<
    ConversationGroup['label'],
    ConversationSummaryResource[]
  > = {
    Today: [],
    'Previous 7 days': [],
    Earlier: [],
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const conversation of conversations.toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )) {
    const updated = new Date(conversation.updatedAt);
    const updatedDay = new Date(
      updated.getFullYear(),
      updated.getMonth(),
      updated.getDate(),
    );
    const age = today.valueOf() - updatedDay.valueOf();
    if (age <= 0) groups.Today.push(conversation);
    else if (age < DAY_MS * 7) groups['Previous 7 days'].push(conversation);
    else groups.Earlier.push(conversation);
  }
  return (['Today', 'Previous 7 days', 'Earlier'] as const)
    .map((label) => ({ label, conversations: groups[label] }))
    .filter((group) => group.conversations.length > 0);
}

export function filterConversations(
  conversations: ConversationSummaryResource[],
  query: string,
): ConversationSummaryResource[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return conversations;
  return conversations.filter((conversation) =>
    [conversation.title, conversation.lastMessage?.content]
      .filter((value): value is string => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function projectContextLabel(
  selectedProjectId: string | undefined,
  projects: ProjectResource[],
): string {
  if (selectedProjectId === undefined) return 'Personal';
  return (
    projects.find((project) => project.id === selectedProjectId)?.displayName ??
    'Project'
  );
}

export function humanizeIdentifier(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
