# Galley Agent API

Split into topic files on 2026-07-04. This stub keeps the stable path;
the content now lives in [docs/agent-api/](./agent-api/README.md).

> **`schemaVersion: 1` is frozen for the `v0.2.x` line — additive-only.**
> Breaking changes require a `schemaVersion: 2` bump.

Section map (original § numbers preserved inside each file):

| Sections | File |
|---|---|
| §1 Stability, §7 Versioning | [agent-api/stability-and-versioning.md](./agent-api/stability-and-versioning.md) |
| §2 Where to find things, §2A Transports | [agent-api/transports.md](./agent-api/transports.md) |
| §3 Exit codes, §4 Output discipline, §6 Error envelope, §6A Shared types | [agent-api/errors-and-exit-codes.md](./agent-api/errors-and-exit-codes.md) |
| §5.1–§5.13 version / status / health / sessions | [agent-api/session-commands.md](./agent-api/session-commands.md) |
| §5.14–§5.18 project / llm | [agent-api/project-and-llm-commands.md](./agent-api/project-and-llm-commands.md) |
| §5.19 goal | [agent-api/goal-commands.md](./agent-api/goal-commands.md) |
| §8 Deferred additions, §8A trait surface, §9 See also | [agent-api/roadmap-and-references.md](./agent-api/roadmap-and-references.md) |
