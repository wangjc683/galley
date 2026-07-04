# Tool Callout 与审批

> Galley 设计系统 · 原 DESIGN.md §4.5–§4.7（2026-07-04 拆分）：Tool Event Callout 状态映射、Approval Dock / Approval Card、工具特定渲染、Inspector 退役记录。

### 4.5 Tool Event Callout

#### 视觉（像 Notion callout，不像 stdout log）

每个 tool call 是独立 block：

- **左侧 3px 状态色竖条**（静态，不呼吸）+ **1px `border-default`** + **12px 圆角**
- **不用 background tint**（暖米白底上太花）
- 16px Phosphor thin icon + tool name（mono）+ status pill + elapsed（`tabular-nums`）+ `CaretDown`
- 内边距 16px / 上下 margin 12px
- 容器状态切换只过渡颜色（`transition-colors`），不动布局属性

#### 6 状态映射

| 状态 | 左竖条色 | icon | 默认折叠 |
|---|---|---|---|
| running | 杏沙 `brand`（静态） | `CircleNotch` 旋转 + 三点 `LiveDots` + 每秒跳动 elapsed 计数器（`14s`/`1m 2s`，运行满 1s 显示） | 当前 step 默认展开 |
| success-current | 杏沙 | `CheckCircle` | 当前 step 默认展开 |
| **success-historical** | **几乎不可见**（融入背景） | `CheckCircle` muted | **默认折叠** |
| waiting_approval | 深琥珀 | `Pause` | **强制展开**（不可折叠） |
| failed | 深红 | `X` | **强制展开** |
| denied | muted | `Prohibit` | 折叠（结果已知，不重要） |

#### 展开内容

- **args preview**：mono 等宽，syntax highlight
- **stdout / progress**：mono 等宽，scroll 区域 max 200px
- **result preview**：折叠 raw JSON 链接

### 4.6 Approval Dock + Approval Card

#### Approval Dock（Composer 上方 sticky）

- **仅在有 pending approval 时存在**（不是 hide，是不渲染）
- warning 琥珀浅 tint 背景（`bg-warning/[opacity-subtle]`）+ 3px 深琥珀左竖条 —— 待审批是 caution 态，统一归到琥珀；杏沙留给功能与「已通过」正向态
- 单行：`{count} pending approval · Next: {tool_name}` + Advance button
- **不可 dismiss**（必处理状态必须 surface）
- hover 显示 tooltip 预览
- 决策仍必须在对应的 callout 内做（dock 是 navigator，callout 是 decider）

#### Approval Card（waiting_approval 状态的 inline form）

**不是独立组件**，是 Tool callout 的 waiting_approval 形态。展开后内嵌：

- **风险等级 pill**：high（深红）/ medium（深琥珀）/ low（muted）
- **动作说明**：1 行人话 ("Run shell command" / "Patch file at /path")
- **目标对象 / 工具特定渲染**（见下）
- **为什么需要审批**：1 行 muted 文案
- **四个按钮**（Phosphor icon + label）：
  - Allow once（charcoal primary）
  - Deny（深红 ghost）
  - Always allow in this Project（杏沙 ghost）
  - Always allow globally（杏沙 ghost，high risk 工具如 `start_long_term_update` disabled）

#### 工具特定渲染

##### `file_patch` — split diff 视图（V0.1 必做）

- **V0.1 实现**：自研 PatchView（`diff` npm 包计算 line-level changes + Tailwind 渲染 split layout），无语法高亮
- 数据来源：`args.path` / `args.old_content` / `args.new_content`（GA `file_patch(path, old_content, new_content)` 签名）
- 视觉：
  - Header：path（mono）+ 文件 size delta（`+12 / -3 lines`，13px muted）
  - Split layout（左旧右新）/ 行号显示
  - +/- 行用 success/error 8% tint 背景；空 placeholder 行用 hover-tint 斜纹
  - max-height 480px，超出 scroll
  - 折叠时只显示 header + `View diff`
- 为什么 V0.1 必做：file_patch 是审批高频工具，没 diff 视图等于"审批黑盒"，违反"不要让用户思考"原则
- 为什么不用 `@pierre/diffs`：试过，其 Shiki backend 拉所有语言包进 bundle（+400 KB gzip）。V0.1 审批界面不需要工业级语法高亮，line-level +/- 已足够。`@pierre/diffs` 留 V0.2 候选 —— 真需要 hover/highlight + scoped 语言时再切换

##### `file_write` — 仅 path + mode

- 显示 `path`（mono）+ `mode pill`（overwrite/append/prepend）
- 下方 muted 一行："内容由 LLM 当前回复决定，将写入此文件"
- **不做内容预览**：GA 架构限制（`do_file_write` 跑时才从 `response.content` 提取，dispatch 拦截时还没跑），提前预览需要复刻 GA 逻辑，违反 non-invasive

##### `code_run` — 命令展示

- mono 等宽 + 语言高亮（bash / python / powershell）
- 多行命令完整展示（不截断）
- 顶部 language pill

##### `start_long_term_update` — memory 写入

- 显示 memory key + 内容预览
- high risk 标记，**Always allow globally 选项 disabled**

### 4.7 Inspector（已退役）

右侧 Inspector panel 已在 2026-05-12 退役，不再是当前布局基准。

退役原因不是"暂时没做"，而是信息归宿更清楚了：

| 旧 Inspector 信息 | 当前归宿 |
|---|---|
| Tool raw / args / stdout / result | 对应 Tool callout 内 inline 展开 |
| Pending approvals | Approval Dock + waiting_approval Tool callout |
| Approval 历史与 always-allow 规则 | Settings → Approval |
| Runtime / GA path / Python / LLM displayName | Sidebar runtime dot + Settings → Runtime |
| Message copy / save | Message Actions |

产品判断：右侧常驻面板让 Galley 读起来像 IDE，而不是本地 agent team orchestrator。把信息放回触发它的上下文，用户少一次"去右边找详情"的认知跳转，也释放了 conversation column 的阅读空间。

如果未来需要 Memory Inspector / file inspector，必须重新设计入口与信息架构，不复用旧右栏槽位。
