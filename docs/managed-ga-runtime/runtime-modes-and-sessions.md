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

`sessions search` and `llm list` should become runtime-aware before release if
we expose them prominently to supervisors. They are not part of the first
invisible-session prevention slice because they do not create work.

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
