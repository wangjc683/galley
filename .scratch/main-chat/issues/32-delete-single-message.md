# 32 主对话删单条消息

Status: ready-for-agent

来源：主聊天 PRD 裁决 83（2026-10-16，JC：「整体方案我认可你推荐的 C」），推翻裁决 59 的「删单条不做」，deferred「主对话里删单条消息」出列。依赖 29、31（叫醒行与它的回复）。改 Core、GUI、远程协议；CLI 与 Agent API 不动。

## 目标

右键主对话里任意一条气泡（你的、它的回复都行）→「删除」→ 确认框点一下 → 这条从界面、库、搜索、查历史里消失，助手下一句起也看不到它；手机端跟着消失。

## 一、删什么（Core，权威写在 Rust，宪法 Rule 5）

- 新 Tauri 命令（只给 GUI 用；名字你定，比如 `delete_main_chat_message`）。只认主对话（`sessions.main_chat = 1`），别的会话一律拒绝。
- 一个气泡对应哪些行：
  - **你的气泡**：那一条 user 行，连同它的附件文件（找到附件存哪、删文件；文件删不掉要不要让整个删除失败，你定，写理由）。
  - **它的回复**：气泡画出来的那几行，加上它的过程（过程卡片里那几步的行）；过程里的工具结果也可能带着要删的内容。触发这一轮的、看不见的叫醒行（票 29 的 `galley-report` 行）跟着一起删，否则重放时它会看到一份没回过的报告，可能再说一遍。
  - 让 GUI 把行 id 传过来、Core 校验它们都属于主对话且组成一个完整的气泡，还是 Core 按一条锚点行自己算，你定；要的是界面删掉的和库里删掉的是同一组行。
- 全文索引（`messages_fts`）跟着删。
- **不重用 `turn_index`**：段界（`main_chat_segments`）、CLI 的 `--after-turn`、回放都按它；删了留洞，下一条照旧往后排。查清 `sessions.turn_count` 与下一条的 `turn_index` 怎么算，删除后不能倒退。
- **置灰（Core 也要拒绝）**：主对话在跑、在等你回答提问、或这一行正在被写（流式中、排队中）时不能删。
- **带子任务卡片的回复先不能删**：子任务卡片挂在派活那条回复下面（`docs/design/conversation.md:114`），没升级的子任务只能从卡片进去；删掉回复等于把子任务丢在看不见的地方。菜单里置灰并写原因（文案你写），不连带删子任务。JC 验收时再定。
- 问候（`via: system` 的第一条）照常能删。全删光后对话照常能用：下一句正常发出，不重新问候、不出错。

## 二、让它看不到（runner）

- 当前这一段的上下文是从库里重放的（`core/src/session_runner/replay.rs:3`）。删完后若主对话有活着的 runner，照切段的做法悄悄退掉（`core/src/session_runner/segment.rs:22`「Fresh context = a fresh runner」），下一次 ensure 重起、重放不含被删的行。**不切段**：这一段别的话都要留着。
- **先验证（开工第一步）**：删掉你的一条后，库里会出现它的两段回复挨着；删掉一条回复后，你的两句挨着。重放（`rows_to_conversation_messages`）与 runner 的 `load_history` 能不能接受，有的模型接口要求一问一答交替（看 `managed-ga/code/llmcore.py` 各接口怎么拼历史）。不能的话在重放里处理（合并或补占位，你定、写理由），`core/tests/fixtures/history-replay-cases.json` 加用例。
- 新段开头带的最近 3 轮（`core/src/session_runner/carry.rs`）与查历史都读库，删了自然读不到；写测试钉住。

## 三、手机端（远程协议）

- 远程协议现在只有 `message.persisted`（`remote-protocol/src/app/events.rs:60`），加一个删除事件（比如 `message.deleted`，带会话 id 与被删的行 id）。只加不改；`ios/` 的 Swift 协议包若对事件做穷举解码，跟着加。
- iOS 还没有界面，长按菜单不在这张票；`docs/design/conversation.md:123` 手机长按菜单的清单末尾加「删除」。

## 四、界面（GUI）

- **入口**：主对话里的气泡（你的、它的回复、问候、答完的提问）右键出菜单，这次只放「删除」（destructive 样式）。工作台、外置运行时不出菜单，零变化。菜单视觉照现有右键菜单（`docs/design/layout-and-chrome.md:219`：`galley-pop-in` / 200px / 13px）。不进回复下的行动条：删除收不回，不和「复制」并排。
- 这是气泡上第一个右键菜单（票 07 时定的是「右键菜单照旧不开」，`docs/design/conversation.md:421`）：右键时选中的文字、浮动复制、引用工具条不能被搞乱；非编辑区禁用 WebView 默认菜单的规矩不变（`docs/design/layout-and-chrome.md:222`）。
- **确认框**：`ui/confirm-action-dialog.tsx` 的 `ConfirmActionDialog`，确认键点一下（长按 5 秒只给波及这一条以外的动作，`docs/design/overlays-and-settings.md` 长按那节最后一条）。文案：
  - 标题：「删除这条消息？」
  - 不写正文（JC 2026-10-16 选不写正文：「对于用户来说，负担最小最容易理解」）。
  - 确认键：「删除」
  - 英文同样只有标题与确认键：「Delete this message?」/「Delete」。
- 删完界面上那组气泡消失，分组间距、时间条（`assistantRowGap`）照规则重算，不留空洞；滚动位置不跳（删的是视口上方的气泡时，看着的内容不动）。删除失败在确认框里写原因，带「复制详情」（照重置）。
- 文案进 i18n（中英两版）。

## 五、文档

- `docs/design/conversation.md`：助手对话一节写右键删除（入口、各删各的、带子任务的回复不能删、置灰条件）；`:421` 那句「右键菜单照旧不开」改成指向这里。
- `docs/design/layout-and-chrome.md:265`：「卡片没有菜单……」那段补一句：单条消息可以删，见 conversation.md。
- `docs/devlog/deferred.md` 主会话已改（出列），你不用动。
- `docs/ipc-protocol.md` 若 Core ↔ runner 的协议没变就不动；远程协议的文档（若有）加事件。

## 验收

- Rust：`cargo check` / `cargo test --manifest-path core/Cargo.toml --workspace`；删除命令的测试（只认主对话、置灰条件、整个气泡的行、叫醒行连带、索引、`turn_index` 不倒退、带子任务卡片的回复被拒）；重放用例；carry 读不到被删的。
- GUI：typecheck、lint、全量测试本机时区与 `TZ=UTC` 各一遍、`git diff --check`；右键菜单只在主对话出现；确认后气泡消失。
- 六个门禁脚本（新 Tauri 命令要进 `gui/src/types/ipc.ts`，IPC 镜像门禁要过）；中文标点脚本扫新增行。
- 真机（JC）：删你的一句、删它的一条带过程的回复、删问候；删完接着问它刚才那句说了什么，它答不上来；带子任务卡片的回复菜单是灰的；工作台右键没有菜单。

## Comments

### 2026-10-16 开工第一步：删除后同一角色挨着，重放接不接得住（子代理）

结论：接得住，重放不加新规则，只在 `core/tests/fixtures/history-replay-cases.json` 加三条用例钉住删除后的形状。

- **Core 这一侧已经合并**：`continue_conversation`（`core/src/session_runner/replay.rs`）逐行读，与上一条同角色就并成一条（正文空一行接上，图片接在后面），
  夹具里原有「多步运行并成一条 assistant」「相邻 user 行合并」两条。所以删掉你的一句后它的两段回复挨着，发给 runner 的是一条 assistant；
  删掉一条回复后你的两句挨着，发的是一条 user。`load_history` 收到的永远一问一答交替。
- **runner 不检查角色**：`GaSession.set_history`（`runner/ga_session.py`）把消息转成块后直接赋给 `backend.history`。
- **各接口发请求前都再修一遍**：`managed-ga/code/llmcore.py` 的 `_fix_messages` 合并相邻同角色、丢掉开头不是 user 的消息；
  `ClaudeSession.raw_ask`、`LLMSession.make_messages`、`NativeClaudeSession.raw_ask`、`NativeOAISession.raw_ask` 都先过它，
  `MixinSession` 转给节点自己的 `raw_ask` / `make_messages`。就算 Core 不合并，请求里也不会出现同角色相连。
- **两个边角，与今天中止的一轮同样处理，不另做**：
  - 删掉你的第一句、前面又没有带过来的几轮：历史以 assistant 开头（夹具原有「history may start with an assistant message」），
    `_fix_messages` 在每次请求时丢掉它，模型看不到那条回复。代价小：它答的那句已经被你删了。
  - 删掉最新的一条回复：你那句成了结尾的 user，重放照「结尾的 user 丢掉」规则不发；你下一句发出后它与下一句并成一条，再重放就又在了。
    这正是中止一轮后的现状。
- **不补占位的理由**：补「…」或「这里删了一条」等于告诉模型这里删过东西；而且 `continue_conversation` 是所有会话共用的，
  为一个从不发生的形状改全体的重放不值。

新用例：删你的一句后两段回复合并；删一条回复后两句合并（图片跟着走）；删最新回复后结尾的问题按中止处理被丢掉。
`cargo test -p galley-core --lib golden_cases_convert_exactly`：1 passed。

### 2026-10-16 实现回报（子代理，分支 `mc-delete-msg`）

**做了什么**

- Core：新模块 `core/src/message_delete.rs`（哪几行是一条、拒绝条件、执行顺序）与 `core/src/db/message_delete.rs`（读行、删行、`turn_count` 下限、摘要重取）；
  Tauri 命令 `delete_main_chat_message`（只给桌面，CLI 与 Agent API 不加命令）；事件 `message-deleted`（`{sessionId, messageIds, via}`）；
  下一条的 `turn_index` 改为 `MAX(MAX(turn_index) + 1, turn_count)`（`insert_message_inner` 与切段的 facts 同一个式子）；
  `AppRunnerStarter` 加 `via`；`session_runner::enter_single_flight`；`turn_persistence` 导出 `js_trim`。不加迁移。
- 远程协议：`message.deleted`（Rust 事件、golden 样例、Swift 协议包）；远程模块转发，只转手机看得见的会话。协议版本不动：同一 major 只加不删，旧端不认识的事件本来就忽略。
- 界面：主对话的对话根上挂一个右键菜单（`MessageDeleteMenu`）；确认框 `DeleteMessageDialog`（只有标题与确认键，`ConfirmActionDialog` 的正文改为可选）；
  store 的 `applyMessagesDeleted` 与 `removedOrdinals`（`lib/turn-ordinals.ts`）；`buildRunGroups` 的 `splitAfterAnswer`；`assistantLinePlan` 把丢了你那句的回复照回复画；
  `useRemovedTurnsAnchor` 保住滚动位置；听 `message-deleted`；中英文案。
- 文档：`docs/design/conversation.md`（助手的对话一节加「右键删除一条消息」，原「右键菜单照旧不开」改为指向它，手机长按清单加「删除」）、
  `layout-and-chrome.md`（重置那段补一句）、`overlays-and-settings.md`（确认弹窗正文的例外）、`docs/architecture.md`（一段，事件清单加 `message-deleted`）、
  远程协议设计 `.scratch/ios-client/issues/05-remote-protocol-design.md` §6.4 加一行。`docs/ipc-protocol.md` 不动（Core 与 runner 之间没变）。
  IPC 漂移门禁查的是 runner 协议（`runner/ipc.py` / `core/src/ipc.rs` / `gui/src/types/ipc.ts`），不管 Tauri 命令，这张票没有新的 runner 命令，`types/ipc.ts` 不用改。

**定下的事与理由**

1. **重放**：见上一条，不加规则。
2. **一条是哪几行，谁来算**：界面只把被右键的那一行的 id 交给 Core（锚点），Core 按桌面分组的同一套规则自己算出整条（`buildRunGroups` 的 Rust 版），把删掉的行 id 报回来，界面只去掉这几行。
   不选「界面传一组 id、Core 校验」：校验本身就得重算一遍，等于两边各算一次再比；锚点加 Core 计算只有一处权威（Rule 5），界面删掉的与库里删掉的天然是同一组。
   - 你的一句：那一行，连同它的附件；你在一轮里对提问的回答也是你的一句。
   - 问候：那一行。
   - 它的回复：这一轮里它的每一行，回答、提问、过程的每一步（工具结果在行里，跟着走）；右键回答或右键提问都是删这一整轮里它说的，你在这一轮里的回答留着。
     理由：提问是这一轮过程的一部分，只删提问，后面的步骤和回答就接不上了；裁决 83 是「它的回复连同过程算一条」。
   - 叫醒那一轮连同看不见的叫醒行；叫醒行自己不算一条。
   - 删了你的一句，它前后两条回复挨着：界面与 Core 都在「回答之后又来了它的一步」处断开（`splitAfterAnswer`），两条还是两个气泡、各删各的；不断开的话后一条会把前一条的回答收进自己的过程卡片。
     只在主对话开：GA 在一步看起来是回答之后还可能接着跑（回复只有一大段代码时它会追问一句），JC 库里 1,663 条 assistant 行里有 1 处，在工作台；主对话碰上时那一轮会画成两条。
3. **`turn_index` 不倒退**：下一条 = `MAX(MAX(turn_index) + 1, turn_count)`；删除时先把 `turn_count` 抬到至少原来的最高下标 + 1，不降。
   JC 库里 169 个有消息的会话没有一个 `turn_count` 大于 `MAX + 1`，所以不删时与原来一样；这也是 Agent API 给 `--after-turn` 写的「新消息落在 `turnCount`」。
   代价：删的是最新一行、而它是一条没回的消息时，`turnCount` 多 1。
4. **附件删不掉怎么办**：删行之前先把这条消息的附件目录在原地改名挪开（同一卷，全有全无，不用复制），挪不开就整个不删、框里写原因；删行失败就挪回来；
   删行成功后再删挪开的目录，这一步失败只记日志（它已不在 Galley 读的任何路径上，重置主对话会清掉整个会话目录）。
   理由：删除就是为了它不在了，行删掉、图还在磁盘上会悄悄违背这一点。Windows 上图片被别的程序开着时改名会失败，用户看到「没能删除」，关掉再删。
5. **摘要**：删掉的行里有最新的回复时，`sessions.summary` 改取剩下最新一条有摘要的回复，没有就清空；不然手机和 CLI 的会话列表还在引用删掉的话。
6. **runner**：在会话的单飞槽里依次检查、挪附件、退掉活着的 runner（照切段的悄悄退）、删行；放开槽后在后台照常重起（`runner-spawned-external`，`via: message-delete`），页面照旧挂上去。
   不切段；没有活的 runner 就不起。退 runner 放在删行前：退掉之后任何发送都要重新确保 runner，而确保要等这个槽，所以读到的一定是删完的库。
7. **置灰**：在跑（含刚发出、还没开跑）、在等你回答（含库里最新一条回复停在提问上：重启后 Core 只认得这个）时「删除」整个是灰的；
   派出了子任务的回复灰（这一轮有任何派活记录，没派出去的那种卡片也算）。原因写在菜单项下面一行：「它正在回复，回完才能删」「它在等你回答，答完才能删」「这条回复派出了子任务，暂时不能删」。
   Core 同样拒绝（`busy` / `has_subtasks`），确认框里对应写「它正在回复或在等你回答，这会儿删不了。」「这条回复派出了子任务，暂时不能删。」，其他失败写「没能删除这条消息。」，都带「复制详情」。
8. **菜单**：整个对话只挂一个菜单，只在气泡上开（按 `data-message-id` 认，答完的提问气泡补了这个属性）；气泡外右键什么都不弹，WebView 默认菜单照旧关着；
   气泡里文件路径、图片自己的菜单优先；关菜单不挪焦点，Esc 只关菜单（不清选区），选中的文字与浮动复制、引用照旧。整段平铺的运行（中止的、没有回答的）不出菜单。
   删完那组气泡的位置留给后面的行，行的 key 不变（`removedOrdinals`），所以开着的过程卡片不会跳到别的回复上，看着的内容也不动。
9. **英文文案**：菜单「Delete」；确认框「Delete this message?」/「Delete」；置灰「Wait until it finishes replying」「Answer its question first」「This reply started subtasks, so it can't be deleted for now」；
   失败「It's replying or waiting for your answer, so this can't be deleted right now.」「This reply started subtasks, so it can't be deleted for now.」「Couldn't delete this message.」。

**没做、记下的**

- 库文件里的残留：删行后 SQLite 的空闲页与全文索引的旧段里还可能留着原文，直到被覆盖或合并；重置会整理（compact），单条删除不做（每次整理要锁库重写，代价大）。
  引擎的运行日志 `temp/model_responses/` 30 天内仍有原文，迁移前的自动备份里也有（与重置时的裁决同一处境）。确认框不写正文后，界面上不再说这些。
- 竞态：Core 检查完、退 runner 之前，若 CLI 的 socket `session send` 正好把一条消息直接派给活着的 runner（它不经单飞槽），那一轮会被退掉，留下一条没回的消息。窗口是毫秒级。
- 整段平铺的运行没有菜单，它的步骤删不掉；它前面你那一句能删。

**测试**

- Rust：`message_delete` 单测 8 条（分组规则）；`core/tests/message_delete_test.rs` 11 条（只认主对话、在跑 / 在问 / 库里停在提问都拒绝、带子任务卡片的回复拒绝、附件挪不开就不删、你的一句连同附件与索引、
  整轮回复含提问与过程、叫醒行连带、问候与全删光后照常能用、`turn_index` 不重用、摘要重取、活的 runner 退掉并重起）；
  `main_chat_segment_test.rs` 加 2 条（换掉的 runner 重放不含被删的、新段带过来的几轮不含被删的）；`remote_module_test.rs` 加 1 条（手机收到 `message.deleted`）；重放夹具加 3 条。
  `cargo test --workspace`：36 组 996 条全过，本机时区与 `TZ=UTC` 各一遍；`cargo check --workspace` 只有 `relay` 原有的那条弃用警告。Swift 协议包 `swift-test.sh`：73 条全过。
- GUI：新增与改动的测试 27 条（`turn-ordinals`、`message-delete`、`messages.delete`、`run-groups` 的分开规则、`assistant-conversation` 的孤立回复、`scroll-anchor` 的删除锚点、`Conversation.delete`）；
  全量 149 个文件 1,554 条，本机时区与 `TZ=UTC` 各一遍全过；`typecheck`、`lint` 过。
- 六个门禁脚本都过；`git diff --check` 干净。没跑真机（不跑 `tauri dev`），右键、确认框、滚动不动这几样留给 JC 验收。
