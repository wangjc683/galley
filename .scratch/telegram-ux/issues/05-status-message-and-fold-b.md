# 05 真机第一轮裁决落地：状态消息取代草稿、去读秒、折叠头定 b

Status: done
Blocked by: —（01–04 已提交于 `10983320`）
PRD：[../PRD.md](../PRD.md)；前序实现与偏差见 [01 的 Comments](./01-live-draft-and-answer.md)

## 背景（JC 真机第一轮，2026-09-30）

1. **私聊草稿会让 Telegram 客户端把整块消息迅速上推、留下一大片空白**（客户端给草稿预留流式区域；三轮日志均走草稿路径、
   无 `[TG draft fallback]`）。JC：「这个体验其实并不好，可以去掉」。→ **不再使用草稿**，私聊也用现有的**静音状态消息**路径
   （即群聊 / 草稿失败时的回退形态，与 Discord `0023` 同形）。
2. **读秒在 Telegram 里视觉一般**，去掉。→ **照 Discord `0023` 的规则**：不读秒；当前步已跑满 60 秒起追加
   ` · 已 {M} 分钟 · 仍在运行`，按分钟更新。
3. **折叠头定 b**（顶部可折叠引用块：首行 `N 步 · 用时 X`，其下逐步 `NN summary`）。→ 拆掉临时切换器与 a / c 两个变体。

## 做什么（全部在补丁 `0024` 内，重导出）

### 1. live 面只剩静音状态消息

- 删掉草稿模式：`_LiveSurface` 恒为状态消息；删除 `_send_draft`、`_DRAFT_REFRESH_SECONDS`、`_DRAFT_KEEPALIVE_SECONDS`、
  `_CLEAR_DRAFT_AFTER_SEND`、`_make_draft_id`（若再无用处）以及 `_flush_live` / `_live_due` / `_retire_live` 里的草稿分支；
  模块顶部那段 live 面注释按新形态改写。
- 行为沿用现有状态消息路径，私聊与群聊一致：`reply_text(..., disable_notification=True)` 发出（引用与否沿用 PTB 默认：私聊不引用、
  群聊引用触发消息，保持现状）→ 原地编辑、两次编辑间隔 ≥ 1.5 秒 → run 结束时先发正式消息再删除（删除失败编辑成兜底文案）；
  停止时**定格**成 `⏹ 已停止 · N 步 · 用时 X`、不删（`_post_stopped` 现有的状态消息分支，现在它是常规路径）；状态消息发送失败则本 run
  无 live 面（现有逻辑）。
- 引用规则 `_should_quote` 以状态消息为锚点（现有逻辑），不变。

### 2. 去读秒，改 Discord 分钟行

- 状态消息第三行：`·· 思考中`；当前步（从该步开始计，步落定归零）已跑 ≥ 60 秒时变成 `·· 思考中 · 已 {M} 分钟 · 仍在运行`，
  `M = 整分钟数（向下取整）`——与 `dcapp.py` `_status_content` 逐字一致。
- 排队行：`·· 排队中`，**不带任何时间**（同 Discord）。
- 编辑只在文本变化时发生（分钟行每分钟最多变一次），删掉 `_STATUS_CLOCK_REFRESH_SECONDS` 这类只为读秒存在的节奏常量。
- 共享文件 `galley_im_display.py`：`live_elapsed` 是 `0024` 新增、只有 tgapp 用，改成（或替换为）返回分钟行后缀的函数，
  例如 `still_running_suffix(seconds)` → `""`（< 60 秒）/ `" · 已 {M} 分钟 · 仍在运行"`；命名自定，docstring 写明与 dcapp 同口径。
  `「另有 {K} 条消息排队中」` 保留。

### 3. 折叠头只留 b

- 删除 `_FOLD_STYLE`、`_handle_fold_command` 与 `handle_command` 里的 `/fold` 分支、`_fold_header` 里 a / c 两支、`_send_answer`
  里按样式选分隔符的逻辑（b 固定空一行接正文），以及所有 `TEMP(dogfood)` 注释。b 的 30 步截断与超长收窄逻辑保留。
- 1 步也有头（现状，不变）。

## 连带文档（你负责这三处，其余文档主会话写）

- `managed-ga/patches/manifest.md` 的 `0024` 行：live 面改写为静音状态消息（去掉草稿与读秒的描述，写明草稿因客户端上推留白被弃）、
  折叠头写成定稿的 b、removal condition 删掉「Remove the fold-style switch…」一句；「Last replay verified」按本次重放更新。
- `docs/ga-baseline.md` 第 964 行附近 Step 8 的 Telegram 真机清单：「the draft's lines」改为状态消息；item 15 / 耦合地图里若有草稿相关措辞一并改。
- 本票面末尾写 `## Comments`。

## 约束

- 补丁流程同 01（`docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」）：只读克隆
  `git clone --quiet ~/Documents/GenericAgent <scratchpad>/ga-replay05` 后 checkout `1b6442fe4f97d87a3d9d52d76569f69d156af853`；
  先用 `scripts/build-managed-ga.sh` 重建一次确认 `git status managed-ga/code` 干净，再改、重导出 `0024`（zero-context，`new file mode`
  照旧），重建后 payload 与你的版本逐字节一致。**绝不改 `~/Documents/GenericAgent` 本身，绝不手改 `managed-ga/code/` 当交付。**
- 不动访问控制、配对、`main()`（`0014` 的域）；不动 dcapp、`runner/im_reporter.py`（reporter 用的两个 seam 签名语义不变）。
- 文案逐字，全角标点。

## 验证

- 更新 `runner/tests/test_managed_telegram_tgapp.py`：删掉草稿、读秒三档、草稿保活、草稿失败回退、清草稿开关、`/fold` 切换与 a / c 变体的测试；
  补：私聊走静音状态消息（`disable_notification=True`、原地编辑、回答后删除）、分钟行（59 秒无后缀 / 60 秒「已 1 分钟」/ 步落定归零 /
  分钟不变时不重复编辑）、排队行不带时间、私聊 `/stop` 定格状态消息且不另发消息、折叠头 b 是唯一形态。
  `test_reporter_through_real_tgapp_seams` 必须保持通过。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check` 全绿；
  `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs` 绿；`grep -n "draft\|_FOLD_STYLE\|TEMP(dogfood)\|/fold" managed-ga/code/frontends/tgapp.py` 无残留（注释里说明弃用原因的一句除外）。

## 回报

**不要 commit / add。** 只碰：`managed-ga/patches/0024-*.patch`、`managed-ga/patches/manifest.md`、`managed-ga/code/`（build 脚本产出）、
`runner/tests/test_managed_telegram_tgapp.py`、`docs/ga-baseline.md`、本票面。完成后把本票 `Status:` 改成 `done`，写 Comments（做了什么、
偏差与理由、门禁实际输出、主会话要看的点），并回复同样内容的中文摘要。

## Comments

### 2026-09-30 · 实现完成（补丁 `0024` 重导出）

**做了什么**

- 补丁 `0024` 重导出：1808 行、69 个 zero-context hunk（原 1857 行、74 个）；相对上游 +1047 / −683，其中新文件 `galley_im_display.py`
  270 行，tgapp +777 / −683。流程：只读克隆 `<scratchpad>/ga-replay05` checkout `1b6442f`，先按已提交的补丁栈用 build 脚本重建，
  `git status managed-ga/code` 干净；再在 scratch git 仓 `05-work` 里改（基线是对 payload 反向应用旧 `0024` 得到的上游 tgapp，blob
  `647569f` 与补丁 index 行一致；动手前先核对该仓 `git diff -U0` 与旧补丁逐字节相同），然后重导出、重建，产物逐字节一致。
- live 面只剩静音状态消息。删掉的有：`_send_draft`、`_DRAFT_REFRESH_SECONDS`、`_DRAFT_KEEPALIVE_SECONDS`、`_CLEAR_DRAFT_AFTER_SEND`、
  `_STATUS_CLOCK_REFRESH_SECONDS`、上游的 `_make_draft_id`，以及 `0024` 自己加的 `_is_private`。`_LiveSurface.mode`（draft / status / None）
  换成布尔 `closed`；`_live_due` 只剩一条规则：首次直接发，此后文本变了、且距上次 ≥ 1.5 秒才编辑。`_retire_live` 去掉清草稿分支；
  `_post_stopped` 定格状态消息成为常规路径（没有状态消息或编辑失败时才另发一条）。模块顶部的注释按新形态改写，保留一句草稿弃用的原因。
- 去读秒：共享文件里的 `live_elapsed` 换成 `still_running_suffix(seconds)`，不满 60 秒返回 `""`，否则返回
  ` · 已 {M} 分钟 · 仍在运行`（向下取整），docstring 注明与 dcapp `_status_content` 同口径。排队行固定为 `·· 排队中`。模块 docstring 同步。
- 折叠头只留 b：删掉 `_FOLD_STYLE`、`_handle_fold_command`、`/fold` 分支、a / c 两支、按样式选分隔符的逻辑（固定空一行）和全部
  `TEMP(dogfood)` 注释。30 步截断与超长收窄保留；1 步也有头。
- 连带文档：
  - `managed-ga/patches/manifest.md` 的 `0024` 行：live 面改写，写明草稿因客户端上推留白被弃；折叠头写成定稿的 b；`/stop` 回执写明是定格的
    状态消息；共享文件函数名改为 `still_running_suffix`；removal condition 删掉 fold 那句。「Last replay verified」按本次重放改写，原先
    「新 `0024`」那段挪成 Previous replay。
  - `docs/ga-baseline.md` Step 8 的 Telegram 真机清单：改为状态消息，`/stop` 写成定格回执。item 15 与耦合地图里没有草稿措辞，未改。
- 测试 `runner/tests/test_managed_telegram_tgapp.py`，共 42 条（原 43）：
  - 删掉：草稿、读秒三档、草稿保活、草稿失败回退、清草稿开关、`/fold` 切换与 a / c 变体。
  - fakes：去掉 draft 接口，加 `shown()`（发出时的文本加每次编辑）和 `statuses()` / `others()`。
  - 新增或改写：
    - 私聊状态消息：`disable_notification=True`，原地编辑，回答后删除；多步状态行。
    - 分钟行：59 秒无后缀，60 秒「已 1 分钟」，1 分 59 秒不重复编辑，2 分钟，步落定后归零。
    - 排队行等了 125 秒仍不带时间。
    - 失败路径：状态消息发送失败时本 run 无 live 面；RetryAfter 退避；删除失败时的兜底文案。
    - 停止：私聊 `/stop` 定格且不另发；没有状态消息时 `/stop` 另发回执。
    - 折叠头 b 是唯一形态：`/fold a` 落到 HELP_TEXT，模块里没有 `_FOLD_STYLE`。
    - ask 续跑、`/new`、`/continue n` 的断言换成状态消息的口径。

**偏差与自行裁量**

1. **`_should_quote` 的锚点改了一处，票面写的是「不变」。** 原逻辑是：有状态消息就拿它当锚点，最后一条已知消息就是它时不引用。私聊改走状态消息后，
   这条规则在排队场景下会退化。同一聊天里第二个 run 的状态消息，要等第一个 run 结束、它成了该聊天的首个 run 才发出；这时第一个回答已经落在
   「two」与这条状态消息之间。按原逻辑以状态消息为锚点，第二个回答就不再引用「two」。草稿时期的锚点是触发消息，这种情况会引用
   （原测试 `test_queued_behind_reporter_turn_and_other_messages` 断言的正是 `do_quote is True`）。
   改法：`_LiveSurface.anchor` 初值为触发消息；发状态消息之前，若还没有别的消息落在触发消息之后（即此刻 `_should_quote` 为假），
   状态消息才接替成为锚点。状态消息紧贴触发消息的常规情况，行为与原来完全一致；群聊里晚发的状态消息同样受益。
   做过变异核对：把这一处改回「总是接替」，只有 `test_queued_line_has_no_time_and_answers_quote_their_triggers` 失败。
   要回到票面原样，删掉 `_flush_live` 里 `below` 那三行，再把该测试对第二个回答的断言改成 `False`。
2. **分钟行只从 GA 的第一个 item 起算。** 原来 `step_started_at` 为空时用登记时间 `queued_at` 兜底：报告轮结束、GA 刚接手但第一个 item
   还没到的空窗里，排队时间会被算进「思考中」，排了 2 分钟就可能闪一下「已 2 分钟 · 仍在运行」。现在与 dcapp 一致：还没有 item 时
   只显示 `·· 思考中`。GA 每步开头就会吐 `LLM Running (Turn N)`（`agentmain.py` 遇到 `'LLM Running' in chunk` 立即入队），
   这个空窗很短。`queued_at` 随之无用，已删除。
3. **上游 import 行里的 `random` 没删。** 它原本只给上游的 `_make_draft_id` 用。删 import 要在上游第 1 行多压一个 hunk，upstream 改
   import 时 rebase 会冲突。未使用的 import 不影响运行，payload 也不跑 ruff。
4. **`/new`、`/continue 1` 的顺序。** 定格后，停止回执就是原来那条状态消息（位于命令之前），🆕 或「✅ 已恢复」在它下面，仍满足 02
   要求的「先 ⏹ 后 🆕」。

**门禁（实际输出）**

- 基线：改前 `bash scripts/build-managed-ga.sh <scratchpad>/ga-replay05`，23 个补丁全部 apply，`git status --short managed-ga` 无输出。
- 重导出后重建：`Applied managed GA patch` 共 23 行，`Managed GA payload compile sweep: OK`；`cmp` 两个文件与作者版本逐字节一致
  （最后一次改动后又完整重建一遍，结果相同）；克隆的 `git status --porcelain` 为空。
- `.venv/bin/python -m pytest`：`406 passed, 6 deselected in 3.36s`。tgapp 测试单独连跑 8 次，均为 `42 passed`。
- `.venv/bin/python -m mypy runner`：`Success: no issues found in 25 source files`。
- `.venv/bin/ruff check runner`：`All checks passed!`。
- `git diff --check`：无输出。
- `node scripts/check-managed-ga-payload.mjs`：`[managed-ga-payload] OK`。
- `node scripts/check-ga-baseline-drift.mjs`：`[ga-baseline-drift] OK (1b6442fe)`。
- `grep -n "draft\|_FOLD_STYLE\|TEMP(dogfood)\|/fold" managed-ga/code/frontends/tgapp.py`：只命中第 192 行，即说明草稿弃用原因的那句注释。
- 编译：系统 python 3.14.4 与 Galley.app 自带的 3.11.15 编译两个文件均通过。
- PTB 22.8 签名核对（`<scratchpad>/05-ptb_check.py`，用真实的 `telegram` 包）：私聊、群聊各跑一遍，以下调用均按真签名 bind 通过：
  状态消息发送 `reply_text(disable_notification)`、编辑 `edit_text`、回答 `reply_text(disable_notification, do_quote, parse_mode)`、
  `delete`、定格用的 `edit_text`。

**主会话要看的点**

- 偏差 1 需要裁决：接受（推荐，保住草稿时期的引用行为），或回退到票面原样。
- 真机要看：
  - ① 私聊状态消息的观感：静音，但 app 在后台时仍有无声横幅，devlog 已记为代价。
  - ② 长步骤满 60 秒出现「已 1 分钟 · 仍在运行」，此后每分钟变一次。
  - ③ `/stop` 后状态消息原地变成 `⏹ 已停止 · …`，没有第二条消息。
  - ④ 折叠头 b 被 Telegram 接受；被拒会在 `telegram.log` 留下 `[TG markdown fallback]`。
- 真机前要重启 Telegram 子进程：Python 不热更，dev 里在跑的还是旧 `0024`。
- devlog、PRD 由主会话写。`galley_im_display.py` 的模块 docstring 仍指向「2026-09-30 Telegram conversation UX devlog」里的迁移条件。
