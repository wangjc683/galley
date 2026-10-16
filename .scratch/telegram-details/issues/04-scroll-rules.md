# 04 平滑滚动：远跳先瞬移、认「减少动态效果」；顺带四处小出入

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 5（2026-10-16，JC：「5，做」）。只改 GUI 与文档，不碰 Rust。两边都上。
独立子代理做，与 01–03、05 并行。

## 目标

对话里的程序化平滑滚动统一走一个我们自己的滚动函数：时长与曲线由我们定，远距离跳转不再「刷」过去，系统开了「减少动态效果」时一律瞬时。

## 依据

- Telegram Web A `src/util/animateScroll.ts:164-168,241-272`：
  - 时长 = 300ms + 距离 / 800px × 300ms，封顶 600ms。
  - 距离 ≤ 300px 用 `1 - (1 - t)^3.5`，更远用 `1 - (1 - t)^6`。
  - 距离超过 800px 时，先瞬移到离目标 800px 处，只动画最后 800px。
- 我们的规范 `docs/design/foundations.md:609`：「`prefers-reduced-motion` 下 A/B 动效一律退化为静止或瞬时」。今天对话里四处 smooth 写死，不认这个设置：`useStickyScroll.ts:216`（回到底部）、`:258`（回到底部追移动靶）、`:449`（工作台发送后贴顶）、`:510`（⌥↑ / ⌥↓）。
- Web K 的分档语义（`src/scss/mixins/_animationLevel.scss:5-20`）：开了减少动态，只保留淡入淡出、颜色与原地缩放，「没有东西在屏幕上移动」。

## 要做

1. 新建一个滚动函数（如 `gui/src/lib/animate-scroll.ts`，名字你定）：按上面的时长、曲线、远跳规则把一个滚动容器滚到目标 `scrollTop`。
   - 用户中途滚轮、触控板、按键滚动 → 立刻放手（不和人抢）。
   - 同一容器上新的滚动请求取消旧的。
   - 能在动画中途改目标（回到底部「追移动靶」要用：流式增长时底部在动）。
   - `prefers-reduced-motion: reduce` 时直接写 `scrollTop`。用 `matchMedia` 实时读，不缓存到启动时。
   - 数值与出处写进文件头注释（只写思路与数值，不抄 GPL 代码）。
2. 把上面四处换成它。回到底部的监视器（`onClickScrollToBottom`）今天的三条语义保持：底部长高时改瞄准、用户中途往上拉就放手且不挂上跟随、1600ms 超时直接到底并挂上跟随。
3. grep 整个 `gui/src` 里对话区的其他 `behavior: "smooth"` / `scrollIntoView` / `scrollTo`（问题轨点击、⌘F 定位等），确认各自是否该走新函数；设置页、侧栏、提示词管理里的列表内滚不在本票范围，列出来即可。
4. 顺带四处小出入：
   - 回到底部按钮在中文界面的 aria-label 是英文 `Scroll to latest`（`gui/src/i18n/locales/zh.ts:1740` 附近）：改成中文（如「回到最新」，对照英文语义与界面里已有的叫法）。
   - `docs/design/conversation.md:541` 说回到底部是「ghost 按钮」，代码是带边框、半透明底、模糊加阴影的浮起按钮（`MainView.tsx:691-732`）：文档改成代码现状。
   - `docs/design/conversation.md:557-563` 对在跑计时的描述（「3 秒才显示计时、60 秒后显示仍在运行、三点」）与代码不符：按 `Conversation.tsx:1573-1695`、`AssistantParts.tsx:72-103` 的现状改写。
   - `docs/devlog/deferred.md`「轮间距层级」节的「现状」数值过时：按工作台票 01 之后的实际间距重量（上一回答 → 下一条你的消息、你的消息 → 折叠头），改写现状，结论（是否仍倒挂）照实写。
5. 文档：`docs/design/conversation.md`「Scroll behaviour」写清滚动函数的规则与数值；`foundations.md` 动效一节如果还没有 Web K 那句「开了减少动态，只淡不移」的语义，补上。

## 验收

- 单测：时长与曲线（短、中、远跳）、减少动态时瞬时、用户滚轮打断、中途改目标。
- 已有的 `useStickyScroll` / 定位相关测试全过；`TZ=UTC` 与本机时区各跑一遍全量 gui 测试。
- 真机（JC）：长工作台会话里 ⌥↑ 连跳、点回到底部（在跑与不在跑各一次）、系统设置里打开「减少动态效果」后同样操作都是瞬时。

## Comments
