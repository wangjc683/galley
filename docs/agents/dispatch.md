# Dispatch: main session and executor agents

How a main session hands tickets to background executor agents, each working in
its own git worktree, and takes the work back. Tickets themselves live in the
[issue tracker](./issue-tracker.md). A dispatch brief can say "read
`docs/agents/dispatch.md` first" instead of restating these rules.

## Roles

- **Main session**: discusses, writes tickets, dispatches, verifies, merges,
  commits.
- **Executor agent**: runs in the background, normally one ticket per
  worktree.
- One main session at a time. When more than one is open anyway, they share
  the in-flight limits below.

## Models and effort

- Pass both `model` and `effort` on every Agent call, read-only fact-checking
  agents (Explore) included. Omitting `model` inherits the parent's model; when
  the main session runs a more expensive model, that spends it on reading
  files and running gates.
- Start the Agent call's `description` with the ticket name, so the agent
  panel row says which ticket it is.
- Executor agents use `model: "opus"`.
- Effort has three levels:
  - `high`: mechanical tickets: locale changes whose copy is already fixed
    word for word, doc syncs, replacing items from a list, adding tests,
    running gates only.
  - `xhigh`: the default: logic, cross-layer changes, contracts, concurrency
    and timing.
  - `max`: only hard diagnoses that already got stuck once at `xhigh`.
- A fork always runs the parent's model. Keep forks for exploration or
  prototypes whose context is too large to write into a ticket.
- There is no separate review agent and no executor tier cheaper than Opus.

## Limits

- About 3 tickets in flight; at most 2 waiting on the user's dogfood; 1–2
  tickets compiling Rust at the same time.
- The bottleneck is the user's dogfood, not execution. When the queue is
  full, clear dogfood before dispatching more.

## What the main session does itself

- A change to one file, a few lines, that needs no second file read.
- When no discussion is in progress, small changes across 2–3 files too (the
  limit exists to keep the discussion unblocked).
- Everything else is dispatched.

## Ticket

The executor cannot see the conversation, so the ticket must stand on its own.
It has six parts:

1. Files to change
2. How to change them
3. Verification commands
4. What not to touch
5. Report format
6. Dogfood steps, in two columns: what the main session can verify for the
   user (CLI, database, logs, dev probes), and what only the user can verify
   (feel, temperament, look)

When writing a ticket:

- Interface contracts and final copy shared by parallel tickets go into every
  one of those tickets, word for word.
- Before writing "keep X, it has other callers", check each caller in turn
  and confirm none of them is in the code being deleted.
- A rule phrased as "wherever … appears" lists the cases it does not cover.
- An eval ticket names the exact model to use.
- Tickets and their Comments contain no local paths, private endpoints, or the
  user's real data: this repo is open source.

## Worktree

- Create it with `scripts/new-ticket-worktree.sh <name> [--rust] [--dir <parent>]`.
  It branches `ticket/<name>` from local `main`, runs `pnpm install`, and with
  `--rust` clones the main worktree's Rust build output (APFS clonefile on
  macOS). The clone only reuses what the main worktree has already built:
  `tauri dev` leaves `cargo build` artifacts, so a first `cargo check` or
  `cargo test` in the new worktree may still compile most crates.
- Do not use the Agent tool's built-in `isolation: "worktree"`: it branches
  from `origin/main`, so tickets and rulings committed locally but not yet
  pushed are missing.
- The executor works only inside its own worktree: it does not touch the main
  worktree and does not run `tauri dev`.
- Parallel tickets whose directories do not overlap may share one worktree
  and its branch; only one of their agents compiles Rust. They are then
  accepted and merged as one unit: each agent commits only its own files, and
  the merge check covers the files of all of them.

## Standing constraints for executor agents

The main session does not restate these in a brief; it points here.

- Commit on the ticket's branch, naming files (no `git add -A` /
  `git commit -a`). Do not push or merge.
- Run long commands in the foreground. Leave no background wait loop behind;
  if you must wait, wait on the process id
  (`while kill -0 <pid>; do sleep 5; done`), not `pgrep -f`, which matches the
  loop itself.
- Temp files go in the scratchpad, with the ticket name as a filename prefix.
- Format only what you changed: in `gui/`, only your own hunks in existing
  files; in `core/`, check files one by one with `rustfmt --check`. Never run
  `cargo fmt --all`.
- A wrong ticket premise, or a problem you see outside the ticket: write it in
  the report, do not widen the scope.
- The report has four parts: what changed (files and commit hashes);
  verification commands and their output; open risks / what was not verified;
  findings outside the ticket.

## Acceptance

Done by the main session.

- Read `git diff main...<branch>`; for structural tickets, hunk by hunk. Trust
  the output, not the report.
- Run gates in a worktree no agent is currently changing.
- For parallel tickets, walk the one path that strings both tickets' actions
  together.
- Before handing layout or motion tickets to the user, measure them in the
  real window (jsdom does not lay out).
- Handle each open risk the agent reported, or pass it on verbatim. Never
  drop one.
- Look for wait loops the agent left behind and stop them.

## Merge

- At the last moment before merging, run `git rebase main` in the worktree,
  check that `git diff --name-only main..HEAD` lists only this ticket's files,
  then run `git merge --ff-only <branch>` in the main worktree.
- Tickets that only touch `gui/`: dev only hot-reloads; merge between two of
  the user's steps.
- Tickets that touch `core/`, `cli/`, or `runner/`: merging restarts Core
  under dev. First confirm with `core/target/debug/galley status` that
  `live.busy` is 0.
- After merging, delete the worktree and branch with the two commands the
  script printed (`git worktree remove <path>` needs no `--force` for the
  ignored build output; stray untracked files still block it; an abandoned,
  unmerged branch needs `git branch -D`), then set the
  ticket's `Status:` to `needs-dogfood` or `done` (see
  [triage labels](./triage-labels.md)).

## While tickets are in flight

- Check progress through the worktree's `git log --oneline main..HEAD` and
  `git status`, not the agent's transcript.
- Hand a related follow-up to the same agent with SendMessage (its context is
  still there), after asking it to rebase onto the new `main`.
- When a new ruling lands, check in-flight tickets at once; amend the
  affected ones, or stop and re-dispatch them.
- Keep the in-flight board (ticket, agent, worktree, state, who it is waiting
  on) in the scratchpad, not in the repo.
