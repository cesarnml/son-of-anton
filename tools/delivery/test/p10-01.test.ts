import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCliArgs, resolveRuntimePolicyOverrides } from '../cli';
import {
  loadOrchestratorConfig,
  resolveOrchestratorConfig,
} from '../runtime-config';
import { formatRunPolicy } from '../format';
import {
  deriveRunPolicyFromConfig,
  applyRunPolicyToConfig,
  patchRunPolicyWithFlags,
  detectRunPolicyDivergence,
} from '../state';
import type { ResolvedOrchestratorConfig } from '../runtime-config';
import type { RunPolicy } from '../types';

const baseResolvedConfig: ResolvedOrchestratorConfig = {
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

// ─── Config parsing ──────────────────────────────────────────────────────────

describe('P10.01 — runner-native config parsing', () => {
  it('loads subagentReviewRunner with kind claude-cli', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'p10-01-cfg-'));
    try {
      await writeFile(
        join(tempDir, 'orchestrator.config.json'),
        JSON.stringify({ subagentReviewRunner: { kind: 'claude-cli' } }),
      );
      const config = await loadOrchestratorConfig(tempDir);
      expect(config.subagentReviewRunner).toEqual({ kind: 'claude-cli' });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('loads subagentReviewRunner with kind codex-exec', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'p10-01-cfg-codex-'));
    try {
      await writeFile(
        join(tempDir, 'orchestrator.config.json'),
        JSON.stringify({ subagentReviewRunner: { kind: 'codex-exec' } }),
      );
      const config = await loadOrchestratorConfig(tempDir);
      expect(config.subagentReviewRunner).toEqual({ kind: 'codex-exec' });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('throws on invalid subagentReviewRunner.kind', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'p10-01-cfg-bad-'));
    try {
      await writeFile(
        join(tempDir, 'orchestrator.config.json'),
        JSON.stringify({ subagentReviewRunner: { kind: 'gemini-cli' } }),
      );
      await expect(loadOrchestratorConfig(tempDir)).rejects.toThrow(
        /subagentReviewRunner/,
      );
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('throws when subagentReviewRunner is not an object', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'p10-01-cfg-type-'));
    try {
      await writeFile(
        join(tempDir, 'orchestrator.config.json'),
        JSON.stringify({ subagentReviewRunner: 'claude-cli' }),
      );
      await expect(loadOrchestratorConfig(tempDir)).rejects.toThrow(
        /subagentReviewRunner/,
      );
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('throws when subagentReviewRunner is missing kind', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'p10-01-cfg-no-kind-'));
    try {
      await writeFile(
        join(tempDir, 'orchestrator.config.json'),
        JSON.stringify({ subagentReviewRunner: {} }),
      );
      await expect(loadOrchestratorConfig(tempDir)).rejects.toThrow(
        /subagentReviewRunner/,
      );
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('resolveOrchestratorConfig includes subagentReviewRunner from raw config', () => {
    const resolved = resolveOrchestratorConfig(
      { subagentReviewRunner: { kind: 'claude-cli' } },
      '/tmp/test',
    );
    expect(resolved.subagentReviewRunner).toEqual({ kind: 'claude-cli' });
  });

  it('resolveOrchestratorConfig has no subagentReviewRunner when absent', () => {
    const resolved = resolveOrchestratorConfig({}, '/tmp/test');
    expect(resolved.subagentReviewRunner).toBeUndefined();
  });
});

// ─── RunPolicy round-trip ────────────────────────────────────────────────────

describe('P10.01 — RunPolicy runner round-trip', () => {
  it('deriveRunPolicyFromConfig produces runner kind when subagentReviewRunner is set', () => {
    const config: ResolvedOrchestratorConfig = {
      ...baseResolvedConfig,
      subagentReviewRunner: { kind: 'claude-cli' },
    };
    const policy = deriveRunPolicyFromConfig(config);
    expect(policy.reviewSubagent).toEqual({
      kind: 'runner',
      runner: 'claude-cli',
    });
  });

  it('deriveRunPolicyFromConfig produces runner kind for codex-exec', () => {
    const config: ResolvedOrchestratorConfig = {
      ...baseResolvedConfig,
      subagentReviewRunner: { kind: 'codex-exec' },
    };
    const policy = deriveRunPolicyFromConfig(config);
    expect(policy.reviewSubagent).toEqual({
      kind: 'runner',
      runner: 'codex-exec',
    });
  });

  it('deriveRunPolicyFromConfig prefers subagentReviewRunner over reviewSubagentOverride', () => {
    const config: ResolvedOrchestratorConfig = {
      ...baseResolvedConfig,
      subagentReviewRunner: { kind: 'claude-cli' },
      reviewSubagentOverride: 'codex:codex-rescue',
    };
    const policy = deriveRunPolicyFromConfig(config);
    expect(policy.reviewSubagent.kind).toBe('runner');
  });

  it('applyRunPolicyToConfig sets subagentReviewRunner from runner reviewSubagent', () => {
    const runPolicy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'claude-cli' },
    };
    const applied = applyRunPolicyToConfig(baseResolvedConfig, runPolicy);
    expect(applied.subagentReviewRunner).toEqual({ kind: 'claude-cli' });
    expect(applied.reviewSubagentOverride).toBeUndefined();
  });

  it('applyRunPolicyToConfig clears subagentReviewRunner for override kind', () => {
    const runPolicy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'override', value: 'codex:codex-rescue' },
    };
    const applied = applyRunPolicyToConfig(
      { ...baseResolvedConfig, subagentReviewRunner: { kind: 'claude-cli' } },
      runPolicy,
    );
    expect(applied.subagentReviewRunner).toBeUndefined();
    expect(applied.reviewSubagentOverride).toBe('codex:codex-rescue');
  });

  it('applyRunPolicyToConfig clears subagentReviewRunner for same-type kind', () => {
    const runPolicy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'same-type' },
    };
    const applied = applyRunPolicyToConfig(
      { ...baseResolvedConfig, subagentReviewRunner: { kind: 'claude-cli' } },
      runPolicy,
    );
    expect(applied.subagentReviewRunner).toBeUndefined();
    expect(applied.reviewSubagentOverride).toBeUndefined();
  });

  it('detectRunPolicyDivergence detects runner kind change', () => {
    const persisted: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'claude-cli' },
    };
    const current: RunPolicy = {
      ...persisted,
      reviewSubagent: { kind: 'runner', runner: 'codex-exec' },
    };
    const diverged = detectRunPolicyDivergence(persisted, current);
    expect(diverged).toContain('reviewSubagent');
  });

  it('detectRunPolicyDivergence detects runner vs same-type change', () => {
    const persisted: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'claude-cli' },
    };
    const current: RunPolicy = {
      ...persisted,
      reviewSubagent: { kind: 'same-type' },
    };
    const diverged = detectRunPolicyDivergence(persisted, current);
    expect(diverged).toContain('reviewSubagent');
  });

  it('detectRunPolicyDivergence reports no divergence for identical runner policies', () => {
    const policy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'claude-cli' },
    };
    expect(detectRunPolicyDivergence(policy, policy)).toEqual([]);
  });

  it('patchRunPolicyWithFlags applies runner-subagent-review override', () => {
    const base: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'same-type' },
    };
    const patched = patchRunPolicyWithFlags(base, {
      runnerSubagentReview: 'codex-exec',
    });
    expect(patched.reviewSubagent).toEqual({
      kind: 'runner',
      runner: 'codex-exec',
    });
  });

  it('patchRunPolicyWithFlags: runnerSubagentReview and sameReviewSubagent are mutually exclusive', () => {
    const base: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'same-type' },
    };
    expect(() =>
      patchRunPolicyWithFlags(base, {
        runnerSubagentReview: 'claude-cli',
        sameReviewSubagent: true,
      }),
    ).toThrow(/mutually exclusive/);
  });
});

// ─── CLI parsing ─────────────────────────────────────────────────────────────

describe('P10.01 — CLI --runner-subagent-review flag', () => {
  const usage = 'Usage: bun run deliver --plan <plan> <cmd>';

  it('parses --runner-subagent-review claude-cli', () => {
    const parsed = parseCliArgs(
      [
        '--plan',
        'docs/product/delivery/p/impl.md',
        '--runner-subagent-review',
        'claude-cli',
        'status',
      ],
      usage,
    );
    expect(parsed.runnerSubagentReview).toBe('claude-cli');
  });

  it('parses --runner-subagent-review codex-exec', () => {
    const parsed = parseCliArgs(
      [
        '--plan',
        'docs/product/delivery/p/impl.md',
        '--runner-subagent-review',
        'codex-exec',
        'status',
      ],
      usage,
    );
    expect(parsed.runnerSubagentReview).toBe('codex-exec');
  });

  it('throws on invalid --runner-subagent-review value', () => {
    expect(() =>
      parseCliArgs(
        [
          '--plan',
          'docs/product/delivery/p/impl.md',
          '--runner-subagent-review',
          'gemini-cli',
          'status',
        ],
        usage,
      ),
    ).toThrow(/runner-subagent-review/);
  });

  it('throws when --runner-subagent-review value is missing', () => {
    expect(() =>
      parseCliArgs(
        [
          '--plan',
          'docs/product/delivery/p/impl.md',
          '--runner-subagent-review',
          'status',
        ],
        usage,
      ),
    ).toThrow(/runner-subagent-review/);
  });

  it('throws when --runner-subagent-review and --same-review-subagent are both passed', () => {
    expect(() =>
      parseCliArgs(
        [
          '--plan',
          'docs/product/delivery/p/impl.md',
          '--runner-subagent-review',
          'claude-cli',
          '--same-review-subagent',
          'status',
        ],
        usage,
      ),
    ).toThrow(/mutually exclusive/);
  });

  it('throws when --runner-subagent-review and --review-subagent are both passed', () => {
    expect(() =>
      parseCliArgs(
        [
          '--plan',
          'docs/product/delivery/p/impl.md',
          '--runner-subagent-review',
          'claude-cli',
          '--review-subagent',
          'codex:codex-rescue',
          'status',
        ],
        usage,
      ),
    ).toThrow(/mutually exclusive/);
  });

  it('resolveRuntimePolicyOverrides applies runnerSubagentReview to config', () => {
    const rawConfig = {};
    const result = resolveRuntimePolicyOverrides(
      { runnerSubagentReview: 'claude-cli' },
      rawConfig,
    );
    expect(result.subagentReviewRunner).toEqual({ kind: 'claude-cli' });
  });

  it('resolveRuntimePolicyOverrides clears legacy reviewSubagentOverride when --runner-subagent-review is used', () => {
    const rawConfig = { reviewSubagentOverride: 'codex:codex-rescue' };
    const result = resolveRuntimePolicyOverrides(
      { runnerSubagentReview: 'claude-cli' },
      rawConfig,
    );
    expect(result.subagentReviewRunner).toEqual({ kind: 'claude-cli' });
    expect(result.reviewSubagentOverride).toBeUndefined();
  });

  it('resolveRuntimePolicyOverrides clears subagentReviewRunner when --review-subagent is used', () => {
    const rawConfig = { subagentReviewRunner: { kind: 'claude-cli' as const } };
    const result = resolveRuntimePolicyOverrides(
      { reviewSubagent: 'codex:codex-rescue' },
      rawConfig,
    );
    expect(result.subagentReviewRunner).toBeUndefined();
    expect(result.reviewSubagentOverride).toBe('codex:codex-rescue');
  });

  it('resolveRuntimePolicyOverrides clears subagentReviewRunner when --same-review-subagent is used', () => {
    const rawConfig = { subagentReviewRunner: { kind: 'codex-exec' as const } };
    const result = resolveRuntimePolicyOverrides(
      { sameReviewSubagent: true },
      rawConfig,
    );
    expect(result.subagentReviewRunner).toBeUndefined();
    expect(result.reviewSubagentOverride).toBeUndefined();
  });
});

// ─── Format ──────────────────────────────────────────────────────────────────

describe('P10.01 — formatRunPolicy with runner', () => {
  it('formats runner kind as runner(<kind>)', () => {
    const policy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'claude-cli' },
    };
    const formatted = formatRunPolicy(policy);
    expect(formatted).toContain('reviewSubagent:runner(claude-cli)');
  });

  it('formats codex-exec runner correctly', () => {
    const policy: RunPolicy = {
      ticketBoundaryMode: 'cook',
      subagentReview: 'skip_doc_only',
      prReview: 'skip_doc_only',
      reviewSubagent: { kind: 'runner', runner: 'codex-exec' },
    };
    const formatted = formatRunPolicy(policy);
    expect(formatted).toContain('reviewSubagent:runner(codex-exec)');
  });
});
