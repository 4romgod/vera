import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRuntimeLoggerConfiguration } from '../../src/bootstrap/logging.ts';

void describe('runtime logging', () => {
  void it('uses structured JSON outside development', () => {
    assert.equal(
      createRuntimeLoggerConfiguration({ environment: {}, isTTY: true }),
      true,
    );
  });

  void it('uses readable Pino output in an interactive development terminal', () => {
    assert.deepEqual(
      createRuntimeLoggerConfiguration({
        environment: { NODE_ENV: 'development' },
        isTTY: true,
      }),
      {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            colorizeObjects: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      },
    );
  });

  void it('preserves NDJSON when development output is redirected', () => {
    assert.equal(
      createRuntimeLoggerConfiguration({
        environment: { NODE_ENV: 'development' },
        isTTY: false,
      }),
      true,
    );
  });

  void it('honors explicit format and color controls', () => {
    assert.equal(
      createRuntimeLoggerConfiguration({
        environment: {
          NODE_ENV: 'development',
          VERA_LOG_FORMAT: 'json',
        },
        isTTY: true,
      }),
      true,
    );
    const colorless = createRuntimeLoggerConfiguration({
      environment: { VERA_LOG_FORMAT: 'pretty', NO_COLOR: '1' },
      isTTY: true,
    });
    assert.ok(typeof colorless === 'object');
    assert.equal(colorless.transport?.options?.colorize, false);
  });

  void it('rejects an unknown log format', () => {
    assert.throws(
      () =>
        createRuntimeLoggerConfiguration({
          environment: { VERA_LOG_FORMAT: 'xml' },
          isTTY: true,
        }),
      /VERA_LOG_FORMAT must be json or pretty/u,
    );
  });
});
