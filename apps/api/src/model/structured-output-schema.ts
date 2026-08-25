const unsupportedSchemaKeywords = new Set([
  '$schema',
  'maxItems',
  'maxLength',
  'minItems',
  'minLength',
  'pattern',
]);

function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSchema(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (unsupportedSchemaKeywords.has(key)) continue;
    if (key === 'oneOf') {
      normalized.anyOf = normalizeSchema(item);
      continue;
    }
    if (key === 'const') {
      normalized.enum = [normalizeSchema(item)];
      continue;
    }
    normalized[key] = normalizeSchema(item);
  }
  return normalized;
}

export function cloudStructuredOutputSchema(
  outputSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      result: normalizeSchema(outputSchema),
    },
    required: ['result'],
    additionalProperties: false,
  };
}

export function unwrapCloudStructuredOutput(candidate: unknown): unknown {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !Object.hasOwn(candidate, 'result')
  ) {
    throw new TypeError('Structured provider output did not contain result.');
  }
  return (candidate as { result: unknown }).result;
}
