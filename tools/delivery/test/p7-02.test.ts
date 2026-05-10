import { describe, expect, it } from 'bun:test';

import type { OrchestratorConfig } from '../config';
import { parseCliArgs, resolveRuntimePolicyOverrides } from '../cli';

const DUMMY_USAGE = 'Usage: bun run deliver --plan <plan> <command>';

const baseRawConfig: OrchestratorConfig = {
  defaultBranch: 'main',
  planRoot: 'docs',
  runtime: 'bun',
  packageManager: 'bun',
  ticketBoundaryMode: 'cook',
  reviewPolicy: { subagentReview: 'skip_doc_only', prReview: 'skip_doc_only' },
  reviewSubagentOverride: 'codex:codex-rescue',
};

describe('P7.02 runtime policy override parsing and resolution', () => {
  describe('parseCliArgs — new policy flags', () => {
    it('parses --subagent-review-policy required', () => {
      const result = parseCliArgs(
        ['--plan', 'docs/product/delivery/phase-07/implementation-plan.md', 'start', '--subagent-review-policy', 'required'],
        DUMMY_USAGE,
      );
      expect(result.subagentReviewPolicy).toBe('required');
    });

    it('parses --subagent-review-policy disabled', () => {
      const result = parseCliArgs(
        ['--plan', 'x.md', 'start', '--subagent-review-policy', 'disabled'],
        DUMMY_USAGE,
      );
      expect(result.subagentReviewPolicy).toBe('disabled');
    });

    it('parses --pr-review-policy skip_doc_only', () => {
      const result = parseCliArgs(
        ['--plan', 'x.md', 'start', '--pr-review-policy', 'skip_doc_only'],
        DUMMY_USAGE,
      );
      expect(result.prReviewPolicy).toBe('skip_doc_only');
    });

    it('parses --review-subagent with an agent string', () => {
      const result = parseCliArgs(
        ['--plan', 'x.md', 'start', '--review-subagent', 'codex:codex-rescue'],
        DUMMY_USAGE,
      );
      expect(result.reviewSubagent).toBe('codex:codex-rescue');
    });

    it('parses --same-review-subagent as boolean true', () => {
      const result = parseCliArgs(
        ['--plan', 'x.md', 'start', '--same-review-subagent'],
        DUMMY_USAGE,
      );
      expect(result.sameReviewSubagent).toBe(true);
    });

    it('throws when --review-subagent and --same-review-subagent are both provided', () => {
      expect(() =>
        parseCliArgs(
          ['--plan', 'x.md', 'start', '--review-subagent', 'codex:codex-rescue', '--same-review-subagent'],
          DUMMY_USAGE,
        ),
      ).toThrow('--review-subagent and --same-review-subagent are mutually exclusive');
    });

    it('throws on invalid --subagent-review-policy value', () => {
      expect(() =>
        parseCliArgs(
          ['--plan', 'x.md', 'start', '--subagent-review-policy', 'bogus'],
          DUMMY_USAGE,
        ),
      ).toThrow('--subagent-review-policy');
    });

    it('throws on invalid --pr-review-policy value', () => {
      expect(() =>
        parseCliArgs(
          ['--plan', 'x.md', 'start', '--pr-review-policy', 'bogus'],
          DUMMY_USAGE,
        ),
      ).toThrow('--pr-review-policy');
    });

    it('throws when --review-subagent value is missing', () => {
      expect(() =>
        parseCliArgs(
          ['--plan', 'x.md', 'start', '--review-subagent'],
          DUMMY_USAGE,
        ),
      ).toThrow('--review-subagent');
    });

    it('leaves policy fields undefined when flags are absent', () => {
      const result = parseCliArgs(['--plan', 'x.md', 'status'], DUMMY_USAGE);
      expect(result.subagentReviewPolicy).toBeUndefined();
      expect(result.prReviewPolicy).toBeUndefined();
      expect(result.reviewSubagent).toBeUndefined();
      expect(result.sameReviewSubagent).toBeUndefined();
    });
  });

  describe('resolveRuntimePolicyOverrides', () => {
    it('patches subagentReview when --subagent-review-policy provided', () => {
      const patched = resolveRuntimePolicyOverrides(
        { subagentReviewPolicy: 'required' },
        baseRawConfig,
      );
      expect(patched.reviewPolicy?.subagentReview).toBe('required');
      // other fields unchanged
      expect(patched.reviewPolicy?.prReview).toBe('skip_doc_only');
    });

    it('patches prReview when --pr-review-policy provided', () => {
      const patched = resolveRuntimePolicyOverrides(
        { prReviewPolicy: 'disabled' },
        baseRawConfig,
      );
      expect(patched.reviewPolicy?.prReview).toBe('disabled');
    });

    it('patches reviewSubagentOverride when --review-subagent provided', () => {
      const patched = resolveRuntimePolicyOverrides(
        { reviewSubagent: 'some-other-agent' },
        baseRawConfig,
      );
      expect(patched.reviewSubagentOverride).toBe('some-other-agent');
    });

    it('clears reviewSubagentOverride when --same-review-subagent provided', () => {
      const patched = resolveRuntimePolicyOverrides(
        { sameReviewSubagent: true },
        baseRawConfig,
      );
      expect(patched.reviewSubagentOverride).toBeUndefined();
    });

    it('preserves reviewSubagentOverride from config when neither flag provided', () => {
      const patched = resolveRuntimePolicyOverrides({}, baseRawConfig);
      expect(patched.reviewSubagentOverride).toBe('codex:codex-rescue');
    });

    it('patches ticketBoundaryMode when --boundary-mode provided', () => {
      const patched = resolveRuntimePolicyOverrides(
        { boundaryMode: 'gated' },
        baseRawConfig,
      );
      expect(patched.ticketBoundaryMode).toBe('gated');
    });

    it('returns config unchanged when no flags provided', () => {
      const patched = resolveRuntimePolicyOverrides({}, baseRawConfig);
      expect(patched.ticketBoundaryMode).toBe('cook');
      expect(patched.reviewPolicy?.subagentReview).toBe('skip_doc_only');
    });
  });
});
