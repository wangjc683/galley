# 144 同一条回复派出的几件，Core 等齐了一起叫醒主对话

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 193 第 5 条（JC 11-04：「甲甲甲」）。只在内置运行时的主对话；外置零变化（外置没有主对话，也没有子任务）。和票 [143](./143-deep-work-fans-out.md)（条款、手册、评测）并行做，互不碰文件。

## 为什么

- 现在一件子任务做完就叫醒主对话一次（裁决 174 第 5 条甲；`core/src/subtask_report.rs` 文件头「When」）。主对话忙着时到的报告才会攒成一次。
- 11-04 真机：三款手机拆成三个子任务并行，分别 267、284、398 秒做完，叫醒三次，前两次各 25–29 秒、各回一句进度，最后一次合表；三条「回复完成」通知。裁决 193 起，对比、报告这类成品默认拆开并行，这种情况会常见。JC 定由 Core 攒齐。

## 要做到

### 1. 行为

- **一批**：同一条回复派出、起来了的两件以上，即 `subtask_dispatches` 里同一个 `parent_session_id` + `turn_index`、`session_id` 不空、`failure` 为空的行。只派一件的不算批，照旧。
- **攒着**：一件的报告是做完（`ReportOutcome::Done`），同批还有别的在跑时，先不叫醒，报告攒着。
- **一起送**：同批没有在跑的了，攒着的就到期，走现有 `take_due` 那条路：主对话空着就立刻叫醒，忙着就等这一轮完。「没有在跑的了」指每一件都已经回来（有报告在等、在路上或已送过），或已不在跑（被停 `ABORTED` 不报告、被删、被提升成普通对话）。只等真在跑的；被停的那件不能让同批干等。
- **上限**：同批第一件做完满 5 分钟，还没回来的不再等，已经回来的先到期；后回来的照常各自叫醒（它们之间还算同一批的，照同样规则攒）。常量放在 `subtask_report.rs`，文档注释写出处（裁决 193 第 5 条：这次三件做完相差 131 秒；上限保证先做完的结果最多晚 5 分钟到）。
- **不攒的**：在问（`Asking`）、步数到顶（`StepLimit`）、出错（`Error`）、没起来（`NotStarted`）照旧立刻叫醒，它们要主对话动手。到点提醒（`Due`）不变。
- **顺路**：任何一次叫醒（到点提醒、同批在问的那件、别的报告）都把等着的报告一起送，攒着的同批也在内。这是现有做法（「the rest go as one message」），保住它。
- **时钟**：没有别的事件时，满 5 分钟也要有人去看。调度器每 60 秒一拍、已经在调 `subtask_report`（`core/src/scheduler.rs:737` 附近的 `restore_pending_reminders` / `wake_if_due`），可以借这一拍，也可以另起计时；你选，报告里写清粒度（例如最多晚一拍）。
- **退出**：攒着的报告和别的报告一样只在内存里；Galley 退出时子任务也停了，丢的只是等着的报告（裁决 8），不改。

### 2. 测试（`core/tests/` 或模块内，照现有子任务叫醒测试的写法）

1. 三件一批：前两件做完不叫醒，第三件做完叫醒一次，带三份报告。
2. 上限：两件做完、第三件还在跑，满 5 分钟叫醒一次带两份；第三件后来做完再叫醒一次。时钟要能在测试里拨，别真等 5 分钟。
3. 同批一件在问：立刻叫醒，攒着的做完那件一起送。
4. 同批一件被停：不等它，其余做完就叫醒。
5. 只派一件：做完立刻叫醒，照旧。
6. 到点提醒叫醒时，攒着的同批报告一起送。
7. 主对话忙着时到期：这一轮完了一次送进去，照旧。

### 3. 文档

- `core/src/subtask_report.rs` 文件头「When」那条改写，写出一批、攒着、上限、不攒的几种。
- grep `docs/` 里讲叫醒时机的地方（`architecture.md`、`ipc-protocol.md`、`docs/managed-ga-runtime/` 等），有写「一件做完就叫醒」的跟着改；没有就不加。
- 手册那句（几块回来合成一份）在票 143 里改，这里不碰手册与提示词。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

`rustfmt --check` 只查自己改过的 Rust 文件。预计不动 GUI；子任务卡片的状态来自子任务会话本身，不来自报告。若发现 GUI 依赖「一件做完就叫醒」（例如某个提示、计时），停下写进报告，别自己改 GUI。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t144-wake-once-per-batch <scratchpad>/wt-144 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：入口层与手册（票 143）、GUI、runner、CLI、Agent API、迁移、IM、外置。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t144-` 前缀。票面里不写本机用户目录、worktree 路径。
- 长命令前台跑，跑完再往下。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：行为怎么落的（认批、判「不在跑」、计时、顺路送）各在哪几行；改了哪些文件、加了哪些测试；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

## Comments
