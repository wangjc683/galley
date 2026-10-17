# 46 待办面板与主对话解耦：每条对话的顶栏都能开

Status: ready-for-agent

来源：主聊天 PRD 裁决 95（2026-10-17，JC：「按建议推进」）；裁决 94 定名字不改。依赖 45（顶栏按钮、记住开关、面板 320px）。改 GUI、共用提示词与文档。

## 目标

待办面板从「只在主对话本身开着时」改为内置运行时有主对话时，每条对话旁边都能打开查看；记、改、提醒仍只归 Galley 对话。开关分两处记，从面板点出去的跳转带着面板走，空状态精简，工作台的提示词补上待办。

## 要做

### 顶栏按钮出现的条件

- 内置运行时、有主对话（`hasMainChat`）时，主区每条对话的顶栏工具簇第一个都是票 45 的 `TodoToggleButton`（样子、数字、提示、选中态都不变）：Galley 本身、工作台会话、子任务、空白新对话（空白新对话的顶栏要是没有工具簇，就照没有，回报写明）。
- 外置运行时、内置但还没有主对话：都没有，顶栏一个字节不变（照票 45 的外置对比做法验）。
- 面板在当前对话旁边开，位置、宽度、与文件预览同一个位置都照票 45。

### 开关分两处记

- 两处：**Galley**（主对话本身在屏上，`mainChatOnScreen`）与**其他**（工作台会话、子任务、空白新对话共用一处）。
- Galley 一处沿用 localStorage `galley.todoPanelOpen`（不迁移、不改名）；其他一处新开一个键（名字你定，`galley.` 前缀），读写规矩照 `lib/todo-panel-memory.ts`（只认 `"1"`、try/catch、读不到当关、写失败只记这次运行）。默认都关。
- 按钮、⌘K、跳转改的都是**当前那一处**（跳转见下，改的是目的地那一处）。
- 文件预览换掉屏上的面板：换掉的是哪一处的面板，就记哪一处为关；另一处不动。「改动」审阅打开：两处都记为关（它是整个窗口的）。照票 45 的 `readingPanelClosesTodo` 与 `LocalFileWorkspace` 的接线改。

### 面板上的动作

- 勾掉、取消勾、取消提醒：在哪都原地做，不跳。
- **从面板点出去的跳转，面板跟到目的地**（把目的地那一处记为开）：
  - 点标题、目标是主对话里的回复：在 Galley 里照旧原地定位；在别处先回 Galley（`openMainChat`），再定位那句（票 28 的定位与高亮，注意切会话时的滚动吸附与定位请求的先后，参考 App 里 `onOpenMessage` 的做法）。
  - 点标题、目标是子任务或会话：打开它，面板跟过去（记「其他」一处为开）。
  - 「说说这件」：引用进 **Galley** 的输入框（`quoteTodo` 用真正的主对话 id，不是当前会话）；在别处先回 Galley，再引用、光标落进去。
  - 空状态的按钮：在 Galley 里光标落进输入框；在别处先回 Galley 再落进去。
- 面板组件现在拿 `activeSession.id` 当 `mainChatId`（`App.tsx` 里 `<TodoPanel mainChatId=…>`），解耦后要拿真正的主对话 id。

### ⌘K「待办」

- 在当前对话旁边打开（记当前那一处为开），不再先进 Galley。`lib/todo-open.ts` 的 `openTodoPanel` 与它的注释跟着改。
- 在没有对话的屏上（没有顶栏、没有面板位置的地方，若有）怎么办，你看代码定，回报写明。

### 空状态文案（定稿，逐字）

| 键 | zh | en |
|---|---|---|
| `todo.empty` | 要办的事，说一声就记在这里。 | Say what you need to do, and it's noted here. |
| `todo.emptyExample` | 比如「周三下午 3 点前要交季度报告」 | For example: “I need to hand in the quarterly report by 3 PM Wednesday.” |
| `todo.emptyTalk` | 跟 Galley 说 | Tell Galley |

样子不变（13px 一行、12px 例子、`secondary` 按钮）。键名不改，改注释（「离开了对话写名字」那句改成名字只在按钮上）。

### 共用提示词（`core/src/managed_prompt.rs`）

- `user_only_configuration!` 的最后一句（主对话以外的会话读：工作台、子任务、IM）：现在只说 reminders and scheduled tasks 由 the assistant 在 Galley 对话里设。改为 to-dos、reminders、scheduled tasks 都是，让用户去那里说，never say one is set / noted。主对话读的 `MAIN_CHAT_USER_ONLY_CONFIGURATION` 不动。
- 功能地图那一行（约第 104 行，`The Galley conversation's top bar: its to-do ("待办" / "To-do": …), which opens beside it.`）：改为待办在每条对话的顶栏、在旁边打开；保留 `"待办" / "To-do"` 字样（测试断言在用）。
- 静态提示词有字节预算（`STATIC_PROMPT_BUDGET_BYTES`，看那段注释和它指向的预算规则）。目标净增为零或几个字节；回报改前改后的字节数。Windows CI 检出是 CRLF，静态提示词 Windows 版比本机长约 18 字节，本机余量要留出这 18 字节；真要加预算，照预算规则写理由。
- 相应测试跟上；有断言改道句原文的（grep `Reminders and scheduled tasks`）一起改。

## 文档

- `docs/design/layout-and-chrome.md`：§4.1「待办按钮」的出现条件、记住开关（两处）、⌘K；§3、书眉一节、「已知」里写「只在 Galley」的句子；历史写一句指裁决 95。
- `docs/design/conversation.md`：「待办面板」一节的入口、记住、动作（跳转带面板）、全空的文案。
- `docs/design/overlays-and-settings.md`：⌘K「待办」一条与「待办（内置运行时）」一节。
- `docs/copy-language-guidelines.md`：「Galley」一行里待办面板的说法（「离开它自己的对话写名字」）若因空状态改动要补一句就补；有待办空状态的文案表就更新。
- `docs/managed-ga-runtime/` 下引用了功能地图或改道句原文的（grep），跟着改。
- 其余 grep「只在主对话」「只在 Galley」「mainChatOnScreen」碰到的待办相关句子。

## 别动

- 主区以外：侧栏、书眉不加任何待办入口（裁决 93 第 3 条撤掉的那一行不回来）。
- 面板内容、分组、行的样子、卡片：都不动。
- 手册（`assistant_manual.rs` 与 `galley-assistant-manual.md`）：主对话视角，「「待办」 beside this chat」仍然对，不改。
- 外置运行时的一切。
- 名字「待办」/「To-do」不改（裁决 94）。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、vitest 全量两遍（本机时区与 `TZ=UTC`）、`cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`、check.yml 的六个门禁脚本、中文标点扫新增行。
- 测试：按钮在 Galley、工作台、子任务都有，外置与没有主对话时没有；两处开关各自记、互不影响（在 Galley 开着去工作台是关的，工作台开着回 Galley 照 Galley 那处）；默认关；文件预览只关被换掉那一处；审阅关两处；四种跳转各自落到哪、面板跟过去；「说说这件」在工作台里点引用落进主对话；⌘K 原地开；空状态三段文案；提示词改道句含 to-dos、功能地图句、预算测试。
- 反向检查：关键断言各改坏一次看测试挂（照票 45 的做法），列在回报里。
- 看界面：临时 Vite + headless Chrome harness（不进仓库，不碰 Tauri），工作台会话旁开着面板、空状态中英、深浅色；截图放会话草稿目录。
- 真机（JC）：工作台里开面板勾一件；工作台里点「说说这件」回到 Galley；两处开关各自记得、重启后还记得。

## Comments
