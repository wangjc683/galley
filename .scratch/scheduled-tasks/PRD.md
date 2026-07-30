# PRD: 定时任务（Scheduled Tasks）

Status: ready-for-agent
Date: 2026-07-23（同日 JC 确认通知策略，issues 已拆分，见 `issues/`）
来源: JC 与 agent 的设计讨论（本文件是讨论结论的沉淀，尚未开始实现）

## 背景与动机

Galley 目前完全没有定时/调度能力。现有"自动化"模型是被动的：外部
Supervisor 通过 CLI 驱动，Galley 自己从不主动发起任何事。managed GA
运行时自带一个会话内 cron（`managed-ga/state-seed/memory/scheduled_task_sop.md`
的 `scheduler.py` + `sche_tasks/*.json`），但对 Galley 编排层不可见，
也未作为产品能力暴露。

## 目标场景

**桌面人类操作者的例行任务**：「每天/每周固定时间起一个 session 做 X」，
如晨间摘要、定期巡检仓库。GUI 是主入口。

非目标（v1）：Supervisor 注册周期任务的自动化面（CLI 命令天然可被
supervisor 调用，但不为此设计额外能力）。

## 定案决策

### 1. 调度权威：Core 原生调度器

- Rust Galley Core 新增 scheduled task 实体：SQLite 持久化（`core/src/db/`
  + `db_migrations.rs`），tokio 后台循环挂在
  `start_background_services`（`core/src/app_setup.rs:298`）。
- 依赖 tray 常驻后台模式（`core/src/tray.rs:211`）作为进程驻留前提。
- 到点触发走现有命令通路创建 session。GUI / CLI 都是纯 presenter，
  符合 Rule 5。
- CLI 若增加 `galley schedule …` 命令面，为 additive，不破
  `schemaVersion: 1`。

### 2. 实体形态：不发明新概念

一个 schedule = 「project + prompt + 重复规则 + 开关」。触发后创建的
是**普通 session**，与手动创建完全同构，进正常会话历史和 sidebar
时间线。不引入"定时会话"这种新会话类型。

### 3. 审批策略：v1 挂起等人

定时 session 跑到需审批的操作即停住，GUI 打标记等人处理。**不做**
"定时任务自动免审批"——那是 `docs/galley-native/rfc-4-capability-packs.md:346`
标记的危险行为。晨间摘要类只读场景大多碰不到审批。per-task 免审批
配置留给 v2，等真实使用暴露需求。

### 4. 错过触发：同周期补跑一次（周期 = 计划触发的当地日）

- Mac 合盖睡眠是常态：9:00 的任务在 9:40 唤醒时照跑（同一周期只补
  一次），静默跳过会摧毁信任。
- 补跑仅在计划触发的**当天**有效，过当地午夜即丢弃、不追溯。实现中
  发现无边界的补跑会导致「昨天错过的 9:00 在今天 8:59 补跑、9:00 又
  跑今天的」——一分钟内两次晨间摘要（见 `core/src/scheduler.rs`
  的 `catch_up_expires_at_local_midnight` 测试）。
- app 完全退出期间不触发、不追溯补历史欠账。UI 需说明「仅在 Galley
  运行时触发」。

### 5. GUI 入口：quick actions 块新增一行，位于「搜索」与「项目」之间

- 位置为 JC 定案（2026-07-23）：`SidebarQuickActions.tsx` 中，
  「新建对话 / 搜索 / **定时** / 项目」。
- 固定 chrome 块中的一行：角标永远可见（审批阻塞时显示，如
  「定时 ⚠︎ 1」），不与内容区混淆。
- 点击打开管理 dialog（overlay，复用 Settings 的弹层交互惯例；与
  「项目」行的 toggle 行为不同但外观同构，不发明新样式）。
- 地段纪律：quick actions 块是 sidebar 最贵位置，本次成立是因为
  「定时」有每日一瞥的角标价值；后续功能进入此块须同等门槛。

### 6. 管理 dialog：列表行，不用卡片

- 每行信息：开关、重复规则（「每天 09:00」）、prompt 摘要、
  上次运行状态（成功 / 卡在审批 / 失败，**可点击跳转到该 session**，
  关 dialog 并定位）、下次触发时间。
- 「上次运行 → 跳转会话」是信任闭环的关键一列。
- 创建入口：dialog 内「+ 新建」。
- 卡片对这种单行信息密度是纯装饰；若将来需要富信息（运行历史）再
  升级。

### 7. 通知策略（JC 已确认，2026-07-23；2026-07-30 修订）

「需要你行动」时发 macOS 系统通知：**审批阻塞**与**触发失败**
（2026-07-30 扩入，见决策 11 / issues/11）；正常完成只在 sidebar
入口行打角标。

### 8. 每任务模型（JC 提出，2026-07-24；见 issues/07）

任务可选固定模型（存 display name，`--llm` 同语义），空 = 默认。
正当性：无人值守 × 周期重复，成本按周期累积且触发时无人可换。
解析失败降级到默认模型照常触发，不杀任务。**范围刹车**：不再加
per-task runtime / 审批模式等配置项——它们没有这个属性组合。

### 9. 调度会话来源标识（2026-07-24；见 issues/08）

调度器产出的会话在 sidebar 显示时钟图标 +「定时任务创建」，特判
自现有 supervisor 标记（否则会误标为「Supervisor 创建」）。会话
内部不重复标注。

### 10. 空状态示例（2026-07-24；见 issues/09）

空状态下三个可点击示例（每天简报 / 每周下载整理 / 每月归档），
点击预填表单、确认才创建，有任务后消失。示例面向通用桌面场景，
**不做 Coding Agent 示例**（Galley 定位约束）。

### 11. 失败可见性（2026-07-30；见 issues/11）

信任面框架：无人值守的核心契约是三问——它跑了吗 / 没跑我知道吗 /
我能快速验证和修复吗。v1 做透了第 1 问，本决策补第 2 问。角标口径
从「审批阻塞数」扩为「需行动数 = 审批阻塞 + 上次运行失败（仅
enabled）」，合并单一数字；下次成功自动清除，无手动 dismiss。
**不放总任务数**——常亮静态数字稀释警示力（JC 提议后被论证说服
撤回）。失败发系统通知，无独立偏好开关（错误类通知不做配置项）。

### 12. 表单触发预览（2026-07-30；见 issues/12）

表单实时显示「首次 / 下次触发：绝对时间」，消除 strictly-after 语义
的预期陷阱（10:00 建每日 09:00 任务 → 明天才首跑）。编辑态走真实
baseline，「改到今天更晚的时刻会立即补跑」如实预告。日历计算 Rust
权威（新增只读命令 `preview_scheduled_fire`），不在 TS 复刻。

### 13. 立即运行一次（2026-07-30；见 issues/13）

行内 Play 按钮，走 `fire()` 同一条路并照常盖戳：手动运行成为
「上次运行」、成功重跑清除失败角标，due 数学保证未来计划触发不被
吃掉。无二次确认、不自动跳转、不检查 enabled（试跑暂停任务是正当
用法）。把「新建 → 验证 prompt」的回路从一天缩到一分钟。

## 已否决方案

| 方案 | 否决理由 |
|---|---|
| 桥接 managed GA 的 `scheduler.py` | 任务藏在 GA 状态里、对 Galley 编排层不可见、attach 模式不可用（Rule 1 禁写外部 GA 状态）、执行不产生 Galley session，与 "Galley owns orchestration" 相抵触 |
| 留在外部（launchd / supervisor cron 调 CLI） | 对纯 GUI 用户不可达；目标场景是桌面人类 |
| sidebar 常驻内容分区 | 无任务时是空 chrome；产出的 session 本来就走正常时间线 |
| 管理界面用卡片 | 信息密度撑不起卡片，滑向样式修补 |
| 入口放 Settings | 把产品功能藏进配置页，任务与其产出会话在空间上断开 |
| 入口放 sidebar 底部 | 原 agent 建议；quick actions 固定块本就是放机制的地方，且角标可见性更好 |
| 定时在已有会话上继续（2026-07-24） | 无人值守 × context 无限累积；失败失去隔离（一次跑歪传染后续触发）；「上次运行」失去干净指代。连续性需求的结构性解法是任务归入 project 聚合 + 将来的 GA memory，不拿会话当存储器。除非出现 project 聚合满足不了的真实用例，不重开 |

## v1 非目标

- 从已有会话「设为定时」的快捷创建（表单形态稳定后再加）
- per-task 免审批 / 信任配置
- cron 表达式级的复杂重复规则（v1 支持 每天/每周/每月 + 时刻；
  每月为 JC 2026-07-23 验收时补充的需求，见 issues/10。29–31 号在
  小月钳制到月末触发，不做 cron 式静默跳过）
- Supervisor 专用的任务注册能力

## 开放问题

1. ~~通知策略~~：已确认（见决策 7）。
2. 重复规则粒度：是否需要 `every_Nh` 类间隔？v1 建议只做
   每天 / 每周几 + 时刻。
3. 「定时」的用户可见命名与文案：按
   `docs/copy-language-guidelines.md` 走一遍。
4. dialog 表单字段细节（project 选择、prompt 输入、时刻选择控件）。
5. ~~「立即运行一次」~~：已落地（见决策 13）。
6. 可靠性前提引导（2026-07-30 JC 已同意方向，边界待探讨）：任务仅在
   Galley 运行时触发，是否在定时 dialog 内亮出「开机自启」状态并给
   一键开启；分歧点是有把 Settings 职责搬进功能 dialog 的味道。

## 关键代码锚点

- 调度器挂载点：`core/src/app_setup.rs:298`（`start_background_services`）
- 常驻前提：`core/src/tray.rs:211`（background mode）
- 持久化：`core/src/db/`、`core/src/db_migrations.rs`
- GUI 入口：`gui/src/components/layout/sidebar/SidebarQuickActions.tsx`
- CLI 命令面：`cli/src/args.rs`（顶层 `Command` enum）
- 敏感能力约束：`docs/galley-native/rfc-4-capability-packs.md:346`
- GA 已有 cron（仅参考，不对接）：
  `managed-ga/state-seed/memory/scheduled_task_sop.md`
