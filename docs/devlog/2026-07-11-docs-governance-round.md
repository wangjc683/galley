# 2026-07-11 — 文档全面体检:陈旧修正 + 防漂移机制

## Context

本周四个架构重构落地后,JC 要求对全部文档做一轮体检(内容陈旧点 +
结构可维护性)。三路并行审计(结构清单 / 代码陈旧 / 交叉引用)+ 主
agent 逐条核实的结论:**目录布局与命名基本健康,不值得重组**;真正
的问题是索引缺口、更新触发器缺失(漂移的机制性根因)、以及约 15 处
具体陈旧/矛盾。JC 定调:中档力度(修正+机制,不搬目录)。

## 修了什么

- **schemaVersion 冻结表述**:6 个文件里的「frozen for v0.2.x」改为
  版本无关表述(现已 0.3.1 仍冻结,旧措辞每过一个版本线就错一次)。
- **错误判别符单一来源**:ipc-protocol.md 不再自带一份(缺
  `runner_error` 的)判别符清单,统一指向 agent-api
  stability-and-versioning §2/§2A;代码之家标注为
  `core/src/protocol/error_tag.rs`。`not_implemented` 三处公示统一标
  注 reserved(两端从未发射;从冻结契约删除名字反而是变更)。
- **行号引用降级为符号引用**:architecture-demo.md 五处、ADR-0001 一
  处失效行号全部改为「文件 + 符号」。本轮陈旧点的最大来源就是行号
  rot,活文档今后不再写行号(architecture-demo 头部已注明此规则)。
- **归属修正**:ipc-protocol §10 的 history 适配归属改指
  `ga_session.py`;ADR-0002 加附记(DbSource 缝的存在与该 ADR 的核心
  决策不冲突,动机是测试注入而非统一化)。
- **杂项**:project-status 不再链 redirect stub;ga-baseline 标注
  audited ≠ shipped;supervisor SOP 的 Boundaries 缩水副本删除、指向
  reference canonical(技能副本已按 copy-first 规则重新同步);
  archive/refactor README 的活文口吻加历史快照声明。

## 机制(防再漂移)

- **docs/README.md 补全为真正唯一索引**:收编 CONTEXT.md、docs/adr/、
  docs/agents/ 三处此前只活在 AGENTS.md 平行索引里的文档——违反它自
  己 line 79 规则的状态结束。
- **新增 Update Triggers 表**(docs/README.md):每份活文档一行「做
  了 X 就必须更新我」。此前只有 project-status / agent-api /
  ga-baseline 三者有明确触发器,architecture、CONTEXT.md、devlog 索
  引等全靠自觉——这是索引落后 8 篇、v0.2.x 措辞存活三个月的机制性
  原因。
- **session-close SOP**:写 devlog 必须同 change 更新 devlog README
  索引行。
- **issue tracker 生命周期补全**:triage-labels 补终态 `done`(实际
  已在用);issue-tracker 补「发货后处置」规则——要点入 devlog 后整
  目录删除,`.scratch/` 只放 in-flight。

## 清理(含一次处置记录)

- 删除 `docs/audits/.../screenshots/rejected/` 7 张 PNG(违反 audits
  README 自己的政策,无任何引用)。
- 按新生命周期规则删除 `.scratch/goal-solo-hive/`(4 文件,feature
  已随 v0.3.x ship)。**删除时点的残留开放项**(备忘,非新决策):
  1. JC 桌面 dogfood 验收 solo 全链路(单测覆盖不到 live bridge 循
     环)——打磨轮二修复「待实跑」见
     [2026-07-09 entry](./2026-07-09-goal-solo-dogfood-round-two.md);
  2. 假设 A(API 默认 hive / GUI 发 solo)待 JC 确认;
  3. issue 03 的真实旧库升级路径待 JC 用带历史 goal 的库验证。

## 被否方案

- 目录级重组(审计显示布局健康,链接断裂成本 > 收益);
- devlog 索引脚本生成(新工具维护成本 + 一行摘要质量降为机械提取);
- 从契约文档删除 `not_implemented`(reserved 标注代替);
- 修复 devlog/archive 内的历史断链(历史快照,照旧)。

## Verification

活文档相对链接全量扫描零断链;`v0.2.x` 措辞在活文档中清零;devlog
索引 138 行 = 目录 138 篇;supervisor 技能副本与 canonical diff 一致;
`git diff --check` 干净。纯文档轮,未跑代码测试。
