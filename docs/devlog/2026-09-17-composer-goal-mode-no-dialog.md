# Composer Goal 模式去确认框：armed 即穿委派正装，Enter 直接启动

日期：2026-09-17
关联：[goal-simplify 票 09](../../.scratch/goal-simplify/issues/09-composer-goal-mode-no-dialog.md)、
[conversation.md §4.4 Goal 模式](../design/conversation.md)、
前史：[goal v2 Codex 形态](./2026-09-16-goal-v2-codex-shape.md)、
[solo 打磨轮二](./2026-07-09-goal-solo-dogfood-round-two.md)（当时否决过「取消 armed」）

## 起因

JC 在 v2 合入次日提出：打完目标要点三次才能启动——Target 进 armed、Enter
弹确认框（tooltip 还叫「预览 Goal」）、框里再点「启动 Goal」。排查发现确认框
是 v1 遗产：当年一启动就是 3 worker session，值得拦一下；v2 单线程、在当前
对话里跑、顶栏一键停，误启动的代价只剩「点一下停止」。框里真正有用的只剩
时间上限和一段新用户说明。

## 讨论轨迹

- 先给两档：**A** 混合入口（有草稿点 Target 直接弹框，空草稿才 armed，三步变
  两步、保住 07-09 那条「placeholder 引导」的否决理由）；**B** 拆框，上限做
  成 armed 态的内联 pill，Enter 直接启动。推荐先 A 再看；JC 直接选 B。
- B 的细节五问：pill 只在 armed 出现（是）；上限不记忆；说明文案进 popover
  头行；砍自定义分钟框；不加任何确认——但 JC 要求 armed 态「一眼扫过就知道
  在 Goal 模式」。
- 「一眼可辨」的答案不是加色条，而是**复用已有词汇**：conversation.md 早已
  定下「普通消息=高亮笔触，Goal 委派=加冠正装（4px 竖条 + brand-tint 色板 +
  eyebrow）」。让 Composer 在 armed 那一刻就穿上这身，用户看到的输入框就是
  发出去之后那条委派标记——所见即所发，正装同时接管了确认框「目标回显」的
  职责。上限 pill 随之从「左边挨模型 pill」改到 eyebrow 右侧，位置与标记的
  eyebrow 参数位一致。
- 几何稳定核对：eyebrow 让 Composer 长高约 20px；会话内贴底往上长，右下的
  × / ◎ 不动（07-09 原则守住）；空状态居中会各挪 10px，JC 裁「重新居中」。

## 落地

`useComposerGoal` 状态机收成 armed → 启动；`GoalConfirmDialog` 删除；新
`ComposerGoalEyebrow`（eyebrow + 上限 popover）；`ComposerGoalControls` 只剩
切换钮，「Goal 模式」文字提示与其 max-width 动画退役；`lib/goals.ts` 的
`GoalBudgetPreset` 去 `custom`；footer hint「Enter 启动 Goal · Esc 取消」，
kbd 渲染器认识 `Esc`，启动中显示「启动中…」。Core / CLI 契约不动。

## 被否 / 未选

- 方案 A：少一步但框仍在。
- 启动后 toast 带「停止」作兜底：与「不加任何确认」相悖，顶栏停止已够。
- 保留 armed 但 Enter 直接启动、上限留在框里：把风险留给最易误触的键。
- 09-16 §6 裁决 2 的自定义分钟框：五档对数预设 + 无上限已覆盖，popover 里
  再塞输入框太挤。

## 真机回合（同日）

- 左侧 4px 条与圆角接缝：JC 未提，接受。
- **色板深了一丢丢**：做了三档临时切换器（tint / 70% tint 混 elevated /
  brand-soft，左下 pill 轮换、localStorage），JC 裁 **mix**；armed × 钮随之
  改 elevated 底（brand-soft 圆底在浅档上沉底），上限 pill hover 同理。
  切换器已拆。
- **说明文案**：先嫌繁琐求缩，再发现 popover 为放它而撑宽；JC 提议精简后
  搬进 placeholder。否掉——placeholder 是 affordance（07-04 austerity 先例）、
  首字符即消失、长灰字像预填。改为按相关性拆：上限语义留 popover 缩成一行
  「到上限前 Galley 会一直自己推进。」，popover 收成 LLMPill 规格；「随时可
  引导或停止」删，运行态自己教。placeholder 不动。
- **仍嫌宽**：一句 16 字在 10.5px 下要 180px，min-w 200 就是它撑的。再拆：
  说明句搬进 pill 的 tooltip（点前必经悬停），popover 去 min-w 按内容收成
  约 130px 的纯菜单。教训：popover 里不放句子，句子决定宽度。
