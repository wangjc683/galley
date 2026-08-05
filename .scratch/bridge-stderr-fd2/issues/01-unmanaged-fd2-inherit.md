# bridge 管了 fd 1、没管 fd 2:GA 子进程 stderr 是一条无节流继承通道

Status: needs-triage
日期:2026-08-05
来源:日志系统设计讨论(JC + agent)的副产物;与
[日志基建](../../runtime-logging/issues/01-file-logging-infrastructure.md)
**解耦**单独立项,避免被一并推迟。

## 现象

`runner/workbench_bridge.py` 在启动时对 **fd 1** 做了两层管束
(`:1917`-`1919`):

- `_capture_real_stdout()`(`:75`)先 `os.dup(1)` 留下干净的 IPC 输出句柄;
- `_silence_python_stdout()`(`:82`)再把 fd 1 `dup2` 到 `/dev/null`,并重绑
  `sys.stdout`。

其 docstring(`:83`-`:90`)把动机写得很清楚:光重绑 `sys.stdout` 不够,OS 层
的 fd 1 仍指向 IPC 管道,**GA 工具派生的子进程会继承它**,C 扩展也会直接往上
写,任一情况都会往事件流里插入垃圾行、破坏整个 session 的帧解析。

**fd 2 没有任何等价处理。** 原因大概率是它不污染 IPC,所以从来没人管它。
(`:316`/`:324`/`:1704` 处的 `stderr=subprocess.DEVNULL` 只覆盖 bridge 自己
派生的子进程,管不到 GA 内部 `ga.code_run` 派生的那些。)

后果:GA 工具子进程的 stderr —— 也就是用户脚本任意输出 —— 原样流进 bridge
的 fd 2,被 `core/src/runner_manager/process.rs:329` 的
`eprintln!("[runner stderr {sid}] {line}")` 逐行转发到 core 的 stderr,然后
在打包 `.app` 里消失。

## 为什么值得单独记

两个独立的点,和「要不要做日志系统」无关:

1. **无节流**。这条通道对行数没有任何限制。`process.rs:324`-`336` 的 reader
   task 每读一行都要 `stderr_tail.lock().await` 抢一次 mutex,`code_run` 里
   跑个刷屏脚本就是持续的锁争用 + 一个忙碌的 async task,而这些行最终只是被
   丢进 8 行环形 buffer(`STDERR_TAIL_MAX = 8`,`process.rs:30`)再丢弃。
   **注:目前未实测其性能影响,仅从代码路径判断为潜在问题。**
2. **它是日志落盘的前置风险,不是后置收益**。一旦日志系统把这条流落盘,
   「无节流地写一个没人读的 fd」就变成「无节流地写盘」—— 刷屏脚本可以写满
   用户磁盘。所以做日志前必须先给它上速率 + 大小限制。

## 可选处理方向(未裁决)

- 什么都不做:现状无已知用户可见故障,fd 2 的内容今天等于丢弃。
- 只加节流:在 `process.rs` 的 reader 侧做速率 / 行长截断,不动 Python。
  改动最小,且是日志落盘的必要前置。
- 对齐 fd 1 的处理:在 bridge 侧显式管束 fd 2。需先想清楚管束后这些输出去
  哪 —— 直接 `/dev/null` 会让 GA 工具的真实报错彻底不可见,可能比现状更糟。

## 备注

- 与 Rule 1 无关:`workbench_bridge.py` 是 Galley 自己的 bridge 代码,不是
  GA checkout 内容。
- 若日志基建先行,本 issue 的「只加节流」方向应并入其实施顺序第 3 步。
