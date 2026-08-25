import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MongoTaskAggregateJsonSchema } from '../../../../../src/adapters/outbound/persistence/mongodb/mongodb-execution-store.ts';
import { toMongoJsonSchema } from '../../../../../src/adapters/outbound/persistence/mongodb/mongo-json-schema.ts';
import { MongoSoftwareChangeApplicationJsonSchema } from '../../../../../src/adapters/outbound/persistence/mongodb/mongodb-change-application-store.ts';

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function unsupportedPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      unsupportedPaths(item, `${path}[${String(index)}]`),
    );
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) => {
    const itemPath = `${path}.${key}`;
    const unsupportedKeyword = [
      '$schema',
      'const',
      'format',
      'propertyNames',
    ].includes(key);
    const unsupportedInteger = key === 'type' && item === 'integer';
    return [
      ...(unsupportedKeyword || unsupportedInteger ? [itemPath] : []),
      ...unsupportedPaths(item, itemPath),
    ];
  });
}

void describe('MongoDB JSON Schema conversion', () => {
  void it('translates the exact draft-7 features used by Vera', () => {
    const converted = toMongoJsonSchema(
      {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          version: { type: 'integer', exclusiveMinimum: 0 },
          kind: { const: 'task' },
          occurredAt: { type: 'string', format: 'date-time' },
          labels: {
            type: 'object',
            propertyNames: { pattern: '^[a-z]+$' },
          },
        },
      },
      true,
    );

    assert.deepEqual(converted, {
      type: 'object',
      properties: {
        _id: { bsonType: 'objectId' },
        version: {
          bsonType: ['int', 'long', 'double', 'decimal'],
          minimum: 0,
          exclusiveMinimum: true,
        },
        kind: { enum: ['task'] },
        occurredAt: { type: 'string' },
        labels: { type: 'object' },
      },
    });
  });

  void it('keeps the generated task validator within the supported dialect', () => {
    const schema = asRecord(MongoTaskAggregateJsonSchema);
    const properties = asRecord(schema.properties);

    assert.deepEqual(properties._id, { bsonType: 'objectId' });
    assert.deepEqual(asRecord(properties.schemaVersion).enum, [1]);
    assert.deepEqual(asRecord(properties.version).bsonType, [
      'int',
      'long',
      'double',
      'decimal',
    ]);
    assert.deepEqual(schema.required, [
      'schemaVersion',
      'version',
      'task',
      'run',
      'events',
    ]);
    assert.deepEqual(unsupportedPaths(schema), []);
  });

  void it('keeps the generated change-application validator within the supported dialect', () => {
    const schema = asRecord(MongoSoftwareChangeApplicationJsonSchema);
    const properties = asRecord(schema.properties);

    assert.deepEqual(properties._id, { bsonType: 'objectId' });
    assert.deepEqual(asRecord(properties.schemaVersion).enum, [1]);
    assert.deepEqual(asRecord(properties.version).bsonType, [
      'int',
      'long',
      'double',
      'decimal',
    ]);
    assert.deepEqual(unsupportedPaths(schema), []);
  });
});
