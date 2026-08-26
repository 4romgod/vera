const MAX_UTTERANCE_CHARACTERS = 2_800;

export function splitSpeech(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length <= MAX_UTTERANCE_CHARACTERS) {
    return normalized.length === 0 ? [] : [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > MAX_UTTERANCE_CHARACTERS) {
    const candidate = remaining.slice(0, MAX_UTTERANCE_CHARACTERS);
    const boundary = Math.max(
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf('? '),
      candidate.lastIndexOf('! '),
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf(' '),
    );
    const splitAt = boundary > 0 ? boundary + 1 : MAX_UTTERANCE_CHARACTERS;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
