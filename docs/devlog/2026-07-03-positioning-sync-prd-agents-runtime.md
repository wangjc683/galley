# 2026-07-03 · 定位同步：PRD / AGENTS.md / Runtime 页内核化

> 同日第四篇。前三步（colophon 立场块删除、GA 预算、内核称谓）都是
> 「独立产品」定位的下游实践，但 PRD 和 AGENTS.md 还写着旧框架——实践
> 跑到了宪法前面。本 session 把定位补进宪法层，并把「内置 GA」在全库
> 用户可见文案中扫清。

## 宪法层

- **PRD**：header 增加 **2026-07-03 定位更新**条目；§3 产品定位增加
  「**自有引擎（owns its engine）**」bullet（内置 managed runtime =
  产品引擎与开发重心），原「Non-invasive to backend」改为
  「Non-invasive to **attached** runtime」——runtime-agnostic 保留为
  **架构余量，不是产品身份**；定位演化 blockquote 续写第三段：v0.1
  companion app → v0.2 wraps GA → 2026-07-03 独立产品（引擎是自己的，
  不是包着别人的）。
- **AGENTS.md Product Shape**：补 Positioning 段（independent product /
  derivative work / managed = engine & focus / attach = compatibility
  mode），指回 copy-language-guidelines 的内核规则。
- **README（中英）核对后不改**：hero 与 What Is Galley 本就身份先行、
  引擎沉默；正文的 GA 均在功能事实（bundled runtime 开箱即用）与
  credit（attach 段、Why Galley、Acknowledgments）位置——README 是
  文档面不是品牌一句话，事实透明是开源体面，不适用 UI 的内核改写。

## UI 文案：「内置 GA」全库清零

Runtime 页 + sidebar + models + toasts + 硬编码兜底，双语共 ~26 处，
「内置 GA」→「内置内核」（en: bundled engine），配套：

- Runtime subtitle：`Galley 使用的 GenericAgent 运行环境` →
  `Galley 的运行环境`（en: `Galley's runtime`）。
- `kernelVersion` en：`Runtime version` → `Engine version`（zh 本就是
  「内核版本」）。
- healthDescription 顺手落实 austerity §3 的既定示例改写（删「不知道
  哪儿出问题了？」修辞反问 + 「GA 路径」→ 模式中立的「运行环境」）。
- 硬编码点：`stores/sessions.ts` runtimeLabel 兜底 ×3、`lib/bridge.ts`
  错误兜底 ×1。**注意**：runtimeLabel 是会话创建时的持久化快照，存量
  会话仍显示「内置 GA」——历史快照如实保留，不做数据迁移。
- 保留不动：「外部 GA」全系（attach 语境）、`genericAgentVersion`
  「GenericAgent 版本」（外部 GA 诊断卡）、教程与 SOP 文档。
- copy-language-guidelines 的 Settings 表 Runtime subtitle 行同步。

## 验证

`pnpm --dir gui typecheck` + `lint` + `git diff --check` 全过；
`grep 内置 GA` 全库清零（含 stores / lib 硬编码）。视觉验收留 owner
dogfood（重点：Runtime 页模式卡「内置内核 / 外部 GA」并排的读感）。

## 定位同步待办清单收口

2026-07-03 colophon devlog 列的四项：About tagline ✓（GA 预算 session）、
attachTrust ✓（内核规则 session 判定保留在 attach 流程）、PRD ✓、
AGENTS.md Product Shape ✓（本 session）。清单关闭；后续零星表述随
触碰随改（引用内核规则即可，不再单开 session）。
