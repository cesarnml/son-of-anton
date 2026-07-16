import { describe, expect, it } from 'bun:test';

import {
  detectRefactorReviewLabeledCommits,
  isSuspiciousRefactorSuggestionsParse,
  parseRefactorSuggestions,
  reconcileRefactorReview,
  REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_A,
  REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_B,
  validateRefactorSuggestionDecision,
} from '../refactor-review';

describe('P20.01 — <refactor-suggestions> tag parser', () => {
  it('parses a tagged block with bullets correctly', () => {
    const markdown = [
      '**Local-quality notes**',
      'clean',
      '',
      '**Suggestions**',
      '<refactor-suggestions>',
      '- extract duplicated retry logic in `foo.ts`',
      '- rename `doStuff` to `resolveTicket`',
      '</refactor-suggestions>',
    ].join('\n');

    const result = parseRefactorSuggestions(markdown);
    expect(result.found).toBe(true);
    expect(result.closed).toBe(true);
    expect(result.isExplicitNone).toBe(false);
    expect(result.suggestions).toEqual([
      'extract duplicated retry logic in `foo.ts`',
      'rename `doStuff` to `resolveTicket`',
    ]);
    expect(isSuspiciousRefactorSuggestionsParse(result)).toBe(false);
  });

  it('treats the literal None body as clean-empty with no warning', () => {
    const markdown = [
      '<refactor-suggestions>',
      'None',
      '</refactor-suggestions>',
    ].join('\n');

    const result = parseRefactorSuggestions(markdown);
    expect(result.found).toBe(true);
    expect(result.closed).toBe(true);
    expect(result.isExplicitNone).toBe(true);
    expect(result.suggestions).toEqual([]);
    expect(isSuspiciousRefactorSuggestionsParse(result)).toBe(false);
  });

  it('parses to end-of-file when the close tag is missing', () => {
    const markdown = [
      '<refactor-suggestions>',
      '- extract duplicated retry logic in `foo.ts`',
      '',
      'Runner termination',
      'runnerStatus: completed',
    ].join('\n');

    const result = parseRefactorSuggestions(markdown);
    expect(result.found).toBe(true);
    expect(result.closed).toBe(false);
    expect(result.suggestions).toEqual([
      'extract duplicated retry logic in `foo.ts`',
    ]);
  });

  it('returns a 0-parse when the tag is missing or misnamed', () => {
    const markdownMissing = [
      '**Suggestions**',
      '- extract duplicated retry logic in `foo.ts`',
    ].join('\n');
    const resultMissing = parseRefactorSuggestions(markdownMissing);
    expect(resultMissing.found).toBe(false);
    expect(resultMissing.suggestions).toEqual([]);
    expect(isSuspiciousRefactorSuggestionsParse(resultMissing)).toBe(true);

    const markdownMisnamed = [
      '<refactor_suggestions>',
      '- extract duplicated retry logic in `foo.ts`',
      '</refactor_suggestions>',
    ].join('\n');
    const resultMisnamed = parseRefactorSuggestions(markdownMisnamed);
    expect(resultMisnamed.found).toBe(false);
    expect(resultMisnamed.suggestions).toEqual([]);
    expect(isSuspiciousRefactorSuggestionsParse(resultMisnamed)).toBe(true);
  });
});

describe('P20.01 — refactor suggestion decision validation', () => {
  it('throws when a rejected decision has no reason', () => {
    expect(() =>
      validateRefactorSuggestionDecision({
        id: 'R1',
        summary: 'extract duplicated retry logic',
        decision: 'rejected',
      }),
    ).toThrow(/reason/i);
  });

  it('throws when a deferred decision has no reason', () => {
    expect(() =>
      validateRefactorSuggestionDecision({
        id: 'R2',
        summary: 'rename doStuff',
        decision: 'deferred',
        reason: '   ',
      }),
    ).toThrow(/reason/i);
  });

  it('accepts a valid accepted decision with no reason required', () => {
    expect(() =>
      validateRefactorSuggestionDecision({
        id: 'R3',
        summary: 'extract duplicated retry logic',
        decision: 'accepted',
      }),
    ).not.toThrow();
  });
});

describe('P20.01 — refactor-review reconciliation', () => {
  const reviewedPaths = ['tools/delivery/refactor-review.ts'];
  const cleanReport = [
    '<refactor-suggestions>',
    'None',
    '</refactor-suggestions>',
  ].join('\n');
  const reportWithSuggestions = [
    '<refactor-suggestions>',
    '- extract duplicated retry logic in `foo.ts`',
    '</refactor-suggestions>',
  ].join('\n');

  it('blocks (Condition A) when reviewed paths changed without a labeled commit or deferred row', () => {
    const result = reconcileRefactorReview({
      artifactRows: [],
      reportMarkdown: cleanReport,
      reviewedHeadSha: 'sha-reviewed',
      headSha: 'sha-head',
      reviewedPaths,
      listCommitSubjects: () => [
        { sha: 'sha-head', subject: 'fix: unrelated tweak' },
      ],
      listCommitFiles: () => reviewedPaths,
      listChangedPathsInRange: () => reviewedPaths,
    });

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.condition).toBe('A');
      expect(result.message).toBe(REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_A);
    }
  });

  it('blocks (Condition B) when the report lists suggestions but no patch/deferred row exists', () => {
    const result = reconcileRefactorReview({
      artifactRows: [],
      reportMarkdown: reportWithSuggestions,
      reviewedHeadSha: 'sha-same',
      headSha: 'sha-same',
      reviewedPaths,
      listCommitSubjects: () => [],
      listCommitFiles: () => [],
      listChangedPathsInRange: () => [],
    });

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.condition).toBe('B');
      expect(result.message).toBe(REFACTOR_RECONCILIATION_BLOCKED_MESSAGE_B);
    }
  });

  it('is clean when a `[refactor-review]`-labeled commit touches the reviewed paths', () => {
    const result = reconcileRefactorReview({
      artifactRows: [],
      reportMarkdown: reportWithSuggestions,
      reviewedHeadSha: 'sha-reviewed',
      headSha: 'sha-head',
      reviewedPaths,
      listCommitSubjects: () => [
        {
          sha: 'sha-head',
          subject: 'refactor(P20.01): extract retry helper [refactor-review]',
        },
      ],
      listCommitFiles: () => reviewedPaths,
      listChangedPathsInRange: () => reviewedPaths,
    });

    expect(result.kind).toBe('patched');
    if (result.kind === 'patched') {
      expect(result.commitShas).toEqual(['sha-head']);
    }
  });

  it('is clean when a deferred row exists for the reviewed head sha', () => {
    const result = reconcileRefactorReview({
      artifactRows: [{ outcome: 'deferred', reviewedHeadSha: 'sha-reviewed' }],
      reportMarkdown: reportWithSuggestions,
      reviewedHeadSha: 'sha-reviewed',
      headSha: 'sha-head',
      reviewedPaths,
      listCommitSubjects: () => [
        { sha: 'sha-head', subject: 'fix: unrelated tweak' },
      ],
      listCommitFiles: () => reviewedPaths,
      listChangedPathsInRange: () => reviewedPaths,
    });

    expect(result.kind).toBe('clean');
  });

  it('detects only subject-labeled commits touching reviewed paths', () => {
    const shas = detectRefactorReviewLabeledCommits({
      reviewedHeadSha: 'sha-reviewed',
      headSha: 'sha-head',
      reviewedPaths,
      listCommitSubjects: () => [
        { sha: 'sha-1', subject: 'fix: unrelated [refactor-review]' },
        {
          sha: 'sha-2',
          subject: 'refactor: touches reviewed path [refactor-review]',
        },
      ],
      listCommitFiles: (sha) =>
        sha === 'sha-2' ? reviewedPaths : ['some/other/file.ts'],
    });

    expect(shas).toEqual(['sha-2']);
  });
});
