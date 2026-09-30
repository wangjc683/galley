# 03 完成报告格式化（Telegram）

Status: done
Blocked by: —（依赖 01 提供的 tgapp seam，但接口已定死，可并行；老 payload 没有 seam 时必须退回现行为）
PRD：[../PRD.md](../PRD.md) 问题 5；母本 `.scratch/discord-ux/issues/03-report-embed.md`（Discord 的 embed 卡片，同一个 `send_report` seam）

## 做什么

`runner/im_reporter.py` 的 `TelegramChannel`：

1. **`render(raw)`**：现在是 `clean_reply(raw)` + 文件标记，`raw` 是报告轮的全量 `done` 文本，所以 `LLM Running (Turn k) ...` 标记和
   `🛠️ tool(args)` 回显会漏进报告。改为：`tgapp.answer_text` 可调用时用它（只取收尾那一步、清洗干净）；否则保持现逻辑。
   `_deliver` 里的 SKIP / 空文本判断在 render 之后，语义不变（SKIP 回复就在收尾那一步里）。
2. **覆盖 `send_report(owner, text, raw, report)`**（`ChannelAdapter` 的 seam，Discord 已覆盖成 embed）：
   - 组成 Markdown 源文本：
     ```
     **{icon} {title}**

     {text}

     _{状态词} · {session_id}_
     ```
     `title` = `report.session["title"]`（去空白后为空则用 session id），先去掉其中的 `*` `_` `` ` `` 字符以免破坏粗体；
     `icon` / 状态词按 `report.kind`：completed → `✅` / `已完成`；cancelled → `⏹` / `已停止`；其余 → `❌` / `出错`。
     状态词与 Discord 的 `discord_report_outcome` 同一套，抽一个平台无关的小函数两边共用（Discord 行为逐字节不变）。
   - `tgapp.markdown_v2_segments` 可调用时：对上面的源文本取 `(markdown_v2, plain)` 段列表，逐段 `sendMessage`
     带 `"parse_mode": "MarkdownV2"`；某段 HTTP 400（Telegram 拒绝实体解析）→ 该段改发 `plain`、不带 parse_mode；其他失败照旧 raise
     （算 retry，不降级）。
   - seam 不存在（老 payload）→ 调现有 `self.send(owner, text, raw)`，行为逐字节不变。
3. `_telegram_send_text` 加可选 `parse_mode` 参数（默认 None 时 payload 与现在完全一致）；400 的判定用 `urllib.error.HTTPError.code == 400`。

tgapp seam 契约（01 实现，原文）：

```python
def answer_text(raw):
    """User-visible answer of a finished task's full `done` text: the closing
    step only (split on the `LLM Running (Turn N) ...` marker lines; tool
    echoes, tool output and tags stripped, same cleaning as a live answer),
    [FILE:] markers rendered as file names. Returns "" when nothing visible
    remains."""

def markdown_v2_segments(text):
    """Split Markdown `text` for sending as Telegram messages: a list of
    (markdown_v2, plain) pairs, each within MessageLimit.MAX_TEXT_LENGTH once
    converted. Applies the same Markdown rewrite as answers (tables to lists,
    headings to bold lines, …) before conversion. `plain` is the fallback the
    caller sends without parse_mode when Telegram rejects the MarkdownV2."""
```

## 别动什么

- `managed-ga/` 下任何文件（01/02 的域，另一个 agent 正在改）；`runner/tests/test_managed_telegram_tgapp.py`（01 新建）。
- 飞书、Discord、微信的 reporter 行为逐字节不变；`TelegramChannel.busy()` / `connected()` / `owner_id()` 不变。
- 报告仍只发文本、不带附件（既有已知限制，不在本票范围）。

## 验证

- `runner/tests/test_im_reporter.py` 加测试（假 tgapp 对象提供 / 不提供两个 seam；monkeypatch 掉 HTTP 发送，记录 payload）：
  render 走 seam 与回退；三种 kind 的标题行 / 脚注；title 为空回退 id、title 含 `*_`` ` 被去掉；多段逐段发送且顺序正确；
  某段 400 → 该段纯文本重发、其余段仍 MarkdownV2；非 400 失败冒泡；无 seam 时 payload 与现在逐字节一致（没有 parse_mode 键）；
  Discord 的状态词抽取后既有测试全绿。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 全绿；`git diff --check` 干净。

## 回报

在本文件末尾追加 `## Comments`：做了什么、偏差与自行裁量（附理由）、验证命令与结果、集成方（04）要看的点。回复主会话时给出同样的摘要。
**不要 commit**，只改 `runner/im_reporter.py`、`runner/tests/test_im_reporter.py` 与本票面。

## Comments

### 2026-09-30 · runner 侧实现完成（Opus 子代理）

**做了什么**

- `render(raw)`：`tgapp.answer_text` 可调用时返回 `str(answer_text(raw) or "")`（只取收尾那一步）；否则走原来的 `clean_reply` + `_render_file_markers`，一行未改。空 `raw` 的短路保留在两条路径之前。`_deliver` 的 SKIP / 空文本判断未动，仍在 render 之后，SKIP 回复从收尾那一步里认出来（有测试：前一步带正文和 🛠️ 回显、收尾一步是 `SKIP_REPORT` → 不发、记为已报告）。
- 新增平台无关的 `report_status_word(kind)`（completed「已完成」/ cancelled「已停止」/ 其余「出错」），`discord_report_outcome` 改为调用它，返回值逐字节不变，Discord 既有用例全绿。
- 新增纯函数 `telegram_report_outcome(kind)`（`✅` / `⏹` / `❌` + 状态词）与 `telegram_report_markdown(text, report)`（组 Markdown 源文本：粗体标题行、正文、斜体脚注）。标题先删 `*` `_` `` ` ``，再去空白，为空回退 session id（所以只有标记符的标题也回退 id）。
- `TelegramChannel.send_report` 覆盖默认实现：`tgapp.markdown_v2_segments` 可调用时，对源文本取 `(markdown_v2, plain)` 段列表，逐段 `sendMessage` 带 `"parse_mode": "MarkdownV2"`；某段抛 `urllib.error.HTTPError` 且 `.code == 400` → 打一行日志后该段改发 `plain`、不带 parse_mode，其余段照常 MarkdownV2；其他任何失败（非 400 的 HTTPError、URLError、超时，以及 plain 重发本身失败）原样冒出，`_deliver` 计 retry。seam 不存在 → 调 `self.send(owner, text, raw)`，与现在一致。
- `_telegram_send_text` 加 `parse_mode: str | None = None`：为 None 时不加键，payload 与改前的 `json.dumps({"chat_id": ..., "text": ...})` 逐字节一致（有测试直接比对 `request.data`）。token 检查抽成 `_token()`，`send` 行为不变。
- `ChannelAdapter.send_report` 的 docstring 同步：默认实现现在只剩飞书在用。飞书 / 微信 / Discord 代码路径未动；`busy()` / `connected()` / `owner_id()` 未动；报告仍只发文本。

**偏差与自行裁量**

1. **脚注用 `*{状态词} · {id}*`，不用票面的 `_…_`。** 票面写的 `_…_` 经 tgapp 现行转换器会原样显示下划线：`_MD_TOKEN_RE` 只认 `(?<!\*)\*(?!\*)(…)\*` 这种单星号斜体（HEAD `managed-ga/code/frontends/tgapp.py:165-177`，转换在 `:321-350`），裸 `_` 被 `escape_markdown` 转义。用 Galley.app 自带 PTB 的 `escape_markdown` 跑 HEAD 的 `_to_markdown_v2` 实测：`_已完成 · s-mukvgzl6-aje3_` → `\_已完成 · s\-mukvgzl6\-aje3\_`（字面下划线）；`*已完成 · s-mukvgzl6-aje3*` → `_已完成 · s\-mukvgzl6\-aje3_`（斜体）；`**✅ Task s1**` → `*✅ Task s1*`（粗体）。在 CommonMark 里两种写法语义相同；01 如果额外支持了 `_…_`，星号形式也照样生效，所以星号形式两边都成立。文案（状态词 · id）逐字未变。
2. **seam 返回空段列表 → 抛 `ReporterCliError`（计 retry）。** 票面没写这一条。一段都不发就返回，等于把没送达的报告标成已送达，违反 `send` 的 MUST-raise 契约。
3. **400 回退时打一行日志**（`[galley-im-reporter] Telegram rejected report segment i/n as MarkdownV2 (<Telegram description>); resending it as plain text`）。票面没要求。不加日志的话，真机上只会看到一条没格式的报告，查不到原因。description 对实体解析错误只给字节偏移或保留字符，不含正文。
4. 标题只删票面点名的三个字符；回退用的 session id 不做删除（id 形如 `s-mukvgzl6-aje3`，本机 `workbench.db` 采样确认不含这三个字符）。

**已知取舍（未处理，记在这里）**

- 标题里如果有换行，粗体会断（`\*\*([^\n]+?)\*\*` 不跨行），标题行会露出 `**`。本机 131 个会话标题都没有换行，没做折行归一。
- 多段时某段失败：前面的段已经发出，retry 会重跑报告轮并整份重发。这和 Discord 卡片 + 余段、老路径多段 `split_text` 的既有语义一致；报告提示词要求 1-3 句，多段本来就少见。
- 报告第二段起没设 `disable_notification`（01 的回答是「第二段起不响」）。票面没要求，没加。

**验证**

- `.venv/bin/python -m pytest` → 364 passed, 6 deselected（运行时 `runner/tests/test_managed_telegram_tgapp.py` 还不存在，01 在途，所以不含它）
- `.venv/bin/python -m pytest runner/tests/test_im_reporter.py` → 67 passed（原 46 个 + 新增 21 个）
- `.venv/bin/python -m mypy runner` → Success: no issues found in 24 source files
- `.venv/bin/ruff check runner` → All checks passed!
- `git diff --check` → 无输出（exit 0）
- 新增用例：状态词两边共用（含未知死态）；三种 kind 的标题行与脚注；标题 `""` / 纯空白 / `None` / 只有标记符都回退 id，含 `*_`` ` 的标题删掉这些字符；render 走 seam 与回退；端到端 tick：seam 只收到一份源文本（无 Turn 标记、无 🛠️），三段按顺序、每段带 MarkdownV2；收尾步 SKIP；第 2 段 400 → 该段纯文本重发（无 parse_mode 键）、第 3 段仍 MarkdownV2，并断言日志；非 400（429 / 403 / URLError / 超时）→ retry、不 mark_reported、停在失败段、下一 tick 整份重发成功；plain 重发也 400 → 抛出；空段列表与缺 token → 抛出；无 seam → `request.data` 与改前表达式逐字节相等、无 parse_mode、URL / Content-Type 不变；`_telegram_send_text` 只在显式传 parse_mode 时加键。飞书用例改名为 `test_feishu_reports_still_go_through_send`（Telegram 已覆盖 `send_report`，原来的恒等断言去掉）。HTTP 层用假 `urlopen` 走真实的 `_telegram_send_text`，所以 `HTTPError.code == 400` 这个判定是真实触发的。
- 变异检查（改完跑、再还原）：send_report 无视 seam → 8 红；所有 HTTPError 都降级 → 2 红；parse_mode 恒加键 → 3 红；render 无视 answer_text → 8 红；空段列表不抛 → 1 红。还原后 67 全绿。

**集成方（04）要看的点**

- seam 探测是 `callable(getattr(tgapp, "answer_text" / "markdown_v2_segments", None))`：两个名字必须是 tgapp **模块级**可调用对象，而且是 `TelegramChannel.tgapp` 引用的那个模块对象。两个 seam 各自独立探测，只落地一个也不会崩。
- `markdown_v2_segments` 必须返回二元组的可迭代对象；返回空列表会被当作失败。`plain` 也要在 4096 以内，否则纯文本重发会 400 → retry。
- `plain` 回退里标题 / 脚注的 `**` `*` 是否剥掉，由 01 的 `plain` 决定；真机 400 回退时顺带看一眼是否露出星号。
- 真机第 7 项请确认：标题行是粗体、脚注是斜体（不是字面 `_`）、正文里的表格已经列表化、只剩收尾那一步。04 的回归测试如果拿真实 tgapp 串 `TelegramChannel`，脚注的断言请按 `*…*` 源文本 → MarkdownV2 `_…_` 来写。
- 报告轮 `done` 的形态依赖 01 的 `answer_text` 切分口径（`LLM Running (Turn N) ...` 标记行）；reporter 在它之后还会再剥一遍 `<next-suggestion>` / `<goal-status>`，重复剥无副作用。
