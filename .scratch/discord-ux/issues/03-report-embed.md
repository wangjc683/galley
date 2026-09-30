# 03 完成报告改 embed 卡片

Status: done
Blocked by: —（与 01/02 并行；dcapp 侧的 seam 由 01 按下面接口实现，本票只动 runner）
PRD：[../PRD.md](../PRD.md)

## 做什么

`runner/im_reporter.py` 的 Discord 完成报告从纯文本改成 embed，让「后台任务跑完推回来的报告」和「刚才的回答」一眼可分，
一个频道同时派出多个任务时也能从卡片标题认出是哪个 session。类比桌面 Goal 收口标记（✓ 已完成 / ⏹ 已停止 / ✕ 失败 + 色）。
飞书 / Telegram 路径**零行为变化**。

## 规格

- embed 字段：
  - `title` = session 标题（`report.session["title"]`，空则用 id）。
  - `description` = 现有流程渲染出的报告正文（`channel.render(raw)` 再剥 next-suggestion / goal-status 之后的 `text`，即现在交给 `send` 的那段）。
  - `color`（取自 `docs/design/foundations.md` 的 light token）：`completed` → `0x5A8C5A`（success）；`error` 及其他非 cancelled 的死态 →
    `0xB14545`（error）；`cancelled` → `0x7A7A8E`（info，中性；桌面「已停止」同为中性墨）。
  - `footer` = `{状态词} · {session_id}`，状态词：completed「已完成」、cancelled「已停止」、其余「出错」。
- 正文 > 4096：embed 放前段（在 4096 内按换行切，切不到就硬切），余下的用现有 `deliver_text` 紧跟着发（它自带 1900 切分）。
- 回退：`app` 没有 `deliver_embed`（老 payload）时走原来的 `deliver_text` 纯文本，行为与现在一致。

## dcapp seam（01 实现，接口定死，按此编码）

```python
async def deliver_embed(self, chat_id, *, title, description, color=None, footer=None):
    # strict: raises on resolve/send failure (same contract as deliver_text)
    # truncates title to 256 / footer to 2048; raises ValueError if description > 4096
```
与 `deliver_text` 一样经 `asyncio.run_coroutine_threadsafe(..., app.loop).result(DISCORD_SEND_TIMEOUT_SEC)` 调用，异常必须冒出去
（`_deliver` 靠它把失败计入 `reportAttempts`，吞掉就会把没送达的报告标成已送达）。

## 实现约束

- 报告的 kind / session 目前传不到 `ChannelAdapter.send(owner, text, raw)`。给基类加一个带 `report` 的发送入口
  （例如 `send_report(owner, text, raw, report)`，默认实现调用 `send(owner, text, raw)`），`_deliver` 改调它，
  只有 `DiscordChannel` 覆盖。不要改 Feishu / Telegram adapter 的签名与行为。
- 沿用文件现有风格（类型标注、docstring 说明「为什么」、mypy strict）。

## 验证

- `runner/tests/test_im_reporter.py` 里已有 `_StubDiscordApp`（约 497 行起）：给它加 `deliver_embed` 记录调用，覆盖
  三种 kind 的颜色与 footer、标题空回退 id、> 4096 的分段（embed + 余下 deliver_text）、`deliver_embed` 抛错 → 结果为 retry
  且不 mark_reported、无 `deliver_embed` 的 stub app 回退纯文本、Feishu / Telegram 仍走 `send`。
- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 全绿（`.venv` 已建好）。
- 只动 `runner/im_reporter.py` 与 `runner/tests/test_im_reporter.py`；**不要碰 `managed-ga/`**（另一个 agent 正在改 dcapp 与补丁）。

## Comments

### 2026-09-30 · runner 侧实现完成（Opus 子代理）

**做了什么**

- `ChannelAdapter` 新增 `send_report(owner, text, raw, report)`，默认实现就是 `self.send(owner, text, raw)`；`_deliver` 改调它。只有 `DiscordChannel` 覆盖；`FeishuChannel` / `TelegramChannel` 一行未动，继承默认实现，行为逐字节不变。
- `DiscordChannel.send_report`：app 有 `deliver_embed` 时发卡片——`title` = session 标题（缺失或纯空白回退 id），`color` 按 kind（`completed` `0x5A8C5A` / `cancelled` `0x7A7A8E` / 其余 `0xB14545`，已对过 `docs/design/foundations.md:97-100`），`footer` = `{状态词} · {session_id}`。正文 > 4096 时卡片放前段、余下经 `deliver_text` 紧跟着发；两段各自 `run_coroutine_threadsafe(...).result(DISCORD_SEND_TIMEOUT_SEC)`，先卡片后余段，任一段抛错都冒到 `_deliver` 计 retry。app 没有 `deliver_embed` 时走原 `send`（整段交 `deliver_text`，与现在一致）。卡片发送**失败**不降级成纯文本——回退只针对「没有 seam」，失败一律 retry。
- 新增纯函数 `discord_report_outcome(kind)`（色值 + 状态词）与 `split_embed_description(text)`（取 4096 内最后一个换行切，切不到硬切）；抽出 `DiscordChannel._running_app()`，`send` 与 `send_report` 共用取 app / loop 的逻辑（`send` 行为不变）。
- 测试：原 `_StubDiscordApp` 拆成 `_LegacyDiscordApp`（无 seam，老 payload）+ `_StubDiscordApp`（带 `deliver_embed`，description 超 4096 抛 `ValueError`，照 seam 合约）；原先断言 `app.sent` 的三个 Discord 用例改断言卡片。新增 9 个用例（参数化后 14 个）：切分纯函数、outcome 映射（含未知死态）、三种 kind 的颜色与 footer（端到端 tick）、标题回退（`""` / 纯空白 / `None`）、> 4096 分段与发送顺序、卡片失败 → retry 且不 mark_reported（下一 tick 重试成功）、余段失败 → `_deliver` 返回 `retry`、无 seam 回退纯文本（长文不在 reporter 侧切）、Feishu / Telegram 仍走 `send`（结构断言 + 飞书 cancelled 报告端到端）。

**偏差**（都是规格没覆盖的边角，不改规格本身）

1. 「标题空」按 `strip()` 后为空判定，纯空白标题也回退 id。
2. 切点两侧的空行去掉（前段 `rstrip()`、余段去前导换行）；余段若只剩空白则不发——dcapp 的 `_split_discord_text` 会把空文本发成字面量「...」。

**已知取舍**（未处理，记录在此）

- 余段失败时卡片已发出，retry 会重跑报告回合、整份重发——与多段 `deliver_text` 中途失败的既有语义一致；报告提示词要求 1-3 句，> 4096 本就罕见。
- 切分不感知 ``` 围栏（dcapp 的文本切分器感知）：切点落在代码块内时，卡片尾与余段各带半个代码块。

**验证**

- `.venv/bin/python -m pytest` → 309 passed，6 deselected（本轮运行时 `runner/tests/test_managed_discord_dcapp.py` 尚不存在，01 在途）
- `.venv/bin/python -m pytest runner/tests/test_im_reporter.py` → 46 passed
- `.venv/bin/python -m mypy runner` → Success: no issues found in 23 source files
- `.venv/bin/ruff check runner` → All checks passed!
- `git diff --check -- runner/im_reporter.py runner/tests/test_im_reporter.py` → 无输出
- 变异检查：把 `_deliver` 临时改回调 `send`，12 个 Discord 用例转红；已还原并复跑全绿。

**接 01 真 seam 时核对**

- `deliver_embed` 必须是 `async def`，且签名为 `(chat_id, *, title, description, color=None, footer=None)`：reporter 用 `run_coroutine_threadsafe` 调，同步实现会直接 `TypeError` → 永远 retry 直到 gave_up。
- reporter 靠 `callable(getattr(app, "deliver_embed", None))` 探测 seam，属性名要一致。
- 4096 两边都按 Python `len()` 计；seam 若换计数口径（如 UTF-16），`split_embed_description` 要同步改。
- Bot 需要 Embed Links 权限：接入指引要求 Administrator（`gui/src/i18n/locales/zh.ts:1359`），满足；用户自行缩权时 Discord 是回 403 还是静默吞掉 embed，未核实，真机（04）可顺带看。
