# 10 切换器：主对话气泡里的字号、行距、段距

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 8（2026-10-16，JC：「主对话信息稍微有点密度不够，字有点太大」；讨论后：「好，做切换器」）。只改 GUI。纯视觉，做临时切换器进 `tauri dev` 真机比，JC 裁决后另开一步拆掉、写死。

## 现状

- 两边正文同一套变量（`gui/src/lib/conversation-font-size.ts`，标准档 `--conversation-body-size` 15px、`--conversation-body-leading` 1.7、`--conversation-block-gap` 12px；小档 13.5 / 1.65 / 10.5，大档见文件）。
- 助理气泡的 Markdown 正文（`MarkdownView.tsx:222, 303, 311`）与你的气泡（`MessageUser.tsx:350`）都读这三个变量。
- 主对话的气泡把行宽收到栏宽 88% 再减 28px 内边距（`AssistantParts.tsx` `ASSISTANT_BUBBLE_MAX`、`BUBBLE`）：760 栏约 641px，一行约 42 个汉字。

## 要做

- **只主对话**：在主对话的对话列上（不是全局）覆盖这三个变量，你的气泡与助理的气泡（含问候、提问、子任务叫醒那一轮的回复）一起变。工作台一个像素不动。输入框（`--conversation-composer-size`）不动。逐个列出主对话里还有谁读这三个变量（过程卡片、子任务卡片、引用块……），各自跟不跟你定，写理由；原则是「气泡里的正文」跟，气泡外的小字不跟。
- **按字号档各一组**，⌘= / ⌘− 照常生效。标准档的值如下；小档、大档按标准档与现有档位的比例推，段距守住 `conversation-font-size.ts` 注释里「段距约为行框 0.47」的规矩（写出你算的表）：

  | 档 | 字号 | 行高 | 段距 | 说明 |
  |---|---|---|---|---|
  | V0 | 15px | 1.7 | 12px | 现状 |
  | V1 | 15px | 1.55 | 10.5px | 只收行距（主会话倾向） |
  | V2 | 14px | 1.6 | 10.5px | 降一档字号 |
  | V3 | 14px | 1.5 | 9.5px | 降字号再收行距，对照 |

- 气泡的内边距、圆角、宽度上限、连发 4px 间距都不动。标题、代码、表格的字号不动（主对话少见，看完再说）。
- 依据：Telegram Web A 在 macOS 上正文默认 15px、行高 1.3125（`src/global/initialState.ts:98`、`src/components/middle/message/Message.scss`）；我们与它的差距在行距。中文需要比拉丁字更多的行距，1.31 对中文太挤，1.5–1.6 是中文界面常见范围。

## 切换器

- 照票 05 的做法：一颗常驻、可点的小 pill（portal + `pointer-events: auto`，不挡输入框、回到底部），点开选 V0–V3；选择存 localStorage（try/catch），刷新后保持；默认 V0，合入后不切什么都不变。只在主对话里显示。
- 代码集中、好拆，每处接入点标 `TEMP variant switcher (telegram-details 10)`，拆法写在文件头。临时 UI 不进 i18n。

## 量给 JC 看

用临时 Vite + Chrome（不开 tauri dev），放一段真实长度的主对话（三段、约 400 字、夹几个英文词与一个短列表；不要用 JC 库里的真实内容），760 与 1200 两种栏宽、标准档，各档量：气泡高度、一行的汉字数、同一屏（如 852px 高的对话区）能放下的轮数。截图放 scratchpad，路径只写进汇报。

## 验收

- typecheck、lint、全量 gui 测试两遍（本机时区、`TZ=UTC`）、`git diff --check`；中文标点脚本扫新增行。
- 默认 V0 下主对话与工作台逐像素不变；任一档下工作台不变：说明怎么确认的。
- 真机（JC）：主对话里切 V0–V3，看两三轮真实对话；⌘= / ⌘− 换档后各档仍成立；深色也看一眼。

## Comments
