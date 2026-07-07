# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. Galley is a **single-context** repo.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the domain glossary / ubiquitous language).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Note: Galley already keeps durable decision history in [devlog](../devlog/README.md) and architecture facts in [architecture.md](../architecture.md). Treat `docs/adr/` as the home for narrow, dated architectural decisions the skills record; don't duplicate what devlog already owns.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-<decision-slug>.md
│   └── 0002-<decision-slug>.md
├── core/     runner/     cli/     gui/     managed-ga/
└── docs/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids. This reinforces the existing naming rules in [AGENTS.md](../../AGENTS.md) ("Names And Terms") and the [copy-language-guidelines](../copy-language-guidelines.md).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_
