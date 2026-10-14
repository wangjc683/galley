# 重置主对话：设置深处、长按 5 秒

日期：2026-10-14
关联：[主聊天 PRD](../../.scratch/main-chat/PRD.md)（裁决 14、59）、票 [15](../../.scratch/main-chat/issues/15-reset-main-chat.md)、
[overlays-and-settings.md](../design/overlays-and-settings.md)「确认弹窗」与「Runtime → 更多」、
[code-state-and-patches.md](../managed-ga-runtime/code-state-and-patches.md)、[deferred](./deferred.md)「主对话里删单条消息」

## 起因

JC：「主对话是一个持续的、长久存在的。那如果用户想要删除某条信息，甚至整个主对话重置清空，是不是可以给用户这一个选项？……重置整个主对话的按钮应该要放的比较深，然后要多重防护，让用户多次确认才能做」。

## 定下来的

- **与裁决 14 的关系**：裁决 14 否掉的是把重置当整理上下文的手段（「没有重置键：由切段承接」）；这次是数据出口，所以不翻 14，日常仍然没有重开键。
- **删单条消息不做**，进 deferred：删掉记录后，当前这一段的上下文、长期记忆、模型服务商那里都还在，等于许诺做不到的事。
- **重置 = 清空主对话 + 长期记忆回到出厂**，一个动作、不给勾选；迁移前的自动备份一起删（每份都是数据库和记忆的整份拷贝），删完整理数据库。不做撤销，不进 CLI、socket、手机协议，模型触发不了。
- **入口**：设置 → 运行环境 → 更多的最后一行，只在内置运行时且有主对话时出现，有对话在跑时禁用。
- **确认方式由 JC 改为长按 5 秒**：我初稿写的是输入「重置」二字，JC 嫌没必要，提长按加进度条。我同意：Galley 鼠标优先，打字要把手挪去键盘；误触不会超过一两秒，余下的时间是松手就能反悔的时间。回车、空格不触发。
- **内核的运行日志不删**（`temp/model_responses/`）：认不出哪份属于主对话，新主对话被问起旧事时可能翻到。我提出来后 JC：「翻旧对话的原始日志我觉得没有啥问题」。随之弹窗文案用 A 版：「会删除」第一条说「聊天记录」而不是「全部记录」，「不会删除」加一条「内核的运行日志（30 天后自动清掉，这之前它翻历史仍可能读到）」；被否的 B 只改「全部」不加这条，用户重置后问起旧话它若答得上来，会以为没删干净。

## 实现与审查

子代理在 worktree 里实现（dev 常驻主工作树），六个提交 `71f2323e`–`8d7c655f`，主会话审查后合入。

- **顺序与回滚**：先把 `memory/` 改名挪开、拷入种子，再用一个事务删行，事务提交后才删挪开的旧记忆；拷贝或事务失败，旧记忆原样挪回。票里原写先删行，这样改了，就不会出现「对话清了、记忆还在」的半截状态。
- **「在跑」判据**：Core 知道的会话里有没有打开的运行或在跑的回合；排队的消息不算（崩溃后卡住的队列会让重置一直被拒）。IM 渠道在自己的进程里跑引擎，Core 看不到，记为已知限制：IM 恰好在整理记忆时重置，可能把一部分旧记忆写回新目录。
- **整理数据库**：`VACUUM` 之外加了全文索引 `optimize` 和 `wal_checkpoint(TRUNCATE)`，否则删掉的文字还留在 WAL 和索引旧段里；有一条测试直接读库文件字节确认。
- **审查补的一处**：GA 只在 runner 启动时按模板建 `global_mem.txt`、`global_mem_insight.txt`，而其他活着的 runner 和 IM 进程每轮都重读。重置后到下一个 runner 起来之前，它们的系统提示里整段记忆说明都会缺；这期间模型若自己写出 `global_mem_insight.txt`，GA 以后不再按模板重建。改为重置成功后 Core 在后台起新主对话的 runner，让 GA 自己的启动代码去建，Core 不复刻 GA 的初始化。
- **子代理报错的一条风险**：它说 runner 超时被强杀会弹「Bridge 进程崩溃」；`shutdown` 与 `kill` 先设了 `expected_close`，退出按 code 0 上报（`core/src/runner_manager/process.rs:391`），不会误报，核实后改写。

## 真机验收（JC，13:31）

重置前在仓库外做了备份（`sqlite3 .backup` 在线快照，会话与消息数对过；`memory/` 逐文件比过；三份迁移备份用 APFS 克隆）。之后只读核对：

- `memory/` 从 51 个文件变成种子的 43 个加两个模板文件：种子文件全在、内容与种子一致，`verify_sop.md`、`skill_search/`、原来的 `global_mem*` 都没了（`file_access_stats.json` 是之后聊天时引擎新建的）；没有 `memory.reset-*` 残留；
- 三份 `app.galley.backup.*` 已删；旧主对话在 `sessions`、`messages`、`messages_fts` 里都是 0 行；新主对话从问候开始；`temp/` 还在；数据库从 17.8 MB 降到 16.6 MB。

顺带发现：重建的 `global_mem_insight.txt` 是英文模板，重置前那份是中文。GA 按 runner 进程的 locale 选语言（`managed-ga/code/agentmain.py:2`，`GA_LANG` 未设时 `zh` 只给中文 locale），JC 的开发环境是 `LANG=en_US.UTF-8`，所以系统提示词本来就用英文（[入口层评测](../../.scratch/main-chat/entry-layer-eval/README.md) 已记）。不是重置的问题，Galley 要不要按界面语言给 runner 设 `GA_LANG` 另议。
