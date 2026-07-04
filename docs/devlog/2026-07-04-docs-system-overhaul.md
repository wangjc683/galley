# 文档系统整备：生命周期 + 单一索引 + 巨型文档拆分 + 链接门禁 + 资产政策

> Date: 2026-07-04
> Status: complete — P1–P5 全部落地，全部门禁绿
> Related: [docs/README.md](../README.md)（新 Lifecycle / Keep Docs Lean 约定）· [engineering workflow](../engineering-workflow.md)（收编硬不变量）· [screenshot playbook](../screenshot-playbook.md)（二进制资产政策）

## Context

docs/ 长到 181 个 md / 27MB。诊断出的真病灶不是「缺分类」，而是三件事：
活文档和死文档混住（refactor/ 已完成使命却还坐在宪法索引里）、同一份路由
索引在三处重复维护（AGENTS.md / docs README 任务表 / Document Roles 节）、
三个 1400+ 行巨型文档让 agent 为一个小问题付整本上下文费。优化目标定为：
新 session 到达该读文档的步数最少、现实变化一次只改一处、系统放着不管
不会烂（机器门禁而非人肉大扫除）。

## Decisions

- **P1 生命周期用位置编码，不用逐文件标头**：`docs/archive/**` = 归档、
  `docs/devlog/**` = 天然历史、其余 = living。原方案「每份文档头部一行
  status」在实施时被推翻——位置已编码状态，逐文件标头是纯维护负债。
  refactor/（B1–B4 已随 v0.2.0 发布）、design-handoff/（一次性交付包）、
  english-copy-draft.md（英文 UI 已落地，活源头是 `gui/src/i18n/locales/en.ts`）
  移入 archive，各带 ARCHIVED 横幅。
- **归档前先抽活规则**：refactor/invariants.md 里 I3（migration 号段）、
  I5（GalleyApi trait 单源）、I6（前端 stateless presenter）、I9（已 ship
  数据格式契约）、I11（panic=unwind）是永久规则，收编进
  engineering-workflow.md「Hard Engineering Invariants」节，编号保持不变
  （devlog / commit message 引用过这些 ID）。
- **P2 索引单源**：docs/README.md 任务表是唯一完整路由表（Document Roles
  节删除，一句话简介并入表格）；AGENTS.md 只留 10 行高频路由 + 兜底指针，
  并明文「两者不一致时以 docs index 为准」。
- **P3 三个巨型文档拆目录**：DESIGN.md（1547 行）→ `docs/design/` 7 文件、
  agent-api.md（1491 行）→ `docs/agent-api/` 7 文件、managed-ga-runtime.md
  （1441 行）→ `docs/managed-ga-runtime/` 7 文件。切分粒度按「一个 session
  通常一起需要什么」。逐字搬运（diff 校验 byte-for-byte，仅链接深度调整）。
  原路径留 < 30 行重定向 stub 带 section→file 映射——`docs/agent-api.md`
  路径被外部 SOP / skill 副本引用，stub 是承重的。索引直指新 README，
  其余活文档走 stub 一跳（避免动 supervisor SOP 等有逐字副本门禁的文件）。
  拆分阈值 ~1000 行写进 docs/README.md § Lifecycle。
- **P4 链接门禁**：新增 `scripts/check-docs-links.mjs`（挂 check.yml +
  session-close SOP）。两条硬检查：相对链接必须可解析、docs/ 顶层活文档
  必须出现在路由索引。**历史文档（devlog/archive）只查指向 docs/ 内部的
  链接**——它们指向代码的链接写下时是对的，代码搬家后修它等于改写历史、
  且是永久噪音源。首跑抓到 50 条存量死链：活文档 7 条真修（galley-native
  runtime 3 条相对路径错、architecture-demo 4 条指向已模块化的
  socket_listener.rs/db.rs），其余按历史豁免规则消化。
- **P5 资产政策设在入口**：已提交的二进制永远留在 git 历史里，压缩/删除
  存量只会让仓库更大——所以政策管未来不追溯：只提交被引用的资产、README
  截图同名覆盖 + 提交前缩到 2× 展示宽 + 单张 ≤600KB、审计证据 JPEG/降采样
  且落选抓拍不进 repo、参考 PDF 放 `~/Documents/galley-refs/`。写进
  screenshot-playbook（全 docs 通用节）+ audits README 指针。

## Rejected alternatives

- **Diátaxis 式顶层四分类目录**：25 个顶层文件由一张好索引路由足够；搬目录
  引发链接 churn，分类信息放索引表比放文件系统维护成本低。
- **逐文件 status 标头**（原 P1 方案）：被「位置编码状态」取代，见上。
- **压缩/删除存量大图**（audits 14MB、screenshots 10MB）：旧 blob 留在
  历史里，重写文件反而增量；audit 的 `rejected/` 目录是报告有意引用的
  证据，删除与文档自述矛盾。按现状保留，政策只管未来。
- **门禁校验 anchor 片段**：CJK 标题的 anchor 生成规则易误报，性价比不足。
- **强修 devlog 里 43 条指向已改名代码目录（desktop/→gui/ 等）的死链**：
  改写历史 + 永久噪音，历史豁免规则更诚实。

## Open questions

- devlog README 时间线表单调增长（现 122 行），到 ~200 行时按季度/阶段
  分段；预案已有，未到阈值。
- zh 暗色 hero 截图右上 tooltip 入镜的既有瑕疵仍挂在 screenshot-playbook
  待办，owner 定重拍与否（与本次无关，顺带确认未被资产政策掩盖）。

## Next

- 无强制后续。新增文档时按 docs/README.md § Keep Docs Lean 的「一处索引 +
  高频才进 AGENTS.md」执行，链接门禁在 CI 兜底。
