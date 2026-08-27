export const PULL_REFRESH_TRIGGER_DISTANCE = 52;

export function pullRefreshDistance(gestureDistance: number): number {
  return Math.min(82, Math.max(0, gestureDistance) * 0.45);
}

export function shouldTriggerPullRefresh(distance: number): boolean {
  return distance >= PULL_REFRESH_TRIGGER_DISTANCE;
}
