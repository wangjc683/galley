# Galley Docs

This is the routing index for Galley documentation, and the **single source of
truth** for what to read when. `AGENTS.md` carries only the highest-frequency
subset of the task table below; when the two disagree, this index wins and
`AGENTS.md` needs the fix.

## Read By Role

| Role | Start Here |
|---|---|
| User evaluating Galley | [README](../README.md), then [architecture](./architecture.md) |
| Agent / Supervisor integrator | [Supervisor SOP](./integrations/galley-supervisor-sop.md), then [Supervisor reference](./integrations/galley-supervisor-reference.md) or [agent-api](./agent-api/README.md) |
| Contributor | [CONTRIBUTING](../CONTRIBUTING.md), then [engineering workflow](./engineering-workflow.md) |
| Maintainer | [project status](./project-status.md), [release / update SOP](./release-update-sop.md), [release workflow](./release-workflow.md), [GA baseline](./ga-baseline.md) |
| Historical reader | [devlog](./devlog/README.md), then [archive](./archive/README.md) |
| Coding agent | [AGENTS.md](../AGENTS.md), then the focused docs below |

## Read By Task

| Task | Read First |
|---|---|
| Understand current project state | [project status](./project-status.md) — current version, release gates, phase state |
| Understand the architecture | [architecture](./architecture.md) — external-facing system overview |
| Change product behavior or roadmap | [PRD](./PRD.md) — product definition and roadmap |
| Change CLI output or Agent API | [agent-api](./agent-api/README.md) — stable CLI / socket contract; v1 is frozen, additive-only |
| Change the Core ↔ runner wire protocol | [IPC protocol](./ipc-protocol.md) — change docs first, then code |
| Change Supervisor / Agent integration | [Supervisor SOP](./integrations/galley-supervisor-sop.md), then [Supervisor reference](./integrations/galley-supervisor-reference.md) |
| Plan or design Galley Native runtime | [Galley Native](./galley-native/README.md) — charter, RFC set, implementation slices |
| Check architecture invariants | [architecture demo](./architecture-demo.md) — code-level proofs and grep gates; hard engineering invariants (I3/I5/I6/I9/I11) are in [engineering workflow](./engineering-workflow.md) |
| Prepare or update a release | [release / update SOP](./release-update-sop.md) (runbook), then [release workflow](./release-workflow.md) (background) |
| Write GitHub Release notes | [release notes guide](./release-notes-guide.md) — writing rules and bilingual templates |
| Close a long coding session or sync project knowledge | [session close SOP](./session-close-sop.md) |
| Smoke Windows builds | [Windows checklist](./windows-build-checklist.md) |
| Touch GenericAgent integration | [GA baseline](./ga-baseline.md) — pinned upstream compatibility |
| Touch app packaging / runtime | [desktop runtime](./desktop-runtime.md) |
| Touch managed / bundled GA runtime | [managed GA runtime](./managed-ga-runtime/README.md) — mode boundaries, patch discipline, state rules |
| Touch GUI or engineering workflow | [engineering workflow](./engineering-workflow.md) — conventions plus hard invariants |
| Touch visual design | [DESIGN.md](./design/README.md) |
| Look up domain vocabulary (turn numbering, seams, protocol terms) | [CONTEXT.md](../CONTEXT.md) — the ubiquitous-language glossary; engineering skills read it before exploring |
| Check whether a refactor direction was already decided against | [ADRs](./adr/) — accepted architecture decisions; reviews must not re-litigate them |
| Track issues / PRDs for an in-flight feature | [issue tracker](./agents/issue-tracker.md) — local markdown under `.scratch/`, triage states in [triage labels](./agents/triage-labels.md) |
| Grow the domain model (glossary + ADRs) | [domain](./agents/domain.md) — how CONTEXT.md and `docs/adr/` are maintained |
| Understand or change Galley's temperament / brand character | [temperament charter](./temperament.md) — the "why" above the execution specs |
| Touch UI copy, terminology, or localization | [copy and language guidelines](./copy-language-guidelines.md) (what to call things), [copy austerity principles](./copy-austerity-principles.md) (how to say it) |
| Touch conversation text rendering / CJK typography | [typography principles](./typography-principles.md) — render-only red line |
| Reshoot README screenshots / demo assets | [screenshot playbook](./screenshot-playbook.md) — includes the binary-asset policy |
| Review product / UX audit findings | [audits](./audits/README.md) — evidence-backed decision input, not specs |
| Understand history or decisions | [devlog](./devlog/README.md) — chronological decision provenance |
| Dig into completed-mission docs (B-phase refactor, old drafts, handoffs) | [archive](./archive/README.md) |

## Lifecycle

Status is encoded by location, not per-file headers:

- `docs/archive/**` — **archived**. Mission complete; kept verbatim for
  provenance. Never a current rule.
- `docs/devlog/**` — **historical by definition**. Dated decision narrative;
  entries are never rewritten, only superseded by newer entries.
- Everything else under `docs/` — **living**. Current rules and references,
  expected to be accurate today.

To archive a doc: pull any still-binding rules into a living doc, `git mv` the
file into `docs/archive/`, add a short `> **ARCHIVED <date>**` banner saying
where the living rules went, and update the table in
[archive README](./archive/README.md).

When a living doc grows past what one session can afford to read (~1000
lines), split it into a directory with its own `README.md` routing index,
grouped by what a session typically needs together. The original path stays
behind as a redirect stub so external references keep resolving. Current
stubs: `docs/DESIGN.md`, [docs/agent-api.md](./agent-api.md),
[docs/managed-ga-runtime.md](./managed-ga-runtime.md).

## Update Triggers

Living docs drift when nothing says who updates them and when. One table,
one trigger event per doc — if you just did the event in the left column,
the doc on the right is part of your change, not a follow-up:

| When you… | You must update |
|---|---|
| Ship a release | [project status](./project-status.md) (already in the [release SOP](./release-update-sop.md)) |
| Upgrade the GA baseline | [GA baseline](./ga-baseline.md) + managed patch notes; audit starts at `runner/ga_session.py` |
| Change the Agent API or IPC protocol | [agent-api](./agent-api/README.md) / [IPC protocol](./ipc-protocol.md) **first**, then code (Rule 3) |
| Land a new seam, module, or pinned term | [CONTEXT.md](../CONTEXT.md); record rejected directions as [ADRs](./adr/) |
| Add a top-level module or cross-tier seam | [architecture](./architecture.md) + [architecture demo](./architecture-demo.md) (file + symbol refs, never line numbers) |
| Write a devlog entry | add its row to [devlog README](./devlog/README.md) in the same change |
| Change UI copy rules or visual specs | [copy guidelines](./copy-language-guidelines.md) / [design](./design/README.md) |
| Update the Supervisor SOP | re-sync the verbatim copy in `.claude/skills/galley-supervisor/references/` |

## Keep Docs Lean

Do not duplicate long history into task documents. Prefer:

- current rule in the focused document
- link to the devlog for why
- link to the playbook for how
- update `AGENTS.md` only for global rules every session must know
- this index is the only full routing table; do not grow parallel indexes

When adding a major new document: add one row to the task table above, and (only
if it is truly high-frequency) one row to `AGENTS.md`. Binary assets follow the
policy in [screenshot playbook](./screenshot-playbook.md).
