export function requestedKnowledgeTitle(message: string): string {
  const normalized = message.trim();
  const named = /\b(?:as|named|titled)\s+["“']?(.+?)["”']?[.!?]*$/iu.exec(
    normalized,
  )?.[1];
  return (named ?? normalized).trim().slice(0, 200);
}
