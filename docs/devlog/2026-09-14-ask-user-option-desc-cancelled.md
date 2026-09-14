# 2026-09-14 · ask_user 候选项携带说明（option-desc）：取消

> Status: cancelled · Related:
> [.scratch/ask-user-option-desc/PRD.md](../../.scratch/ask-user-option-desc/PRD.md) ·
> [galley#21](https://github.com/wangjc683/galley/issues/21) ·
> [同日：候选填入 / 竖排 / 回显](./2026-09-14-ask-user-chips-fill-list-echo.md)

## Context

8 月 11 日按社区 issue #21 定案的 PRD：候选项从纯字符串扩成
`{label, desc}`，GUI 悬浮 / 聚焦显示说明，managed patch 约束模型为不可自解释
的选项补说明。三张票 ready-for-agent 一直没开工。同日做完 AskUser 三个提交
后 JC 提出：现在的 AskUser 环节感觉没什么问题，这个 PRD 是不是可以不做。

## Evidence

按「量需求看 ground truth」的规矩，把本机 `workbench.db` 里全部 ask_user
调用拉出来看（107 个会话，2026-05-15 至 09-14）：

| 项 | 数 |
|---|---|
| 含 ask_user 的消息 / 调用 | 16 / 21 |
| 带候选项的提问 | 13 |
| 候选项总数 | 55（6 字以内 18） |
| 点选候选 / 自由回复 / 未答 | 10 / 1 / 2 |

PRD 假设的痛点是「标签太短看不出后果，用户盲选或放弃按钮追问」。55 条里
没有一条符合：模型自己把后果写进标签（「不是/不确定，先不要发送」
「~/Downloads/_归档(留在原地,风险最小)」「保存到长期记忆 / 仅限本次会话 /
先不保存」）；短标签是「编程」「外语」「结束任务」这类本身不需要解释的。
唯一一次自由回复（08-24 服务器配置题）是用户否定了前提，不是看不懂选项。
唯一一次高影响确认（05-18 微信发消息）模型靠标签本身讲清了三条路的后果。

候选侧真实出现过的问题是另一件：句子级候选横排读成标签云（08-24、09-14
九选项那次），已由同日 D2 的 row / list 自适应排布解决。

## Decision

**取消，不删文件。** PRD 与 01 / 02 / 03 置 `wontfix`，PRD 顶部记数据结论；
deferred.md 记启动信号。报告人一人一次的报告，本地四个月零次复现，更像其
特定模型 / 外部 GA 的产出习惯；为此加一个 GA schema patch、三处 GA 表面的
label 归一化、一轮真机变体实测，投入与证据不成比例。

### 核对时顺带发现的 PRD 过期点（重启时先读）

- 01 漏了一条读路径：GUI `mergedAskUserArgs` 从持久化 tool_calls 重建候选
  （restore、回显），与 bridge `_extract_ask_user` 并列，两处都 `str(c)`。
- 03 的真实补丁点是 `assets/tools_schema.json` / `_cn.json` 里
  `candidates.items.type: "string"`，不是 docstring；不改 schema 模型不会产出
  对象形状，任何 prompt 约束都是空话。
- 对象形状会被 GA 其余表面 `str()` 成 dict 字面量：`_compact_tool_args`
  （模型看自己的历史）、`tgapp.py`（Telegram 按钮）、`tui_v3.py`；Feishu /
  Discord 补丁复用这些渲染。若重启，形状更该选并行可选参数
  `candidate_descs: string[]`（纯 additive，GA 表面天然忽略，上游若自加 desc
  可直接删补丁），或先用零代码的字符串内约定做先导实验。
- 依赖方向反了：02 的真机实测需要模型真产出 desc，schema 改动应先于 02。
- D2 之后有 desc 的候选定义上属 list 排布，desc 作第二行小字即满足报告人三条
  硬要求（键盘可见、多行不截断、无 desc 零变化），tooltip 变体大概率可跳。

### 数据里另一条记下不做的事

09-14 最后一条 ask_user：一个问题挂了 9 个候选，实为 3 道题的选项混在一起，
模型违反了 schema 里「多题时候选留空」。与 desc 无关，只出现一次，先观察。

## Follow-up

- #21 上 8 月回过「保持 open，实现后回来更新」，需要回去说明改主意的依据。
  JC 决定暂不回帖，待定。
