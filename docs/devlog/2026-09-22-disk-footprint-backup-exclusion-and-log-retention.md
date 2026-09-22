# Disk footprint: backup skips engine scratch, LLM logs get retention

Date: 2026-09-22
Status: implemented; unit-tested; awaiting JC desktop dogfood; unreleased
Related: [B4 M8 migration backup](./2026-05-20-b4-m8-migration-backup.md),
[code, state, and patches](../managed-ga-runtime/code-state-and-patches.md),
[desktop runtime](../desktop-runtime.md)

## Context

A Windows user asked whether "backups and cache" could follow the install
location, because both had filled the C: drive. Galley never writes next to
the installer; everything is under `%APPDATA%\app.galley` (Tauri
`app_config_dir` / `app_data_dir` both resolve to Roaming on Windows) plus
WebView2's own cache in `%LOCALAPPDATA%\app.galley\EBWebView`. The two
growth sources behind the report:

- `managed-ga-state/temp/model_responses/model_responses_<pid>.txt`: upstream
  `llmcore._write_llm_log` appends the **full prompt** (whole history) and
  the raw response of every LLM call. A long session therefore grows its
  log quadratically, and upstream never deletes a file. `/restore` and
  upstream's session picker only read the ten most recently modified files.
- `app.galley.backup.<ts>/` ×3: the B4 M8 pre-migration backup copied the
  whole data dir, `temp/` included, once per schema-bumping upgrade. On JC's
  Mac the three backups (27 / 27 / 30 MB) were 2.5× the live data dir.

Two side findings: Galley's layout created and reported a
`managed-ga-state/model_responses/` sibling that nothing wrote to (GA writes
under `temp/`), and the B4 M8 devlog's "never auto-delete backups" decision
had already been superseded in code by a three-copy retention cap.

## Decision

JC's ruling: do both cheap fixes now; do not record a "data location"
setting as deferred; the community reply is his.

1. **Backup excludes `managed-ga-state/temp/`.** The backup exists to roll
   back a botched schema migration; engine scratch is not on that path. The
   excluded dir is not created on the backup side either, so a restore
   starts with clean scratch. Everything else (DB, attachments, memory,
   model config) is still copied. Constant `BACKUP_EXCLUDED_DIRS` in
   `migration_backup.rs`.
2. **Startup retention for `model_responses_*.txt`: 30 days, then 500 MB.**
   Age pass first (anything older than 30 days goes regardless of size),
   then oldest-first until the survivors fit in 500 MB. Only files matching
   `model_responses_*.txt` are touched; the `session_names.json` sidecar and
   files the model dropped there with the dir as cwd stay. New module
   `model_responses_prune.rs`; wired in `app_setup::prune_engine_logs`
   after the duplicate-instance check and before
   `start_background_services`, so no bridge can be writing a log yet.
   Non-fatal; outcome goes to stderr like the backup gate.
3. **Layout fix.** `model_responses_dir` now points at
   `managed-ga-state/temp/model_responses` (what GA actually writes);
   diagnostics show the real path. The stale empty sibling dir on existing
   installs is left alone.

Attach mode: zero change. A user-owned GA checkout's `temp/` is Rule 1
territory and neither the backup nor the pruner ever sees it.

## Rejected

- **Data under the install directory** (the literal request). The NSIS
  `currentUser` default install dir is also on C:, so it only helps users
  who picked another drive; updates and uninstall rewrite that directory;
  and per-machine installs land in a non-writable Program Files.
- **A "data storage location" setting with a move wizard.** The real fix
  for the relocation ask, but it has to reach through every path resolver
  (`app_paths`, `managed_runtime`, browser-control, goal workspaces, the
  backup parent) and `tauri-plugin-sql`'s `sqlite:workbench.db`, which is
  bound to `app_config_dir`. Same risk class as changing the Tauri
  identifier (Rule 6). JC chose not to record it in deferred; a second
  report is the signal to revisit.
- **Trimming what GA logs** (response-only, or last turn only). `/restore`
  rebuilds history from the `<history>` block inside the logged prompt, so
  the prompt has to stay.
- **Pruning inside `ensure_layout`.** It runs on every session spawn and
  diagnostics call, while bridges are alive; a startup-only hook is the
  simpler no-live-writer guarantee.

## Verification

- `cargo test --workspace` (core), incl. new tests: exclusion copies
  `managed-ga-state/memory` and a foreign `other/temp` but not
  `managed-ga-state/temp`; backup end-to-end leaves scratch out and the live
  dir intact; pruner age/size passes, order, non-log files untouched,
  missing dir is a no-op.
- `cargo check --workspace`, clippy clean on touched files, rustfmt per file
  (core is not rustfmt-clean as a whole), `pnpm --dir gui typecheck`, the
  diagnostics fixture test, `git diff --check`.
- Desktop dogfood owed: launch, confirm the `[model-responses]` line in
  stderr and that Settings → Runtime shows the `temp/model_responses` path.

## Manual relief for the reporting user (until the next release)

Close Galley, delete `%APPDATA%\app.galley.backup.*` (migration safety nets
only), delete old files in `%APPDATA%\app.galley\managed-ga-state\temp\model_responses`
(cost: those sessions can no longer `/restore`). Moving the whole
`%APPDATA%\app.galley` to another drive behind an NTFS junction works for
the live data, but the next migration backup is still written beside the
junction on C:.
