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

### 2026-10-17 实现回报（子代理，分支 mc-todo-everywhere）

分支开在 `68eeb809`，没有提交。

**改了哪些文件**

- GUI：`lib/todo-panel-memory.ts`（两处：`TodoPlace` = `galley` / `elsewhere`，`TODO_PANEL_OPEN_KEYS`，读写按处）、`stores/ui.ts`（`todoPanelOpen` 改成两处的记录，`setTodoPanelOpen(place, open)`；加 `clearQuote`）、`lib/todo-open.ts`（`todoPlaceOf`、`todoView`、`openTodoPanel(here)`、`toggleTodoPanel(here, shown)`、跳转带面板、`quoteTodo(item, here, mainChatId)`、`talkToGalley`、`takeQuote`）、`lib/todo-panel.ts`（`readingPanelClosesTodo` 返回要关的那几处，加 `todoPanelOpened`）、`App.tsx`（按钮条件改为有主对话；面板拿真正的主对话 id；⌘K 原地开）、`LocalFileWorkspace.tsx`（`aside.place`；预览只关被换掉那一处，审阅关两处；任一处打开都收起预览与审阅）、`TodoPanel.tsx`（`here`，三种跳转走 `lib/todo-open.ts`）、`MainView.tsx`（引用请求改为「取走一次」：在屏上时马上取，从别处跳来时挂载就取）、`zh.ts` / `en.ts`（空状态三段照票面逐字，注释改成名字只在按钮上；`topbar.todo` 的注释）；注释：`MainHeader.tsx`、`MainHeaderHost.tsx`、`UtilityCluster.tsx`、`TodoToggleButton.tsx`、`stores/assistant-todo.ts`、`lib/assistant-todo.ts`（后两处还写着票 42 的侧栏那一行）。
- 测试：`lib/todo-open.test.ts`（重写，18 条）、`stores/ui.todo-memory.test.ts`（重写，5 条）、`lib/todo-panel.test.ts`（预览、审阅、`todoPanelOpened`）、`MainHeaderHost.todo.test.tsx`（工作台、子任务、空白新对话的顶栏都有；外置四种都没有）、`TodoPanel.test.tsx`（空状态中英三段、字号、名字只出现一次）、`LocalFileWorkspace.aside.test.tsx`（`place`）。
- Core：`core/src/managed_prompt.rs`（改道句、功能地图那一行、宏与预算的注释、两条测试）。
- 文档：`docs/design/layout-and-chrome.md`（§3、书眉一节、工具簇、「待办按钮」的条件、两处记住、⌘K、历史、「已知」）、`docs/design/conversation.md`（「待办面板」的入口、在哪、与预览、全空、动作）、`docs/design/overlays-and-settings.md`（⌘K「待办」、「待办（内置运行时）」）、`docs/copy-language-guidelines.md`（「Galley」一行补空状态）、`docs/managed-ga-runtime/prompt-composition.md`（预算段、配置边界一节、主对话短多少、条款账本一行、回归清单第 9 条与新第 40 条）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（一句）。

**票面留给我定的**

1. **「其他」一处的键**：`galley.todoPanelOpenElsewhere`；代码里两处叫 `galley` / `elsewhere`。Galley 一处照旧 `galley.todoPanelOpen`，不迁移。读写规矩照抄（只认 `"1"`、try/catch、读不到当关、写失败只记这次运行）。
2. **空白新对话**：它有顶栏和工具簇（`LocalFileWorkspace` 的 `header` 不分屏），所以按钮在、面板也能在它旁边开，算「其他」一处。
3. **⌘K 在没有对话的屏上**：没有这种屏。onboarding 时 App 提前返回，⌘K 面板根本没挂；空白新对话有顶栏和面板的位置，算「其他」。所以 ⌘K 总是开当前那一处。
4. **提示词的写法**（净增 0 字节）：改道句 `To-dos, reminders and scheduled tasks are kept by the assistant, in the Galley conversation atop the sidebar: ask the user to tell it there, and never say one is noted or set.`；功能地图 `- Every conversation's top bar: the to-do ("待办" / "To-do": reminders, scheduled tasks, subtasks), opening beside it.`。改道句多 9 字节（加 to-dos、kept、noted or，`at the top of` 改 `atop` 省 9），地图那行省 9（`The Galley conversation's … its` 改 `Every conversation's … the`、`which opens` 改 `opening`）。字节数：本机静态 6808 → 6808，Windows 6826 → 6826（平台 CLI 那段 Windows 比 POSIX 长 18 字节，用脚本量两个宏得出），预算 6826 不动，本机余量正好 18。主对话的静态规则 6771 → 6762（比共用的短 37 → 46）。
5. **从别处「说说这件」怎么把字送进 Galley 的输入框**：请求先放在 `ui` store（`quoteRequest`，用真正的主对话 id），再 `openMainChat`；主对话的 MainView 挂载时（和在屏上收到新请求时）用 `takeQuote` 取走并清掉，只取一次，工作台的 MainView 不碰它。原来的「只认新请求」（比前后两个请求对象）在跳过去的情况下会漏掉，因为请求在主对话的 MainView 订阅之前就发了。
6. **从别处「跟 Galley 说」**：只回 Galley，不另发聚焦请求：新挂载的输入框按约定自己拿光标（`useComposerFocus` 第 1 条），点面板按钮不算占着焦点。harness 里实测落在主对话的输入框。
7. **点标题跳到回复的顺序**：先 `requestLocate`，再 `openMainChat`（同 App 里 ⌘K 的 `onOpenMessage`）。`openMainChat` 先等 Core 回主对话再切会话，这段时间工作台的 `useStickyScroll` 只认自己会话的定位请求，不会吃掉它；切过去时主对话的滚到底吸附看到它就让开。
8. **App 的条件做成纯函数**：`todoView(hasMainChat, todoPanelOpen, screen, session)` 给出按钮在不在、当前哪一处、面板在不在屏上，App 只调它，测试直接测它（App 渲染不了）。

**与票面不同、或我加的**

1. **跳回 Galley 失败时收回请求**（我加的）：`openMainChat` 返回 false（Core 出错）时，刚放下的定位或引用请求若还是这一个就清掉，免得下次打开 Galley 时突然跳一下或多一段引用。Galley 一处已记为开，不收回。
2. **点标题打开的会话恰好是主对话本身时**（到点开过会话的例行可能是），记的是 Galley 一处；票面写的是子任务或会话记「其他」。
3. **`quoteForComposer` 去掉了 `previous` 参数**，配 `takeQuote` 与 `clearQuote`（理由见上第 5 条）。
4. **文档里顺手改的过期处**：`prompt-composition.md` 写主对话静态规则比共用的短 70 字节，本分支开工时实际已是 37（现为 46），改了数字；回归清单第 9 条还写着指向侧栏「定时」、给可粘贴的提示词（裁决 90 前的行为），改成去 Galley 对话；新加第 40 条：工作台里开着面板说「加一个待办」不 `todo add`、不说记下了，指去 Galley，再点「说说这件」落到 Galley。`stores/assistant-todo.ts`、`lib/assistant-todo.ts` 的注释还写着侧栏那一行，一起改了。
5. **改道句里 `at the top of the sidebar` 成了 `atop the sidebar`**：为了净增为零；测试断言跟着改。文档叙述里仍写 at the top of the sidebar 的地方说的是行为，不是原文，没动。

**查过的设计禁令**（`docs/design/` 与 `docs/devlog/deferred.md` grep「不要 / 有意 / 分叉 / 禁止 / 被否 / 没选 / 否掉」与顶栏、工具簇、右侧面板、徽标、待办、工作台；`.scratch/main-chat/` 下没有 `deferred.md`）

- layout-and-chrome「禁止」：状态点、颜色只给 warning / error / `brand` → 按钮的样子、数字、选中态都没动，只是出现在更多顶栏里。
- 「角标只放需要你处理的数」（07-30）→ 数字照旧是字，不是徽标；工作台里也看得到是裁决 95 第 1 条推翻裁决 93 第 3 条，不是新徽标。
- tools-and-approvals §4.7「右侧常驻面板让 Galley 读起来像 IDE」→ 两处默认都关，工作台那一处与 Galley 那一处分开记，在 Galley 开着不会跟到工作台。
- 裁决 93 第 3 条撤掉的侧栏那一行、票面「别动」→ 侧栏与书眉的文件一个没改，外置对比里侧栏逐字节相同。
- conversation「待办面板」里取消提醒不与「说说这件」并排（deferred「session 行 hover 置顶按钮」否掉行内第二颗按钮）→ 面板内容、行、按钮都没动。
- 记忆「加新容器的方案被否」→ 没有新容器，按钮还在原来的工具簇里。
- 文案规范「Galley」一行「离开它自己的对话写名字」→ 名字留在按钮「跟 Galley 说」上，不写「它」，也不写「在左边说一声」（裁决 95 第 5 条）。
- deferred.md：没有约束顶栏工具簇或待办面板的条目；「长工具输出在右侧阅读面板」「Artifacts」用右侧面板，与面板的位置不冲突。

**验证**

1. `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0（最后一次在全部改动之后）。
2. vitest 全量：本机时区与 `TZ=UTC` 各一遍，都是 `Test Files 165 passed`、`Tests 1734 passed`。
3. `cargo test --manifest-path core/Cargo.toml --workspace`：exit 0，45 组，1128 passed、0 failed、0 ignored。`managed_prompt` 34 条全过（含 `static_prompt_stays_within_budget`、`main_chat_static_rules_stay_within_the_static_budget`）。
4. 六个门禁 exit 0：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check main` 无输出。
5. 新增行 grep `http`、`api_host`、`apibase`、`/Users/`、`/private/tmp`、`/var/folders`：0 处。
6. 中文标点扫新增行（自写脚本，先用坏例子自测，抓到 `这是错的,标点(半角)` 与句末半角句号）：中文句子 0 处；16 处是英文注释或测试代码里夹中文界面词（如 `待办 (ticket 37)`、`toBe("交季度报告")`），用英文标点，不改。本回报写完后另扫一遍，见第 11 条。
7. 格式：改过的旧文件 prettier 差异行数与 main 相同（`App.tsx` 11、`LocalFileWorkspace.tsx` 21、`en.ts` 40、`zh.ts` 13，其余 0）；main 上本来干净的测试文件整篇格式化。`rustfmt --check core/src/managed_prompt.rs` exit 0。
8. 反向检查 24 处都挂（每处改坏、跑对应测试、看它挂，再按 sha256 确认还原）：外置也出按钮；没有主对话也出按钮；两处共用一个开关；子任务算 Galley 那一处；「其他」写进 Galley 的键；Galley 的键改名；预览把两处都关；审阅只关屏上那一处；「其他」打开不收起预览与审阅；从别处点回复不回 Galley；定位请求在落地之后才发；跳回 Galley 面板不跟；子任务记成 Galley 一处；工作台里「说说这件」不回 Galley；引用取了不清；工作台的输入框也接 Galley 的引用；工作台里「跟 Galley 说」聚焦工作台的输入框；⌘K 先进 Galley；空状态中文换回旧句；空状态英文例子换回旧句；Rust 四处：改道句去掉 to-dos、去掉 noted、功能地图换回 Galley 的顶栏、预算压到实测 6808 之下。
9. 外置零变化：`git archive main` 的 gui 与本分支的 gui 各拷一份到草稿目录（不碰仓库），跑同一段临时测试：外置运行时的顶栏（中英、有无「改动」、有无标题、App 传不传待办开关、开关态两种）、外置的 `LocalFileWorkspace`（`aside` 为空）、外置侧栏（0 与 3 个会话），macOS / Windows / Linux 共 114 份标记，sha256 逐字节全部相同（96 份顶栏、6 份工作区、12 份侧栏）；分支这边没有一份含 `topbar-todo`。这次连 React `useId` 也没变：工具簇的子节点槽位与 main 一样。
10. 看界面：临时 Vite（5246 端口，不碰 Tauri）+ headless Chrome，跑真的 `Sidebar`、`MainHeader`、`AssistantIdentity`、`LocalFileWorkspace`、`TodoPanel`、`TodoCards`，按 App 的接法（`todoView`、两处、`toggleTodoPanel`）拼起来；`lib/main-chat` 换成切 harness 会话的替身，输入框是照 MainView 那段订阅写的替身。截图（会话草稿目录 `t46-harness/ui/shots/`）：
    - 工作台旁开着面板：`light-workbench-panel.png`、`dark-workbench-panel.png`
    - 空状态：`light-workbench-empty-zh.png`、`dark-workbench-empty-zh.png`、`light-workbench-empty-en.png`、`dark-workbench-empty-en.png`
    - Galley、子任务、空白新对话旁：`light-galley-panel.png`、`light-subtask-panel.png`、`light-newchat-panel.png`
    - 工作台里点「说说这件」后落在 Galley、引用在输入框里：`light-talk-about-landed-in-galley.png`
    - 工作台里开文件预览换掉面板：`light-preview-replaced-workbench-panel.png`

    交互（同一页里点）：工作台点按钮，只写 `galley.todoPanelOpenElsewhere`；去 Galley 面板不在、按钮弹起；Galley 里点开，写 `galley.todoPanelOpen`；回工作台照工作台那处，点关只删工作台的键；回 Galley 仍开；刷新页面后工作台关、Galley 开。工作台里「说说这件」：落到 Galley，引用「交季度报告」进 Galley 的输入框，光标在那里，两处都记为开；点回复标题：落到 Galley，定位请求是那条回复；Galley 里点标题：不跳会话、只发定位；工作台空状态点「跟 Galley 说」：落到 Galley、光标在它的输入框；工作台开文件预览：面板收起、只删工作台的键，Galley 的键还在，再去 Galley 面板在。页面错误 0，控制台只有一个 404（harness 没有 favicon）。
11. 本回报的中文标点用同一个脚本扫过：中文句子 0 处；2 处命中都在行内代码里（引的提示词原文、自测用的坏例子）。

**没验证的**

- 真机（按约定不跑 `tauri dev`）：WebKit 下的样子、重启后两处各自记得、Windows；真的 MainView 与 Composer 接引用（gui 测试没有 DOM 环境，MainView 的 effect 跑不到；`takeQuote` 有单测，harness 里用的是照抄那段订阅的替身输入框）；真的 `openMainChat`（要 Core）与 `useStickyScroll` 在切会话后消费先放下的定位请求（与 ⌘K 消息搜索同一条路，只是中间多等一次 Core）。
- App 里把真正的主对话 id 与 `place` 交给面板的那几行没有测试覆盖（App 渲染不了），靠 typecheck 与 harness 照同样接法验证。
- Windows 静态提示词 6826 字节是本机 6808 加两个平台宏的差 18 算出来的，没在 Windows 上量。

**发现、没改的**

- 引用请求原来只认「新请求」，所以任何「先发请求再切到主对话」的路都会丢引用；这次改成取走一次，以后别的入口要往主对话送引用也能用。
- `prompt-composition.md` 里主对话静态规则「短 70 字节」的数字在本票之前就过期了（实为 37），说明这个数没有测试守着；本票改了数字，没加测试。
