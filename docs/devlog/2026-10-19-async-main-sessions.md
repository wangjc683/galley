# 主会话 + 后台代理：一组票一个主会话，真机验收挂在票上

日期：2026-10-19
关联：[Session Close SOP](../session-close-sop.md)「Main Sessions With Background Agents」「Starting The Next Main Session」、[triage labels](../agents/triage-labels.md)、[issue tracker](../agents/issue-tracker.md)「Lifecycle after shipping」

## 背景

工作方式改为：一个主会话负责讨论、写票、把票派给后台代理（各自在 git worktree 里做）、验收、合入、提交；一个主会话只覆盖一组关联票，这组票合入并记录完就收尾，下一组开新的主会话。原 SOP 只按「一次长会话」写，没有写后台代理、worktree 和跨会话的状态交接。

## 裁决

1. **一组票「完成」= 合入 + 机器验收 + 记录到位，不等真机验收。** 真机验收挂在票上，新增 `needs-dogfood` 状态（值写在最前，括号里再写细节，保证 `grep "^Status: needs-dogfood"` 精确）。原因：真机试用常持续数天，不该拖住会话。真机通过改 `done`；试出新活记进 Comments、改回 `ready-for-agent`。
2. **不设交接文件。** 新主会话开场从票的 `Status:` 行、上次收尾以来的 `git log`、所谈话题的 PRD 重建状态。否决：覆盖式 `.scratch/handoff.md`（与票的 Status 重复，会漂移，违反同一事实只住一处）；把收尾回复粘进新会话（靠人记得）。
3. **收尾闸门。** 提交前确认：没有在途的后台代理（结果只回到启动它的会话）；合入的 worktree 已删、未合入的工作已提交在分支上且分支名写进票（临时目录里的 worktree 重启即丢，分支不会）；合入未真机的票标 `needs-dogfood`；收尾回复带裁决对账表（每条裁决与落盘的 `file:line`）。裁决当场落盘（票 Comments、PRD），收尾只对账，不是第一次写。
4. **默认一次只开一个主会话。**

## 落点

- `docs/session-close-sop.md`：第 8 步补「交接只在收尾回复里，下个会话读不到」；新增上面两节；Closeout Shape 加裁决对账。
- `docs/agents/triage-labels.md`：加 `needs-dogfood` 行与「值写在最前」的写法。
- `docs/agents/issue-tracker.md`：「Lifecycle after shipping」改为合入后先分 `needs-dogfood` / `done`。
- 现有票里「已合入、待 JC 真机」的散文状态同时归一为 `needs-dogfood`，括号说明逐字保留。
