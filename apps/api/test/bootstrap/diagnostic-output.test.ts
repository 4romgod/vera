import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDiagnosticResult } from '../../src/bootstrap/diagnostics/diagnostic-output.ts';

const result = {
  case: 'direct response',
  expected: 'respond',
  passed: true,
  details: { provider: 'ollama' },
};

void describe('diagnostic output', () => {
  void it('formats interactive results for people', () => {
    const output = formatDiagnosticResult(result, {
      interactive: true,
      colors: false,
    });

    assert.ok(output.startsWith('✓ PASS  direct response\n'));
    assert.ok(
      output.endsWith('\n  "details": {\n    "provider": "ollama"\n  }\n}\n\n'),
    );
  });

  void it('keeps redirected output as compact NDJSON', () => {
    assert.equal(
      formatDiagnosticResult(result, { interactive: false, colors: false }),
      `${JSON.stringify(result)}\n`,
    );
  });

  void it('colors only the human-readable heading', () => {
    const output = formatDiagnosticResult(
      { case: 'provider conformance', passed: false },
      { interactive: true, colors: true },
    );

    assert.ok(output.startsWith('\u001B[1m\u001B[31m✗ FAIL'));
    assert.ok(output.includes('\u001B[0m\n{'));
  });
});
