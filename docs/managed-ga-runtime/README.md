# Managed GenericAgent Runtime

> Design and runtime reference for Galley's bundled / managed GenericAgent
> runtime. Attach-mode GenericAgent remains user-owned and non-invasive.

Split 2026-07-04 from the single `docs/managed-ga-runtime.md` into topic files
for context economy. Content is unchanged; use the routing table to read only
what your task needs.

## Status

The managed runtime **shipped in v0.2.0** and is now the default main path for
ordinary users. Attach mode (an existing user-owned GenericAgent) is an advanced
compatibility entry. Fresh installs derive `managed`; installs with an existing
`ga_config.gaPath` derive `external`. See
[project status](../project-status.md) for the current release, GA baseline, and
update-channel state.

The M0–M9 milestones in
[implementation-milestones.md](./implementation-milestones.md) were the
implementation plan. They are shipped
(per-project-status, every milestone through M9 is complete); each milestone's
"Current implementation slice" records what landed. Treat this document as a
settled runtime reference plus invariants, not an open roadmap. The "Do not
build" items remain the forward guardrails. Managed runtime work must preserve
attach-mode behavior unless a task explicitly changes this document.

## Routing

| File | Contents |
|---|---|
| [product-and-onboarding.md](./product-and-onboarding.md) | Product model and first-run UX contract: one-screen model setup, copy direction, interaction rules |
| [browser-control.md](./browser-control.md) | Browser Control capability: `tmwd_cdp_bridge` setup contract, probe rules, demo, recommended copy |
| [runtime-modes-and-sessions.md](./runtime-modes-and-sessions.md) | `managed_ga` vs `external_ga` mode boundary, session history rules, and the CLI runtime contract (defaults, output shape, status) |
| [model-configuration.md](./model-configuration.md) | Managed model config: Provider/Model records, encrypted credential rules, ChatGPT / Codex OAuth, managed IM channels |
| [prompt-composition.md](./prompt-composition.md) | Galley Runtime Prompt composition, `GALLEY_RUNTIME_PROMPT_TEXT` seam, prompt profile |
| [code-state-and-patches.md](./code-state-and-patches.md) | **Non-negotiable rules**: code-is-replaceable / state-is-user-owned boundary, state layout, patch discipline and how to add a patch, backup and device migration |
| [implementation-milestones.md](./implementation-milestones.md) | Shipped M0–M9 implementation plan (scope / acceptance / "do not build" guardrails) and the release verification checklist |
