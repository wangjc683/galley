# Galley Native RFC 5: Workspace And Session Continuity

> Status: draft decision document.
>
> Scope: native Project workspace binding, file/code default roots, file
> mentions, session restore, occupancy, continue/copy policy, and Supervisor
> follow-ups. This RFC does not implement storage, schema, or runtime behavior.

## Decision

`galley_native` should make Project workspace and session continuity first-class
Core concepts, but only for the native runtime.

A Galley Project may optionally bind one primary workspace. Native file/code
tools can use that workspace as their default work root and file-index source.
This binding must not affect `managed` or `external` GenericAgent sessions.

Session continuity should be Core-owned:

- session history persists in Galley;
- runtime occupancy is tracked by Galley;
- "continue original" and "copy and continue" are explicit policies;
- native restore rebuilds runtime context from Galley state, not GA temp files.

## Why This Matters For Users

The user goal is simple: "come back later and keep working where we left off."

The product must handle the hidden complexity:

- whether the old runtime is still running;
- whether another Supervisor is already using the session;
- whether the workspace moved;
- whether the model changed;
- whether the task should continue in place or fork safely;
- whether native can inherit useful context without inheriting stale state.

Users should not need to understand cwd, GA temp files, session locks, or
provider history to continue work.

## Terms

| Term | Meaning |
|---|---|
| Project | Galley organizing container for sessions, Goals, memory, and optional workspace |
| Workspace | Optional filesystem root bound to a Project for native file/code work |
| Session | Persistent conversation and runtime state container |
| Runtime worker | Live execution owner for a session |
| Occupancy | Core-owned claim that a live worker or Supervisor is using a session |
| Continue original | Add a new turn to the same session |
| Copy and continue | Fork relevant context into a new session, then continue there |

## Project Workspace

V1 should support at most one primary workspace per Project.

Rules:

- workspace binding is optional;
- Projects without a workspace remain valid;
- workspace binding affects `galley_native` only;
- managed/external sessions keep their current cwd and GA state behavior;
- workspace path is Project metadata, not memory by itself;
- workspace facts become memory only after verified work.

Future multi-root support can come later. V1 should keep the mental model
simple: one Project, zero or one main workspace.

## Tool Root Policy

Native file/code tools should be workspace-aware, not workspace-imprisoned.

Recommended defaults:

| Case | Default tool root |
|---|---|
| Project has workspace | workspace path |
| Project has no workspace | session scratch directory |
| No Project | session scratch directory |
| Explicit absolute path | allowed only if policy permits |

This avoids the old all-runtime cwd coupling while still making ordinary repo
work ergonomic.

`code_run` should receive an explicit cwd decision from the runtime. It should
not depend on process-global cwd mutation.

## Session Scratch

Every native session should have a Galley-owned scratch area.

Use cases:

- temporary scripts;
- tool output captures;
- downloads created during browser/tool work;
- generated files before the user chooses a Project/workspace target;
- parity test fixtures.

Scratch is not durable memory. Useful artifacts can be moved or referenced, but
scratch contents should not silently become Project memory.

V1 must define a retention policy before implementation. The default should be
conservative: keep scratch while the session is active or recently recoverable,
then clean only Galley-owned scratch paths. Never clean a Project workspace path
through scratch retention logic.

## File Mentions

Native should support `@` file mentions against the active Project workspace.

V1 expectations:

- index workspace filenames and relevant metadata;
- let GUI autocomplete files when a Project workspace is bound;
- send file references as structured content blocks or stable resource
  pointers;
- do not paste full file contents into the prompt by default;
- support explicit file reads through `file_read`.

If no workspace is bound, file mentions can fall back to recent files or remain
disabled with a clear empty state.

## Workspace Errors

Workspace errors should guide action.

Examples:

- workspace path missing: offer to locate, remove binding, or continue without
  workspace;
- permission denied: explain which path failed and which action was blocked;
- workspace moved: keep session intact, mark workspace unavailable, do not
  guess a replacement;
- dirty repo or destructive command: route through approval policy.

Do not collapse these into generic tool failures.

## Session Snapshot

Native restore needs a runtime-neutral snapshot.

Conceptual fields:

```text
NativeSessionSnapshot
  session_id
  runtime_kind
  model_key
  project_id?
  workspace_path?
  messages
  tool_timeline
  working_checkpoint
  memory_refs
  capability_refs
  summary_chain
  pending_approval?
  pending_ask_user?
  occupancy_state
```

The snapshot is not one giant prompt. It is the source material for rebuilding a
compact prompt and loop state.

## Occupancy

Core should track live ownership of a session.

Occupancy record:

```text
session_id
runtime_kind
owner_kind: gui | cli | supervisor | goal_controller | native_worker
owner_id
started_at
heartbeat_at
state: starting | running | waiting_approval | waiting_user | draining
```

If heartbeat expires, the session becomes recoverable. Recovery should not
delete history or memory candidates.

## Continue Policy

Recommended default policy:

| Situation | Policy |
|---|---|
| Session idle and same runtime | continue original |
| Session running or occupied | copy and continue |
| Session waiting approval/user input | continue original by answering pending item |
| Runtime crashed but session recoverable | continue original with recovery event |
| Switching managed/external to native | copy to native |
| Project workspace changed since session start | ask or copy with new workspace |
| Session archived | copy and continue unless explicitly unarchived |

"Copy to native" is important: migrating a session should not rewrite history
or pretend old GA runtime state was native state.

## Copy And Continue

Copying should preserve useful context without duplicating volatile state.

Copy:

- user-visible messages;
- turn summaries;
- selected final/tool results needed for context;
- Project association;
- relevant memory/capability references;
- selected model if compatible.

Do not copy:

- pending approvals;
- pending ask-user state;
- tool subprocess handles;
- runtime worker ids;
- Goal task ids;
- temporary scratch files unless explicitly attached.

The copied session should say it was continued from another session so users
can navigate back.

## Native Restore

Restore path:

1. Load session snapshot from Galley storage.
2. Validate Project workspace and capability availability.
3. Build compact prompt from summaries, current user follow-up, memory pointers,
   and relevant file references.
4. Start a native runtime worker.
5. Emit a restore/recovered event when relevant.

Native should not require provider-native conversation history to restore. Model
adapters can use provider history where useful, but Core state is authoritative.

## Supervisor Follow-Ups

Supervisor agents use the same policy as GUI users.

Rules:

- `session send` should route by session runtime kind;
- if a Supervisor writes into an occupied session, Core either rejects with a
  clear reason or creates/uses copy-and-continue according to command semantics;
- supervisor origin metadata remains persisted;
- hidden internal Goal planning messages do not appear in normal session
  continuation unless explicitly included by Goal context.

This keeps CLI automation reliable without inventing a separate continuity
model for agents.

## Migration From Managed

Existing managed sessions should stay managed.

Possible user action:

```text
Continue with Galley Native
```

This creates a native copy using visible history, summaries, and optional
managed-memory import candidates. It does not mutate the managed session or
managed GA state.

## UI Expectations

Main UI should stay simple:

- Project workspace appears in Project settings, not first-run onboarding.
- Session surfaces show recover/continue/copy choices only when they matter.
- A running or occupied session should make "why can't I type here?" obvious.
- Workspace missing should offer concrete next actions.
- Copy-and-continue should be visible in history, not a silent fork.

Users should feel continuity, not learn session-state theory.

## Acceptance Checks Before Code

Before implementation, the design should answer:

- Where is Project workspace stored?
- How does native choose cwd for `code_run`?
- How do `file_read` and `file_patch` enforce workspace policy?
- How does `@` mention index refresh work?
- What exact states count as occupied?
- What socket/CLI behavior happens when sending to an occupied session?
- What is copied when moving a managed session to native?
- How does restore work after app restart or worker crash?
- What is the retention and cleanup policy for native session scratch?

## Rejected Alternatives

### Bind Project Workspace To All Runtimes

Rejected because Galley already learned that global cwd coupling creates GA
memory/state bugs. Workspace binding is native-only.

### Continue Every Session In Place

Rejected because concurrent workers and Supervisors can corrupt conversational
state. Occupied sessions need explicit copy or rejection policy.

### Depend On Provider History For Restore

Rejected because Core is authoritative. Provider history is an adapter detail,
not the source of session continuity.

### Auto-Import Managed State During Continue

Rejected because migration should be intentional and copy-based. Native should
not silently consume or rewrite managed GA memory.
