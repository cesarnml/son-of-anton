import { describe, expect, it } from 'bun:test';

import { parseRedPolicy } from '../ticket-metadata';

describe('parseRedPolicy', () => {
  it('returns "skip" for a ticket declaring Red: skip in the metadata block', () => {
    const content = [
      '# P12.02 Example ticket',
      '',
      'Size: 1 points',
      'Type: docs',
      'Scope: delivery',
      'Red: skip',
      '',
      '## Outcome',
      '',
      '- example',
      '',
    ].join('\n');

    expect(parseRedPolicy(content)).toBe('skip');
  });
});
