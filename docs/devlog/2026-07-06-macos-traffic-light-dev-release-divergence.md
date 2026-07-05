# macOS 红绿灯：dev 与打包版的错位，和「接受默认灯」的收场

日期：2026-07-06（v0.3.0 发布后发现；两条修复路都被否，最终不改，v0.3.1 放弃）

## 结果

**不改。** 接受 macOS 默认红绿灯的位置——它比 sidebar 的「Galley」字标中线略高。
两条想让它对齐的路都试过、都被否，v0.3.0 的表现（88px 横向净空 + 默认灯）就是
最终形态，v0.3.1 放弃、代码全部回滚到 v0.3.0。

保留这条 devlog 是为了让这次昂贵的探索有据可查：**在「header 保持 44px 舒服高度
+ 内容居中 + 不和 OS 布局较劲」这三个约束下，红绿灯和字标的完美垂直对齐做不到。**
以后别再从头钻一遍。

## 怎么发现的

v0.3.0 做 sidebar 顶栏优化时，红绿灯偏高、和字标不对齐，我在 dev 里把
`trafficLightPosition.y` 从 16 目测调到 22，JC 在 dev 确认「对齐了」，随版本发布。
**发布后 JC 装打包版发现：红绿灯的大小和位置都和 dev 不一样、且不理想。**

三个廉价测试逐步收窄（JC 在真机 release 版上做）：切主题不跳、resize 不跳、整体
清晰度和 dev 一样但灯明显更小。结论：打包版里那个 inset 是空的——灯停在 macOS
默认位，没有任何东西在应用/重应用它。

## 为什么 dev ≠ 打包版

读 tao 0.35 源码坐实：`trafficLightPosition` config 经 tauri 映射到 tao 的
`with_traffic_light_inset`，实际重定位发生在视图重绘钩子（`view.rs` 的 `draw_rect`
→ `inset_traffic_lights`）。经验事实是这个 inset 在 `tauri dev` 里应用了、在打包
`.app` 里没有。于是位置不同（dev 移到 y:22 / release 默认偏高），尺寸感也不同
（dev 走 inset 会把标题栏容器撑高、那簇灯显得更大更靠下；release 是默认紧凑簇，
tao 代码只改位置不改按钮直径）。tauri 2.11 只有 build 期 config、没有运行时 setter。

## 两条修复路，都被否

**A — Rust 原生 shim（移动灯）。** 用 `objc2-app-kit` 拿 `ns_window()`，照 tao 的
`inset_traffic_lights` 公式重排三个按钮，在 `setup` + `Resized/ScaleFactor/
ThemeChanged/Focused` 后重应用。真机验证：**对齐了、尺寸正常**——但 **resize 时
抖动严重**，拖完才收敛。根因：事件驱动的重应用和 macOS 自己的 resize 布局每帧对抗。
tao 在 dev 里顺滑是因为它 hook 了 `draw_rect`（每帧同步），那条路打包版恰恰不生效；
要复刻得重写 tao 的 view 子类化，更重。**否：为对齐和 OS 窗口按钮较劲，性价比不划算，
抖动就是「太重」的症状。**

**B — 压 header 高度（移动内容去够灯）。** 灯改不动，就把两列 header 从 44px 压到
32px，让 `items-center` 内容落到默认灯中心（~14-16px）。32px 是 MainHeader 里
`h-7` 状态徽章能容下的下限。真机验证：**header 太矮、比例不舒服。否。**

## 决定与被否方案

**采用 C：接受默认灯为「角落里的 OS 家具」，不强求和字标对齐。** 这是 Finder /
Notion / Linear / Things 侧栏的通行做法——灯是系统 chrome，字标是内容，灯略高于字标
中线是 macOS 常态。配合 v0.3.0 已有的 88px 横向净空，读起来可接受。这个落差很小，
不值得用 A/B 那种重手段去消除。

被否总览：

- **在 dev 里继续调 config 的 y 值**：dev 不反映打包版，等于闭眼调。
- **A 原生 shim**：resize 抖动，和 OS 较劲的固有代价。
- **B 压 header**：比例不舒服。
- **D 44px 不变、内容顶对齐**：会内容贴顶下方留白、显头重，没实现（判断同样不会被接受）。

## Durable 教训

1. **`tauri dev` 不是原生窗口 chrome（红绿灯位置/尺寸）的合法验收环境。** 它跑裸
   二进制、打包版跑带 Info.plist 的 `.app`，两者对 `trafficLightPosition` 的实现
   结果不同。任何红绿灯相关改动必须在真 `.app` 上验收——dev 骗了我们一次。
2. **小的外观瑕疵不要用重机制去追。** 移动 OS 窗口按钮、改全局 header 比例，代价都
   远超一个几像素的落差。识别「这是 OS 家具，接受它」比「技术上能修就修」更重要。
3. 排查用户可见问题时，观察要具体到「大小 vs 位置 vs 清晰度」——每一条都在切分假设
   空间（「灯更小」排除了 config-reset，把方向拉向 dev/release 实现路径不同）。
