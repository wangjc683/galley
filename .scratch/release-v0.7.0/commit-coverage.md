# v0.7.0 提交覆盖审计

范围：`git log v0.6.2..HEAD`，HEAD = `04380be1`，共 684 个提交（含 22 个合并提交）。

做法：逐个提交按改动路径分类（只动 `docs/`、`.scratch/`、`*.md` 的算纯文档），再对其余 244 个提交逐条读标题、必要时读正文与代码，归到 release notes 的条目或写明省略理由。纯文档提交另查了是否有文档被打进 app：只有 `docs/integrations/galley-supervisor-sop.md` 与 `galley-supervisor-reference.md`（`core/src/sop_install.rs` 用 `include_str!`），区间内只动它们的纯文档提交是 `7ebbf696`，归到 F2，放在第一张表里。

取数说明：起草时本机仓库目录的读权限中途失效（`Operation not permitted`），审计在 GitHub `main` 的克隆上做，克隆 HEAD 为 `a4a9c643`；本地多出的 `04380be1` 读不到内容，按标题判为纯文档（发版规则），待 `git show --stat 04380be1` 复核。

只写区间终点的真实状态：中间形态、试验、加了又撤的，都在下表写明省略理由。

## 条目对照

| 编号 | release notes 条目 |
|---|---|
| E0 | 开头两段：形态变化（只跟一个人说话、它带团队、事事交代）；外部 GA 意味着什么；渠道对话各归各 |
| A1 | 主对话卡片与侧栏：会动的脸、第二行、工作台分隔线、⌘\ 收起 |
| A2 | 主对话的聊天软件画法：气泡、输入中气泡、居中时间、悬停动作、过程卡片、删单条可撤销 |
| A3 | 4 小时分段带最近 10 轮；回头翻历史；重置主对话 |
| A4 | 子任务与闭环：卡片、「Galley ›」、叫醒验收、打回、提问先到助理、通知 |
| A5 | 助理替你管 Galley |
| A6 | 待办与提醒：自己判断记不记、跟进、记住回绝、到点说有用的话 |
| A7 | 待办按钮与待办面板 |
| A8 | 主动做事与每天「过一遍在办的事」 |
| A9 | 文件卡片；文档用默认应用打开 |
| F2 | 移除 Goal |
| B1 | 工作台对话改用主对话的写法（两种运行时） |
| B2 | 草稿留存、引用、点击不失焦、平滑滚动遵循减弱动态效果 |
| B3 | 所有输入框一行；强度列表最高档在前 |
| B4 | ⌘F 在当前对话里查找；标题菜单「查找聊天记录…」 |
| B5 | 历史每次加载 50 轮 |
| B6 | 答案只在收尾摘要里时显示摘要 |
| C1 | Sign in with ChatGPT 取代 Codex CLI 登录 + 升级提示 |
| C2 | 订阅模型的 ChatGPT 标志与订阅报错按钮 |
| C3 | 设置 → 模型：连接方式小字、「添加」直达列表、免密钥服务商能保存 |
| D1 | 微信对齐桌面 |
| D2 | Telegram / Discord 的「过程」按钮 |
| D3 | 飞书第一轮对齐 |
| F1 | 新应用图标与助理头像 |
| F3 | 内置 GA 顶栏去掉 Supervisor SOP 图标 |
| F4 | 按下 / 展开动效、设置侧栏间距、表格短词不拆 |
| U1 | Under the Hood：Agent API schemaVersion 3 与新增命令、字段 |
| U2 | Under the Hood：内置 GA 基线（TODO GA baseline 占位）与 v0.6.x 换模型丢提示词的修复 |
| U3 | Under the Hood：外部 GA 重建客户端后重新应用强度与图片 |
| U4 | Under the Hood：登录用的一次性回环监听 |
| U5 | Under the Hood：runner 由 Core 启动并恢复历史；CLI 对话自动起标题 |
| U6 | Under the Hood：迁移 043–052、自动备份、退回 v0.6.x；Goal 记录留着不读 |
| U7 | Under the Hood：删对话时一并删搜索索引里的文字 |

| 省略代码 | 含义 |
|---|---|
| X-试验 | 临时切换器或试验形态，区间内已拆 |
| X-撤回 | 区间内加了又撤：事项账本、设置 → 记忆（主对话 PRD 裁决 49） |
| X-取代 | 被区间内后续提交取代的中间形态（说明列写取代者） |
| X-远程 | 远程访问与手机端：release workflow 没有设 GALLEY_REMOTE_RELAY_URL，发布构建里远程模块不启用、「手机」页不显示；relay 与 iOS 不随 app 发 |
| X-内部 | 内部重构、共用函数或注释，用户无感 |
| X-测试 | 纯测试 |
| X-开发 | 开发工具、README 与截图种子（README 随发版推送，不进 notes） |
| X-文档 | 纯文档：docs/、.scratch/、设计稿、devlog、补丁台账；不进 app |

## 一、改到代码或随包内容的提交（245 个）

| 提交 | 日期 | 标题 | 归属 | 说明 |
|---|---|---|---|---|
| `a2e13528` | 2026-10-10 | Align the WeChat conversation with the desktop run view | D1 |  |
| `0df5de5c` | 2026-10-10 | Core ensures session runners through one shared path (ticket 02a) | U5 |  |
| `1ab69b51` | 2026-10-10 | Core replays session history before a runner takes a turn (ticket 02b) | U5 |  |
| `8d9bd79e` | 2026-10-10 | GUI and phone send through Core (ticket 02c) | U5 | 窗口发送改走 Core；界面行为不变 |
| `377d96c1` | 2026-10-10 | Every session, project and schedule write is broadcast by Core (ticket 02d) | X-内部 | 为手机端广播桌面写入；界面行为不变 |
| `01d67d44` | 2026-10-10 | Give Core what the phone's remote module needs (ticket 05c) | U6 | 迁移 043；其余为手机端地基（X-远程） |
| `4b53f751` | 2026-10-10 | Add the remote-protocol crate shared by Core, relay and app (ticket 05a) | X-远程 |  |
| `28601618` | 2026-10-10 | Add the relay that forwards ciphertext between Core and phones (ticket 06a) | X-远程 | relay 服务端，不随 app 发 |
| `8fb2601b` | 2026-10-10 | Add the Swift side of the remote protocol on CryptoKit (ticket 07a) | X-远程 | iOS 端，未发布 |
| `ee3ea6c2` | 2026-10-10 | Connect Core to paired phones through the relay (ticket 05b) | X-远程 |  |
| `1e483880` | 2026-10-10 | Send pushes to APNs from the relay and test the chain end to end (ticket 06b) | X-远程 | relay 推送 |
| `dc15ccdb` | 2026-10-10 | Add the Settings Phone page for pairing iPhones (ticket 05d) | X-远程 | 没有中继地址时不显示「手机」页 |
| `67c9cd93` | 2026-10-10 | Space the Settings sidebar tabs evenly | F4 |  |
| `98547789` | 2026-10-10 | Pair only once the first phone connects (ticket 05d) | X-远程 |  |
| `78287768` | 2026-10-10 | Give the pairing-timeout test room on slow runners | X-测试 |  |
| `034b9169` | 2026-10-12 | Add the main chat and its A1/A2 sidebar trial (ticket 02) | A1 | 主对话本体（迁移 044 → U6）；A1/A2 侧栏试验部分后被拆 |
| `82e1d674` | 2026-10-12 | Add the affairs ledger's background mining (ticket 01) | X-撤回 | 事项账本 |
| `938fe0eb` | 2026-10-12 | Add A3 and copy pairs to the main chat sidebar trial | X-试验 |  |
| `6df6ec44` | 2026-10-12 | Trial the sectioned sidebar B and collapsible B' (ticket 07) | X-试验 |  |
| `a3d7254b` | 2026-10-12 | Make the sectioned, collapsible sidebar permanent (ticket 08) | A1 | 保留的是 ⌘\ 收起侧栏；分区形态被 21a0487a、9a9565b1 取代 |
| `c242e9b1` | 2026-10-12 | Trial three ways to make 其他对话 own its list (ticket 09) | X-试验 |  |
| `c6db1c6f` | 2026-10-12 | Trial an always-on divider under the main chat row | X-试验 |  |
| `fcdfec4a` | 2026-10-12 | Trial three weights for the main chat divider | X-试验 |  |
| `0537f1d7` | 2026-10-12 | Settle the 其他对话 section on C3 with a strong divider (ticket 09) | X-取代 | 「其他对话」分区头 10-14 随 21a0487a 撤掉 |
| `5fcb4758` | 2026-10-12 | Fade rows under the stuck 其他对话 header | X-取代 | 同上 |
| `d2443281` | 2026-10-12 | Cut the main chat into segments and inject ongoing affairs (ticket 03a) | A3 | 分段（迁移 046 → U6）；注入事项随账本撤掉 |
| `b615ff96` | 2026-10-12 | Let the main chat look up its earlier segments through the CLI (ticket 03b) | A3 | 翻更早的历史；CLI 新参数 → U1 |
| `2b9d985d` | 2026-10-12 | Give the affairs ledger a switch, a read cap and the Memory page's Core (ticket 04a) | X-撤回 | 事项账本与记忆页 |
| `a90a15d9` | 2026-10-12 | Delete mining sessions after each run and roll back failed runs (ticket 04a) | U7 | 账本部分已撤；留下的是删会话时一并删 messages_fts |
| `d4103c38` | 2026-10-12 | Add the Settings → Memory page and its entry points (ticket 04b) | X-撤回 | 设置 → 记忆 |
| `2a9856cb` | 2026-10-13 | Greet in the new main chat and turn the ledger on by default (ticket 04c) | A2 | 新主对话的问候；账本默认开随账本撤掉 |
| `68da7afc` | 2026-10-13 | Build the memory fixture's run times in the local zone | X-撤回 | 记忆页测试数据 |
| `24a5d9a7` | 2026-10-13 | Say the ledger reads only what is newly said | X-撤回 | 事项账本 |
| `dd66c466` | 2026-10-13 | Say in the greeting that later passes read only what is new | X-取代 | 问候句被 115a55b5 重写 |
| `b9c5aa39` | 2026-10-13 | Keep emotions inside their affairs and drop the ledger's opt-outs (ticket 04d) | X-撤回 | 事项账本 |
| `2b17e284` | 2026-10-13 | Simplify the Memory page to three areas (ticket 04d) | X-撤回 | 设置 → 记忆 |
| `fa6f9127` | 2026-10-13 | Remove the affairs ledger from Core (ticket 10) | X-撤回 | 撤掉区间内加的账本（迁移 047 → U6） |
| `93f2f2d6` | 2026-10-13 | Remove Settings → Memory and its entry from the GUI (ticket 10) | X-撤回 | 设置 → 记忆 |
| `b9c1eef8` | 2026-10-13 | Open a new main chat segment with the last turns before it (ticket 11) | A3 | 新一段带上前几轮；条数与字数后由 c266b00e 定为 10 轮、1.5 万字符 |
| `0d086e2a` | 2026-10-13 | Read conversations a page of whole turns at a time in Core (ticket 12) | B5 |  |
| `53f95367` | 2026-10-13 | Page conversation history in the GUI (ticket 12) | B5 |  |
| `db3954fe` | 2026-10-13 | Drop the unpaged session_message_rows command and fix comments tickets 11–12 outdated | X-内部 | 删掉无分页的内部命令 |
| `0cec6d94` | 2026-10-13 | Give the main chat an entry layer (ticket 03d) | A2 | 入口层（按话的分量回复），提示词，细节并入 |
| `0366baf9` | 2026-10-13 | Dispatch the main chat's subtasks in Core (ticket 06a) | A4 | 迁移 048 → U6 |
| `8fbeab66` | 2026-10-13 | Show the main chat's subtasks as cards in the GUI (ticket 06a) | A4 |  |
| `248e8d09` | 2026-10-13 | Remove Goal from Core, CLI, GUI, runner and the remote protocol | F2 | 同时 → U1（schemaVersion 3）、U6（Goal 表留着不读） |
| `7ebbf696` | 2026-10-13 | Retire Goal in the docs and Supervisor SOP; record the removal | F2 | 随包的 Supervisor SOP 与 reference 文本去掉 Goal（`core/src/sop_install.rs` 用 `include_str!` 打进 app）；→ U1 |
| `27635f3a` | 2026-10-14 | Trial three new-chat placeholders in the sectioned sidebar (ticket 13) | X-试验 |  |
| `c1d80050` | 2026-10-14 | Press the + that opened a new chat instead of a placeholder row (ticket 13) | X-取代 | 按下的 ＋ 被 21a0487a 撤掉 |
| `76820c32` | 2026-10-14 | Trial what the main chat row's second line says at rest (ticket 14) | X-试验 |  |
| `f0df07df` | 2026-10-14 | Say only a state on the main chat's row (ticket 14) | X-取代 | 卡片第二行规则被 21a0487a 改写 |
| `71f2323e` | 2026-10-14 | Reset the main chat in Core: rows, memory, backups (ticket 15) | A3 |  |
| `067831b4` | 2026-10-14 | Reset the main chat from Settings with a five-second hold (ticket 15) | A3 |  |
| `5020feb8` | 2026-10-14 | Start the new main chat's runner right after a reset (ticket 15) | A3 |  |
| `7d901ae9` | 2026-10-14 | Use JC's A wording in the main chat reset dialog (ticket 15) | A3 |  |
| `1f721ed2` | 2026-10-14 | Hide the question rail in the main chat (main chat ruling 60) | A2 | 主对话不显示问题导轨，细节并入 |
| `847be65f` | 2026-10-14 | Trial the assistant and workbench spaces shell (ticket 16) | X-试验 |  |
| `f704ff90` | 2026-10-14 | Correct the spaces trial's list of ways into a space (ticket 16) | X-试验 |  |
| `ed708645` | 2026-10-14 | Remove the spaces shell trial (ticket 16, ruling 62) | X-试验 |  |
| `d05558f3` | 2026-10-14 | Trial the assistant at the top of the sidebar (ticket 17) | X-试验 |  |
| `21a0487a` | 2026-10-14 | Settle the sidebar top on the assistant's card (ticket 18) | A1 |  |
| `932340c5` | 2026-10-14 | Read a fresh main chat's greeting back when it opens (ticket 18) | A2 |  |
| `a945378e` | 2026-10-15 | Trial the assistant's IM rendering: bubbles, process, time, scroll (ticket 19) | X-试验 |  |
| `01214080` | 2026-10-15 | Make the assistant's IM rendering final: C, one line, centred, bottom (ticket 20) | A2 |  |
| `dfd43968` | 2026-10-15 | Move the assistant's process into a hover button and say one running sentence (ticket 21) | A2 |  |
| `94cdb8a7` | 2026-10-15 | Open the assistant's process as a card: one line a step, eight lines tall (ticket 22) | A2 |  |
| `dba700ef` | 2026-10-15 | Draw the app icon from a vector master: the flat wooden robot G, on Apple's grid for macOS (ticket 23) | F1 |  |
| `e332b667` | 2026-10-15 | Give the assistant the app icon as its face: cropped to a circle, a 1px ring inside (ticket 23) | F1 |  |
| `01eb93ee` | 2026-10-15 | Document the app icon as the assistant's face and how the icons are made (ticket 23) | F1 |  |
| `4fc4ed53` | 2026-10-15 | Merge branch 'galley-icon-23': the new app icon and the assistant's avatar (ticket 23) | F1 | 合并提交 |
| `b11e0c3c` | 2026-10-15 | Queue the main chat's mid-run sends like any session's (ticket 24) | A2 | 运行中再发照常排队，细节并入 |
| `35709289` | 2026-10-15 | Centre the icon's figure on its canvas | F1 |  |
| `ef9fa3db` | 2026-10-15 | Trial the main chat's composer: today's card / one line (ticket 24) | X-试验 |  |
| `45c13508` | 2026-10-15 | Merge branch 'assistant-composer-24': the main chat's composer trial (ticket 24) | X-试验 | 合并提交 |
| `8ab04ea2` | 2026-10-15 | Make the main chat's composer one line, 24px off the bottom (ticket 25) | B3 |  |
| `3b029e56` | 2026-10-15 | Copy the user's own bubble by selection, not a hover chip (ruling 73, ticket 26) | X-取代 | 划选复制被 19b81836 的「复制 · 引用 · ⋯」取代 |
| `54b38805` | 2026-10-15 | Drop the assistant card's full-text hover title (ruling 75) | A1 | 细节并入 |
| `ffd7f9b2` | 2026-10-15 | Merge branch 'assistant-composer-25': the main chat's one-line composer (ticket 25) | B3 | 合并提交 |
| `139d7143` | 2026-10-15 | Put every session's composer on one line, the workbench's hint row under it (ticket 27) | B3 |  |
| `61fc3b15` | 2026-10-15 | Merge branch 'workbench-one-line-27': one-line composers in every session, popovers centred (ticket 27) | B3 | 合并提交 |
| `1c62fc4f` | 2026-10-15 | List the effort tiers highest first, 默认 next to the button (ruling 78) | B3 |  |
| `10654f6b` | 2026-10-15 | Let the GUI's message search keep to one conversation and date its hits (ticket 28) | B4 |  |
| `3ed02d9e` | 2026-10-15 | Find in the open conversation from the title menu and Cmd+F; reset the main chat from its menu (ticket 28) | B4 | 标题菜单的「重置主对话…」→ A3 |
| `7541197a` | 2026-10-15 | Merge branch 'header-menu-28': find in the conversation (Cmd+F, title menu) and reset the main chat from its menu (ticket 28) | B4 | 合并提交；→ A3 |
| `e5431849` | 2026-10-15 | Let the reply bubble grow with the wide reading width (ruling 79) | A2 | 宽阅读宽度下气泡随栏变宽，细节并入 |
| `115a55b5` | 2026-10-15 | Name the assistant's role: Galley, your personal assistant (assistant PRD ruling 7, main chat ruling 81) | E0 | 角色词「助理」、问候句、关于页中文副标题 |
| `146ab718` | 2026-10-16 | Give the assistant its manual and rewrite the dispatch clause; evaluate the wake wording (ticket 30) | A4 | 助理手册与派活条款；→ A5 |
| `edffc51d` | 2026-10-16 | Wake the assistant when its subtasks finish, ask or fail (tickets 29, 31) | A4 | socket ensureRunner → U1 |
| `154c55a5` | 2026-10-16 | Merge branch 'assistant-manual-30' into assistant-wake-29-31 | A4 | 合并提交 |
| `22a9b7d4` | 2026-10-16 | Integrate the closed loop: point the check at the instructions, align silent replies, record it (tickets 29-31) | A4 |  |
| `78194b9e` | 2026-10-16 | Open the workbench's run fold one line a step; keep its questions out | B1 |  |
| `34250e50` | 2026-10-16 | Give the workbench the assistant's speaking grammar (workbench ticket 01) | B1 |  |
| `a60c15f1` | 2026-10-16 | Park the time line above a user message, and ghost the user's words on the right | B1 |  |
| `fea5ba13` | 2026-10-16 | Merge main (workbench ticket 01) into workbench-steps-02 | B1 | 合并提交 |
| `ad0cd92e` | 2026-10-16 | Check ticket 02 under ticket 01's grammar: one-step runs, time lines, docs | B1 | 测试与文档 |
| `3a088ad7` | 2026-10-16 | Persist composer drafts' text to localStorage across restarts | B2 |  |
| `892ee6d5` | 2026-10-16 | Scroll the conversation with our own smooth scroll (telegram-details 04) | B2 |  |
| `e949d162` | 2026-10-16 | Merge telegram-details 04: our own smooth scroll for the conversation | B2 | 合并提交 |
| `0a92be23` | 2026-10-16 | Quote a conversation selection into the composer | B2 |  |
| `99e20fcb` | 2026-10-16 | Keep the caret in the composer: type to focus, presses keep focus | B2 | 「打字即聚焦」后被 945c4eba 关掉，留下的是点击不失焦 |
| `7eefcd48` | 2026-10-16 | Merge telegram-details 01-03: drafts persist, quote a selection, type to focus | B2 | 合并提交 |
| `cc705f84` | 2026-10-16 | Park the workbench's sent message with a blank under it, unfollowed (telegram-details 06) | B1 |  |
| `5433f178` | 2026-10-16 | Merge telegram-details 06: workbench live tail, no follow | B1 | 合并提交 |
| `00ae635c` | 2026-10-16 | Trial the composer's growth and the main chat's grouped corners (telegram-details 05) | X-试验 |  |
| `8be9a089` | 2026-10-16 | Merge telegram-details 05: variant switcher for composer growth and grouped corners | X-试验 | 合并提交 |
| `fcde201e` | 2026-10-16 | Quotes as a strip above the input, drawn apart in the bubble | B2 |  |
| `f3e315af` | 2026-10-16 | Merge telegram-details 07: quote strip in the composer, quotes drawn apart in the bubble | B2 | 合并提交 |
| `6425fbd6` | 2026-10-16 | Settle the telegram-details switcher: A3, B1, C2, D2 | B2 | 定稿：输入框增高动画、引用条；分组圆角并入 A2 |
| `47bda701` | 2026-10-16 | Merge telegram-details 08: switcher removed, A3 B1 C2 D2 written in | B2 | 合并提交 |
| `4912d7af` | 2026-10-16 | Scroll a question the run asks into view in the workbench (telegram-details 09) | B1 |  |
| `4b0f7abc` | 2026-10-16 | Merge telegram-details 09: a mid-run question scrolls into view in the workbench | B1 | 合并提交 |
| `945c4eba` | 2026-10-16 | Turn type-to-focus off after the Chinese IME live test | B2 |  |
| `7082870a` | 2026-10-16 | Keep short words whole in table cells | F4 |  |
| `ba56d1bd` | 2026-10-16 | Trial the density of the main chat's bubble text (telegram-details 10) | X-试验 |  |
| `fe7e9402` | 2026-10-16 | Merge telegram-details 10: switcher for the main chat's bubble text density | X-试验 | 合并提交 |
| `16711262` | 2026-10-16 | Settle the main chat's bubble text on V1 (telegram-details 11) | A2 | 气泡文字密度，细节并入 |
| `e6a0ee38` | 2026-10-16 | Merge telegram-details 11: main chat bubble text settled on V1 | A2 | 合并提交 |
| `33873a33` | 2026-10-16 | main-chat 32: delete a single message of the main chat | A2 | 删单条（含远程事件 message.deleted） |
| `57fc1853` | 2026-10-16 | Merge main-chat 32: delete a single message of the main chat | A2 | 合并提交 |
| `467ece12` | 2026-10-16 | Say the assistant's words once: header and open card show only the state (verdict 87) | A1 | 细节并入 |
| `d75a7abd` | 2026-10-16 | main-chat 38: a message menu on right-click and the reply bar's ⋯; undo instead of the delete dialog | A2 |  |
| `ab4b0783` | 2026-10-16 | Merge main-chat 38: a message menu and undo instead of the delete dialog | A2 | 合并提交 |
| `b767edaa` | 2026-10-16 | main-chat 33: scheduled tasks gain one-off and "wake the assistant" (Core) | A6 | 一次性、叫醒助理的定时任务（迁移 049 → U6） |
| `5ab63f0b` | 2026-10-16 | main-chat 34: the galley schedule command family | U1 | schedule 命令族；→ A5 |
| `26c56879` | 2026-10-16 | main-chat 33/34: one helper for the target rules; a DST-safe local time in the socket test | X-内部 | 共用判断函数与测试 |
| `16d7f2e1` | 2026-10-16 | Merge main-chat 33, 34: one-off and wake-the-assistant scheduled tasks; galley schedule | A6 | 合并提交；→ U1 |
| `5d802f98` | 2026-10-16 | main-chat 35: the remaining hands for the assistant in the CLI | A5 | → U1 |
| `20cf949c` | 2026-10-16 | Merge main-chat 35: the remaining hands for the assistant in the CLI | A5 | 合并提交；→ U1 |
| `98e5bd8d` | 2026-10-16 | main-chat 37: the assistant's to-do list as one Core read | A7 | 「Galley 在办」那组的数据来源 |
| `fa4b0b01` | 2026-10-16 | main-chat 37: reminder cards, the assistant's 待办, undelivered reminders | A7 | 提醒卡片、送不到时的通知；待办入口后被 96ba26cf、ee89d54a 挪到顶栏 |
| `ac09482c` | 2026-10-16 | Merge main-chat 37: reminder cards, the assistant's to-do, undelivered reminders | A7 | 合并提交 |
| `76f60a62` | 2026-10-16 | An undelivered reminder in the background only notifies; the view stays (verdict 88) | A6 | 细节并入 |
| `93c3aac0` | 2026-10-16 | main-chat 36: the manual on reminders, the main chat's own user-only paragraph, In Hand lines | A6 | 手册里的提醒；→ A5 |
| `7c2cfccf` | 2026-10-16 | main-chat 36: a late reminder asks for the lateness in the reply itself | A6 | 迟到的提醒，细节并入 |
| `3e22b3e8` | 2026-10-16 | Merge main-chat 36: the manual on reminders, In Hand lines, the reminders eval | A6 | 合并提交 |
| `b7be4526` | 2026-10-16 | Show the summary as the answer when a closing reply wrote nothing else (verdict 89) | B6 |  |
| `58f85b64` | 2026-10-16 | Point every session but the main chat to the assistant for reminders; the sidebar map says 待办 (verdict 90) | A6 | 工作台会话把提醒交给助理，细节并入 |
| `94b3a892` | 2026-10-16 | Name Galley where the assistant is referred to away from its conversation | A7 | 离开主对话时写名字 Galley，文案细节并入 |
| `4e2ba935` | 2026-10-17 | main-chat ticket 39: the to-do record in Core | A6 | 待办记录（迁移 050 → U6） |
| `2cdddb9f` | 2026-10-17 | main-chat ticket 40: the galley todo command family | U1 | todo 命令族 |
| `2228971d` | 2026-10-17 | main-chat ticket 42: the to-do panel, the row under Galley's card, to-do cards | A7 |  |
| `c3ed1604` | 2026-10-17 | main-chat ticket 41: to-dos in the manual, the entry layer and the eval | A6 |  |
| `7b57b8c9` | 2026-10-17 | main-chat ticket 43: to-do cards that stay, and the day a to-do was noted | A7 |  |
| `8d3119cd` | 2026-10-17 | main-chat ticket 44: a nudge is Galley's own reminder, not a to-do | A6 |  |
| `96ba26cf` | 2026-10-17 | main-chat ticket 45: the to-do entry moves to Galley's top bar | A7 |  |
| `bd99121c` | 2026-10-17 | Point the feature map at the to-do in the Galley conversation's top bar (verdict 93) | A7 | 提示词里的功能地图，细节并入 |
| `b26db951` | 2026-10-17 | The to-do button keeps the icon and today's count, no word (D1); remove the variant switcher | A7 |  |
| `ee89d54a` | 2026-10-17 | main-chat ticket 46: the to-do panel opens beside any conversation | A7 |  |
| `70916960` | 2026-10-17 | The to-do panel's launch-at-login hint drops to the foot of the list and can be closed (verdict 96) | A7 | 细节并入 |
| `1408d774` | 2026-10-17 | A to-do's second line takes after Apple's Reminders: one time, the reminder a bell (verdict 97) | A7 | 细节并入 |
| `aee6a476` | 2026-10-17 | The to-do panel drops 「你的事」: 今天 / 以后 / 随时 are groups of their own (verdict 98) | A7 | 细节并入（分组后由 3aa7585e 再改） |
| `68f7a85d` | 2026-10-18 | Upgrade GA baseline f308ee7 -> 5205f40 | U2 | 同时 → U3（外部 GA 重建客户端前先 settle） |
| `3a887520` | 2026-10-19 | Main chat ticket 47: quote on the reply's action bar; the live line falls back to the step's summary | A2 |  |
| `081123ed` | 2026-10-19 | Main chat ticket 48: a subtask's question is answered in the main chat; its card shows the state | A4 |  |
| `8004a400` | 2026-10-19 | Main chat ticket 49: the opened subtask cannot answer while its question is with Galley | A4 |  |
| `ffb9cf6d` | 2026-10-19 | Disabled composer greys the effort rows too; tickets 47-49 pass dogfood | B3 | 输入框禁用时强度行一起变灰，细节并入 |
| `ce4ad6ac` | 2026-10-19 | Main chat ticket 51: the live line grows into its bubble | X-取代 | 「直播行长成气泡」被 3d9232f4 的输入中气泡取代 |
| `d76fa6fc` | 2026-10-19 | Ticket 52: card says the last message while the main chat is open, header types | A1 |  |
| `fc5fc127` | 2026-10-19 | Ticket 52 follow-up: the open card skips the live round's tool steps | A1 |  |
| `41477a3d` | 2026-10-19 | Main chat ticket 54: Supervisor SOP off the managed top bar | F3 |  |
| `19b81836` | 2026-10-19 | Main chat ticket 53: copy · quote · ⋯ under your bubble | A2 |  |
| `9dff5b45` | 2026-10-19 | Main chat ticket 56: selection toolbar in one shell, hover rows yield | A2 | 选中文字工具条，细节并入 |
| `b44520a9` | 2026-10-19 | Trial the typing bubble against today's live line (main chat ticket 55) | X-试验 |  |
| `b813e64d` | 2026-10-19 | Main chat ticket 57: the user's hover row hides at once | A2 | 细节并入 |
| `3d9232f4` | 2026-10-19 | The typing bubble is the only way the assistant shows it is at work (main chat ticket 58) | A2 |  |
| `93915f63` | 2026-10-19 | Ticket 59: the assistant manual in parts, read before each write | A5 | 手册分篇，提示词，细节并入 |
| `5b1273d6` | 2026-10-19 | Main chat ticket 61: who cancelled, and the follow-ups turned down in In Hand | A6 | 谁取消的（迁移 051 → U6，cancelledBy → U1） |
| `4e8df7cb` | 2026-10-19 | Main chat ticket 60: follow up what comes up on a date, unasked | A6 |  |
| `f913a212` | 2026-10-19 | Trial the sidebar's two zones against today's (main chat ticket 62) | X-试验 |  |
| `81bb3241` | 2026-10-19 | Main chat ticket 63: the wake says what is of use | A6 |  |
| `145f9ef5` | 2026-10-19 | Main chat ticket 64: read todos.md before saying you will note | A6 | 细节并入 |
| `9a9565b1` | 2026-10-19 | Settle the sidebar's two zones on C (main chat ticket 62, ruling 118) | A1 |  |
| `f49412f9` | 2026-10-19 | Galley's face: the avatar's eyes and mouth follow what it does (main chat ticket 65) | A1 |  |
| `543a0c57` | 2026-10-19 | Trial Galley's face and two card layouts (main chat ticket 65) | X-试验 |  |
| `2a6c4af8` | 2026-10-20 | Main chat ticket 66: a bigger face, and the tongue as a body | A1 |  |
| `4c16790d` | 2026-10-20 | Main chat ticket 67: the face at 1x and the stage go to production | A1 |  |
| `16de3bfd` | 2026-10-20 | Trial where the workbench's name sits (main chat ticket 68) | X-试验 |  |
| `28bbdbe1` | 2026-10-20 | The workbench's name back on the line, centred, on a soft ground (main chat ticket 69) | X-取代 | 区名被 c0799813 挪进空状态那句 |
| `c0799813` | 2026-10-20 | Name the workbench in its empty line, not on the line (main chat ticket 70) | A1 |  |
| `e72d1829` | 2026-10-20 | Let a no-auth provider be saved: migration 052 widens the auth_kind CHECK | C3 | 迁移 052 → U6 |
| `2df31785` | 2026-10-20 | Route Sign in with ChatGPT models through patch 0007 (chatgpt-siwc ticket 03) | C1 |  |
| `156652ed` | 2026-10-20 | Treat a revoked ChatGPT sign-in as terminal on the plan route (patch 0007) | C1 |  |
| `bc5c3a83` | 2026-10-20 | Core: Sign in with ChatGPT login and token lifecycle (SIWC ticket 02) | C1 | 一次性回环登录监听 → U4 |
| `7ca75f73` | 2026-10-20 | SIWC sign-in defaults to the plan catalog's first visible model | C1 |  |
| `03585b28` | 2026-10-20 | SIWC sign-in names the provider ChatGPT | C1 |  |
| `8d1746e2` | 2026-10-20 | GUI: Sign in with ChatGPT as the ChatGPT card's main path (SIWC ticket 04) | C1 |  |
| `00c4569a` | 2026-10-20 | GUI: say 密钥 in the plan-not-eligible notice, per the copy guidelines | C1 |  |
| `5960ba28` | 2026-10-20 | SIWC: forget a saved client whose sign-in never got a callback | C1 |  |
| `22e4bb4e` | 2026-10-20 | GUI: tell a stuck ChatGPT sign-in to cancel and retry | C1 |  |
| `848059ec` | 2026-10-20 | GUI: call Sign in with ChatGPT's plan usage 「ChatGPT 订阅」 (SIWC ticket 04b) | C2 |  |
| `14a6f0d2` | 2026-10-20 | GUI: trial three looks for the ChatGPT plan mark (SIWC ticket 04b) | X-试验 |  |
| `ce86ae7d` | 2026-10-20 | Engine: drop the Codex CLI route from 0007 (SIWC ticket 05a) | C1 |  |
| `6fb846cb` | 2026-10-20 | Core: remove the Codex CLI login, retire its credentials at startup (SIWC ticket 05a) | C1 | 启动时清掉旧 Codex CLI 凭据（不撤销），即升级提示的来源 |
| `fea5729b` | 2026-10-20 | GUI: the ChatGPT plan mark is the logo before the model name (SIWC 05b) | C2 |  |
| `e24bd486` | 2026-10-20 | GUI: remove the Codex CLI login (SIWC ticket 05b) | C1 |  |
| `8b1e9b47` | 2026-10-20 | GUI: the assistant card gets an edge, a selected fill and a press that paints first (main chat rulings 122-123, ticket 71) | A1 |  |
| `e1c44a7e` | 2026-10-20 | GUI: transition lists name translate / scale / rotate, so press and disclosure motion runs (press-transition ticket 01) | F4 |  |
| `92158c8a` | 2026-10-20 | GUI: provider small text says how it connects; Add opens the provider list (SIWC ticket 06) | C3 |  |
| `9e1637ec` | 2026-10-20 | Devlog: Sign in with ChatGPT; docs point at it, status and release todos | X-文档 | 只动了 devlog、文档和 managed-ga 台账 |
| `a6f800c9` | 2026-10-20 | GUI: one-line rows and edge fades in the Add menu (SIWC decision 17) | C3 | 细节并入 |
| `10b8e005` | 2026-10-20 | GUI: switching to the main chat commits once (main chat ticket 72) | A1 | 切到主对话不再卡一下，细节并入 |
| `aff812c5` | 2026-10-20 | GUI: the ChatGPT plan mark in Cmd+K's model list and Your Models rows (SIWC ticket 07) | C2 |  |
| `6dba476a` | 2026-10-21 | IM polish 01: Telegram and Discord answers put the process behind a 过程 button | D2 |  |
| `57f3be25` | 2026-10-21 | IM polish 01: ledger and docs for the 过程 button | X-文档 | 补丁台账与文档 |
| `947ad825` | 2026-10-21 | Feishu conversation UX: Typing reaction, one answer card, queue (0029) | D3 |  |
| `2b602b8a` | 2026-10-21 | Feishu: headings as bold lines, replies quote the trigger when not adjacent (0029) | D3 |  |
| `f2120ebd` | 2026-10-21 | Telegram: the expanded process is always a plain quote (0024) | D2 |  |
| `31830513` | 2026-10-21 | README screenshots v3 ticket 01: seed the main chat, a subtask and to-dos | X-开发 | README 截图种子 |
| `63f2143e` | 2026-10-21 | README screenshots v3 ticket 01: fictional movers, no lost-item claim | X-开发 | README 截图种子 |
| `e73d94d5` | 2026-10-21 | IM entry layer: say what IM shares with the desktop, not "the same assistant" | E0 | 渠道如实说：长期记忆共用、对话不共用 |
| `1a9f0a37` | 2026-10-21 | README: Galley as your personal assistant; screenshots v3 | X-开发 | README 重写，随发版推送，不进 notes |
| `f57ad013` | 2026-10-21 | Main chat: file cards under a reply, the daily review's own name (ticket 74) | A9 | 每日巡看的名字 → A8 |
| `0d47eb44` | 2026-10-21 | Daily review: a name without the time; the time stays on the second line (ticket 74) | A8 | 细节并入 |
| `23e84418` | 2026-10-21 | Open documents in their default app: file cards and links in the text (ticket 74) | A9 |  |
| `d6efc1cc` | 2026-10-21 | File cards: a Pages / Numbers package opens in its default app (ticket 74) | A9 |  |
| `18f3ee17` | 2026-10-21 | Scheduled tasks dialog: leave out the daily review (ticket 74) | A8 | 定时任务弹窗不列每日巡看，细节并入 |
| `1fc7b556` | 2026-10-21 | Proactive first stage: notes what is in progress, acts unasked, morning review | A8 |  |
| `c5a41632` | 2026-10-21 | Local files: open PDF, Office Open XML, Pages, Numbers and HTML with the default app | A9 |  |
| `506c9b11` | 2026-10-21 | Local files: open Pages and Numbers documents saved as packages | A9 |  |
| `365a7b9f` | 2026-10-21 | Local files: reveal selects a Pages or Numbers package in its folder | A9 | 细节并入 |
| `98f1dddf` | 2026-10-21 | What the user is in the middle of: noted when they set it aside, not while they carry on | A8 |  |
| `3ac98445` | 2026-10-21 | Entry layer budget comment: rewrap the ticket 73 lines | X-内部 | 只改注释 |
| `41382f19` | 2026-10-21 | Ticket 75: the morning review speaks naturally, only when worth it | A8 |  |
| `598c0402` | 2026-10-22 | Ticket 76: a woken round that only dispatched says nothing | A4 | 只派了活的叫醒轮不出声，细节并入 |
| `e3767d1f` | 2026-10-22 | Ticket 77: carry a turn by the user's message, not by turn_index | A3 |  |
| `4b04ca08` | 2026-10-22 | Ticket 78: pick the morning review's time off the hour | A8 |  |
| `c266b00e` | 2026-10-22 | Ticket 79: carry ten turns within 15,000 characters, skip silent wakes | A3 |  |
| `3f72d529` | 2026-10-22 | Ticket 80: to-do panel empty without the review, notes, cancel Galley's own reminders | A7 |  |
| `6144229c` | 2026-10-22 | Ticket 83 points 5, 6: the launch-at-login hint leaves the review out; 12px between groups | A7 | 细节并入 |
| `c333b406` | 2026-10-22 | Ticket 83: a temporary switcher for how quiet done items are (现状 / A / B / C, 真实 / 演示) | X-试验 |  |
| `1df221c7` | 2026-10-22 | Ticket 81: the morning review wakes only for what has no alarm of its own | A8 |  |
| `15fa743b` | 2026-10-22 | Ticket 82: a routine's fires stay out of done | A7 | 例行到点不进「已完成」，细节并入 |
| `9b5b6189` | 2026-10-22 | Ticket 84: done items settle on B; the switcher and the demo go | A7 | 已完成项的样子，细节并入 |
| `13092922` | 2026-10-22 | Ticket 85: a temporary switcher for the to-do panel's density (现状 / B / B+C, 真实 / 演示) | X-试验 |  |
| `3aa7585e` | 2026-10-22 | Ticket 86: the to-do panel settles on B+C; the switcher and the demo go | A7 | 面板密度，细节并入 |
| `6f41637f` | 2026-10-22 | Ticket 87: the to-do panel's open and close (narrow look, card title, opens once, rows light) | A7 |  |
| `13265760` | 2026-10-22 | Ticket 87: a reading panel opened narrow keeps its place as the window widens | A7 | 窄窗下预览与面板的位置，细节并入 |
| `9650fb4a` | 2026-10-22 | Main chat: the reply's landing follow keeps the bottom when the column reflows | A2 | 回复落定时的跟随，细节并入 |
| `6f4bfc45` | 2026-10-22 | Ticket 88: Core's desktop command to delete a to-do | A7 |  |
| `313745b9` | 2026-10-22 | Ticket 88: delete your to-do from the panel, with a five-second undo | A7 |  |
| `669eedba` | 2026-10-22 | Ticket 88: a to-do ticked off under its undo toast is not deleted | A7 | 细节并入 |
| `6d760cbf` | 2026-10-22 | Ticket 88: the assistant manual says the user can delete a to-do too | A7 | 手册写明用户也能删，细节并入 |
| `4dc39d86` | 2026-10-22 | Ticket 89: a quiet 跟 Galley 说 row at the foot of a non-empty to-do list | X-取代 | 列表底部那行被 2cbb8d1a 挪到面板头部 |
| `2cbb8d1a` | 2026-10-22 | Ticket 89: 跟 Galley 说 moves to the to-do panel's header, an icon before the close | A7 |  |
| `69720cba` | 2026-10-22 | Ticket 89: the header's 跟 Galley 说 is a plus, not a talk bubble | A7 |  |

## 二、纯文档提交（439 个，全部 X-文档）

| 提交 | 日期 | 标题 |
|---|---|---|
| `c4810356` | 2026-10-09 | Update release status for v0.6.2 |
| `63b48fb1` | 2026-10-09 | Plan the iOS client and main chat direction |
| `c799be8d` | 2026-10-09 | Define the mobile product before its stack and UI |
| `770c5bb3` | 2026-10-09 | Research how browser tasks hand off to a human on the phone |
| `d7880869` | 2026-10-09 | Draft the Rule 2 wording and lay out the mobile plan order |
| `1946de12` | 2026-10-09 | Record that the main chat has no reset command |
| `0d59f9a7` | 2026-10-09 | Revise constitution Rule 2 for Galley's own remote module |
| `18f7fe51` | 2026-10-09 | Rewrite the PRD and architecture remote narrative for the phone client |
| `14af88a6` | 2026-10-09 | Sweep the remaining localhost-only references after the Rule 2 change |
| `c9442d55` | 2026-10-10 | Record the WeChat conversation dogfood as passed |
| `a9c9aa66` | 2026-10-10 | Close the owed WeChat end-to-end acceptance note |
| `f79c430e` | 2026-10-10 | Record 02a/02b as merged and dogfooded |
| `5525dfae` | 2026-10-10 | Record 02c as merged and CLI-dogfooded |
| `ea5f780d` | 2026-10-10 | Record 02d as merged and close the P0 part of ticket 02 |
| `7bc57afc` | 2026-10-10 | Draft the remote module and relay protocol design |
| `a695b0ee` | 2026-10-10 | Record JC's rulings on the remote protocol design |
| `9f085ad9` | 2026-10-10 | Split the remote protocol design into implementation tickets |
| `94d6c86e` | 2026-10-10 | Record 05a and 05c as merged and map remote-protocol/ |
| `ae738fff` | 2026-10-10 | Record 06a as merged and map relay/ |
| `c497496b` | 2026-10-10 | Record 07a as merged and map ios/ |
| `3208dfa9` | 2026-10-10 | Record 05b as merged |
| `d2cd277d` | 2026-10-10 | Log the remote access design and first tickets |
| `7ee210ae` | 2026-10-10 | Record 06b as merged |
| `67d02205` | 2026-10-10 | Add the main-chat baseline snapshot script |
| `5a0c488b` | 2026-10-10 | Record 05d as merged locally, pending JC's preview |
| `91bbd34f` | 2026-10-10 | Record pairing-on-first-phone in the 05d notes |
| `25748f7c` | 2026-10-12 | Reshape the main chat around an affairs ledger (concept review) |
| `339fe043` | 2026-10-12 | Narrow ticket 01 to what the human actually said |
| `7522e87d` | 2026-10-12 | Record ticket 02 as merged locally, pending the A1/A2 trial |
| `a2962018` | 2026-10-12 | Use full-width option labels in the ticket 02 notes |
| `74425ec1` | 2026-10-12 | Record ticket 01 as merged locally, off by default |
| `5a3f029a` | 2026-10-12 | Record the sidebar rulings and split ticket 07 (A3 / B / B' trial) |
| `7d33d03d` | 2026-10-12 | Record ticket 07 as merged locally, pending the live trial |
| `32b34eb1` | 2026-10-12 | Record the B' + 其他对话 ruling and split ticket 08 |
| `d2ecc00b` | 2026-10-12 | Devlog: the main chat's desktop sidebar, A1/A2 to B' |
| `a40c767f` | 2026-10-12 | Record ticket 08 as merged locally |
| `5b797f69` | 2026-10-12 | Record the CLI-guard ruling and draft the Rule 4 clarification |
| `41942dfb` | 2026-10-12 | Attribute the Rule 4 review step correctly |
| `5b98c2ed` | 2026-10-12 | Record the section-belonging ruling and split ticket 09 |
| `3864affa` | 2026-10-12 | Record the first real-model ledger eval |
| `87627d8a` | 2026-10-12 | Record ticket 09 as merged locally, pending the live trial |
| `fb992ec6` | 2026-10-12 | Split ticket 03 into four slices and settle 03a defaults |
| `6386014f` | 2026-10-12 | Correct the managed session count in ticket 03's context_win note |
| `50a0c6dd` | 2026-10-12 | Record ticket 03a as merged locally, pending the live check |
| `55d6e3b5` | 2026-10-12 | Record the context_win and Rule 4 rulings; route 03b through the CLI |
| `ca070249` | 2026-10-12 | Freeze the external runtime's sidebar layout |
| `9583932c` | 2026-10-12 | Record ticket 03b as merged locally, pending the live check |
| `221d4790` | 2026-10-12 | Record the live check of tickets 03a and 03b |
| `2bf088bc` | 2026-10-12 | Write ticket 04 (memory page) and record rulings 43-46 |
| `33b97a28` | 2026-10-12 | Add the affairs ledger interpretation to Rule 4 with ticket 04 |
| `433bf263` | 2026-10-12 | Turn the affairs ledger on by default and announce it in the main chat |
| `2b82860a` | 2026-10-13 | Record the memory page, the default-on ledger and the main chat state |
| `b4fc2b1f` | 2026-10-13 | Simplify the Memory page to three areas (ruling 48, ticket 04d) |
| `f6365700` | 2026-10-13 | Describe the three-area Memory page (ticket 04d) |
| `d8df038b` | 2026-10-13 | Check emotions inside their affairs in the ledger eval (ticket 04d) |
| `c060f64f` | 2026-10-13 | Drop the affairs ledger (ruling 49, ticket 10) |
| `36affec8` | 2026-10-13 | Drop the affairs ledger from Rule 4 and the current-behavior docs (ticket 10) |
| `25686f15` | 2026-10-13 | Close ticket 10 with the merge report |
| `282c0f9b` | 2026-10-13 | Carry recent turns into a new segment and page conversation history (rulings 50–51, tickets 11–12) |
| `4435b4d7` | 2026-10-13 | Report ticket 11's implementation in its comments |
| `acc3559a` | 2026-10-13 | Describe paged conversation history and report ticket 12 |
| `5c428724` | 2026-10-13 | Compare the main chat entry layer and three subtask dispatch routes with the real model (tickets 03d, 06) |
| `a14d7f7a` | 2026-10-13 | Dispatch subtasks through a reply tag (ruling 52, ticket 06) |
| `192c039f` | 2026-10-13 | Stop naming the model relay host in two devlogs |
| `60820ffc` | 2026-10-13 | Close ticket 03d |
| `62c68552` | 2026-10-13 | Split ticket 06 into dispatch and cards (06a) and scheduled results (06b), ruling 53 |
| `567b3560` | 2026-10-13 | Describe the main chat's subtasks and report ticket 06a |
| `e1125549` | 2026-10-13 | Hold the main chat release for dev use and close tickets 11, 12, 06a |
| `9386b57a` | 2026-10-14 | Plan a deep, hold-to-confirm reset of the main chat (ruling 59, ticket 15) |
| `aba3937f` | 2026-10-14 | Document the main chat reset and the hold-to-confirm rule (ticket 15) |
| `8d7c655f` | 2026-10-14 | Record the reset review fixes in the docs and ticket 15 |
| `64f19fd4` | 2026-10-14 | Mark ticket 15 merged and record the log ruling in ruling 59 |
| `f62572c4` | 2026-10-14 | Record the main chat reset and its device check (ticket 15) |
| `f72b7c05` | 2026-10-14 | Plan the assistant and workbench spaces and their shell trial (rulings 60-61, ticket 16) |
| `311c3757` | 2026-10-14 | Record the spaces shell trial's implementation in ticket 16 |
| `09b39612` | 2026-10-14 | Mark the spaces shell trial ready for JC's live comparison (ticket 16) |
| `701bcb66` | 2026-10-14 | Drop both shells and plan the sidebar's assistant region trial (rulings 62-63, ticket 17) |
| `46d45d73` | 2026-10-14 | Record the sidebar-top trial's implementation in ticket 17 |
| `aab715e8` | 2026-10-14 | Mark the sidebar-top trial ready for JC's live comparison (ticket 17) |
| `1e1d0cd5` | 2026-10-14 | Settle the sidebar top on the assistant card and plan its final form (rulings 64-65, ticket 18) |
| `4c3a4ac9` | 2026-10-14 | Document the assistant's card and the new-chat row (ticket 18) |
| `17ea5211` | 2026-10-14 | Record ticket 18's implementation in its comments |
| `3e7df165` | 2026-10-14 | Mark the assistant card ready for JC's live acceptance (ticket 18) |
| `7f72fbb5` | 2026-10-14 | Record the assistant's form from two spaces to the sidebar card (rulings 60-65, tickets 16-18) |
| `bb82bc09` | 2026-10-14 | Plan the assistant's IM rendering trial: bubbles, process, time, scroll (ruling 66, ticket 19) |
| `01a68548` | 2026-10-15 | Record ticket 19's trial implementation in its comments |
| `43f62872` | 2026-10-15 | Mark the IM rendering trial ready for JC's live comparison (ticket 19) |
| `afc09d6e` | 2026-10-15 | Settle the assistant's IM rendering on the recommended set (ruling 67, ticket 20) |
| `ccff1eab` | 2026-10-15 | Document the assistant's conversation (ticket 20) |
| `f804fb96` | 2026-10-15 | Record ticket 20's implementation in its comments |
| `0a2ec61d` | 2026-10-15 | Mark the assistant's final IM rendering ready for JC's live acceptance (ticket 20) |
| `f0d1a072` | 2026-10-15 | Record the assistant's IM rendering from trial to final (rulings 66-67, tickets 19-20) |
| `2787c5e0` | 2026-10-15 | Drop local scratch paths from tickets 16 and 17 before pushing |
| `7015474f` | 2026-10-15 | Plan the assistant's process button and one running sentence (ruling 68, ticket 21) |
| `52ad0791` | 2026-10-15 | Document the assistant's process button and running sentence (ticket 21) |
| `294c27cc` | 2026-10-15 | Record ticket 21's implementation in its comments |
| `c60d5fe4` | 2026-10-15 | Record the assistant's process button and running sentence (ruling 68, ticket 21) |
| `029885f4` | 2026-10-15 | Plan the assistant's process card: one line a step, eight lines tall (ruling 69, ticket 22) |
| `f3cf1a2c` | 2026-10-15 | Document the assistant's process card (ticket 22) |
| `8f1d9fde` | 2026-10-15 | Record ticket 22's implementation in its comments |
| `a11a00a6` | 2026-10-15 | Record the assistant's process card (ruling 69, ticket 22) |
| `3beee783` | 2026-10-15 | Plan the new app icon and the assistant's avatar (ruling 70, ticket 23) |
| `55e076ee` | 2026-10-15 | Plan the assistant's composer trial: one line, the model kept in it (ruling 71, ticket 24) |
| `75436b33` | 2026-10-15 | Put the new icon on the README banners and the social preview (ticket 23) |
| `450b08c9` | 2026-10-15 | Record ticket 23's implementation in its comments |
| `6191b63c` | 2026-10-15 | Record the new app icon and the assistant's avatar (ruling 70, ticket 23) |
| `59dd579a` | 2026-10-15 | Mark tickets 21–23 accepted live by JC |
| `de04cdc2` | 2026-10-15 | Record ticket 24's trial implementation in its comments |
| `ae9cf9bf` | 2026-10-15 | Record the icon's re-centring in its devlog |
| `34b3d7d9` | 2026-10-15 | Mark the composer trial ready for JC's live comparison (ticket 24) |
| `58e56691` | 2026-10-15 | Settle the main chat's composer on one line, 24px off the bottom (ruling 72, ticket 25) |
| `eb28b069` | 2026-10-15 | Keep the workbench's hover copy on purpose (ruling 73, item 4) |
| `626649bf` | 2026-10-15 | Plan the one-line composer for workbench sessions, hint row kept (ruling 74) |
| `86025e7f` | 2026-10-15 | Document the main chat's one-line composer (ticket 25) |
| `619f145d` | 2026-10-15 | Record ticket 25's implementation in its comments |
| `219d2455` | 2026-10-15 | Mark ticket 25 ready for JC and plan ticket 27 (ruling 74) |
| `f70a56cc` | 2026-10-15 | Centre the one-line composer's model and effort popovers (ruling 76, folded into ticket 27) |
| `e9b112d0` | 2026-10-15 | Mark ticket 25 accepted live by JC |
| `a6eab0a3` | 2026-10-15 | Document the one-line composer in every session (ticket 27, rulings 74 and 76) |
| `0176dd40` | 2026-10-15 | Record ticket 27's implementation in its comments (and ruling 76 folded in) |
| `d040eee0` | 2026-10-15 | Record the one-line composer and the two small polishes (rulings 71–76) |
| `0d01c269` | 2026-10-15 | Plan the header menu's find and reset, and Cmd+F (ruling 77, ticket 28) |
| `17e5ed9c` | 2026-10-15 | Fix a half-width colon in ruling 77 |
| `0f557b2c` | 2026-10-15 | Mark ticket 27 accepted live by JC |
| `c8088d84` | 2026-10-15 | Document the title menu's find and reset, and the scoped palette (ticket 28, ruling 77) |
| `c0cfb27a` | 2026-10-15 | Record ticket 28's implementation in its comments |
| `1ce81b38` | 2026-10-15 | Record the title menu's find and reset and the effort order (rulings 77, 78) |
| `21500a19` | 2026-10-15 | Mark ticket 28 accepted live by JC |
| `5c12388e` | 2026-10-15 | Mark ticket 20 accepted live by JC |
| `913009b8` | 2026-10-15 | Record the assistant's foundation: one person to talk to, a team behind it (assistant PRD, main chat ruling 80) |
| `919f3c06` | 2026-10-15 | List the assistant's outward copy as release-time work, and check it in Pre-Flight |
| `8a7112d9` | 2026-10-15 | Plan the closed loop: subtasks wake the assistant (assistant PRD ruling 8, main chat ruling 82, tickets 29-31) |
| `6dd00d89` | 2026-10-16 | Order the next steps after the closed loop: try it, release, then commitments; add a trial snapshot |
| `5c7ec173` | 2026-10-16 | Session close: put the assistant's foundation into the product PRD, the docs index and the glossary |
| `8dd3752a` | 2026-10-16 | Plan the workbench conversation's move to the assistant's grammar (tickets 01-02) |
| `21d90593` | 2026-10-16 | Record keeping the assistant managed-only, and the migration path for external users |
| `0bac571f` | 2026-10-16 | Document the workbench's one-line steps and its questions staying out |
| `2f7ef5ad` | 2026-10-16 | Record ticket 02's implementation in its comments |
| `de158c07` | 2026-10-16 | Write the workbench's new grammar into the conversation design doc |
| `0a8a5070` | 2026-10-16 | Record ticket 01's implementation in its comments |
| `3b793963` | 2026-10-16 | Document where a user message with a time line above it parks |
| `4acfe732` | 2026-10-16 | Record ticket 01's follow-up in its comments: the parking rule and the skeleton |
| `8056dd7f` | 2026-10-16 | Record ticket 02's merge with ticket 01 in its comments |
| `6c960231` | 2026-10-16 | Mark workbench tickets 01 and 02 merged, awaiting JC's live check |
| `9b2ec47e` | 2026-10-16 | Mark workbench tickets 01 and 02 accepted live by JC |
| `7befed82` | 2026-10-16 | List the workbench grammar change for the next release notes |
| `e495566d` | 2026-10-16 | Defer visual cards in assistant replies: research, plan and deferred entry |
| `06948df5` | 2026-10-16 | Open telegram-details: PRD, tickets 01-05, floating date deferred |
| `6d33c812` | 2026-10-16 | telegram-details: rule 2 (workbench live tail, no follow) and ticket 06 |
| `0bfafd54` | 2026-10-16 | Document the conversation's smooth scroll and fix four stale doc details |
| `c2656bea` | 2026-10-16 | telegram-details: mark 04 merged, 06 in progress |
| `dc97b558` | 2026-10-16 | telegram-details: mark 01-03 merged, awaiting JC's live check |
| `d0fde8f9` | 2026-10-16 | telegram-details: rule 3a and ticket 07 (quote strip, quotes drawn in the bubble) |
| `f3ae4478` | 2026-10-16 | Document the workbench's live tail and record ticket 06 |
| `0e089c12` | 2026-10-16 | telegram-details: mark 06 merged, awaiting JC's live check |
| `ad1a581d` | 2026-10-16 | Record the telegram-details 05 trial in its ticket comments |
| `727cde73` | 2026-10-16 | telegram-details: mark 05 merged, drop local paths from its comments |
| `ee022fa2` | 2026-10-16 | telegram-details: switcher verdict A3 and B1 |
| `c05819b8` | 2026-10-16 | telegram-details: mark 07 merged, awaiting JC's live check and verdict |
| `cde408c0` | 2026-10-16 | telegram-details 07: C2 chosen; D needs a sent quoted message to compare |
| `ce14d696` | 2026-10-16 | telegram-details: C2 and D2 chosen, ask_user exception; tickets 08 and 09 |
| `a16c8622` | 2026-10-16 | telegram-details: mark 08 merged, awaiting JC's live check |
| `07c5981a` | 2026-10-16 | Document the ask_user exception to the live tail and record ticket 09 |
| `82d8b990` | 2026-10-16 | Devlog the telegram-details round; mark 09 merged; release-note line |
| `b4ea30e7` | 2026-10-16 | telegram-details: rule 8 and ticket 10 (main chat bubble density switcher) |
| `4b9f4201` | 2026-10-16 | telegram-details: 01-09 accepted live; withdraw scroll-on-completion |
| `6545fa45` | 2026-10-16 | Record the telegram-details 10 trial in its ticket comments |
| `72f8675e` | 2026-10-16 | telegram-details: mark 10 merged, awaiting JC's switcher verdict |
| `05ab45cb` | 2026-10-16 | telegram-details: bubble density verdict V1, ticket 11 to finalize |
| `cd89fbbd` | 2026-10-16 | Record the telegram-details 11 finalization in its ticket comments |
| `1f68e95c` | 2026-10-16 | telegram-details: mark 11 merged; devlog the bubble density verdict |
| `973021e6` | 2026-10-16 | main-chat: verdict 83, delete a single message; ticket 32 |
| `592e4a60` | 2026-10-16 | main-chat: verdict 83, the delete confirmation is title-only (JC's pick) |
| `66aeca05` | 2026-10-16 | deferred: deleting a single message in workbench sessions |
| `1ab20f23` | 2026-10-16 | telegram-details: ticket 11 accepted on the real app, PRD done |
| `79507dae` | 2026-10-16 | assistant: verdict 9, reminders and Galley's own hands before the release; tickets 33-37 |
| `ff3d4f59` | 2026-10-16 | main-chat: mark 32 merged; devlog the single-message delete |
| `5a2412e5` | 2026-10-16 | main-chat: verdict 85, a message menu and undo instead of the delete dialog; ticket 38 |
| `36931cd9` | 2026-10-16 | main-chat: ticket 32 accepted on the real app; devlog the follow-up verdict 85 |
| `47521368` | 2026-10-16 | main-chat: verdict 86, the schedule entry becomes the assistant's to-do; rewrite ticket 37 |
| `d1201b09` | 2026-10-16 | main-chat: mark 38 merged |
| `edca1db4` | 2026-10-16 | main-chat 33, 34: implementation reports in the tickets |
| `0ce6bf9b` | 2026-10-16 | main-chat: mark 33, 34 merged; fold their open points into 36 and 37 |
| `2d92a881` | 2026-10-16 | deferred: seeing the desktop from the phone through a third-party remote desktop |
| `24ca243a` | 2026-10-16 | main-chat 35: implementation report in the ticket |
| `cfbcbaca` | 2026-10-16 | main-chat: mark 35 merged; note its commands for the manual in 36 |
| `e44b949e` | 2026-10-16 | deferred: the UU picture-in-picture flow is an in-app small window to the user |
| `5c70b7ff` | 2026-10-16 | main-chat 37: implementation report in the ticket |
| `99c8b1fe` | 2026-10-16 | main-chat: mark 37 merged |
| `a6f3f06b` | 2026-10-16 | main-chat 36: the reminders eval (schedule suite) and its results |
| `d0613d2b` | 2026-10-16 | main-chat 36: implementation report in the ticket |
| `c8234d1e` | 2026-10-16 | main-chat: mark 36 merged |
| `8be46333` | 2026-10-16 | Close two stale statuses: main-chat 06b superseded, scheduled-tasks PRD done |
| `aa396855` | 2026-10-16 | main-chat: record verdict 90 |
| `be2e91f7` | 2026-10-16 | main-chat: verdict 91, the to-do redone as Galley's notebook; tickets 39-42 |
| `3e96bd87` | 2026-10-17 | main-chat ticket 39: implementation report |
| `5f56da21` | 2026-10-17 | main-chat: ticket 39 merged |
| `c2c3e97f` | 2026-10-17 | main-chat ticket 40: implementation report |
| `c6db8edd` | 2026-10-17 | main-chat: ticket 40 merged |
| `20e10158` | 2026-10-17 | main-chat ticket 42: implementation report |
| `31bce261` | 2026-10-17 | main-chat: ticket 42 merged |
| `0ab8e009` | 2026-10-17 | main-chat: ticket 43, to-do cards that stay and the noted date |
| `05a72bf6` | 2026-10-17 | main-chat ticket 41: implementation report |
| `6a5d5358` | 2026-10-17 | main-chat: ticket 41 merged |
| `e82428e1` | 2026-10-17 | main-chat ticket 43: implementation report |
| `29711ca8` | 2026-10-17 | main-chat: ticket 43 merged |
| `43f232f4` | 2026-10-17 | main-chat: verdict 92, a nudge is Galley's own reminder; ticket 44; B1 and C1 picked |
| `bd3f5dbc` | 2026-10-17 | main-chat: verdict 93, the to-do entry moves to Galley's top bar; ticket 45 |
| `94fe9137` | 2026-10-17 | main-chat ticket 44: implementation report |
| `4d043463` | 2026-10-17 | main-chat: ticket 44 merged |
| `af139533` | 2026-10-17 | main-chat ticket 45: implementation report |
| `0f50b057` | 2026-10-17 | main-chat: ticket 45 merged |
| `68eeb809` | 2026-10-17 | main-chat: verdicts 94 and 95, the name stays 待办 and the to-do panel opens beside any conversation; ticket 46 |
| `4b0ee554` | 2026-10-17 | main-chat ticket 46: implementation report |
| `2857bfb6` | 2026-10-17 | main-chat: ticket 46 merged |
| `14c91801` | 2026-10-17 | main-chat: ticket 46 checked on the real app (the jump back from the workbench) |
| `21e0ef3a` | 2026-10-17 | Devlog and project status for the to-do redo (rulings 90-98, tickets 39-46) |
| `e494d070` | 2026-10-18 | GA baseline 5205f40: SOP step 8 desktop checks, the latent prompt drop |
| `bd28de72` | 2026-10-18 | GA baseline 5205f40 follow-ups: the eval harness loader, a stale deferred item |
| `7443b090` | 2026-10-19 | Session close SOP for main sessions with background agents; needs-dogfood status |
| `2eb6e919` | 2026-10-19 | Main chat rulings 99-100 and ticket 47; Goal removal dogfooded |
| `3b1c84ce` | 2026-10-19 | Dogfood walk 2026-10-19: tickets settle; ruling 101 and ticket 48 |
| `ae667bd1` | 2026-10-19 | Main chat ruling 102, tickets 49-50, and the deferred Core settle-up |
| `1eebbecc` | 2026-10-19 | Dogfood walk 2026-10-19, last stations; browser control smoke moves to release |
| `568decdf` | 2026-10-19 | Status values: one vocabulary; ticket indexes drop their status column |
| `fd4e7e5c` | 2026-10-19 | Assistant PRD status: the closed loop passed the 2026-10-19 dogfood walk |
| `cd88bb2f` | 2026-10-19 | Devlog and project status for the 2026-10-19 dogfood walk (rulings 99-102) |
| `a5f5f48f` | 2026-10-19 | Main chat ruling 103: the live line grows into the bubble; ticket 51 |
| `3e6d19f5` | 2026-10-19 | Main chat ruling 104: card writes the last line while open, header types; ticket 52 |
| `3d21fa22` | 2026-10-19 | Main chat ruling 105: hover actions under the user's bubble; ticket 53 |
| `93a0f4bc` | 2026-10-19 | Ticket 51 docs: the landing scroll in the smooth-scroll and follow rules |
| `ab7ae8b5` | 2026-10-19 | Foundations: the live-line landing is the one timed scroll exception |
| `894b7523` | 2026-10-19 | Main chat ruling 106: Supervisor SOP off the managed top bar; ticket 54; ticket 51 merged |
| `8f96171b` | 2026-10-19 | Ticket 52 merged: needs dogfood |
| `2f6dd490` | 2026-10-19 | Ticket 52 passes dogfood |
| `6f23ca35` | 2026-10-19 | Ticket 54 merged: needs dogfood |
| `950db5a8` | 2026-10-19 | Ticket 54 passes dogfood |
| `3937af88` | 2026-10-19 | Main chat ruling 107: trial the typing bubble against today's live line; ticket 55 |
| `8b530d1e` | 2026-10-19 | Ticket 51 passes dogfood |
| `693310b9` | 2026-10-19 | Ticket 53 docs: the live line, the time line and focus list under your bubble |
| `0e466822` | 2026-10-19 | Ticket 53 merged: needs dogfood |
| `06c02fd1` | 2026-10-19 | Ticket 53 passes dogfood |
| `f0895328` | 2026-10-19 | Main chat ruling 108: selection toolbar in one shell, hover rows yield; ticket 56 |
| `9668b0f5` | 2026-10-19 | Ticket 56 merged: needs dogfood |
| `cd992557` | 2026-10-19 | Ticket 56 passes dogfood |
| `31822773` | 2026-10-19 | Main chat ruling 109: the user's hover row hides at once; ticket 57 |
| `48e63d63` | 2026-10-19 | Ticket 55 merged: trial awaits dogfood |
| `aa70bcee` | 2026-10-19 | Ticket 57 merged: needs dogfood |
| `7b9db92a` | 2026-10-19 | Ticket 57 passes dogfood |
| `f2cd8a34` | 2026-10-19 | Main chat ruling 110: the typing bubble wins; ticket 58 tears the trial down |
| `2f53fd3e` | 2026-10-19 | Devlog: rulings 103-110, the main chat's IM feel |
| `05ef8b49` | 2026-10-19 | Main chat ruling 111: the manual splits into parts; ticket 59 |
| `7cf949db` | 2026-10-19 | Ticket 58 docs: the typing bubble is the final rule |
| `6401dcf7` | 2026-10-19 | Ticket 58 merged: needs dogfood |
| `f41264f7` | 2026-10-19 | Ticket 58 passes dogfood |
| `90df72ea` | 2026-10-19 | Main chat ruling 112: it decides on its own what to follow up; ticket 60 |
| `99888a7b` | 2026-10-19 | Main chat ruling 113: declined follow-ups live in "In Hand"; ticket 61 |
| `c19a97a1` | 2026-10-19 | Docs: the assistant manual is a directory of parts (ticket 59) |
| `ce03d5fd` | 2026-10-19 | Ticket 59: rerun the to-do, reminder and wake evals on the manual in parts |
| `e24f881e` | 2026-10-19 | Ticket 59 merged: needs dogfood |
| `bef82318` | 2026-10-19 | Devlog: ticket 59 results; rich-reply PRD points at the manual's parts |
| `06f5e93a` | 2026-10-19 | Main chat ruling 114: the sidebar's two zones; ticket 62 trial |
| `0d341b63` | 2026-10-19 | Ticket 59 passes dogfood |
| `98401b64` | 2026-10-19 | Main chat ticket 61: the eval mirrors the follow-ups turned down |
| `3493ee78` | 2026-10-19 | Main chat ticket 61: implementation note |
| `bd3a3d0f` | 2026-10-19 | Ticket 61 merged |
| `394beedd` | 2026-10-19 | Main chat ticket 60: eval of following up unasked, rerun |
| `af3e338c` | 2026-10-19 | Main chat ticket 60: implementation note |
| `cef92276` | 2026-10-19 | Ticket 60 merged; ruling 114 corrects the archive premise |
| `71e9b54b` | 2026-10-19 | Main chat ruling 115 and ticket 63: the wake says what is of use |
| `d1c2ba9e` | 2026-10-19 | Ticket 62 merged, awaiting dogfood |
| `1df31f39` | 2026-10-19 | Main chat ticket 63: eval of the wake saying what is of use, rerun |
| `50b79d9d` | 2026-10-19 | Main chat ticket 63: implementation note |
| `a43d21af` | 2026-10-19 | Ticket 63 merged, awaiting dogfood; dogfood check 39 follows the wake |
| `06985edc` | 2026-10-19 | Main chat ruling 116 and ticket 64: read the manual before saying you will note |
| `509dd0ea` | 2026-10-19 | Main chat rulings 117-118 and ticket 65: Galley comes alive; 62 settles on C |
| `7ca57450` | 2026-10-19 | Main chat ticket 64: eval of reading the manual before saying you will note |
| `1d2908fa` | 2026-10-19 | Main chat ticket 64: implementation note |
| `beb33798` | 2026-10-19 | Ticket 64 merged, awaiting dogfood; prompt composition catches up with tickets 60, 63, 64 |
| `25251f65` | 2026-10-19 | Ticket 60 passes dogfood |
| `877260ec` | 2026-10-19 | Tickets 63 and 64 pass dogfood |
| `69b1ff54` | 2026-10-19 | Devlog: the assistant follows up on its own (rulings 112-116) |
| `7c7f5834` | 2026-10-19 | Main chat ruling 117.8: a glance tells busy from idle |
| `7beeec85` | 2026-10-19 | Main chat ticket 65: implementation note |
| `5094c807` | 2026-10-19 | Ticket 65 merged, awaiting dogfood |
| `3ad81022` | 2026-10-19 | Main chat ruling 119: settle on tier C and the 72 stage; bigger motion to come |
| `ad34c968` | 2026-10-19 | Main chat ruling 119 details and ticket 66: a bigger face, and the tongue |
| `c73f91b5` | 2026-10-19 | Ticket 65 settled: tier C and the 72 stage |
| `346fec6e` | 2026-10-19 | Main chat ruling 119.6: one face moves, and long runs calm down |
| `d6666c1d` | 2026-10-20 | Main chat ticket 66: implementation note |
| `7567ef4d` | 2026-10-20 | Ticket 66 merged, awaiting dogfood |
| `625ea380` | 2026-10-20 | Main chat ruling 119.7 and ticket 67: the face at 1x goes final |
| `cdaa6149` | 2026-10-20 | Devlog and project status for the main chat's 2026-10-19/20 work (rulings 103-119) |
| `1e435e06` | 2026-10-20 | Main chat ticket 67: design docs for the face and the stage |
| `d8dbfd76` | 2026-10-20 | Main chat ticket 67: implementation note |
| `5a49abc1` | 2026-10-20 | Ticket 67 merged, awaiting a dogfood glance |
| `5223a293` | 2026-10-20 | Main chat ruling 120 and ticket 68: trial where the workbench's name sits |
| `fd87991b` | 2026-10-20 | Ticket 67 passes JC's dogfood |
| `b7607dad` | 2026-10-20 | Main chat ticket 68: implementation note |
| `2bfa71ff` | 2026-10-20 | Ticket 68 merged, awaiting JC's pick |
| `50dc9ef9` | 2026-10-20 | Main chat ruling 120.6 and ticket 69: the workbench's name goes back on the line, centred, on a soft ground |
| `16944774` | 2026-10-20 | Ticket 68 settled: neither A nor B, see ruling 120.6 |
| `616c6ce5` | 2026-10-20 | Design docs and devlog: the workbench's name centred on the line, on a soft ground |
| `5d5d6a1d` | 2026-10-20 | Main chat ticket 69: implementation note |
| `961a7dd9` | 2026-10-20 | Ticket 69 merged, awaiting a dogfood glance |
| `02d19289` | 2026-10-20 | Main chat ruling 121 and ticket 70: the workbench's name moves into the empty hint |
| `e91a55db` | 2026-10-20 | Design docs and devlog: the workbench's name moves into the empty hint |
| `99e0a775` | 2026-10-20 | Main chat ticket 70: implementation note |
| `abd0767f` | 2026-10-20 | Ticket 70 merged, awaiting a dogfood glance |
| `f20343c7` | 2026-10-20 | Close out the workbench's name: ticket 70 passes dogfood, devlog retitled, status links |
| `ac6a4d43` | 2026-10-20 | Sign in with ChatGPT: PRD, Rule 2 loopback exception, tickets 01-03 |
| `14674aab` | 2026-10-20 | Sign in with ChatGPT: decisions 5-6, probe results, ticket notes, ticket 04 |
| `42452d6b` | 2026-10-20 | Sign in with ChatGPT: decisions 7-9 (plan errors in chat, revoke refresh, default model) |
| `35acaf50` | 2026-10-20 | Defer ChatGPT plan quota display until OpenAI exposes usage to SIWC apps (decision 10) |
| `d70df7e1` | 2026-10-20 | Sign in with ChatGPT: note the stale-registration escape and the provider rename |
| `cc03e8b8` | 2026-10-20 | Docs: correct the migration registration rule and the no-auth devlog |
| `2378a158` | 2026-10-20 | Sign in with ChatGPT: dogfood round 1, decisions 11-12, tickets to needs-dogfood |
| `6b0ef653` | 2026-10-20 | Sign in with ChatGPT: ticket 05 (remove the Codex CLI login); response.metadata holds no quota |
| `d26ba555` | 2026-10-20 | Sign in with ChatGPT: the plan mark is the ChatGPT logo before the model name (decision 13) |
| `f2481bc4` | 2026-10-20 | Sign in with ChatGPT: the model menu marks plan models with the logo too (decision 14) |
| `8b435566` | 2026-10-20 | Sign in with ChatGPT: re-login after disconnect passes dogfood; tickets 02 and 03 done |
| `1be0f8f8` | 2026-10-20 | Sign in with ChatGPT: settings provider chip and add menu (decisions 15-16, ticket 06) |
| `42d87964` | 2026-10-20 | Docs: Sign in with ChatGPT is the ChatGPT provider's only sign-in (SIWC ticket 05a) |
| `add49cd7` | 2026-10-20 | Design: the model menu's current-item check sits on the right since 09-22 |
| `8343fe73` | 2026-10-20 | Sign in with ChatGPT: batch 2 merged (ticket 05) |
| `20a1ef9b` | 2026-10-20 | Press transitions: ticket to name translate / scale / rotate in transition lists |
| `fc3c6355` | 2026-10-20 | Sign in with ChatGPT: tickets 04 and 05 pass dogfood |
| `2f705acf` | 2026-10-20 | Press transitions: ticket 01 merged, to needs-dogfood |
| `d1470359` | 2026-10-20 | Design: provider connection text and the Add menu (SIWC decisions 15-16) |
| `6bd6b694` | 2026-10-20 | Sign in with ChatGPT: ticket 06 merged, to needs-dogfood |
| `0bc5ae9f` | 2026-10-20 | Main chat ticket 71 and press-transition ticket 01 pass dogfood |
| `883f0948` | 2026-10-20 | Sign in with ChatGPT: ticket 01 passes dogfood; Add menu rows go single-line (decision 17) |
| `478847ff` | 2026-10-20 | Main chat ticket 71 and press-transition ticket 01: the remaining dogfood items pass |
| `3bf5eefa` | 2026-10-20 | Sign in with ChatGPT: ticket 06 single-line menu merged; last doc link points at the devlog |
| `9aecea73` | 2026-10-20 | Main chat ticket 72 merged and re-measured, to needs-dogfood |
| `512dfa15` | 2026-10-20 | Sign in with ChatGPT: ticket 06 passes dogfood; the group is done on main |
| `98dec86c` | 2026-10-20 | Main chat ticket 72 passes dogfood; project status lists the card, press and switch work |
| `83231d79` | 2026-10-20 | Project status: Windows CI covers the renamed credential pipe; runtime smoke still owed |
| `911ed23d` | 2026-10-20 | Sign in with ChatGPT: the plan mark follows the model, not the provider (decision 18, ticket 07) |
| `e8e00b2b` | 2026-10-20 | Design: the ChatGPT plan mark follows the model (SIWC decision 18) |
| `243cf22f` | 2026-10-20 | Sign in with ChatGPT: ticket 07 merged, to needs-dogfood |
| `74adc35c` | 2026-10-20 | Sign in with ChatGPT: ticket 07 passes dogfood; decision 18 in the devlog and project status |
| `e0d61b2e` | 2026-10-20 | IM: a line to the same assistant; private chats join the main chat (PRD + devlog) |
| `24b1c35e` | 2026-10-20 | IM merge decision 5: Discord keeps DMs closed and stays as it is |
| `b767def5` | 2026-10-20 | IM merge ticket 01: Feishu typing signal is a reaction; WeChat window probe running |
| `f8390139` | 2026-10-20 | IM merge decision 7: borrow iOS ruling 17 for the desktop side only |
| `06fbd3df` | 2026-10-20 | IM merge decision 7: JC confirms the corrected notification rule |
| `d0e2b017` | 2026-10-20 | IM merge ticket 01: hand the WeChat window probe to the next session |
| `0aa4151b` | 2026-10-21 | IM merge ticket 01: WeChat window probe lost to a forced reboot; take 2 ready |
| `40fbf7bd` | 2026-10-21 | IM merge ticket 01: WeChat window probe take 2 captured; A2 and A3 delivered |
| `d88399ef` | 2026-10-21 | IM: keep the channels' own agents; the merge PRD is shelved, ticket 01 closed |
| `f02bb942` | 2026-10-21 | Docs: undo the IM merge's edits now that the channels keep their own agents |
| `eed4cc5e` | 2026-10-21 | IM polish: process behind a button, Discord unfrozen, Feishu round, honest entry layer |
| `7c1ab296` | 2026-10-21 | IM polish 01: ticket to needs-dogfood with deviations, gaps and the dogfood list |
| `12edf8de` | 2026-10-21 | IM polish ticket 03: Feishu current-to-target table before the patch |
| `e9768762` | 2026-10-21 | IM polish ticket 03: implementation notes, open points; needs-dogfood |
| `69fba34b` | 2026-10-21 | IM polish ticket 04: Feishu headings as bold lines, quote the trigger when it is not adjacent |
| `ed4812df` | 2026-10-21 | IM polish ticket 04: implementation notes, deviations, gaps; needs-dogfood |
| `7ecfca1c` | 2026-10-21 | IM polish ticket 01: Telegram dogfood; the expanded process is always a plain quote |
| `16b63be6` | 2026-10-21 | IM entry layer eval: without / with on the IM channels' model; ticket 02 done |
| `f5b26a21` | 2026-10-21 | Devlog: IM polish, process behind a button, Feishu's first pass, honest entry layer |
| `7336fe56` | 2026-10-21 | Session close: IM polish in project status; how to feed the patch replay |
| `703f5c17` | 2026-10-21 | Screenshot playbook: add todos.png, the to-do panel beside the main chat |
| `5886f19f` | 2026-10-21 | Devlog: README closeout notes, the one-line positioning still to sync and push with the release |
| `5cddf0cc` | 2026-10-21 | Assistant ruling 10: proactive first stage rooted in the to-do list |
| `60f4cb6a` | 2026-10-21 | Assistant ruling 10: open documents with the default app from file cards |
| `c61045ef` | 2026-10-21 | Ticket 74: execution report in Comments |
| `086bd5cf` | 2026-10-21 | Trial snapshot: undated to-dos, cancels by whom, the morning review |
| `58edfbeb` | 2026-10-21 | Docs: the morning review and acting unasked (ticket 73) |
| `2cd042b3` | 2026-10-21 | Eval: ticket 73 on gpt-6.1-sol: new cases, the morning review, file handover |
| `eab5c225` | 2026-10-21 | Ticket 73: section seven (open documents) and the implementation report |
| `3f646cce` | 2026-10-21 | Eval: name the model's route neutrally, not by the local provider |
| `20af6ea3` | 2026-10-21 | Tickets 73, 74: merged, real-device steps, needs dogfood |
| `411b4eae` | 2026-10-21 | Assistant ruling 10: the morning review speaks like a person, only when worth it |
| `59cd4535` | 2026-10-21 | Ticket 75 eval: judge the review by what it says, rerun the four cases |
| `ef00a226` | 2026-10-21 | Ticket 75: implementation report in the ticket's comments |
| `2543380c` | 2026-10-21 | Ticket 75: merged, real-device steps, needs dogfood |
| `23b4c6f2` | 2026-10-22 | Main chat ruling 125: tickets 76 and 77 from the first morning-review dogfood |
| `bd32c2c9` | 2026-10-22 | Main chat ruling 126: the review off the hour, mixed wakes checked (ticket 78) |
| `dbfdc9e4` | 2026-10-22 | Ticket 76: merged, needs dogfood |
| `63788fef` | 2026-10-22 | Ticket 77: implementation report in the ticket's comments |
| `2c4409c4` | 2026-10-22 | Ticket 77: merged, needs dogfood; ruling 125 records the measured cap |
| `9af9aff8` | 2026-10-22 | Main chat ruling 127: carry ten turns, skip silent wakes (ticket 79) |
| `68391b66` | 2026-10-22 | Deferred stage two: calendar and mail first, read locally; Claude Duet comparison |
| `50bea3a9` | 2026-10-22 | Ticket 78 eval: the review in one wake with a reminder or a subtask's result |
| `675893b3` | 2026-10-22 | Ticket 78: implementation report in the ticket's comments |
| `08e310f1` | 2026-10-22 | Ticket 78: merged, needs dogfood |
| `9a2c875e` | 2026-10-22 | Eval: port the carried Main Chat section (ticket 79) |
| `5287da3a` | 2026-10-22 | Ticket 79: implementation report in the ticket's comments |
| `060ec047` | 2026-10-22 | Ticket 79: merged, needs dogfood; drop the eval's unused carried-2/3 templates |
| `73a44bb3` | 2026-10-22 | Project status: the assistant acts unasked, a morning review (tickets 73-79) |
| `9692f9f2` | 2026-10-22 | Ruling 128: the to-do from first principles; tickets 80, 81 |
| `cffba49f` | 2026-10-22 | Ruling 129: done rows quieter, routine fires out of done; tickets 82, 83 |
| `af4de491` | 2026-10-22 | Design: to-do panel empty state beside the review, notes line, cancelling Galley's own reminders (ticket 80) |
| `a3b421c9` | 2026-10-22 | Ticket 80: implementation report in the ticket's comments |
| `ee6b9b3a` | 2026-10-22 | Ticket 80: merged, needs dogfood |
| `fb205462` | 2026-10-22 | Ruling 128 point 9: autostart hint leaves the review out; 12px between groups |
| `0ca6c706` | 2026-10-22 | Ticket 83: implementation report in the ticket's comments |
| `b9bb6d39` | 2026-10-22 | Ticket 83: merged, the switcher waits for JC's pick |
| `516d3acc` | 2026-10-22 | Eval: notes written for the user (ticket 81) |
| `b4609f7f` | 2026-10-22 | Ticket 81: implementation report in the ticket's comments |
| `12129063` | 2026-10-22 | Eval: the review's nothing-to-do case is skipped on a real machine now |
| `d74d5c4a` | 2026-10-22 | Ticket 82: implementation report in the ticket's comments |
| `3365b84b` | 2026-10-22 | Tickets 81, 82: merged, need dogfood |
| `9aa1fa9e` | 2026-10-22 | Ruling 129: B it is; ticket 84 writes B and takes the switcher out |
| `c014eb6d` | 2026-10-22 | Ruling 130: panel density measured against Apple Reminders; ticket 85 trial |
| `59da91bf` | 2026-10-22 | Design: done items on B — a neutral ticked box, muted titles (ticket 84, ruling 129) |
| `c49576c6` | 2026-10-22 | Ticket 84: implementation report in the ticket's comments |
| `1077dc7c` | 2026-10-22 | Ticket 84: merged, needs dogfood |
| `f5c5e265` | 2026-10-22 | Ticket 85: implementation report in the ticket's comments |
| `e6d2dc85` | 2026-10-22 | Ticket 85: merged, the density switcher waits for JC's pick |
| `24d9a77a` | 2026-10-22 | Ruling 130: B+C it is; ticket 86 writes it and takes the switcher out |
| `00b60ece` | 2026-10-22 | Tickets 80, 83-85 done on JC's dogfood; 81, 82 wait on two steps not yet walked |
| `b1e6cf6d` | 2026-10-22 | Design: the to-do panel's own to-dos run as one unlabelled part; tighter group labels (ticket 86, ruling 130) |
| `f6604342` | 2026-10-22 | Ticket 86: implementation report in the ticket's comments |
| `6a1f8b6a` | 2026-10-22 | Ticket 86: merged, needs dogfood |
| `90f07978` | 2026-10-22 | Project status: the to-do panel from first principles (tickets 80-86) |
| `b72df393` | 2026-10-22 | Ruling 131: how the to-do panel opens and closes; ticket 87 writes it |
| `2fb578a2` | 2026-10-22 | Deferred: Galley's own browser profile on the user's Chrome / Edge (dedicated-browser PRD) |
| `08723de9` | 2026-10-22 | Design: the to-do panel's open and close (ticket 87, ruling 131) |
| `31f37af7` | 2026-10-22 | Ticket 87: implementation report in the ticket's comments |
| `c6a68182` | 2026-10-22 | Ticket 87: merged, needs dogfood |
| `9a0dab96` | 2026-10-22 | Project status: the to-do panel's open and close (ticket 87) |
| `e0c1a13c` | 2026-10-22 | Design: a preview opened narrow replaces the to-do panel on widening (ticket 87) |
| `e0fe0157` | 2026-10-22 | Ruling 131, devlog: the narrow-preview fix after ticket 87 merged; index the fourth round |
| `d584dc0e` | 2026-10-22 | Ticket 87: the narrow look, card title and narrow-preview fix pass JC's dogfood; the one opening and lit rows still to walk |
| `78afc6c9` | 2026-10-22 | Ticket 87: done on the walk; the landing-follow fix in design, devlog and status |
| `98cdabd1` | 2026-10-22 | Ticket 87: correct the walk note, the main chat's messages can be deleted (tickets 32, 38) |
| `453ceaa4` | 2026-10-22 | Ruling 132: delete your own to-do from the panel; ticket 88 writes it |
| `31e49f3d` | 2026-10-22 | Ticket 87: the walk's rounds deleted from the main chat at JC's word |
| `e7daad75` | 2026-10-22 | Ruling 133: new to-dos are still said, not typed; a talk row at the panel's foot (ticket 89) |
| `bde739d3` | 2026-10-22 | Ticket 88: the to-do panel's delete in design, managed runtime and Agent API docs |
| `0cb7d340` | 2026-10-22 | Ticket 88: implementation report |
| `0e4a1773` | 2026-10-22 | Ticket 88: addendum on the done guard and the manual line |
| `0f2414e7` | 2026-10-22 | Tickets 88, 89: merged, need dogfood; the foot row in design; project status |
| `d62842b5` | 2026-10-22 | Ticket 89: the header icon in design, ruling 133, devlog and status |
| `ae5a4b0b` | 2026-10-22 | Ticket 89: the plus in design, ruling 133 and the ticket |
| `a4a9c643` | 2026-10-22 | Tickets 88, 89: done on JC's dogfood |
| `04380be1` | 2026-10-22 | Release rules: next release is v0.7.0, and the three conditions for v1.0.0 （本地 HEAD，未推送到 GitHub；按标题判为文档，待复核） |

## 统计

- 区间提交 684 个 = 第一张表 245 + 纯文档 439。
- 第一张表里归到条目的 185 个，写明省略理由的 60 个；加上纯文档，省略合计 499 个。
- 每个条目对应的提交数：

| 编号 | 提交数 |
|---|---|
| E0 | 2 |
| A1 | 14 |
| A2 | 21 |
| A3 | 9 |
| A4 | 9 |
| A5 | 3 |
| A6 | 14 |
| A7 | 26 |
| A8 | 7 |
| A9 | 6 |
| F2 | 2 |
| B1 | 9 |
| B2 | 11 |
| B3 | 6 |
| B4 | 3 |
| B5 | 2 |
| B6 | 1 |
| C1 | 12 |
| C2 | 3 |
| C3 | 3 |
| D1 | 1 |
| D2 | 2 |
| D3 | 2 |
| F1 | 5 |
| F3 | 1 |
| F4 | 3 |
| U1 | 2 |
| U2 | 1 |
| U3 | 0 |
| U4 | 0 |
| U5 | 3 |
| U6 | 1 |
| U7 | 1 |

（U1–U6、E0 还有不少提交在说明列里以「→」挂靠，上表只按主归属计数。）

- 省略按理由：

| 省略代码 | 提交数 |
|---|---|
| X-试验 | 25 |
| X-撤回 | 9 |
| X-取代 | 9 |
| X-远程 | 7 |
| X-内部 | 4 |
| X-测试 | 1 |
| X-开发 | 3 |
| X-文档 | 441 |

