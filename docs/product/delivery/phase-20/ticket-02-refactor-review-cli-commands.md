# P20.02 Refactor-review CLI commands

Size: 3 points
Type: feat
Scope: delivery
Red: required

## Outcome

- `write-subagent-refactor-review [ticket-id] [--prompt-file <path>]` records a primary-authored, filled `refactor-review-template.md` prompt to `reviews/<ticket>-refactor-review.prompt.md` and stores its path on the ticket in delivery state, mirroring `write-subagent-adversarial-review`'s behavior.
- `subagent-refactor-review [ticket-id] [clean|patched <sha>] [--force] [--subagent <claude-cli|codex-cli|cursor-cli>]` runs the generic runner core against the persisted refactor prompt when `--subagent` is passed, persists runner prose to `reviews/<ticket>-refactor-review.report.md`, writes a `SubagentRunnerArtifact`-shaped ledger to `reviews/<ticket>-refactor-review.ledger.json`, and enforces the same advisory-only contract as `subagent-review` (a file write in the worktree flips the outcome to `skipped`/`advisory_violation`). Without `--subagent`, it is a state recorder only, same as `subagent-review`.
- `subagent-refactor-review record-deferred --reason "<rationale>" [ticket-id]` appends a `deferred` ledger row.
- `reconcile-subagent-refactor-review [ticket-id]` runs ticket 20.01's reconciliation logic against git state since the row's `reviewedHeadSha`.
- All three commands reuse the generic runner core in `subagent-runner.ts` (`tryRunner`, `runSubagentWithFallback`, `buildRunnerArtifact`, fallback-order and rate-limit detection) via a `kind` parameter — no duplicated spawn/fallback logic.
- Runner fallback order and cross-model behavior are identical to `subagent-review`'s existing contract (try preferred `--subagent` first, then other programmatic runners in stable order, honest `skipped` if none available).

## Red

- Write a failing test that `write-subagent-refactor-review` persists a prompt file and records its path in ticket state.
- Write a failing test that `subagent-refactor-review` without `--subagent` is a state recorder only (no runner invoked).
- Write a failing test that `subagent-refactor-review --subagent <runner>` invokes the generic runner core with the refactor prompt bytes and writes the ledger artifact.
- Write a failing test that a worktree file write during the runner's execution flips the outcome to `skipped`/`advisory_violation` (reuse of the existing advisory-only contract test pattern).
- Write a failing test that `record-deferred --reason` appends a `deferred` row.
- Write a failing test that `reconcile-subagent-refactor-review` blocks on the Condition A/B analogs from ticket 20.01 and passes when satisfied.
- Run the targeted tests and confirm they fail before implementation.
- Commit with suffix `[red]`: `test(P20.02): cover refactor-review CLI commands [red]`
- Do not write any implementation until this commit exists on the branch.

## Green

- Add the four new `case` blocks to `cli-runner.ts`, modeled directly on the existing `write-subagent-adversarial-review`, `subagent-review`, `subagent-review record-deferred`, and `reconcile-subagent-review` blocks, but calling ticket 20.01's refactor-specific parser/reconciliation functions and the generic runner core with a `kind: 'refactor'`-equivalent parameter.
- Add path-suffix helpers (or extend existing ones with a parameter) for `-refactor-review.{prompt.md,report.md,ledger.json}`, analogous to `deriveSubagentReviewOutcomePath`/`writeSubagentReviewOutcome`.
- Implement the smallest code that makes the new tests pass.

## Refactor

- If the generic runner core's path-suffix helpers need a `kind` parameter added, do so without changing the adversarial gate's existing call sites' behavior (default/omitted `kind` must preserve current adversarial paths exactly — optional-DI extension rule from `delivery-orchestrator.md`).
- Do not add these commands to the `Commands` reference table in `delivery-orchestrator.md` yet — that lands in ticket 20.03 alongside gate placement, so the two land together as one coherent doc update.
- If this ticket moves tracked files to a new location: bump `SOA_TARGET_VERSION` in `scripts/soa-sync.sh` and add a `run_migration_N()` function that moves the files idempotently using `git mv`.

## Review Focus

- Confirm existing adversarial-gate tests still pass unmodified — the optional-DI extension rule means omitted `kind`/refactor-specific hooks must be no-ops for existing adversarial call sites.
- Confirm the advisory-only contract (no worktree writes) is enforced identically for the refactor runner as for the adversarial runner.
- Confirm `record-deferred` and reconciliation commands are runnable independently of `write-subagent-refactor-review` having been invoked with `--subagent` (state-recorder-only path).
- These commands are not yet wired into the gate sequence (that's ticket 20.03) — they should be independently invocable but not yet _required_ before `open-pr`.

## Rationale

> Append here (do not edit above) when behavior or trade-offs change during implementation.

Red first: [what test failed first]
Why this path: [why this implementation was the smallest acceptable]
Alternative considered: [one rejected alternative and why]
Deferred: [what was intentionally left out of this ticket]
Contract note: record any deviation from the ticket metadata contract here, including missing/incorrect `Type:` or non-compliant `Scope:` fields, and why it happened.
