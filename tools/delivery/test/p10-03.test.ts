import { describe, expect, it } from 'bun:test';

import {
  executeCodexExecReview,
  executeClaudeCliReview,
} from '../subagent-runner';
import { openPullRequest } from '../orchestrator';
import type { DeliveryOrchestratorContext } from '../context';
import type { DeliveryState } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseStateVerified: DeliveryState = {
  planKey: 'phase-10',
  planPath: 'docs/product/delivery/phase-10/implementation-plan.md',
  statePath: '.agents/delivery/phase-10/state.json',
  reviewsDirPath: 'docs/product/delivery/phase-10/reviews',
  handoffsDirPath: '.agents/delivery/phase-10/handoffs',
  reviewPollIntervalMinutes: 6,
  reviewPollMaxWaitMinutes: 12,
  tickets: [
    {
      id: 'P10.03',
      title: 'Codex Exec Runner Support',
      slug: 'codex-exec-runner-support',
      ticketFile:
        'docs/product/delivery/phase-10/ticket-03-codex-exec-runner-support-for-programmatic-subagent-review.md',
      status: 'subagent_review_complete',
      branch: 'agents/p10-03-codex-exec-runner-support-for-programmatic-subagent-review',
      baseBranch: 'agents/p10-02-executor-owned-subagent-review-via-claude-cli',
      worktreePath: '/tmp/p10_03',
      subagentReviewOutcome: 'clean',
      subagentRunnerArtifactPath:
        'docs/product/delivery/phase-10/reviews/P10.03-runner-review.json',
    },
  ],
};

function makeContext(
  runnerKind: 'claude-cli' | 'codex-exec' | undefined,
): DeliveryOrchestratorContext {
  return {
    config: {
      defaultBranch: 'main',
      planRoot: 'docs',
      runtime: 'bun',
      packageManager: 'bun',
      ticketBoundaryMode: 'cook',
      reviewPolicy: {
        subagentReview: 'skip_doc_only',
        prReview: 'skip_doc_only',
      },
      subagentReviewRunner:
        runnerKind !== undefined ? { kind: runnerKind } : undefined,
    },
    platform: {
      createPullRequest: () => ({
        number: 43,
        url: 'https://github.com/test/pr/43',
      }),
      editPullRequest: () => undefined,
      ensureBranchPushed: () => undefined,
      findOpenPullRequest: () => undefined,
      resolveGitHubRepoForOrchestrator: () => undefined,
      resolveReviewThread: () => undefined,
      replyToReviewThreadForOrchestrator: () => undefined,
      runProcess: () => ({ exitCode: 0, stdout: '', stderr: '' }),
      updatePullRequestBody: () => undefined,
      readCurrentBranchName: () => 'agents/p10-03',
      listWorktrees: () => [],
      spawnSync: () => ({ status: 0, stdout: '' }),
      findExistingBranch: () => undefined,
      deriveBranchName: () => 'agents/p10-03',
      deriveWorktreePath: () => '/tmp/p10_03',
    },
    invocation: 'bun run deliver',
  } as unknown as DeliveryOrchestratorContext;
}

// ─── Codex Exec runner execution ──────────────────────────────────────────────

describe('P10.03 — Codex Exec runner execution', () => {
  it('returns clean outcome when process exits 0 with clean JSON', () => {
    const result = executeCodexExecReview({
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
    expect(result.runnerKind).toBe('codex-exec');
    expect(result.reviewedHeadSha).toBe('abc1234');
  });

  it('returns patched outcome when process exits 0 with patched JSON', () => {
    const result = executeCodexExecReview({
      headSha: 'def5678',
      prompt: 'Review this diff.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          outcome: 'patched',
          findings: ['removed dead branch'],
        }),
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('patched');
    expect(result.findings).toEqual(['removed dead branch']);
  });

  it('returns unavailable when process spawn fails with ENOENT', () => {
    const result = executeCodexExecReview({
      headSha: 'ghi9012',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => {
        throw Object.assign(new Error('spawn codex ENOENT'), {
          code: 'ENOENT',
        });
      },
    });
    expect(result.outcome).toBe('unavailable');
    expect(result.runnerKind).toBe('codex-exec');
  });

  it('returns timeout outcome when process times out', () => {
    const result = executeCodexExecReview({
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

  it('returns malformed when output is not valid JSON', () => {
    const result = executeCodexExecReview({
      headSha: 'mno7890',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: 'not json',
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('malformed');
  });

  it('returns malformed when JSON lacks outcome field', () => {
    const result = executeCodexExecReview({
      headSha: 'pqr1234',
      prompt: 'Review.',
      timeoutMs: 30_000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ summary: 'looks fine' }),
        timedOut: false,
      }),
    });
    expect(result.outcome).toBe('malformed');
  });

  it('returns malformed when process exits non-zero', () => {
    const result = executeCodexExecReview({
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

// ─── Runner identity ──────────────────────────────────────────────────────────

describe('P10.03 — runner identity in artifacts', () => {
  it('codex-exec result has runnerKind codex-exec', () => {
    const result = executeCodexExecReview({
      headSha: 'abc',
      prompt: 'p',
      timeoutMs: 1000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ outcome: 'clean' }),
        timedOut: false,
      }),
    });
    expect(result.runnerKind).toBe('codex-exec');
  });

  it('claude-cli result has runnerKind claude-cli (unchanged by P10.03)', () => {
    const result = executeClaudeCliReview({
      headSha: 'abc',
      prompt: 'p',
      timeoutMs: 1000,
      spawnProcess: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ outcome: 'clean' }),
        timedOut: false,
      }),
    });
    expect(result.runnerKind).toBe('claude-cli');
  });
});

// ─── open-pr gating with codex-exec runner ───────────────────────────────────

describe('P10.03 — open-pr fails closed when codex-exec runner artifact is missing', () => {
  it('fails closed when codex-exec runner is configured and no artifact path on ticket', async () => {
    const stateWithoutArtifact: DeliveryState = {
      ...baseStateVerified,
      tickets: baseStateVerified.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    const context = makeContext('codex-exec');

    await expect(
      openPullRequest(stateWithoutArtifact, '/tmp/project', context, 'P10.03'),
    ).rejects.toThrow(/runner.*review.*required|requires.*runner.*review/i);
  });

  it('exposes stable contract code workflow.open_pr.requires_runner_review for codex-exec', async () => {
    const stateWithoutArtifact: DeliveryState = {
      ...baseStateVerified,
      tickets: baseStateVerified.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    const context = makeContext('codex-exec');

    try {
      await openPullRequest(stateWithoutArtifact, '/tmp/project', context, 'P10.03');
      throw new Error('Expected error was not thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(
        'workflow.open_pr.requires_runner_review',
      );
    }
  });

  it('does not gate when no runner is configured (codex path)', async () => {
    const context = makeContext(undefined);
    const stateWithoutArtifact: DeliveryState = {
      ...baseStateVerified,
      tickets: baseStateVerified.tickets.map((t) => ({
        ...t,
        subagentRunnerArtifactPath: undefined,
      })),
    };
    try {
      await openPullRequest(stateWithoutArtifact, '/tmp/project', context, 'P10.03');
    } catch (err) {
      expect((err as Error).message).not.toMatch(/requires.*runner.*review/i);
    }
  });
});
