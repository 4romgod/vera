export type KeyboardAvoidingBehavior = 'height' | 'padding' | undefined;

export function keyboardAvoidingBehavior(
  platform: string | undefined,
): KeyboardAvoidingBehavior {
  if (platform === 'ios' || platform === 'android') return 'padding';
  return undefined;
}
