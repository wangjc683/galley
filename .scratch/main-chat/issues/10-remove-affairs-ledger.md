# 10 拆掉事项账本与「记忆」页

Status: ready-for-agent

来源：主聊天 PRD 裁决 49（2026-10-13，JC 选 A）。撤销票 01、04；票 05 暂缓。

## 为什么

JC 回到定位「Less harness. More model.」与「轻量本地助理」：账本在后台每天替用户花 token，又在 GA 的长期记忆之外另起了一套记忆（自定格式、解析器、IM 归档、定时任务、回滚、设置页、宪法解释），约一万行。
JC 起初要的只是主对话的记忆与持续对话体验。账本没发过版，现在拆最便宜。代码留在 git 历史里（`82e1d674` 起，到 04d 的 `d8df038b`）。

## 留下什么

- 主对话本身（票 02）、侧栏（07–09）、切段（03a，迁移 046）、查历史（03b：CLI 的 `--around` / `--since` / `--until`、搜索结果字段、状态块的「## Main Chat」一节）。
- 共用删会话路径顺带修的「删 `messages_fts` 索引行」（票 04 合入时修的旧 bug，对所有删会话生效）。
- 迁移 045（建排除表）与 047（删排除表）原样保留：开发机已跑过，tauri-plugin-sql 校验已跑迁移的校验和，一个字节都不能改；两者相抵，表不存在。
- 主对话的问候：只留第一段，仍是空状态规则的例外（下文）。

## 拆掉什么

**Core**

- `core/src/ledger/` 整个目录（含 `testdata/`）、`core/src/commands/ledger.rs`、`core/src/db/ledger.rs`、`core/tests/ledger_test.rs`、`core/examples/ledger_eval_prepare.rs`、`core/examples/ledger_parse.rs`，以及它们在 `lib.rs`、`commands/mod.rs`、`db/mod.rs` 的注册。
- 引用账本的其余地方（`grep -rln "ledger::" core/src`）：`app_setup.rs`（常驻 tick、启动时的 IM 归档与残留清理）、`runner_commands.rs`、`session_writes.rs`、`commands/session.rs`、
  `session_runner/segment.rs`（段首事项清单）、`managed_prompt.rs`（`LEDGER_ON_NOTE`、「## Ongoing Affairs」一节，主对话与 IM 两处，连同各自的字节预算测试）、`im_supervisor/manager.rs`（IM 状态块的清单）、
  `remote/events.rs` / `remote/methods.rs` 与 GUI 列表里过滤挖掘会话的 `is_mining_session`（挖掘会话不再存在）。
- 主对话建出来时（`core/src/db/main_chat.rs` 的 `Created` 路径）不再写开关 pref `affairs_ledger` 与 `notBefore`；只写主对话行与问候。`get_or_create_main_chat` 的 `language` 参数保留（问候仍分中英）。
- prefs 键 `affairs_ledger` 与开发机上的 `history_insight/` 不做清理代码：只有开发机有，主会话手动处理。

**问候**（`MAIN_CHAT_GREETING_ZH` / `_EN` 只留第一段，原文不改）

> 你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。

> Hi. From now on, whatever comes up, just tell me here. No need to decide whether to start a new conversation or pick up an old one.

标记、只显示不回放、`turn_index -1`、进全文索引都照旧。`core/tests/main_chat_test.rs` 跟着改。

**界面**

- 设置里的「记忆」标签与它的全部代码：`SettingsMemory.tsx`、`settings/memory/` 目录、`lib/memory*.ts`（含测试与 fixture），`Settings.tsx` / `SettingsHost.tsx` / `SettingsSidebar.tsx` 里的注册。
- 主对话标题菜单的「它记得我什么」，`memory-changed` 事件的监听，`EarlierDialog.tsx` / `ArchivedDialog.tsx` / `lib/sidebar-timeline.ts` 里过滤挖掘会话的分支。
- 中英文案里只为以上存在的键（`memory.*`、`settings.memory.*`）。

**文档**

- `AGENTS.md`（`CLAUDE.md` 是它的符号链接）Rule 4：删掉「Interpretation (2026-10-12): the affairs ledger …」整段，08-13 那段不动。
- 描述现行行为的地方：`docs/design/overlays-and-settings.md`（「记忆」页与标签列表）、`docs/design/conversation.md`（问候只剩第一段；它仍是空状态规则的例外，理由改为「教用户怎么用主对话」，不再是告知账本）、
  `docs/design/layout-and-chrome.md`、`docs/project-status.md`（Unreleased On Main 里账本与记忆页的条目删掉，主对话、切段、查历史留着）、`docs/ga-baseline.md`、
  `docs/managed-ga-runtime/code-state-and-patches.md`、`docs/managed-ga-runtime/prompt-composition.md`（条款台账里账本的条目）、`CONTEXT.md`。grep 中英文 `ledger`、`账本`、`history_insight`、`记忆页`、`Memory page`、`它记得我什么`。
- 不改：devlog、已撤销或已完成的票、PRD 的历史裁决。
- `.scratch/main-chat/ledger-eval/` 整个删掉（git 历史里有）。

## 验收

- `grep -rn "ledger\|Ledger\|affairs_ledger\|history_insight" core/src core/tests core/examples cli gui/src runner` 只剩迁移 045 / 047 的注册与主会话认可的必要注释；回报剩下的每一处。
- 主对话：新建时只有问候第一段、不写 `affairs_ledger`；状态块里没有账本说明与事项清单，「## Main Chat」一节照旧；IM 状态块里没有清单；切段与查历史的测试照旧通过。
- 外置运行时零变化（本来就没有主对话与账本）。
- `cargo test --manifest-path core/Cargo.toml --workspace`，并在 `TZ=UTC` 下再跑一遍；`pnpm --dir gui exec vitest run`（本机时区与 `TZ=UTC`）、`typecheck`、`lint`；六个门禁脚本；`git diff --check`。
- 格式化只动自己的文件或 hunk（core 不是 rustfmt-clean，gui 不是 prettier-clean）。
