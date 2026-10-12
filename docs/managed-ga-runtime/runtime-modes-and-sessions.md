# Managed Runtime: Runtime Modes, Session History, And CLI Contract

> Part of the [managed GA runtime reference](./README.md).

## Runtime Modes

Galley has two runtime modes.

```text
managed_ga
- Default path for new users.
- Galley owns the runtime code and model configuration.
- Galley may apply minimal managed-runtime patches.
- Galley Runtime Prompt applies.
- Sessions shown in the UI are managed-runtime sessions.

external_ga
- Advanced attach path for an existing user-owned GA checkout.
- User owns code, memory, SOP, skills, model config, venv, and behavior.
- Galley does not inject Galley prompt extensions or use Galley's model config.
- Sessions shown in the UI are external-runtime sessions.
```

Mode switching lives in Settings -> Runtime. Do not show a prominent runtime
toggle in the main workspace. The main UI does not need a managed-mode badge
because managed mode is the product default. When the user is in attach mode,
the sidebar should show a small "Existing GenericAgent" badge in a suitable
place and link to Settings -> Runtime.

When modes switch, the visible session list switches with the mode. This is
intentional: it reinforces that these are different agent kernels, not one
history with a different skin.

The first time a mode switch hides the previous mode's sessions, show a small
one-time explanation:

```text
Showing sessions for Existing GenericAgent. Galley sessions are still available
when you switch back.
```

### GenericAgent's Own Scheduler (`sche_tasks`)

GenericAgent ships an in-process scheduler (`agentmain.py --reflect
reflect/scheduler.py`, polling `sche_tasks/*.json`). Galley never starts it, in
either mode, and does not plan to host it (rejected in the
[scheduled tasks PRD](../../.scratch/scheduled-tasks/PRD.md): tasks hidden in
GA state, invisible to Galley's orchestration, unavailable in attach mode, no
Galley session per run; hosting it would also start GA's hub on TCP ports).

- **Managed mode:** `sche_tasks` files never fire. The scheduler resolves
  `sche_tasks/` next to the read-only code payload, not under
  `managed-ga-state/`, so copying a folder into the state root does nothing.
  The Galley Runtime Prompt tells the agent not to create these files
  ([prompt composition](./prompt-composition.md), Scheduled Tasks) because the
  seeded `scheduled_task_sop` still describes them.
- **Migrating from external GA:** recreate each task in Galley's scheduled
  tasks (sidebar「定时」/ "Scheduled": daily, chosen weekdays, or chosen days
  of the month; each run opens a new Galley session). GA's cooldown-based
  `weekly` / `monthly`, `once`, `every_Nh`, `every_Nd` and `max_delay_hours`
  have no exact equivalent. Alternatively keep running the external GA's own
  scheduler outside Galley: its port lock (127.0.0.1:45762) only guards
  against a second copy of `scheduler.py`; Galley's scheduler does not use it.
- **Not built:** importing `sche_tasks`, a `galley schedule` CLI, and non-LLM
  script tasks are parked in the [devlog deferred list](../devlog/deferred.md).

## Session History

Store sessions in the same Galley database, tagged by runtime kind, but display
only the current mode's sessions by default.

Suggested session metadata:

```text
ga_runtime_kind: managed | external
ga_runtime_id: string
prompt_profile: string | null
```

Rules:

- Creating a session snapshots the current runtime kind.
- Restoring a session uses the runtime kind it was created with.
- Changing the default runtime only affects new sessions.
- External sessions do not silently migrate to managed runtime.
- Managed sessions do not silently migrate to external runtime.
- A future "Copy to Galley runtime" action can explicitly duplicate selected
  external history into a managed session, but v1 should not auto-convert.

### Main Chat Segments

The managed runtime's main chat (`sessions.main_chat`, migration 044) is one
thread to the user and a series of **segments** to the model (ticket 03a,
`.scratch/main-chat/issues/03-segments-and-injection.md`;
`core/src/session_runner/segment.rs`). Every other session, and attach mode,
is unaffected.

- **Rule (deterministic)**: when the main chat has been idle for more than N
  hours, the next message starts a new segment. N is the hidden Core pref
  `main_chat_segment_idle_hours` (a JSON number, fractions allowed; default 4;
  no Settings UI; read on every judgement). Idle is measured from
  `sessions.last_activity_at`, which only a turn ending or a message being
  written moves. No cut while a run is going, while an `ask_user` question
  waits for its answer (live, or the latest reply ending on one), or when
  nothing has been written since the current segment began.
- **Recorded, not derived**: Core writes each boundary once, as the
  `turn_index` its first message gets (`main_chat_segments`, migration 046).
  Replay reads it back, so the runner restored after a Core restart gets
  exactly the segment the live runner had, and tuning N never moves a past
  boundary. Deriving boundaries from message times would re-cut history on
  every change of N, and could not tell an answer to a question from a new
  message after the fact.
- **Fresh context = fresh runner**: recording a boundary retires a live
  runner (quietly, like ensure's own restart); the next ensure spawns one
  with an empty GA history and a newly composed state block, including the
  ongoing-affairs list ([prompt composition](./prompt-composition.md#ongoing-affairs-main-chat-and-im-only)).
  A cold runner is given back only the current segment
  (`persisted_message_rows_from`); a segment with no reply yet needs no
  replay.
- **Where the rule runs**: in `ensure_session_runner` (the GUI opening the
  main chat, `/btw`) and in Core's send just before it persists the message.
  Opening the main chat after the gap records the boundary at the next
  message's `turn_index` before that message exists; it is the same
  boundary, since the gap only grows until the message comes. Socket
  `session send` and the queue drain dispatch to a live runner as before and
  never cut; a Goal persists its objective before its ensure, so a Goal on an
  idle main chat continues the current segment.
- **The database keeps everything**: messages are not touched, the desktop
  shows the whole thread, and there is no segment marker in the UI.
- **Earlier segments are looked up, not replayed** (ticket 03b): the main
  chat's state block says it is the main chat, gives its id and where the
  current segment begins (first `turnIndex`, local day), and sends the
  model to the Galley CLI for anything earlier — `sessions search`, then
  `session show <id> --around=<messageId>`, or a `--since` / `--until`
  window ([prompt composition](./prompt-composition.md#main-chat-main-chat-only),
  [session commands](../agent-api/session-commands.md) §5.3, §5.5).

## CLI Runtime Contract

Galley has not shipped a stable CLI release before managed runtime, so the CLI
can adopt the clean runtime contract from the start.

Rust Core owns a persisted current runtime:

```text
prefs.active_runtime_kind = managed | external
```

GUI mode switches update this value. CLI commands read it as their default
runtime context. If it has never been set, Galley derives the initial value
once:

```text
existing ga_config.gaPath -> external
otherwise                 -> managed
```

This preserves existing attach users after upgrade while making managed runtime
the default for fresh installs.

If the current runtime is not configured, CLI writes should fail with a specific
actionable error instead of falling back to another runtime:

```text
managed_model_not_configured # managed runtime has no usable model
managed_runtime_invalid      # managed runtime code/prompt layout is incomplete
ga_path_invalid              # external runtime path is invalid
runner_error                 # generic runtime setup incomplete
```

### Defaults

Session listing defaults to the current runtime:

```bash
galley sessions list
```

This is equivalent to:

```bash
--runtime=current
```

Explicit read scopes:

```bash
--runtime=current
--runtime=managed
--runtime=external
--runtime=all
```

`sessions search` and `llm list` take the same `--runtime` flag (default
`current`). `llm list` accepts one runtime only (`all` is refused): managed
lists the Galley model store `llm set` resolves against, external lists the
GUI's attached-GA warmup cache.

`session new` also defaults to the current runtime:

```bash
galley session new "task"
```

If the GUI currently shows Existing GenericAgent, this creates an external
session. If the GUI currently shows Galley, it creates a managed session. This
prevents the worst UX failure: an agent creates a session successfully, but the
user cannot see it in the current GUI mode.

Explicit cross-runtime creation is allowed only when requested:

```bash
galley session new "task" --runtime=managed
galley session new "task" --runtime=external
```

Supervisor SOPs should say: do not pass `--runtime` unless the user explicitly
asks to use another runtime. Let CLI follow the GUI's current mode.

### Existing Sessions

Commands that target an existing session id use that session's recorded runtime,
not the current runtime:

```bash
galley session send <id> "..."
galley session stop <id>
galley session archive <id>
galley session move <id> --to=<project-id>
galley llm set <id> "<llm-name>"
```

The session id is the user's explicit target. Dispatching by the session's own
runtime avoids accidentally applying managed model config to an external
session, or external GA config to a managed session.

### Output Shape

All session-facing CLI responses must include runtime metadata:

```json
{
  "runtimeKind": "managed",
  "runtimeLabel": "Galley"
}
```

```json
{
  "runtimeKind": "external",
  "runtimeLabel": "Attached GenericAgent"
}
```

If a command explicitly creates or mutates something in a non-current runtime,
the response should include a warning:

```json
{
  "warning": {
    "id": "non_current_runtime",
    "message": "session created outside the current GUI runtime",
    "currentRuntimeKind": "external",
    "requestedRuntimeKind": "managed"
  }
}
```

If GUI receives a non-current session-created event, it should show a small
toast that tells the user where the session went and how to see it.

### Status

`sessions list` defaults to current runtime only. `status` should still avoid
hiding active work in another runtime. It can return current runtime detail plus
aggregate counts for other runtimes:

```json
{
  "activeRuntimeKind": "external",
  "current": { "running": 1, "idle": 8 },
  "otherRuntimes": [
    { "runtimeKind": "managed", "running": 1, "idle": 3 }
  ]
}
```

Supervisor agents should summarize current runtime first. If another runtime has
running work, mention it briefly and ask whether to inspect that mode.
