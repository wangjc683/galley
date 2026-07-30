# 窗口几何不再跨启动记忆——每次启动回到黄金默认

- **Date**: 2026-07-30
- **Status**: 已实施
- **Related**: `core/src/lib.rs` 插件注册块、`core/src/app_setup.rs`
  `fit_window_to_monitor`、`core/tauri.conf.json`（`center: true`）、
  `gui/src/components/layout/AppShell.tsx`

## Context

JC 提出：Galley 每次启动应以"黄金比例"出场——窗口 1480×920 居中、侧边栏
20% 默认分栏——用户可在运行期内任意调整，但真退出后遗忘。此前的行为是
两层持久化：`tauri-plugin-window-state`（尺寸/位置/最大化，存
`.window-state.json`）+ `useDefaultLayout`（分栏比例，存 localStorage），
且均为有意配置（window-state 还刻意排除了 VISIBLE / DECORATIONS 标志）。

## Decisions

- 摘除 `tauri-plugin-window-state`；`useDefaultLayout` 改为静态默认。
  运行期内（含托盘隐藏/唤起）调整保持，真退出即遗忘。
- `tauri.conf.json` 加 `center: true`，每次启动居中。
- 新增 `fit_window_to_monitor`（app_setup.rs）：显示器逻辑尺寸容不下
  1480×920 时缩到屏幕的 92% 并重新居中，在窗口显示前执行不闪帧。
  没有这个钳制，小屏用户会因"无记忆"而每次启动手动缩窗——这是方案
  成立的必要补丁。
- 遗留的 `.window-state.json` 与 localStorage 旧 key 不做清理，自然失效。

## Rejected alternatives

- **保持记忆 + 「恢复默认布局」命令**（agent 两轮建议的方案）：桌面惯例
  是记忆几何（Slack / VS Code / 浏览器均如此），多显示器与半屏用户的
  偏好每次被打回会被感知为 bug；托盘驻留形态下"唤起保持、重启重置"的
  规则对用户不可预测。JC 听取后仍选择每次重置——"工具每次以最佳状态
  出场"的产品性格优先。此先例问题已如实确认：可自由调整但启动失忆的
  主流工作台类应用没有找到直接先例（近似先例是瞬态面板与固定尺寸窗口
  两类）。若未来收到真实用户抱怨，回滚路径即恢复本 entry 摘除的两层。
- **只重置窗口、保留分栏记忆**（或反之）：规则不统一，用户模型更乱。

## Open questions

- 无。用户反馈若出现"每次都要重新摆窗口"类抱怨，参照上文回滚路径。

## Next

- 无后续工作；随下个版本发布观察反馈。
