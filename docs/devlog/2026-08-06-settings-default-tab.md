# Settings 泛用入口默认 tab：从「不确定落点」收口到 General

日期：2026-08-06。JC 观察：打开 Settings「通常」落在 Runtime 而非列表
首项 General。

## 诊断

比「默认 Runtime」更糟：齿轮按钮、命令面板、菜单 `⌘,` 三个泛用入口都
裸调 `setSettingsOpen(true)`，不设 tab——落点取决于残留 state（首次是
`"runtime"` 初始值，之后是上次深链或上次浏览停留的 tab），即**不确定
落点**。「runtime」默认值是历史遗留：早期 Runtime（GA 路径配置）是
设置页核心，General 后来才丰满，默认值没跟着搬家。

## 定案

- 泛用入口一律走 `openSettings()`，确定落 **General**：对应性原则
  （高亮应与 tab 列表首项对齐，落中段多一次「我在哪」的定位负担）；
  频率论证也倒向 General（managed 主路径下 Runtime 是装好不动的一次性
  面板）。
- 深链入口（Models / Browser / IM / Integration / Runtime 健康检查 /
  检查更新→About）显式传参，不变。
- **被否：记住上次访问的 tab**（macOS System Settings 行为）——引入跨
  会话状态、行为不可预测；「回到任务上下文」已被深链覆盖，泛用入口
  要的恰恰是稳定落点。

改动六处：三个默认值（App 初始 state、`openSettings` 默认参、Settings
组件兜底）+ 三个泛用入口收口。
