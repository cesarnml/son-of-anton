import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { getUsage } from '../cli';

/**
 * P7.05 — Documentation and closeout verification.
 *
 * Two layers of coverage:
 * 1. Help-text assertions: `getUsage()` includes all Phase 07 flags.
 * 2. Doc-surface assertions: `start-here.md` and `delivery-orchestrator.md`
 *    document the runtime override flags shipped in Phase 07. These fail
 *    before doc updates and pass once the markdown is updated.
 */

const USAGE = getUsage('bun run deliver');

// Resolve docs relative to repo root (two dirs up from tools/delivery/test)
const REPO_ROOT = resolve(import.meta.dir, '../../..');
const START_HERE = readFileSync(
  resolve(REPO_ROOT, 'docs/template/overview/start-here.md'),
  'utf8',
);
const ORCHESTRATOR_DOC = readFileSync(
  resolve(REPO_ROOT, 'docs/template/delivery/delivery-orchestrator.md'),
  'utf8',
);

describe('P7.05 phase 07 shipped command surface — help text coverage', () => {
  it('getUsage includes --subagent-review-policy flag', () => {
    expect(USAGE).toContain('--subagent-review-policy');
  });

  it('getUsage includes --pr-review-policy flag', () => {
    expect(USAGE).toContain('--pr-review-policy');
  });

  it('getUsage includes --review-subagent flag', () => {
    expect(USAGE).toContain('--review-subagent');
  });

  it('getUsage includes --same-review-subagent flag', () => {
    expect(USAGE).toContain('--same-review-subagent');
  });

  it('getUsage includes --baseline flag', () => {
    expect(USAGE).toContain('--baseline');
  });

  it('getUsage includes the valid baseline values orchestrator and run-policy', () => {
    expect(USAGE).toContain('orchestrator');
    expect(USAGE).toContain('run-policy');
  });
});

describe('P7.05 doc-surface — start-here.md documents Phase 07 runtime overrides', () => {
  it('start-here.md mentions --boundary-mode runtime override flag', () => {
    expect(START_HERE).toContain('--boundary-mode');
  });

  it('start-here.md mentions --baseline flag for divergence recovery', () => {
    expect(START_HERE).toContain('--baseline');
  });
});

describe('P7.05 doc-surface — delivery-orchestrator.md documents Phase 07 flags', () => {
  it('delivery-orchestrator.md mentions --subagent-review-policy', () => {
    expect(ORCHESTRATOR_DOC).toContain('--subagent-review-policy');
  });

  it('delivery-orchestrator.md mentions --pr-review-policy', () => {
    expect(ORCHESTRATOR_DOC).toContain('--pr-review-policy');
  });

  it('delivery-orchestrator.md mentions --baseline', () => {
    expect(ORCHESTRATOR_DOC).toContain('--baseline');
  });
});
