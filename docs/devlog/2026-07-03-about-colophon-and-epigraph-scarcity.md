# 2026-07-03 · About 版权页（colophon）+ 题词稀缺性收敛

> 同日气质总纲 session 的直接后续。把 Deferred 的 colophon 落地：About
> 页按文库本版权页的逻辑重组（零新增表面 / 零新增功能，同一页信息换一种
> 秩序），题词从空状态的高频出现收敛为「稀缺 + 有固定家」。

## Owner 定位决策（本 session 最重要的记录）

Owner 在 review colophon 方案时明确：**Galley 越来越定位于独立产品——
基于 GenericAgent 二次开发，而不是「GenericAgent 的 GUI」；此后开发重心
放在 patch 过的内置（managed）GA 模式上。**

本次的直接后果：colophon 方案中的「立场」块（数据留在本机 / 无遥测 /
删除 Galley 后 GA 仍独立运行）整块删去——第三句的「附属品框架」与独立
产品定位相抵。注意：前两句（本机 / 无遥测）本身与 GA 无关、仍是有效的
产品立场，只是不在版权页陈列；将来想收回是一个 i18n key 的事。

**尚未同步、待定位坐实后单独 session 过的面**（本次刻意不动）：

- `docs/PRD.md` 与 `AGENTS.md` Product Shape 的产品定性表述。
- onboarding 人格核心句 `attachTrust`（「Galley 不会修改你的
  GenericAgent…」）——attach 模式下仍准确，但其展示权重值得随定位重估。
- About tagline「基于 GenericAgent 的开源本地 Agent 工作台」——与
  「二次开发」定位不冲突，暂保留。
- 架构宪法（AGENTS.md Rule 1 attach/managed 双模边界）**不受影响**：
  非侵入规则本就只约束 attach 模式，managed GA 本就允许 patch。

## About → 版权页

`SettingsAbout.tsx` 重组，书序：wordmark + tagline → origin story →
版本（更新控件照旧，清楚优先）→ **版式**（新增：一行陈述正文与等宽
字体）→ **题词**（新增：PI §43 译文 + 德文 + 出处行，不加框）→ links →
footer。三个新 i18n key（`typesetting` / `typesettingDetail` /
`epigraphSource`），题词文本直接复用 `lib/epigraphs.ts` 的 `EPIGRAPHS`
数据（策展仍是单一来源）。

关键判断（沿总纲元规则）：隐喻沉在结构里不浮到标签上——分区标签叫
「版式」不叫「印次」；版权页陈述事实（书才会告诉你它用什么字体），
不放宣言、不放第二条引文、不做仿书页居中换皮（Settings 是工作台画布）。

## 题词稀缺性收敛

空状态题词只在 `silent`（工作区真正为空）渲染：每次 New Chat 都出现的
题词会墙纸化，题词的力量来自稀缺。实现是 `EmptyState` 渲染层一行门控；
`quiet` / `working` 绑定与 `resolveEpigraph` 的全函数契约原样保留（数据
不动，翻案 = 改一行）。题词的日常之家从空状态移到版权页：silent →
Tractatus 7（情境题词），colophon → PI §43（产品论题）。

## 验证

`pnpm --dir gui typecheck` + `pnpm --dir gui lint` + `git diff --check`
全过（exit 0）。视觉验收（About 版式 / 题词块、空状态无题词的间距）留
owner 真实 app dogfood。DESIGN.md About spec 已同步为版权页构成（原 spec
连 origin story 都未记录，本就落后于实现）。

## Rejected

- **保留「立场」块**——owner 拍板删去（独立产品定位，见上）。
- **版权页引用出处用 "PI §43" 短引**——版权页是全 app 唯一的正式出处
  位，用全称《哲学研究》/ Philosophical Investigations；空状态数据字段
  `source` 不动。
- **复用 `<Epigraph>` 组件渲染版权页题词**——该组件语义是 condition 驱动
  + 居中 + select-none 的屏幕题词；版权页是左对齐静态引文，直接读数据
  内联渲染更诚实，不为复用而扭曲组件契约。
