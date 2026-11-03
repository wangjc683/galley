# 141 诊断：主对话记待办、备忘、定时前，为什么先读一遍清单

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 190 第 4 条。**只读诊断，不改代码**：查清原因、给改法与预计省下的步数，改不改由 JC 定。只涉及内置运行时的主对话；外置没有主对话。

## 为什么

- 主对话里你发起的 68 轮中，24 轮用到待办、备忘、定时，跑了 63 次 `galley` CLI（`code_run` 里起子进程）。这 24 轮中位 4 步、43 秒，p90 68 秒；一步一次模型调用，中位约 9 秒，时间主要花在步数上。
- 63 次 CLI 里读多写少：`todo show` 26、`schedule list` 21、`todo list` 19、`memo list` 6；写（`todo add`、`todo update`、`schedule create`、`memo add` 等）约 27。
- 主对话的提示词本来就带着手上的待办与备忘：`core/src/managed_prompt.rs` 的 `compose_main_chat_runtime_prompt`，`in_hand_section`（`:765` 一带，`in_hand_todo_line`、`in_hand_task_line`）与备忘那一节。它为什么还先 `show` / `list`？

## 要回答

1. **逐轮拆**：这 24 轮（10-20 起，主对话 `sessions.main_chat = 1` 那一行；以你真实库里的为准，数目不同就照实写）每一轮几步、每一步干了什么、每次 CLI 跑了哪些子命令（一段脚本里常连跑几条）、各用了多久。
2. **每一次读归类**：
   - （a）要的东西提示词里没有：比如 id、子项、备注、已完成的、定时（`schedule`），或者条数超过那一节的上限、被「其余 N 条」折掉了；
   - （b）写完之后再读一遍确认；
   - （c）提示词里已经有，重复读；
   - （d）别的（写清是什么）。
   每一类数次数、占多少步、多少秒。判断「提示词里有没有」要对着当时那一轮的提示词：先读 `in_hand_section` 与备忘一节的代码，看它写出哪些字段、上限几条；能从引擎日志（内置状态根 `managed-ga-state/temp/model_responses/`）或当时的库状态还原那一节的，照实还原；还原不了的写明是推断。
3. **写入命令返回什么**：`todo add` / `update` / `item`、`schedule create`、`memo add` 现在回给模型的输出里，有没有改好的那一条（id、标题、时间、子项）；没有的话，模型为确认多读的那一步就是从这里来的。
4. **改法与预计省下的**：按上面的归类，给最小改法（提示词那两节补哪些字段、上限要不要调；写入命令回改好的那一条，这是 CLI JSON 的加法，宪法第 3 条；手册哪句让它先读），每一种估省几步、几秒，依据写清；不加新机制、不加工具（裁决 190）。也写明哪些读是该读的、不该省。
5. **顺带**：这 24 轮里有没有失败或绕路（报错、重试、读手册、找 CLI 路径），各几次。

## 怎么做

- 真实数据库只读打开（sqlite3 `-readonly`，或 `file:…?mode=ro` URI）；`messages` 的 `tool_calls` / `tool_results` 是 JSON（`toolName`、`args`）；一轮的开头是 `sequence = 0` 的 user 行（票 136 起插话的 user 行 `sequence` ≥ 2）；`turn_index` 按步编号，不按轮；每轮用时取最后一步 `telemetry_json.elapsedMs`。
- 只读代码：`core/src/managed_prompt.rs`、`core/src/assistant_todo.rs`、`cli/src/`、手册 `docs/managed-ga-runtime/galley-assistant-manual/`（`cli.md`、`todo.md` 或同类）。
- 不改任何代码、提示词、手册；不写数据库；不调真模型；不跑 `tauri dev`。

## 隐私（重要）

这些是 JC 真实的待办、备忘与提醒。**票面与报告里不抄任何原文**：标题、备注、人名、地名、金额、日期、文件路径都不写。只写形状：「一条带 3 个子项的待办」「一条定时提醒」「用户改了一条待办的截止时间」；要举例时用虚构的字（比如「周五前把资料清单发给 A 公司」），并标明是虚构。会话 id、消息 id 也不写进票面。11-02 票 119 曾把真实备忘原文抄进票面，推送前不得不改写提交。

## 环境与边界

- 不需要 worktree：只读主树的代码与真实库，只写本票面。临时脚本放 scratchpad，用 `t141-` 前缀；跑完不留在仓库里。
- 搜索用 grep，不用 rg。中文一律全角标点。票面里不写本机用户目录、服务商名、接口主机。
- 提交：只点名本票文件，`git add` 与 `git commit` 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；提交前 `git status` 确认只有本票文件（主树有别的会话在改，不要带上别人的改动）。不 push。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：逐轮拆的汇总（不抄原文）；读的归类与次数、步数、秒数；写入命令现在回什么；改法与预计省下的步数、秒数；失败与绕路；提交号（照抄 `git log --oneline -1`）；看到但没查清的（Open risks），原样列出。
