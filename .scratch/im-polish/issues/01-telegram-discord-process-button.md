# 01 Telegram、Discord 的「过程」按钮

Status: needs-dogfood（Telegram 复测展开区一律普通引用块这一处，见 Comments 最后一条；Discord 未真机）

来源：[PRD](../PRD.md) 裁决 1、2。

## 要做的

**Telegram（补丁 `0024`，`frontends/tgapp.py` 与共享的 `frontends/galley_im_display.py`）**

- 回答消息里不再放折叠头（`_fold_header` 那个可折叠引用块），1 步也不放。
- ≥ 2 步的回答下面挂一个内联按钮「过程」。点了把这条消息编辑成「回答 + 末尾一个引用块」：引用块第一行 `N 步 · 用时 X`（`fold_label`），下面逐步 `NN 摘要`（沿用今天的步行与截断规则：最多 30 步、过长时按 60、24 字截）；按钮换成「收起过程」，再点还原。步骤很多、展开后超长时，展开区用可折叠引用块（Telegram 收起时露三行），否则用普通引用块；超出单条消息上限时照今天的预算规则截。
- 步骤清单按回答消息 id 缓存在进程内（有上限的 LRU，不持久化）。渠道重启后旧按钮点了用 callback 的 toast 回一句「过程已不在了（渠道重启过）」，不改消息。
- 回答分成多条消息时（超长），按钮挂在最后一条上，展开只编辑最后一条。
- 不动：在跑时的静音状态消息、`/stop` 定格的 `⏹ 已停止 · …`、提问消息的 `⏸ 等你回复 · 已完成 N 步`、完成报告（`runner/im_reporter.py` 的 `send_report`）。核一遍 reporter 走的 seam（`answer_text`、`markdown_v2_segments`）不受影响。
- 群聊里（若有）同样挂按钮，展开改的是那条消息本身。

**Discord（补丁 `0023`，随后照规矩在新 `0023` 上重导出 `0026`）**

- 撤掉回答首行小字 `-# N 步 · 用时 X`，1 步也不挂。
- ≥ 2 步的回答挂一个按钮「过程」，点了回一条 ephemeral 消息（只有点击者看得到），内容同 Telegram 展开区（第一行 `N 步 · 用时 X`，下面逐步 `NN 摘要`）。方案与实施要点照 `docs/devlog/deferred.md`「Discord 回答的步骤展开」（按回答消息 id 的进程内 LRU、重启后点击回一句过程已不在）。
- 不动：状态消息、停止定格、提问、完成报告、私信照旧关着。

## 约束

- 补丁流程照 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」：改 `0023` 后必须在其上重导出 `0026`（zero-context 补丁会静默落偏，09-30 devlog 末节有实测）；干净克隆重放全部补丁、重建后 `managed-ga/code` 哈希与工作区一致；台账（manifest / 补丁说明）同步。
- 平台无关的逻辑（展开区文本、步行截断）放进 `galley_im_display.py`；Discord 那边的 `_` 前缀副本能不能换成导入，照 09-30 devlog 裁决 5 的迁移条件判断，不满足就别动。
- import `managed-ga/code` 的脚本与测试用 `python -B`（否则留下 `__pycache__`，payload 检查会报）。
- 写 Telegram 的 MarkdownV2 与 Discord 组件前，读一遍当前 Bot API / discord.py 的按钮、编辑、ephemeral 用法，别凭记忆；编辑消息时保留原有的 `parse_mode` 与回复引用。
- 两边的测试都要补：≥ 2 步挂按钮、1 步不挂、展开与收起的文本、重启后点击的 toast、超长截断、分条时只挂最后一条。

## 验证

- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check`。
- `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs`。
- 干净克隆重放补丁栈全 clean。

## 交付

在 worktree 分支上提交（只点名文件），票 Comments 写实施偏差与没验证到的；Status 改 `needs-dogfood`。真机验收由 JC 在 dev 里「重启 Channels」后做：Telegram 私聊发一个 1 步、一个多步的问题，点「过程」展开、收起，看推送预览从回答开始、有没有「已编辑」；Discord 频道同样，看 ephemeral。

## Comments

### 2026-10-21 实现（子代理，worktree 分支 `im-polish-01`，提交 `6dba476a`、`57f3be25`）

**做了什么**

- Telegram（`0024`）：回答上面什么都不挂，1 步也不挂；≥ 2 步时最后一段下面挂内联按钮「过程」（`callback_data` 为 `proc:show` / `proc:hide`）。点了用 `editMessageText` 把这条消息改成「回答 + 空行 + 引用块」（首行 `N 步 · 用时 X`，下面逐步 `NN 摘要`，最多 30 步，过长时按 60、24 字截），按钮换成「收起过程」，再点改回发出时的原文。编辑沿用发出时的 parse mode（MarkdownV2 发出就用 MarkdownV2，纯文本兜底发出就用纯文本），回复引用本来就不随编辑改变。过程按 `(chat id, 回答消息 id)` 存在进程内的 LRU（256 条）；找不到时用 callback 的 toast 回「过程已不在了（渠道重启过）」，不改消息。非 owner 点按钮回 `no`（同提问按钮），未配对时静默应答。
- Discord（`0023`，`0026` 在新 `0023` 上重导出）：撤掉回答首行 `-# N 步 · 用时 X`；≥ 2 步时最后一段挂「过程」按钮（`custom_id` 为 `galley-dc:proc`），点了 `interaction.response.send_message(..., ephemeral=True)`，内容同 Telegram 展开区（纯文本行，整条不超过 1900 字）。过程按回答消息 id 存在进程内的 LRU（256 条），步骤摘要跨提问累加（`_DiscordRun` 新增 `summaries`，随 `carry` 带过去）；找不到时回同一句 ephemeral，按钮留着。非 owner 点击照旧静默应答。
- 平台无关的部分放进 `galley_im_display.py`：`process_lines`、`fit_process` 与按钮文案常量，只新增、没改名也没删已有导出（票 03 会导入这个文件）。
- 补丁流程：在临时克隆（`5205f40`）上按 manifest 顺序重放成提交链，先核对链与已提交的 payload 逐字节一致、链导出的补丁与仓库里的逐字节一致；再改 `0023`、`0024` 两个链提交，`0025`–`0028` 依次 cherry-pick。`0026` 叠到新 `0023` 上有两处真冲突（`DiscordApp.__init__` 里 `0026` 删的 `_stale_channels` 块紧挨 `0023` 新加的 `_processes` 行；`_send_answer` 两边都改），按「两边的改动都留」解决。新 `0026` 与旧的相比只有 `_send_answer` 那一处正文变化（原来的两个 hunk 并成一个），另有 31 个 hunk 头整体下移。干净克隆跑 `build-managed-ga.sh` 重放 26 个补丁全 clean、`py_compile` 通过，重建后 `managed-ga/code` 与 `state-seed` 共 217 个文件的 sha256 与测试所用的 payload 完全一致。台账 `manifest.md` 的重放记录与 `0023`、`0024` 两行已改。

**实施偏差（各附理由）**

1. 展开区不缓存成文本，点击时按这条消息剩下的空间现算；发送时最后一段先按「过程块最宽能放下的长度 + 2」留出空间，放不下就把最后一段再切一刀。理由：今天的预算规则是给首段顶上的折叠头留空间，现在过程块挂在最后一段末尾，规则得换到最后一段；而且 `runner/im_resume.py` 的「之前的对话没接上」提示会加在这条消息顶上，点击时现算才能把这一行算进去。实在放不下时退成纯文本展开（纯文本没有转义和引用标记，必然更短），收起时恢复原样。
2. tgapp 的 `_reply_markdown` 加了一个 `sent` 回调参数，用来记下实际发出的两份文本。理由：`im_resume` 包了 `_reply_markdown`，会在回答顶上加提示行；不记实际发出的文本，展开一编辑那行提示就没了（新增测试 `test_telegram_process_expands_under_the_notice_line` 覆盖）。`im_resume.py` 的 docstring 同步改了，台账 `0024` 行的耦合说明也补了这一条。
3. 「展开后超长」的阈值是我定的：过程块（含首行）超过 10 行或 600 字就用可折叠引用块，否则用普通引用块。票面没给数字；10 行约占手机屏三分之一，3 步、5 步的块整块摊开，不会重演「收起时露出头两步」。
4. 两边 LRU 都是 256 条。deferred 原写「缓存上限与频道 agent 的 LRU 同量级」（12），但 agent 的 LRU 限的是频道数，不是回答数；12 条的话一个活跃频道十几轮后按钮就失效。每条只存摘要（几 KB），256 条不到 1 MB。
5. Discord 重启后点旧按钮：回一句 ephemeral、不去掉按钮。deferred 写的是「静默或回一句」；回一句与 Telegram 的 toast 对齐，不去按钮与 Telegram「不改消息」对齐。
6. Discord 的 `_` 前缀副本没换成导入：迁移条件已在 09-30 Discord devlog「迁移条件改写」改成「随 IM 外壳多语言一起做」（台账 `0024` 行的 removal condition 同此），不满足。dcapp 里新加的 `_process_lines`、`_fit_process` 是共享文件同名函数的副本，加了一条测试逐项比对两边输出。顺手把 `galley_im_display.py` 文件头里过时的迁移说明改成与台账一致。
7. 文档：除台账外，还改了 `docs/design/overlays-and-settings.md` §9 的 Discord、Telegram 两条（以及微信那条里「与 TG / Discord『1 步也带头』是有意分叉」这句已不成立的话）和 `docs/ga-baseline.md` 的基线冒烟清单两条，免得留着描述旧行为的文字。deferred「Discord 回答的步骤展开」没删，留给主会话真机验收后连同 devlog 一起处理。
8. 没动出错消息：`❌ 出错：…` 上面那行 `N 步 · 用时 X`（Telegram 斜体、Discord `-#`）照旧。票面「不动」清单没列它，也没说要改；它不是回答，我按不扩范围处理。

**验证**

- `.venv/bin/python -B -m pytest`：604 passed（Telegram 文件 53 条，新增 11 条；Discord 文件 51 条（含参数化展开），新增 6 条；`test_im_resume.py` 新增 1 条）。新增覆盖：≥ 2 步挂按钮、1 步不挂、展开与收起的文本和 parse mode、连点一次不重复编辑、重启后的 toast / ephemeral、LRU 上限、非 owner 与未配对、普通与可折叠引用块的阈值、长步行 60 字截、分条时只挂最后一条且只编辑最后一条、最后一段放不下时多切一刀、纯文本发出的回答按纯文本展开、MarkdownV2 编辑被拒时退纯文本、提示行在展开后还在、提问前后的步骤累加、dcapp 副本与共享函数输出一致。
- `mypy runner`、`ruff check runner`、`git diff --check`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 全绿。reporter 的两个 seam（`answer_text`、`markdown_v2_segments`）行为不变，`test_reporter_through_real_tgapp_seams` 与 `test_im_reporter.py` 全过。
- 平台用法核对：Bot API 现行文档（MarkdownV2 引用块 / 可折叠引用块语法、`editMessageText` 的 `reply_markup` 与 4096 字上限、`answerCallbackQuery` 的 `text` 为 toast、`callback_data` 1–64 字节）；随包的 discord.py 2.7.1 源码（`InteractionResponse.send_message(ephemeral=True)`）与 python-telegram-bot 22.8 源码（`CallbackQuery.edit_message_text`）。

**没验证到的**

- 没跑 tauri dev，没重启任何渠道，没往 Telegram / Discord 发过消息：以下全靠真机。
- Telegram 客户端里：回答后接普通引用块、接可折叠引用块（`**>…||`，前面隔一个空行）的实际渲染；编辑后是否挂「已编辑」；推送预览是否从回答开始；toast 的样子。
- Telegram 的 4096 字上限按「解析实体后」计，我按 MarkdownV2 源文长度算预算（更保守），没在真服务器上碰过边界。
- Telegram 群聊：代码路径与私聊相同，测试只用假的群聊对象跑过。
- Discord：ephemeral 的显示（「只有你能看到」）、按钮挂在分条的最后一条上的样子。
- e2e（真 GA + 真模型）没跑。没有 Rust / GUI 改动，cargo 与 pnpm 门禁没跑。

**Open risks**

- LRU 挤掉（同一渠道进程里第 257 条多步回答之后）的旧按钮，点了也说「渠道重启过」，措辞在这个边角不准。
- 渠道重启时正好展开着的消息会一直停在展开状态，按钮是「收起过程」，点了只弹 toast，收不回去。
- MarkdownV2 编辑被拒、退成纯文本展开时，展开期间正文格式（粗体、列表符号等）会丢，收起后恢复。
- Discord：多步回答若只有附件、没有正文，不会发文字消息，也就没有「过程」按钮（Telegram 这种情况发「已生成附件」，有按钮）。我没为它补一条文字消息。
- 与票 03 合入：`galley_im_display.py` 只新增；`managed-ga/patches/manifest.md` 的「Last replay verified」段与 `0023`、`0024` 行、`manifest.json` 都可能和票 03 的 `0029` 冲突。合并后要再跑一遍干净克隆重放与 payload 检查，确认两张票叠在一起仍然 clean。
- `docs/design/overlays-and-settings.md` §9 改了 Discord、Telegram、微信三条，票 03 若改同一节的飞书那条，合并时可能冲突。

**JC 真机该测的**（dev 里「重启 Channels」后）

Telegram 私聊：
1. 问一个 1 步就答的（比如「你好」）：回答下面没有按钮，推送与聊天列表预览从回答开始。
2. 问一个多步的：推送与预览从回答开始；回答下面有「过程」。
3. 点「过程」：这条消息原地变成「回答 + 末尾引用块」，首行 `N 步 · 用时 X`、下面逐步；按钮变「收起过程」；看有没有挂「已编辑」，回答里的粗体、列表、引用是否还在。
4. 点「收起过程」：回到原样。
5. 跑一个十步以上的：展开后过程块是可折叠的（收着露三行），能在里面再点开。
6. 让它答一段很长的（会分成几条）：只有最后一条有按钮，展开只改最后一条。
7. 中途有提问的：答完后点「过程」，提问前的步骤也在里面，步数和用时是两段之和。
8. 「重启 Channels」后点旧回答的按钮：顶部弹「过程已不在了（渠道重启过）」，消息不变。
9. 不该变的：在跑时的静音状态消息、`/stop` 定格、提问消息、完成报告。

Discord 频道：
1. 1 步：回答上面没有小字、下面没有按钮。
2. 多步：只有回答，下面有「过程」；点了出一条只有你看得到的消息，内容同上；频道里那条不变。
3. 很长的回答：只有最后一条有按钮。
4. 「重启 Channels」后点旧按钮：回一条只有你看得到的「过程已不在了（渠道重启过）」。
5. 不该变的：状态消息、`/stop` 定格、提问、完成报告卡片，私信照旧不处理。

### 2026-10-21 JC 真机（Telegram）

- 推送预览、「已编辑」、收起等其余各项没问题（JC：「Telegram 其他方面没问题」）。
- 问题：多步任务点「过程」后出来的是可折叠引用块（过程块超过 `_PROCESS_QUOTE_MAX_LINES` 10 行或 `_PROCESS_QUOTE_MAX_CHARS` 600 字时，实施偏差 3），要再点一次才全开，「稍显啰嗦」。Discord 是 ephemeral 直接列全、飞书面板一点全开，只有 Telegram 多一层。
- 主会话给甲（一律普通引用块，按钮本身就是展开动作）/ 乙（只调高阈值），推荐甲；JC：「按建议推进」。长度照旧受 `_PROCESS_BUDGET`（半条消息）约束，嫌长靠「收起过程」。
- 要做：删掉可折叠分支与两个阈值常量，测试与文档里讲阈值的地方同步；补丁 `0024` 原地重导出（其后 `0025`–`0029` 不碰 tgapp，照规矩核一遍）。

### 2026-10-21 展开区一律普通引用块（子代理，worktree 分支 `im-polish-05`）

**做了什么**

- `tgapp.py`：删掉 `_PROCESS_QUOTE_MAX_LINES`、`_PROCESS_QUOTE_MAX_CHARS` 两个常量与 `_process_quote` 里的可折叠分支（`**>…||`），展开区不论多长都是普通引用块（`>` 开头逐行）。长度照旧由 `fit_process` 按 `_PROCESS_BUDGET`（半条消息）与这条消息剩下的空间约束：先按 60、再按 24 字截步行，最多 30 步。预算按 `_process_quote` 的实际长度算，普通块比可折叠块短 4 个字符，发送时给最后一段留的空间也随之少 4 个字符，其余不变。
- 补丁 `0024` 原地重导出：`tgapp.py` 那一节是「`0024` 之前的 `tgapp.py`（已提交的文件反向应用旧的那一节得到，用同一办法导出旧的那一节逐字节一致）」到新文件的 zero-context diff；`galley_im_display.py` 那一节没动。`0025`–`0029` 分别只碰 `agentmain.py`、`dcapp.py`、`llmcore.py`、`TMWebDriver.py`、`fsapp.py`，都不碰 `tgapp.py`，不用重导出。
- 测试（`runner/tests/test_managed_telegram_tgapp.py`）：辅助函数 `quote` 去掉 `expandable` 参数；原「短的普通、长的可折叠」用例改名 `test_process_is_a_plain_quote_however_long`，断言 10 行、11 行、7 行但超过 600 字三种情况都是普通引用块、没有 `**>` 与 `||`；`test_long_process_is_a_plain_quote_of_the_last_30_steps`（原 `…_expandable_quote_…`）与 `test_long_step_lines_give_way_within_the_budget` 的首行、末行断言改成普通块。
- 文档：台账 `0024` 行与「Last replay verified」（上一条 ticket 04 的记录挪成「Previous replay」）、`docs/design/overlays-and-settings.md` §9 Telegram 那条。`docs/project-status.md` 里 v0.5.5 那段「an expandable step-list quote on Telegram」讲的是当时发版的折叠头，属历史记录，没改。Discord、飞书没动。

**验证**

- `pytest`：640 passed，6 deselected（e2e）；`mypy runner`、`ruff check runner`、`git diff --check`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 全绿。
- 干净克隆 `lsdefine/GenericAgent` 检出 `5205f40`，`build-managed-ga.sh` 重放 27 个补丁全 clean、`py_compile` 通过，重建后 `managed-ga/code` 与 `state-seed` 相对工作区无差异，重建出的 `tgapp.py` 与手改的版本逐字节一致；克隆已删。

**没验证到的**

- 没跑 tauri dev，没重启渠道，没往 Telegram 发消息：十步以上的展开区在客户端里是否直接全开、整块普通引用块在手机上有多长，要真机看。
- e2e（真 GA + 真模型）没跑；没有 Rust / GUI 改动，cargo 与 pnpm 门禁没跑。

**Open risks**

- 步骤多、摘要长时，展开后的普通引用块最长约半条消息（约 2000 字），手机上会占好几屏；这是裁决接受的代价，嫌长靠「收起过程」。
- 已经展开成可折叠块的旧消息（渠道重启前展开的）不会自己变：照旧是 Open risks 里那条，重启后点「收起过程」只弹 toast。

**JC 真机该测的**（dev 里「重启 Channels」后，Telegram 私聊）

1. 跑一个十步以上的任务，点「过程」：展开区直接全开，没有「再点一次」的折叠层。
2. 点「收起过程」：回到原样。
