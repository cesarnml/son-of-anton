# Review Gaps

This directory stores post-phase quality-control learning artifacts.

Use this scaffold after a phase is closed out and a small verified fix exposes
a review gap that should inform future planning or review prompts.

## Files

- `ledger.jsonl` is append-only. Each landed fix gets one JSON object line.
- `promotion-queue.md` collects candidates for later prompt or process
  promotion. Capture here does not edit the adversarial-review prompt directly.

## Classification

Record the narrowest honest gap class:

- `review-reachable` when a per-ticket reviewer could have caught the issue
  from the ticket spec and diff available at review time.
- `spec-gap` when the expected behavior was not specified clearly enough.
- `qa-gap` when the issue required experiential or manual verification outside
  the normal code-review surface.
- `completeness-gap` when delivered scope was valid but missed adjacent work.

When uncertain, avoid overstating review reachability. Record the ambiguity in
the ledger entry and route the learning conservatively.
