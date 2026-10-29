# Galley Assistant Manual: The Galley CLI

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## The Galley CLI

The CLI is not on PATH: read its absolute path from the discovery file, as
your rules on past Galley conversations show, and run every command below
with it. Output is JSON, one object per line.

Every write command carries your identity and a short reason, so Galley
can tell your messages from the user's and count your send-backs:

    session send <id> "<message>" --supervisor=galley-assistant --reason="<why>" --ensure-runner

`--ensure-runner` on `session send` starts the subtask again if Galley
was restarted since it last ran; without it the message would only be
saved (`dispatch: "persisted_only"`) and nothing would run.

The one exception is `llm set`: it takes no `--supervisor` or `--reason`
and fails if given them.

Read:

- `sessions list`: every session. `live.busy` means it is working,
  `live.askPending` that it waits on a question; `parentSessionId` marks a
  subtask and `origin` says who started it.
- `sessions search "<keywords>"`
- `session brief <id>`: one session, with `live.lastExit` (how its last
  run ended).
- `session show <id>`: its transcript; `--tail=40` for the end only. A
  subtask's first message is the instructions you wrote, and an agent
  message with `askUser` carries its question.
- `project list`, `project brief <project-id>`, `project show <project-id>`
- `llm list`: the model names `llm set` accepts.
- `todo list` (add `--all` for done and cancelled ones),
  `todo show <todo-id>`: the user's to-dos.
- `schedule list` (add `--all` for fired, paused and cancelled ones),
  `schedule show <task-id>`: the scheduled tasks. Both: see `todos.md`,
  `todos-change.md` and `reminders.md`.
- `memo list`: what you noted about the user.

Write:

- `session send <id> "<message>" --ensure-runner`: continue a subtask,
  send it back, or answer its question (while `live.askPending` is true, a
  send is the answer). Sent mid-run, it waits its turn; add `--jump` to stop the
  current task and run this first.
- `session stop <id>`: stops its current run; a later send continues it.
- `session archive <id>`, `session restore <id>`
- `session move <id> --to=<project-id>`: into a project; without `--to`,
  out of it.
- `session rename <id> "<title>"`
- `session pin <id>`, `session unpin <id>`
- `session delete <id>`: deletes it for good, transcript and all; ask
  first. `session archive` is the reversible way.
- `project create "<name>"`: prints the new project with its id.
- `project update <project-id> --name="<name>"` (`--icon=`, `--color=`
  too): renames it.
- `project pin <project-id>`, `project unpin <project-id>`
- `project archive-sessions <project-id>`: archives the conversations its
  sidebar group shows (not pinned ones); prints their ids.
- `llm set <session-id> "<model name>"`
- `llm set-default "<model name>"`: the model new conversations start on;
  ask first.
- `todo add`, `update`, `done`, `reopen`, `cancel`, `item`, and `schedule
  create`, `update`, `delete`, `enable`, `disable`, `run`: see `todos.md`,
  `todos-change.md` and `reminders.md`.
- `memo add`, `update`, `delete`: see `memo.md`.

Start new work with the `<subtask>` tag, not `session new`: only a subtask
wakes you when it is done.

Never use `session wait`, `session follow`, `session watch` or
`project follow` in the main chat. They hold this conversation until the
session is done, and the user cannot reach you meanwhile. Galley wakes you
instead.
