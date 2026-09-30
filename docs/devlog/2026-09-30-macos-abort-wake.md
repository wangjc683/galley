# macOS 上停止打不断「等响应头」的请求：abort 的 close 只留给 Windows

日期：2026-09-30
关联：`managed-ga/patches/0025-managed-abort-wakes-on-macos.patch`、`runner/tests/test_managed_ga_abort.py`、
[Telegram 对话体验](./2026-09-30-telegram-conversation-ux.md)（发现现场）、
[GA baseline](../ga-baseline.md)（`1b6442f` 升级审计里「停止能打断等响应头的请求」一条已加更正）

## 现象

Telegram 真机验收通过后，JC 报告最新一条消息一直显示「·· 排队中」、像是无法回复。按 `telegram.log` 与
`model_responses_111849.txt` 还原：

1. 19:19:07 问「你的开发者是谁？」，请求发往中转站 `cpa.subsage.top`，对方一直没回响应头（模型还没开始吐字）。
2. 约 19:19:50 JC `/stop`：Telegram 立即回了「⏹ 已停止」，引擎打印 `Abort current task...`，但请求没被打断。
3. 19:19:55 的新消息（查厦门天气）只能排在后面，显示「·· 排队中」。
4. 19:22:07 = 19:19:07 + `read_timeout` 180 秒，请求超时返回，引擎这才打印 `User aborted the task.`；19:22:08 天气那条开始执行，
   19:24:35 答完。

`sample` 当时的 GA 工作线程停在 `_ssl__SSLSocket_read` → `poll`。桌面的停止同样走 `agent.abort()`（`runner/workbench_bridge.py:1767`），
所以这不是 Telegram 独有的问题。

## 根因（复现确认）

`GenericAgent.abort()` 为了唤醒阻塞在另一线程里的 `recv()`，先对 `_INFLIGHT` 里登记的 socket `shutdown(SHUT_RDWR)`，
紧接着 `_real_close()`（上游 `3d62523`，注释写明「Verified on Windows：只有 close 能唤醒」）。在 macOS 上，这个紧跟的 close
会和 shutdown 的唤醒赛跑：fd 先被关掉，阻塞在 `poll` 里的读线程收不到唤醒，只能等到读超时。

scratchpad 最小复现（本地 HTTPS 服务收下请求后不回任何字节，2 秒时执行与 `abort()` 相同的 socket 操作，系统 Python 3.14.4 /
requests 2.33.1 / urllib3 2.6.3）：

| 写法 | 等响应头时卡住 | 流式中途卡住 |
|---|---|---|
| 现行：shutdown 后立刻 `_real_close()` | 13 次里 6 次挂到读超时 | 6/6 立即醒 |
| 只 shutdown | 6/6 立即醒 | — |
| 对 dup 的 fd 做 shutdown | 6/6 立即醒 | — |
| 补丁后的 `abort()` 源码（非 Windows 不 close） | 16/16 立即醒 | — |

「流式中途」不受影响，所以日常「模型在吐字时停止」一直是好的；坏的是「中转站还没开始回」这一段，恰好是网络慢、最想停的时候。

## 裁决（JC，2026-09-30，「按 A 推进」）

- **A（采纳）**：内置补丁 `0025`，`abort()` 里的 `_real_close()` 只在 `os.name == 'nt'` 时执行，其余平台只 shutdown。Windows 行为
  逐字不变。复现只在 macOS 上跑过；Linux 上 shutdown 一般即可唤醒阻塞的读，未实测。受益：内置模式下的桌面停止与四个 IM 渠道的 `/stop`。
- **同时给上游提 PR**（上游 HEAD 仍是同一写法）：合入后按宪法第 1 条删 `0025`。外置 GA 按第 1 条不能改，只能等上游。
  PR 草稿在 [deferred](./deferred.md)「上游 PR：`abort()` 只在 Windows 上 `_real_close`」；JC 过目后裁「暂时不进行上游 PR」，
  条目转为暂缓。
- 否掉：只等上游（修不修、何时修不由我们定）；调小 `read_timeout`（不治本，误伤正常的长推理）。
- 180 秒不回本身是中转站侧的事，Galley 管不了；修后 `/stop` 能立即生效，后面的消息不再被挡住。

## 验证

- 补丁栈：干净克隆 + `build-managed-ga.sh` 重放 24 个补丁全 clean，重建出的 `managed-ga/code` 与作者 payload 全部文件哈希一致；
  `check-managed-ga-payload`、`check-ga-baseline-drift` 绿。
- `runner/tests/test_managed_ga_abort.py`（从 payload 源码取出 `abort()`、喂假 socket）：非 Windows 只 shutdown、Windows 仍
  `_real_close`、空闲时不动作；把 payload 退回旧写法时第一条转红。pytest 409 passed，mypy strict、ruff、`git diff --check` 绿。
- 真机：需要重启 IM 进程 / 桌面 bridge 后才生效（Python 不热更）。
