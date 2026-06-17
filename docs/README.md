# Galley Docs

This is the routing index for Galley documentation. Start with the section that
matches who you are and what you are trying to do.

## Read By Role

| Role | Start Here |
|---|---|
| User evaluating Galley | [README](../README.md), then [architecture](./architecture.md) |
| Agent / Supervisor integrator | [Supervisor SOP](./integrations/galley-supervisor-sop.md), then [agent-api](./agent-api.md) |
| Contributor | [CONTRIBUTING](../CONTRIBUTING.md), then [engineering workflow](./engineering-workflow.md) |
| Maintainer | [project status](./project-status.md), [release / update SOP](./release-update-sop.md), [release workflow](./release-workflow.md), [GA baseline](./ga-baseline.md) |
| Historical reader | [devlog](./devlog/README.md) |
| Coding agent | [AGENTS.md](../AGENTS.md), then the focused docs below |

## Read By Task

| Task | Read First |
|---|---|
| Understand current project state | [project status](./project-status.md) |
| Understand the architecture | [architecture](./architecture.md) |
| Change product behavior or roadmap | [PRD](./PRD.md) |
| Change CLI output or Agent API | [agent-api](./agent-api.md) |
| Change Supervisor / Agent integration | [Supervisor SOP](./integrations/galley-supervisor-sop.md) |
| Plan or design Galley Native runtime | [Galley Native](./galley-native/README.md) |
| Work on Rust core refactor | [refactor README](./refactor/README.md) |
| Check architecture invariants | [architecture demo](./architecture-demo.md) |
| Prepare or update a release | [release / update SOP](./release-update-sop.md), then [release workflow](./release-workflow.md) |
| Close a long coding session or sync project knowledge | [session close SOP](./session-close-sop.md) |
| Smoke Windows builds | [Windows checklist](./windows-build-checklist.md) |
| Touch GenericAgent integration | [GA baseline](./ga-baseline.md) |
| Touch app packaging / runtime | [desktop runtime](./desktop-runtime.md) |
| Touch managed / bundled GA runtime | [managed GA runtime](./managed-ga-runtime.md) |
| Touch GUI or engineering workflow | [engineering workflow](./engineering-workflow.md) |
| Touch visual design | [DESIGN.md](./DESIGN.md) |
| Touch UI copy, terminology, or localization | [copy and language guidelines](./copy-language-guidelines.md), [copy austerity principles](./copy-austerity-principles.md) |
| Review product / UX audit findings | [audits](./audits/README.md) |
| Understand history or decisions | [devlog](./devlog/README.md) |

## Document Roles

- [AGENTS.md](../AGENTS.md): short startup constitution for coding agents.
- [CONTRIBUTING](../CONTRIBUTING.md): contributor entry point.
- [architecture](./architecture.md): external-facing system overview.
- [project status](./project-status.md): current milestone, release gates, and
  compact phase state.
- [PRD](./PRD.md): product definition and roadmap.
- [agent-api](./agent-api.md): stable CLI / socket contract for agents.
- [copy and language guidelines](./copy-language-guidelines.md): UI copy,
  terminology, and localization rules for Chinese and English.
- [copy austerity principles](./copy-austerity-principles.md): the voice rules
  for UI copy — a restrained, Wittgenstein-influenced austerity (how to say it,
  paired with the terminology rules above).
- [English copy draft](./english-copy-draft.md): review draft for native
  English UI copy before implementation.
- [audits](./audits/README.md): evidence-backed product, UX, accessibility, and
  workflow audits used as decision input.
- [managed GA runtime](./managed-ga-runtime.md): design target for Galley's
  bundled GenericAgent runtime, mode boundaries, prompt composition, model
  config, patch discipline, and state rules.
- [Galley Native](./galley-native/README.md): folder index for the native
  runtime charter, RFC set, parity scenario manifest, dogfood evidence, and
  implementation-slice plan.
- [architecture demo](./architecture-demo.md): code-level proof of the four
  architecture principles.
- [session close SOP](./session-close-sop.md): closeout and knowledge-sync
  checklist for long coding sessions.
- [release / update SOP](./release-update-sop.md): maintainer checklist for
  release day and updater channel promotion.
- [refactor](./refactor/README.md): B-phase implementation playbooks,
  invariants, and execution cursor.
- [devlog](./devlog/README.md): chronological decision history and rejected
  alternatives.

## Keep Docs Lean

Do not duplicate long history into task documents. Prefer:

- current rule in the focused document
- link to the devlog for why
- link to the playbook for how
- update `AGENTS.md` only for global rules every session must know
