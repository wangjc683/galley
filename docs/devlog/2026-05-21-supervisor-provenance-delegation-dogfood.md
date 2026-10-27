# Supervisor provenance + delegation dogfood

## Date / Status / Related

- **Date**: 2026-05-21
- **Status**: ✅ Dogfood pass. Supervisor-created prompts are marked at the
  message level; `session new` now starts real delegated work; GLM 5.1,
  concurrent delegation, error paths, and lifecycle actions were tested.
- **Related**:
  - [Supervisor SOP](../integrations/galley-supervisor-sop.md)
  - [agent-api](../agent-api.md)
  - Commits: `70e37c8`, `f468e09`, `5467667`

## Context

The starting UX question was whether "Supervisor activity" should be a
session-level badge in the top bar. The user clarified the important product
truth: a session can contain a mix of human, CLI, and supervisor-originated
messages. Therefore provenance belongs to the specific prompt that was injected
or created by a supervisor, not to the whole session.

This turned into a full dogfood pass over the Supervisor surface: message-level
UI, CLI origin semantics, `session new` delegation behavior, SOP correctness,
LLM switching, concurrent creation, error handling, and lifecycle operations.

## Decisions

1. **Supervisor provenance is message-level**. Do not put a durable Supervisor
   badge in the top bar; it overstates the whole session. Mark only user
   prompts whose origin is `created_via=supervisor`.
2. **Use an always-visible lightweight robot marker**. The marker is pinned to
   the user prompt's left brand bar, small enough not to steal focus but visible
   during scanning. The tooltip is intentionally terse: `Supervisor · <time>`.
3. **User-message actions stay minimal**. User prompts get Copy only, not Edit
   or resend. Editing would imply replacing or branching the following assistant
   answer, which is a heavier semantic feature.
4. **Supervisor identity is explicit, not inferred from CLI**. A normal CLI
   message remains CLI-originated. Only commands that pass `--supervisor=...`
   become supervisor-originated, because humans can also create messages through
   the CLI. (Superseded for the UI marker on 2026-10-27: every CLI origin is
   marked, read as 「Galley CLI」; see
   [origin marker](./2026-10-27-origin-marker-galley-cli.md). The stored `via`
   distinction is unchanged.)
5. **`session new` means real delegation**. The rejected `persisted_only` shape
   acted like a saved prompt note. For the Supervisor mental model, creating a
   new session should create the session, persist the first prompt, start the
   runner, and dispatch the task. On runner start/send failure, the command exits
   with `runner_error` instead of pretending work began.
6. **SOP discovery reads only the first discovery-file line**. The discovery
   file can include metadata such as `schema_version=1`; the SOP now uses the
   first line as the executable path instead of `cat`-ing the whole file.
7. **`stop` is abort, not shutdown**. `session stop` interrupts the current turn
   and leaves the bridge alive so a later `session send` can continue without
   respawning.

## Fixes

- Moved Supervisor UI from a session-card/top-bar style affordance to a
  message-level marker in `MessageUser`.
- Wired CLI/supervisor-origin user messages through GUI session/message stores
  so externally created prompts appear live with their origin metadata.
- Changed `session new` to dispatch the first prompt through Galley Core after
  persistence, and to report dispatch failure honestly.
- Removed collision-prone socket user-message ids by scoping generated ids to
  the session id and turn index; added burst uniqueness coverage for session ids.
- Accepted GUI cached LLM display names in CLI LLM resolution so
  `--llm "GLM 5.1"` works when the cache stores `displayName`.
- Updated the Supervisor SOP command table and common scenarios for
  copy-first usage, first-line discovery, origin flags, `runner_error`, and
  lifecycle commands.

## Dogfood coverage

- **Provenance boundary**: ordinary CLI-created prompts do not show the robot
  marker; `--supervisor=codex-supervisor/v1` prompts do.
- **GLM 5.1 delegation**: two Supervisor sessions were created with
  `--llm "GLM 5.1"`; both persisted `llm_index=1`, started runners with
  `--llm-no 1`, and used Chrome/browser tooling for current NBA-news research.
- **Concurrent delegation**: multiple same-second `session new` calls created
  distinct sessions/messages and all dispatched.
- **Error paths**: invalid LLM exits as `invalid_args` with no orphan session;
  runner-start failure exits as `runner_error`.
- **Lifecycle actions**: `stop` returned `abort_sent`, a second `stop` returned
  `already_stopped`, follow-up `session send` resumed successfully, and
  `archive` / `restore` moved the session between active and archived lists
  without losing provenance.
- **GUI recovery**: historical/session restore and GUI detail regression were
  manually checked by the user.

## Rejected alternatives

- **Top-bar Supervisor badge** — rejected because supervisor messages can be
  only part of a mixed session.
- **Showing supervisor id such as `@jc` in the lightweight marker** — rejected
  as unclear and too heavy for the common scan path.
- **Hover-only robot marker** — rejected because provenance should be discoverable
  at a glance, even though details stay in the tooltip.
- **Inline action row under user messages** — rejected after dogfood because
  hover-revealed Copy caused layout movement and felt awkward near assistant
  answers.
- **Edit + resend for user prompts** — rejected for now because it needs an
  explicit answer-replacement or branch/rewind model.
- **Inferring Supervisor from all CLI messages** — rejected because humans and
  agents both use the CLI.
- **`session new` as persisted-only draft** — rejected because the user's
  expectation is agent delegation, not a prompt note.

## Open questions

- `llm set` accepts a supervisor call path but does not yet carry provenance
  fields in the action log; this is acceptable for now but worth revisiting
  when a richer Supervisor activity/audit view exists.
- Browser-enabled delegated agents can still make factual mistakes while
  summarizing external news; the final supervisor should verify time-sensitive
  claims before reporting them as facts.
- User prompt Edit / branch / rewind remains a larger V0.2+ interaction
  question, separate from the lightweight Copy action.

## Next

1. Keep this Supervisor surface in the beta dogfood suite.
2. Before release, run one Windows smoke pass for the discovery-file and
   Supervisor SOP path.
3. Revisit richer Supervisor audit UI only after there is repeated demand beyond
   the per-message provenance marker.
