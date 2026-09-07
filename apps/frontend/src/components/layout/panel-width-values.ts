export function clampPanelWidth(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function parseStoredPanelWidth(
  value: string | null,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
