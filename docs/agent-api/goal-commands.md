# Agent API — Goal Commands (retired)

> Part of the [Galley Agent API](./README.md) contract. §5.19 is retired.

### 5.19 · `galley goal ...` — removed in `schemaVersion: 3`

Galley Goal was removed on 2026-10-13 ([devlog](../devlog/2026-10-13-remove-goal.md)). Every `goal`
command answers `unknown_command` under every pin, and the CLI has no `goal` subcommand any more:
`galley goal …` fails argument parsing with exit `2` (`invalid_args`). See
[stability §7.1](./stability-and-versioning.md) for what changed and how older pins are served.

There is no successor command. To get long work done, say what "done" looks like in the task itself
(`session new` / `session send`) and watch it with `session wait --until-idle` or `session follow`;
if a run stops early, send the next message on the same session.

The Goal v2 reference that lived here is in git history (last version at `e1125549`).
