# Tool Callout 与审批

> Galley 设计系统 · 原 DESIGN.md §4.5–§4.7（2026-07-04 拆分）：Tool Event Callout 状态映射、Approval Dock / Approval Card、工具特定渲染、Inspector 退役记录。

### 4.5 Tool Event Callout

#### 双层形态：settled pill / attention block（2026-06 分层，2026-07-05 回写）

工具事件按注意力需求分两种形态，**不按工具名分**（曾按 file_patch 等
"审计价值" 保留 block，结果 settled turn 里 pill 与 block 混排、视觉
跳动，已否）：

- **inline pill**（`InlineToolPill`）：所有已结算成功的工具。单行：
  Phosphor 图标 + 中文友好名（主标签）+ 右侧 mono GA 工具名 + 单行
  arg 预览（路径类从头部截断、保留文件名尾部）。点击展开完整
  args / result。字号走 `--conversation-tool-label-size` /
  `-tool-mono-size`，随三档字号缩放。
- **block callout**（`BlockToolCallout`）：一切需要注意力的状态
  （waiting_approval / failed / running / denied）。左 3px 状态竖条 +
  1px 边框 + 8px 圆角（`rounded-callout`）；waiting / failed 额外带
  4% 状态色 tint（早期"不用 background tint"的规则在 dogfood 后放宽：
  暖米白底上仅靠竖条不足以传达"停下来看这里"）。head：状态位 +
  mono 工具名 + status pill + elapsed（`tabular-nums`）+ `CaretDown`。

#### 7 状态映射与数据流现实（2026-07-05；2026-08-11 增 failed-historical）

| 状态 | 形态 | 视觉 | 默认展开 |
|---|---|---|---|
| running | block | brand 竖条 + `CircleNotch` 旋转 + `LiveDots` + elapsed | 展开 |
| success-current | block | brand 竖条 + `CheckCircle` | 展开 |
| **success-historical** | **pill** | 安静单行，融入文档 | 折叠 |
| waiting_approval | block | 琥珀竖条 + 4% tint + `Pause` | **强制展开** |
| failed | block | 红竖条 + 4% tint + `X` | **强制展开** |
| failed-historical | block | 淡红竖条 + `X`（红），headline 领行 | 折叠（审计一击可达） |
| denied | block | muted 竖条 + `Prohibit` | 折叠（决定已知） |

**数据流现实**：`turn_end` / 历史恢复产出 `success-historical`、
`failed-historical` 与 `denied` 三种结算态。denied 由 GUI 解析
Galley 自己的拒绝载荷识别（`{"status": "denied"}`，写入方
`runner/handlers.py`、解析方 `gui/src/lib/tool-outcome.ts`，双侧注释
互指）。failed-historical（2026-08-11，galley#22）识别 GA 工具的
错误信封 `{"status": "error", ...}` —— 与 denied 同级的精确匹配
coupling point，不是内容嗅探；headline（traceback 末行 / msg 首行）
走 callout 的 summary 槽位，解码后的错误体取代原始 JSON 预览。
**live `failed` 仍无生产者**；running / success-current 需要 bridge
增加工具级事件，留待 Phase 2 协议扩展（见 2026-07-05 devlog）。

#### 展开内容

- **args**：mono 等宽 key/value（无语法高亮——V0.1 范围），max 200px 滚动
- **result preview**：mono 等宽，max 200px 滚动；上游 500 字符截断，截断处
  显示 `…`（完整结果出口待 Phase 2 数据层支持）
- **file_patch 结算态**：复用审批期的 `PatchView` split diff（同一
  480px 滚动窗）——不再把 old/new content 当 JSON args 倾倒
- **denied**：不回显内部拒绝载荷（状态 chrome 已说明"已拒绝"）

### 4.6 Approval Dock + Approval Card

#### Approval Dock（Composer 上方 sticky）

- **仅在有 pending approval 时存在**（不是 hide，是不渲染）
- warning 琥珀浅 tint 背景（`bg-warning/[opacity-subtle]`）+ 3px 深琥珀左竖条 —— 待审批是 caution 态，统一归到琥珀；杏沙留给功能与「已通过」正向态
- 单行：`{count} pending approval · Next: {tool_name}` + Advance button
- **不可 dismiss**（必处理状态必须 surface）
- hover tooltip 预览：V0.2 候选，未实现（2026-07-05 回写）
- 决策仍必须在对应的 callout 内做（dock 是 navigator，callout 是 decider）

#### Approval Card（waiting_approval 状态的 inline form）

**不是独立组件**，是 Tool callout 的 waiting_approval 形态。展开后内嵌：

- **风险等级 pill**：high（深红）/ medium（深琥珀）/ low（info 蓝——
  实现时从 muted 升为 info：low 也是"被拦下来"的状态，纯 muted 读作
  无信息）
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
  - Header：path（mono）+ 文件 size delta（`+12 行 / −3 行`，走 copy 层
    本地化，12px muted）
  - Split layout（左旧右新）/ 行号显示
  - +/- 行用 success/error `--opacity-soft`（12%）tint 背景；空
    placeholder 行用 hover-tint 斜纹
  - max-height 480px，超出 scroll（审批态与结算态展开共用）
  - 无独立折叠态（"header + View diff" 方案未实现；折叠语义由外层
    callout 承担）
- 为什么 V0.1 必做：file_patch 是审批高频工具，没 diff 视图等于"审批黑盒"，违反"不要让用户思考"原则
- 为什么不用 `@pierre/diffs`：试过，其 Shiki backend 拉所有语言包进 bundle（+400 KB gzip）。V0.1 审批界面不需要工业级语法高亮，line-level +/- 已足够。`@pierre/diffs` 留 V0.2 候选 —— 真需要 hover/highlight + scoped 语言时再切换

##### `file_write` — 仅 path + mode

- 显示 `path`（mono）+ `mode pill`（overwrite/append/prepend）
- 下方 muted 一行："内容由 LLM 当前回复决定，将写入此文件"
- **不做内容预览**：GA 架构限制（`do_file_write` 跑时才从 `response.content` 提取，dispatch 拦截时还没跑），提前预览需要复刻 GA 逻辑，违反 non-invasive

##### `code_run` — 命令展示

- mono 等宽，**无语法高亮**（与 PatchView 同一个 V0.1 取舍：审批面
  不值得为高亮拉语言包）
- 多行命令完整展示（320px 滚动窗内）
- 顶部 language 标签（mono uppercase）

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
