# 28 顶栏菜单：查找聊天记录（⌘F）与重置主对话

Status: ready-for-human（2026-10-15 合入 main，合并提交 `7541197a`；等 JC 在 tauri dev 里验收）

来源：主聊天 PRD 裁决 77（2026-10-15，JC：「按建议推进」）。依赖 27。改 GUI，Core 只给界面用的搜索命令加参数；CLI 与 Agent API 不动。

## 目标

- 任何打开的对话里按 ⌘F，或点顶栏菜单「查找聊天记录」，打开 ⌘K 面板、只搜当前对话；结果带日期，回车跳到那条。
- 主对话的顶栏菜单多一项「重置主对话…」，直接弹出设置里那个按住 5 秒的确认框。

## 一、Core：界面用的搜索命令加两样

- `core/src/commands/session.rs:581` 的 `search_messages`（GUI 用，背后是 `search_message_hits`）今天只收 `query`、`limit`、`runtime_kind`，返回的 `MessageSearchHit` 有会话标题、角色、片段，没有日期。加：
  - 可选参数 `session_id`：给了就只搜这个会话（Core 的公开接口 `search_messages` 早已支持按会话过滤，照它的 SQL 做法）；
  - 每条结果带消息的 `created_at`（ISO 8601，同 `SearchHit.created_at`）。
- 只做加法：不给 `session_id` 时结果与今天逐字节相同（除了多一个字段）。
- 前端的 IPC 类型镜像（`gui/src/types/ipc.ts` 等）与 `gui/src/lib/db.ts` 的 `searchMessages` 跟着加；check.yml 的 IPC 镜像门禁要过。
- **不动** CLI 的 `galley` 命令与 Agent API 的 JSON（宪法 Rule 3）；grep 确认 CLI 走的不是这条 Tauri 命令。
- Rust 测试：带 `session_id` 只回这个会话的命中；不带时同今天；结果有 `created_at`。

## 二、⌘K 面板的范围

- 面板加一个可选的「范围」：当前会话。有范围时：
  - 输入框前面一个标签：主对话里写「在主对话里」，普通会话写「在这个对话里」（新文案键，中英两版；英文你定，比如 in this chat）；标签可点 × 去掉。
  - 占位文字：主对话「查找主对话…」，普通会话「查找这个对话…」（新文案键）。
  - 只显示「在对话内容中」的命中（不显示最近会话、操作两组）；空输入时显示一句安静的提示或什么都不显示，你定。
  - 每条命中的第一行由会话标题换成日期（格式照对话里的时间条：今天写「今天 21:40」，更早写「10月13日 21:40」，跨年带年份；用 `lib/message-time.ts` 现成的函数），第二行照旧是片段；你 / 它的图标照旧。
  - 回车 / 点击：照现成的 `onOpenMessage` 跳过去（分页历史逐页加载，`useStickyScroll` 的定位高亮）。
  - 空输入框按退格：去掉范围，变回普通的 ⌘K（最近会话、操作、全部会话的命中）。
- 没有范围时（⌘K）一切同今天。

## 三、⌘F

- 全局快捷键 ⌘F（Windows / Linux Ctrl+F）：有打开的对话时，打开带当前对话范围的面板；没有打开对话时（新对话的空状态、设置页等）等于 ⌘K。
- 输入框、设置里的文本框有焦点时也生效（同 ⌘K 的现行规则，查一下 ⌘K 怎么处理焦点，照做）。
- 设置 → 快捷键页（`SettingsShortcuts.tsx`）加上 ⌘F 一行。

## 四、顶栏菜单

- 主对话的菜单（`SessionTitleMenu`）：
  ```
  查找聊天记录…        ⌘F
  ──────────
  桌面宠物
  重新注入工具
  ──────────
  重置主对话…
  ```
- 普通会话的菜单：最上面加「查找聊天记录… ⌘F」，其余（重命名、重新注入工具、桌面宠物）照旧，分组你定。
- 「重置主对话…」：直接弹出设置里同一个确认框（`ResetMainChatAccess` 用的那个对话框，按住 5 秒）；有对话在跑时这一项置灰、悬停或副文字写原因（同设置里那一行的 `runningBlock`）。设置里那一行照留。只在内置运行时、有主对话时出现（同设置那一行的条件）。
- 菜单项的图标、快捷键提示的样式照菜单里现有项的写法。

## 五、文档

- `docs/design/layout-and-chrome.md` 写顶栏身份行与标题菜单的地方：菜单内容改成新的，理由引裁决 77（IM 资料页：查找聊天记录、清空聊天记录）。
- `docs/design/overlays-and-settings.md` 或写 ⌘K 面板的地方：范围标签、日期行、退格去范围、⌘F。
- `docs/ipc-protocol.md` 若记了 `search_messages` 的参数，跟着加。
- 不写 devlog（主会话写），不改 PRD，不改各票的 Status 行。

## 不做

- 浏览器式的查找条；手机与 IM 渠道入口；关于助手；子任务列表；导出。
- CLI / Agent API 的任何变化。

## 验收

- 跑这几项：`cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`（至少涉及的 crate 全量，新增的测试必过；有新迁移才需要补六处手写迁移列表，这张票不该有迁移）、`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`git diff --check`；全角标点自查（扫新增行）；仓库里的推送前门禁脚本能跑的都跑（尤其 IPC 镜像、文档链接）。core 只格式化自己动过的文件，gui 只格式化自己的 hunk。
- **测试**：面板有范围时只显示当前会话的命中、第一行是日期；退格去范围；⌘F 有对话时带范围、没对话时等于 ⌘K；主对话菜单有查找与重置、普通会话菜单有查找没有重置；有对话在跑时重置置灰。
- **反向检查**：改坏几处，确认测试会挂；恢复后逐字节一致。例如：范围不生效（搜到别的会话）、日期丢了、⌘F 不带范围、普通会话也出了重置、在跑时重置可点。
- **逐像素**：⌘K 面板（不带范围）、各会话主区、侧栏，与开工时的 main 一致；变化只在顶栏菜单与带范围的面板。
- **自查截图**（Chrome harness，复用会话草稿目录里 `s27/` 的脚本，复制到新目录再改，不进仓库；模拟 Core 要能回带日期的命中）：主对话菜单、普通会话菜单、带范围的面板（有命中、无命中、空输入）、退格去范围后的面板、重置确认框（从菜单弹出）、在跑时置灰的重置项；浅色与深色、中英文；出总览图。截完把 harness 从工作树删掉。
- **JC 在 tauri dev 里走一遍**（合入时 Core 会重编、重启）：
  1. 打开助手，点「Galley ⌄」，看菜单；点「查找聊天记录」，搜一个词，看结果带日期，回车跳过去；
  2. 在面板空输入框里按退格，看变回搜全部；
  3. 在一个工作台会话里按 ⌘F，看只搜这个会话；
  4. 在主对话菜单里点「重置主对话…」，看弹出的确认框（别真的按住 5 秒），关掉；
  5. 让一个对话跑起来，看重置那一项置灰。

## Comments

2026-10-15 实现（子代理，分支 `header-menu-28`，基于 `17e5ed9c`，未合入）。

提交：`10654f6b` Core 的搜索命令与 Rust 测试；`3ed02d9e` 面板范围、⌘F、菜单与界面测试；`c8088d84` 设计文档；本条记录随后单独提交。

**一、Core：界面用的搜索命令**

- 签名：`search_messages(query, limit, runtime_kind: Option<RuntimeKind>, session_id: Option<SessionId>)`（`core/src/commands/session.rs`），背后 `search_message_hits` 同样加了 `session_id`。前端传 `sessionId`（Tauri 的 camelCase）。
- SQL：FTS（三字以上）与 LIKE（两字）两条路各加一列 `m.created_at AS created_at`；带 `session_id` 时加 ` AND s.id = ?`（照 `search_messages_db` 的写法：缩小运行时与归档的范围，不取代它们）。排序我定：带 `session_id` 时 `m.turn_index DESC, m.sequence DESC, m.id DESC`，即对话里的先后、新的在上（一个对话的命中会话活动时间都一样，原来的 `s.last_activity_at` 排不出先后；微信的查找聊天记录也是新的在上）。不带时 SQL 文本与排序一字不差，只多一列。
- `MessageSearchHit` 末尾加 `created_at`（JSON `createdAt`，ISO 8601，同 `SearchHit.created_at`）；加在最后，原字段顺序不变。
- **CLI 与 Agent API 没动**：`cli/src/session.rs` 的 `sessions_search` 调的是 `GalleyApi::search_messages`（`core/src/db/api_impl.rs` → `search_messages_db`）；`search_message_hits` 只有这条 Tauri 命令一处调用（grep 复核：`core/src/commands/session.rs` 与 `core/tests/db_test.rs`）；socket 与远程模块里没有搜索命令。`docs/agent-api/session-commands.md` §5.3 不变。
- IPC 镜像：`gui/src/types/ipc.ts` 是 runner ↔ Core 协议的镜像，里面没有 Tauri 命令的类型；这条命令的前端镜像是 `gui/src/lib/db.ts` 的 `MessageSearchHit` 与 `searchMessages`，跟着加了 `createdAt` 与可选的 `sessionId`（不给时调用参数照旧，没有 `sessionId` 这个键）。`docs/ipc-protocol.md` 没记这条命令，没改。IPC 镜像门禁照常过。
- 没有迁移。
- Rust 测试 `gui_search_message_hits_filter_by_session_and_carry_created_at`：FTS 与 LIKE 两条路都测；带 `session_id` 只回这个会话、按对话先后从新到旧（种子的 id 故意乱序）、每条的 `created_at` 是原值；不带时四条都在、最近活动的会话在前；未知会话为空；序列化的键正好是原来七个加 `createdAt`。原有的 GUI 搜索测试改为传 `None`。

**二、⌘K 面板的范围**

- 规则做成纯函数，在 `gui/src/lib/palette-scope.ts`：`openConversationScope`（⌘F 找的是哪个对话）、`paletteAfterFind`（⌘F 之后面板的状态）、`dropsScope`（退格去范围）、`paletteSearchRequest` / `paletteSearch`（问 Core 什么）、`scopedListView`（列表显示什么）、`scopedHitDate`（日期行）。UI store 加 `paletteScope`、`findInConversation`、`dropPaletteScope`；`togglePalette`（⌘K）与 `setPaletteOpen`（侧栏搜索、关面板）都清掉范围。
- **标签**：「在主对话里」「在这个对话里」，英文我定「In main chat」「In this chat」，带 ×（无障碍名「改为搜索全部」/「Search everywhere」）。标签 24px 高、`border-line` + `bg-app`、12.5px；× 照新对话输入框下项目标签那颗。有范围时输入行变成一行 flex：放大镜、标签格（48px、带与输入框同一条底线）、输入框占满余宽（`.cmdk-input-scoped`）。没有范围时这一行的 DOM 与类名一字不差（测试断言了）。
- **占位**：「查找主对话…」「查找这个对话…」/「Find in main chat…」「Find in this chat…」。
- **列表**：只有「在对话内容中」一组（组头照留，表明这是消息命中）；cmdk 不再过滤、不重排（`shouldFilter={false}`，Core 已经排好）；最多 20 条（我定：⌘K 里 8 条是因为旁边还有会话与操作，20 同 `searchMessages` 的默认与 CLI）。
- **空输入时显示什么（我定）**：一行安静的提示「输入至少两个字开始查找」/「Type two or more characters to find」，与「没找到。」同一个样式。理由：查找从两个字开始（三元组 FTS 加两字 LIKE），只留一个空白框读起来像坏了，打了一个字也说得清为什么还没结果。查询在路上时什么都不显示，不闪「没找到」；查回来是空的写「没找到。」，不带「Enter 直接发问？」（这里回车是查找，不开新对话）。
- **日期行**：`lib/message-time.ts` 的 `formatMessageTime`，带今天这个词：「今天 21:40」「昨天 09:12」「10月13日 21:40」，跨年带年份，英文 12 小时制。票里写了今天与更早两档，「昨天」是对话时间条本来就有的一档，照留。时间不能解析时退回会话标题。
- **回车 / 点击**：照旧走 `onOpenMessage`（`requestLocate` + `openSession`）。harness 里实测：主对话演示长对话里 ⌘F 搜「一下」、选第四条回车，落到那条消息，词级高亮。
- **退格**：输入框的值严格为空串时退格去掉范围（有一个空格不算，那一下先删空格）；输入法组字时的退格不算（`isComposing` 或 keyCode 229，同 `lib/ime.ts`）。标签的 × 也能去掉，点它时焦点留在输入框里。

**三、⌘F**

- `useGlobalShortcuts` 加平台修饰键 + F（不带 Alt），调 `lib/find-in-conversation.ts` 的 `findInOpenConversation()`，按键时读 store，监听不随会话重绑。标题菜单的「查找聊天记录…」调的也是它，一条规则。
- **焦点（查了 ⌘K 怎么处理，照做）**：⌘K 是 window 上的 keydown，不看焦点在哪，所以输入框、设置里的文本框有焦点时都生效；⌘F 一样。多了一条 ⌘K 没有的：输入法组字时的按键交给输入法。`preventDefault` 也是为了不让 Windows 上 WebView2 自己的 Ctrl+F 查找栏弹出来（没在 Windows 上验过，留给 Windows 冒烟）。
- **有打开的对话** = 主区开着会话（`screen === "main"`）、设置没开、活动会话在且没归档；否则 ⌘F 等于 ⌘K（同样是开关）。我定的两处：面板开着、范围就是这个对话时再按 ⌘F 关掉面板（同再按 ⌘K）；开着不带范围的 ⌘K 时按 ⌘F，给它加上范围、已打的字留着。
- 设置 → 快捷键：导航组 ⌘K 后加一行「在当前对话里查找 ⌘F」，note「没有打开对话时同 ⌘K」（Windows 显示 Ctrl+K）。
- macOS 原生菜单没加 Find 项（票没要求；2026-07-15 删过灰着的 Find 占位）。

**四、顶栏菜单**

- 主对话：查找聊天记录… ⌘F ─ 重新注入工具 / 桌面宠物 ─ 重置主对话…。
- **普通会话的分组（我定）**：查找聊天记录… ⌘F / 重命名 ─ 重新注入工具 / 桌面宠物。查找与重命名都是对这个对话的日常动作，下一组是引擎的工具；查找单独成组会让四项分成三组，太碎。
- **偏离票面**：票里主对话的菜单画成「桌面宠物、重新注入工具」，我保留了现有的「重新注入工具、桌面宠物」：两个菜单共有的两项先后一致；裁决 77 第 5 条只说「留在菜单下部」。要换就是 `SessionTitleMenu` 里两项对调。
- 快捷键提示：菜单里原有项没有快捷键提示，照应用里最近的同类——侧栏「新对话」行尾的 ⌘N（`SHORTCUT_TEXT_CLASS`：等宽 10.5px 灰字，靠右）。图标照菜单原有项：14px thin、`text-ink-soft`；查找用 `MagnifyingGlass`，重置用 `Eraser`，文字不标红（它只是打开确认框，确认框里才是红的）。
- **重置**：弹出设置里同一个 `ResetMainChatDialog`，`MainHeaderHost` 管开关、开着才挂载（同设置）。出现条件同设置那一行：`isMainChat && activeRuntimeKind === "managed"`（App 传 `isMainChat`）；在跑的判断与设置同源（messages store 里任一会话 `agentRunning`）。设置里那一行照留。
- **置灰时怎么说原因（我定）**：副文字。项置灰（Radix `disabled`，不可选、悬停不高亮），下一行写设置那一行的原句「有对话正在运行，结束后才能重置主对话」；照 `SettingsNavRow` 只把图标与名字调淡（opacity-60），原因那行不调淡，它是唯一值得读的一行。不用悬停提示：禁用项悬停不高亮，tooltip 要停住才出现，最需要原因的时候最看不到。原因行最宽 232px：中文一行，英文折两行。
- **焦点**：菜单项选中时不立即开面板或确认框，记下来，等菜单关好（`onCloseAutoFocus`）再开。harness 里实测：菜单还在时打开面板，输入框的焦点被菜单的焦点陷阱吞掉，打字进不去；改后面板输入框、确认框都拿到焦点。

**五、文档**

- `docs/design/layout-and-chrome.md`：Session title menu 一行与身份行一条改成新的菜单；新增「标题菜单里的查找与重置」（两个菜单的样子、理由引裁决 77 与 IM 资料页）；「重置在设置深处」改为「重置」，写两个入口与裁决 77 的理由。
- `docs/design/overlays-and-settings.md`：触发与形态加 ⌘F；「不加 ⌘P 别名」注明 ⌘F 不是别名；新节「范围：在一个对话里查找（⌘F）」（入口、标签、只有对话内容、日期行、空的时候、回车、退格去范围）；Runtime 的重置那一行注明顶栏入口；Shortcuts 与 §10 快捷键表加 ⌘F。
- 没写 devlog、没改 PRD 与 Status 行。提醒主会话：`docs/devlog/deferred.md` 的「会话内查找（Ctrl+F）」（2026-09-08 暂存，方案是查找条）被这张票以面板的方式接了，待主会话关掉或改写。

**测试与验证**

- `cargo check --workspace` 过；`cargo test --workspace` 全量：33 组（cli、core、relay、remote-protocol 的单元、集成与文档测试）933 条全过，其中 `db_test` 22 条。core 只核对了自己动过的文件（`rustfmt --check`）：`db_test.rs` 里迁移列表那段的格式差异是开工前就有的，没动。
- `pnpm --dir gui typecheck`、`lint` 过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 全量各一遍：135 个文件、1312 条全过。新增 33 条：`lib/palette-scope.test.ts` 16、`components/overlay/CommandPalette.scope.test.tsx` 8、`lib/find-in-conversation.test.ts` 4、`components/layout/MainHeaderHost.menu.test.tsx` 4、`SettingsShortcuts.test.tsx` 1。面板的渲染测试把 cmdk 换成内联的替身（静态渲染跑不了 Radix 的 portal），命中直接喂给 `ScopedResults`；菜单测试渲染真的 `MainHeaderHost`，替换 prefs 与 messages 两个 store 来给运行时和在跑状态；⌘F 用真的 UI 与 sessions store。
- 门禁脚本：IPC 镜像、Supervisor SOP、文档链接、版本一致、managed GA payload、GA baseline、update channel 都过；`check-managed-ga-app-bundle` 要 release 包、`check-bundled-python-managed-ga.sh` 要打包，没跑。
- `git diff --check` 过（新文件也查了）。gui 只格式化了自己的 hunk，新文件整篇；`CommandPalette.tsx` 里 prettier 想改的 `EmptyHint` 一处是开工前就有的，没动。
- 全角扫描（自写脚本扫新增行，先用坏例子自测：7 个坏例全中、好例 0）：剩 16 处，3 处是 markdown 链接收尾的 `](…)「`，13 处是英文注释里夹的中文界面词（如 `查找聊天记录;`、`「没找到」,`，英文句子用半角）。
- **反向检查 8 处，都挂了**，恢复后逐字节一致（每处 sha256 核对，全部做完后 `git diff` 的 sha256 与开工前相同）：Core 带 `session_id` 不过滤（Rust 挂 1 条）、面板查询不带 `sessionId`（2）、带范围的命中丢了日期（2）、⌘F 不带范围（2）、普通会话也出了重置（1）、在跑时重置可点（1）、退格去不掉范围（2）、不带范围时 ⌘K 也变成只有对话内容（1）。
- **逐像素**（Chrome harness：真 App 加模拟 Core，从会话草稿目录的 `s27/` 复制到 `s28/` 再改：模拟的搜索按会话过滤、带 `createdAt`；开工时的 `17e5ed9c` 用 `git archive` 解出；两个 Vite 各占一个非 1420 的端口；关动画、冻结时钟，1x 整窗）：
  - **37 组逐像素一致**：⌘K 不带范围（空输入、主对话演示「一下」有命中、普通会话「高铁」有命中、英文、空状态、空状态没匹配、外置运行时、小窗口、侧栏搜索按钮打开、命中回车落地）、主对话（静止、在跑、在问你、演示长对话 × 浅深，英文，演示在跑，小窗口）、工作台（静止、在跑有排队 × 浅深，英文深色在跑，宽屏长对话）、子任务（浅深、从助手点开的）、空状态（浅深）、外置运行时（浅深）。侧栏与关着的顶栏都在这些整窗里。
  - **有意的变化只在打开的菜单**（7 组：主对话浅 / 深 / 英文 / 在跑、普通会话浅 / 深、外置运行时）：差异框在两版菜单的框与它们的阴影范围内，菜单框外最大色差 18，是菜单变高后阴影跟着变。带范围的面板开工时没有，不比像素，见自查截图。
- **自查截图**（2x，会话草稿目录的 `s28/shots/`，49 张；每张的面板 / 菜单状态记在 `s28/shots/state.json`，逐像素结论在 `s28/cmp-result.txt`）与总览（`s28/overview/`）：
  - `01-menus-zh.png`：主对话 ｜ 普通会话的菜单 × 浅 ｜ 深，有对话在跑时置灰的重置，主对话在跑时打开普通会话的菜单，悬停在置灰的重置上；
  - `02-scoped-palette-zh.png`：带范围的面板 × 浅 ｜ 深：从菜单打开的空输入、有命中、没找到，普通会话里 ⌘F，退格去范围后的 ⌘K；
  - `03-english.png`：英文的菜单、置灰、面板（空、有命中、没找到、⌘F）、退格去范围、确认框；
  - `04-flow.png`：⌘F → 输入 → 选中第四条 → 回车落地；打字再删空仍带范围、再退格变回 ⌘K；空状态 ⌘F = ⌘K；悬停「查找聊天记录…」；
  - `05-reset-dialog.png`：从菜单弹出的确认框，浅 ｜ 深 × 中 ｜ 英；
  - `06-pixel-compare.png`：逐像素的结论与菜单的开工时 ｜ 本票对照。
