# 01 让按下与展开的过渡真正动起来：过渡属性表写全 translate / scale / rotate

Status: done（2026-10-20 JC 真机：「真机看过了，按下手感可以」。随后又看了项目组展开的滑入与设置页就地展开的箭头：「侧栏项目组展开时子项的滑入看了没问题」「『点开就地展开』的小箭头看了没问题」。2026-10-20 合入 `e1c44a7e`。21 处原地改：按下统一写 `active:transition-[translate,scale,box-shadow]`，设置页箭头 `transition-[color,rotate]`，项目组子项 `transition-[opacity,translate]`；防回归测试 `gui/src/styles/transition-properties.test.ts` 规定手写属性表不许出现 `transform`，改前红 21 处、改后绿。主会话在主树复跑门禁：typecheck、lint、`git diff --check`、文档链接门禁、`TZ=UTC` 下 185 个文件 1994 条测试全过；构建产物里按下那串是 `transition-property:translate,scale,box-shadow`）

来源：2026-10-20 做主聊天 PRD 裁决 122（助理卡片）时发现，见 [devlog](../../../docs/devlog/2026-10-20-assistant-card-edge-and-switch-hitch.md)「第二轮：选中与按下」。JC：「修，开小票」。只改 GUI。

## 为什么

Tailwind v4 的 `translate-*`、`scale-*`、`rotate-*` 生成的是独立的 CSS 属性 `translate`、`scale`、`rotate`，不再写进 `transform`。手写的 `transition-[transform,…]` 管不到它们，于是下面三处设计好的动效一直是瞬时的：

- **按钮和各处的按下反馈**：`docs/design/foundations.md` §2.5 写「下沉走 `--motion-press`（70ms）+ `--ease-firm`」，实际从来没有过渡。dev 服务器生成的 CSS 里：
  - `active:translate-y-px` 是 `translate: …`；
  - `active:scale-[0.97]` 是 `scale: 0.97`；
  - `active:transition-[transform,box-shadow]` 的 `transition-property` 只有 `transform,box-shadow`。
- **设置页展开卡片的箭头**：`gui/src/components/screens/settings/settings-disclosure.tsx` 的 `CARET_MOTION`（`rotate-0` / `rotate-90`），旋转一直是瞬时的。
- **侧栏项目组展开时子项从 -8px 滑到 0**：`gui/src/components/layout/sidebar/SidebarProjectGroup.tsx` 约 622 行的 `transition-[opacity,transform]`，只有淡入在动，滑动是瞬时的。

Tailwind 自带的 `transition-transform` 和 `transition` 已经包含 `translate, scale, rotate`，不受影响。

## 要做成什么样

凡是手写的 `transition-[…]` 属性表里有 `transform`，都补上元素实际用到的 `translate` / `scale` / `rotate`；拿不准就三个都补。目标是让文档里写的动效真的发生。

时长、缓动、位移量、缩放量、触发条件一律不变：过渡只在 `:active` 上，松开时随基础态瞬时回弹，hover 一律瞬时。

**清单**（`grep -rn "transition-\[[^]]*transform" gui/src`，2026-10-20 共 21 处）：

- **按下**：
  - `ui/button.tsx`（2 处）、`TopBarIconButton.tsx`
  - `MainHeader.tsx`（写的是 `transition-[transform]`）
  - `SidebarQuickActions.tsx`、`SidebarNavIcons.tsx`、`SidebarFooter.tsx`
  - `SidebarProjectGroup.tsx`（4 处）、`SidebarTimeline.tsx`（2 处）
  - `SessionTitleMenu.tsx`、`topbar-status-badge.ts`
  - `MainView.tsx`、`ProviderCard.tsx`、`composer-styles.ts`、`MessageUser.tsx`
- **展开**：`settings-disclosure.tsx` 的 `CARET_MOTION`、`SidebarProjectGroup.tsx` 的子项滑入。
- **助理卡片**（`SidebarAssistant.tsx`）：已经写成 `active:transition-[translate,scale,box-shadow]`，和你定下的统一写法对齐即可。

做法自定：可以逐处补，也可以抽一个共用常量（按下那一串在十几处重复）。抽常量的话：
- 放在合适的非组件模块里（工具函数别从组件文件导出）；
- 改动面别扩到无关的类名。

## 防回归

加一条源码扫描测试，写法照 `gui/src/components/layout/Sidebar.main-chat.test.tsx` 末尾「遗留清单」那种读源文件的方式。规则：`gui/src` 里手写的 `transition-[…]` 属性表只要含 `transform`，就必须同时含 `translate`、`scale`、`rotate`（或者干脆规定「不许单写 transform」，二选一，回报里说明理由）。

先看它红（今天应有 21 处），再改，再看它绿。

## 文档

- **`docs/design/foundations.md` §2.5**：在按下那条（「下沉走 `--motion-press`…」）附近加一句：
  - Tailwind v4 的下沉、缩放、旋转是独立的 `translate`、`scale`、`rotate` 属性，过渡属性表要写上它们，`transition-[transform,…]` 管不到；
  - 并指向防回归测试。
- **`docs/devlog/2026-10-20-assistant-card-edge-and-switch-hitch.md`**：「留下的」最后一条「全局按下过渡不生效：另议」改成已开票，写上本票路径。

## 要守住的

- hover 一律瞬时：基础态的 `transition-none` 不动，过渡只在 `:active` 上。
- 不改任何时长、缓动、位移量、缩放量。
- 这是全局 GUI，外置和内置运行时都受影响；行为上的变化只是「本来该有的过渡出现了」。
- `gui/` 不是 prettier-clean：只格式化自己的 hunk。
- 中文注释与文档用全角标点。

## 别动

- **票 72 的文件**：主聊天票 72 在另一个 worktree 里改主对话挂载相关的文件（`MainView.tsx`、`Conversation.tsx`、`MessageUser.tsx`、`useStickyScroll`、`useTypingBubbleHandoff` 等）。这里只改那一处类名，别的不碰；合入冲突由主会话处理。
- **主工作树**：只在自己的 worktree 里做，不跑 `tauri dev`。

## 验证

- 防回归测试由红到绿。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`、`TZ=UTC pnpm --dir gui test`。
- 跑 `pnpm --dir gui build`，在生成的 CSS 里确认：按下那一串的 `transition-property` 含 `translate`、`scale`，箭头那串含 `rotate`。
- 真机手感由 JC 在主会话合入后看。

## 回报格式

- 改了哪些文件，每处前后的类名；抽了常量的话，写常量名与位置。
- 防回归测试的规则，以及由红到绿的输出摘要。
- 生成 CSS 的核对结果。
- 各项门禁的结果；分支名与提交号（从命令输出里抄）。
