# Topbar 外观控件语法统一：字号 / 主题 popover + 分段

- **Date**: 2026-07-05
- **Status**: 已落地（commits `bf3d482` / `19abf9f` + 本次收尾 commit）
- **Related**: [layout-and-chrome.md](../design/layout-and-chrome.md) MainHeader 工具簇 + 共通视觉规约（本次新增两条）；`gui/src/components/layout/TopBarIconButton.tsx`（新）；`gui/src/components/ui/segmented-control.tsx`（选中态全局改）

## Context

JC 对 topbar 字号控件的按钮样式和 popover 设计双双不满意。审查发现两处实质问题而非纯审美：触发按钮用自绘 SVG「A」的 glyph 尺寸差（~2px/档）表达当前档位——不可读且切档时图标自己跳动；popover 是自创的「轨道 + 滑动圆形 thumb」控件——不是 slider 不能拖、不是 segmented、不是 menu，需要学习，且 58px 魔法步长与布局耦合。修完字号后 JC 追问相邻主题切换（下拉菜单）要不要统一，之后又对「选中态不可扫读」「误导性 tooltip」「非默认态常驻 brand tint」逐项打磨，最终收敛为一套可复用的外观控件语法。

## Decisions

1. **外观类三选一控件的标准形态**：28px 图标按钮（`TextAa` / 解析后主题图标，固定 16px thin）→ 小 popover → 共享 `SegmentedControl`。字号、主题两个控件已同构；后续新增外观控件沿用，不再发明新样式。
2. **Popover 而非 DropdownMenu，选后不自动关闭**：外观调节即时生效，用户来回切档对比（浅色↔深色、三档字号）是真实使用方式；这是当初字号控件用 Popover 的唯一站得住的理由，这次把它显式化并推广到主题。
3. **`SegmentedControl` 选中态全局强化**：轨道 `bg-surface`→`bg-hover`（surface 与 elevated 在浅色下几乎同白，放进 elevated popover 选中块不可读）；选中段文字 `text-brand-strong` + `font-medium`（颜色通道可扫读，与全 app「选中 = brand」语言一致）；未选中段 hover 改纯文字提亮（轨道自身已是 `bg-hover`）。影响 Settings 浏览器选择、Goal 预设等全部使用点，JC 验收通过。
4. **删段级 tooltip 根治误导弹出**：Radix Popover 打开时 autofocus 落在第一段，其 tooltip（「小字号」）无条件弹出。段标签「小/标准/大」自明，tooltip 本属冗余。
5. **外观偏好不用 brand tint 表达「偏离默认」**：已定型的偏好（就是喜欢深色/大字号/宽版）不是可行动信息，常驻淡橙高亮 = 安静工作台的永久噪音。宽度/字号/主题三个按钮的非默认 tint 全部移除；当前状态由 tooltip + popover 内分段承载，「跟随系统」的解析结果做分段下方 caption。
6. **抽 `TopBarIconButton` 共享组件**：hover/press/popover-open 节奏原先在 4+ 处重复且有微漂移（ink-soft vs ink-muted、有无 hover border、齿轮走 `IconButton` rounded-sm）。统一为 `text-ink-muted` + `hover:border-line` + rounded-md；工具簇四按钮与 Browser Control / Channels 图标态全部收编。
7. **宽度箭头图标 14px 保留**（其余 16px）：JC 确认是刻意视觉补偿——横向箭头光学偏大，缩一档四按钮等重。代码注释 + 设计文档双处落档，防止后人「修复」。
8. 顺手修 locale bug：`zh.ts` `theme.button` 原为英文 "Appearance"，改「外观」。

## Rejected alternatives

- **字号改回标准下拉菜单（与旧主题菜单同构的反向统一）**：丢失「不关闭连续试档」特性；菜单每项按自身字号渲染的预览感也不如对话区实时重排直观。
- **字号 + 宽度合并为一个「阅读显示」面板**：第一性原理上两者同属低频阅读面偏好，合并可省一个 topbar 常驻位；但宽度切换从 1 击变 2 击，JC 选择保持独立。此案留档：若工具簇继续膨胀可重新评估。
- **选中段整块 `bg-brand-soft` 底色**：最醒目，但 Goal 预设那类 4-5 段控件会多一块常驻彩色，噪音偏高；「深轨道 + brand 文字 + 白色浮起块」双通道已足够扫读。
- **仅深轨道（纯中性，macOS 原生风格）**：JC 抱怨的正是扫读性，无颜色通道提升有限。
- **主题分段放不下「当前浅色」副标签所以维持菜单**：伪约束——副标签降级为分段下方 caption（仅选「跟随系统」时出现）即可，信息无损。

## Open questions

- 暗色主题下 `hover(#28231e)` 比 `elevated(#24201b)` 略亮，分段选中块与轨道的明暗关系反转且对比弱，主要靠 brand 文字撑识别。JC 浅色验收通过；dark 若不行，解法是给暗色单独调轨道 token，不回退方案。
- 主题 popover 选中「跟随系统」时 caption 出现/消失引起 popover 高度变化，验收未报问题，观察即可。

## Next

- 无计划内后续。本轮 topbar 打磨双方确认收手；新外观控件出现时按 layout-and-chrome.md 新增规约执行。
