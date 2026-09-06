import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampPanelWidth,
  parseStoredPanelWidth,
} from '../src/components/layout/panel-width-values.ts';

void describe('desktop panel sizing', () => {
  void it('keeps dragged widths inside the available workspace', () => {
    assert.equal(clampPanelWidth(120, 240, 520), 240);
    assert.equal(clampPanelWidth(400, 240, 520), 400);
    assert.equal(clampPanelWidth(900, 240, 520), 520);
  });

  void it('falls back safely for invalid persisted widths', () => {
    assert.equal(parseStoredPanelWidth(null), undefined);
    assert.equal(parseStoredPanelWidth('not-a-number'), undefined);
    assert.equal(parseStoredPanelWidth('-10'), undefined);
    assert.equal(parseStoredPanelWidth('416'), 416);
  });
});
