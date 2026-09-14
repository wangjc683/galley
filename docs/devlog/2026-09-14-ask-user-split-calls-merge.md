# 2026-09-14 · ask_user 拆分调用合并：同问题多次调用并成一个候选集

> Status: implemented · Related:
> `runner/workbench_bridge.py` `_extract_ask_user` ·
> `gui/src/lib/ask-user-candidates.ts` `mergedAskUserArgs` ·
> [前篇：候选填入 / 竖排 / 回显](./2026-09-14-ask-user-chips-fill-list-echo.md)

## Context

JC 真机验收竖排列表时换到 grok-4.6，让它「问一个问题并给候选项」，界面只
显示一个 chip。查原始模型响应：模型在同一轮发了**五个并行的 ask_user
tool_use**，问题文本完全相同，每个只带一条候选——把数组参数拆成了五次
调用。数据库 tool_calls 也是五条。

我们三处读取都只取第一个 ask_user：runner `_extract_ask_user`（实时事件）、
GUI `derivePendingAskUser`（重启恢复）、Conversation 回显取参。GA 自身的
`do_ask_user` 也是第一个就 `should_exit`，模型端只会「问一次」。换别的模型
候选正常，确认是模型怪癖 + 我们取参过窄。

## Decisions

### D1. 读取侧防御性合并，不动协议、不改审计记录

同一轮内多个 ask_user 若问题文本（trim 后）相同，候选按调用顺序并集去重
合成一个；问题不同则维持取第一个——那是模型真的在问多件事，GA 也只服务
第一件，其余候选不能漏进来。合并只发生在读取：IPC `AskUserEvent` 形状不变
（candidates 只是更长），数据库 tool_calls 原样保留。attach 模式下同样只读
GA 返回值，不碰 GA 状态。

runner 与 GUI 各一份同规则实现（Python / TS 不共享代码），GUI 的
`mergedAskUserArgs` 同时喂恢复路径和回显，所以拆分调用下回显勾选与重启
恢复都完整。

### D2. 顺手修两处同根源

- 折叠头「提问 N 次」原按 ask_user 工具条目数计，grok 这轮会显示 5 次；改为
  按去重后的问题数计（`askUserQuestionCount`）。
- runner 对 `candidates` 做 `[str(c) for c in ...]`，模型若发成单个字符串会被
  逐字拆成单字候选；加 `_candidate_list`：字符串视为一条，GUI 同步。

### 不做

引导模型别拆数组属于 managed patch 里 ask_user 工具描述的事（GA 函数签名
`candidates=None` 无类型标注，可能是模型误判成单值的原因），归
`.scratch/ask-user-option-desc` 03 票。

## Verification

runner：`pytest`（新增三条：同问题合并去重、不同问题不混入、字符串候选）/
`mypy` / `ruff`。GUI：`typecheck` / `lint` / `vitest`（新增 `mergedAskUserArgs`
四条 + 计数）/ `git diff --check`。真机：JC 可回到那个 grok session 看回显
是否列出五条候选。
