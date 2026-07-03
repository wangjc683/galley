# 2026-07-03 · README 截图双语重拍：实拍偏差与最终口径

> Status: shipped · Related:
> [screenshot playbook](../screenshot-playbook.md)（正式口径的唯一现行文档）·
> [2026-07-03 README 双层价值主张 devlog](./2026-07-03-readme-two-layer-value-prop.md)（本次资产任务的来源）

## Context

README 重构时发现五张截图全为 v0.1 dev-mock 建构（调试按钮、废止的全大写
wordmark 入镜），列为最高优先资产任务。本次按
[screenshot playbook](../screenshot-playbook.md) 完成 zh / en 双套重拍并替换
README 引用。playbook 保持「现行口径」；本文记录实拍过程中偏离原清单的
决策与理由，避免把历史叙事堆回 playbook。

## 实拍事实

- 种子：`scripts/seed-screenshots.py` zh / en 双套注入（离线自检全绿：goal
  匹配启发式、JSON 列、turn 布局、关键词命中）。
- Hero 真跑：glm-5.2 裸端点。zh =《哲学研究》中译本豆瓣评分/评论对比；
  en = Goodreads 英文版本（Anscombe vs. Hacker & Schulte）对比。两者均满足
  playbook 准入标准（评分 / 评论数是此时此刻的数据，模型无法直答）。
- 可行性验证结论（写回 playbook 种子段作为长期约束）：Goal 章节框可纯种
  （终态 goal + objective 与用户消息逐字一致）；running 态可种且重启存活
  （Core 启动无状态调和），但 subline 只有「思考中…」且不可点开；ask_user
  纯内存态**不可种**，只能现场真跑制造。

## 与原清单的偏差（均已采纳为正式口径，playbook 已同步）

1. **Goal 专场（原 03-goal）撤销，换项目视图（02-projects）**：owner 决定。
   项目视图带项目感知输入框（「在 <项目> 里交代什么？」+「将创建到 <项目>」），
   比 Goal 章节框更能承载「编排」叙事；Goal 数据仍种（读书会会话），在
   sidebar 里以完成态出现。
2. **空状态收编为正式第四张（04-empty）**：拍摄中额外拍的「安静待命的
   工作区」构图（满员 sidebar + 居中 composer + 题词占位）被 owner 收编进
   网格。
3. **「等你回复」态未入选**：现场真跑制造成本高（ask_user 不可种），且
   状态板叙事已由 02-projects 承担。高铁班次种子保留，仅不再要求入镜。
4. **Hero 从「奥德赛排片」换成「书版本对比」**：同样过准入标准，且与
   「维特根斯坦哲学与 LLM」项目彩蛋一脉相承；排片 prompt 时效性强（临近
   上映才有效），降为备选。

## 已知瑕疵（open）

- zh 暗色 hero（05-hero-dark）右上入镜外观 tooltip（「深色 · 当前深色」），
  en 套干净。重拍一帧或接受，owner 定。

## 产出

`docs/screenshots/{zh,en}/01-hero / 02-projects / 03-search / 04-empty /
05-hero-dark`，旧平铺五张删除；两份 README 切换到对应语言目录，hero 用
`<picture prefers-color-scheme>` 明暗自适应。下一个独立资产任务：演示 GIF。
