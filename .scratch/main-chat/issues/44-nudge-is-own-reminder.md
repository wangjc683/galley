# 44 只要提醒的事用 Galley 自己的提醒（手册与评测）

Status: ready-for-agent

来源：主聊天 PRD 裁决 92（2026-10-17，JC：「A」）。依赖 41（手册「To-dos and reminders」一节、入口层那段、`todo` 与 `schedule` 两套评测）。改 Core 里的手册与入口层提示词、评测；不改界面与 CLI。

## 目标

「十分钟后提醒我喝水」这种只要到点提醒一下、没有要办完的事，Galley 用它自己的提醒（一次性、叫醒它），不记成待办；有要办完的事（回房东电话、交报告、赶航班）照旧记成待办并挂提醒。

## 一、手册

在票 41 写的「To-dos and reminders」一节里改（措辞你写，照手册语气与长度）：

- 判法：你不理这次提醒，这件事还要留在清单上吗？不用（喝水、关火、出门、起来活动）就是它自己的提醒；要就是待办。
- 删掉或改写票 41 那句 `A request to be reminded (「十分钟后提醒我喝水」) is one too, with its reminder.`，例子换到它自己的提醒那边。
- 「明天早上 8 点提醒我给房东回电话」这种：要办完的事加一个时刻，是待办，提醒挂在待办上。
- 说一句话交代的方式照旧（记了什么、几点提醒）。

入口层只在必要时加字（票 41 已把预算提到 2026 字节、没有余量），加了就写理由，照 `docs/managed-ga-runtime/prompt-composition.md` 的预算与条款台账。工作台、子任务、IM 的提示词逐字节不变（断言）。`docs/managed-ga-runtime/galley-assistant-manual.md` 跟着同步。

## 二、评测

在 `.scratch/main-chat/entry-layer-eval/` 里：

- 判定改为两边分开：只要提醒的（喝水、关火）只认 `schedule create`（叫醒它的一次性），记成待办算错；要办完的（交报告、回电话、航班）只认 `todo add` 挂提醒。
- 加用例：「半小时后提醒我关火」（自己的提醒）、「明天早上 8 点提醒我给房东回电话」（待办挂提醒）。
- 两套（`todo`、`schedule`）全部重跑，每条两遍，模型照票 41（JC 主对话现在的那个，只读查库确认）。**结果与日志里不许出现服务商域名、接口地址、key、本机路径。**

## 验收

- Rust 测试：手册含新判法；入口层预算测试；工作台、子任务、IM 提示词逐字节不变。
- `run.py --dry-test` 通过；通过率表在 Comments，每个不过的写清模型做了什么、改没改措辞。
- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区、`TZ=UTC`）、六个门禁、`git diff --check`、中文标点扫新增行。

## Comments
