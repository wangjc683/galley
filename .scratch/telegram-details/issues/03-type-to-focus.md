# 03 在列表上直接打字就进输入框；点按钮与空白处不让输入框失焦

Status: done（2026-10-16 合入 main，`99e20fcb`，合并提交 `7eefcd48`；同日 JC 真机验收：「其他验收 OK，可以 push」）

来源：[PRD](../PRD.md) 裁决 4（2026-10-16，JC：「4，做」；推荐里说过「带中文输入法真机测，测不过就退」）。只改 GUI，不碰 Rust。两边都上。
与票 01、02 同一个子代理按序做，接在 02 后面。

## 目标

两方对话里你几乎一直在输入框里。点了一下复制、点了一下对话的空白处之后，接着打字就该进输入框，而不是什么都没发生。

## 依据（Telegram Web A）

- 打字即聚焦：`src/components/middle/composer/MessageInput.tsx:672-728`。document 上 capture 阶段的 keydown：焦点不在任何 input / textarea / contenteditable、没有弹层时，先把焦点交给输入框，让这一键落进去；⌘C、有选区时的方向键不抢。
- 按钮不抢焦点：`src/components/ui/Button.tsx:191-201`，按钮 mousedown 时 `preventDefault`。
- 空白处不抢焦点：`src/components/middle/helpers/preventMessageInputBlur.ts`，只在 mousedown 的 target 就是容器本身（不是冒泡上来的子元素）时 `preventDefault`，所以点在正文上照样能选字。
- 现状：两样都没有（grep 过），只有进会话、切回窗口时回焦（`hooks/useComposerFocus.ts:41-75`）。

## 要做

1. **打字即聚焦**：
   - 条件：主区在对话（助手或工作台，含新对话的空状态输入框）；`document.activeElement` 不是可编辑元素；没有打开的弹层（⌘K 面板、设置、对话框、菜单、提示词管理……找现成的判断，没有就按 `aria-modal` / Radix 的打开态做一个）；按键是可打印字符（`key.length === 1`），没按 ⌘ / Ctrl / Alt（Shift 可以）。空格要不要算你定，写理由。
   - 聚焦当前会话的输入框，不 `preventDefault`，让这一键的默认行为落进输入框（Chromium 下成立；WebKit 下要真机确认，见下）。
2. **点按钮与空白处不失焦**（只在输入框当前有焦点时生效）：
   - 对话里的按钮（回复行动条的 `ActionChip`、悬停复制、折叠头、回到底部、问题轨的点、选中工具条……逐个列出来）mousedown 时 `preventDefault`。会打开菜单、对话框、要在里面输入的控件照常拿焦点。
   - 对话滚动容器的空白处：只在 target 就是容器本身时 `preventDefault`，点在文字上照常能选字（选字本来就会让输入框失焦，这是对的）。
   - Tab 键遍历照旧能到这些按钮。
3. **⌥↑ / ⌥↓ 不能因此失灵**：今天输入框有焦点时 ⌥↑ / ⌥↓ 让给输入框（`useStickyScroll.ts:463-475`，macOS 上是按段移光标）。输入框更常有焦点之后，跳转就几乎用不上了。改为：**输入框为空时**照样跳（空输入框里移光标没有意义，同 Telegram「输入框为空时 ↑ 编辑上一条」的思路）；输入框有字时照旧让给输入框。

## 中文输入法：真机定去留

子代理不能开 `tauri dev`（会和 JC 常驻的那份抢同一个数据目录），这一项留给 JC 真机测，Comments 里写好测法：

- 测法：中文拼音输入法开着，选中对话里一段文字（让输入框失焦）→ 直接打 `nihao` → 看输入框里是「你好」，还是「n」+「ihao」的组字。
- 预判：WebKit 的输入法只在按键那一刻焦点已在可编辑元素上才接手，第一键很可能落成英文字母。
- 测不过时的退路（JC 选）：a. 第一键吞掉、只聚焦（快打时第一个音节会错）；b. 去掉打字即聚焦，只留第 2、3 条。实现时把第 1 条做成一处可以整体关掉的开关，方便退。

## 验收

- 单测：打字即聚焦的条件判断（可编辑元素、弹层、修饰键、非可打印键）；⌥↑ / ⌥↓ 在空输入框里接管、有字时不接管。
- 文档：`docs/design/conversation.md` 讲 composer 焦点（grep「useComposerFocus」「聚焦」）与 ⌥↑ / ⌥↓ 的地方改写。
- 真机（JC）：点回复下面的复制后直接打字进输入框；点对话空白处后打字进输入框；输入框为空时 ⌥↑ 能跳；中文输入法按上面的测法。

## Comments

### 2026-10-16 实现（子代理，分支 `td-composer`）

**做了什么**

- 规则都放进 `gui/src/lib/composer-focus.ts`（「输入框什么时候拿焦点」本来就只在这一处定），接线在 `hooks/useComposerFocus.ts` 新的第 4 条（每个 Composer 挂一份，空状态与 `MainView` 互斥，同一时刻只有一套监听）：
  - `typeToFocusAction`：document 上 capture 阶段的 keydown，焦点不在收字的地方、没有打开的层、按键是一个可打印字符且没有 ⌘ / Ctrl / Alt，就 `textarea.focus({ preventScroll: true })`，不 `preventDefault`。
  - `pressKeepsComposerFocus`：document 上 capture 阶段的 mousedown，输入框有焦点时，按在对话区的按钮或滚动容器本身上就 `preventDefault`。
  - `altArrowBelongsToField`：`useStickyScroll` 里 ⌥↑ / ⌥↓ 原来的「可编辑元素就让」换成它：空的输入框不让。只改了那个判断（加一行 import、换掉 6 行），票 04 改的平滑滚动那一行没碰。
- 标记：Composer 的 textarea 加 `data-composer-input`；`MainView` 里对话区外层加 `data-conversation-area`（含滚动容器、问题轨、回到底部），滚动容器加 `data-conversation-backdrop`。选中工具条是 portal 出去的，按它已有的 `data-selection-copy-toolbar` 认。
- `useComposerFocus` 第 3 条（为 WebView 吞点击做的「外面按下先失焦、80ms 没等到 click 就补发」）对上面这些不失焦的按下直接跳过：焦点不动就没有要绕的坑。
- 文档：`docs/design/conversation.md` §4.4 加「焦点留在输入框」一条（打字即聚焦、点按钮与空白、⌥↑ / ⌥↓）；`docs/design/overlays-and-settings.md` 快捷键表 ⌥↑ / ⌥↓ 那一行改成「空着照样跳，有字让给输入框」。设置里「快捷键」的文案（「跳到上 / 下一条提问」）没写焦点条件，不用改。

**取舍（票里「你定」的）**

- **空格不算**：不会有消息以空格开头；在对话上空格是读者的往下翻一页（滚动容器是最后点过的可滚动区时），抢走它等于拿掉一个阅读键。Telegram 不分空格，我们的门更窄，代价是「先按空格再打字」不会进输入框，没人这样起句。
- **开关做成三档** `TYPE_TO_FOCUS_MODE: "pass" | "swallow" | "off"`（`lib/composer-focus.ts` 一行）：`pass` 现行；`swallow` 就是退路 a（只聚焦、吞掉第一键）；`off` 就是退路 b（只留第 2、3 条）。JC 选哪条退路都只改这一个值，测试三档都覆盖。
- **弹层判断**：仓库里没有现成的「有没有打开的弹层」，按打开态的 DOM 做：页面上有 `role="dialog"` / `alertdialog` / `menu` 或 `aria-modal="true"` 就不抢。Radix 的 Dialog（设置、⌘K 的 cmdk、提示词管理、归档、图片预览、文件工作区的窄屏弹窗）、Popover（模型 / 强度弹层，`role="dialog"`）、DropdownMenu / ContextMenu（`role="menu"`）关着时都不挂在 DOM 上；手写的确认框是 `role="alertdialog"`。Tooltip（`role="tooltip"`）不算。另外焦点在 `listbox` / `menu` / `tree` / `grid` / `combobox` / `textbox` 里也不抢（这类控件自己读字，例如改动面板的文件列表 `GitFileList` 是常驻的 `listbox`，所以它只按焦点算、不算弹层）。
- **按钮不失焦用一条规则，不逐个加 `onMouseDown`**：对话区里的 `<button>` 一律算（新加的按钮自动跟上），排除 `aria-haspopup`（打开菜单 / 对话框的，交给那一层拿焦点）；`role="button"` 的行（折叠头、过程卡片与步骤标记的行）也算，但按在可选中的文字上不算（看计算样式 `user-select`，步骤摘要是 `select-text`，要能拖选）。逐个列一遍现在落在规则里的：回复行动条的复制 / 保存 / 过程（`ActionChip`）、工作台你的消息的悬停复制与「展开 / 收起」（`MessageUser`）、选中工具条的复制 / 引用、折叠头（`RunFoldHeader`，`role="button"` 且 `tabIndex=0`，原来点了会把焦点拿走）、过程卡片的步骤行（`ProcessCard`）与步骤标记行（`Conversation`）的非文字部分、代码块的按钮（`CodeBlock`）、工具行的打开按钮（`ToolCallout`）、文件引用（`LocalFileReference`，右键菜单不受影响）、文档 / 回复里的图片按钮（打开预览对话框，对话框自己拿焦点，关掉后 Radix 把焦点还给输入框）、提问候选（`AskUserBubble` 的 `Button`，⌘ 点击填入照旧，右键菜单照旧）、子任务卡片的按钮（`SubtaskCards`）、问题轨的点（`UserQuestionRail`）、回到底部。不在规则里：正文链接 `<a href>`、侧栏与顶栏、输入框自己的按钮（本来就在输入框根节点里，不经这条）。
- **票里「现状：两样都没有」的补充**：`ActionChip`、`CodeBlock`、`MessageUser`、`UserQuestionRail`、ui `Button` 早就在 mousedown 上 `preventMouseFocus`，但 `useComposerFocus` 第 3 条在更早的 pointerdown 上先把输入框失焦了，所以效果上确实是「没有」。这次的改动主要是让第 3 条对这些按下让路，再补上没有 `preventMouseFocus` 的（回到底部、折叠头、步骤行、文件引用、工具行按钮……）。
- **空白处只认滚动容器本身**（照票）：栏外两侧的留白、主对话短对话上方的空白都是容器本身；两条消息之间的空隙落在栏里的元素上，不算，照旧失焦（之后打字仍会被打字即聚焦接住）。

**量到的（Chrome，临时 harness：真 `MarkdownView` + `ActionChip` + 仿折叠头与步骤行 + 一行式 `Composer` + 选中工具条；harness 没进提交）**

- 输入框有焦点时：点复制 chip、点折叠头、点步骤行的序号、点滚动容器左侧留白，四次之后焦点都还在输入框，每个按钮的 onClick 各触发一次。
- 在步骤行的可选中摘要上拖选：选中了「步骤摘要可以选中」，焦点离开输入框（对的）。
- 接着打 `ab`：焦点回到输入框，值是 `ab`（Chromium 下这一键确实落进去了）。
- 点正文后按空格：不抢（焦点仍在 body）；按 Shift+C：进输入框成 `abC`；⌘A：照旧全选页面，不抢；开着一个 `role="dialog"` 时打 `x`：不抢。
- 滚轮滚动：焦点不动。经典滚动条（模拟 Windows：`data-platform="windows"`，10px 宽）下，输入框有焦点时拖滚动条照样滚（`scrollTop` 0 → 311），焦点不动；macOS 的浮动滚动条在无头 Chrome 里宽 0、拖不到，只能真机看。

**测试**

- `lib/composer-focus.test.ts` 新增 14 条（原 5 条不动）：打字即聚焦的条件（可打印、Shift 可以、⌘ / Ctrl / Alt 不行、空格与非可打印键、输入框 / 可编辑 / listbox / 打开的层、输入法 `isComposing` 与 229、已被处理的键、三档开关）；弹层选择器（含 dialog / alertdialog / menu、不含 tooltip）；按下不失焦（容器本身算、里面的元素不算、对话区与工具条里的按钮算、侧栏按钮不算、`aria-haspopup` 不算、`role="button"` 行在文字上不算、真按钮在可选中正文里也算）；⌥↑ / ⌥↓（空输入框接管、有字不接管、换行也算有字、别的输入框不接管）。
- `pnpm --dir gui typecheck`、`lint`、`git diff --check` 通过；三张票做完后全量 gui 测试两遍：本机时区 140 个文件 1424 条、`TZ=UTC` 140 个文件 1424 条，全过。

**JC 真机验收**

1. 输入框有焦点时点回复下面的复制 → 直接打字进输入框；点对话两侧空白 → 直接打字进输入框；点折叠头展开 / 收起 → 直接打字进输入框。每个按钮点一次只动作一次。
2. 选中一段回复（输入框失焦）→ 直接打英文 `ok` → 进输入框。
3. 输入框为空时 ⌥↑ / ⌥↓ 在你的消息之间跳；输入框有字时 ⌥↑ 是移光标、不跳。
4. **中文输入法**（定去留）：拼音输入法开着，选中对话里一段文字让输入框失焦 → 直接打 `nihao` → 看输入框里是「你好」，还是「n」+「ihao」的组字。测不过就选退路：a 改 `TYPE_TO_FOCUS_MODE = "swallow"`（第一键吞掉、只聚焦，快打时第一个音节会错），b 改 `"off"`（去掉打字即聚焦，只留按钮与空白不失焦和 ⌥↑ / ⌥↓）。
5. 开着设置、⌘K、模型弹层、提示词管理时打字，字不会跑进输入框。
6. 输入框有焦点时，从对话左侧留白按下往右拖进正文想整行选中：**这一下选不中**（容器本身的按下被拦了，Telegram 同样如此），要从文字上开始拖；觉得别扭就告诉主会话，可改成「按下不拦、松手时没选中字再把焦点还给输入框」（代价是按下那一刻输入框的焦点环会闪一下）。
7. macOS 浮动滚动条：输入框有焦点时拖对话的滚动条能拖动。
8. Windows 冒烟（有空时）：点了侧栏按钮（Windows 下按钮会拿焦点）之后直接打字也进输入框。

**顺手发现（没改）**：`useComposerFocus` 第 3 条的补发 click 在「按住超过 80ms 再松开」时会和原生 click 各触发一次（80ms 时补发一次，松手时原生一次）。harness 里在可选中文字上慢拖步骤行就触发了两次切换（真实的步骤行有「拖选不切换」的保护，所以不显形）。对话区的按钮这次都不再走第 3 条，侧栏、顶栏的按钮还在走；没见过报告，先记一笔。

### 2026-10-16 中文输入法真机测（主会话）

JC：「第一个键变成了英文字母，不过我觉得好像也没啥问题，用户只要去输入框点一下再输入，就是正常的」。主会话推荐 `off`：拿 JC 的原话当尺子，「先点一下再打」时 `off` 与 `pass` 一样正常；「忘了点」时 `off` 什么都不发生，`pass` 多出一个「n」加上「ihao」的错误组字、要删掉重打，对中文用户 `off` 处处不差；`pass` 只帮直接打英文或数字的人。改 `off` 损失小：第 2 条已让点复制、折叠头、空白后不失焦，焦点离开输入框基本只剩选中文字的时候。读系统当前输入法要在 Rust 里调各平台接口，不值。JC：「按你推荐，改成 off」。`TYPE_TO_FOCUS_MODE = "off"`，另两档代码与测试留着。
