# Galley Audits

This folder keeps product, UX, accessibility, and workflow audits that are
evidence-backed but not themselves product specs. Treat these reports as
decision input: active rules belong in focused docs such as `DESIGN.md`,
`agent-api.md`, or `architecture.md`; rationale and rejected alternatives belong
in `docs/devlog/`.

Evidence screenshots follow the binary-asset policy in the
[screenshot playbook](../screenshot-playbook.md): only images the report
actually cites, downscaled or JPEG-compressed before commit, and no
rejected-attempt captures in the repo.

## Available Audits

| Date | Audit | Use When |
|---|---|---|
| 2026-06-16 | [Product Design flow audit](./product-design-flow-audit-2026-06-16/README.md) | Reviewing operator flow, TopBar state visibility, Models, Browser Control privacy copy, Sidebar status scanning, Project Review, or onboarding priorities |
| 2026-07-02 | [Codebase review](./codebase-review-2026-07-02/README.md) | Fixing correctness/robustness findings across gui/core/cli/runner; tracking fix status per finding ID; planning failure-path test coverage |
| 2026-07-04 | [Concurrency-blocking audit](./concurrency-audit-2026-07-04/README.md) | Checking lock discipline, pipe draining, channel backpressure, DB write contention, or timeout coverage in core/cli; tracking CONC-* fix status; writing concurrency regression tests |
