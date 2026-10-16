# 03 在列表上直接打字就进输入框；点按钮与空白处不让输入框失焦

Status: ready-for-agent

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
