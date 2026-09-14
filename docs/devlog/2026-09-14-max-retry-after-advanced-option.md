# 2026-09-14 · 高级配置开放 `max_retry_after`：中转站 Retry-After 超 60 秒的出口

> Status: implemented · Related:
> `docs/design/overlays-and-settings.md` §编辑模型高级配置 ·
> `gui/src/components/screens/settings/models/AdvancedModelOptions.tsx` ·
> `managed-ga/patches/0021-managed-retry-after-value-in-error.patch` ·
> [deferred：重试等待期间的 GUI 反馈](./deferred.md#重试等待期间的-gui-反馈)

## Context

社区用户（自称最新版）贴来报错：

```
!!!Error: HTTP 524 (retry-after > 60s): <!DOCTYPE html> … cc-ai.xyz | 524: A timeout occurred …
```

对表结论：不是 Galley 的 bug。`524` 是 Cloudflare 的「源站超时」，来源是用户
配的中转站 cc-ai.xyz；HTML 是 Cloudflare 错误页的前 500 字符。括号里的
`retry-after > 60s` 来自内核 `_stream_with_retry`：524 在可重试集合里，本该
退避重试，但这次响应带了 `Retry-After` 头且值超过 `max_retry_after` 上限
（默认 60 秒，v0.4.2 跟进上游 `d8d90ee` 时引入），内核选择不阻塞、直接报错。
版本新旧与此无关。

两个容易混的旋钮：

- `read_timeout`（已开放，「读取超时」，默认 180 秒）管「等响应多久」。这次
  帮不上：Cloudflare 自己的源站超时约 100 秒，先于 Galley 的 180 秒掐断。
- `max_retry_after` 管「服务器让我等多久再重发，我最多肯睡多久」。这才是
  这条报错对应的旋钮。

## Decisions

### D1. 开放 `max_retry_after`，位置是模型高级配置（JC 裁决）

我最初投「先不开放」：不知道中转站要求的实际秒数，旋钮对这个用户有没有用
没把握；等待期间 GUI 无反馈，调大等于把静默转圈变长；高级面板已是「GA 预算」
区。JC 权衡后决定开放：用户如果需要为自己的中转站等更久，应该有地方调。

位置只有一个合理答案：它是端点级属性（某个中转站的 Retry-After 行为），
不是引擎属性，不进 Settings → 运行时；它是策展字段不是自由 KV，符合
issue #26 那轮的裁决；`overlays-and-settings.md` 的准入条款「只开放排障/
适配项」直接命中，不用重审规范。面板里已有同一条重试链路的两个亲戚
（重试次数 / 读取超时），放同一个两列网格，第四个正好补齐一行。两种协议
都显示。

管线本来就通：`advancedOptions` 经 `managed_model_config_from_env` 的
`cfg.update` 原样进内核 session 配置，Rust 侧 `normalize_managed_model_advanced_options`
是合并不是白名单。缺的只是 GUI 入口，与 deferred 里 `api_key_header` 那条同型。

### D2. 未设置 = 不写键，不进推荐默认值

两种存法：像 `max_retries` 那样把 `max_retry_after: 60` 写进 Rust 与 presets
的推荐默认值；或像 `trim_keep_prefix` 那样未设置就不写键、由内核用 60。选
后者：生成的模型配置保持最小，presets 十来处预设块不用逐个补，「恢复推荐值」
自然把它删掉。GUI 里填回 60 也等价于删键（`ENGINE_MAX_RETRY_AFTER` 常量）。
「N 项已自定义」计数把它算进去。

### D3. 报错文案带上服务商要求的实际秒数（补丁 `0021`）

原文案 `(retry-after > 60s)` 把 Retry-After 的值吞掉了，用户看到报错也不知道
该把上限调到多少，旋钮与报错之间没有闭环。`0021` 一行改写 `err =` 行，现在
读作 `(retry-after 120s > 60s cap)`。补丁在 `0007` 之后（`0007` 在同函数上方
两行插入 codex 429 富化）；本地 GA checkout 不在基线提交上，用
`git apply --check --directory=managed-ga/code` 在末位验证 + `py_compile`，
等价于末位补丁的完整重放。runner 加了一条测试锁住文案。

### D4. 文案

标签「重试等待上限 / Max retry wait」，单位秒，带 info：「服务商要求稍后重试
时，最多等待这么久再自动重发；超过则直接报错。部分中转站会要求等待超过
60 秒，可按需调大。」不提内核，符合 copy 规则。

## Rejected / Deferred

- **Settings → 运行时放全局旋钮**：否。运行时页是引擎级（Python、内核版本、
  诊断），这个参数按端点变。
- **改语义为「睡到上限再重试」而不加配置**：暂缓。对无人值守的 Goal /
  Supervisor 场景是真正的韧性改善，但偏离上游重试语义，应先给上游提；
  触发信号是无人值守任务因可重试错误直接死掉的投诉。
- **重试等待期间的 GUI 反馈**：不进本次。内核只 `print` 一行 `[LLM Retry]`，
  core / runner / gui 无人消费；停止按钮能打断（`agentmain.py` 接了
  `should_stop`），先接受静默。进 deferred，触发信号见那里。

## Verification

- `pnpm --dir gui typecheck` / `lint` 绿。
- `.venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py`：
  16 passed（含新增 `test_retry_after_over_cap_error_carries_server_value`）。
- `git apply --unidiff-zero --recount --directory=managed-ga/code --check`
  0021 通过，应用后 `py_compile` 通过。
- JC 真机验收：编辑模型 → 高级配置，四个数字字段一行两列两行；填 120 后
  `managed-models.json` 出现 `max_retry_after: 120`，填回 60 键消失。
