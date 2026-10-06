# 02 按需读取的 Galley 使用指南

Status: needs-triage（暂缓，等启动信号；台账见 [deferred](../../../docs/devlog/deferred.md)「Galley 使用指南」一节）

启动信号（任一）：真机或社区里出现模型答不上、或答错的「怎么做某事」提问（例如怎么连某个渠道、空 API Key 怎么填、
定时任务怎么设），且常驻地图指路不够用；或预算闸卡住一条新条款，这时把功能地图挪进指南（常驻约省 350 tok）。

方案：一份面向用户的使用指南，单一来源放仓库（README 链接它），打包时带进 App；模型被问到操作细节时去读。
常驻提示词只加两三行指向它。

待查的实现细节：

1. 放哪：倾向 Core 在会话启动时写到内置状态目录里 Galley 自己的子目录（随版本覆盖，不算用户状态）。
   先例：Core 已把 Supervisor SOP 写到 `im/reference/galley-supervisor-sop.md`（`materialize_sop_reference`）。
   备选 `galley guide` CLI 命令：外部 Supervisor 也能用，但动 Agent API 公开契约，等 Supervisor 侧有需求再说。
2. 项目模式下工作目录会变，相对路径是否还能找到指南，要先验证；状态块不能注入路径（准入规则第 4 条）。
3. 语言：先只写中文，还是中英两份（2026-10-06 讨论时没定）。
4. 维护：发版 SOP 加一条「改了用户可见功能要同步指南」，或做成漂移门禁。
