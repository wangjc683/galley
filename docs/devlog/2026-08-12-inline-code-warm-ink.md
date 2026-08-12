# 行内代码变体裁决：定 C（暖褐 code-ink + 链接让出暖色）

日期：2026-08-12
关联：`MarkdownView.tsx`、`globals.css`（`--color-code-ink`）、
[design/conversation.md](../design/conversation.md)「行内代码的暖色预算」

## 背景

JC 拿 [egoist/waku](https://github.com/egoist/waku)（Rust + GPUI 的本地
coding agent 桌面端，GPL-3.0）的截图来对照 Galley 的主对话区 markdown。

waku 是原生应用、自己手写 markdown 渲染器（`src/md/`），**没有 CSS 可搬**，
纯视觉层 Galley 反而更细（三档字号 token、CJK 平滑、`hanging-punctuation`、
`remark-cjk-strong`，waku 都没有）。它领先的是流式稳定性工程，不是样式。

但截图里一件事确实值得抄：版本号 / 文件名 / 路径全部带底色 + **暖色文字**。
查源码确认那不是什么实体识别，就是**行内代码**——模型自己写的反引号，
只是 waku 的样式做得够重。

关键差异不在底色（两边都是极淡的中性洗色，量级相当），在**用哪个维度区分**：

| | waku | Galley（改前） |
|---|---|---|
| 文字色 | `#9A5528` 暖赤褐（accent 同族） | `ink-soft` `#57534C` 灰褐 |
| 字号 | 与正文同大 | 0.86em |

waku 换**色相**（亮度对比反而更低：白底约 5.6:1 vs 正文 15.7:1），
Galley 降**明度**。潜意识解读相反：换色相 = 「另一类对象」，
降明度 = 「这个不太重要」。

而 coding agent 回答里的行内代码几乎全是路径 / 文件名 / 版本号 / 命令 ——
读者最需要认清、最需要复制的内容。给它降级是错的方向。

## 三变体实测

按惯例做临时切换器（常驻可点 pill + localStorage 记忆）进 tauri dev 实测。
四档，A/B/C 都带 `box-decoration-clone` 与 0.92em（这两条不在争议范围，
跟车是为了让每档呈现完整目标状态）：

- **OFF**：改前状态
- **A** 保守：只去掉降级（`ink` + 0.92em），链接不动
- **B** 重分配·低彩度：`#8C6A4E` 暖褐低彩，链接转正文色 + 灰下划线
- **C** 重分配·waku 彩度：`#9A5528` / 深色 `#E0A882`，链接同 B

真实高密度回答（一行七个文件名那种）中英文各测。

## 裁决

JC 实测后定 **C**——「色彩其实和 Galley 也比较搭」。

Galley 品牌是杏沙（`brand-strong #C68762`），waku 是赤陶（`#C85F44`），
本来就同族；`#9A5528` 落在杏沙加深加饱和的位置，不是外来色。深色下
waku 的 `#E0A882` 几乎等于 Galley 的 `brand-strong #E2AE8D`。

## 理由

1. **收益随密度放大**。单个 `0.0.3` 加不加暖色差别不大；一行七个文件名时，
   暖色让它变成可扫描清单，`ink-soft` + 0.86em 会糊成一片灰。而高密度
   正是 coding agent 回答的常态，不是边界情况。
2. **暖色预算是零和的**。同一段里两种暖色，读者分不清哪个能点。链接让位
   （`text-ink` + `ink-muted` 下划线，hover 才转 `brand-strong`）：下划线
   本来就是承载可点性的 affordance，颜色对它是冗余的。频率决定分配 ——
   agent 回答里路径多、外链少。这是 C 相对 A 的真实代价，实测确认可接受。
3. **B 输在没必要克制**。Galley 正文是衬线（waku 是系统 sans），mono 行内
   代码的字形对比本来就更强，低彩度反而两头不靠：既没拿到扫描性，也没
   省下多少侵入感。
4. **`box-decoration-clone` 是纯 bug fix**。waku 逐视觉行画矩形，长路径
   软换行时续行底色完整；CSS 里不加 clone 会丢掉横向 padding 和圆角。
   Galley 在 `CommandPalette` / `MessageUser` 早就用了这个属性，markdown
   行内代码是漏网的。

## 落地

- 新 token `--color-code-ink`（浅 `#9A5528` / 深 `#E0A882`），
  挨着 `--color-code-surface` 定义
- `MarkdownView.tsx` `PROSE_BASE`：行内代码 `text-ink-soft` → `text-code-ink`，
  `0.86em` → `0.92em`，加 `box-decoration-clone`；链接 `brand-strong` →
  `ink` + `decoration-ink-muted`，hover 转 `brand-strong`
- 切换器 pill、`components/dev/`、`globals.css` 的 TEMPORARY 段、
  `data-md-prose` 钩子全部拆除
- 设计文档同步：conversation.md markdown 表 + 新增「行内代码的暖色预算」，
  foundations.md 色板表

`thinking` variant 与 `agent` 共用 `PROSE_BASE`，所以思考摘要里的行内代码
也走暖色 —— 会比周围的 muted 斜体更跳。本次未处理（JC 实测含思考块，未提出
问题）；若日后觉得吵，正确修法是在 `PROSE_THINKING` 里单独压一档，
而不是回退整体方案。

## 未采纳 / 待议（同轮 waku 对照的产物）

- **流式悬挂标记补全**（waku `src/md/mend.rs`）：`**加粗` 闭合符未到时
  按字面渲染，闭合瞬间星号消失 + 变粗 → 宽度突变 → 段落尾部抖动。waku 只给
  *显示用*解析树追加合成闭合符。Galley 无等价机制（`MainView.tsx` →
  `useMarkdownStream` → `MarkdownView`）。**推荐做，但需先实机确认抖动。**
- ~~**间距节奏派生自单一数字**~~ → **已做**，见
  [markdown 纵向节奏](./2026-08-12-markdown-vertical-rhythm.md)。核实后发现
  这不只是整洁问题：间距不随字号档位缩放，调大字号时文档反而变挤。
- ~~**任务列表 checkbox**~~ → **已做**。实测确认比预想更糟：`ul` 拿到
  `contains-task-list`、`li` 拿到 `task-list-item`，而 `[&_ul]:list-disc`
  照样生效，所以渲染出来是 `• ☐ 已完成`——**圆点和系统原生方框两个标记并排**。
  修法：`li.task-list-item` 去掉 marker（只作用在任务项，混合列表里的普通项
  保留圆点），checkbox 走 `COMPONENTS.input` 覆写重画成 `ui/checkbox.tsx`
  的视觉语言（0.92em `em` 尺寸随档位缩放，选中填 brand + Check 图标），
  用 `role="checkbox"` + `aria-checked` 补回换掉 `<input>` 丢失的语义。
- **增量解析**（waku `parser.rs` stable boundary）：Galley 是 20Hz 全文
  重解析，长回答 O(n²)。**先测再修**，节流已经压过一轮，收益不明。
- **不要抄的**：waku 的字号/字重阶梯（h1 1.45×/BOLD，系统 sans 应用的做法，
  与 Galley 衬线文档体的定位冲突）、两档 metrics（Galley 三档更细）、
  `selection.rs`（原生应用手写跨块选区，Web 白送）。

> 授权提醒：waku 是 GPL-3.0-only，Galley 是 MIT。**思路可借鉴，代码一行
> 不能抄**。本轮落地全部是 TS/CSS 独立实现。
