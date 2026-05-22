import { describe, expect, it } from 'bun:test';

import {
  buildRunnerInvocation,
  getFallbackFrom,
  getPrimaryAgent,
  getRunnerSelfReport,
  validateRunnerArtifact,
} from '../subagent-runner';
import type {
  SubagentRunnerArtifact,
  SubagentRunnerInvocation,
} from '../subagent-runner';

describe('P14.01 — outcome vocabulary expands to include deferred', () => {
  it('round-trips a deferred outcome through the validator', () => {
    const invocation = buildRunnerInvocation(
      'claude-cli',
      'abc123',
      'deferred',
      {
        primaryAgent: 'claude-code',
        schemaVersion: 1,
        runnerSelfReport: 'clean',
        fallbackFrom: null,
      },
    );
    const artifact: SubagentRunnerArtifact = {
      ticket: 'P14.01',
      invocations: [invocation],
    };

    expect(validateRunnerArtifact(artifact)).toEqual(artifact);
    expect(artifact.invocations[0]?.outcome).toBe('deferred');
  });

  it('round-trips all four outcome values', () => {
    const outcomes = ['clean', 'patched', 'deferred', 'skipped'] as const;
    for (const outcome of outcomes) {
      const invocation = buildRunnerInvocation('claude-cli', 'sha', outcome, {
        primaryAgent: 'claude-code',
        schemaVersion: 1,
        runnerSelfReport: null,
        fallbackFrom: null,
      });
      const artifact: SubagentRunnerArtifact = {
        ticket: 'P14.01',
        invocations: [invocation],
      };
      expect(validateRunnerArtifact(artifact)?.invocations[0]?.outcome).toBe(
        outcome,
      );
    }
  });
});

describe('P14.01 — identity and provenance fields round-trip', () => {
  it('preserves schemaVersion, primaryAgent, runnerSelfReport, fallbackFrom', () => {
    const invocation = buildRunnerInvocation('codex-exec', 'sha', 'clean', {
      schemaVersion: 1,
      primaryAgent: 'codex-cli',
      runnerSelfReport: 'completed',
      fallbackFrom: 'claude-cli',
    });
    const artifact: SubagentRunnerArtifact = {
      ticket: 'P14.01',
      invocations: [invocation],
    };

    const validated = validateRunnerArtifact(artifact);
    expect(validated).not.toBeNull();
    const row = validated!.invocations[0]!;
    expect(row.schemaVersion).toBe(1);
    expect(row.primaryAgent).toBe('codex-cli');
    expect(row.runnerSelfReport).toBe('completed');
    expect(row.fallbackFrom).toBe('claude-cli');
  });

  it('accepts runnerSelfReport: null and fallbackFrom: null explicitly', () => {
    const invocation = buildRunnerInvocation('claude-cli', 'sha', 'clean', {
      schemaVersion: 1,
      primaryAgent: 'claude-code',
      runnerSelfReport: null,
      fallbackFrom: null,
    });
    const artifact: SubagentRunnerArtifact = {
      ticket: 'P14.01',
      invocations: [invocation],
    };
    const validated = validateRunnerArtifact(artifact);
    expect(validated).not.toBeNull();
    expect(validated!.invocations[0]?.runnerSelfReport).toBeNull();
    expect(validated!.invocations[0]?.fallbackFrom).toBeNull();
  });
});

describe('P14.01 — permissive parse for legacy rows', () => {
  it('parses a Phase 13-shaped row (no schemaVersion, no primaryAgent) with sensible defaults', () => {
    const legacyRow: Record<string, unknown> = {
      runnerKind: 'claude-cli',
      reviewedHeadSha: 'sha',
      outcome: 'clean',
      completedAt: '2026-05-22T00:00:00.000Z',
      terminatedReason: 'completed',
      findings: [],
      probedSurfaces: [],
      patches: [],
    };
    const artifact = { ticket: 'P14.01', invocations: [legacyRow] };
    const validated = validateRunnerArtifact(artifact);
    expect(validated).not.toBeNull();
    const row = validated!.invocations[0] as SubagentRunnerInvocation;
    // Phase-14 fields are absent on legacy rows; reader getters materialize
    // the documented defaults (`"unknown"`, `null`, `null`) without mutating
    // the stored row shape.
    expect(row.primaryAgent).toBeUndefined();
    expect(row.runnerSelfReport).toBeUndefined();
    expect(row.fallbackFrom).toBeUndefined();
    expect(getPrimaryAgent(row)).toBe('unknown');
    expect(getRunnerSelfReport(row)).toBeNull();
    expect(getFallbackFrom(row)).toBeNull();
    // schemaVersion may be 0 or absent — both signal "pre-Phase-14".
    expect(row.schemaVersion === undefined || row.schemaVersion === 0).toBe(
      true,
    );
  });

  it('tolerates an unknown future schemaVersion rather than throwing', () => {
    const futureRow: Record<string, unknown> = {
      runnerKind: 'claude-cli',
      reviewedHeadSha: 'sha',
      outcome: 'clean',
      completedAt: '2026-05-22T00:00:00.000Z',
      terminatedReason: 'completed',
      findings: [],
      probedSurfaces: [],
      patches: [],
      schemaVersion: 999,
      primaryAgent: 'mystery-agent',
      runnerSelfReport: null,
      fallbackFrom: null,
    };
    const artifact = { ticket: 'P14.01', invocations: [futureRow] };
    const validated = validateRunnerArtifact(artifact);
    expect(validated).not.toBeNull();
    expect(validated!.invocations[0]?.schemaVersion).toBe(999);
  });
});
