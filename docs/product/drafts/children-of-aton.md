# Children-of-Aton — v2 Vision Draft

_Drafted: 2026-05-09_
_Status: Pre-planning draft — not yet through `/soa plan`_

---

## Thesis

Son-of-Anton for teams. Same ethos, parallel execution.

SoA proved the model: three gates, adversarial review, retrospectives, agent-agnostic delivery. Everything between the gates is owned by the orchestrator. The solo-developer constraint is not a design principle — it's an implementation simplicity choice. Children-of-Aton lifts that constraint without compromising the gates.

---

## What Doesn't Change

The ethos is non-negotiable. Any v2 that trades quality gates for throughput is just Symphony with a different name.

- **Gate 1 — Plan the WHAT.** Mandatory. grill-me still runs. No tickets without an approved product plan.
- **Gate 2 — Decompose the HOW.** Mandatory. Ticket decomposition still requires human approval before any agent touches code.
- **Gate 3 — Review the STACK.** Mandatory. Stacked PRs still require human closeout. Nothing merges without a person deciding it merges.
- **Adversarial review per ticket.** Non-negotiable. This is the primary quality differentiator versus Symphony and everything else. At scale, this becomes more important, not less.
- **Retrospectives.** Per-phase, structured. Institutional memory is a team asset.
- **Agent-agnostic skill layer.** `.agents/skills/` + `AGENTS.md` stays universal. The team chooses their agent; the orchestrator doesn't care.

---

## What Changes

### 1. Sequential Worktree → Worktree Pool

SoA runs one ticket at a time. Children-of-Aton manages a pool of concurrent worktrees, each running an independent agent session on an independent ticket.

The coordinator:

- Maintains a dependency graph across the ticket set for the phase
- Assigns tickets to available worktree slots only when all declared blockers are merged
- Enforces concurrency caps (global and per-phase) so the repo isn't overwhelmed
- Handles stall detection and retry without developer intervention

Dependency declaration stays in the ticket files — same format, same skill layer. The coordinator reads them; agents don't need to know about parallelism.

### 2. Local Markdown State → GitHub Issues as Shared State

Today's `state.json` and handoff files are local — one developer reads them on one machine. For async teams this breaks immediately.

**GitHub Issues is the shared state layer.** Each ticket in the delivery plan maps to a GitHub Issue. The issue is the workpad: the agent updates it in-place with progress, blockers, and handoff notes. Any team member can see where every ticket is without reading a file or asking in chat.

Issue label set drives the ticket state machine:

```
soa:ready → soa:in-progress → soa:review → soa:merged
                          ↘ soa:rework → soa:in-progress
```

The coordinator polls the label state, same polling model as Symphony's Linear integration — but GitHub Issues, not Linear, so no external tracker dependency for teams already on GitHub.

`state.json` becomes a local cache/lock file only. Source of truth moves to the issue.

### 3. Single Approver → Role Model

The three gates map to roles, not one person:

| Gate              | Role                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Plan the WHAT     | Product owner / tech lead approves `docs/product/plans/phase-N.md` |
| Decompose the HOW | Tech lead approves ticket list before implementation               |
| Review the STACK  | Reviewer approves stacked PRs; tech lead runs closeout             |

The orchestrator enforces that no gate opens without the required label or approval on the GitHub Issue / PR. Role assignments are configurable in `orchestrator.config.json`.

For solo developers: all roles collapse to one person. SoA behavior is preserved as the single-user mode.

### 4. Adversarial Review at Scale — Non-Blocking

The review gate must not become a bottleneck when 8 tickets are in flight simultaneously. The design constraint: review is mandatory but never blocks the coordinator from advancing other tickets.

Options (to be decided at `/soa plan` time):

- **Async queue:** adversarial review runs in parallel with the next ticket's implementation; findings surface to the developer's attention queue (GitHub Issue comment, notification)
- **Parallel reviewer pool:** a separate pool of review agent sessions runs concurrently with implementation sessions, capped independently
- **Batch review at gate 3:** reviews accumulate per-ticket but gate 3 (closeout) is where the human actually reads them — the review subagent runs immediately after each ticket completes, but the developer reads all findings at once during stack review

The ethos constraint: findings are never suppressed. The human decides what to act on. The throughput optimization is in _when_ the human reads the findings, not in _whether_ they are produced.

### 5. Handoff Files → Structured Async Communication

Today's handoff is a markdown file the same developer reads 5 minutes later. For async teams it's a message someone reads tomorrow, possibly someone different.

Handoff content moves into the GitHub Issue body (updated by the agent as a living workpad). Structured sections:

- **What was done** — diff summary, key decisions
- **What's next** — next ticket or blocker
- **Open questions** — anything requiring human input before the next agent session
- **Review findings** — adversarial review output, with human action status

The issue body is the canonical handoff. The handoff file in `.agents/delivery/` becomes a local mirror only.

---

## Distribution Model

Children-of-Aton inherits the git subtree distribution. No daemon to deploy, no external service. The coordinator is a long-running script (Bun/Node), not an Elixir service — but the same `bun run deliver` entrypoint.

For teams: the coordinator runs on whoever's machine is "driving" the phase, or in a CI environment (GitHub Actions job that polls and dispatches). The latter is the team-scale target: the coordinator becomes a workflow that runs on a schedule or on-push, dispatching agent sessions to available runners.

---

## GitHub Actions Integration Path

The natural team-scale deployment:

```yaml
# .github/workflows/deliver.yml
on:
  schedule: [cron: '*/5 * * * *']
  workflow_dispatch:
jobs:
  deliver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun run deliver --phase phase-N --ci
```

The coordinator in CI mode: polls GitHub Issues for the phase's label state, dispatches agent sessions on available runners, posts progress back to issues. No human machine required.

This is the async team model: engineers write tickets (gate 2), the CI coordinator runs agents overnight, engineers review findings and PRs in the morning (gate 3).

---

## Open Questions (for `/soa plan`)

1. **GitHub Issues vs. tracker-agnostic interface?** GitHub Issues is the right default for teams already there. But the integration layer should be pluggable — Linear, Jira, and plain-markdown (SoA v1 compatibility) as alternatives. How much abstraction is justified at v1 of children-of-aton?

2. **Worktree pool size in CI.** GitHub Actions runners are ephemeral. Each agent session needs a fresh checkout. Is the worktree pool model still the right primitive in CI, or does it collapse to stateless per-job invocations?

3. **Role enforcement strictness.** Should the orchestrator hard-block if the wrong role tries to approve? Or advisory only (label-based, honor system)?

4. **Review queue design.** Async queue vs. parallel pool vs. batch-at-gate-3? Each has different UX and cost implications. Needs a decision before implementation.

5. **Backwards compatibility.** SoA v1 (solo, sequential, no GitHub Issues) should remain a supported mode. Children-of-Aton is additive — it doesn't break existing SoA installs. How is this enforced in `orchestrator.config.json`?

6. **Name.** Children-of-Aton is evocative and on-brand. Is it the product name or the internal codename? The README should probably say "Son-of-Anton for teams" in plain English.

---

## Positioning vs. Symphony

Symphony solves throughput for teams using Codex + Linear. Children-of-Aton solves **quality + throughput** for teams using any agent + GitHub. The adversarial review gate and the three-gate planning model are the differentiation. Symphony is a fleet manager; children-of-aton is a delivery discipline that scales.

The target customer Symphony is missing: a team that doesn't want to pre-write all tickets in a tracker before the agent touches anything. The grill-me + decompose gates are what prevent that.

---

> Next step: `/soa plan docs/product/drafts/children-of-aton.md`
