# 15 重置主对话：设置深处、长按 5 秒

Status: done（`71f2323e`–`8d7c655f` 六个提交，2026-10-14 合入本地 main，未推送；JC 真机验收待做，步骤见「验收」与 Comments）

来源：主聊天 PRD 裁决 59（2026-10-14，JC：「主对话是一个持续的、长久存在的。那如果用户想要删除某条信息，甚至整个主对话重置清空，是不是可以给用户这一个选项？……重置整个主对话的按钮应该要放的比较深，然后要多重防护」，按建议推进；确认方式 JC 由「输入『重置』」改为长按 5 秒）。依赖 02、06a。跨 Core 与 GUI。

## 目标

给用户一个藏得深、不会误触的出口：主对话清空，从问候重新开始，引擎的长期记忆回到刚装好时。这是数据出口，不是整理上下文的手段：日常仍然没有重开键（裁决 14 不翻，上下文由切段承接）。

## 已定（JC 2026-10-14）

1. 不做删单条消息（进 `docs/devlog/deferred.md`「主对话里删单条消息」）。
2. 重置 = 清空主对话 + 长期记忆回到出厂，一个动作，不给勾选。
3. 入口：设置 → 运行环境 → 更多，最后一行「重置主对话」；只在内置运行时且有主对话时出现。
4. 防护：藏在「更多」；有对话在跑时不可用；弹窗写清删什么、留什么、收不回什么；长按 5 秒确认（按钮内进度），不做撤销。
5. 迁移前的自动备份一起删；删完整理数据库。
6. 不进 CLI、socket、Agent API、手机协议；模型触发不了。
7. `model_responses/` 不删（JC 原话：「翻旧对话的原始日志我觉得没有啥问题」），弹窗文案用 A 版：「会删除」第一条说「聊天记录」，「不会删除」加内核运行日志一条（见下「界面」）。

## 范围

**Core（Rule 5：业务在 Core）**

新 Tauri 命令 `reset_main_chat`，只给桌面用。参数：界面语言（选新问候，同 `get_or_create_main_chat`）。返回新主对话的 brief。

- **前置检查**（Core 自己判，不信界面）：内置运行时正在用、主对话存在、没有任何对话在跑（与切换运行模式同一个判据，回报用的是哪个）。不满足时返回能区分的错误：在跑 / 不是内置运行时 / 没有主对话。
- **顺序**：
  1. 关掉主对话和它还没升级的子任务的 runner。主对话的 runner 空闲时也活着，当前这一段的上下文在它内存里。
  2. 一个事务里删：主对话这一行、它还没升级的子任务（连同它们的消息）、主对话的消息、分段、派活记录、附件记录；全文索引跟着清（核对触发器是否已经处理）。已升级的子任务是普通对话，留下（核对父会话外键是 `SET NULL`）。
  3. 删掉这些消息的附件文件。
  4. 用现有建主对话的路径建新的，带问候（界面语言）。
  5. **长期记忆**：`managed-ga-state/memory/` 换成出厂那份。先把它改名挪开，再用安装时的种子（`managed-ga/state-seed/memory/`，拷贝逻辑在 `core/src/managed_runtime.rs`）拷进空目录，成功后删掉挪开的那份；拷贝失败就挪回来，整个命令报错。`temp/`（它替用户做出来的文件）不动。`model_responses/` 查一下有没有能按会话认出的主对话日志：认得出就一起删，认不出就不动，在回报里写明。
  6. 删掉全部迁移前备份 `app.galley.backup.*`（`core/src/migration_backup.rs`）。
  7. 数据库 `VACUUM`。
  8. **广播**：旧主对话与子任务的删除、新主对话的建立，界面与手机都要收到（照现有永久删除与建会话的事件；手机端的过滤规则照旧）。
- **其他引用主对话 id 的地方**：桌宠绑定、prefs 里记的会话 id 等，查一遍；指向旧主对话的改成新的或清掉，回报清单。
- **外置运行时**：命令直接拒绝，不碰任何外置 GA 文件（Rule 1）。
- **测试**（全部用临时目录，绝不碰真实数据目录）：删除范围（主对话、未升级子任务及其消息、附件文件、分段、派活记录）与保留范围（已升级子任务、其他会话、`temp/`）；新主对话带问候；`memory/` 回到种子（多出来的文件没了、种子文件都在、`global_mem*` 没了）；拷贝失败时 `memory/` 原样；在跑时拒绝；外置时拒绝；迁移备份删掉；广播。

**界面**

- **入口行**：设置 → 运行环境 → 更多，最后一行「重置主对话」，导航行（尾部 arrow），说明「清空主对话和它的长期记忆，回到刚装好时」。只在内置运行时且有主对话时渲染。有对话在跑时禁用，说明换成「有对话正在运行，结束后才能重置主对话」（照设置向导的写法）。
- **确认弹窗**（压过设置 modal 的二级层，`z-60`；能复用 `gui/src/components/ui/confirm-action-dialog.tsx` 就复用，确认键换成长按的那颗）：
  - 标题「重置主对话？」
  - 正文「主对话会清空，从问候重新开始；它记住的关于你的事、学会的做事方法也会清掉，回到刚装好时。」
  - 「会删除」：主对话的聊天记录，包括它派出去、还没变成普通对话的子任务和附件；它的长期记忆（所有对话和 IM 共用，其他对话里的它也会一起忘）；迁移前的自动备份。
  - 「不会删除」：其他对话和 IM 里接回的对话（还在侧栏里，它以后翻历史仍可能读到）；它替你做出来的文件；内核的运行日志（30 天后自动清掉，这之前它翻历史仍可能读到）；模型、渠道和其他设置。
  - 末行「已经发给模型服务商的内容收不回来。」
  - 按钮：「取消」（默认聚焦）+「按住 5 秒重置」。
- **长按按钮**：
  - 按下开始，按钮内从左到右填充（error 色），线性，5 秒填满即执行。
  - 松手、指针移出按钮、窗口失焦、按 Esc：取消，填充约 200ms 退回。
  - 不到 5 秒就松手：按钮下出一行「要按住不放」。
  - 回车、空格都不触发（鼠标优先，`docs/design/layout-and-chrome.md`「交互输入模型：鼠标优先」；确认弹窗回车不误触的规矩）。
  - 执行中按钮写「正在重置…」并禁用；成功后关弹窗、关设置、落到新主对话（`openMainChat`）；失败在弹窗里写原因（在跑 / 其他），带「复制详情」。
  - 弹窗开着时有对话开始跑：按钮禁用并写原因。
  - `prefers-reduced-motion` 下进度照常显示：它是状态，不是装饰。
- **前端状态**：移除旧主对话与子任务（会话、消息、子任务卡片的派活记录），加入新主对话并激活。
- 中英两版文案，写进 `docs/copy-language-guidelines.md`。
- **测试**：行的显隐与禁用；弹窗文案；长按（假时钟：不到 5 秒松手不调用、满 5 秒调用一次、移出取消、短按出提示、回车与空格不触发）；成功后落到新主对话。

**文档**

- `docs/design/overlays-and-settings.md`：运行环境「更多」加这一行；长按确认作为「做了收不回」的确认方式写进确认弹窗一节（目前只这一处用）。
- `docs/design/layout-and-chrome.md`「有主对话时」：补一句重置在设置深处，写清与裁决 14 的关系。
- `docs/managed-ga-runtime/code-state-and-patches.md`：`memory/` 只有一条路径会整个改写：用户在设置里重置主对话时回到种子；升级仍然不覆盖。
- 动手前查 `docs/design/` 里确认弹窗、按钮、进度相关的「不要 / 有意 / 分叉」。

**外置运行时零变化**（没有主对话，入口行不渲染，命令拒绝）。

## 不做

- 删单条消息（deferred）、撤销重置、重置前导出、CLI 或模型触发、外置运行时的重置。

## 验收

- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区与 `TZ=UTC`）；`pnpm --dir gui typecheck`、`lint`、`test`（`TZ=UTC`）；六个门禁脚本；`git diff --check`；全角标点自查。
- 格式化只动自己的文件或 hunk（core 不是 rustfmt-clean，gui 不是 prettier-clean）。
- 给主会话的真机复现步骤。注意 tauri dev 用的是真实数据目录：真机走一遍会清掉 JC 真实的主对话、引擎记忆和迁移备份，走之前先备份：`sqlite3 workbench.db ".backup '<目标>'"` 做在线一致快照（不用退出 dev），再拷贝 `managed-ga-state/memory/`；想留迁移备份就把 `app.galley.backup.*` 挪走。
  1. 在主对话里说一句能被记住的话；
  2. 设置 → 运行环境 → 更多 → 重置主对话；
  3. 点一下看提示，按住两秒松手看退回；
  4. 按满 5 秒，落到新主对话、只有问候；
  5. 确定式核对：
     - 重置前（第 2 步之前）只读地列出 `managed-ga-state/memory/` 里有哪些文件；
     - 重置后再列一次，对照 `managed-ga/state-seed/memory/`：应正好是种子里的文件，加上引擎按模板重建的 `global_mem.txt`、`global_mem_insight.txt`（重置后几秒内出现）；
     - 可选：问它刚才那句话。它要是说从日志里找到了那句话，属于预期（内核运行日志留 30 天，见「已定」第 7 条）。

## Comments

2026-10-14 实现回报（子代理实现，分支 `reset-main-chat-15`，基于 `9386b57a`，三个提交：`71f2323e` Core、`067831b4` 界面、文档与本条一个提交）：

- **改动文件**：
  - Core：新 `core/src/main_chat_reset.rs`（编排与拒绝）、`core/tests/main_chat_reset_test.rs`；`core/src/commands/session.rs`（Tauri 命令 `reset_main_chat`）、`core/src/lib.rs`（注册）、`core/src/db/main_chat.rs` 与 `db/mod.rs`（事务删除、整理数据库）、`core/src/managed_runtime.rs`（`memory/` 换回种子，分阶段、可回滚）、`core/src/migration_backup.rs`（删全部迁移备份，与裁剪共用列举）、`core/src/session_writes.rs`（删除广播抽成函数）。
  - 界面：新 `gui/src/lib/hold-to-confirm.ts`（计时与规则，不碰 DOM）、`gui/src/components/ui/hold-to-confirm-button.tsx`、`gui/src/components/screens/settings/runtime/ResetMainChatAccess.tsx`（行与弹窗）、`gui/src/lib/main-chat-reset.ts`（调 Core、清前端状态、落到新主对话），各带测试；`confirm-action-dialog.tsx`（正文 `<p>` 改 `<div>`，加 `confirmSlot`、`className`、`onEscapeKeyDown`）、`stores/subtasks.ts`（`forgetSessions`）、`AdvancedRuntimeSettings.tsx`、`runtime/types.ts`、`SettingsRuntime.tsx`、`Settings.tsx`、`SettingsHost.tsx`、中英 locale。
  - 文档：`docs/design/overlays-and-settings.md`（「更多」加一行；新立「确认弹窗」一节，长按确认写成规则；Data tab 补一句）、`docs/design/layout-and-chrome.md`「有主对话时」、`docs/managed-ga-runtime/code-state-and-patches.md`、`docs/copy-language-guidelines.md`（中英文案表）。没动 `cli/`、`remote-protocol/`、`docs/agent-api/`，没加迁移。
- **与票的出入**：
  1. 顺序：先把 `memory/` 分阶段换好（旧的改名挪到同级 `memory.reset-<时间>`，种子拷进新目录），再跑删除事务，事务提交后才删挪开的那份。票里是先删行、再换记忆。这样拷贝失败或事务失败时什么都没变（记忆挪回、行没删），不会出现「对话清了、记忆还在」的半截重置。
  2. 广播：事务一提交就发删除（每个被删会话一条 `session-deleted-external`），再照现有建主对话的路径建新的（它自己发 `session-created-external`）。先删后建，界面与手机不会同时有两条主对话。附件、备份、整理数据库放在建好之后。
  3. 整理数据库：`VACUUM` 之外加了全文索引的 `optimize` 与 `wal_checkpoint(TRUNCATE)`。只 `VACUUM` 的话，WAL 与索引旧段里还留着删掉的文字。有一条测试直接读库文件字节，确认删掉的文字不在了（去掉整理这一步它就挂）。
  4. 错误：不进 `GalleyError`（那是 CLI 的稳定错误标识），另起 `{"error": "running" | "not_managed" | "no_main_chat" | "failed", "detail": …}`；界面把 `running` 和其余分开写。
  5. 按住时按 Esc：只取消这次按住，弹窗留着，再按一次才关（票只说 Esc 取消、填充退回）。
  6. 复用了 `ConfirmActionDialog`，确认键换成长按按钮。「要按住不放」绝对定位在按钮下，弹窗底部多留 8px（`pb-7`），按住时界面一动不动：按钮在指针下挪开就等于替用户松了手。退回用 `--motion-base` 160ms（票写约 200ms，新代码不写时长字面量）。
  7. 「复制详情」是这个弹窗自己的文案键：现有 `errors.copyDetails` 在中文 locale 里是英文「Copy details」，没动它。
- **外置运行时零变化**：行不渲染，命令先查运行模式、直接拒绝（`not_managed`），不读不写任何外置 GA 文件（Rule 1）。
- **「在跑」判据**：Core 的运行闸，对 RunnerManager 知道的所有会话看 `open_run || agent_running`（`session.run_state` 里的这两项）；界面一侧行与按钮的禁用沿用设置向导、切换运行模式用的 `hasRunningSessions`（消息 store 里有 `agentRunning`）。没用 `session.run_state` 的 `busy`：它还算 `queuedCount > 0`，崩溃后被扣住的队列、提问后面排着的消息都不是在跑，算进去会让重置一直被拒，弹窗却说「有对话正在运行」。被删会话里排着的消息（没发出的草稿）随它丢掉。**IM 渠道的回合不算在内**：渠道在自己的进程里跑引擎，不经过 RunnerManager，Core 看不到它们在不在跑。
- **`model_responses/`**：认不出主对话的日志，没动。文件名是每个引擎进程一个的随机 6 位数（`model_responses_<logid>.txt`），Galley 的 runner 不记会话对应哪个文件；内容里的会话 id 只有部分模型客户端会随系统提示记下（原生工具客户端只记用户与工具内容），别的对话也可能因为用 CLI 查过主对话而带着这个 id；IM 渠道还靠自己的日志接回上下文。按 id 搜内容来删，删漏、误删都会有。这些日志照旧按 30 天 / 500 MB 修剪。JC 10-14 裁定新主对话翻旧日志没问题（「翻旧对话的原始日志我觉得没有啥问题」），弹窗「不会删除」改用 A 版，写明内核运行日志留 30 天、这之前它翻历史仍可能读到。
- **引用主对话 id 的其他地方**：
  - 库里：消息、工具事件、附件行、分段、以它为父的派活记录都是 CASCADE；全文索引没有触发器，事务里显式删；已升级子任务的 `parent_session_id`、`scheduled_tasks.last_run_session_id`、退役 Goal 表与 native memory 表里的会话引用都是 SET NULL。prefs 里没有记会话 id 的键（Core 与界面的键都查过）。
  - Core 内存：主对话与子任务的 runner 关掉（事务后再关一遍，防中间插进来的发送起了新的）；它们在 RunnerManager 里的队列条目留着，是空闲的；子任务派活的进程内认领集合、runner 单飞槽是无害的残留。
  - 界面内存：会话列表与激活指针、消息、子任务卡片的派活记录与运行错误、桌宠绑定（`petAttachedSessionId` 与待迁移目标）、输入框里没发出的草稿，都清掉。没清的：runtime store 里旧 id 的 bridge 状态（已是 closed）、队列 store 的空快照，与现有永久删除一样。
  - 桌宠子进程挂在 runner 上，随 runner 关掉。浏览器存储只存主题，没有会话 id。
- **手机**：走现有事件，不加协议：旧主对话与它的子任务各一条 `session.deleted`（没升级的子任务手机本来看不到，照现有过滤只在没缓存成「不显示」时转发），新主对话一条 `session.created`。手机协议里还没有「主对话」，对手机来说是列表里少了一条、多了一条。
- **验证**：`cargo test --manifest-path core/Cargo.toml --workspace` 本机时区与 `TZ=UTC` 各 931 个通过（33 组；新增 `main_chat_reset_test.rs` 10 个、`managed_runtime` 单元 5 个、`migration_backup` 单元 1 个）；`pnpm --dir gui typecheck`、`lint` 通过；`TZ=UTC pnpm --dir gui test` 116 个文件 1139 个通过（新增 `hold-to-confirm` 14 个、`ResetMainChatAccess` 12 个、`main-chat-reset` 5 个）；六个门禁脚本、`git diff --check` 通过；全角扫描只报英文注释里夹中文词的行。Rust 只格式化了自己的文件（`lib.rs` 的 rustfmt 差异是原有的模块排序）；界面新文件整篇 prettier，旧文件只管自己的 hunk。
- **反向检查**（改坏 → 对应测试挂 → 恢复，文件逐字节比对过）：拷贝失败不回滚 `memory/`（单元、集成各挂 1）；去掉在跑拒绝；去掉外置拒绝；事务只删主对话、不删子任务；不删迁移备份；挪开的旧记忆不删；`memory/` 根本不换（以上各挂 1）；去掉整理数据库（读文件字节那条挂）；长按一松手就执行（挂 4）；计时器提前触发且不看时间戳（挂 4）；按钮多一个 click 处理（挂 1）；移出按钮不取消（挂 1）；有对话在跑时长按按钮不禁用（挂 1）；外置也显示这一行（挂 1）；成功后不清前端状态（挂 2）。
- **真机复现**（tauri dev 用真实数据目录：走一遍会清掉 JC 真实的主对话、引擎长期记忆和迁移备份）：
  0. 备份（不用退出 tauri dev）：在 `~/Library/Application Support/app.galley/` 下用 `sqlite3 workbench.db ".backup '<目标>'"` 做在线一致快照，再拷贝 `managed-ga-state/memory/`；主对话的附件在 `conversation-attachments/<主对话 id>/`，要留也拷走；想留迁移备份，把同级的 `app.galley.backup.*` 挪走。合入后重启 `pnpm --dir gui tauri dev`（Core 是 Rust，不热更）。
  1. 在主对话里说一句能被记住的话，并让它记进长期记忆（如「记住：我最喜欢的茶是凤凰单丛，记到长期记忆里」）。跑完只读地列出 `managed-ga-state/memory/` 里有哪些文件，留作对照（这句多半记在 `global_mem.txt`）。
  2. 设置 → 运行环境 → 更多，最后一行「重置主对话」。有对话在跑时这一行是灰的，说明换成「有对话正在运行，结束后才能重置主对话」；切到外部 GA 时这一行不出现。
  3. 点一下「按住 5 秒重置」：按钮下出「要按住不放」。按住两秒松手：填充退回。按住时把指针移出按钮，或按 Esc：也退回（Esc 时弹窗还在，再按一次才关）。
  4. 按满 5 秒：按钮写「正在重置…」，随后弹窗与设置关掉，落到新主对话，只有问候。
  5. 确定式核对：重置后再列一次 `managed-ga-state/memory/`，对照 `managed-ga/state-seed/memory/`：应正好是种子里的文件，加上引擎按模板重建的 `global_mem.txt`、`global_mem_insight.txt`。可选：问它刚才那句话；它要是说从日志里找到了那句话，属于预期（内核运行日志留 30 天）。
  6. 顺手看：两个 `global_mem*` 文件在重置后几秒内出现（Core 在后台起了新主对话的 runner）；`managed-ga-state/` 下没有 `memory.reset-*`；`app.galley.backup.*` 没了；`temp/` 里的文件还在；升级过的子任务还在侧栏。
- **需要重点审的风险**：
  1. （审查后已修）GA 只在 runner 启动时按模板写 `global_mem.txt`、`global_mem_insight.txt`，而其他还活着的 runner 与 IM 进程每轮都重读：在下一个 runner 起来之前，它们的回合没有记忆说明（GA 的 `get_global_memory()` 吞掉 FileNotFoundError），模型这时若自己写出 `global_mem_insight.txt`，GA 以后就不再按模板重建。现在重置成功后 Core 立刻在后台起新主对话的 runner（走 `ensure_session_runner` 的共用路径，界面靠 `runner-spawned-external` 接上），两个文件几秒内回来；Core 不自己写它们。起 runner 失败只记日志、不影响重置的返回，那时窗口照旧开着，直到下一个 runner 启动。其他 runner 进程里的上下文仍可能带着之前从记忆里读到的东西（照票只关主对话与它子任务的 runner）。
  2. IM 回合 Core 看不到：IM 正在写记忆时重置，macOS 上改名照样成功，写入可能落进挪开的那份（随后删掉）或新的种子目录，可能把一部分旧记忆写回新目录；Windows 上有文件占用时改名会失败，整个命令报错、什么都没删。只写进 `code-state-and-patches.md` 的已知限制，不加机制，界面不提。
  3. 关 runner 不会误报崩溃（审查后核实）：`shutdown` 与 `kill` 都先设 `expected_close`（`core/src/runner_manager/process.rs:601`、`626`），退出监视在它为真时报 code 0、不带 signal（`process.rs:391`）；界面的 `onClose` 只在 code 不为 0 时弹「Bridge 进程崩溃」、调 `notifySubtaskRunnerCrash`（`gui/src/stores/runtime/bridge-slice.ts:409`）。另外两条会发「子任务出错」的路径（派活失败记录、runner 的 `error` 事件）关 runner 都不触发。唯一的例外是等子进程时 `try_wait` 本身报错，与超时无关，那时报 code null。剩下的代价只是慢：几个 runner 并发关，优雅退出最多等 3 秒、再强杀最多等 5 秒，「正在重置…」会多停这么久。
  4. 提交后的清理只记日志：挪开的旧记忆、附件目录、迁移备份删不掉时，旧数据还留在盘上（`memory.reset-*` 还会被以后的迁移备份带进去）；整理数据库失败同理。建新主对话失败是提交后唯一会返回的错误，弹窗写「没能重置主对话」，要等下次 `get_or_create_main_chat`（启动、切回内置）才有主对话。
  5. 旧主对话的模型调用日志照旧留在 `temp/model_responses/`（最多 30 天 / 500 MB），引擎的 `[Peer]` 提示允许它读近期日志，新主对话可能翻到旧内容。JC 10-14 裁定没问题，弹窗 A 版已写明（「内核的运行日志（30 天后自动清掉，这之前它翻历史仍可能读到）」）。
  6. `ConfirmActionDialog` 的确认控件改成「按钮 | 自定义控件」二选一，正文由 `<p>` 改 `<div>`，现有调用方 typecheck 通过、视觉应无变化，值得在真机上扫一眼渠道解除接入等弹窗。
  7. `VACUUM` 与索引 `optimize` 在大库上要持有写锁几秒；此时没有对话在跑，但定时任务正好触发的话要等锁（busy_timeout 5 秒，等不到会失败）。
  8. 本票 Status 行与 PRD 票表没改，留给主会话审完合入时改。

2026-10-14 审查后补改（子代理实现，同一分支，三个提交：`5020feb8` 重置后起新主对话的 runner、`7d901ae9` 弹窗 A 版文案、文档与本条一个提交）：

- **A 起 runner**：建好新主对话后，Core 走 `ensure_session_runner` 的共用路径给它起 runner（`via: "main-chat-reset"`，界面靠 `runner-spawned-external` 接上），让 GA 自己的启动代码按模板写回两个 `global_mem*` 文件；Core 不复刻 GA 的初始化。放在后台任务里、不等它：「正在重置…」不变长，起 runner 失败或卡住只记日志，重置照样算成功。接口是 `RunnerStarter`，测试用假实现看请求：成功时恰好一次、拒绝与失败时没有、起 runner 失败或卡住都不拖住重置（新用例，10 秒超时内返回）。反向检查：去掉这一步，挂 2 条（主用例与新用例）。上面风险 1 已改写。
- **B 文案**：中英弹窗改用 A 版，「不会删除」变四条；`copy-language-guidelines.md` 表格与「说『它』『长期记忆』；指引擎本身时用『内核』，不说 GA」同步，注明中文加了 A 版修改；`overlays-and-settings.md` 改为「会删除」三条、「不会删除」四条；`code-state-and-patches.md` 写明日志留 30 天、新主对话可能读到、JC 裁定不删。文案测试同步，另补一条英文断言。
- **C 风险 3**：核实后改写（见上），关 runner 不会误报崩溃，也不会发「子任务出错」。
- **D 正文**：「已定」加第 7 条；「界面」两个列表改成 A 版；验收的备份改用 `sqlite3 ... ".backup"` 在线快照，第 5 步换成确定式核对；上面的真机复现步骤 0、1、5、6 同步。
- **E**：IM 并发写记忆只写进 `code-state-and-patches.md` 的已知限制，不加机制，界面不提。
- **验证**：`cargo test --manifest-path core/Cargo.toml --workspace` 本机时区与 `TZ=UTC` 各 932 个通过（33 组）；`pnpm --dir gui typecheck`、`lint` 通过；`TZ=UTC pnpm --dir gui test` 116 个文件 1140 个通过；六个门禁、`git diff --check` 通过；全角扫描 0 行。
