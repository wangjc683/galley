# Agent API — Deferred Additions & References

> Part of the [Galley Agent API](./README.md) contract. Deferred v1 additions, the `GalleyApi` trait surface, transport notes, and see-also references.

## 8 · Deferred v1 Additions

The following are intentionally **not in the current CLI surface yet** —
mentioned here so SOPs can plan their integration shape. Additions will be
non-breaking inside `schemaVersion: 1` per §7.

- `galley session kill <id>` — runner Shutdown (vs `session stop` which
  Aborts the turn but keeps the bridge alive). Deferred to a future release,
  pending dogfood evidence that bridge-wedge cases are common enough
  to warrant a destructive surface ([B4 M1 sub-plan O6](../archive/refactor/B4-M1-sub-plan.md)).
- `galley project archive <id>` — true reversible archive (current
  `project delete` is destructive; a future schema can add an
  `archived_at` column and ship this as a separate command without
  changing the existing `delete` semantics — sub-plan O2). Not the same
  as `project archive-sessions` (2026-10-16, §5.16c), which archives a
  project's conversations and keeps the project.
- `galley session watch <id> --from=<event-index>` — backlog/resume
  support for supervisors reconnecting after a network blip (B2 N35).
- `galley llm warmup <id>` — explicit "spawn a bridge so the external
  `llm list` cache fills" command, for SOPs that don't want to rely on the
  GUI having been opened. (Managed `llm list` reads the model store and
  needs no warmup.)

Future human/Supervisor-facing session and project write commands should accept
`--supervisor=<x>` / `--reason=<y>` flags following the same Origin convention
`session send` uses today (§5.5a). Read commands stay flag-light.

### 8A · `GalleyApi` trait surface (B3 M4a)

The full session/project CRUD trait landed in B3 M4a as the
authoritative write path. **B4 M1 minted CLI subcommands for the
supervisor-facing subset** (`session new / archive / restore / move`,
`project create / list / delete`, `llm set` — see §5.8-§5.18). Main chat
ticket 35 (2026-10-16) minted the next ones, for the assistant that runs
Galley on the user's behalf: `session rename / pin / unpin / delete`
(`rename_session`, `set_session_pinned`, `delete_session`), `project
update / pin / unpin` (`update_project`), `project archive-sessions` (the
desktop's 「归档全部对话」) and `llm set-default` (§5.13a–c, §5.16a–c,
§5.18a). The rest of the table stays trait-only: the GUI invokes it
through direct interactions (bulk via multi-select, unread marks) and no
SOP-driven scenario needs it outside the GUI; it gets minted additively
when one does.

Trait signatures (Rust types):

| Method | Args | Returns |
|---|---|---|
| `create_session` | `CreateSessionInput`, `Origin` | `SessionBrief` |
| `archive_session` | `SessionId`, `Origin` | `SessionBrief` |
| `unarchive_session` | `SessionId`, `Origin` | `SessionBrief` |
| `rename_session` | `SessionId`, `title: String`, `Origin` | `SessionBrief` |
| `set_session_pinned` | `SessionId`, `pinned: bool`, `Origin` | `SessionBrief` |
| `delete_session` | `SessionId`, `Origin` | `()` |
| `assign_session_to_project` | `SessionId`, `Option<String>`, `Origin` | `SessionBrief` |
| `set_session_llm` | `SessionId`, `index: Option<u32>`, `key: Option<String>`, `display_name: Option<String>` | `SessionBrief` |
| `bump_session_after_turn` | `SessionId`, `Option<String>`, `Option<u32>`, `mark_unread: bool` | `SessionBrief` (Core-internal since 2026-10-07: called by Core's turn persistence, no Tauri command) |
| `mark_session_unread` | `SessionId` | `()` |
| `clear_session_unread` | `SessionId` | `()` |
| `bulk_archive_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `bulk_unarchive_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `bulk_delete_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `list_projects` | — | `Vec<ProjectBrief>` |
| `create_project` | `CreateProjectInput`, `Origin` | `ProjectBrief` |
| `update_project` | `ProjectId`, `ProjectPatch`, `Origin` | `ProjectBrief` |
| `delete_project` | `ProjectId`, `Origin` | `()` |

Goal methods removed 2026-10-13 ([devlog](../devlog/2026-10-13-remove-goal.md)).

Input types (camelCase on the JSON wire):

- `CreateSessionInput { id, title, projectId?, selectedLlmIndex?, selectedLlmKey?, selectedLlmDisplayName?, gaRuntimeKind?, gaRuntimeId?, promptProfile? }`
  — `id` is caller-assigned (`s-<base36>-<rand>` convention; conflicts
  surface as `invalid_args`).
- `CreateProjectInput { id, name, rootPath?, workspaceEnabled?, icon?, color? }` —
  same id-assigned-by-caller convention (`proj_<random16>`).
- `ProjectPatch { name?, rootPath??, workspaceEnabled?, icon??, color??, pinned? }` —
  the `?` (Option) means "leave the column alone"; the `??`
  (double-Option) on `rootPath` / `icon` / `color` means
  `Some(None)` clears the column to SQL NULL while `Some(Some(v))`
  writes `v`.

Error categories (all map to the §3 exit codes):

- `not_found` — session or project id doesn't exist.
- `invalid_args` — empty title / name after trim, id conflict, archived
  session pin attempt, FK violation (project_id pointing at nothing).
- `db_unavailable` — DB pool can't open.

### Transport notes

For the **transport**: the read commands' direct-SQLite path is a B1
convenience kept for "Galley Core not running" scenarios (snapshot
inspection, CI). The write commands' socket path is the eventual
canonical path for everything; B4 may consolidate read commands onto
it too once daemon mode is the dogfood baseline.

## 9 · See also

- [PRD §11 Agent / CLI surface](../PRD.md) — design rationale.
- [IPC protocol](../ipc-protocol.md) — wire format for the runner ↔
  Galley Core stdin/stdout channel + the socket transport this
  document layers on top.
- [B1 playbook](../archive/refactor/B1-rust-core.md) — read-command rollout.
- [B2 playbook](../archive/refactor/B2-bridge-ownership.md) — socket + first
  write commands (`session send / watch`) rollout, complete.
- [B4 playbook](../archive/refactor/B4-cli-bg-artifact.md) — remaining write
  commands (M1), supervisor surface (M3 / M4 / M5), schema freeze
  (M6).
- [Refactor invariants](../archive/refactor/invariants.md) — including §I5
  (API surface single source of truth) which makes this CLI's output
  the same source as the Tauri-invoke output the GUI sees, and §I3
  (migration numbering).
- Source for the trait + Origin type:
  [`core/src/api.rs`](../../core/src/api.rs) /
  [`core/src/api/origin.rs`](../../core/src/api/origin.rs).
