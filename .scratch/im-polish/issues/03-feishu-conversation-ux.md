# 03 飞书对话体验对齐

Status: done（2026-10-21 JC：其余不用测，直接合；未真机的项见 devlog「真机」一节）

来源：[PRD](../PRD.md) 裁决 3。

飞书从没做过对话体验这一轮，对话层还是上游 `frontends/fsapp.py` 原样（Galley 的 `0009`、`0011`、`0012`、`0013` 只做接入与小修）。今天：在跑时是一张卡片，状态行 +「Turn N · summary」逐步折叠面板（`fsapp.py:850` 一带），回复写进同一张卡片的分隔线下；在跑时再发会被直接拒绝（`fsapp.py:968` 一带）。

## 目标形态（母本：Telegram / Discord 09-30 定稿与本轮 PRD 裁决 1）

先读码、读飞书开放平台文档，把「现状 → 目标」逐行对表写进本票 Comments，再动手。下面是主会话按先例推出来的目标，对表时核实；平台做不到或与先例冲突的，写进 Comments 交 JC，别自己另起形态。

1. **在跑时**：在你那条消息上挂 `Typing` 表情，回复（或停止、出错）发出后撤掉。接口与表情 key 照 [IM 并入票 01](../../im-one-assistant/issues/01-platform-probes.md) B 的真机结果（加、删都 `code 0`，不推送、不动会话列表、撤掉不留痕）。不再在开跑时先发状态卡片。
   理由（对表时核实）：机器人每发一条新消息都推送；今天开跑那张卡推送一次，回答写进同一张卡时没有新推送，推送和会话列表预览看到的是状态、不是回答。Telegram 的规矩是一轮只推一次、预览从回答开始（09-30 devlog）。
2. **回复**：一条消息，正文只放回答（收尾那一步，清洗口径同 Telegram / Discord：去工具回显、去 `<summary>` 等标签、`[FILE:]` 显示文件名）。
3. **过程入口**：≥ 2 步时在回复里给一个默认收起的入口，标题「过程」，展开区第一行 `N 步 · 用时 X`，下面逐步 `NN 摘要`；1 步什么都不挂（PRD 裁决 1 的母本：入口是动作、数字不在表面）。飞书卡片若有原生的折叠面板（默认收起），优先用它：不靠回调、不靠进程内缓存、重启后照样能展开；没有就用按钮，规则同票 01 的 Telegram。
4. **在跑时再发**：排队，不拒绝；轮到时给那条消息挂 `Typing`。语义同 Telegram 0024 的 run 列表（只有一个 agent，按入队顺序执行）。
5. **停止**：`/stop` 停正在跑的那条，回一句 `⏹ 已停止 · N 步 · 用时 X`（`stopped_text`）；不误伤排队的与报告轮（Telegram 0024 的实施偏差一节有坑）。
6. **提问（ask_user）**：照 Telegram / Discord 的规则（`candidate_layout` 出候选、答后在原题上标出所选、打字回答后旧候选失效）。卡片按钮需要应用订阅卡片回调；先查 Galley 的飞书接入今天有没有收卡片回调，没有就照微信的做法回数字，并在 Comments 写明要用户在开放平台另开什么才能用按钮。
7. **回复写法**：飞书卡片 Markdown 支持的语法有限，表格、标题等照 Telegram 的源文本改写（`galley_im_display.tables_to_lists` 等）处理到能正常显示。
8. **完成报告**（`runner/im_reporter.py` 的飞书那一支）：口径对齐（只取收尾一步），格式照 Telegram / Discord 报告的标题、正文、脚注三段落到飞书能显示的样子。

## 约束

- 新补丁取下一个编号（今天最大是 `0028`），排在 `0024` 之后，才能 import `frontends/galley_im_display.py` 的共享逻辑；平台无关的逻辑往那里放。补丁流程照 `docs/managed-ga-runtime/code-state-and-patches.md`；干净克隆重放全部补丁、重建后 `managed-ga/code` 哈希一致；台账与 `docs/ga-baseline.md` 的耦合点同步。
- 不动 `0009`、`0011`、`0012`、`0013` 的语义；需要改它们时照「后续补丁要随之重导出」的规则。
- import `managed-ga/code` 的脚本与测试用 `python -B`。
- 读飞书开放平台的现行文档（消息表情回复、卡片 JSON 2.0 的折叠面板、卡片回调），别凭记忆；记下文档出处。
- 群聊（@ 机器人）同样适用，Typing 挂在触发的那条消息上。
- 测试要补：排队不拒绝、Typing 加删配对（出错、停止也要撤）、≥ 2 步有过程入口而 1 步没有、提问路径、报告口径。

## 验证

- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`、`git diff --check`。
- `node scripts/check-managed-ga-payload.mjs`、`node scripts/check-ga-baseline-drift.mjs`。

## 交付

在 worktree 分支上提交（只点名文件）。票 Comments 写对表、实施偏差、交 JC 定的点、没验证到的；Status 改 `needs-dogfood`。真机验收由 JC 在 dev 里「重启 Channels」后在飞书私聊里做：一个 1 步、一个多步的问题，在跑时再发一句，`/stop` 一次，触发一次提问。

## Comments

- 2026-10-21 对表（执行子代理，动手前）：现状 → 目标，逐条附代码行与文档出处。代码行号指 `managed-ga/code/frontends/fsapp.py`（`0009`–`0013`、`0019` 之后的成品），平台文档是当天读的飞书开放平台现行页。

  **在跑时（目标 1）**
  - 现状：`run_agent`（`fsapp.py:966`）一开跑就 `card.start()`（`:899`）发一张新卡片「🤔 思考中...」，之后每步 `step()`、收尾 `done()` 都是 PATCH 同一张卡（`_push`，`:881`），状态行 +「Turn N · summary」逐步折叠面板（`_step_panel`，`:863`），回答在分隔线下（`_build`，`:873`）。
  - 核实「推送和会话列表预览看到的是状态、不是回答」：**读码成立**。整轮只有开跑那一次是新消息（`_send_raw`），回答是 PATCH。PATCH 不推送这一点开放平台文档没写明，按「编辑不推送」的平台常识推，没真机验；会话列表预览：卡片 JSON 2.0 的 `config.summary` 是「飞书客户端聊天栏消息预览中的文案」（卡片 JSON 2.0 结构页），今天的卡片没设它，预览显示什么文档没写默认值。
  - 目标：开跑不再发卡片；在触发的那条用户消息上挂 `Typing`（开放平台「添加消息表情回复」`POST /open-apis/im/v1/messages/:message_id/reactions`、「删除消息表情回复」`DELETE …/reactions/:reaction_id`；权限 `im:message` 或 `im:message.reactions:write_only` 任一即可，Galley 设置页的飞书教程已要求 `im:message`；`Typing` 在「表情文案说明」页的列表里；只能删自己加的表情）。lark-oapi 1.6.8（内置 Python 里的版本）有 `client.im.v1.message_reaction.create / delete`。回复、提问、停止回执或出错消息发出后撤掉；撤掉放在 `finally` 里。
  - 回复卡片设 `config.summary` 为回答第一行（去掉 Markdown 记号），让预览从回答开始；推送正文取不取 summary 文档没写，交真机看。

  **回复（目标 2）**
  - 现状：回答取自收尾那一轮 hook 的 `resp.content`（`_make_task_hook`，`:937–943`，`_finish` 先到先得），经 `_display_text`（`:147`，只去 `<thinking>` 等标签和 `[FILE:]`）写进同一张卡。`[FILE:]` 直接删掉，不显示文件名。
  - 目标：新发一条卡片消息，正文只放收尾一步，清洗口径同 Telegram（`galley_im_display.answer_body` + `final_step_text`，`[FILE:]` 在清洗前换成文件名，同 tgapp `_answer_from`）。超过 4000 字分成几张卡（卡片请求体上限 30 KB，「发送消息」页），过程入口挂在最后一张。卡片发不出去时退回纯文本消息。

  **过程入口（目标 3）**
  - 核实「飞书卡片有原生折叠面板、默认收起、不靠回调」：**成立**。卡片 JSON 2.0「折叠面板」`collapsible_panel`：`expanded` 默认 `false`，展开收起是客户端行为，文档没有任何交互回调；今天的 `_TaskCard` 已经在用它（`:868`）。卡片 JSON 2.0 要客户端 7.20 起，更老的客户端只显示标题和升级提示（卡片 JSON 2.0 结构页）；今天的卡片已经是 2.0，这一条不是新代价。
  - 目标：≥ 2 步时回复卡片末尾一个默认收起的折叠面板，标题「过程」，图标用文档示例的 `down-small-ccm_outlined`（跟在文字后，展开转 180°）；展开区第一行 `N 步 · 用时 X`（`fold_label`），下面逐步 `NN 摘要`（`step_summary`，最多 30 行，前面的折成「… 前 K 步略」）；卡片超 28 KB 时步行依次截到 60、24 字（同 Telegram 今天的规则）。1 步什么都不挂。每行一个纯文本 `div`：纯文本里的 `\n` 换不换行文档没写，Markdown 的单换行文档写「可能会被忽略」，一行一个组件最稳。不用按钮，所以不需要进程内缓存，重启后照样能展开。

  **在跑时再发（目标 4）**
  - 现状：`if self.user_tasks:` 直接回「当前会话已有任务在运行，请等待完成或发送 /stop 后再试。」（`:967–969`）。另外每条消息各起一个线程跑 `asyncio.run(run_agent)`（`:1086–1090`），两条连发时谁先 `put_task` 不确定。
  - 目标：同 Telegram `0024` 的 run 列表：全局按入队顺序的 `_RUNS`，在事件线程上登记并 `put_task`（保证消息顺序就是 GA 的任务顺序），一个按需起的工作线程只读队首的 display queue；轮到时给那条消息挂 `Typing`。排队期间不发任何东西（票面没要求排队提示，飞书也没有可以原地改的状态消息）。
  - 顺带：今天单个任务 900 秒超时就 abort 并回「任务超时」（`AGENT_TIMEOUT_SEC`，`:1004`）。Telegram / Discord / 微信都没有这条（微信对齐时当缺陷去掉：超时会把还在跑的长任务砍掉），这里一并去掉，只有 `done` 或 `/stop` 结束一轮。

  **停止（目标 5）**
  - 现状：`/stop` 走 `AgentChatMixin.handle_command`（`chatapp_common.py:280–285`）：无条件 `agent.abort()`（在跑的是报告轮也停），回「⏹️ 正在停止...」，卡片随后改成「❌ 已停止」。
  - 目标：只停 GA 正在跑的那条用户 run（`agent.is_running` 且 `agent._current_queue` 是它的 display queue；报告轮、排队的、两次任务之间都回「当前没有在跑的任务」，什么都不 abort），在任何等待之前同步标记为停止，回一句 `⏹ 已停止 · N 步 · 用时 X`（`stopped_text`），撤掉 `Typing`。`/new`、`/restore`、`/continue n` 打断在跑的 run 时同样先出停止回执（`/continue n` 照微信的 `_stopping_on_abort`：在 `abort` 里面标记）。

  **提问（目标 6）**
  - 现状：没有 ask_user 的 hook。提问那一轮 hook 拿到的是 `resp.content`（旁白），问题和候选在工具参数里，按读码推断会被吞掉，只剩旁白（与 Discord 对齐前的缺陷同类）；没真机复现。
  - 核实「Galley 的飞书接入今天收不收卡片回调」：**不收**。`main()` 只注册了 `register_p2_im_message_receive_v1`（`:1101`）；设置页教程只让用户订阅 `im.message.receive_v1` 事件。卡片按钮要用回调 `card.action.trigger`（「卡片回传交互」，开放平台「处理卡片回调」页：开发配置 → 事件与回调 → 回调配置，订阅后要发布新版本才生效，3 秒内必须响应）；lark-oapi 1.6.8 的长连接客户端能收卡片帧（`register_p2_card_action_trigger`、`ws/client.py` 的 `MessageType.CARD`）。
  - 目标：照微信回数字。提问发一张卡片：旁白、问题、候选按 `1. 2. 3.` 编号，末行小字 `⏸ 回复序号或文字 · 已完成 N 步`（多选 `⏸ 可多选，回复序号或文字 · …`，没候选 `⏸ 等你回复 · …`）。下一条纯文字消息就是回答：单选回一个范围内的数字换成那个候选（全角数字也认），多选回一串数字换成「；」连起来的候选（同 Telegram 多选「提交」），其余照原文；步数和用时接着算（ask_user 不切断 run）。答后把提问卡片 PATCH 成回显：末行改 `已回复 · 已完成 N 步`，所选的前面打 ✓、其余变灰；打字回答什么都不勾。新的提问、`/new` 让旧的待答失效。图片、文件消息不算回答（同微信）。`candidate_layout` 只决定按钮怎么排，没有按钮就用不上，候选一律编号。

  **回复写法（目标 7）**
  - 核实「飞书卡片 Markdown 语法有限，表格、标题要改写」：**大半不成立**。卡片 JSON 2.0 的富文本组件支持除 HTMLBlock 外的标准 Markdown：一到六级标题、引用、分割线、有序 / 无序列表、代码块、表格都原生渲染（「富文本（Markdown）」组件页）。表格有两条限制：单个组件最多 4 张，表头之外超过 5 行就分页。图片语法只认上传后的 `image_key`。
  - 目标：标题、引用、分割线、列表、代码块原样交给卡片；表格照 Telegram 改成列表（`tables_to_lists`），理由是 4 张上限和 5 行分页会让手机上一部分行看不到；图片语法改成链接（http / https）或替代文字，免得整张卡被拒。这一条交 JC 定（见下面「交 JC 定」）。

  **完成报告（目标 8）**
  - 现状：`FeishuChannel.render`（`im_reporter.py:407`）对整段 `done` 只做 `_display_text`，`LLM Running (Turn N) ...` 标记和每一步的 `🛠️ 工具(…)` 回显都会进报告；`send`（`:411`）发纯文本，Markdown 原样显示；`send_message` 失败只打印、不抛，报告会被记成已送达（违反 `ChannelAdapter.send` 的「MUST raise」）。
  - 目标：`render` 走 fsapp 新加的 `answer_text(raw)`（按 Turn 标记取收尾一步，清洗同回答，同 tgapp）；`send_report` 发卡片：粗体标题行 `✅ / ⏹ / ❌ {session 标题}`、正文（改写同回答）、末行灰色小字 `{状态词} · {session id}`（`report_status_word`），卡片 `summary` 是标题行；用新加的严格发送 seam，失败就抛；某张卡被拒时那一段改发纯文本，纯文本也失败才算重试。生成的文件照旧跟在报告后面（飞书报告今天就发文件，不改）。fsapp 没有这些 seam 时退回今天的 `send`。

  **结构与补丁**
  - 新补丁 `0029-managed-feishu-conversation-ux.patch`，只改 `frontends/fsapp.py`，叠在 `0009`、`0011`、`0012`、`0013`、`0019` 之上，不改它们的补丁文件：配置注入、长连接、配对、文件占位守卫原样。旧的卡片显示（`_TaskCard`、`_make_task_hook`、`_build_step_detail`，含 `0009` 的收尾面板与 `0013` 的报告轮标记）留在文件里但不再在运行路径上，等这几张补丁下次重导出时一并删。
  - fsapp 改成从顶层 `chatapp_common` 导入（同 tgapp / dcapp）：`galley_im_display` 自己就 `from chatapp_common import`，fsapp 还用 `frontends.chatapp_common` 的话进程里会有两份模块，`/continue`、`/btw`、`/review` 在 GA 类上各装两次（三个 `install` 只看最外层包装，交错安装时不幂等）。
  - runner 侧：`im_resume.install_feishu` 改接新 seam（接不上的提示挂在回答或提问的第一行，小字）；`im_reporter.FeishuChannel` 的 `busy` / `render` / `send_report` 改接新 seam。
  - 平台无关的新逻辑（展开区那几行、按回复数字认候选）先写在 `0029` 里，标注为可并入 `galley_im_display.py` 的候选，合入时由主会话归并（票 01 同时在改那个文件）。
- 2026-10-21 实施（执行子代理）：新补丁 `0029-managed-feishu-conversation-ux.patch`（只改 `frontends/fsapp.py`），runner 侧 `im_resume.install_feishu`、`im_reporter.FeishuChannel` 接新 seam；补丁台账、`manifest.json`、`docs/ga-baseline.md`（第 15、16 条，耦合点清单，Step 8 的飞书清单）同步。验证：干净克隆 `5205f40` 用 `build-managed-ga.sh` 重放 27 张补丁全 clean，`py_compile` 通过，重建后 `managed-ga/code` 与 `state-seed` 逐文件哈希与提交一致；pytest 614 passed（`test_managed_feishu_fsapp.py` 新增 18 条：1 步无入口、多步有收起面板、排队不拒绝且轮到才挂 Typing、`/stop` 只停在跑的、空闲与报告轮时什么都不停、`/new`、出错与发送异常都撤 Typing、提问回数字 / 全角数字 / 多选 / 打字 / 过期、图片不算回答、群聊、超长分卡、卡片被拒退纯文本、表格与图片改写、`[FILE:]`、报告 seam、只有一份 `chatapp_common`；`test_im_reporter.py` 新增 10 条，含过真实 fsapp 的报告；`test_im_resume.py` 的飞书部分改接新 seam）。对 `_running_run`、Typing 的 `finally`、1 步判断、待答认领各做了一次变异，分别有 1、6、1、2 条测试失败。mypy strict、ruff、`git diff --check`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 绿。

  **实施偏差**（各附理由）
  1. 目标 7 没有照 Telegram 全套改写：只把表格改成列表、图片语法改成链接，标题、引用、分割线、列表、代码块原样交给卡片。理由见上面对表（卡片 JSON 2.0 原生支持这些）；交 JC 定。
  2. 去掉上游的 900 秒超时（对表里写了，票面没提）：其余三个渠道都没有，微信对齐时当缺陷去掉过。
  3. 「轮到」按「排到运行列表队首」算，不等 GA 真正开始这条任务：报告轮在跑时，排在它后面的那条消息也会先挂上 Typing（机器人确实在忙，报告轮跑完就接着跑它）。Telegram 那边这时显示「·· 排队中」，飞书没有能原地改的状态消息。
  4. Typing 在回答和附件都发完之后才撤（票面写「回复发出后撤掉」）：附件是这一轮回复的一部分，先撤会出现「没在忙了但还在陆续来文件」。
  5. 提问卡片的状态行放在末行（`⏸ 回复序号或文字 · 已完成 N 步`，微信的位置和措辞；Telegram 在首行）：没有按钮，「回复序号」这句要读在候选之后。回显的措辞用 Telegram 的「已回复 · 已完成 N 步」。
  6. 多选题回一串数字（`1 3`、`1、3`）会换成「；」连起来的候选并在回显里打勾，同 Telegram 多选「提交」；微信是原样转给 GA。
  7. 出错消息照 Telegram：首行 `N 步 · 用时 X`，下一行 `❌ 出错：…`（微信只有后一行）。
  8. 完成报告的标题用卡片正文里的粗体行，不用卡片 header：header 是一整条彩色标题栏，比回答重得多；粗体行就是 Telegram 报告的样子。卡片的 `summary` 设成标题行。
  9. 旧的卡片显示代码（`_TaskCard`、`_make_task_hook`、`_build_step_detail`，含 `0009` 的收尾面板和 `0013` 的报告轮标记）没删，只是不在运行路径上：删它们要动 `0009`、`0013` 的区域，票面要求不动这几张的语义；台账写明下次重导出 fsapp 补丁时一并删。
  10. fsapp 改成从顶层 `chatapp_common` 导入（对表里写了理由）。`im_resume.install_feishu` 按 `AgentChatMixin.__module__` 找模块，不受影响。
  11. 回答不引用触发消息：Telegram 在「触发消息之后插进了别的消息」时用引用回复，飞书要换成「回复消息」接口并自己记消息先后，票面没要求，没做；交 JC 定。

  **交 JC 定**
  1. 表格：改成列表（现在的做法，同 Telegram；理由是单个组件最多 4 张表、超过 5 行分页，手机上部分行要翻页才看得到）还是用飞书原生表格。
  2. 标题：原样（一级标题 26px，手机聊天里偏大）还是像 Telegram 改成粗体行。
  3. 提问要不要做成卡片按钮：要做得让用户在开放平台「开发配置 → 事件与回调 → 回调配置」选「使用长连接接收回调」，订阅「卡片回传交互」`card.action.trigger`，再创建并发布新版本；Galley 这边注册 `register_p2_card_action_trigger`（lark-oapi 1.6.8 支持，3 秒内必须响应），设置页飞书教程加一节。现在照微信回数字，不需要任何额外配置。
  4. 中间插了别的消息时，回答要不要引用触发消息（偏差 11）。
  5. 「过程」面板的样子（图标跟在文字后、展开转 180°，步行灰色 14px）与报告卡片的样子，真机看过再定。

  **没验证到的**
  - 所有飞书服务端行为都没有真发：卡片 JSON 能不能被接受（`collapsible_panel` 的 header 与图标、`div` 的 `text_size` / `text_color`、`config.summary`、Markdown 里的 `<font color='grey'>`、`<br>`、HTML 实体转义），测试只核对了我们发出的 JSON 形状。被拒时回答和提问会退回纯文本（Markdown 不渲染）。
  - `Typing` 的加、删只在 lark-oapi 1.6.8 源码里核对了请求构造（`CreateMessageReactionRequest`、`Emoji`、`DeleteMessageReactionRequest`），没发过请求；接口本身 10-20 探针验过。
  - 推送正文取不取 `config.summary`、会话列表预览是否从回答开始；PATCH 提问卡片成回显时推不推送、挂不挂「已编辑」。
  - 群聊（@ 机器人）整条路径。
  - 28 KB 的卡片预算按 UTF-8 字节算，与服务端「请求体 30 KB」的口径是否一致。
  - 完成报告卡片的真机样子。

  **Open risks**
  - 卡片里若有一个字段服务端不认，每一轮回答都会先失败一次再走纯文本，`feishu.log` 会出现 `发送失败: <code>`；真机第一条就能看出来。
  - 运行列表、待答提问都在进程内：重启 Channels 时排队中的消息和待答提问会丢，旧提问卡片还挂着「⏸ 回复序号或文字」，这时回数字会作为普通文字交给 GA（同 Telegram / 微信）。
  - 超长回答切成几张卡，每张都推送（飞书机器人消息没有静默发送）；按 4000 字切，可能切在代码块中间（上游一直如此；微信那套按围栏切的拆分器在 runner 侧，补丁里用不上）。
  - 与票 01 的合入：`_process_lines`、`_PendingAsk.answer` 是平台无关逻辑，先写在 `0029` 里，归并进 `galley_im_display.py` 时 `0029` 要重导出；票 01 若改了 `answer_body`、`step_summary`、`fold_label`、`tables_to_lists` 的语义，飞书跟着变。两张票都改了补丁台账头部和 `manifest.json` 末尾，会有文本冲突。
  - `0029` 叠在 `0009`、`0011`、`0012`、`0013`、`0019` 之上，以后其中任何一张改了 `fsapp.py` 的行数，都要在其上重导出 `0029`（台账已写）。

  **JC 真机清单**（dev 里「重启 Channels」后；开放平台不用另开任何配置：`Typing` 用教程里已有的 `im:message` 权限，折叠面板不靠回调）
  1. 私聊发一个 1 步的问题：你的消息上出现 `Typing`，回答到时消失；回答是一张卡，没有「过程」；看推送和会话列表预览是不是从回答开始。
  2. 发一个多步的问题：在跑时只有 `Typing`、没有状态卡；回答卡片末尾「过程」默认收起，点开第一行 `N 步 · 用时 X`，下面逐步 `01 …`；看收起、展开的手感，图标位置，灰字大小。
  3. 在跑时再发一句：不被拒；第二句要等第一句的回答出来才挂 `Typing`；两条回答按顺序到。
  4. 长任务中 `/stop`：只来一条 `⏹ 已停止 · …`，`Typing` 撤掉，之后没有回答；空闲时 `/stop` 回「当前没有在跑的任务」。
  5. 触发一次提问（例如「帮我导出一份报告，先问我要什么格式」）：提问卡片候选带编号，末行「⏸ 回复序号或文字 · 已完成 N 步」；回一个数字：卡片变成回显（所选打 ✓、其余变灰），接着跑，最终回答「过程」里的步数接着算。
  6. 顺带看：一个带表格和标题的回答（表格变列表、标题大小）；委派一个 session，等完成报告卡片（粗体标题、正文、灰色脚注，后面跟附件）。
  7. 说一件事、重启 Channels、再问它：续接照旧；接不上时第一张回答卡顶部有一行灰色小字「之前的对话没接上，这是新的上下文」。
- 2026-10-21 主会话：「交 JC 定」五条，JC「飞书那几项，按你推荐推进」：表格照转列表、标题转粗体行、提问不改按钮、插队时引用原话、面板与汇报样子等真机。要改的两条进 [票 04](./04-feishu-followups.md)。本票已 rebase 到票 01 之后合入 main（台账重放记录合成一条，干净上游重放 27 个补丁无差异，pytest 632 passed）。
