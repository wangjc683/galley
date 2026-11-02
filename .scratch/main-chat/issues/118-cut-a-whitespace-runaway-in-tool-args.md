# 118 工具参数吐空白时截断：内置 GA 收参数时加一道闸

Status: ready-for-agent（2026-11-02 开票）

来源：[主对话 PRD](../PRD.md) 裁决 162；诊断见票 [116](./116-subtask-fifteen-minute-stall.md)。只改内置 GA（`managed-ga/` 的补丁栈与 payload）和 runner 的测试；不动 Core、GUI、CLI、Agent API、迁移。外置运行时零变化（外置 GA 不打补丁，宪法第 1 条）。

## 为什么

10-21 一件子任务的第 2 步，模型在 `web_execute_js` 的参数里先写出正常的开头，接着吐了 40 万个空白字符（38 万个制表符、2.2 万个换行），吐了 15 分 03 秒才结束。没有哪一层拦住它：订阅登录这条路线发不了输出上限（`managed-ga/code/llmcore.py:731`）；读超时只管两段数据之间的空档；GA 收函数参数只往缓冲里累加、不往外吐（`llmcore.py:356-361`），界面一直停在那句 summary 上。参数解析失败后落成 `{"_raw": …}`（`llmcore.py:306-319`），工具报「Script missing」，模型下一步重发才恢复；这 40 万字符还进了历史，后两步多背约 92 万输入 token。10-01 起 1,296 次请求里只有这 1 次，但主对话走同一条路线，撞上时主对话卡 15 分钟。详细证据链见票 116 的报告。

## 要做到

1. **判据**：函数参数的缓冲里，一连出现 2,000 个空白字符（空格、制表符、`\n`、`\r`）就算失控。理由：JSON 字符串里的换行和制表符必须转义，真空白只能出现在记号之间，正常参数不会连着出现几千个。阈值写成一个有名字的常量，注释写明这个理由和票号。
2. **两条收参数的分支都要拦**：Responses 流的 `response.function_call_arguments.delta`（`llmcore.py:356-358` 一带）和 chat completions 流的 `tc_buf[idx]["args"] += …`（`llmcore.py:429` 一带）。每次追加后只看缓冲末尾那一段（别每次扫全缓冲）。也核一下别的会话类（`llmcore.py` 里其他流式解析，比如另一种协议的会话）有没有同样的累加，一并拦住或在报告里写明为什么不用。
3. **触发后**：停止读流、关掉连接（不要让 `_stream_with_retry` 当成网络错误去重试，那会再发一次请求），把这次的参数截短（保留开头约 800 字符，去掉末尾空白），让这一步照现在的路走完：参数照旧解析失败、工具报参数缺失、模型下一步重发。要让模型看得出是参数失控被截断（比如沿用上游现有的截断标记写法，`llmcore.py:372-380` 一带），措辞与位置由你按上游现有做法定，写进报告。历史里不能留下那几十万字符。
4. **用量**：触发时这次请求多半拿不到带用量的结束事件。不要为此伪造用量；照实，报告里写明计数会少一次（同票 116 第 5 条）。
5. **补丁栈**：照 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的规则做成一个新补丁（编号接 `0029` 之后），`managed-ga/manifest.json`、`managed-ga/patches/manifest.md` 照现有条目的写法登记；`managed-ga/code/` 里的 payload 与补丁一致（用 `scripts/build-managed-ga.sh` 从干净的上游克隆重放验证，或照 manifest.md 里记的验证做法）。补丁要最小、隔离，能在上游上重放；上游以后有同样的保护就删掉它。
6. **测试**：`runner/tests/test_managed_ga_llmcore.py` 加用例，喂假流：①参数正常，含转义的 `\n`、`\t` 与少量记号间空白，不触发；②参数开头正常、后面一连几千个空白，触发：读流在阈值附近停下（断言没把假流读完）、参数被截短、不重试、历史里没有那一大段；Responses 与 chat completions 两条分支各一条。

## 验证

```bash
.venv/bin/python -m pytest runner/tests/test_managed_ga_llmcore.py
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-managed-ga-payload.mjs
git diff --check
```

worktree 里跑 runner 测试借主树的 venv：在 worktree 根目录用 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。凡是 import `managed-ga/code` 的探针都用 `python -B`（否则留下 `__pycache__`，payload 检查会报 generated artifact）。payload / 基线相关的其他检查脚本（`scripts/` 下 `check-*`）按 manifest.md 记的验证步骤跑。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 在主树）。不跑 `tauri dev`，不调真模型，不碰浏览器。
- 不动：Core、GUI、CLI、Agent API、迁移、`managed-ga/state-seed/`、用户状态（内置状态根下的任何文件）、外置 GA。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。临时脚本放 scratchpad，用 `t118-` 前缀。
- 引用匹配行时用 `grep`，不要用 `rg`。中文（报告）用全角标点。本文件在开源仓库里：不写本机用户名路径、服务商接口主机、密钥。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：

1. 补丁文件名、改了哪几处（`file:line`）、新增多少行；阈值、截短长度与理由。
2. 触发后模型看到的是什么（原文），历史里留下什么。
3. 有没有别的流式分支要拦，处理方式。
4. 测试与门禁的输出（命令 + 结果行）。
5. 补丁重放验证的做法与结果。
6. 看到但没改的（Open risks），原样列出。

## 报告

（代理填写）
