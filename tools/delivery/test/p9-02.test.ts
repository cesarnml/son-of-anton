import { describe, expect, it } from 'bun:test';

import { recordPostVerify } from '../cli-runner';
import type { ResolvedOrchestratorConfig } from '../runtime-config';
import type { DeliveryState } from '../types';

const baseConfig: ResolvedOrchestratorConfig = {
  defaultBranch: 'main',
  planRoot: 'docs',
  runtime: 'bun',
  packageManager: 'bun',
  ticketBoundaryMode: 'cook',
  reviewPolicy: {
    subagentReview: 'skip_doc_only',
    prReview: 'skip_doc_only',
  },
};

const baseState: DeliveryState = {
  planKey: 'phase-09',
  planPath: 'docs/product/delivery/phase-09/implementation-plan.md',
  statePath: '.agents/delivery/phase-09/state.json',
  reviewsDirPath: '.agents/delivery/phase-09/reviews',
  handoffsDirPath: '.agents/delivery/phase-09/handoffs',
  reviewPollIntervalMinutes: 6,
  reviewPollMaxWaitMinutes: 12,
  tickets: [
    {
      id: 'P9.02',
      title: 'TDD Gate Hardening',
      slug: 'tdd-gate-hardening',
      ticketFile:
        'docs/product/delivery/phase-09/ticket-02-tdd-gate-hardening.md',
      status: 'in_progress',
      branch: 'agents/p9-02-tdd-gate-hardening',
      baseBranch: 'agents/p9-01-billing-noise-pre-filter',
      worktreePath: '/tmp/p9_02',
    },
  ],
};

describe('P9.02 tdd gate hardening', () => {
  it('rejects post-verify on in_progress code tickets before post-red', async () => {
    await expect(
      recordPostVerify(baseState, undefined, 'clean', baseConfig, {
        isLocalBranchDocOnly: () => false,
      }),
    ).rejects.toThrow(/post-red/);
  });
});
