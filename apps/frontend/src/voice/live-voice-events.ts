export type LiveVoiceEvent =
  | { schemaVersion: 1; type: 'ready'; sessionId: string }
  | { schemaVersion: 1; type: 'listening'; sessionId: string }
  | { schemaVersion: 1; type: 'speech_started'; sessionId: string }
  | {
      schemaVersion: 1;
      type: 'transcript';
      sessionId: string;
      turnId: string;
      text: string;
    }
  | {
      schemaVersion: 1;
      type: 'turn_submitted';
      sessionId: string;
      turnId: string;
      taskId: string;
      runId: string;
    }
  | {
      schemaVersion: 1;
      type: 'speech_delivery';
      sessionId: string;
      turnId: string;
      deliveryId: string;
      kind: 'approval' | 'response' | 'failure';
      text: string;
    }
  | {
      schemaVersion: 1;
      type: 'error';
      sessionId: string;
      turnId?: string;
      message: string;
    }
  | { schemaVersion: 1; type: 'ended'; sessionId: string; reason: string };

const decoder = new TextDecoder();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  options: { prefix?: string; max?: number } = {},
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= (options.max ?? 20_000) &&
    (options.prefix === undefined || value.startsWith(options.prefix))
  );
}

export function parseLiveVoiceEvent(
  payload: Uint8Array,
): LiveVoiceEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  const event = record(value);
  if (
    event?.schemaVersion !== 1 ||
    !boundedString(event.sessionId, { prefix: 'voice_session_', max: 200 })
  )
    return null;
  const base = { schemaVersion: 1 as const, sessionId: event.sessionId };
  if (['ready', 'listening', 'speech_started'].includes(String(event.type))) {
    return {
      ...base,
      type: event.type as 'ready' | 'listening' | 'speech_started',
    };
  }
  if (
    event.type === 'transcript' &&
    boundedString(event.turnId, { prefix: 'voice_turn_', max: 200 }) &&
    boundedString(event.text)
  )
    return {
      ...base,
      type: 'transcript',
      turnId: event.turnId,
      text: event.text,
    };
  if (
    event.type === 'turn_submitted' &&
    boundedString(event.turnId, { prefix: 'voice_turn_', max: 200 }) &&
    boundedString(event.taskId, { prefix: 'task_', max: 200 }) &&
    boundedString(event.runId, { prefix: 'run_', max: 200 })
  ) {
    return {
      ...base,
      type: 'turn_submitted',
      turnId: event.turnId,
      taskId: event.taskId,
      runId: event.runId,
    };
  }
  if (
    event.type === 'speech_delivery' &&
    boundedString(event.turnId, { prefix: 'voice_turn_', max: 200 }) &&
    boundedString(event.deliveryId, { prefix: 'speech_delivery_', max: 200 }) &&
    ['approval', 'response', 'failure'].includes(String(event.kind)) &&
    boundedString(event.text)
  ) {
    return {
      ...base,
      type: 'speech_delivery',
      turnId: event.turnId,
      deliveryId: event.deliveryId,
      kind: event.kind as 'approval' | 'response' | 'failure',
      text: event.text,
    };
  }
  if (
    event.type === 'error' &&
    boundedString(event.message, { max: 2_000 }) &&
    (event.turnId === undefined ||
      boundedString(event.turnId, { prefix: 'voice_turn_', max: 200 }))
  ) {
    return {
      ...base,
      type: 'error',
      message: event.message,
      ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
    };
  }
  if (event.type === 'ended' && boundedString(event.reason, { max: 200 }))
    return { ...base, type: 'ended', reason: event.reason };
  return null;
}
