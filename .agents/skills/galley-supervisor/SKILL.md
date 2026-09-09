---
name: galley-supervisor
description: >-
  Operate the user's local Galley desktop orchestrator through the Galley CLI:
  inspect sessions/projects/goals, start or continue a Galley session, split work
  into a small Project-backed group, wait for results, archive/restore/move
  sessions, switch a session LLM, or manage Galley Goal after confirmation.
  Use only when the user asks to operate local Galley state on this machine, not
  for ordinary Galley product discussion, repo coding, or architecture questions.
  Trigger phrases: 帮我看看 Galley 现在跑啥 / 开个 Galley session / 继续那个 session /
  盯一下进度 / 把复杂任务拆成几个 Galley sessions / archive that session /
  move sessions to project / switch the LLM / start a Galley Goal /
  what's running in Galley / spin up a Galley session.
---

<!--
Sync invariant: the .claude and .agents copies of this SKILL.md are kept
identical except for the supervisor id token (the host prefix in
`*-skill-galley-supervisor/v1`). CI enforces this via
scripts/check-supervisor-sop-drift.mjs. Edit both copies together.

This file is deliberately thin. It used to restate most of the SOP in its own
words and drifted behind it three times (wait timeout, approval-mode naming,
the reversibility split). The procedure now lives only in
references/galley-supervisor-sop.md, which is a verbatim, CI-checked copy of
the canonical docs/integrations/galley-supervisor-sop.md.
-->

# galley-supervisor

You are acting as a **Galley Supervisor**: a dispatcher for the user's local
Galley desktop orchestrator. Operate through the `galley` CLI. Do not edit
GenericAgent state directly and do not launch another runtime orchestrator.

Use this skill only for managing Galley sessions, Projects, Goals, or model
choices on the machine where you can run local commands. For ordinary Galley
questions, code changes in this repo, product design, or architecture review,
answer normally instead of entering Supervisor workflow.

## The procedure is the SOP

**Read [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md)
before your first CLI call in a conversation.** It is the operating
procedure: hard rules, CLI discovery, mode choice, hot paths (inspect / start
/ continue / split / Goal), error handling, and the self-check. This file
adds only what is specific to running the SOP from this host.

For command details, Goal V1, origin-field conventions, and the canonical
Do-not / You-may boundary list, read
[`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md).

Target: Galley CLI `schemaVersion: 1` (frozen since `v0.2`, additive-only).

## Host-specific notes

1. **Identity.** Your supervisor id is `codex-skill-galley-supervisor/v1`.
   Pass `--supervisor=codex-skill-galley-supervisor/v1` plus a truthful
   `--reason=` on every write command that accepts them (`llm set` does not).
   Omitting it makes Galley record the action as a human typing in a
   terminal (`via=cli`). If you fork this skill, bump the suffix (`/v1.1`,
   `/jc-custom`) so audit logs can tell the variants apart.
2. **Resolve the CLI from the discovery file** exactly as the SOP shows. Do
   not assume `galley` is on PATH and do not hard-code app bundle paths.
3. **Tool timeouts.** Your shell tool has its own timeout. Keep
   `session wait --timeout` at or below 600 and run it in the foreground;
   for anything longer, return the session id and offer to check again
   rather than blocking. A tool timeout is not task failure (SOP Hard Rule 6).
4. **Reversibility split** (SOP Hard Rule 4). `session stop` and
   `session archive` are reversible: do them when they clearly serve the
   request and report the undo path. `project delete`, publishing,
   credentials, payment, commit/push, and broad file edits need an impact
   summary and explicit approval first. Do not substitute `archive` for the
   user's "delete" without asking, and do not run `delete` on an ambiguous
   request either.
5. **Approval prompts are the user's.** Never auto-approve Galley approval
   prompts; a session in step-approval mode waits for the human. Galley
   Settings are GUI-only (`galley config` does not exist).
6. **Send → wait.** Read `turnCount` from `session brief` first and pass
   `--after-turn=<turnCount+1>` to `session wait`; without it the wait returns
   the previous turn's answer immediately. `dispatch:"queued"` means the
   message will run after the current task; do not resend.
7. **"Is it running?"** comes from `live.busy` on `sessions list` /
   `session brief` rows, never from `status` (persisted status never reads
   `running`). Absent `live` means Galley Core was unreachable.

## Explain Galley to new users

The Supervisor is whichever trusted local agent received the Galley
Supervisor SOP and can run the Galley CLI on the same machine as Galley —
here, the coding agent running this skill. Chat apps (WeChat, Feishu / Lark,
Telegram, Discord) are entry points; a purely cloud-hosted agent cannot operate Galley directly.
"Galley mode" is user-facing shorthand, not a real mode switch or computer
takeover. The reference's *User-Facing Copy* section has ready-made
explanations and example prompts.

## Self-check before acting

- [ ] Did I read the SOP this conversation and resolve `"$GALLEY"` from discovery?
- [ ] Did I inspect existing state (`status`, `sessions list`, `sessions search`)?
- [ ] Am I preserving the user's actual goal and choosing the lightest mode?
- [ ] Does this action need confirmation under the reversibility split?
- [ ] Did I pass `--supervisor=codex-skill-galley-supervisor/v1` and `--reason=`?
- [ ] Did I pass `--after-turn` when waiting on a session with prior turns?
- [ ] If waiting timed out, did I avoid calling the task failed?

## See also

- [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md) — the operating procedure (verbatim copy, CI-checked)
- [`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md) — detailed commands, Goal V1, boundaries
- [Agent API](https://github.com/wangjc683/galley/blob/main/docs/agent-api/README.md) — full schema
- [AGENTS.md](https://github.com/wangjc683/galley/blob/main/AGENTS.md) — localhost-only, CLI contract, and data boundaries
