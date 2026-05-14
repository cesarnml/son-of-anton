import type { SubagentReviewRunnerKind } from './config';

export type SubagentRunnerOutcome =
  | 'clean'
  | 'patched'
  | 'timeout'
  | 'unavailable'
  | 'malformed';

export type SubagentRunnerArtifact = {
  runnerKind: SubagentReviewRunnerKind;
  reviewedHeadSha: string;
  outcome: SubagentRunnerOutcome;
  completedAt: string;
  findings?: string[];
};

export type ClaudeCliReviewResult = {
  runnerKind: 'claude-cli';
  reviewedHeadSha: string;
  outcome: SubagentRunnerOutcome;
  completedAt: string;
  findings?: string[];
};

export type SpawnResult = {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
};

export type ExecuteClaudeCliReviewOptions = {
  headSha: string;
  prompt: string;
  timeoutMs: number;
  spawnProcess: () => SpawnResult;
};

export function executeClaudeCliReview(
  options: ExecuteClaudeCliReviewOptions,
): ClaudeCliReviewResult {
  const { headSha, spawnProcess } = options;
  const completedAt = new Date().toISOString();

  let result: SpawnResult;
  try {
    result = spawnProcess();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      return {
        runnerKind: 'claude-cli',
        reviewedHeadSha: headSha,
        outcome: 'unavailable',
        completedAt,
      };
    }
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'malformed',
      completedAt,
    };
  }

  if (result.timedOut) {
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'timeout',
      completedAt,
    };
  }

  if (result.exitCode !== 0) {
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'malformed',
      completedAt,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'malformed',
      completedAt,
    };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('outcome' in parsed) ||
    typeof (parsed as Record<string, unknown>)['outcome'] !== 'string'
  ) {
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'malformed',
      completedAt,
    };
  }

  const raw = parsed as Record<string, unknown>;
  const outcome = raw['outcome'] as string;
  const validOutcomes: SubagentRunnerOutcome[] = [
    'clean',
    'patched',
    'timeout',
    'unavailable',
    'malformed',
  ];
  if (!(validOutcomes as string[]).includes(outcome)) {
    return {
      runnerKind: 'claude-cli',
      reviewedHeadSha: headSha,
      outcome: 'malformed',
      completedAt,
    };
  }

  const findings = Array.isArray(raw['findings'])
    ? (raw['findings'] as unknown[]).filter(
        (f): f is string => typeof f === 'string',
      )
    : undefined;

  return {
    runnerKind: 'claude-cli',
    reviewedHeadSha: headSha,
    outcome: outcome as SubagentRunnerOutcome,
    completedAt,
    ...(findings !== undefined && findings.length > 0 ? { findings } : {}),
  };
}

const VALID_RUNNER_KINDS: SubagentRunnerArtifact['runnerKind'][] = [
  'claude-cli',
  'codex-exec',
];
const VALID_OUTCOMES: SubagentRunnerOutcome[] = [
  'clean',
  'patched',
  'timeout',
  'unavailable',
  'malformed',
];

export function validateRunnerArtifact(
  value: unknown,
): SubagentRunnerArtifact | null {
  if (typeof value !== 'object' || value === null) return null;

  const obj = value as Record<string, unknown>;

  if (
    typeof obj['runnerKind'] !== 'string' ||
    !(VALID_RUNNER_KINDS as string[]).includes(obj['runnerKind'])
  ) {
    return null;
  }

  if (typeof obj['reviewedHeadSha'] !== 'string') return null;

  if (
    typeof obj['outcome'] !== 'string' ||
    !(VALID_OUTCOMES as string[]).includes(obj['outcome'])
  ) {
    return null;
  }

  if (typeof obj['completedAt'] !== 'string') return null;

  const findings =
    obj['findings'] !== undefined
      ? Array.isArray(obj['findings'])
        ? (obj['findings'] as unknown[]).filter(
            (f): f is string => typeof f === 'string',
          )
        : null
      : undefined;

  if (findings === null) return null;

  return {
    runnerKind: obj['runnerKind'] as SubagentRunnerArtifact['runnerKind'],
    reviewedHeadSha: obj['reviewedHeadSha'] as string,
    outcome: obj['outcome'] as SubagentRunnerOutcome,
    completedAt: obj['completedAt'] as string,
    ...(findings !== undefined ? { findings } : {}),
  };
}
