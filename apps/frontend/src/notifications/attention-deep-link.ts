export type AttentionDeepLink = { attentionItemId?: string };

export function parseAttentionDeepLink(
  value: unknown,
): AttentionDeepLink | null {
  if (value === 'vera://attention') return {};
  if (typeof value !== 'string') return null;
  const match = /^vera:\/\/attention\/(attention_[a-f0-9]{32})$/u.exec(value);
  return match?.[1] === undefined ? null : { attentionItemId: match[1] };
}
