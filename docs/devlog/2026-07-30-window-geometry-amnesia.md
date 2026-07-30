# 窗口几何：从"启动失忆"到"持久化 + 一键恢复默认布局"（同日三次决策）

- **Date**: 2026-07-30（上午定失忆并实施；同日 JC 复议，反转为持久化 + 恢复命令；发版讨论中第三裁：分隔条双击升级为完整恢复）
- **Status**: 已实施（最终形态：持久化 + Reset to Default Layout，三入口全部完整恢复）
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
  3. **分隔条双击** = 完整恢复（同日第三裁，v0.4.1 发版讨论中升级）。
     初版为仅恢复分栏 20/80（表格列边 / IDE 分隔条惯例）；JC 以可发现性
     裁决升级——三入口中只有分隔条是可见面，菜单与命令面板都藏得深，
     唯一可发现的手势应承载完整命令。agent 反对意见留档：双击分隔条的
     惯例语义是局部的（只重置该分隔条）；最大化用户双击修分栏会连带
     退最大化 + 跳黄金尺寸，属"碰小东西炸整个窗口"的惊吓；且升级隐藏
     手势的爆炸半径并不提升可发现性。agent 的替代提案（分隔条右键菜单
     两条目）一并被否。JC 裁决维持：升级双击。配套 JC 提议、agent 支持的
     **分隔条 hover tooltip**（「双击恢复默认布局」）：hover 分隔条的人
     正在关心布局，提示时机精准；且升级后双击会动整个窗口，tooltip 兼作
     预告，抵消惊吓。实现细节：Radix `asChild` 的 ref 会被
     react-resizable-panels `Separator` 自身的 ref 覆盖，故 trigger 是
     分隔条内部的全尺寸 div；`alignOffset` 让气泡锚在指针进入的纵向
     位置而非整条线中点；Radix pointerdown 自动收起，不干扰拖动。
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
