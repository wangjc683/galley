# 窗口几何：从"启动失忆"到"持久化 + 一键恢复默认布局"（同日两次决策）

- **Date**: 2026-07-30（上午定失忆并实施；同日 JC 复议，反转为持久化 + 恢复命令）
- **Status**: 已实施（最终形态：持久化 + Reset to Default Layout）
- **Related**: `core/src/lib.rs` 插件注册块、`core/src/app_setup.rs`
  （`apply_golden_geometry` / `fit_window_to_monitor` / GOLDEN 常量）、
  `core/src/commands/system.rs` `reset_window_layout`、`core/src/app_menu.rs`
  Window 菜单、`gui/src/lib/layout-reset.ts`、`AppShell.tsx`、
  `CommandPalette.tsx`、`useGlobalShortcuts.ts`

## Context

JC 提出"每次启动以黄金默认出场"（窗口 1480×920 居中、侧边栏 20%）。当时
的行为是两层持久化：`tauri-plugin-window-state`（尺寸/位置/最大化）+
`useDefaultLayout`（分栏比例，localStorage）。agent 两轮反对失忆方案
（桌面惯例、多显示器/最大化用户成本、托盘驻留下规则不可预测、且无
"可调但失忆"的主流工作台先例——近似先例只有瞬态面板与固定尺寸窗口
两类），JC 仍裁决失忆并实施。同日 JC 复议，改选 agent 推荐的
**持久化 + 「恢复默认布局」命令**。

## Decisions（最终形态）

- **持久化恢复原样**：window-state 插件（仍排除 VISIBLE / DECORATIONS）
  与 `useDefaultLayout` 均回归。
- **恢复默认布局的三个入口**，全部收敛到同一实现
  （`lib/layout-reset.ts` + Rust `reset_window_layout`）：
  1. macOS 菜单栏 **Window → Reset to Default Layout**（Zoom 之下——
     Window 菜单是几何动词的规范位置；事件走既有 `menu:<id>` 通路，
     GUI 统一执行）；
  2. **命令面板**「恢复默认布局 / Reset window layout」（兼作 Windows
     的入口——Windows 无菜单栏）；
  3. **分隔条双击** = 仅恢复分栏 20/80（成熟惯例：表格列边、IDE 分隔条；
     零新增 chrome，覆盖最高频的漂移场景）。
- **重置范围边界**：退全屏 → 取消最大化 → 黄金尺寸（按显示器 92% 钳制）
  → 居中 → 分栏 20/80。**不动**会话宽度 compact/wide、字号、主题——
  显式偏好各有其家，防止此命令膨胀成"恢复出厂设置"。
- **保留失忆轮的两个净收益**：`center: true`（首启居中）与
  `fit_window_to_monitor`——后者加了守卫（仅当前尺寸溢出显示器才动），
  既修首启小屏溢出与换显示器场景，又不与恢复的记忆打架。
- 黄金常量单一来源：尺寸在 `app_setup.rs`（须与 tauri.conf.json 一致），
  分栏在 `lib/layout-reset.ts`。

## Rejected alternatives

- **启动失忆**（当日上午方案，几小时后反转）：见 Context 中的反对理由。
  git 中留有完整实现（`c7c994fc`），若哪天想复活可考古。
- **主界面常驻恢复按钮**（JC 提议后被说服放弃）：低频恢复动作 vs 常驻
  版面的错配；Galley 一贯做版面减法（Inspector 之死、侧边栏不可折叠）；
  "恢复布局"无公认图标语言。
- **漂移指示器**（浏览器缩放 pill 模式，仅偏离时出现）：窗口偏离常是
  故意的长期状态（常年最大化），pill 对这些用户变成常驻唠叨。若只看
  分栏触发则与分隔条双击覆盖重叠。记为备选，未采纳。
- **点击侧边栏 Galley wordmark 触发恢复**（JC 提议后被说服放弃）：
  品牌点击惯例是回首页/About；隐藏触发器配"窗口变形"是幽灵效应；
  且与 Windows 自定义 chrome 的"双击 header 最大化"手势直接打架。
- **常驻 placeholder / onboarding 蒙层类教学**：不适用，命令面板与菜单
  即为可发现面。

## Open questions

- 无。

## Next

- 无后续工作。三入口行为一致性并入下次 dogfood 顺手过一遍。
