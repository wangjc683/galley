# galley-supervisor — Claude Skill

A Claude Code skill that lets Claude manage your local Galley desktop
orchestrator through the `galley` CLI: inspect what is running, start or
continue sessions, split work into a Project-backed group, wait for
results, archive / restore / move sessions, switch a session's model, or
run a Galley Goal after your confirmation — all from a Claude
conversation.

> **Need Galley first.** This skill assumes you have Galley installed and
> have launched it at least once (so the CLI discovery file at
> `~/.config/galley/cli-path` exists). Get it at
> https://github.com/wangjc683/galley.

## Install

Claude Code loads skills from `~/.claude/skills/`. Pick whichever you
prefer:

### Symlink (recommended if you cloned this repo)

```bash
ln -sfn "$(pwd)/.claude/skills/galley-supervisor" ~/.claude/skills/galley-supervisor
```

Re-syncs automatically when you `git pull`.

### Copy

```bash
mkdir -p ~/.claude/skills
cp -R .claude/skills/galley-supervisor ~/.claude/skills/galley-supervisor
```

Re-copy after `git pull` to pick up upstream changes.

### Verify

Open a new Claude Code session, run `/help` (or just ask Claude what
skills are loaded). `galley-supervisor` should appear in the available
skills list.

## Usage

Once installed, trigger phrases like these load the skill automatically:

- 「帮我看看 Galley 现在跑什么」
- 「开个 Galley session 跑 X 任务」
- 「把那个 session archive 一下」
- "what's running in Galley?"
- "spin up a Galley session that does X"
- "switch the LLM on session sess_xxx to claude-sonnet-4-6"

The skill resolves the CLI path from the discovery file, follows the
bundled Supervisor SOP, runs the appropriate `galley` subcommand, and
classifies any error by exit code. Reversible actions (stopping or
archiving a session) are done directly with the undo path reported;
irreversible or outward-facing ones (`project delete`, publishing,
credentials, payment, commit/push, broad file edits) get an impact summary
and wait for your approval first.

## Files

| Path | What |
|---|---|
| `SKILL.md` | The thin skill body Claude reads on trigger: identity, host-specific notes, and a pointer to the SOP. The procedure itself is not restated here. |
| `references/galley-supervisor-sop.md` | The operating procedure (verbatim copy of `docs/integrations/galley-supervisor-sop.md`, CI-checked). |
| `references/galley-supervisor-reference.md` | Detailed commands, Goal V1, origin fields, boundaries (verbatim copy of `docs/integrations/galley-supervisor-reference.md`, CI-checked). |

## Schema + stability

This skill targets **Galley CLI `schemaVersion: 1`**, frozen since `v0.2`
and additive-only since. Breaking changes bump to v2 and will ship as a
new skill version.

## Updates

The canonical SOP lives in [`docs/integrations/galley-supervisor-sop.md`](https://github.com/wangjc683/galley/blob/main/docs/integrations/galley-supervisor-sop.md)
and the full reference lives in [`docs/integrations/galley-supervisor-reference.md`](https://github.com/wangjc683/galley/blob/main/docs/integrations/galley-supervisor-reference.md).
When either updates, the `references/` copies in this skill are re-synced
(CI fails otherwise) — pull the latest skill version.

## See also

- [Galley Agent API](https://github.com/wangjc683/galley/blob/main/docs/agent-api/README.md) — full command schema
- [Galley architecture principles](https://github.com/wangjc683/galley/blob/main/AGENTS.md) — why Galley is localhost-only and your data never leaves your machine
