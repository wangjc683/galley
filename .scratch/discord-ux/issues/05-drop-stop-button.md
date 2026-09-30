# 05 去掉状态消息上的停止按钮

Status: done
Blocked by: —（01–04 已提交）
PRD：[../PRD.md](../PRD.md)；停止按钮的原实现与偏差见 [02 的 Comments](./02-ask-user-stop-commands.md)

## 背景（JC 裁决，2026-09-30）

停止只靠文本 `/stop`，状态消息不再挂「停止」按钮。理由：

- 按钮只 abort supervisor 这一轮，派出去的 Galley session 照跑、报告照回，与桌面 Stop（停的是干活的 session 本身）语义不对等。
- 每个 run 都挂，包括十秒的闲聊，是外壳噪音；按钮文字是中文，而外壳多语言（L1，`.scratch/im-chrome-i18n/`）推迟到打磨收尾，
  少一个要翻译的词。
- Telegram 本来就只靠 `/stop`，两渠道由此一致。
- 已知代价：运行中想停得手敲 `/stop`（`/help` 与 Settings 命令参考已列）。**不加**任何「发 /stop 可中断」提示。

## 做什么（全部在补丁 `0023` 内，重导出）

1. **状态消息永远不带按钮**：`_status_content`（`dcapp.py:671`）不再返回 `show_stop_button`，建议直接返回字符串、调用方随改
   （`run.last_render` 比较口径跟着变）；`_flush_status`（`:1300`）与首次发状态消息处都不再构造 / 传 view。
2. **删掉停止按钮的整条路径**：`_on_stop_click`、`_runs_by_token`（`__init__` 定义与登记 / 弹出两处）、`_handle_interaction` 里的
   `stop` 分支；`_DiscordRun.token` 若再无用处一并删（ask 按钮用的是 `_PendingAsk.token`，不受影响）。`_component_view` 仍服务
   ask 按钮，保留。
3. **旧按钮**：升级前已发出的 `galley-dc:stop:<token>` 按钮（旧进程里正在跑的 run 的状态消息，重启后遗留）被点时，走现有
   `_ack_stale`：静默应答并去掉按钮，不 abort、不起 run——即使该频道此刻有新 run 在跑。现有「未知 kind → `_ack_stale`」
   回退应已覆盖，确认后在 `_handle_interaction` 旁留一句注释说明旧 stop 按钮落在这里。
4. **文本 `/stop` 行为逐字不变**：有 run → 状态消息定格 `⏹ 已停止 · N 步 · 用时 X`、不另回执；无 run → 「当前没有在跑的任务」。
   `_write_stopped` 里「编辑途中落了停止」的补写逻辑对 `/stop` 仍然需要，保留。
5. 注释 / docstring 里提到 stop button 的地方改掉（如 `_handle_interaction` 的 docstring「ask_user answers, stop」、
   `self.running` 行尾「cleared by /stop, the stop button, channel release」、补丁顶部状态消息那段注释若有）。

## 连带文档（你负责这三处，其余文档主会话写）

- `managed-ga/patches/manifest.md`：
  - `0023` 行：删掉「The running status message carries a 停止 button」，改写为停止只靠文本 `/stop`（状态消息定格为回执），
    旧版本遗留的停止按钮被点时静默去掉。
  - `0024` 行 removal condition 的最后一句「At `0023`'s next re-export, split `galley_im_display.py` into its own patch ahead of
    `0023` and move dcapp onto it.」改为：迁移随 IM 外壳多语言一起做（`.scratch/im-chrome-i18n/`），在那之前的纯展示修改
    原地重导出 `0023`。措辞自定，英文，保持该列的写法。
  - 顶部「Last replay verified」按本次重放改写，原段落挪成 Previous replay（同 `0024` 那几次的写法）。
- `docs/ga-baseline.md:968` Step 8 的 Discord 真机清单：「and the stop button」改为 `/stop` during a long run（状态消息定格
  `⏹ 已停止 · …`），措辞对齐下面 Telegram 那条。再 `grep -n -i "stop button\|停止" docs/ga-baseline.md` 确认 item 15 与
  耦合地图里没有别的按钮措辞。
- 本票面末尾写 `## Comments`。

## 约束

- 补丁流程（`docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」）：只读克隆
  `git clone --quiet ~/Documents/GenericAgent <scratchpad>/ga-replay-dc05` 后 checkout
  `1b6442fe4f97d87a3d9d52d76569f69d156af853`；先 `scripts/build-managed-ga.sh <克隆路径>` 重建一次，确认
  `git status managed-ga/code` 干净；再改、按现有 `0023` 的格式（zero-context，`diff --git a/frontends/dcapp.py b/frontends/dcapp.py`）
  重导出；重建后 payload 与你的版本逐字节一致。栈现在是 24 个补丁（到 `0025`），`0024` / `0025` 不碰 dcapp，但必须全部重放 clean。
  **绝不改 `~/Documents/GenericAgent` 本身，绝不手改 `managed-ga/code/` 当交付。**
- 不动 tgapp、`galley_im_display.py`、`runner/im_reporter.py`；不动访问控制、配对、`main()`（`0018` 的域）。
- 中文文案全角标点；不整文件格式化无关代码。

## 验证

- 更新 `runner/tests/test_managed_discord_dcapp.py`：
  - 多步状态消息那条（约 `:490`，断言 `view.children` 是「停止」的）改为断言状态消息的发送与每次编辑都不带按钮。
  - 删 `test_stop_button_stops_running_run`。
  - 新增：旧 stop 按钮（`galley-dc:stop:deadbeef`）在该频道有 run 在跑时被 owner 点 → 只 `defer`、按钮被去掉、`agent.aborted == 0`、
    run 照常完成；非 owner 点同样静默。
  - `/stop` 两条（`test_stop_command_freezes_status_and_keeps_queue`、`test_stop_command_without_running_run`）原样通过。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check` 全绿；
  `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs` 绿。
- `grep -n '"停止"\|_runs_by_token\|_on_stop_click\|show_stop' managed-ga/code/frontends/dcapp.py` 无残留
  （`DISCORD_HELP_TEXT` 里「停止在本频道响应」除外）。

## 回报

**不要 commit / add。** 只碰：`managed-ga/patches/0023-*.patch`、`managed-ga/patches/manifest.md`、`managed-ga/code/`（build 脚本产出）、
`runner/tests/test_managed_discord_dcapp.py`、`docs/ga-baseline.md`、本票面。完成后把本票 `Status:` 改成 `done`，写 Comments
（做了什么、偏差与理由、门禁实际输出、主会话要看的点），并回复同样内容的中文摘要。

## Comments

### 2026-09-30 · 实现完成（补丁 `0023` 原地重导出）

**做了什么**

- 补丁流程：只读克隆到 scratchpad 的 `ga-replay-dc05`，checkout `1b6442fe`；先用它重建一次，`git status managed-ga/code managed-ga/state-seed` 干净。另起一个只放 `frontends/dcapp.py` 的工作仓：上游文件叠 `0018` 作 base，再叠旧 `0023`；先验证导出配方 `git diff -U0 <base> -- frontends/dcapp.py | grep -v '^index '` 能逐字节复现现有 `0023`，再在其上改、按同一配方重导出（hunk 的上游行区间与原补丁一一对应，只有新侧行号和行数变）。重建后 24 个补丁全部 clean，`py_compile` 通过，`managed-ga/code` 只有 `frontends/dcapp.py` 变化，且与我改好的版本逐字节一致（`cmp`）。
- dcapp：
  - `_status_content` 直接返回字符串；`_send_status`、`_flush_status` 随改，`run.last_render` 存字符串，两处都不再构造或传 view。
  - 删 `_on_stop_click`、`_runs_by_token`（定义与登记、弹出两处）、`_handle_interaction` 的 `stop` 分支、`_DiscordRun.token`（再无用处；`uuid` 仍由 `_PendingAsk.token` 与 turn 目录名使用）。`_component_view` 保留给 ask 按钮。
  - 旧 `galley-dc:stop:<token>` 按钮落进原有的「未知 kind → `_ack_stale`」回退：owner 点只 defer 并去掉按钮，不 abort、不起 run；非 owner 点只 defer（与 ask 按钮的非 owner 规则一致，不替 owner 去按钮）。回退处加了注释。
  - 注释与 docstring：`self.running` 行尾、`_handle_interaction` 与 `_status_content` 的 docstring 已改；补丁顶部状态消息那段注释没有提到按钮，未动。
  - 文本 `/stop` 的代码未动；`_flush_status` 里「编辑途中落了停止」的补写保留。
- 测试（`runner/tests/test_managed_discord_dcapp.py`）：多步状态消息那条改为断言发送与每次编辑都不带按钮；删 `test_stop_button_stops_running_run`；新增 `test_old_stop_button_is_stale_while_a_run_goes`：频道有 run 在跑时，非 owner 点只 defer、按钮不动；owner 点只 defer、按钮被去掉、`agent.aborted == 0`；run 照常完成，状态消息删除，答案为 `-# 2 步 · 用时 2 秒`。两条 `/stop` 测试原样通过。
- 文档：`manifest.md` 的 `0023` 行、`0024` 行 removal condition 末句、顶部 Last replay（原段落挪成 Previous replay）；`docs/ga-baseline.md` Step 8 的 Discord 真机清单改为 `/stop` during a long run，措辞对齐 Telegram 那条。`grep -n -i "stop button\|停止"` 复查过，item 15 与耦合地图里没有按钮措辞。

**偏差与自行裁量（附理由）**

1. 状态消息的另两处编辑也去掉了 `view=None`：`_write_stopped`（`/stop` 定格）和 `_retire_status` 删除失败后的回退编辑。它们只为清掉停止按钮而存在，状态消息不再带按钮后就是死参数，留着会让读者以为状态消息可能带组件。用户可见行为不变：文字相同，消息本来就没有组件。连带把 `test_delete_failure_falls_back_to_done_marker` 的断言从 `{"content": "-# ✓ 已完成", "view": None}` 改为 `{"content": "-# ✓ 已完成"}`。不想要的话，恢复这两处 `view=None` 和这一行断言即可。
2. 票面没点名、但「调用方随改」必然要动的测试：`test_status_content_rendering` 的元组断言改成字符串。
3. 删掉的多步断言里有一句 `view.timeout is None and view.stopped`，它是 `_component_view`「只渲染、不进 ViewStore」这条不变式的唯一覆盖；已挪到 `test_ask_row_click_continues_run_with_carried_counts`（`question.view.stopped`），免得覆盖丢失。
4. `manifest.md` 的 `0023` 行 removal condition 顺手把「ask_user buttons and a stop control」改为「ask_user buttons and a `/stop` receipt」。上游 dcapp 本来就有 `/stop`（回「⏹️ 正在停止...」），`0023` 在停止上独有的只剩「定格状态消息当回执」；原措辞在按钮删掉后容易被读成按钮。

**门禁实际输出**

- `.venv/bin/python -m pytest`：`409 passed, 6 deselected in 3.67s`（dcapp 模块单跑 `34 passed`）
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 26 source files`
- `.venv/bin/ruff check runner`：`All checks passed!`
- `git diff --check`：无输出，exit 0
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`，exit 0
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (1b6442fe)`，exit 0
- `grep -n '"停止"\|_runs_by_token\|_on_stop_click\|show_stop' managed-ga/code/frontends/dcapp.py`：无匹配（exit 1）。文件里的「停止」只剩 `DISCORD_HELP_TEXT` 的「停止在本频道响应」、`已停止` 回执文案，以及新注释里的「停止 button」。

**主会话要看的点**

- 未 commit / add。我碰过的文件：`managed-ga/patches/0023-managed-discord-conversation-ux.patch`、`managed-ga/patches/manifest.md`、`managed-ga/code/frontends/dcapp.py`（build 产出）、`runner/tests/test_managed_discord_dcapp.py`、`docs/ga-baseline.md`、本票面。工作树里另有 `.scratch/discord-ux/PRD.md`、`docs/devlog/*`、`docs/project-status.md`、`docs/design/overlays-and-settings.md` 的改动和未跟踪的 `.scratch/im-chrome-i18n/`，都不是我改的。
- `manifest.md` 的 `0024` 行现在指向 `.scratch/im-chrome-i18n/`，该目录目前未跟踪；提交时要一并带上，否则链接悬空。
- 新测试用的旧按钮 token `deadbeef` 在旧实现里同样查不到 run，所以这条单独区分不了新旧实现；「状态消息从不带按钮」由多步那条断言兜住。
- 真机：升级前正在跑的 run 留下的旧状态消息（带停止按钮）点一下应只去掉按钮、什么都不停；新 run 的状态消息不再有按钮，`/stop` 定格为 `⏹ 已停止 · …`。
