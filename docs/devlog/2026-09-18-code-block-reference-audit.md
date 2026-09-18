# 代码块参考件对表改版：header 行回归、copy 常驻、24 行折叠，双墨主题真机落败

日期：2026-09-18
状态：已落地（GUI only）。`CodeBlock.tsx` 重写：header 行（图标 + 语言名 | 换行切换 + copy）、
copy 常驻纯图标带交叉淡入、换行切换仅溢出时出现、超 24 行折叠且流式不折、8px 圆角 /
hairline / `leading-code` 1.6 / 块间距挂 `--conversation-block-gap`、`md` 别名。
相关：[conversation.md 代码块节](../design/conversation.md)（规范已回写）、
[行内代码暖墨](./2026-08-12-inline-code-warm-ink.md)（暖色预算的来源）、
[对话区审计](./2026-07-05-conversation-area-audit-and-polish.md)（06 月密度 pass 的
header 裁决就在那一线）。

## 起因

JC 开题「优化对话中代码框的用户体验和 UI 设计」，随后贴了一个参考组件：header 行
（文件图标 + 文件名 / 语言名 + 常驻 copy 图标）、白底 hairline 圆角 16 卡片带 shadow-xs、
单色代码、行高 1.8、超 8 行折叠「N more lines」、可选行号。「很喜欢这种简洁的感觉。」

## 先量真实用量（workbench.db，580 条回复）

| 指标 | 数值 |
|---|---|
| 含代码框的回复 / 框数 | 44 条 / 157 个 |
| 单行框 | 73（46%） |
| ≤ 5 行 | 118（75%） |
| 行宽 ≤ 40 字符 | 108（69%） |
| `text` / `bash` / 无标注 | 72 / 41 / 25（88%） |
| 真正的编程语言 | 约 12（8%） |
| 一条回复 ≥ 16 个框 | 3 条（16 / 22 / 26） |

结论：Galley 的「代码框」多数不是代码——模型用围栏装报错行、路径、坐标、单条命令、
箭头流程、短清单。用户消息里没有围栏。这个分布决定了后面每一条判定的权重：
copy 是主要动作、单行框的高度是核心代价、语法高亮只对 8% 的框起作用。

## 现状问题（对表前先自查）

1. 单行框太重：一整个描边盒子 + 上下 12px 外边距装一条路径；22 个单行 bash 堆成一面墙。
2. 右上角浮控件压代码：单行长命令时语言名盖在行尾，hover 后 copy / wrap 盖得更多。
3. copy 只在 hover 出现，对命令 / 路径来说复制是主要动作。
4. 换行默认横向滚动一刀切。
5. `md` 无别名，显示 MD 且不高亮。
6. 超长块无上限（94 行 markdown 占满一屏，但 >20 行的只有 8 个）。
7. 工具输出 / 审批面板各有一套 `<pre>`（bg-app + 细描边 + 写死 12.5px 不跟字号档）。

## 零件对表

| 零件 | 参考件 | 判定 |
|---|---|---|
| header 行 | 文件名 / 语言名 + 常驻 copy | **重审并采纳**：06 月去掉 header 的理由是「语言名被抑制时只剩死白带」；copy 常驻后行永远有内容，前提不成立。主收益是控件离开代码区（解问题 2）。代价：单行框 ≈33px → ≈65px |
| copy 常驻纯图标 28px 命中 | 有 | **采纳**（命中区收到 24px），交叉淡入 blur 是用户触发一次性动效，§2.7 A 类 |
| 白底 + hairline + shadow-xs 浮起卡 | 有 | **规范赢一半**：foundations 明文代码是「小块 inset」，不浮起不加阴影，06 月否过更白的底；但描边 `line-strong → line` hairline 采纳——参考件的轻来自描边淡而非底色白 |
| 圆角 16 | rounded-2xl | **部分采纳** 8（`--radius-callout`），不越过 09-17 刚定的 12px 用户气泡 |
| 行高 1.8 | 有 | **重审**：foundations 给代码块的 token 是 `leading-code` 1.6，CodeBlock 写死 1.45 是 06 月密度 pass 自己越过规范；回到 1.6 |
| 无高亮单色 | 有 | **进切换器**：github 的蓝紫红在纸墨调色板里是外来色，可能是「不简洁」的来源之一；但 bash 占 26%，命令 / 参数分色有用 |
| 超 8 行折叠 | 有 | **否决 8，改 24**：8 行会折掉约 24% 的框，10 行块显示 8 行 + 「2 more lines」很傻；聊天里代码就是答案。24 行约 5%。流式期间不折 |
| 行号变体 | 有 | **维持不做**：聊天没有文件上下文 |
| 换行切换 | 无 | **留但只在溢出时出现**（ResizeObserver），多数框看不到 |
| 代码区 tabIndex 可聚焦 | 有 | 不动：pointer-first，键盘故事待议 |
| max-w 500 | 有 | N/A，块用整列宽 |

参考件的「简洁」拆下来是四样：hairline、header 把控件从代码上拿走、单色、松行高。
前两样不撞规范，第四样是规范本来要的，第三样撞 Shiki 的既有投入——所以只有它上了
切换器。

顺手修的：块外边距从写死 `my-3` 改挂 `--conversation-block-gap × 1.1667`（与表格同档），
是 08-12「阅读面间距不写死」的漏网之鱼；`md → markdown` 别名；标签显示规范语言名。
问题 7（工具面板的 pre）不在本轮，进 deferred。

## 切换器与裁决

临时 dev-only pill（左下角，localStorage），两轴：controls `header / corner`、
highlight `github / two-ink / mono`。其余改动固定不上切换器。双墨主题：关键字用
ink-hover、字符串 / 数字 / 常量用行内代码同款暖褐、注释 ink-muted、其余 ink，
color-only 不破度量恒等。

agent 推荐 header + two-ink；翻车点预告了三条：header 下 `text` 块左侧只剩一个图标可能
仍读作空行、双墨在 bash 上可能与单色几无差别、折叠脚部字号可能与 24 行体量不配。

**JC 真机裁决：header + github。** header 与推荐一致。高亮上双墨输给 github——
纸墨调的两种墨给不出全调色板的结构感，「外来色」的担心不敌可读性的实感。这是本轮
唯一被真机推翻的推荐；切换器已拆、双墨主题文件已删，从未入库——要复活按上一段
记的配色分配重建即可，四个色值直接取 globals.css 的 ink / ink-hover / ink-muted /
code-ink。

## 验证

- 新测试 `CodeBlock.test.tsx`：24 行不折 / 25 行折且脚部计数、流式上下文不折、
  `md` 显示 markdown、`text` 抑制、copy 常驻、SSR 下无溢出则无换行切换。
- `pnpm --dir gui typecheck` / `lint` / `vitest run` 绿，`git diff --check` 干净。
- 真机：JC 用 `s-mqa9n9bk-p4bn` 第 5 条（22 个 bash 单行）看密度、第 7 条
  （python / go / text 混排）看高亮，裁 header + github。
