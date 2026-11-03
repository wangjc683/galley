# 125 界面上这条对话只叫「Galley」

Status: done（2026-11-03 JC 在 tauri dev 里看过重置的两个入口与 ⌘F 的范围标签：「没问题」。通知那一处 dev 版发不出系统通知（`gui/src/lib/notify.ts` 约 `:43-46`：`tauri dev` 不在 .app 里跑，通知要看启动它的终端有没有通知权限），JC 跳过；按库里主对话标题已是「Galley」（迁移 055 在真实库上跑过）与正文拼法（`gui/src/lib/ipc-handlers.ts:551-563`）推定，发版后在正式包里顺眼看一次。以下是合入记录：2026-11-03 快进合入 `1a96f1b0`，三个提交 `b48c11d6`、`81525fef`、`1a96f1b0`。代理在 worktree 跑过：cargo test 1291 条过、vitest 244 个文件 2718 条过、typecheck / lint / diff --check 干净；主会话复跑 typecheck、lint、diff --check 干净，推送范围扫过无私有路径与主机名；055 的 SQL 在真实库的副本上跑过，只有主对话一行从「主聊天」变成「Galley」，`updated_at` 不动。偏离票面五处主会话认可：`db_test.rs` 拆出 `pool_through_054()` 以便种「055 之前」的库；`ScopeTag` 去掉没人用的 `scope` 参数；⌘F 命中列表那条断言改成 `not.toContain("Galley")`，防的仍是命中第一行写会话标题；文案规范的重置表补了「标题菜单」与「此前」两行；051 专项测试的列表不加 055。代理「看到没改」里 `docs/managed-ga-runtime/code-state-and-patches.md:84` 的设置路径主会话合入后顺手改了；其余留着：Core 的英文错误详情（如 "there is no main chat to reset"，经「复制详情」或 CLI 露出）、给模型看的英文提示词与手册、代码注释里的旧菜单名、文案规范「新对话」那一行还提已撤掉的忙时选择。）

来源：[主对话 PRD](../PRD.md) 裁决 173。改 Core 的主对话标题（常量 + 一条数据迁移）、GUI 的几处文案与 ⌘K 范围标签、它们的测试与文案规范；Agent API 结构、手册、runner、managed-ga 不动。只影响内置运行时；外置运行时没有主对话，零变化。

## 为什么

库里主对话的标题写死「主聊天」（`core/src/db/main_chat.rs:9` 的 `MAIN_CHAT_TITLE`）。GUI 的侧栏、顶栏不用这个标题，自己写「Galley」；但回复完成、在问你两种系统通知的正文直接拼「标题 · 摘要」（`gui/src/lib/ipc-handlers.ts:551-563`，在问你约 `:690`），于是 JC 在通知里看到「主聊天 · 汇报子任务结果」。模型也从 CLI 输出里读到这个标题，把「主聊天」写进子任务说明、步骤小字和提醒备注。另外界面上还剩几处「主对话」。

裁决 173 定：这条对话在界面上没有自己的名字，名字就是助理的名字「Galley」，中英同字；非把对话当物件说不可时，中文写「和 Galley 的对话」，英文写「your chat with Galley」。

## 要做到

### 1. Core：标题改成「Galley」

- `core/src/db/main_chat.rs:9`：`MAIN_CHAT_TITLE` 改为 `"Galley"`，上方注释改写（不再说 GUI 叫它「主聊天 / Main chat」；写明标题就是助理的名字，裁决 173）。确认注释里说的两条仍成立：它不是 `新对话`，所以自动标题、派生标题不会改它，启动时清空 `新对话` 空行的扫除也碰不到它。
- 新迁移 `core/migrations/055_main_chat_title_galley.sql`：只改默认标题那一行，`UPDATE sessions SET title = 'Galley' WHERE main_chat = 1 AND title = '主聊天';`（旧的 socket 写入不拒绝主对话，标题理论上可能被改过，改过的不动）。不动 `updated_at` 与其他列。文件头照 053、054 的写法写清来由。注册方式照 053 / 054（读 `db_migrations` 怎么列）。
- 手写迁移列表六处一起补：`grep -rln "054_todo_subitems" core/tests cli/tests` 列出的六个文件，各自在 054 后面加 055。数据迁移不加列，漏了也不会红，但照惯例六处齐。
- 加一条测试钉住迁移：标题还是「主聊天」的主对话行被改成「Galley」；改过标题的主对话行、普通会话里标题恰好叫「主聊天」的行都不动。放在最顺手的现有测试文件里（`core/tests/main_chat_test.rs` 或 `db_test.rs`）。
- `core/tests/main_chat_test.rs` 等处断言主对话标题的地方跟着改。
- 重置主对话（`core/src/main_chat_reset.rs`）重建时用的是 `MAIN_CHAT_TITLE`，确认一下即可。

### 2. GUI 文案（逐字照下面写）

中文 `gui/src/i18n/locales/zh.ts`：

| 键 | 现在 | 改成 |
|---|---|---|
| 标题菜单 `resetMainChat`（约 `:479`） | 重置主对话… | 重置和 Galley 的对话… |
| 设置 `resetMainChat.title` | 重置主对话 | 重置和 Galley 的对话 |
| `resetMainChat.description` | 清空主对话和它的长期记忆，回到刚装好时 | 清空和 Galley 的对话与它的长期记忆，回到刚装好时 |
| `resetMainChat.runningBlock` | 有对话正在运行，结束后才能重置主对话 | 有对话正在运行，结束后才能重置 |
| `resetMainChat.dialogTitle` | 重置主对话？ | 重置和 Galley 的对话？ |
| `resetMainChat.dialogBody` | 主对话会清空，从问候重新开始；…… | 和 Galley 的对话会清空，从问候重新开始；它记住的关于你的事、学会的做事方法也会清掉，回到刚装好时。 |
| `resetMainChat.deletes[0]` | 主对话的聊天记录，包括…… | 这段对话的聊天记录，包括它派出去、还没变成普通对话的子任务和附件 |
| `resetMainChat.failedRunning` | 有对话正在运行，结束后才能重置主对话。 | 有对话正在运行，结束后才能重置。 |
| `resetMainChat.failed` | 没能重置主对话。 | 没能重置和 Galley 的对话。 |
| `subtask.notStartedEmpty` | 没有开始：主对话没写要做什么 | 没有开始：Galley 没写要做什么 |
| `subtask.notStartedUnclosed` | 没有开始：主对话没写完要做什么 | 没有开始：Galley 没写完要做什么 |

英文 `gui/src/i18n/locales/en.ts`：

| 键 | 现在 | 改成 |
|---|---|---|
| 标题菜单 `resetMainChat` | Reset main chat… | Reset your chat with Galley… |
| `resetMainChat.title` | Reset main chat | Reset your chat with Galley |
| `resetMainChat.description` | Clear the main chat and its long-term memory, back to a fresh install | Clear your chat with Galley and what it remembers, back to a fresh install |
| `resetMainChat.runningBlock` | A conversation is running; reset the main chat after it finishes | A conversation is running; reset after it finishes |
| `resetMainChat.dialogTitle` | Reset the main chat? | Reset your chat with Galley? |
| `resetMainChat.dialogBody` | The main chat is emptied and starts over from its greeting. …… | Your chat with Galley is emptied and starts over from its greeting. What it remembers about you and the ways of working it has learned are cleared too, back to a fresh install. |
| `resetMainChat.deletes[0]` | The main chat's messages, including …… | This chat's messages, including its attachments and the subtasks it sent out that haven't become ordinary conversations |
| `resetMainChat.failedRunning` | A conversation is running. You can reset the main chat after it finishes. | A conversation is running. You can reset after it finishes. |
| `resetMainChat.failed` | Couldn't reset the main chat. | Couldn't reset your chat with Galley. |

英文 `subtask.notStartedEmpty / notStartedUnclosed` 不提主对话，不动。

- 键名（`resetMainChat` 等）是内部名，不改。
- `zh.ts` 约 `:316-320` 助手那段注释里「『主对话』是内部用语，界面其余几处……还没改名，叫法另定」改成说定了（裁决 173）。其他注释里的「主聊天票 N」「主对话」是内部用语，不动。

### 3. ⌘K / ⌘F 范围标签并入普通对话那一档

- `gui/src/components/overlay/CommandPalette.tsx:272` 与 `:632` 按主对话挑 `findInMainChat` / `scopeMainChat`；改成主对话也用 `findInThisChat` / `scopeThisChat`（「查找这个对话…」「在这个对话里」/「Find in this chat…」「In this chat」）。
- 两种语言里删掉 `scopeMainChat`、`findInMainChat` 两个键。`palette-scope.ts` 的 `mainChat` 标记若还有别的逻辑在用就留着，只剩挑标签这一处用就一起删，连同测试。
- ⌘K 的搜索别名（搜「主对话」「助理」「助手」「main chat」「assistant」能找到 Galley）照留。

### 4. 通知

- 不加 GUI 侧的换名：标题改成「Galley」后，通知正文自然是「Galley · ……」。
- 测试夹具里代表主对话的 `title: "主聊天"`（`grep -rln "主聊天" gui/src` 列出的十几个测试文件）一律改成 `"Galley"`，期望值跟着改（比如 `ipc-handlers.subtask.test.ts` 的 `"主聊天 · 汇报子任务结果"` → `"Galley · 汇报子任务结果"`）。夹具里模型写的正文（如「用户在主聊天要求三分钟后提醒喝水」）是模拟模型输出，不动。
- `CommandPalette.scope.test.tsx:277` 的 `expect(html).not.toContain("主聊天")` 读一下它原来要防什么（多半是范围标签不该露出原始标题），按新行为改写断言，说明理由。

### 5. 文案规范与设计文档

- `docs/copy-language-guidelines.md`：
  - `:356`「主对话」那一行改成定案：「主对话」「主聊天」「main chat」只作内部用语；界面上这条对话没有自己的名字，名字就是「Galley」；非说不可用「和 Galley 的对话」/ your chat with Galley（2026-11-03 起，主对话 PRD 裁决 173）。列出这次改掉的几处与此前的写法。
  - `:354` Galley 那一行补一句：⌘K / ⌘F 打开它时范围标签与普通对话同写「在这个对话里」。
  - `:360`「『主聊天』『旁聊』只作内部术语」把「主对话」也算进去。
  - 「重置主对话」一节（约 `:316-330`）：小标题与表格换成新字，注明「2026-11-03 起，此前『重置主对话』」。
  - 子任务那一条「没派出去时写『没有开始：主对话没写要做什么』」换新字。
  - 全文 grep「主对话」「main chat」，凡是在引用界面上现在的字的地方都核一遍；说明性的散文（「只有内置运行时有主对话」这类）不动。
- `docs/design/conversation.md`、`docs/design/overlays-and-settings.md`、`docs/design/layout-and-chrome.md`、`docs/screenshot-playbook.md`：只改引用界面现行字样的地方（「重置主对话」「在主对话里」「查找主对话…」「主对话没写要做什么」），解释性用语不动。
- `docs/devlog/` 是历史，一字不改。

### 6. 看到没改的要报

`grep -rn "主对话\|主聊天\|main chat\|Main chat"` 过一遍 `gui/src`（非测试、非注释）、`core/src` 与 `cli/src` 的字符串字面量（不看注释）、`ios/`。凡是用户能看到、本票没覆盖的，列进报告，不自己改。

## 验证

在 worktree 根目录跑（`<wt>` 为 worktree 路径）：

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
git diff --check main...HEAD
```

- 全角标点：仓库里没有现成脚本。在 scratchpad 写 `cjk-punct-125.py`（文件名带票号，别覆盖别人的），扫 `git diff main...HEAD` 新增行里与中文相邻的半角 `, ; : ( ) ?`，报告附输出。
- `core/` 不是 rustfmt-clean：只对自己动过的 `.rs` 文件 `rustfmt --check --edition 2021`；`gui/` 不是 prettier-clean：只管自己的 hunk，别整文件 `prettier --write`。

## 别动

- 只在 worktree 里改，绝不碰主工作树 `/Users/inkstone/Documents/genericagent-webui`；不跑 `tauri dev`、不跑 `galley` 写命令、不读写用户的 `~/Library/Application Support/app.galley`。
- Agent API 的结构、`docs/agent-api/`、Supervisor SOP、`core/src/assistant_manual*` 与手册各部分、`runner/`、`managed-ga/` 都不动（裁决 173 第 4 条：不预先加手册条款）。
- 侧栏卡片、顶栏身份行、面包屑现在就写「Galley」，不动。
- locale 的键名不改；⌘K 搜索别名不删。

## 提交与回报

- 在 worktree 分支上提交，`git add` 只点名本票文件，禁用 `git add -A` / `git commit -a`；提交说明用英文，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；提交命令后接 `git log --oneline -1`，报告里的提交号只抄输出。
- 报告：①改了哪些文件 ②提交号 ③每条验证命令与结果（测试条数）④偏离票面的地方与理由 ⑤看到没改的（第 6 节）⑥Open risks。
