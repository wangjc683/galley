# 82 例行响过不进已完成

Status: ready-for-agent（排在票 81 之后：同改 `core/src/assistant_todo.rs`，由票 81 的代理接着做，先 rebase 到 main）

来源：[主聊天 PRD](../PRD.md) 裁决 129 第 3 条（2026-10-22；JC：「按你的推荐推进」）。只改 Core 一处判断、它的注释与测试，加设计文档一行。

## 为什么

- 面板「已完成」现在收四种：勾掉的待办、送到的一次性提醒、交回来的子任务，还有**例行的最近一次响过**（`core/src/assistant_todo.rs` 构建分组时 `let counts = (fired_once || !once) && !task.is_review();`，`:652-656` 一带；模块注释 `:26-38` 写着「a routine's last fire」「A routine can be in two」）。
- 每天一次的例行因此一直在已完成里占一行，例行越多，已完成越长，永远消不掉。巡看已经因「它自己什么也没替你办成」被排除（票 73）。
- 裁决 128 的定义：已完成是办完了的承诺。例行响一次没有办完什么，承诺本身还在「例行」组里；响过的那一次，它被叫醒时已经在对话里说了。

## 要做的

1. **判断**：只有一次性任务（不挂在待办上的）按时响过才进已完成；例行（不论 target、不论是不是巡看）一律不进。例行照旧在「例行」组里，下次时刻照旧。
2. **注释**：模块注释里「Done」那条与「A routine can be in two」那句、`AssistantTodo::done` 字段注释、这处判断旁的注释，改成现在的规则，写上依据（裁决 129 第 3 条；巡看那半句并进去，不再单列）。
3. **影响面核对**（只读，回报里写结论）：
   - `managed_prompt.rs` 的「In Hand」块不印已完成（`in_hand_section`），应当不受影响；
   - CLI `todo list` 与 socket 走 `todo_list`（待办本身），不读这组分组，Agent API 不变；
   - 票 81 的巡看判据不看已完成；
   - grep `.scratch/main-chat/entry-layer-eval/`、`.scratch/assistant/closed-loop-snapshot.py` 有没有镜像这组分组的地方，有就跟着改，没有写「无」。
4. **设计文档一行**：`docs/design/conversation.md`「待办面板」的「已完成」那一条（「近 7 天，默认收起……子任务、提醒、例行用它们的图标……」）改成已完成只收勾掉的待办、送到的一次性提醒、交回来的子任务，例行响过不进（注「2026-10-22，票 82，裁决 129」）。票 80 改的是这一节别的几条，你先 rebase 到 main（票 80 可能已合入），只动这一条。GUI 代码不动（`DoneRow` 里画例行的那一支变成走不到，由已完成的定档票删）。
5. **测试**：每天的例行今天响过 → 不在已完成、在例行；每周的例行同理；一次性提醒响过 → 在已完成（照旧）；巡看 → 不在已完成（照旧）；暂停的例行照旧。原有断言「例行在两处」的测试按新规则改，覆盖的情形都留着。跑完整套后再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 已完成的 7 天窗口、50 件上限、排序；其余分组；「In Hand」块；CLI 与 Agent API。
- `gui/` 代码；设计文档里除第 4 条那一条以外的内容。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 设计文档新增行中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 判断那处的 diff 原样。
3. 第 3 条的核对结论。
4. 验证命令与结果原样。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入后 dev 重启 Core。现在库里只有巡看一条例行，面板上看不出差别；以后让它设一个每天的提醒（「每天晚上 10 点提醒我关电脑」），响过以后，「已完成」里没有它，「例行」里那一行照旧写下次时刻。

## Comments
