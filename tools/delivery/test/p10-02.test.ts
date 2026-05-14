import { describe, expect, it } from 'bun:test';

import {
  executeClaudeCliReview,
  validateRunnerArtifact,
} from '../subagent-runner';
import { openPullRequest } from '../orchestrator';
import type { SubagentRunnerArtifact } from '../subagent-runner';
import type { DeliveryOrchestratorContext } from '../context';
import type { DeliveryState } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseState: DeliveryState = {
  planKey: 'phase-10',
  planPath: 'docs/product/delivery/phase-10/implementation-plan.md',
  statePath: '.agents/delivery/phase-10/state.json',
  reviewsDirPath: 'docs/product/delivery/phase-10/reviews',
  handoffsDirPath: '.agents/delivery/phase-10/handoffs',
  reviewPollIntervalMinutes: 6,
  reviewPollMaxWaitMinutes: 12,
  tickets: [
    {
      id: 'P10.02',
      title: 'Executor-owned Subagent Review via Claude CLI',
      slug: 'executor-owned-subagent-review-via-claude-cli',
      ticketFile:
        'docs/product/delivery/phase-10/ticket-02-executor-owned-subagent-review-via-claude-cli.md',
      status: 'subagent_review_complete',
      branch: 'agents/p10-02-executor-owned-subagent-review-via-claude-cli',
      baseBranch:
        'agents/p10-01-runner-native-subagent-review-config-and-run-policy-contract',
      worktreePath: '/tmp/p10_02',
      subagentReviewOutcome: 'clean',
      subagentRunnerArtifactPath:
        'docs/product/delivery/phase-10/reviews/P10.02-runner-review.json',
    },
  ],
};

const baseStateVerified: DeliveryState = {
  ...baseState,
  tickets: baseState.tickets.map((t) => ({
    ...t,
    status: 'verified' as const,
  })),
};

function makeContext(
  overrides: Partial<{
    subagentReview: 'required' | 'skip_doc_only' | 'disabled';
    runnerKind: 'claude-cli' | 'codex-exec' | undefined;
  }> = {},
): DeliveryOrchestratorContext {
  return {
    config: {
      defaultBranch: 'main',
      planRoot: 'docs',
      runtime: 'bun',
      packageManager: 'bun',
      ticketBoundaryMode: 'cook',
      reviewPolicy: {
        subagentReview: overrides.subagentReview ?? 'skip_doc_only',
        prReview: 'skip_doc_only',
      },
      subagentReviewRunner:
        overrides.runnerKind !== undefined
          ? { kind: overrides.runnerKind }
          : undefined,
    },
    platform: {
      createPullRequest: () => ({
        number: 42,
        url: 'https://github.com/test/pr/42',
      }),
      editPullRequest: () => undefined,
      ensureBranchPushed: () => undefined,
      findOpenPullRequest: () => undefined,
      resolveGitHubRepoForOrchestrator: () => undefined,
      resolveReviewThread: () => undefined,
      replyToReviewThreadForOrchestrator: () => undefined,
      runProcess: () => ({ exitCode: 0, stdout: '', stderr: '' }),
      updatePullRequestBody: () => undefined,
      readCurrentBranchName: () => 'agents/p10-02',
      listWorktrees: () => [],
      spawnSync: () => ({ status: 0, stdout: '' }),
      findExistingBranch: () => undefined,
      deriveBranchName: () => 'agents/p10-02',
      deriveWorktreePath: () => '/tmp/p10_02',
    },
    invocation: 'bun run deliver',
  } as unknown as DeliveryOrchestratorContext;
}

// ─── Runner execution ─────────────────────────────────────────────────────────

describe('P10.02 — Claude CLI runner execution', () => {
  it('returns clean outcome when process exits 0 with clean JSON', () => {
    const result = executeClaudeCliReview({
      headSha: 'abc1234',
      prompt: 'Review this diff.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ outcome: 'clean', findings: [] }),
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('clean');
    expect(result.runnerKind).toBe('claude-cli');
    expect(result.reviewedHeadSha).toBe('abc1234');
  });

  it('returns patched outcome when process exits 0 with patched JSON', () => {
    const result = executeClaudeCliReview({
      headSha: 'def5678',
      prompt: 'Review this diff.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          outcome: 'patched',
          findings: ['fixed null check'],
        }),
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('patched');
    expect(result.findings).toEqual(['fixed null check']);
  });

  it('returns unavailable when process spawn fails with ENOENT', () => {
    const result = executeClaudeCliReview({
      headSha: 'ghi9012',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => {
        throw Object.assign(new Error('spawn claude ENOENT'), {
          code: 'ENOENT',
        });
      },
    });
    expect(result.outcome).toBe('unavailable');
    expect(result.runnerKind).toBe('claude-cli');
  });

  it('returns timeout outcome when process times out', () => {
    const result = executeClaudeCliReview({
      headSha: 'jkl3456',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: null,
        stdout: '',
        timedOut: true,
      }),
    });
    expect(result.outcome).toBe('timeout');
  });

  it('returns malformed outcome when process output is not valid JSON', () => {
    const result = executeClaudeCliReview({
      headSha: 'mno7890',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: 'this is not json',
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('malformed');
  });

  it('returns malformed when JSON lacks outcome field', () => {
    const result = executeClaudeCliReview({
      headSha: 'pqr1234',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ notes: 'looks fine' }),
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('malformed');
  });

  it('returns malformed when process exits non-zero', () => {
    const result = executeClaudeCliReview({
      headSha: 'stu5678',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 1,
        stdout: '',
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('malformed');
  });
});

// ─── Artifact validation ──────────────────────────────────────────────────────

describe('P10.02 — validateRunnerArtifact', () => {
  const validArtifact: SubagentRunnerArtifact = {
    runnerKind: 'claude-cli',
    reviewedHeadSha: 'abc1234',
    outcome: 'clean',
    completedAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts valid clean artifact', () => {
    expect(validateRunnerArtifact(validArtifact)).toEqual(validArtifact);
  });

  it('accepts valid patched artifact with findings', () => {
    const artifact = {
      ...validArtifact,
      outcome: 'patched',
      findings: ['fixed x'],
    };
    expect(validateRunnerArtifact(artifact)).not.toBeNull();
  });

  it('returns null for missing runnerKind', () => {
    const { runnerKind: _, ...rest } = validArtifact;
    expect(validateRunnerArtifact(rest)).toBeNull();
  });

  it('returns null for missing reviewedHeadSha', () => {
    const { reviewedHeadSha: _, ...rest } = validArtifact;
    expect(validateRunnerArtifact(rest)).toBeNull();
  });

  it('returns null for unknown outcome value', () => {
    expect(
      validateRunnerArtifact({ ...validArtifact, outcome: 'unknown' }),
    ).toBeNull();
  });

  it('returns null for null input', () => {
    expect(validateRunnerArtifact(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateRunnerArtifact('string')).toBeNull();
  });

  it('accepts timeout artifact as structurally valid', () => {
    const artifact = { ...validArtifact, outcome: 'timeout' };
    expect(validateRunnerArtifact(artifact)).not.toBeNull();
  });

  it('accepts unavailable artifact as structurally valid', () => {
    const artifact = { ...validArtifact, outcome: 'unavailable' };
    expect(validateRunnerArtifact(artifact)).not.toBeNull();
  });
});

// ─── open-pr gating with runner ───────────────────────────────────────────────

describe('P10.02 — open-pr fails closed when runner artifact is missing', () => {
  it('fails closed when claude-cli runner is configured and no runner artifact path on ticket', async () => {
    const stateWithoutArtifact: DeliveryState = {
      ...baseStateVerified,
      tickets: baseStateVerified.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    const context = makeContext({
      runnerKind: 'claude-cli',
      subagentReview: 'skip_doc_only',
    });

    await expect(
      openPullRequest(stateWithoutArtifact, '/tmp/project', context, 'P10.02'),
    ).rejects.toThrow(/runner.*review.*required|requires.*runner.*review/i);
  });

  it('fails closed when claude-cli runner is configured and artifact file is missing', async () => {
    const context = makeContext({
      runnerKind: 'claude-cli',
      subagentReview: 'skip_doc_only',
    });

    await expect(
      openPullRequest(
        {
          ...baseState,
          tickets: [
            {
              ...baseState.tickets[0]!,
              status: 'subagent_review_complete' as const,
              subagentRunnerArtifactPath: '/nonexistent/path.json',
            },
          ],
        },
        '/tmp/project',
        context,
        'P10.02',
      ),
    ).rejects.toThrow(/runner.*review.*required|requires.*runner.*review/i);
  });

  it('exposes stable contract code workflow.open_pr.requires_runner_review', async () => {
    const stateWithoutArtifact: DeliveryState = {
      ...baseStateVerified,
      tickets: baseStateVerified.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    const context = makeContext({
      runnerKind: 'claude-cli',
      subagentReview: 'skip_doc_only',
    });

    try {
      await openPullRequest(
        stateWithoutArtifact,
        '/tmp/project',
        context,
        'P10.02',
      );
      throw new Error('Expected error was not thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(
        'workflow.open_pr.requires_runner_review',
      );
    }
  });

  it('does not gate when no runner is configured', async () => {
    const context = makeContext({
      runnerKind: undefined,
      subagentReview: 'disabled',
    });
    const stateWithoutArtifact: DeliveryState = {
      ...baseState,
      tickets: baseState.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    // Should not throw due to runner artifact — the normal open-pr flow handles the rest
    // Use subagent_review_complete status and disabled policy to let it proceed
    try {
      await openPullRequest(
        stateWithoutArtifact,
        '/tmp/project',
        context,
        'P10.02',
      );
    } catch (err) {
      expect((err as Error).message).not.toMatch(/requires.*runner.*review/i);
    }
  });
});
