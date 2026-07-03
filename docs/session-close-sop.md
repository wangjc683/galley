# Session Close SOP

Use this when a long coding session is ending, or when project knowledge should
be reconciled without ending the session.

## Trigger

Run this SOP when the user says any closeout phrase such as:

- "session close"
- "结束这个 session"
- "按 SOP 收尾"
- "今天先到这里"
- "收尾并 commit"

If the user only asks for status, report status and continue. Do not run the
full closeout unless the user is ending or pausing the session.

If the user explicitly asks to sync, tidy, or reconcile project knowledge
without ending the session, run only the knowledge sync parts of this SOP:
capture durable decisions, update documentation where needed, and verify the
documentation diff. Do not commit or close the session unless asked.

## Checklist

1. Confirm the current outcome.
   - What was fixed or decided?
   - What did the user dogfood or explicitly confirm?
   - What remains open?

2. Capture durable decisions.
   - Keep only decisions that should influence future work.
   - Prefer focused docs for current rules.
   - Prefer devlog for why a decision was made and what was rejected.

3. Reconcile project knowledge.
   - Treat docs as an edited knowledge base, not an append-only session log.
   - Start from the changed surface and its audience; do not mechanically read
     or rewrite every document when the impact is narrower.
   - Promote stable facts into the right durable layer, then remove or avoid
     duplicate temporary notes.
   - It is valid to make no documentation change if the audit finds no drift.

4. Update documentation only where needed.
   - `AGENTS.md`: global rules and routing links only.
   - Focused docs in `docs/`: current SOPs, architecture, API, release rules.
   - `docs/devlog/`: decision history, debugging narratives, rejected paths.
   - `docs/README.md`: add major new documents to the routing index.
   - Do not put history, phase recaps, or one-off bug narratives in
     `AGENTS.md`; if they remain useful, move them to focused docs or devlog.

5. Verify the work.
   - Run the smallest checks that cover the changed surface.
   - For GUI / desktop changes, default to:

     ```bash
     pnpm --dir gui typecheck
     pnpm --dir gui lint
     git diff --check
     ```

   - Add Rust checks when Rust or CLI code changed:

     ```bash
     cargo check --workspace
     cargo test --workspace
     ```

6. Clean the workspace.
   - Inspect `git status --short`.
   - Remove accidental generated files, local DBs, logs, and debug artifacts.
   - Do not revert unrelated user work.
   - Stop dev servers or subprocesses started for the session if they are no
     longer needed.

7. Commit.
   - Commit once the work is verified and the scope is coherent.
   - Use a concise message that names the durable outcome.
   - Do not push unless the user asks.

8. Leave a handoff.
   - Include latest commit, verification run, completed outcome, and next
     useful step.
   - Keep the handoff short enough for the next session to scan quickly.

## Knowledge Sync Rules

Use these rules when step 3 finds project knowledge drift.

| Information type | Durable home |
|---|---|
| Startup rule every coding agent must obey | `AGENTS.md` |
| Current architecture, API, runtime, release, or workflow fact | Focused document under `docs/` |
| Why a decision was made, rejected alternatives, or retrospectives | `docs/devlog/` |
| Major new document or changed routing entry | `docs/README.md` |
| Completed task detail with no future use | Nowhere; leave it to git history |

Before editing, grep for the same term or concept and update the existing entry
when possible. Prefer replacing stale text over adding a new paragraph. Keep
relative time out of durable docs; write concrete dates when the date matters.

After editing docs, run a small anti-bloat check on `AGENTS.md` plus the
documents this session touched:

```bash
wc -l AGENTS.md <docs changed this session>
git diff --check
```

If `AGENTS.md` grows by more than a small rule-level change, re-check whether
the new material belongs in a focused doc or devlog instead.

## Closeout Shape

A good closeout answer should include:

- summary of changes
- verification results
- commit hash / message
- known remaining risks or next step

Avoid a full transcript recap. The devlog is the durable narrative.
