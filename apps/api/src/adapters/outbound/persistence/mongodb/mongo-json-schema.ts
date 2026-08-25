import type { Document } from 'mongodb';

// MongoDB supports a constrained JSON Schema dialect. Keep this translation
// small and regression-tested whenever Zod or a persisted schema changes.
export function toMongoJsonSchema(value: unknown, topLevel = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toMongoJsonSchema(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !['$schema', 'format', 'propertyNames'].includes(key))
      .filter(
        ([key]) =>
          !['const', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key),
      )
      .map(([key, item]) =>
        key === 'type' && item === 'integer'
          ? ['bsonType', ['int', 'long', 'double', 'decimal']]
          : [key, toMongoJsonSchema(item)],
      ),
  );
  if ('const' in source) {
    result.enum = [source.const];
  }
  if (typeof source.exclusiveMinimum === 'number') {
    result.minimum = source.exclusiveMinimum;
    result.exclusiveMinimum = true;
  }
  if (typeof source.exclusiveMaximum === 'number') {
    result.maximum = source.exclusiveMaximum;
    result.exclusiveMaximum = true;
  }
  if (topLevel) {
    result.properties = {
      _id: { bsonType: 'objectId' },
      ...(result.properties as Record<string, unknown>),
    };
  }
  return result;
}

export function mongoDocumentSchema(value: unknown): Document {
  return toMongoJsonSchema(value, true) as Document;
}
