/**
 * P20.01 — Refactor-review parsing, ledger shape, and reconciliation.
 *
 * Analogous to the adversarial gate's `reconciliation.ts`, but scoped to the
 * Refactor leg of TDD (duplication, naming, dead code, complexity,
 * test-name/behavior alignment) instead of correctness/attack-surface
 * hunting. This module is intentionally independent from
 * `reconciliation.ts` — it does not import or modify
 * `parseAdvisoryObservations`, `extractReportSection`,
 * `CANONICAL_REPORT_SECTION_HEADINGS`, or `parseActionableFindings`. The two
 * gates' parsing logic stay fully separate per the design stance in
 * `notes/public/refactor-advisory-subagent-design.md`.
 *
 * The `<refactor-suggestions>` tag contract follows
 * `notes/public/subagent-report-parser-contract.md`: a balanced tag block
 * the subagent copies verbatim, extracted with no heading-recognition
 * machinery.
 */

const REFACTOR_REVIEW_SUBJECT_PATTERN = /\[refactor-review\]/i;

const OPEN_TAG = /<refactor-suggestions>/i;
const CLOSE_TAG = /<\/refactor-suggestions>/i;

export type RefactorSuggestionDecisionValue =
  | 'accepted'
  | 'rejected'
  | 'deferred';

export type RefactorSuggestionDecision = {
  id: string;
  summary: string;
  decision: RefactorSuggestionDecisionValue;
  reason?: string;
};

/**
 * Throws when a suggestion decision is structurally invalid: `reason` is
 * required (non-blank) for `rejected` and `deferred` decisions so the ledger
 * always carries an audit-visible rationale for suggestions the primary
 * agent did not accept.
 */
const VALID_DECISION_VALUES: readonly RefactorSuggestionDecisionValue[] = [
  'accepted',
  'rejected',
  'deferred',
];

const SUGGESTION_ID_PATTERN = /^R[1-9]\d*$/;

export function validateRefactorSuggestionDecision(
  row: RefactorSuggestionDecision,
): void {
  if (!row.id || !SUGGESTION_ID_PATTERN.test(row.id)) {
    throw new Error(
      `Refactor suggestion decision id "${String(row.id)}" is invalid. Expected the form "R1", "R2", ...`,
    );
  }
  if (!row.summary || row.summary.trim() === '') {
    throw new Error(
      `Refactor suggestion decision ${row.id} requires a non-blank summary.`,
    );
  }
  if (!VALID_DECISION_VALUES.includes(row.decision)) {
    throw new Error(
      `Refactor suggestion decision ${row.id} has invalid decision "${String(row.decision)}". Expected one of: ${VALID_DECISION_VALUES.join(', ')}`,
    );
  }
  if (
    (row.decision === 'rejected' || row.decision === 'deferred') &&
    (!row.reason || row.reason.trim() === '')
  ) {
    throw new Error(
      `Refactor suggestion decision ${row.id} is "${row.decision}" and requires a non-blank reason.`,
    );
  }
}

export type RefactorSuggestionsParseResult = {
  /** Whether an opening `<refactor-suggestions>` tag was found at all. */
  found: boolean;
  /** Whether a matching closing tag was found (false = parsed to EOF). */
  closed: boolean;
  /** True only for the literal `None` body — a clean report, not a drift warning. */
  isExplicitNone: boolean;
  /** Parsed bullet lines, trimmed and de-prefixed. Empty when none found. */
  suggestions: string[];
};

/**
 * Extracts the `<refactor-suggestions>` tagged block from a refactor-review
 * report. Barebones and strict by design: no heading recognition, no
 * terminator regex — the tag boundary is the only signal.
 *
 * When more than one `<refactor-suggestions>` open tag appears (e.g. a
 * template skeleton example quoted earlier in the report), the **last**
 * occurrence is treated as authoritative — a report's real output section
 * follows any quoted example, not the other way around.
 *
 * - Tagged block with bullets: `found=true, closed=true, suggestions=[...]`.
 * - Literal `None` body (only when the tag is properly closed): `closed=true,
 *   isExplicitNone=true, suggestions=[]` — clean, not a drift warning.
 * - Missing close tag: `closed=false`, parses everything after the open tag
 *   to end-of-file. Always treated as suspicious regardless of body content —
 *   the parser contract requires a balanced block before a `None` body can be
 *   trusted as an honest clean signal.
 * - Empty body (no content at all) is distinct from the literal `None` and is
 *   never `isExplicitNone` — a genuinely clean report must say so explicitly.
 * - Tag missing or misnamed entirely: `found=false, suggestions=[]` — a
 *   0-parse the caller should treat as suspicious, distinct from a genuine
 *   clean `None` report.
 */
export function parseRefactorSuggestions(
  markdown: string,
): RefactorSuggestionsParseResult {
  const openMatches = [...markdown.matchAll(new RegExp(OPEN_TAG, 'gi'))];
  if (openMatches.length === 0) {
    return {
      found: false,
      closed: false,
      isExplicitNone: false,
      suggestions: [],
    };
  }
  const openMatch = openMatches[openMatches.length - 1]!;

  const afterOpen = markdown.slice(
    (openMatch.index ?? 0) + openMatch[0].length,
  );
  const closeMatch = CLOSE_TAG.exec(afterOpen);
  const closed = closeMatch !== null;
  const body = closed ? afterOpen.slice(0, closeMatch.index) : afterOpen;

  const normalized = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  if (closed && /^none\.?$/i.test(normalized)) {
    return { found: true, closed, isExplicitNone: true, suggestions: [] };
  }

  if (normalized === '') {
    return { found: true, closed, isExplicitNone: false, suggestions: [] };
  }

  const bulletLines = normalized
    .split('\n')
    .filter((line) => /^[-*]\s+/.test(line));

  return {
    found: true,
    closed,
    isExplicitNone: false,
    suggestions: bulletLines.map((line) => line.replace(/^[-*]\s+/, '').trim()),
  };
}

/**
 * True when the parse result should be treated as a silent-drift warning at
 * record time: the tag was missing/misnamed, the closing tag was absent, or
 * the tag was present but yielded zero bullets without the literal `None`
 * clean-signal.
 */
export function isSuspiciousRefactorSuggestionsParse(
  result: RefactorSuggestionsParseResult,
): boolean {
  if (!result.found || !result.closed) return true;
  return result.suggestions.length === 0 && !result.isExplicitNone;
}

export function detectRefactorReviewLabeledCommits(input: {
  reviewedHeadSha: string;
  headSha: string;
  reviewedPaths: string[];
  listCommitSubjects: (
    from: string,
    to: string,
  ) => { sha: string; subject: string }[];
  listCommitFiles: (sha: string) => string[];
}): string[] {
  if (input.reviewedHeadSha === input.headSha) return [];
  const commits = input.listCommitSubjects(
    input.reviewedHeadSha,
    input.headSha,
  );
  const reviewedSet = new Set(input.reviewedPaths);
  const result: string[] = [];
  for (const { sha, subject } of commits) {
    if (!REFACTOR_REVIEW_SUBJECT_PATTERN.test(subject)) continue;
    const files = input.listCommitFiles(sha);
    if (files.some((f) => reviewedSet.has(f))) {
      result.push(sha);
    }
  }
  return result;
}

export const REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_A =
  'reconcile-subagent-refactor-review: Condition A — files in the reviewed ' +
  'paths were modified since the refactor-review row but no ' +
  '`[refactor-review]`-labeled commit touches them, and no `deferred` row ' +
  'exists. Resolve via:\n' +
  '  1. amend the patch commit subject to include `[refactor-review]`, or\n' +
  '  2. `bun run deliver subagent-refactor-review record-deferred --reason "<rationale>"`.';

export const REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_B =
  'reconcile-subagent-refactor-review: Condition B — the refactor-review ' +
  'report lists suggestions but no commit modified the reviewed paths and ' +
  'no `deferred` row exists. Resolve via:\n' +
  '  1. apply the prudent refactor and commit with `[refactor-review]` in ' +
  'the subject, or\n' +
  '  2. `bun run deliver subagent-refactor-review record-deferred --reason "<rationale>"`.';

export class RefactorReconciliationBlockedError extends Error {
  readonly condition: 'A' | 'B';
  constructor(condition: 'A' | 'B', message: string) {
    super(message);
    this.condition = condition;
    this.name = 'RefactorReconciliationBlockedError';
  }
}

type RefactorArtifactRow = {
  outcome: string;
  reviewedHeadSha?: string;
};

export function reconcileRefactorReview(input: {
  artifactRows: RefactorArtifactRow[];
  reportMarkdown: string;
  reviewedHeadSha: string;
  headSha: string;
  reviewedPaths: string[];
  listCommitSubjects: (
    from: string,
    to: string,
  ) => { sha: string; subject: string }[];
  listCommitFiles: (sha: string) => string[];
  listChangedPathsInRange: (from: string, to: string) => string[];
}):
  | { kind: 'clean' }
  | { kind: 'patched'; commitShas: string[] }
  | { kind: 'blocked'; condition: 'A' | 'B'; message: string } {
  const hasDeferredRowForSha = input.artifactRows.some(
    (row) =>
      row.outcome === 'deferred' &&
      row.reviewedHeadSha === input.reviewedHeadSha,
  );

  const labeledShas = detectRefactorReviewLabeledCommits({
    reviewedHeadSha: input.reviewedHeadSha,
    headSha: input.headSha,
    reviewedPaths: input.reviewedPaths,
    listCommitSubjects: input.listCommitSubjects,
    listCommitFiles: input.listCommitFiles,
  });

  const changedInRange =
    input.reviewedHeadSha === input.headSha
      ? []
      : input.listChangedPathsInRange(input.reviewedHeadSha, input.headSha);
  const reviewedSet = new Set(input.reviewedPaths);
  const reviewedPathsChanged = changedInRange.filter((p) => reviewedSet.has(p));

  if (reviewedPathsChanged.length > 0 && !hasDeferredRowForSha) {
    // Every changed reviewed path must be covered by a labeled commit —
    // one qualifying commit does not vouch for reviewed-path changes made
    // by a *different*, unlabeled commit in the same range.
    const coveredPaths = new Set<string>();
    for (const sha of labeledShas) {
      for (const f of input.listCommitFiles(sha)) coveredPaths.add(f);
    }
    const uncoveredReviewedPaths = reviewedPathsChanged.filter(
      (p) => !coveredPaths.has(p),
    );
    if (uncoveredReviewedPaths.length > 0) {
      return {
        kind: 'blocked',
        condition: 'A',
        message: REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_A,
      };
    }
  }

  if (labeledShas.length > 0) {
    return { kind: 'patched', commitShas: labeledShas };
  }

  const parsed = parseRefactorSuggestions(input.reportMarkdown);
  const suggestionsExist = parsed.suggestions.length > 0;
  if (suggestionsExist && !hasDeferredRowForSha) {
    return {
      kind: 'blocked',
      condition: 'B',
      message: REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_B,
    };
  }

  return { kind: 'clean' };
}
