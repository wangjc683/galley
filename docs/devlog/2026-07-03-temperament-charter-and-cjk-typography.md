# 2026-07-03 · 气质总纲（文库定位）+ 中文微排印 pass

> 承接 2026-06-03 哲学气质定位 session 的第二步。Owner 反馈：题词 +
> austerity 文案落地后，liberal art 气质仍「不够」，且引文路线偏直白。
> 本 session 的诊断与推进：气质此前只住在语言层（文案 + 题词），排印 /
> 节奏等感官层还是工具软件默认方言——一行 serif 题词放在标准质感的壳里
> 读作「例外」，例外感即装饰感。产物：(1) 气质总纲 `docs/temperament.md`；
> (2) 排印规范 `docs/typography-principles.md`（三规范第三条腿）；
> (3) 中文微排印代码 pass（text-autospace + hanging-punctuation）。

## 定位决策：Galley 是文库，不是作者

Agent 应用的结构性事实：用户读到的 95% 文字是模型写的，壳控制不了。
气质定位在「作者」走不通；出版社（岩波文库 / 企鹅经典）不控制作者文风
而气质成立——气质住在版式、编辑标准、选目的拒绝里。galley 在印刷史上
本就是**校样盘**（galley proof），这个双关被正式认领为定位：

**Galley 是一个把每场对话都当作值得好好排印的文本来对待的应用。**

配套元规则：哲学以清晰的面目出现、绝不以深刻的面目出现——气质被用户
指认出来的那一刻就打折；清楚 > 简洁 > 气质的红线继承自 copy-austerity。

## 文档结构：总纲 + 三条腿

- `docs/temperament.md`（新）：定位、元规则、四个承重面（语言 / 排印 /
  节奏 / 拒绝）、气质级拒绝清单 + 准入标准、翻案流程（先改文档再改实现）。
- `docs/typography-principles.md`（新）：怎么排。红线 =**排印只作用于
  渲染，绝不改写内容**（复制逐字一致；markdown 修复插件只还原模型明确
  意图；不引入 pangu.js 类 DOM 插空格方案）。
- 既有 copy-austerity（怎么说）/ copy-language（说什么词）收编为总纲的
  「语言」承重面，交叉链接已补。docs/README.md 索引已更新。

## 中文微排印 pass（小设计验证气质，感官层第一刀）

调研结论（2026-07 引擎现状，caniuse / MDN / WebKit blog 核实）：

- `text-autospace`（中西文自动间距，「盘古之白」）：Chromium 140+ 初始值
  即 `normal`——**Windows 用户已默认拿到，Mac WKWebView（Safari 18.4+）
  初始值是 `no-autospace`，不声明就没有**。显式声明 = 两平台一致 + 旧
  引擎优雅降级（符合 Mac-backward-compat 约束）。
- `text-spacing-trim`（全角标点挤压）：Chromium-only、experimental、依赖
  字体 halt/chws。决定不显式设置，引擎默认即立场，写进规范待 WebKit 落地再评。

改动（全部静态检查过：`pnpm --dir gui typecheck` + `lint` + `git diff
--check` exit 0；视觉验收留 owner 真实 app dogfood）：

- `gui/src/styles/globals.css`：body 显式 `text-autospace: normal`；
  `pre/code/kbd/samp` 豁免为 `no-autospace`（代码逐字呈现红线）。
- `gui/src/components/conversation/MarkdownView.tsx`：`PROSE_BASE` 加
  `[hanging-punctuation:allow-end]`（行尾全角句读悬入右边距，WebKit-only
  渐进增强，只进阅读 prose 不进 chrome）。
- 行长决策记录：compact 760px ≈ 48 字/行，停在中文书籍理想值（35–45）
  上缘是有意取舍（对话混代码 / 表格 / 英文长词，过窄更碎），不改。

## Rejected / Deferred

- **Rejected：继续加题词条件（§133 / §66 候选）**。判断：引文的边际收益
  已为负——气质缺口在感官层不在引文密度；等壳的其余部分说上同一种语言，
  引文自然退为可有可无（那才是题词的最好状态）。前次 devlog 的 Deferred
  候选就此叫停，数据结构保留不动。
- **Rejected：`text-align: justify` 中文两端对齐**——中西混排 + 代码 +
  链接下词间距不可控，破坏安静。
- **Rejected：pangu.js 类 JS 插空格方案**——污染复制文本，违反渲染红线。
- **Deferred：版权页（colophon）**。About 页做成文库本版权页（字体名、
  设计原则、一句题词、版本号），给「想直白」的冲动一个本来就该在的家；
  连带评估空状态题词的出现频率（每次进空状态都出现会墙纸化，题词的
  力量来自稀缺）。单独 session 做。
- **Deferred：等待体验的「节奏」承重面盘点**——现有基线不低（思考中 +
  秒数、3 秒后才读秒），是否还有假装快 / 催促语义的残留，dogfood 后再扫。

## 附：气质级拒绝清单完整台账（收编自 114 篇 devlog + DESIGN.md + copy 双规范）

temperament.md 的拒绝清单是按「态度」分组的策展版；以下为带出处的完整
harvest（本次全量扫描的原始成果，供翻案时查证）。

### 视觉 / 动效

- 不用 emoji 做状态指示（`DESIGN.md` §2.3、devlog 2026-05-07）；project row 同。
- 状态 callout 不用 background tint，用左竖条 + 细边框（`DESIGN.md` §4.4、devlog 2026-05-07）。
- 动效不用 bounce / elastic；禁止无限闪烁 / shimmer / 大面积呼吸；不做全屏 color transition（`DESIGN.md` §2.5 / §2.7）。
- 不做每秒 ticker / live 倒计时进正文——live 归外围 chrome（`DESIGN.md` §4.3）。
- headline / TurnMarker 不用 uppercase / italic / serif（`DESIGN.md` §2.2 / §4.3）。
- 产品名 sentence case，不做全大写 wordmark（`DESIGN.md` §4.2）。
- 主文本 / 背景不用纯白纯黑（暖白 / 暖炭，`DESIGN.md` §2.1）。
- 品牌杏沙不做主 CTA 填充（对比度不够 AA，devlog 2026-05-07）；warning 琥珀只表警示不作功能身份色（`DESIGN.md` §2.1）。
- Dark theme 是夜间版不是另一个产品方向（`DESIGN.md` §2.1）。

### 文案 / 语言

- 不用 `!`；不用最高级 / marketing 词；不寒暄不说教不道歉腔不修辞反问（copy-austerity §3 / §4）。
- 不表演不文艺不端着——气质从删字来（copy-austerity 北极星）。
- 绝不在功能文案 / 按钮贴哲学；引文只住题词位（copy-austerity 红线）。
- 功能不命名成行话（否决 "Language Game"）；placeholder 不塞语录（devlog 2026-06-03）。
- 双层 tab 不写 `Runtime / 运行环境` 斜杠体；不做 source string + 机械翻译；语言判断不看 IP / 地区 / 时区（copy-language）。
- `Agent` 不翻「代理」、不大面积改「智能体」；中文用户文案统一「对话」不用 session；按钮动词与操作后状态同一套词（copy-language / copy-austerity 既定约定）。

### 交互

- 不 toast 不开新窗口不弹层抢焦点——单容器更新（`DESIGN.md` §1.1）。
- Settings 无保存按钮，改动即时生效（devlog 2026-05-08）。
- Sidebar 不可折叠、不放 toggle；不放 Command Palette 按钮；不加 `⌘P` 别名（`DESIGN.md` §4.1 / §4.2）。
- 空状态不放 quick prompt / 快捷键 hint / 欢迎长文（`DESIGN.md` §4.6、devlog 2026-06-03 删空状态 prompt）。
- 用户消息不用气泡不 right-align——文档区不是 IM（`DESIGN.md` §4.3）。
- 普通 timeline 不做状态队列不重排（`DESIGN.md` §4.2）。
- Supervisor 徽标是 provenance 不是状态，不参与排序（`DESIGN.md` §4.2）。
- Browser Control 未连接不允许 dismiss，但也禁止闪烁 / 红色警报 / 反复弹窗（`DESIGN.md` §4.1）。
- pointer-first：点击不落焦点不留蓝 outline（devlog 2026-06-29）。
- Retry 无隐藏副作用——点击 = 新 user_message（devlog 2026-05-08）。

### 架构边界

- 不修改用户的 GenericAgent；删除 Galley 后 GA 独立运行（AGENTS.md Rule 1）。
- localhost only，不开 TCP 不持有远程凭证（AGENTS.md Rule 2）。
- no telemetry（PRD 显式条款，devlog 2026-05-15）。
- 不存 supervisor↔human 对话（AGENTS.md Rule 4）。
- Project 是纯归类抽屉，不绑 instructions / system prompt / RAG / 默认模型（devlog 2026-05-13 / 2026-05-09）。
- 不给 GA 加 MCP client；Goal controller 不写 GA 任何状态（devlog 2026-05-15 / 2026-06-04）。
- GUI 未运行时 CLI 不直读 SQLite（devlog 2026-05-15）。
- onboarding / Health Check 不发真实 LLM 请求烧 quota（devlog 2026-05-08）。
- file_write 不做内容预览（复刻 GA 逻辑违反非侵入，devlog 2026-05-08）。

### 产品形态

- 不是 IDE / IM / dashboard / 驾驶舱（`DESIGN.md` §1）。
- 是 orchestrator 不是 chat platform（devlog 2026-05-15）。
- 拒绝「哲学模式」沙龙引擎（devlog 2026-06-03）。
- 命名不用 "CEO mode" / "remote control"（雇佣 / 阶层暗示，devlog 2026-05-15）。
- 桌面客户端不暴露网页线索（`DESIGN.md` §2.6）。

（扫描说明：未发现成文的「拒绝 gamification」条款——现有 badge 均为
状态 / 来源标识，本次未杜撰收入；如需成文另行拍板。）
