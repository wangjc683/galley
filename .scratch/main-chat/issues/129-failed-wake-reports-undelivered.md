# 129 叫醒那一轮出错时，它带着的子任务报告改发「没送到」

Status: needs-dogfood（2026-11-03 快进合入 `e0a8f0ee`（JC：「可以，现在合入 129」）。代理在 worktree 跑过 cargo test 1299 条（`subtask_report_test` 18 条，新加 3 条在旧代码上都失败）、rustfmt 动过的三个文件干净、diff --check 干净；主会话看过 `subtask_report.rs` 的 diff，rebase 到 `5a120541` 只多了文档提交。偏离票面主会话认可：事件的文档注释改了（旧的说报告一定留着再试）；没起成的标签有会话的才发、空标签与没闭合的没有 id 不发，同 runner 没收下那条路；定时任务开的会话的报告也发，桌面不当子任务、忽略。代理报的风险：①子任务在问你、报告在主对话等你回答时先告诉过一次、后来送它的叫醒又失败，按「只告诉一次」不再告诉，卡片里的提问可能停在「Galley 正在处理」没人接（三件事接连才会）；②失败那一轮在跑时同一件又来一份新报告，旧的照发没送到，之后可能多一条通知（同现有路径）。看到没改：`core/src/message_queue.rs` 约 `:166` 与 `:213` 的注释仍说 `record_wake_run_end` 只管到点任务。dev 版不发系统通知，等正式包真机）

来源：[主对话 PRD](../PRD.md) 裁决 178。只改 Core（`core/src/subtask_report.rs` 及其测试，必要时 `core/src/notify.rs` 一类的事件定义处），GUI 现成的「没送到」处理不改；不动 runner、CLI、Agent API、迁移、提示词与手册。只影响内置运行时。

## 为什么

Core 叫醒主对话送子任务报告时，只把到点的提醒放进「在途」（`core/src/subtask_report.rs:1474`，`reports.set_in_flight(&main, due_tasks)`）。那一轮如果以 `NoExit` / `RunnerExited` 收尾（模型请求没回应、runner 中途退出），`record_wake_run_end`（`:1781`）只会把提醒退成通知（`return_due_tasks`），同一轮带着的子任务报告直接丢掉，桌面不知道它「没送到」，也就不会按子任务自己的规则补通知。

裁决 177 以后，出错的子任务不再挂在侧栏、也不再让卡片头像变红，于是这种情况下哪里都看不到。

## 要做到

1. **子任务报告也进在途**：在 `deliver` 那里（约 `:1465-1492`），这一轮带着的报告里，不是到点任务的那些（子任务的：做完、在问你、出错、步数用完，以及「标签没起成」的那种）也记进在途。可以与 `due_tasks` 放在同一份（`in_flight: HashMap<String, Vec<SubtaskReport>>` 本来就是 `SubtaskReport`），也可以分开存，按代码顺手的来，报告里说明。派发失败那条路（`set_in_flight(&main, Vec::new())` 加 `keep_for_later`）照旧，子任务报告在那里本来就留着等下次。
2. **那一轮出错时发「没送到」**：在 `record_wake_run_end`，`run_end` 是 `NoExit` / `RunnerExited` 时，到点任务照旧 `return_due_tasks`；在途的子任务报告对它们的子任务 id 调现成的 `announce_undelivered`（`:1258`，发 `SUBTASK_REPORT_UNDELIVERED_EVENT`），与「runner 起不来 / 没收下消息」时同一条路，同样的「每份报告只告诉桌面一次」规则（读 `announce_undelivered` 的调用方怎么去重）。这些报告不放回等待队列、不补跑（补跑仍挂在 `docs/devlog/deferred.md`「失败的叫醒补跑一次」）。
3. **别的收尾照旧算送到**：回了话、`<no-reply/>`、你停的（`ABORTED`），在途的子任务报告直接清掉，什么也不发。
4. **「标签没起成」的报告**（`not_started_report`）：它没有子任务会话可补通知。看桌面对没起成的子任务收到「没送到」时会怎样（`gui/src/lib/ipc-handlers.ts` 里 `SUBTASK_REPORT_UNDELIVERED` 的处理、`subtaskFallbackNotification` 对 `notStarted` 的分支，`gui/src/lib/subtask-notify.ts`），能走现成的就带上，走不了就不带，报告里说明。
5. **文档**：`core/src/subtask_report.rs` 文件头「What is sent」「Not delivered」两条补一句（裁决 178）；`record_wake_run_end` 的文档注释改成也管子任务报告。`docs/devlog/deferred.md`「失败的叫醒补跑一次」的状态行主会话已改，不用动。
6. **测试**（`core/tests/subtask_report_test.rs` 或模块内测试，照现有写法）：
   - 叫醒那一轮 `NoExit` 收尾：带着的子任务报告各发一次 `SUBTASK_REPORT_UNDELIVERED_EVENT`，id 对；到点任务照旧退成通知；
   - `RunnerExited` 同上；
   - 正常收尾、`<no-reply/>`、`ABORTED`：不发；
   - 同一份报告不会因为这次失败和后来的别的路径被告诉两次。

## 验证

在 worktree 根目录：

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
git diff --check main...HEAD
```

- `core/` 不是 rustfmt-clean：只对动过的 `.rs` 跑 `rustfmt --check --edition 2021`。
- 中文全角标点：在 scratchpad 写 `cjk-punct-129.py`，扫新增行。

## 别动

- 只在 worktree 里改，绝不碰主工作树 `~/Documents/genericagent-webui`；不跑 `tauri dev`、不跑 `galley` 写命令、不读写用户的应用数据目录。
- GUI、runner、CLI、Agent API、迁移、入口层提示词、手册不动。不加补跑。

## 提交与回报

- 在 worktree 分支上提交，只点名本票文件，禁用 `git add -A` / `git commit -a`；英文说明，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，命令后接 `git log --oneline -1`，提交号只抄输出。
- 报告：①改了哪些文件 ②提交号 ③每条验证命令与结果（测试条数）④偏离票面的地方与理由 ⑤看到没改的 ⑥Open risks。
