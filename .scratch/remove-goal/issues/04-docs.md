# 04 文档：Goal 退役、Agent API 升 schemaVersion 3、README / SOP / skill 同步

Status: done（2026-10-13，执行记录见 Comments）
Blocked by: 无

先读 [PRD](../PRD.md) 的「契约」一节（写死，本票按它写文档）。

## 工作位置（硬约束）

- **只在 worktree 里工作**：`/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/ab7a31ac-a0f8-4206-b6ee-0c4affeea868/scratchpad/wt-remove-goal`（下称 `$WT`）。
- **绝不碰主工作树** `/Users/inkstone/Documents/genericagent-webui`。
- 不 commit，不 push，不改代码（`core/`、`cli/`、`gui/`、`runner/`、`managed-ga/`、`remote-protocol/`、`ios/`、`scripts/`）。
- **不改**：`AGENTS.md` / `CLAUDE.md`（主会话改）、`docs/project-status.md`、`docs/devlog/**`（含 `deferred.md` 与
  `README.md` 索引，主会话改）、`docs/archive/**`、`docs/audits/**`、`docs/adr/**`、`docs/galley-native/**`、`.scratch/**`
  （本票 Comments 除外）——这些是历史记录或主会话的活。
- 本次的 devlog 是 `docs/devlog/2026-10-13-remove-goal.md`（主会话已建），需要链接时链它。

## 原则

- **活文档写现状**：描述「Galley 现在有什么」的句子删掉 Goal；带日期的历史叙述（「2026-09-16 起…」这类）可以留。
- **有锚点被引用的整节改成退役短节，不删节、不改文件名**（先例：10-05 去审批时 `docs/design/tools-and-approvals.md`
  §4.6 改为退役短节，免断链）。列表里顺带一提的，直接删。
- 中文文档的退役短节写法：「（2026-10-13 移除，见 [devlog](<相对路径>/devlog/2026-10-13-remove-goal.md)）」加一两句交代。
- 中文用全角标点（，。：；（）「」）；英文文档用英文标点。

## 改什么

### Agent API（英文，契约文档，按下面写死的内容）

1. `docs/agent-api/goal-commands.md` → 退役短页，保留文件名。正文照这个写：

   ```markdown
   # Agent API — Goal Commands (retired)

   > Part of the [Galley Agent API](./README.md) contract. §5.19 is retired.

   ### 5.19 · `galley goal ...` — removed in `schemaVersion: 3`

   Galley Goal was removed on 2026-10-13 ([devlog](../devlog/2026-10-13-remove-goal.md)). Every `goal`
   command answers `unknown_command` under every pin, and the CLI has no `goal` subcommand any more:
   `galley goal …` fails argument parsing with exit `2` (`invalid_args`). See
   [stability §7.1](./stability-and-versioning.md) for what changed and how older pins are served.

   There is no successor command. To get long work done, say what "done" looks like in the task itself
   (`session new` / `session send`) and watch it with `session wait --until-idle` or `session follow`;
   if a run stops early, send the next message on the same session.

   The Goal v2 reference that lived here is in git history (last version at `e1125549`).
   ```

2. `docs/agent-api/stability-and-versioning.md`：
   - §1 「Current: `schemaVersion: 2` (since 2026-09-16 …)」→ `3` (since 2026-10-13; see §7)。
   - §1.1 状态枚举表删 `GoalBrief.status` 行、`dispatch` 表删 `goal start` 行；两张表下各加一句「Retired in `3`
     (§7.1): …」，不做无声删除。「renames / removals require a `schemaVersion: 2` bump」→「require the next
     `schemaVersion`」。
   - §1.2：接受集 `{1, 2, 3}`，默认 `3`；删掉「`1` 遇到 goal 族 → `schema_mismatch:` / `unknown_command`」两句。
   - §7 重排：新 **§7.1 `schemaVersion: 3` (current, since 2026-10-13)**；原 §7.1 → §7.2（标题改为
     「`schemaVersion: 2` (served for unchanged commands, since 2026-09-16)」，正文与「Changes inside `2`」列表原样保留）；
     原 §7.2 → §7.3；原 §7.3 → §7.4，其中「At the next major (`3`)」→「(`4`)」、「`galley version` returns … (`2`)」→
     `3`、接受集 → `{1, 2, 3}`。新 §7.1 正文照这个写：

     ```markdown
     The bump exists for one reason: the Goal surface was removed (`.scratch/remove-goal`,
     [devlog](../devlog/2026-10-13-remove-goal.md)). The `goal start / status / active / stop / extend`
     commands (socket `goal.*`) are **removed** with no successor, and so are `GoalBrief`, its status enum
     and `goal start`'s `dispatch` value. Nothing else changed: `3` carries every `2` command, field, enum
     value, exit code and error discriminant unchanged, except that `MessageBrief.goalId` is no longer
     produced. It was optional and absent on every message outside a Goal, so readers already handle its
     absence.

     **How `1` and `2` are still served.** The server accepts `1`, `2` and `3`:

     - A request pinned `1` or `2` for any command that survived unchanged is answered exactly as before.
       An old SOP that never used Goal keeps running without edits.
     - Every goal command — the v2 family and the v1 commands `2` had already retired — is
       `unknown_command` under every pin. The CLI has no `goal` subcommand: `galley goal …` exits `2`
       (`invalid_args`) at argument parsing.

     As with `2`, "removed" is spelled honestly as "not found": the blast radius of the bump is exactly
     the callers that used Goal.

     Migrating a goal SOP: there is no replacement command. Put what "done" looks like into the task
     itself, watch it with `session wait --until-idle` or `session follow`, and if a run stops early,
     send the next message on the same session.
     ```
3. `docs/agent-api/README.md`：顶部 Status 行改为 `schemaVersion: 3` since 2026-10-13（Goal 移除）；表里
   `goal-commands.md` 那行改成「§5.19 · retired in `schemaVersion: 3`」。
4. `docs/agent-api.md`（:6 当前版本那句）、`docs/agent-api/roadmap-and-references.md`（:28 提 `goal start` 的一句、
   :65–74 goal API trait 表——删表，留一句「Goal methods removed 2026-10-13」）、`docs/agent-api/errors-and-exit-codes.md`
   （:84–86）、`docs/agent-api/session-commands.md`（:439 「dispatches a Goal continuation or a queued message」→ 只剩 queued
   message）。全目录 `grep -n -i goal docs/agent-api` 收尾。

### Supervisor SOP 与 skill（四份副本必须逐字一致）

- 规范原文：`docs/integrations/galley-supervisor-sop.md`（23）、`docs/integrations/galley-supervisor-reference.md`（37）。
  删 Goal 小节与命令；「Target: Agent API `schemaVersion: 2` (since `v0.5.0`; only the `goal` family …)」→
  「Target: Agent API `schemaVersion: 3` (since 2026-10-13; `1` / `2` still answer every unchanged command)」；
  「add `--schema=2` (the `goal` family exists only under `2`)」→「add `--schema=3`」。长任务的指引写成：
  说清什么算做完、用 `session wait --until-idle` / `session follow` 盯、提前停了就在同一会话再发一条。
  这两份会被 Core `include_str!` 进 IM 监督者，措辞保持短。
- 副本：`.claude/skills/galley-supervisor/references/{galley-supervisor-sop,galley-supervisor-reference}.md` 与
  `.agents/skills/galley-supervisor/references/` 下同名两份——开头 `<!-- … -->` 来源注释保留，`Last synced` 改为
  `2026-10-13 (Goal removed; target schemaVersion 3)`，注释之后与规范原文**逐字一致**。
- `.claude/skills/galley-supervisor/SKILL.md` 与 `.agents/skills/galley-supervisor/SKILL.md`：两份除 supervisor id token
  外完全一致；frontmatter `description` 去掉「manage Galley Goal after confirmation」与 Goal 触发语，正文删 Goal 部分，
  Target 行同上。`.claude/skills/galley-supervisor/README.md`（3） 同步。

### README

`README.md` 与 `README.zh-CN.md` 两份对称改：

- 删 Highlights 里「🎯 Galley Goal」那一条；
- 「A Quick Tour」截图表删 Goal 那一格：剩下五张按原顺序排，前两行各两张、最后一行只有一格（`width="50%"`），
  不补别的图（JC 会做视觉验收）；
- Supervisor 一节「Long-running goals」那条删掉；
- CLI 示例里 `# Long-running goal …` 那一段（`goal start / status / extend / stop` 四条）删掉；
- `git rm docs/screenshots/en/goal.png docs/screenshots/zh/goal.png`。

### 其他活文档（`grep -ic goal` 计数）

`docs/PRD.md`（20，§6.4 Goal 改退役短节，其余提及删）、`docs/architecture.md`（11）、`CONTEXT.md`（2，:156、:160）、
`docs/ipc-protocol.md`（2，`turn_end.goalStatus` 删除；字段表若有编号别重排）、`docs/design/conversation.md`（32）、
`docs/design/layout-and-chrome.md`（10）、`docs/design/overlays-and-settings.md`（3，通知设置只剩「回复完成时通知」与提示音）、
`docs/design/foundations.md`（3）、`docs/design/polish-checklist.md`（2）、`docs/design/README.md`（1）、
`docs/design/onboarding-and-cards.md`（1）、`docs/managed-ga-runtime/implementation-milestones.md`（10）、
`docs/managed-ga-runtime/prompt-composition.md`（4）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（1）、
`docs/ga-baseline.md`（1）、`docs/screenshot-playbook.md`（5，去掉 Goal 镜头）、`docs/copy-language-guidelines.md`（1）、
`docs/README.md`（索引里若有 Goal 条目，改成退役说明）。

中文文档还要搜一遍中文说法（「目标模式」「长任务目标」「持续目标」等），别只搜 `goal`。

## 验证命令（都在 `$WT` 下）

```bash
node scripts/check-docs-links.mjs
node scripts/check-supervisor-sop-drift.mjs
git diff --check
grep -rn -i "goal" README.md README.zh-CN.md CONTEXT.md docs .claude/skills .agents/skills \
  | grep -v "^docs/devlog/\|^docs/archive/\|^docs/audits/\|^docs/adr/\|^docs/galley-native/"
```

再写一个全角标点扫描脚本，放你自己的临时目录、文件名带 `04-` 前缀（别用通用名，别的代理会覆盖），只扫
`git diff -U0` 的新增行里含中文的行，报出其中的半角 `, . : ; ( ) ?`（代码、路径、反引号内除外）。

## 回报格式

1. 改动文件，每个一行摘要（退役短节 / 删提及 / 改版本号）；
2. stability 文档新旧节号对照；
3. grep 剩余命中与理由（允许：退役短节、带日期的历史叙述、与 Goal 功能无关的普通英文词）；
4. 三条门禁与全角扫描的结尾输出；
5. 你判断拿不准、需要 JC 看的地方（尤其 README 截图表的排法）；
6. 文档里发现的、与代码现状不符的其他问题（只报不改）。

## Comments

**2026-10-13 执行记录（票 04 代理）**：按契约改完 33 份文档并 `git rm` 两张 `goal.png`。Agent API 升到
`schemaVersion: 3`：`goal-commands.md` 照票面写成退役短页；stability 新增 §7.1，原 §7.1–§7.3 顺延为
§7.2–§7.4，§7.2 正文原样保留。SOP 与 reference 删掉 Goal 小节，改为「Long Tasks」，四份副本逐字同步，两份
`SKILL.md` 对齐。两份 README 撤掉卖点、导览图、长任务条目与 CLI 示例，导览剩五张，按 2 / 2 / 1 排。PRD §6.4
与 `conversation.md` 两节改成退役短节，步数上限尾标单列一节。截图 playbook 按协调消息保留读书会，改成普通已完成
会话，只删 `goal.png` 镜头。transports 的接受集与示例按契约改成 3（不含 goal 字样，grep 扫不到）。
验证：`check-docs-links` OK（427 files），`check-supervisor-sop-drift` OK，`git diff --check` 无输出；全角扫描
命中 1 行，在 `ipc-protocol.md` §7 的代码块里，不算。
