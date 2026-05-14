export type SubagentRunnerOutcome =
  | 'clean'
  | 'patched'
  | 'timeout'
  | 'unavailable'
  | 'malformed';

export type SubagentRunnerArtifact = {
  runnerKind: 'claude-cli' | 'codex-exec';
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

export type CodexExecReviewResult = {
  runnerKind: 'codex-exec';
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

export type ExecuteCodexExecReviewOptions = {
  headSha: string;
  prompt: string;
  timeoutMs: number;
  spawnProcess: () => SpawnResult;
};

const VALID_SPAWN_OUTCOMES: SubagentRunnerOutcome[] = [
  'clean',
  'patched',
  'timeout',
  'unavailable',
  'malformed',
];

function executeRunnerReview<K extends SubagentRunnerArtifact['runnerKind']>(
  runnerKind: K,
  headSha: string,
  spawnProcess: () => SpawnResult,
): SubagentRunnerArtifact & { runnerKind: K } {
  const completedAt = new Date().toISOString();
  const fail = (outcome: SubagentRunnerOutcome) =>
    ({
      runnerKind,
      reviewedHeadSha: headSha,
      outcome,
      completedAt,
    }) as SubagentRunnerArtifact & {
      runnerKind: K;
    };

  let result: SpawnResult;
  try {
    result = spawnProcess();
  } catch (err) {
    const code = (err as { code?: string }).code;
    return fail(code === 'ENOENT' ? 'unavailable' : 'malformed');
  }

  if (result.timedOut) return fail('timeout');
  if (result.exitCode !== 0) return fail('malformed');

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return fail('malformed');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('outcome' in parsed) ||
    typeof (parsed as Record<string, unknown>)['outcome'] !== 'string'
  ) {
    return fail('malformed');
  }

  const raw = parsed as Record<string, unknown>;
  const outcome = raw['outcome'] as string;
  if (!(VALID_SPAWN_OUTCOMES as string[]).includes(outcome))
    return fail('malformed');

  const findings = Array.isArray(raw['findings'])
    ? (raw['findings'] as unknown[]).filter(
        (f): f is string => typeof f === 'string',
      )
    : undefined;

  return {
    runnerKind,
    reviewedHeadSha: headSha,
    outcome: outcome as SubagentRunnerOutcome,
    completedAt,
    ...(findings !== undefined && findings.length > 0 ? { findings } : {}),
  } as SubagentRunnerArtifact & { runnerKind: K };
}

export function executeClaudeCliReview(
  options: ExecuteClaudeCliReviewOptions,
): ClaudeCliReviewResult {
  return executeRunnerReview(
    'claude-cli',
    options.headSha,
    options.spawnProcess,
  );
}

export function executeCodexExecReview(
  options: ExecuteCodexExecReviewOptions,
): CodexExecReviewResult {
  return executeRunnerReview(
    'codex-exec',
    options.headSha,
    options.spawnProcess,
  );
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
