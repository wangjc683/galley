# Galley Agent API

The contract between **Galley** and any agent that drives it via the
`galley` CLI binary or the Unix-socket / named-pipe local transport.

> **Status: `schemaVersion: 1` is frozen for the `v0.2.x` line.**
> The commands documented in §5 are wired, tested, and locked. Inside
> `schemaVersion: 1` the rules in §1 hold: additive commands, flags,
> and optional fields are non-breaking; renames / removals require a
> `schemaVersion: 2` bump.

**This directory is a public contract.** Every command name, JSON field,
exit code, and error identifier in these files is load-bearing for
downstream supervisor agents and SOPs — see
[AGENTS.md "CLI Surface Is Public Contract"](../../AGENTS.md).

This document was split into topic files on 2026-07-04. Section numbers
(§1–§9) are preserved from the original single document.

## Routing

| File | Original sections | Covers |
|---|---|---|
| [stability-and-versioning.md](./stability-and-versioning.md) | §1, §7 | Stability rules, stable identifier sets (error discriminants, status enums, `dispatch` / `stream.reason` values), schema pinning, versioning policy |
| [transports.md](./transports.md) | §2, §2A | Database locations / `GALLEY_DB_PATH`, direct-SQLite vs local-socket transports, NDJSON wire format, wire-level error discriminants |
| [errors-and-exit-codes.md](./errors-and-exit-codes.md) | §3, §4, §6, §6A | Exit codes, output discipline, CLI + socket error envelopes, shared `Origin` type |
| [session-commands.md](./session-commands.md) | §5.1–§5.13 | `version`, `status`, `health`, `sessions list / search`, `session brief / show / send / watch / follow / wait / new / btw / stop / archive / restore / move` |
| [project-and-llm-commands.md](./project-and-llm-commands.md) | §5.14–§5.18 | `project create / list / brief / show / follow / delete`, `llm list / set` |
| [goal-commands.md](./goal-commands.md) | §5.19 | `goal propose / run / status / active / stop / task / event / deliverable` (Goal V1) |
| [roadmap-and-references.md](./roadmap-and-references.md) | §8, §8A, §9 | Deferred v1 additions, `GalleyApi` trait surface, transport notes, see-also references |
