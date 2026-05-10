import { describe, expect, it } from 'bun:test';

import type { ResolvedOrchestratorConfig } from '../runtime-config';
import {
  deriveRunPolicyFromConfig,
  normalizeDeliveryStateFromPersisted,
  normalizeRunPolicy,
} from '../state';
import type { DeliveryState, RunPolicy } from '../types';

const baseConfig: ResolvedOrchestratorConfig = {
  defaultBranch: 'main',
  planRoot: 'docs',
  runtime: 'bun',
  packageManager: 'bun',
  ticketBoundaryMode: 'cook',
  reviewPolicy: { subagentReview: 'skip_doc_only', prReview: 'skip_doc_only' },
  reviewSubagentOverride: 'codex:codex-rescue',
};

const legacyRawState = {
  planKey: 'phase-06',
  planPath: 'docs/product/delivery/phase-06/implementation-plan.md',
  statePath: '.agents/delivery/phase-06/state.json',
  reviewsDirPath: '.agents/delivery/phase-06/reviews',
  handoffsDirPath: '.agents/delivery/phase-06/handoffs',
  reviewPollIntervalMinutes: 6,
  reviewPollMaxWaitMinutes: 12,
  tickets: [],
};

describe('P7.01 run-policy state model and migration', () => {
  describe('deriveRunPolicyFromConfig', () => {
    it('produces override reviewSubagent when reviewSubagentOverride is set', () => {
      const policy = deriveRunPolicyFromConfig(baseConfig);
      expect(policy.reviewSubagent).toEqual({
        kind: 'override',
        value: 'codex:codex-rescue',
      });
    });

    it('produces same-type reviewSubagent when no override is set', () => {
      const config: ResolvedOrchestratorConfig = {
        ...baseConfig,
        reviewSubagentOverride: undefined,
      };
      const policy = deriveRunPolicyFromConfig(config);
      expect(policy.reviewSubagent).toEqual({ kind: 'same-type' });
    });

    it('reflects ticketBoundaryMode from config', () => {
      const config: ResolvedOrchestratorConfig = {
        ...baseConfig,
        ticketBoundaryMode: 'gated',
      };
      const policy = deriveRunPolicyFromConfig(config);
      expect(policy.ticketBoundaryMode).toBe('gated');
    });

    it('reflects subagentReview and prReview from config reviewPolicy', () => {
      const config: ResolvedOrchestratorConfig = {
        ...baseConfig,
        reviewPolicy: { subagentReview: 'required', prReview: 'disabled' },
      };
      const policy = deriveRunPolicyFromConfig(config);
      expect(policy.subagentReview).toBe('required');
      expect(policy.prReview).toBe('disabled');
    });
  });

  describe('normalizeRunPolicy', () => {
    it('derives runPolicy from config when absent in older state', () => {
      const state = legacyRawState as DeliveryState;
      const normalized = normalizeRunPolicy(state, baseConfig);
      expect(normalized.runPolicy).toBeDefined();
      expect(normalized.runPolicy!.ticketBoundaryMode).toBe('cook');
      expect(normalized.runPolicy!.reviewSubagent).toEqual({
        kind: 'override',
        value: 'codex:codex-rescue',
      });
    });

    it('derives runPolicy from config when runPolicy is null in persisted state', () => {
      const state = {
        ...legacyRawState,
        runPolicy: null,
      } as unknown as DeliveryState;
      const normalized = normalizeRunPolicy(state, baseConfig);
      expect(normalized.runPolicy).toBeDefined();
      expect(normalized.runPolicy!.ticketBoundaryMode).toBe('cook');
    });

    it('leaves existing runPolicy unchanged when already present', () => {
      const existingPolicy: RunPolicy = {
        ticketBoundaryMode: 'gated',
        subagentReview: 'required',
        prReview: 'disabled',
        reviewSubagent: { kind: 'same-type' },
      };
      const state = {
        ...legacyRawState,
        runPolicy: existingPolicy,
      } as DeliveryState;
      const normalized = normalizeRunPolicy(state, baseConfig);
      expect(normalized.runPolicy).toBe(existingPolicy);
    });
  });

  describe('RunPolicyReviewSubagent tagged shape survives round-trip', () => {
    it('override shape survives JSON serialization without collapsing', () => {
      const policy: RunPolicy = {
        ticketBoundaryMode: 'cook',
        subagentReview: 'skip_doc_only',
        prReview: 'skip_doc_only',
        reviewSubagent: { kind: 'override', value: 'codex:codex-rescue' },
      };
      const serialized = JSON.parse(JSON.stringify(policy)) as RunPolicy;
      expect(serialized.reviewSubagent.kind).toBe('override');
      if (serialized.reviewSubagent.kind === 'override') {
        expect(serialized.reviewSubagent.value).toBe('codex:codex-rescue');
      } else {
        throw new Error(
          'Expected kind=override but got same-type after round-trip',
        );
      }
    });

    it('same-type shape survives JSON serialization without collapsing', () => {
      const policy: RunPolicy = {
        ticketBoundaryMode: 'cook',
        subagentReview: 'skip_doc_only',
        prReview: 'skip_doc_only',
        reviewSubagent: { kind: 'same-type' },
      };
      const serialized = JSON.parse(JSON.stringify(policy)) as RunPolicy;
      expect(serialized.reviewSubagent).toEqual({ kind: 'same-type' });
    });

    it('normalizeDeliveryStateFromPersisted preserves runPolicy when present', () => {
      const rawState = {
        ...legacyRawState,
        runPolicy: {
          ticketBoundaryMode: 'cook',
          subagentReview: 'skip_doc_only',
          prReview: 'skip_doc_only',
          reviewSubagent: { kind: 'override', value: 'codex:codex-rescue' },
        },
      };
      const normalized = normalizeDeliveryStateFromPersisted(rawState);
      expect(normalized.runPolicy).toBeDefined();
      expect(normalized.runPolicy!.reviewSubagent).toEqual({
        kind: 'override',
        value: 'codex:codex-rescue',
      });
    });
  });

  describe('backward compatibility', () => {
    it('normalizeDeliveryStateFromPersisted handles state without runPolicy without error', () => {
      const normalized = normalizeDeliveryStateFromPersisted(legacyRawState);
      expect(normalized.runPolicy).toBeUndefined();
    });
  });
});
