# 日志基建:core / bridge 日志落盘 + 「打开日志」入口

Status: needs-triage
日期:2026-07-21
来源:Runtime tab 打磨讨论(JC + agent),由 issue #13 远程排障缺口引出

## 问题

Galley 已发行给真实用户,但没有可交付的排障日志:

- core(Rust)没有文件日志——`main.rs` / `lib.rs` 无 tracing / env_logger 落盘配置;
- bridge(runner)stderr 只保留内存里 8 行 tail(`core/src/runner_manager/process.rs` `STDERR_TAIL_MAX = 8`),进程退出即丢;
- 唯一写日志文件的是 IM supervisor(`runner/managed_im_supervisor.py` `_redirect_logs`)。

实际痛点:GitHub issue #13(Win11 焦点问题)排障时,**没有任何日志可以问用户要**。下一次 Windows 侧验证 / 回归,同样瞎子摸象。

## 范围(待触发后细化)

值钱的 95% 是基建,UI 是最后 5%:

1. core tracing 落盘(app data 目录下,滚动轮转,大小上限);
2. runner / bridge stderr+stdout 落盘(per-session 或合并,轮转);
3. 日志级别默认克制,不落用户对话内容(Rule 4:数据留在 Galley,也别把对话写进日志);
4. 最后才是 Settings → Runtime 的「打开日志目录」入口(problem domain 匹配:坏了怎么修)。

## 触发条件

已半触发(#13)。建议在下一次需要远程排障 Windows 问题之前完成 1-2 项。

## 备注

- 敏感信息约束:API key、对话内容、用户路径尽量脱敏。
- Windows 构建验证 #13 修复时,若日志基建已就位,可直接受益。
