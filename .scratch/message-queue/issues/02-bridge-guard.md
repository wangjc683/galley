# 02 bridge 防御闸

Status: ready-for-human

## 范围

runner/workbench_bridge.py `dispatch_command` 的 `UserMessageCommand`
分支（:1403）。

## 内容

补 `run_in_progress` 拒绝分支（仿 LoadHistory :1479 的
`_emit_error(..., category="business")`）：Core 接管队列后合法流量
不会 mid-run 到达 bridge，这道闸防止事件流再被打乱（turn_start 谎报
+ 双 drain 互踩）。`/btw` 旁路（:1412）在该检查之前，不受影响。

## 验证

- runner 单测：mid-run user_message → business error 事件、GA
  put_task 未被调用；/btw mid-run 仍旁路；空闲 user_message 行为不变。
- runner 三件套（pytest / mypy / ruff）。
