# Windows 图标 / 文字发虚：Phosphor thin 半像素与字体栈

日期：2026-09-16
关联：`globals.css`（`@media (max-resolution: 1.5dppx)` 块、`--font-sans`）、
[foundations.md §2.3](../design/foundations.md)、polish-checklist P10、
[deferred](./deferred.md)「Windows 低 DPR 下 chrome 文字字重 / 字号变体」

## 起因

Windows 社区截图：Galley 侧栏与 topbar 的图标和文字比旁边软件发虚；JC 在
macOS 上看不到。

## 归因

- **图标**：核 Phosphor 路径数据，thin 是 256 网格上 8 单位 = 16px 时
  0.5 CSS px（regular 1px、bold 1.5px）。Retina 2x 上正好 1 物理像素；
  Windows 100% / 125% / 150% 上 0.5–0.75 物理像素，抗锯齿糊成灰线。截图里
  「新对话」的 bold 加号明显比三个 thin 图标实，是现成对照组。foundations
  §2.3 原写「stroke 1.25px」是笔误，已更正。
- **文字**：chrome 13px / 400 的雅黑在 Windows 灰度抗锯齿下笔画细边缘发灰；
  `-webkit-font-smoothing` 只对 macOS 生效，现有「苹方 auto 补偿」在 Windows
  不存在。`--font-sans` 没显式列雅黑，靠 Chromium 默认回退碰巧正确。
- **排除**：无 zoom / transform 缩放整层、无透明窗口、Tauri 默认 DPI-aware，
  截图无整窗位图放大痕迹。

## 定案（JC：先只做 1 和 2）

1. `@media (max-resolution: 1.5dppx)` 下给 `svg[viewBox="0 0 256 256"] path`
   加 8 单位 `stroke: currentColor` + round join：thin 升到 regular 粗细，随
   size 等比；bold / fill 同增 0.5px（Phosphor 不输出 weight 属性，且 1x 屏上
   更重的 bold 不是缺陷）。**按 dppx 不按平台**：成因是物理像素，Mac 外接
   非 Retina 屏同病，Windows 200% 无病。按 viewBox 圈定，IM Glyphs（24
   viewBox、stroke 制）不受影响。不改「Phosphor Thin 唯一」契约，只承认
   thin 的前提是 2x 屏。
2. `--font-sans` 显式加 Microsoft YaHei，与 serif 栈对齐。

暂缓：Windows chrome 字重 / 字号变体实测，进 deferred。

## 验证

lint、Vite 构建通过；产物 CSS 里确认媒体查询与字体栈。本机 Retina 看不到
效果，待 JC 在 Windows 真机 100% / 125% 验收。
