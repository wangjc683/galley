# 140 每次模型请求总时长封顶 5 分钟

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 188（裁决 162 当时没选的乙）。只改内置运行时的 GA（补丁栈加一个补丁）；外置零变化（宪法第 1 条：外置 GA 不打补丁）。

## 为什么

- 两次模型退化，各卡了 15 分钟：
  - 10-21 子任务第 2 步，`web_execute_js` 的参数里吐了 40 万个空白，903 秒（票 116）。票 118（补丁 `0030-managed-tool-args-whitespace-runaway.patch`）加了一道闸：参数里一连 2,000 个空白就截断。
  - 11-03 子任务第 2 步，同一个工具的参数里吐了约 82KB 循环乱码（「}u}g}6}#}t}e}…」，不是空白），901 秒。0030 的闸没拦住。
  - 两次都停在约 900 秒，像是服务端自己的 15 分钟上限；订阅登录这条路线发不了输出上限，读超时只管两段数据之间的空档。
- 底数（内置状态根引擎日志，每对 Prompt / Response 的时间戳）：1,433 次请求，中位 9 秒、p90 18 秒、p99 73 秒，正常请求最长 178 秒；超过 180 秒的只有这两次退化。
- 按裁决 186，主对话要重新自己上网；插话改道（票 136）只能在两步之间把用户的话送进去。一次请求卡 15 分钟，主对话就卡 15 分钟、插话晚 15 分钟。

## 要做到

1. **上限**：每次模型请求从发出到读完，总时长 300 秒。写成一个有名字的常量，注释写明理由（上面的底数、票号、裁决 188）。
2. **所有流式分支都要管**：0030 拦的那几条（Responses 流、chat completions 流、Anthropic 流，`managed-ga/code/llmcore.py` 里 `_parse_claude_sse`、`_parse_openai_sse` 一带）；也核一下别的会话类与非流式路径，一并管住或在报告里写明为什么不用。最好在一个地方管（比如读流的那层），不要每个解析器各写一份；怎么放由你定，写理由。
3. **到点之后**：照 0030 截断的路走：停止读流、关掉连接，不让 `_stream_with_retry` 当成网络错误重试（那会再发一次请求、再等 5 分钟），这一步照常走完。回复或参数截短；要让模型下一步看得出这次回复因为太久被截断，从而重发或换个做法。措辞与位置沿用 0030 与上游现有的截断写法，写进报告。历史里不能留下那几十 KB 的乱码。
4. **用量**：到点时多半拿不到带用量的结束事件，不伪造，照实，报告里写明计数会少一次（同票 116 第 5 条）。
5. **和 0030 的关系**：0030 照留（它在几秒内就触发，不用等 5 分钟）。两者同时命中时行为要确定、不重复截断。
6. **补丁栈**：照 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的规则做成一个新补丁，编号接 `0030` 之后；`managed-ga/manifest.json`、`managed-ga/patches/manifest.md` 照现有条目登记；`managed-ga/code/` 里的 payload 与补丁一致，按 manifest.md 记的做法重放验证。补丁要最小、隔离，能在上游上重放；上游以后有了同样的保护就删掉它。先查上游 GA 现在有没有总时长上限（读 `llmcore.py` 与上游提交记录），有就用上游的，不打补丁。
7. **测试**：`runner/tests/test_managed_ga_llmcore.py` 加用例，喂假流、用可注入的时钟或把上限在测试里调小：①正常的流在上限内读完，不触发；②一直不停吐字的流到上限就停下（断言没把假流读完）、不重试、回复或参数被截短、历史里没有那一大段；各条流式分支各一条；③与 0030 同时命中的一条。不要真的等 300 秒。

## 验证

```bash
.venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。凡是 import `managed-ga/code` 的探针都用 `python -B`（否则留下 `__pycache__`，payload 检查会报 generated artifact）。其他 payload / 基线检查按 manifest.md 记的验证步骤跑。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 在主树）。不跑 `tauri dev`，不调真模型，不碰浏览器。
  ```bash
  cd <主树>
  git worktree add -b t140-cap-request-time <scratchpad>/wt-140 main
  ```
- 不动：Core、GUI、CLI、Agent API、迁移、`managed-ga/state-seed/`、用户状态（内置状态根下的任何文件）、外置 GA。
- 同时在跑：票 136（插话改道，改 runner 的消息路径、Core、GUI）。它可能碰 `runner/` 里别的文件，不碰 `managed-ga/`；你只改 `managed-ga/` 与它的测试。碰了同一个文件在报告里写明。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。临时脚本放 scratchpad，用 `t140-` 前缀。
- 引用匹配行时用 `grep`，不要用 `rg`。中文（报告）用全角标点。本文件在开源仓库里：不写本机用户名路径、服务商接口主机、密钥；引擎日志里的页面内容不抄进票面。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 补丁文件名、改了哪几处（`file:line`）、新增多少行；上限放在哪一层、为什么。
2. 到点后模型看到的是什么（原文），历史里留下什么。
3. 各条分支与非流式路径的处理。
4. 测试与门禁的输出（命令 + 结果行）。
5. 补丁重放验证的做法与结果；上游有没有同样的保护。
6. 提交号（照抄 `git log --oneline -1`）。
7. 看到但没改的（Open risks），原样列出。
