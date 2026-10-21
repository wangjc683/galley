# 75 巡看开口去掉固定开头、来源随话带出；门槛提到「你会想知道」

Status: ready-for-agent

来源：[助手 PRD](../../assistant/PRD.md) 裁决 10「巡看要无感」（2026-10-21，JC 问巡看「需要让用户学习了解甚至配置设置吗？还是……seamlessly 的主动为用户工作」，主会话推荐 B，JC：「按建议推进，B」）。只改手册 `wake.md` 的巡看一节、Core 的巡看叫醒措辞、对应测试与评测；面板、9:00、停用方式、种子都不动。依赖票 73（已合入）。

## 为什么

票 73 让它因巡看开口时一律带固定开头「早上过了一遍在办的事：……」，开口门槛是「做成了事」。JC 要的是无感地替用户干活、给惊喜：固定开头读起来像系统通知；「做成了」不等于「用户想知道」（「看了一下装修，没有新消息」不该说）。改成：来源随话带出（「阿里云那件我早上查了一下：……」），只说用户会想知道的。

## 一、手册 `docs/managed-ga-runtime/galley-assistant-manual/wake.md`「## The morning review」

把「Speak only when you got something done: …」这一条（到 `When you did nothing, your whole reply is \`<no-reply/>\`.` 为止）整条换成下面这段，原样照抄，只允许按现有换行宽度重排：

```
- Speak only when you got something done that the user will want to
  know: something you found, a file you made, something ready for them
  to decide on. Not that you looked and nothing changed, nor what they
  can already see. One message for all of it, in your own words: say
  what each thing is and that you did it this morning
  (「阿里云那件我早上查了一下：……」); no fixed heading. When you only
  started subtasks, with no result yet, write nothing for the user: the
  subtask tags and `<no-reply/>`, nothing else (you tell them when the
  subtasks are back). When you did nothing worth telling, your whole
  reply is `<no-reply/>`.
```

同一节开头一段与其余条目不动。

## 二、Core `core/src/subtask_report.rs` 的 `review_paragraph`（`:461` 一带）

把这一句：

> Speak only when you got something done for the user, in one message that says it comes from going over what is in hand this morning.

换成：

> Speak only when you got something done the user will want to know, in one message, in your own words, with no fixed heading.

其余措辞不动。相关单元测试与 `core/src/assistant_manual.rs` 里断言「早上过了一遍在办的事」的测试（`:795` 一带）跟着改，断言新句里的要点（「want to know」「no fixed heading」与新例子「阿里云那件我早上查了一下」）。

## 三、评测 `.scratch/main-chat/entry-layer-eval/`

- `run.py` 里叫醒文字的 Python 移植要和 Rust 一字不差：照 README 的做法更新移植与 `rust-samples.json`（`--dry-test` 的逐字对照要过）。
- 判卷：巡看用例开口时不再要求固定开头；改判「开口的话里说了是哪件事、做了什么」，并且不能是「没什么要推进」「看了一下没有新进展」这类空话（空话判不过）。`run.py` 里判卷的自测（`:6253`–`:6267` 一带，用的是旧开头）跟着改，加一条空话判不过的自测。`todo/cases.json` 里 `review-advance` 的 `expect_text` 改成新规则。
- 模型：`--model-id mm_1792576875658`（API key 接入的 gpt-6.1-sol，脚本默认就是它）。先 `--dry-test`，再只重跑四个巡看用例（`review-nothing-to-do`、`review-advance`、`review-overdue`、`review-stop`），每条照原遍数；不重跑其他用例。
- 结果文件 `meta` 与说明只写模型 id 和「API key 接入」，不写服务商名、接口地址、本机路径；提交前 grep 一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`、`runner/`、`cli/`、`managed-ga/`；手册其余部分（`unasked.md`、`todos.md`、`reminders.md`、`wake.md` 巡看一节之外）；入口层；种子、跳过、丢弃等 Core 逻辑。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`（`scheduler.rs` 原有两处差异不管）。
- 提交只点名文件，`git add … && git commit …`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 探针、脚本 import `managed-ga/code` 时 `PYTHONDONTWRITEBYTECODE=1`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`、改过的文件 `rustfmt --check`、`git diff --check`。
- 评测：`--dry-test` 全过；四个巡看用例在 Sol 上的结果。
- 中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `wake.md` 与 `review_paragraph` 的 diff 原样。
3. 验证命令与结果原样。
4. 四个巡看用例逐条结果，开口的那几遍附回复原文。
5. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

（合入后补）

## Comments
