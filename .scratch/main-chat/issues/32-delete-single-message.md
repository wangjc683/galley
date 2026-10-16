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
- **确认框**：`ui/confirm-action-dialog.tsx` 的 `ConfirmActionDialog`，确认键点一下（长按 5 秒只给波及这一条以外的动作，`docs/design/overlays-and-settings.md` 长按那节最后一条）。文案（JC 待定，先用这版）：
  - 标题：「删除这条消息？」
  - 正文：「它之后也看不到这条了。已经发给模型服务商、记进长期记忆的收不回。」
  - 确认键：「删除」
  - 英文你写，同样两句。
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
