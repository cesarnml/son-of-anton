import { describe, expect, it } from 'bun:test';

import {
  createWorkflowContractError,
  runOptionalDependencyHook,
} from '../ticket-flow';

describe('P4.01 regressions', () => {
  it('keeps workflow identity stable even when operator prose changes', () => {
    const original = createWorkflowContractError(
      'workflow.open_pr.requires_post_verify',
      'Complete post-verify before opening a PR.',
    );
    const rewritten = createWorkflowContractError(
      'workflow.open_pr.requires_post_verify',
      'Finish the verification checkpoint before publishing the PR.',
    );

    expect(original).toMatchObject({
      code: 'workflow.open_pr.requires_post_verify',
    });
    expect(rewritten).toMatchObject({
      code: 'workflow.open_pr.requires_post_verify',
    });
    expect(original.message).not.toBe(rewritten.message);
  });

  it('treats omitted optional dependency hooks as no-ops', async () => {
    await expect(
      runOptionalDependencyHook<
        [state: { ticketId: string }, sourceWorktreePath: string]
      >(undefined, { ticketId: 'P4.01' }, '/tmp/p4_01'),
    ).resolves.toBeUndefined();
  });

  it('runs optional dependency hooks when they are supplied', async () => {
    const calls: Array<{ ticketId: string; sourceWorktreePath: string }> = [];

    await runOptionalDependencyHook(
      async (state: { ticketId: string }, sourceWorktreePath: string) => {
        calls.push({ ticketId: state.ticketId, sourceWorktreePath });
      },
      { ticketId: 'P4.01' },
      '/tmp/p4_01',
    );

    expect(calls).toEqual([
      { ticketId: 'P4.01', sourceWorktreePath: '/tmp/p4_01' },
    ]);
  });
});
