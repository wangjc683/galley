# Settings 侧栏中文改为主标签

> 2026-09-16 · 社区反馈：小屏幕下中文太小太淡看不清，又看不懂英文

## 问题

中文 UI 的 Settings 左侧 tab 是「英文主标签 + 中文辅助标签」两层，
`copy-language-guidelines.md` 与设计文档 §9 明文规定「中文辅助标签只做注释
……即使 active 也不要抬到主标签权重」，目的写的是「让完全不懂英文的中文
用户能快速理解每个入口」。

对表 `SettingsSidebar.tsx` 的实际规格：

| 层 | 字号 | 颜色 | 浅色对比度 | 深色对比度 |
|---|---|---|---|---|
| 英文主标签 | 14px medium | ink-soft | 7.3:1 | 9.7:1 |
| 中文辅助（非选中） | 10.5px | ink-muted 75% | **2.5:1** | 3.5:1 |
| 中文辅助（选中） | 10.5px | ink-muted | 3.6:1 | 5.2:1 |

WCAG AA 小字门槛 4.5:1，浅色模式每个 tab 的中文都不过线。字号 token 也
用偏了：`text-ui-micro`（10.5px）在 `foundations.md` 的职责是拉丁大写
chip / badge / 等宽时间戳，这里是全应用唯一用它排汉字的地方；汉字笔画
密度高，Windows 雅黑 + 低 DPI 13 寸屏 100% 缩放下会丢笔画——「小屏幕」
的真实含义是物理像素少，不是窗口小。

根本问题是层级倒置：对不懂英文的用户，注释就是他唯一能读的东西，而它
被有意压成最弱的一层。指南的前提被反馈证伪。

另一个约束：英文 tab 名是全局标识符——页头 `SettingsPanelHeader` 的
title 直接用英文 label，中文文案里 33 处引用英文 tab 名（「打开 Models」
「Settings → Runtime」「重启 Channels」）。彻底去英文的改动面远大于侧栏。

## 方案与裁决

- **A · 层级不动，抬辅助标签**：10.5 → 12px、ink-muted 75% → ink-soft。
  修症状，14px 英文仍是主信息，不懂英文的用户要跳过大的读小的。
- **B · 主次翻转**：中文 14px medium ink-soft 做主标签，英文 11.5px
  ink-muted 做术语锚点。`Settings → Runtime` 这类引用仍能在侧栏找到对应词。
- **C · 中文单标签**：去掉英文。33 处文案、页头、SOP 与社区讨论的术语
  锚点一起失效，没人提这个需求。

**JC 裁决**：B；只动侧栏，页头 title 不翻（18px + 中文副标题兜底，未进
反馈）；英文副标签用 ink-muted（3.6:1，与全应用 meta hint 同档，副标签
就该退后）；不做变体实测，直接落。

## 落地

- `SettingsSidebar.tsx`：`labelsFor()` 在中文 UI 下把 `helper` 交给主标签、
  `label` 交给副标签，英文 UI 只给主标签。副标签 `text-ui-tertiary`
  11.5px normal ink-muted，active 不变色；行高 50px 不动。
- 指南「中文版 Settings Tab」一节与设计文档 §9 重写前提与数值，并加一条
  「汉字不用 `text-ui-micro`」。
- copy 键不动：`tabs.*.label` 仍是英文（页头与文案引用不受影响），
  `tabs.*.helper` 仍是中文，只是侧栏读法翻了。

## Rejected

- A：见上。
- C：见上。
- 页头同步翻转：留作独立裁决，本轮不做；若后续反馈页头也难读再议。
