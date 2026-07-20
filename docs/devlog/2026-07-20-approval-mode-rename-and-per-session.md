# 审批模式重构：YOLO 更名「自动执行/逐步审批」+ per-session 化 + Composer 单控

日期：2026-07-20
参与：JC + Claude
产出：migration 034、`ApprovalModePill`、TopBar YOLO 徽章退役、Settings 审批页重构

## 问题

1. **命名**："YOLO" 是 coding-agent 圈黑话，对 Galley 目标用户是纯认知门槛。
   确认弹窗里需要一行字解释缩写含义（`YOLO = "You Only Live Once"`）——
   一个名字需要在 UI 里自我注释，就是命名失败的直接证据。语气上"梗"和
   安全开关的严肃性也互相打架。Cursor 后来同样把 YOLO 改成了 auto-run。
2. **作用域与入口错配**：模式是全局 pref、默认开启，TopBar 常亮警示徽章
   随之失去警示价值（常亮的警示等于没有警示）；而用户的真实心智是
   "**这个任务**要不要盯着"——会话级的问题被迫用全局开关回答。

## 决策

- **命名**：「自动执行 / 逐步审批」（en: Auto-run / Step approval）。
  原则：说行为，不说态度；成对、自解释。
- **作用域**：per-session 覆盖 + 全局默认。sessions 表新列
  `approval_mode`（NULL/'auto'/'approval'，migration 034）。继承语义 =
  **跟随默认直到显式覆盖**；pill 里显式选择（即使与默认相同）即钉住，
  只有「恢复跟随默认」解除。
- **单控原则**：Composer 审批模式 pill 是唯一交互控件（控件即状态，
  永远显示当前会话生效模式）；Settings 审批页只放"新会话默认"
  （SegmentedControl）；**TopBar 徽章退役**。作用域教学放 pill popover
  footer（跟随默认 · 在设置中修改 / 仅此会话 · 恢复跟随默认），不引入
  第二个开关。
- **确认弹窗只保留一处**：Settings 把默认从逐步审批切自动执行时
  （影响面全局）。pill 的会话级切换一键完成——会话级、可逆、popover
  文案已说明后果。
- **pill 运行中可用**：`set_yolo_mode` 即时生效，跑着的会话切逐步审批
  正是"我要开始盯着"的合法动作（与 LLM pill 的运行中禁用相反，各有理由）。
- **allowlist 规则区不再因默认为自动执行而置灰**：规则作用于任何处于
  逐步审批的会话，常显 + 一行作用域说明。

## 实现要点

- **runner/ 零改动**：`SessionState.yolo_mode` 本来就是每 bridge 进程一份、
  `set_yolo_mode` IPC 逐会话路由——"全局"只是 GUI 用一个 pref 把所有会话
  推成同值。per-session 化全部发生在 GUI/core 层。
- 内部标识符不改名（`yolo_mode` pref key、`set_yolo_mode` wire、`yoloMode`
  store 字段）：数据/协议兼容，改名只发生在用户可见文案。新增物用中性名
  （`approval_mode`、`ApprovalModePill`、`lib/approval-mode.ts`）。
- 生效模式解析收敛在 `effectiveApprovalMode()` 一处，pill / bridge ready
  同步 / 默认值广播三个调用点共用。默认值广播跳过有覆盖的会话。
- EmptyState 预选走 `pendingApprovalMode`（与 `pendingLLMIndex` 同生命周期，
  createSession 消费、必清除）。
- `SessionBrief.approval_mode` 为 v1 additive 字段，CLI 契约无破坏；
  agent-api 本就没有暴露任何 yolo 字段。

## 被否方案

- **TopBar + Composer 双控**（全局与会话各一个开关）：两个开关同屏必然
  引出"哪个说了算"的认知税；状态不一致时 TopBar 显示的是对当前会话不成立
  的状态，等于撒谎。
- **改名但保持全局 + TopBar**：解决认知门槛但保留作用域错配。
- **创建时拷贝默认值**（另一种继承语义）：改默认后已有会话不跟随,
  "会话没动过就跟随默认"更可解释，且与广播机制天然吻合。
- **pill 切换弹确认**：会话级高频操作套全局级重确认会杀死 per-session
  的意义。
- **会话行加模式小盾牌**：sidebar 已有琥珀色"等待审批"态覆盖"需要你"
  时刻；常驻模式徽标是噪音，需要时再议。

## Dogfood 踩坑：migration 注册清单不止一处

首次 dev 验收时历史会话"全部消失"：`034_session_approval_mode.sql` 文件
加了、4 个测试装置的迁移清单补了，但**运行时并不扫描 migrations 目录**——
`core/src/lib.rs` 的 `Migration` vec 和 `core/src/migration_backup.rs` 的
`MIGRATION_SPECS` 两份显式注册清单都没登记，app 启动从未应用 034，
`SESSIONS_SELECT_COLS` 查询 `approval_mode` 全部报 no such column →
侧栏空（数据本身无损）。lib.rs 里"adding a new migration only requires
editing one place"的注释与现实不符。已修复并把完整登记清单写进
engineering-workflow.md I3。

## 二次修订：footer 从解释句改为就地默认控件

首轮 pill popover footer 用「跟随默认 · 在设置中修改」承担作用域教学，
JC dogfood 判定费解——一句话压缩了两个事实 + 一个隐藏跳转动作，属于
"需要解释的控件"（与 YOLO 需要解释缩写同病）。改为：选项区加「本会话」
小节标签，footer 变成「新会话默认」标签 + 迷你 SegmentedControl 就地
修改（切自动执行仍走共享 `AutoDefaultConfirmModal`，与 Settings 同闸）。
作用域教学从解释句变成两个带标签的值并列可见。被否：仅改文案仍跳设置
（保留跳转断裂感，治标）。

## 三次修订：pill 按状态收放

JC 指出模型 pill 与审批 pill 视觉层级相同甚至后者更重（多个图标）。诊断：
信息价值不对等——模型名每刻有信息量，审批模式 99% 时间等于默认值，
广播默认态的常驻文字违反 layout-and-chrome.md 既有原则（"已定型的偏好
不是可行动信息"）。改为按状态收放：生效模式=默认时收成 icon-only 28px
（模式名进 tooltip），偏离默认时自动展开 icon+文字——「逐步审批」恰在
需要被看见时变得可见。两态均去掉 CaretUp。被否：永远 icon-only（安全
状态只靠 hover 发现）/ 挪右侧图标堆（语义属对话配置区）/ 仅降字重（治标）。

## 四次修订（定稿）：并入 LLM pill

三次修订的"按状态收放"仍未解决根问题——两个独立控件在同一行争层级。
JC 提出合并：模式图标（⚡/✋）成为模型名前的图标（模型此前恰好无图标），
popover 变成完整的会话配置面板：模型列表（主）→ 安静的审批模式区
（从，name-only + 覆盖时「恢复跟随默认」行）→ footer 双设置深链
「配置模型… / 审批设置…」（都用 Gear——此层图标语义是"去设置"；
审批入口顺带给了白名单规则页从 composer 出发的唯一路径）。popover 内
不放任何默认值控件（二次修订的迷你分段随之移除，`AutoDefaultConfirmModal`
回归 Settings 专属）。合并的关键行为改造：`stopMode` 只封锁模型行
（置灰+提示），popover 照常打开、模式区可用——保住"运行中切逐步审批"。
独立组件 `ApprovalModePill.tsx` 删除。风险知情：⚡ 在模型名前可能被
误读为"turbo 变体"，Galley 无此概念 + tooltip 消歧，dogfood 观察。

## 五次修订：模式区瘦成一行动词

合并后 JC 仍觉冗长：两行状态陈列 + 两行设置深链，从属区几乎与模型列表
等高，体积破坏主从（"用户默认觉得这是模型选择器"是正确心智，问题在
从属内容的体积）。收敛：popover 里的行应是**动作**不是状态陈列——当前
值已由 trigger 图标表达，二元模式只需一行动词「改为{另一模式}」；
「审批设置…」深链同步撤掉（低频设置，TopBar 齿轮两步可达，双 Gear 行
不值）。最终新增体积 = 一行（覆盖后两行）。被否：一行内联双选
（`自动执行 ✓ · 逐步审批`，教学性稍好但可点性不直白、噪音略多）。
随后 JC 再收一刀：动词行降到与「配置模型…」同款 11px 行样式，并与之
合并为单一动作栏（一条分隔线）——popover 只剩"内容 / 动作"两个字号
层级，原本夹在中间的 12px 档消除。

## 终修：覆盖语义改为"偏离默认"，恢复行删除

JC 发现回切异常：手动切逐步审批再切回自动执行后，明明已等于默认，
「恢复跟随默认」仍显示。根因：「显式选择即覆盖（即使与默认相同）」是
两行状态陈列 UI 时代的规则；动词行 UI 下用户点「改为自动执行」的心智
是**撤销**，不是钉住，规则与界面心智脱节。修法：**覆盖 = 偏离默认**——
选择等于当前默认的模式即清除覆盖（store 归一化写 NULL；EmptyState
pending 同规则）。连锁推论：偏离态下动词行的目标必然是默认值，点击即
自动复原跟随——「恢复跟随默认」行与之完全冗余，整行删除（JC 原本只
问"恢复跟随默认改成恢复默认是否更好"——最好的文案是不需要存在的
文案）。popover 从此无条件分支。边界如实记录：偏离中的会话若默认事后
被改到相等，覆盖静默留存（行为无异）；默认再改走时该会话钉住——有意
的偏离不随默认横跳。

## 后续

- 首启弹窗（`yoloIntro` 机制不变）文案已改为「Galley 默认自动执行」。
- 代码注释里散落的陈旧 "PRD §11.5" 引用未清理（历史注释,与本任务无关）。
