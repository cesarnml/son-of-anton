import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SubagentRunnerOutcome = 'clean' | 'patched' | 'skipped';

export type SubagentRunnerKind =
  | 'claude-cli'
  | 'codex-exec'
  | 'skipped'
  | 'operator-recorder';

export type SubagentRunnerTerminatedReason =
  | 'completed'
  | 'rate_limit'
  | 'sandbox_denied'
  | 'runner_unavailable';

export type SubagentRunnerInvocation = {
  runnerKind: SubagentRunnerKind;
  reviewedHeadSha: string;
  outcome: SubagentRunnerOutcome;
  completedAt: string;
  terminatedReason: SubagentRunnerTerminatedReason;
  findings: string[];
  probedSurfaces: string[];
  patches: string[];
};

export type SubagentRunnerArtifact = {
  ticket: string;
  invocations: SubagentRunnerInvocation[];
};

export type SpawnResult = {
  exitCode: number | null;
  timedOut: boolean;
  /**
   * Optional honest termination reason flagged by the spawn closure (e.g. a
   * rate-limit signature detected in stdout despite exit code 0). When omitted,
   * tryRunner defaults to `'completed'`.
   */
  terminatedReason?: SubagentRunnerTerminatedReason;
};

export type RunnerAttemptResult =
  | {
      status: 'ran';
      outcome: 'clean' | 'patched';
      terminatedReason: SubagentRunnerTerminatedReason;
    }
  | { status: 'unavailable' }
  | { status: 'timeout' };

export type BuildSubagentReviewPromptInput = {
  baseBranch: string;
  changedFiles: string[];
};

export function buildSubagentReviewPrompt({
  baseBranch,
  changedFiles,
}: BuildSubagentReviewPromptInput): string {
  const files = changedFiles.length
    ? changedFiles.map((file) => `- ${file}`).join('\n')
    : '- (no changed files detected)';

  return [
    'Assume this implementation has holes. Find demonstrable ticket-relevant behavior breaks, not repo-wide hygiene issues.',
    '',
    `Review all code changes introduced in the current branch versus its base branch (${baseBranch}).`,
    '',
    'Changed files:',
    files,
    '',
    'Hard write boundary:',
    '- Never modify files under docs/product/delivery/**.',
    '- If you find an issue there, report it under Findings for human review only.',
    '- This includes ticket docs, implementation plans, handoffs, review artifacts, and rationale sections.',
    '',
    'Review boundary:',
    '- Start from the changed files, then independently inspect directly related implementation code before deciding the review is complete.',
    '- You may add attack surfaces when your repo read finds plausible ticket-relevant failure paths.',
    '- Patch only demonstrated correctness gaps relevant to the branch behavior.',
    '- Do not patch for style, preference, formatting, linting, or spellcheck noise.',
    '- If full-repo verification fails on pre-existing or generated-doc paths, classify it as out of scope.',
    '',
    'Commit any fixes with messages ending with " [subagent-review]".',
    'Do not rationalize away anything you notice: patch valid invariant breaks and report non-patched concerns for the human.',
  ].join('\n');
}

export function isDeliveryDocPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized === 'docs/product/delivery' ||
    normalized.startsWith('docs/product/delivery/')
  );
}

export function findDeliveryDocPaths(paths: string[]): string[] {
  return paths.filter(isDeliveryDocPath);
}

export function tryRunner(
  spawnProcess: () => SpawnResult,
  checkHasChanges: () => boolean,
): RunnerAttemptResult {
  let result: SpawnResult;
  try {
    // Synchronous spawn — checkHasChanges below is guaranteed post-exit so the
    // porcelain sample never races a runner that finishes its writes at exit.
    result = spawnProcess();
  } catch {
    return { status: 'unavailable' };
  }

  if (result.timedOut) return { status: 'timeout' };

  const hasChanges = checkHasChanges();
  return {
    status: 'ran',
    outcome: hasChanges ? 'patched' : 'clean',
    terminatedReason: result.terminatedReason ?? 'completed',
  };
}

/**
 * The narrow set of runner-attempt outcomes that justify falling back to the
 * other runner. Binary-availability failures and timeouts only — never
 * ambiguous output (rate_limit, sandbox_denied, exit-code-0-with-no-work),
 * which should surface honestly through terminatedReason instead.
 */
export function shouldFallbackToOtherRunner(
  result: RunnerAttemptResult,
): boolean {
  return result.status === 'unavailable' || result.status === 'timeout';
}

/**
 * Honesty guard: a runner that did not actually complete cannot record
 * outcome=clean. The clean state asserts "the runner reviewed the diff and
 * found nothing"; a rate_limit/sandbox_denied termination did not review the
 * diff. Override clean → skipped in that case. Patched is preserved because it
 * reflects real writes already on disk.
 */
export function decideSubagentOutcomeFromRunner(
  result: Extract<RunnerAttemptResult, { status: 'ran' }>,
): {
  outcome: SubagentRunnerOutcome;
  terminatedReason: SubagentRunnerTerminatedReason;
} {
  if (result.terminatedReason !== 'completed' && result.outcome === 'clean') {
    return { outcome: 'skipped', terminatedReason: result.terminatedReason };
  }
  return { outcome: result.outcome, terminatedReason: result.terminatedReason };
}

const VALID_RUNNER_KINDS: SubagentRunnerKind[] = [
  'claude-cli',
  'codex-exec',
  'skipped',
  'operator-recorder',
];
const VALID_OUTCOMES: SubagentRunnerOutcome[] = ['clean', 'patched', 'skipped'];
const VALID_TERMINATED_REASONS: SubagentRunnerTerminatedReason[] = [
  'completed',
  'rate_limit',
  'sandbox_denied',
  'runner_unavailable',
];

export type BuildRunnerInvocationOptions = {
  terminatedReason?: SubagentRunnerTerminatedReason;
  findings?: string[];
  probedSurfaces?: string[];
  patches?: string[];
  completedAt?: string;
};

export function buildRunnerInvocation(
  runnerKind: SubagentRunnerKind,
  reviewedHeadSha: string,
  outcome: SubagentRunnerOutcome,
  options: BuildRunnerInvocationOptions = {},
): SubagentRunnerInvocation {
  return {
    runnerKind,
    reviewedHeadSha,
    outcome,
    completedAt: options.completedAt ?? new Date().toISOString(),
    terminatedReason: options.terminatedReason ?? 'completed',
    findings: options.findings ?? [],
    probedSurfaces: options.probedSurfaces ?? [],
    patches: options.patches ?? [],
  };
}

export function buildRunnerArtifact(
  ticket: string,
  invocations: SubagentRunnerInvocation[],
): SubagentRunnerArtifact {
  return { ticket, invocations };
}

function validateInvocation(value: unknown): SubagentRunnerInvocation | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (
    typeof obj['runnerKind'] !== 'string' ||
    !(VALID_RUNNER_KINDS as string[]).includes(obj['runnerKind'])
  ) {
    return null;
  }
  if (
    typeof obj['reviewedHeadSha'] !== 'string' ||
    obj['reviewedHeadSha'] === ''
  ) {
    return null;
  }
  if (
    typeof obj['outcome'] !== 'string' ||
    !(VALID_OUTCOMES as string[]).includes(obj['outcome'])
  ) {
    return null;
  }
  if (typeof obj['completedAt'] !== 'string' || obj['completedAt'] === '') {
    return null;
  }
  if (
    typeof obj['terminatedReason'] !== 'string' ||
    !(VALID_TERMINATED_REASONS as string[]).includes(obj['terminatedReason'])
  ) {
    return null;
  }
  const findings = validateStringArray(obj['findings']);
  if (findings === null) return null;
  const probedSurfaces = validateStringArray(obj['probedSurfaces']);
  if (probedSurfaces === null) return null;
  const patches = validateStringArray(obj['patches']);
  if (patches === null) return null;

  return {
    runnerKind: obj['runnerKind'] as SubagentRunnerKind,
    reviewedHeadSha: obj['reviewedHeadSha'] as string,
    outcome: obj['outcome'] as SubagentRunnerOutcome,
    completedAt: obj['completedAt'] as string,
    terminatedReason: obj['terminatedReason'] as SubagentRunnerTerminatedReason,
    findings,
    probedSurfaces,
    patches,
  };
}

function validateStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
  }
  return value as string[];
}

export function validateRunnerArtifact(
  value: unknown,
): SubagentRunnerArtifact | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (typeof obj['ticket'] !== 'string' || obj['ticket'] === '') return null;
  if (!Array.isArray(obj['invocations'])) return null;

  const invocations: SubagentRunnerInvocation[] = [];
  for (const raw of obj['invocations']) {
    const validated = validateInvocation(raw);
    if (!validated) return null;
    invocations.push(validated);
  }
  if (invocations.length === 0) return null;

  return { ticket: obj['ticket'] as string, invocations };
}

function isLegacyShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return !('invocations' in obj) && !('ticket' in obj) && 'runnerKind' in obj;
}

function liftLegacyArtifact(
  raw: Record<string, unknown>,
  ticket: string,
  sourcePath: string,
): SubagentRunnerArtifact {
  if (
    typeof raw['reviewedHeadSha'] !== 'string' ||
    raw['reviewedHeadSha'] === ''
  ) {
    throw new Error(
      `Legacy subagent runner artifact at ${sourcePath} is missing required field: reviewedHeadSha.`,
    );
  }
  if (
    typeof raw['outcome'] !== 'string' ||
    !(VALID_OUTCOMES as string[]).includes(raw['outcome'] as string)
  ) {
    throw new Error(
      `Legacy subagent runner artifact at ${sourcePath} is missing required field: outcome.`,
    );
  }
  if (typeof raw['completedAt'] !== 'string' || raw['completedAt'] === '') {
    throw new Error(
      `Legacy subagent runner artifact at ${sourcePath} is missing required field: completedAt.`,
    );
  }
  if (!(VALID_RUNNER_KINDS as string[]).includes(raw['runnerKind'] as string)) {
    throw new Error(
      `Legacy subagent runner artifact at ${sourcePath} has invalid runnerKind: ${String(raw['runnerKind'])}.`,
    );
  }

  const invocation: SubagentRunnerInvocation = {
    runnerKind: raw['runnerKind'] as SubagentRunnerKind,
    reviewedHeadSha: raw['reviewedHeadSha'],
    outcome: raw['outcome'] as SubagentRunnerOutcome,
    completedAt: raw['completedAt'],
    terminatedReason: 'completed',
    findings: [],
    probedSurfaces: [],
    patches: [],
  };
  return { ticket, invocations: [invocation] };
}

export function readSubagentRunnerArtifact(
  path: string,
  ticket: string,
): SubagentRunnerArtifact {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;

  if (isLegacyShape(raw)) {
    return liftLegacyArtifact(raw as Record<string, unknown>, ticket, path);
  }

  const validated = validateRunnerArtifact(raw);
  if (!validated) {
    throw new Error(
      `Subagent runner artifact at ${path} is not a valid structured SubagentRunnerArtifact.`,
    );
  }
  return validated;
}

export type ParsedSubagentReviewArgs = {
  ticketId?: string;
  outcome?: 'clean' | 'patched';
  reviewedHeadSha?: string;
  patchCommitArgs: string[];
  force: boolean;
};

export function parseSubagentReviewArgs(
  positionals: string[],
  flags: Set<string>,
): ParsedSubagentReviewArgs {
  const isOutcome = (value: string | undefined): value is 'clean' | 'patched' =>
    value === 'clean' || value === 'patched';

  let cursor = 0;
  let ticketId: string | undefined;

  if (positionals[cursor] !== undefined && !isOutcome(positionals[cursor])) {
    ticketId = positionals[cursor];
    cursor += 1;
  }

  let outcome: 'clean' | 'patched' | undefined;
  if (isOutcome(positionals[cursor])) {
    outcome = positionals[cursor] as 'clean' | 'patched';
    cursor += 1;
  }

  let reviewedHeadSha: string | undefined;
  if (outcome) {
    const sha = positionals[cursor];
    if (sha === undefined || sha.trim() === '') {
      throw new Error(
        'subagent-review recorder mode requires a HEAD SHA after the outcome: `subagent-review [ticket-id] <clean|patched> <sha> [patch-commit-sha ...]`.',
      );
    }
    reviewedHeadSha = sha;
    cursor += 1;
  }

  const patchCommitArgs = positionals.slice(cursor);
  if (!outcome && patchCommitArgs.length > 0) {
    throw new Error(
      `Unexpected positional argument: \`${patchCommitArgs[0]}\`. Usage: \`subagent-review [ticket-id] [clean|patched <sha> [patch-commit-sha ...]] [--force]\`.`,
    );
  }
  if (outcome === 'clean' && patchCommitArgs.length > 0) {
    throw new Error(
      'subagent-review patch commits are only allowed when outcome is `patched`.',
    );
  }

  return {
    ticketId,
    outcome,
    reviewedHeadSha,
    patchCommitArgs,
    force: flags.has('force'),
  };
}

export type SubagentReviewModeDecision =
  | {
      kind: 'recorder';
      reviewedHeadSha: string;
      outcome: 'clean' | 'patched';
    }
  | {
      kind: 'no-op';
      reviewedHeadSha: string;
      existingInvocationIndex: number;
    }
  | { kind: 'invoke-runner' };

export function decideSubagentReviewMode(
  args: {
    outcome?: 'clean' | 'patched';
    reviewedHeadSha?: string;
    force: boolean;
  },
  artifact: SubagentRunnerArtifact | null,
  currentHeadSha: string,
): SubagentReviewModeDecision {
  if (args.outcome && args.reviewedHeadSha) {
    return {
      kind: 'recorder',
      reviewedHeadSha: args.reviewedHeadSha,
      outcome: args.outcome,
    };
  }

  if (!args.force && artifact && currentHeadSha) {
    const idx = artifact.invocations.findIndex(
      (invocation) =>
        invocation.reviewedHeadSha === currentHeadSha &&
        invocation.outcome !== 'skipped',
    );
    if (idx >= 0) {
      return {
        kind: 'no-op',
        reviewedHeadSha: currentHeadSha,
        existingInvocationIndex: idx,
      };
    }
  }

  return { kind: 'invoke-runner' };
}

export function tryReadSubagentRunnerArtifact(
  path: string,
  ticket: string,
): SubagentRunnerArtifact | null {
  if (!existsSync(path)) return null;
  return readSubagentRunnerArtifact(path, ticket);
}

export function appendInvocationToArtifact(
  path: string,
  ticket: string,
  invocation: SubagentRunnerInvocation,
): SubagentRunnerArtifact {
  let existing: SubagentRunnerArtifact | null = null;
  if (existsSync(path)) {
    existing = readSubagentRunnerArtifact(path, ticket);
  }
  const invocations = existing
    ? [...existing.invocations, invocation]
    : [invocation];
  const artifact: SubagentRunnerArtifact = { ticket, invocations };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n', 'utf-8');
  return artifact;
}
