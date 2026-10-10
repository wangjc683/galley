# 02 微信完成汇报（reporter 的微信 channel）

Status: done
PRD：[../PRD.md](../PRD.md)（问题 10、裁决 4 的 D、形态表最后一行）
与 01 并行：01 新建 `runner/im_wechat.py`，本票**不改它**，只按 01「给 02 的接口」一节的契约消费；01 负责在 `_run_wechat` 里接线调用
`im_reporter.start_wechat_reporter(conversation, state_dir)`。本票不改 `runner/managed_im_supervisor.py`。
参照：`runner/im_reporter.py` 的 `TelegramChannel` / `TelegramReporter` / `start_telegram_reporter`（单渠道、单 owner 的同构实现）

## 背景

委派出去的 Galley session 跑完后，reporter 往 owning GA agent 注入一轮合成的汇报（`source="galley_reporter"`），把模型写的汇报发给 owner。
飞书 / Telegram / Discord 都有，微信没有（[deferred「微信渠道的任务完成汇报」](../../../docs/devlog/deferred.md)，本次翻案）。
2026-10-10 真机探针证实：不带 `context_token`、或带几分钟前的旧 token，主动消息都能送达。Core 已对所有平台注入 `GALLEY_SUPERVISOR_ID`
（`core/src/im_supervisor/manager.rs:228`），路由不用改。

## 做什么

### `runner/im_reporter.py`

- `WechatChannel(ChannelAdapter)`，构造参数是 01 的 conversation 对象：
  - `connected()` → `conversation.connected()`
  - `owner_id()` → `conversation.owner_id()`（微信没有配对绑定：owner 是最近发消息的用户，01 负责持久化）
  - `busy()` → `conversation.busy()`
  - `agent()` → `conversation.agent`
  - `render(raw)`：汇报轮的 `done` 全文 → 只取收尾那一步、清洗，与 01 回答正文同口径。用 `galley_im_display` 的
    `answer_body(final_step_text(raw, outputs), raw)`——reporter 拿不到 outputs 时按 `TelegramChannel.render` 现在依赖 tgapp `answer_text`
    的做法找等价路径（必要时请 01 在 `runner/im_wechat.py` 暴露一个纯函数 `answer_text(raw) -> str`：本票先在 reporter 里实现，Comments 写明，
    主会话集成时去重）。`[FILE:]` 标记渲染成文件名；汇报只发文字（同 Telegram：生成的文件留在 Galley session 里）。
  - `send(owner, text, raw)` → `conversation.send_text(owner, text)`（失败抛异常，`_deliver` 计重试）
  - `send_report(owner, text, raw, report)`：纯文本三段——

```
✅ {session 标题}            ← ✅ 完成 / ⏹ 停止 / ❌ 出错，同 telegram_report_outcome 的图标；标题为空用 session id

{汇报正文}

{状态词} · {session id}      ← report_status_word；末行，与微信回答「元数据放末行」一致
```

    微信渲染 Markdown（探针），但标题行**不加粗**（保持与回答末行同为纯文本的安静口径）；标题里的换行压成空格。
    没有内容可发时抛 `ReporterCliError`（同 Telegram：静默返回会被记成已送达）。
- `WechatReporter(ImReporter)` + `start_wechat_reporter(conversation, state_dir) -> WechatReporter | None`，照 `start_telegram_reporter`。
- 模块头 docstring 的渠道清单补上微信（「Feishu and Telegram register exactly one channel」一句）。

### Core：断开连接清掉 owner

`core/src/im_supervisor/mod.rs` `remove_conversation_state`：微信时额外删 `wechat_owner.json`（与 `context_log.json` 同理：断开 = 对话结束，
重连可能换了微信号）。补 / 改该函数的 Rust 单测（同文件 `:298` 起那组断言：删的删、留的留）。`token.json` 的删除逻辑不动。

## 测试

- `runner/tests/test_im_reporter.py`：用一个满足契约的 fake conversation（不依赖 01 的实现）覆盖：
  1. 完成 / 停止 / 出错三种 `send_report` 的文本（标题图标、空标题回退 id、末行状态词与 id）；
  2. `render` 只留收尾一步、去回显与 `<summary>`、`[FILE:]` 成文件名；
  3. `send_text` 抛异常 → `_deliver` 计重试、不标已送达；
  4. 没有 owner（从没人说过话）→ 不触发汇报；
  5. `busy()` 为真时不注入汇报轮；
  6. 渲染为空 → 抛错。
- 若方便，加一条「真实 `galley_im_display` + reporter」端到端（同 `test_reporter_through_real_tgapp_seams` 的思路）。
- Core：`cargo test --manifest-path core/Cargo.toml --workspace`（只跑 im_supervisor 相关也可，最后全量过一遍）。

## 验证

```bash
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
cargo test --manifest-path core/Cargo.toml --workspace
git diff --check
```

`cargo check` 撞 sidecar 缺失时：在 `core/target/tauri-sidecars` 放占位文件即可（tauri `build.rs` 只查存在性）。
Rust 只格式化自己动过的文件（`rustfmt --check <file>`，不要 `cargo fmt --all`）。

不提交；不碰 `runner/im_wechat.py`、`runner/managed_im_supervisor.py`、`managed-ga/`、`gui/`、`docs/`。

## Comments

### 2026-10-10 实施记录（02 子代理）

改动：`runner/im_reporter.py`（`WechatChannel` / `WechatReporter` / `start_wechat_reporter`，纯函数 `wechat_answer_text` / `wechat_report_text`，模块头渠道清单与两处 docstring 补上微信）；
`runner/tests/test_im_reporter.py`（末尾「WeChat channel adapter」一节，另改文件头与飞书用例的 docstring）；
`core/src/im_supervisor/mod.rs`（`remove_conversation_state` 微信多删 `wechat_owner.json`，doc comment 与单测同步）。

决定与偏差：

1. **收尾一步怎么找**：`ChannelAdapter.render(raw)` 只拿到 `done` 全文（`_deliver` 收到的 `done` item 其实带 `outputs`，但给共享接口加参数超出本票），
   照 tgapp `answer_text` 从最后一个 `LLM Running (Turn k) ...` 标记行切，正则与 tgapp `_TURN_MARKER_LINE_RE` 相同（粗体标记也认）。
   GA 每步以 `\n{turnstr}\n\n` 开头（`agent_loop.py:51-55`），切出来就等于 `final_step_text(raw, outputs)`，GA 追加在尾部的后端错误块（`agentmain.py:236`）也算收尾一步。
   已知边界同 tgapp：模型正文里自己写出一整行标记会切错。
2. **清洗口径**：`[FILE:path]` 先渲染成 `basename`（step 与 raw 都渲染，同 tgapp `_file_names`），再 `galley_im_display.answer_body(step, raw)`，
   然后删 `![…](…)`（正则取上游 `_strip_md` 的 `!\[.*?\]\(.*?\)`）、压 `\n{3,}`；其余 Markdown 原样（01「Markdown 不再改写」）。
   `<goal-status>` / `<next-suggestion>` 已在 `chatapp_common.clean_reply` 的 `TAG_PATS` 里，`_deliver` 也会再删一遍，不用补。
3. **去重**：`wechat_answer_text(raw)` 就是票里「先在 reporter 里实现」的那份。01 若在 `runner/im_wechat.py` 暴露 `answer_text(raw)`，集成时二选一，删图片的正则要与 01 对齐。
4. **导入方式**：`render` 调用时 `importlib.import_module("galley_im_display")`（同 `im_resume.load` 导 `continue_cmd` 的写法，mypy 下是 `Any`，不用 `type: ignore`）。
   导入失败落在 `_deliver` 的 try 里，记一次重试，不拖垮渠道。
5. **报告文本**：`{图标} {标题}\n\n{正文}\n\n{状态词} · {session id}`，一次 `send_text`（分段交给 conversation）。图标直接复用 `telegram_report_outcome`，没另起中性函数，免得动 Telegram 代码。
   标题用 `\s+` 压成一个空格，比「换行压成空格」略宽（连续空白也合并）。标题里的 Markdown 符号不剥：TG 剥是因为会让整条 MarkdownV2 被拒，微信只会照样渲染。
6. **「渲染为空 → 抛错」的解读**：抛错放在 `send_report`，正文为空或全是空白时抛 `ReporterCliError`，不发只有标题的消息。
   `render` 返回空时，`_deliver` 照共享语义当「没什么可报」记已送达、不发（TG / DC / 飞书同样如此，`SKIP_REPORT` 走同一路），本票不改共享的 `_deliver`。
   所以经 tick 时 `send_report` 只会拿到非空正文，这条抛错只兜直接调用。
7. `owner_id()`：conversation 返回空串也当没有 owner。
8. **测试**：fake conversation 只实现契约五项。`wx_display` fixture 加载 `managed-ga/code/frontends` 下真实的 `chatapp_common` + `galley_im_display`（按 flat 名注册，
   `agentmain` / `continue_cmd` / `btw_cmd` / `review_cmd` 打桩）。覆盖票面 1–6，外加真实显示规则端到端、停止 / 出错两种死状态走 tick、`SKIP_REPORT`、
   `start_wechat_reporter`（没有 env 返回 `None`；有 env 注册 `galley-im/wechat`，状态文件在 `state_dir/reporter_state.json`）。
   Rust 单测补了：Telegram / Discord 不删 `wechat_owner.json`；微信删它和 `context_log.json`；`token.json`、`reporter_state.json` 保留。

给主会话的观察（都没改，集成时确认）：

- **`chatapp_common` 的导入副作用**：`galley_im_display` 在模块顶层 `from chatapp_common import …`，而 `chatapp_common` 一导入就把 `continue_cmd` / `btw_cmd` / `review_cmd`
  装到 GA 类上（`chatapp_common.py:354-358`）。上游 `wechatapp` 从不导入 `chatapp_common`，所以微信进程一旦导入 `galley_im_display`（01 的回答清洗、本票的 `render`），
  `/btw`、`/review`、`/continue` 就会在 GA 的 `_handle_slash_cmd` 里被拦截，不再作为普通任务交给模型。这与 01「其余 `/` 开头照上游原样入队」的描述有出入，
  也可能正是想要的跨渠道一致。
- **`send_text` 必须抛异常这一条要靠 01 自己判**：上游 `WxBotClient._post` 只 `raise_for_status()`，iLink 用 HTTP 200 + `ret` / `errcode` 报的业务错误会原样返回、不抛。
  01 的 `send_text` 若不检查返回体，发送失败的汇报会被记成已送达。
- **重登录不清 owner**：Core 的 relogin 只删 `token.json`（`manager.rs:187`），`wechat_owner.json` 留着；换了微信号重登录后，汇报会发给旧 owner，
  多半失败，重试 3 次后放弃，等新号的人说话才换 owner。票只要求 Disconnect，这里没动。
- 断开只删 owner，`reporter_state.json` 保留（各平台一致）。断开期间落定、路由到 `galley-im/wechat` 的汇报会挂着，重连后第一个说话的人（可能换了号）会收到。
  与 Telegram 换绑同构，记一笔。

验证：`pytest runner/tests/test_im_reporter.py` 89 passed；`pytest` 524 passed, 6 deselected；`mypy runner` 无问题（32 文件）；`ruff check runner` 通过；
`cargo test --workspace` 12 个测试二进制共 604 passed、0 failed；`rustfmt --check core/src/im_supervisor/mod.rs` 只报 `manager.rs:657` 一处既有差异（非本票）；`git diff --check` 干净。

### 2026-10-10 主会话集成

- 去重：`wechat_answer_text` 及其三条正则删除，`WechatChannel.render` 改调 `im_wechat.answer_text`（汇报与回答同一口径）。
- 「重登录不清 owner」已补：Core relogin 分支同时删 `wechat_owner.json`（`manager.rs`）；没有 owner 时 reporter 跳过该渠道、汇报挂着等新号说话。
- 「`send_text` 要抛」已由 01 补 `_check_sent`（`WechatSendError`）。
- `chatapp_common` 导入副作用：接受（与其他渠道一致）；`/continue` 由 01 改为走 `continue_session`。
