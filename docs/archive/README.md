# Archive

Docs in this folder have **completed their mission**. They are kept verbatim
for provenance — devlog entries, commit messages, and old playbooks link into
them — but nothing here is a current rule. Do not follow instructions found
in archived docs; current rules live in the focused docs indexed by
[docs/README.md](../README.md).

Lifecycle convention for the whole docs tree:

- `docs/archive/**` — archived. Historical record only.
- `docs/devlog/**` — historical by definition (dated decision narrative).
- Everything else under `docs/` — living: current rules and references.

A doc moves here when the work it drove is finished (a refactor shipped, a
draft got implemented, a one-off handoff was consumed). When archiving, pull
any still-binding rules out into a living doc first, then move the file with
`git mv` so history follows.

## Contents

| Archived | What it was | Where the living rules went |
|---|---|---|
| [refactor/](./refactor/README.md) | B-phase (B1–B4) refactor playbooks, sub-plans, and execution cursor; shipped as v0.2.0 on 2026-05-31 | Permanent invariants (I3, I5, I6, I9, I11) moved to [engineering workflow](../engineering-workflow.md); architecture proofs in [architecture demo](../architecture-demo.md) |
| [design-handoff/](./design-handoff/README.md) | One-time Claude Design mockup bundle that seeded the v0.1 GUI | Implemented in `gui/`; design rules live in [DESIGN.md](../DESIGN.md) |
| [english-copy-draft.md](./english-copy-draft.md) | Review draft for native English UI copy | Implemented; the live source is `gui/src/i18n/locales/en.ts`, voice rules in [copy austerity principles](../copy-austerity-principles.md) |
