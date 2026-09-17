# 09: Composer Goal 模式去确认框，armed 即穿委派正装

Status: done
PRD: ../PRD.md（§3.7 Composer Goal 入口；本票修订其中「确认框」一段）
Blocked by: 07

## 问题

v2 合入后启动一个 Goal 要三步：点 Target 进 armed → Enter 弹确认框
（tooltip 还叫「预览 Goal」）→ 框里再点「启动 Goal」。确认框是 v1 时代的
保险（当时一启动就是 3 worker session），v2 单线程、在当前对话跑、一键停，
保险的价值没了，框还在。框里真正有用的只剩时间上限和新用户说明。

## 裁决（2026-09-17，JC）

1. **拆掉确认框**，armed + Enter 直接启动（方案 B；方案 A「有草稿点 Target
   直接弹框」被跳过）。
2. **上限 pill 只在 armed 时出现**，落在 Composer 顶部新增的 eyebrow 行右侧，
   位置对齐委派标记的 eyebrow（撤回「左边挨模型 pill」一稿）。
3. **上限值不记忆**，每次 armed 回到 60。
4. **新用户说明文案**（「Galley 会一轮一轮自己推进…」）放上限 popover 的头一
   行灰字，样式照 LLMPill popover 的头行。
5. **砍掉「自定义」分钟框**（推翻 09-16 §6 裁决 2 的自定义部分；五档预设
   15 / 30 / 60 / 120 / 240 + 无上限保留）。
6. **不加任何确认**，代之以 armed 态 Composer **整框穿委派标记的正装**：
   brand-tint 底 + 4px brand-strong 左条 + eyebrow 行「◎ GOAL … 上限 60 分钟
   ▾」，所见即所发——输入框此刻长得就是发出去之后那条委派标记。
7. 空状态里 Composer 因 eyebrow 行长高时**重新居中**（不固定底边）。

## 范围

- `lib/goals.ts`：`GoalBudgetPreset` 去 `custom`，`resolveGoalBudgetSeconds`
  只剩预设 → 秒 / `none` → null；删 `GOAL_CUSTOM_BUDGET_MIN_MINUTES`。
- `hooks/useComposerGoal.ts`：状态机收成 armed → 启动；确认框三个状态删；
  新增 `goalBudgetPreset`（arm / disarm / 启动后都重置为默认）。
- 新 `ComposerGoalEyebrow.tsx`：eyebrow 行 + 上限 pill popover。
- `ComposerGoalControls.tsx`：只剩 Target / × 切换钮；「Goal 模式」文字提示
  与它的 max-width 动画删。
- `Composer.tsx`：armed 态外框类名；eyebrow 行挂在 textarea 之上；Esc 退出
  armed 不再看确认框；Enter 直接 `launchGoal`。
- 底部提示行：「Enter 启动 Goal · Esc 取消」；启动中显示「启动中…」；
  kbd 渲染器认识 `Esc`。
- 发送钮 tooltip：「启动 Goal · Enter」。
- 删 `GoalConfirmDialog.tsx` 与 goalConfirm* / goalCustom* / goalArmedHint 文案。
- 文档：conversation.md §4.4 加「Goal 模式」段；PRD §3.7 加修订注；devlog。

## 验收（真机）

- 有草稿时点 Target → 整框变色、eyebrow 出现、右下 × / ◎ 位置不动。
- Enter 启动，线程里出现委派标记，其 eyebrow 与刚才 Composer 的 eyebrow 同构。
- 上限 pill：点开见说明头行 + 六项；选「无上限」后 pill 显示「无上限」；
  Esc 退出再进回到 60。
- Esc / × 退出 armed，外框复原；armed 带图片 Enter 仍 toast 拦截。
- 空状态：armed 后 Composer 长高重新居中，启动落地后才翻屏。
- 深色主题下 brand-tint 底上的 placeholder / 正文 / pill hover 可读。
- 左侧 4px 条与 rounded-md 外框的接缝：接受或改 `rounded-l-none`，JC 真机裁。

## Comments

**2026-09-17 落地**：代码按范围全部完成，typecheck / lint / 412 单测绿。
待 JC 真机过「验收」清单，尤其左条与圆角接缝、深色主题 tint 可读性。

**2026-09-17 真机回合**：色板改 70% tint 混 elevated（三档实测裁 mix）；
armed × 钮与上限 pill hover 改 elevated 底；popover 说明缩成一行只讲上限，
「引导或停止」句删，popover 收窄到 LLMPill 规格；placeholder 不动
（JC 提议搬文案进 placeholder，按 07-04 austerity 先例否）。
再一轮：说明句进 pill tooltip，popover 去 min-w 收成纯菜单。
