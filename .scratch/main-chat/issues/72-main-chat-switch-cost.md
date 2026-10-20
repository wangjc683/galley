# 72 切到主对话不卡：去掉主对话挂载后的连锁重渲染与多余的强制布局

Status: ready-for-agent（2026-10-20 派出）

来源：主聊天 PRD 裁决 123（2026-10-20，JC：「多试了几次，感觉从其他对话点击回到主对话时，总会卡顿一下，你排查下原因」；主会话排查后推荐 A 加 B，JC：「按你推荐推进」）。A（卡片先画出按下、再打开主对话）主会话已做；本票是 B。只改 GUI；Core、runner、CLI 不动。

## 为什么

主会话在 dev 窗口里挂了临时探针（自己派发 pointerdown，记录每帧间隔，用 React Profiler 按子树计渲染时间，并统计布局读取的次数、耗时与调用栈）。结果：

- 切到主对话（19 轮）后，主线程连续占住 165–461ms（多数约 200ms）才画出第一帧；切到 28 轮的工作台对话「国庆带娃游重庆」是 107–177ms。主对话更短，却更慢。
- 去掉 StrictMode 后，切到主对话的时间线：
  - 0–66ms：React 渲染。`MainView` 按 `key={activeSessionId}` 整块重新挂载，两种对话都这样。其中 `Conversation` 44–75ms：Galley 回复行合计 46–54ms，用户消息行合计 14–19ms（工作台的用户行合计约 1ms）。
  - 约 70ms：`useStickyScroll` 的 layout effect 调 `assistantFollowBottom`（`gui/src/lib/assistant-conversation.ts`），读滚动尺寸，强制新 DOM 的第一次布局，20–84ms。
  - 110–230ms：2–3 次同步的连锁重渲染（Profiler 的 `nested-update` 与紧跟的 `update`，每次 `Conversation` 重渲约 10–12ms）；其间 `useTypingBubbleHandoff` 的测量（`getBoundingClientRect` / `getComputedStyle`）和 `ResizeObserver` 回调里的 `assistantFollowBottom` 又各强制布局约 10ms。
  - 165–246ms：第一帧。
- 工作台对话只有前两段（`RunFoldHeader` 的 layout effect 也有一次约 17ms 的强制布局），没有第三段。

第三段只有主对话有：贴底（`stickBottom`）与打字气泡交接（`useTypingBubbleHandoff`，`enabled: isMainChat`）这两个钩子都只在主对话里开。

## 要做成什么样

目标：切到主对话时主线程被占用的时间，降到切到同长度工作台对话的水平（dev 下约少 60–80ms）。用户看到的行为、动画与时序不变。

1. **连锁重渲染**：找出主对话的 `MainView` 挂载后，每一次同步重渲染从哪来。候选（未逐一核实）：layout effect 里的 setState；`useStickyScroll` 派发 `scroll` 事件后，滚动监听里的 setState；`ResizeObserver` 首次回调（挂载时必定触发一次）里的 `setAtBottom`；`useEarlierTurns`、`useRemovedTurnsAnchor`；`Conversation` 的 keepOpener；`ExpandSection`。首次渲染就能算对的，就不要在挂载后再改。目标：挂载那次提交之后，不再有 `nested-update`。
2. **多余的强制布局**：
   - 挂载时没有交接可演，`useTypingBubbleHandoff` 就不读布局。
   - 贴底在挂载时的定位只读一次布局；`ResizeObserver` 的首次回调不再重算一遍。
3. **每条消息的操作行**：`MessageMenuButton`（Radix DropdownMenu）和操作行里的 tooltip，没用到时不挂 Root，比如按下、悬停或聚焦时才挂。先量值不值：用户行在主对话里合计 14–19ms，在工作台里约 1ms。

第 2、3 条如果论证下来收益很小，可以不做，回报里写清理由和数字。

## 要守住的

- 主对话不变：贴底与「贴底」排版（`docs/design/conversation.md`「助手的对话」）、长回复的跟随上限（`USER_MSG_ANCHOR_TOP_PX`）、打字气泡到回复的交接动画、落地动画（landing）、「回到底部」按钮、往上翻时加载更早（`useEarlierTurns`）、删除后的锚定（`useRemovedTurnsAnchor`）。
- 工作台对话的行为不变。
- 消息菜单、引用、删除、复制照旧可用；键盘可达（⋯ 按钮能 Tab 聚焦、Enter 打开）。
- 外置运行时零变化：它没有主对话。
- `gui/` 不是 prettier-clean：旧文件只格式化自己改的 hunk。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。
- 中文注释与文档用全角标点。

## 别动

- `MainView` 按 `key={activeSessionId}` 重新挂载的结构。「主对话常驻不卸载」是裁决 123 的 C，暂缓。
- 侧栏与助理卡片（`gui/src/components/layout/sidebar/SidebarAssistant.tsx`），主会话刚改过。
- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。

## 验证

- **回归测试先写**：在 jsdom 里挂载主对话的 `MainView`（或 `Conversation` 加相关钩子，选能复现连锁的最浅接缝），用 `React.Profiler` 数提交，断言挂载那次之后没有同步的 `nested-update`。如果有必须保留的，写明是哪一个、为什么。先看它红，再改，再看它绿。jsdom 没有布局，强制布局那部分靠代码审读和回报里的 `文件:行`。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 真机量由主会话在合入后做（探针补丁在主会话 scratchpad），你不用跑。

## 回报格式

- 每个连锁来源：`文件:行`、为什么会在挂载后改状态、怎么改的。
- 每处去掉的强制布局：`文件:行`。
- 第 3 条做没做；做了的话，前后数字。
- 回归测试由红到绿的输出摘要；各项门禁的结果。
- 分支名与提交号（从命令输出里抄）。
