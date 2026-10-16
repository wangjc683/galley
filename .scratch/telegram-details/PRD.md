# 向 Telegram 学的对话细节

Status: active（2026-10-16 裁决 1–7 已定）

来源：2026-10-16 JC：「现在其实我们的主对话和普通对话都已经基本更接近于 IM 化设计了，主对话完全就是按 IM 标准去做的 UI/UX。我听说 Telegram 的前端是开源的？我一直觉得它的 IM UI 很不错，尤其是一些小细节……找找哪些前端细节 UI 设计是我们可以参考学习的吗？」随后：「学设计思路和具体数值（间距、时长、阈值、交互规则、动效），不是搬代码。」

## 参照与许可

- Telegram Web A（`Ajaxy/telegram-tt`，2026-10-16 `f67a408`）为主，Web K（`morethanwords/tweb`，2026-10-15 `a9c6f0e`）交叉核对。两者都是 GPL-3.0，Galley 是 MIT：**只学思路与数值，不搬代码**。票里引的 Telegram 出处只用来说明做法，实现一律按我们自己的写法重写。
- 调研笔记（会话 scratchpad，不进仓库）：消息列表、输入框与外壳、Galley 现状三份。结论与出处收在本文与各票里。

## 一句话

Telegram 强在看不见的规则：滚动怎么走、焦点给谁、各种阈值；尾巴、阴影、时间嵌进气泡这些装饰我们早就有意不要。

## 已经一样或更好（不动）

- 中文输入法：`lib/ime.ts` 同时认 `isComposing` 与 `keyCode 229`（WebKit 确认候选那次 Enter），Telegram 两端只认前者。
- 在跑时按钮是停止、Enter 照样能发（我们是排队）：同 Web A 机器人流式时的做法。
- 加载更早的消息时手写锚点保位、不转圈；会话切换不出骨架屏；不做逐条虚拟化（Telegram 是 40–60 条一片，同我们每页 50 轮的思路）。

## 裁决（JC，2026-10-16）

JC：「1，做；2，刚试了，目前新消息是停在底部附近，如果做了后，会怎么样？是工作台和主对话都做还是？我们继续讨论；3，做；4，做；5，做；6，按推荐比；7，按推荐」

1. **草稿存到磁盘**：做。`composer-draft.ts:13` 不存的理由「same contract as every chat client」不成立：Telegram 每个对话存草稿，停手后存（Web A 10 秒、Web K 2.5 秒），清空立删，切走、失焦、关窗必存（Web A `useDraft.ts:122,159-200`）。存 localStorage（`prefs.ts`、`theme.ts` 已这样用，属界面便利，不碰 Rust 的权威数据）。→ 票 01。
2. **工作台发出后留白（live tail），回复超出一屏后不跟随**：做，只做工作台。JC 真机确认今天新消息停在底部附近（`conversation.md`「Scroll behaviour」要的是停在视口顶下 32px，列表底下没留白，滚动到底就停了）。讨论后 JC：「1，只做工作台；2，按你推荐，A」。
   - 只做工作台：主对话是 IM 贴底（主对话 PRD 裁决 67，JC 真机比过），长回复已有「回复开头到顶下 32px 就停」；Telegram 自己也是普通聊天贴底、只有机器人流式回复才留白（Web A `MessageList.scss:126-147`）。
   - A 不跟随（没选 B 照 Telegram 释放后贴底跟随）：设计文档本来就写「阅读 reply 期间不被打扰（不跟随）」（`conversation.md:464-475`）；B 正是今天长回复要往上翻才能读的原因。
   - deferred「自动滚动到最终答案开头」在 JC 验收后可能撤下。→ 票 06。
3. **选中文字可以「引用」进输入框**：做，两边都上。Telegram 选中正文后右键，「回复」变成「引用并回复」（Web A `ContextMenuContainer.tsx:432-453`）。→ 票 02。
4. **在列表上直接打字就进输入框；点按钮与空白处不让输入框失焦**：做，带中文输入法真机测试，测不过就退。Telegram：Web A `MessageInput.tsx:672-728`、`Button.tsx:191-201`、`preventMessageInputBlur.ts`。→ 票 03。
5. **两条滚动规则 + 四处小出入**：做。远跳先瞬移（Web A `animateScroll.ts:164-168,241-272`）；平滑滚动认「减少动态效果」（我们 `foundations.md:609`，Web K「只淡不移」）；顺带修回到底部按钮中文 aria-label、`conversation.md:541`、`:557-563`、deferred「轮间距层级」里的过时数值。→ 票 04。
6. **输入框长高动画、主对话连发组内小圆角**：做一次切换器真机比。Telegram：长高 `50 × ln|Δh|` ms（Web A `MessageInput.tsx:288-326`、Web K `inputFieldAnimated.ts:75-80`）；组内圆角外 15 / 内 6（Web A `Message.scss:164-183`）。→ 票 05。
7. **滚动时浮动日期**：进 [deferred](../../docs/devlog/deferred.md)「滚动时浮动日期（主对话往回翻）」，信号在那里。

## 不学（JC 未异议）

- 尾巴、阴影、时间嵌在气泡右下角、悬停看时间：与已定规则冲突（`conversation.md:53/78/89`、工作台 PRD 裁决 3）。
- 大号 emoji：没人这样用；12px 圆角本就为了不让「好」「继续」变药丸。
- 流式匀速显示（Web K 60–240 字 / 秒）：主对话有意不流式；工作台没人反馈一跳一跳，匀速会人为拖慢。
- 表格等宽列：我们的表格常是一列短一列长，等宽更难读。
- 未读条数、打字三点：否过（`layout-and-chrome.md:252`、`conversation.md:107`）。
- ↑ 编辑上一条、Esc 逐层关闭：不能改已发的消息，输入框里也没什么可取消。
- 回到底部 50px 阈值、新内容到来时 350ms 防闪：只有见过按钮闪才值得改。

## 影响

- 只改 GUI 与文档，不碰 Core、库、CLI。外置与内置运行时一样。
- 票 01–04 对外置用户也是看得见的变化，发版说明各写半句（随下一版）。

## 票

| 票 | 内容 | 状态 |
|---|---|---|
| [01](./issues/01-drafts-persist.md) | 草稿存盘（裁决 1） | ready-for-agent |
| [02](./issues/02-quote-selection.md) | 选中文字引用进输入框（裁决 3） | ready-for-agent |
| [03](./issues/03-type-to-focus.md) | 打字即聚焦、点按钮与空白不失焦（裁决 4） | ready-for-agent |
| [04](./issues/04-scroll-rules.md) | 远跳先瞬移、平滑滚动认减少动态、四处小出入（裁决 5） | merged，等真机 |
| [05](./issues/05-variants-composer-corners.md) | 切换器：输入框长高动画、主对话连发组内圆角（裁决 6） | ready-for-agent |
| [06](./issues/06-workbench-live-tail.md) | 工作台发出后留白、你的话停在顶上、回复超出一屏不跟随（裁决 2） | in-progress |

01–03 都动输入框，同一个子代理按序做；04、05 各一个子代理，并行；06 接在 04 后面（用它的滚动函数）。

## Comments
