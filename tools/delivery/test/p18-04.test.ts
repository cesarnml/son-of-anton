import { describe, expect, it } from 'bun:test';

import {
  buildCloseoutBranchSyncCommands,
  buildCloseoutPrCloseComment,
  formatCloseoutBranchGuardError,
} from '../closeout-stack';

describe('P18.04 closeout target branch behavior', () => {
  it('names closeoutBranch in the branch guard error', () => {
    expect(formatCloseoutBranchGuardError('staging', 'main')).toBe(
      'closeout-stack must run from the staging branch, but HEAD is on main.',
    );
  });

  it('builds closeout fetch, reset, and push commands from closeoutBranch', () => {
    expect(buildCloseoutBranchSyncCommands('staging')).toEqual({
      fetch: ['git', 'fetch', 'origin', 'staging'],
      resetHard: ['git', 'reset', '--hard', 'origin/staging'],
      push: ['git', 'push', 'origin', 'staging'],
    });
  });

  it('names closeoutBranch in PR close comments', () => {
    expect(buildCloseoutPrCloseComment('P18.04', 'staging', 'squash')).toBe(
      'Squash-merged to staging via closeout-stack (P18.04).',
    );

    expect(
      buildCloseoutPrCloseComment('P18.04', 'staging', 'cherry-pick'),
    ).toContain('Merged to staging via closeout-stack (P18.04).');
  });
});
