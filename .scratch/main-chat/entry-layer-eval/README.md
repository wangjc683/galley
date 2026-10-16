# 主对话入口层对照（票 03d）

用真模型给同一批消息各跑两遍：WITHOUT 是主对话 runner 今天拿到的提示词，WITH 是同样的提示词在 `## Main Chat` 一节之后接上 `draft.md`。两组除入口层外完全相同。JC 对照读回复，决定草案去留。

## 文件

- `cases.json`：15 个用例（消息、可选的上下文轮次、是否从分段前带过来、距今几小时）。
- `draft.md`：入口层草案原文。
- `galley-prompt/`：Galley 运行时提示词，由真实 Rust 代码 `managed_prompt::compose_main_chat_runtime_prompt` 生成（版本 0.6.2、macOS）。会话 id、分段起点、日期、带过来的最后一轮时间留成 `__…__` 占位，`run.py` 运行时填入。`plain` 是不带轮次的写法，`carried-N` 是带 N 轮过来的写法（N 为 1 到 3，即 `CARRY_TURNS`）。
- `composed/`：两个用例（不带轮次的 `chat-tired`、带轮次的 `carry-quote`）各两组的完整请求，即模型实际收到的 system、历史与新消息，以及提供给它的工具名。
- `results.json`：原始结果。每条含用例 id、组别、回复原文（`<summary>`、`<next-suggestion>` 标签都保留）、建议、第一个工具调用、用量、耗时等。
- `results.md`：逐个用例先列消息与上下文，再依次放 WITHOUT、WITH 的回复。正文按对话界面的样子去掉标签，建议单独一行，工具调用写成「（要调用工具：名称，参数摘要）」。
- `run.py`：脚本本身。

## 怎么跑

需要能 `import cryptography` 的解释器（用它从 Galley 数据库解出 API key）。JC 机器上开发版 runner 用的 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3` 有它；打包版 `core/python-bundle` 里没有。

```bash
PY=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
export PYTHONDONTWRITEBYTECODE=1   # managed-ga/code/ 下不许出现 __pycache__

$PY .scratch/main-chat/entry-layer-eval/run.py --dry-test          # 不连模型，验证拦截
$PY .scratch/main-chat/entry-layer-eval/run.py --variant both       # 15 × 2 = 30 次真调用
$PY .scratch/main-chat/entry-layer-eval/run.py --cases carry-quote,chat-full --variant with   # 只补跑几条，结果合并
$PY .scratch/main-chat/entry-layer-eval/run.py --render-only        # 只从 results.json 重出 results.md
```

其他参数：`--parallel`（默认 3）、`--model-id`（默认 `mm_1790734996114`，即 gpt-6.1-sol）、`--galley-db`、`--ga-lang`（默认 `en`）、`--keep-temp`（保留临时目录以便排查）。拿不到数据库时可用 `--mykey <GA 的 mykey.py> --mykey-entry <条目名>` 换成 GA 格式的配置（只读加载）。

改了 Rust 提示词之后，`galley-prompt/` 要重新生成：在 `core/src/managed_prompt.rs` 的测试模块里临时加一个测试，用占位值调用 `compose_main_chat_runtime_prompt` 写出四个文件，跑完删掉这个测试（本目录的版本就是这样生成的，产品代码没有留下改动）。

## 它复现了什么

每次运行是一个独立的 worker 进程，照 `runner/workbench_bridge.py` 的 `_setup_ga` 搭内置引擎：

- 托管模式（`GALLEY_RUNTIME_KIND=managed`），状态根是新建的临时目录，里面只有 `managed-ga/state-seed/memory` 的拷贝，即全新安装的样子；`agentmain` 导入时照常生成 `global_mem.txt` 与 `global_mem_insight.txt`。
- 工作目录切到状态根（主对话的 cwd 为空，runner 就是这样做的）。
- 模型配置：从 Galley 数据库读出 gpt-6.1-sol 这一行（只读、immutable 打开；票 36 之前是读临时副本），按 `managed_model_layers` 的规则合并预设、全局默认与模型自己的选项（结果是 `chat_completions`、`stream`、`temperature` 1、`reasoning_effort` high），解出 key，交给 runner 自己的 `managed_model_config_from_env` 转成 GA 的配置。主对话会话行没有单独设推理强度，所以沿用模型配置。
- 提示词：GA 核心提示词与记忆由 `agentmain` 自己拼；Galley 那段经 runner 的 `install_managed_prompt_profile` 装到 `extra_sys_prompt`，与真实 runner 同一个函数。GA 随后照常追加 `[Peer]` 提示和 Action Protocol。
- 历史：有上下文的用例经 runner 的 `GaSession.set_history` 装进去，就是 `load_history` 走的那条路。带过来的用例在 Main Chat 一节写明 1 轮、最后一条在「现在减 hours_ago」的本地时间。
- 新消息用 `put_task(..., source="workbench")` 发出，与 runner 相同；`verbose`、`inc_out` 也照设。
- `GA_LANG` 取 `en`：JC 的开发版 Core 环境是 `LANG=en_US.UTF-8`，GA 据此选英文提示词。
- 主对话状态块用的是看起来合理的值：会话 id 取 Rust 测试里的示例 `s-mgn4k2x1-7q3z9w0e`，分段从 turnIndex 42 开始、开始于运行当天。

## 它没有复现什么

- 没有真实的工具结果。模型第一次调用工具就停下，记下工具名与参数，保留它调用前写的文字；所以凡是想先查一下再回答的用例，看到的是「它要去做什么」，不是最终答复。
- 没有 Galley Core、GUI 与 runner 的事件流；不经过 Core 的落库、去标签与渲染。`results.md` 里的去标签是按 `ga-output-cleaning.ts` 的规则在脚本里做的。
- 状态根是全新安装的样子，没有 JC 真实的 GA 记忆；system prompt 里的 `cwd` 是临时目录路径，真实 runner 是 `~/Library/Application Support/app.galley/managed-ga-state/temp`。
- 每个用例只跑一次，不衡量同一提示词下的随机波动。

## 派活方式对照（票 06）

同一套脚本、模型和护栏，比较主对话把长活派给子任务的三种做法。

- 输入：`dispatch-clauses.md`（T / C / P 三段条款）与 `dispatch-cases.json`（5 个用例，3 个该派、2 个不该派）。
- 组成：入口层的 WITH（`draft.md` 接在 `## Main Chat` 后），再接该组条款；不带上下文。P 另多一个工具 `start_subtask`，只有一个必填字符串参数 `task`（说明为「what to do」），函数说明是脚本自拟的 `Start a subtask that runs as a separate conversation.`。它按 GA 自己的工具格式追加到 worker 进程内存里的 `agentmain.TOOLS_SCHEMA`（GA 在 `load_tool_schema` 里从 `assets/tools_schema.json` 读出的列表），不改 `managed-ga/code`。
- 跑了两轮，T 的判定两轮相同：回复里有 `<subtask>…</subtask>` 就算派活，记下标签内容。
- `composed/dispatch.big-pdfs.{T,C,P}.txt` 是 big-pdfs 三组的完整首个请求，P 组那份附 `start_subtask` 的完整定义。

### 第一轮：第一次查询就停（`--mode firststop`）

- 拦截：C / P 只有「第一次工具调用就是派活」时才往下走：C 是 `code_run` 的代码里出现 `subtask start`（正则 `subtask[\s'",]+start`，Python 的列表写法也认），P 是调用 `start_subtask`。这一次不执行，按真实工具的返回形状回一个假的成功结果（C：`code_run` 的 `{"status": "success", "stdout": <CLI 输出的 JSON>, "exit_code": 0}`；P：`{"subtask_id":"s-sub0001","status":"running"}`），让模型继续，停在它之后的第一个工具调用或最终回复。其他任何工具调用当场停下。
- 结果：`dispatch-results-firststop.json` / `.md`。15 次运行里第一次工具调用都不是派活，而是先查东西（读 Galley CLI 的路径、读记忆文件、看下载文件夹、开浏览器标签页），全部停在这一步，没有一次走到假结果。

### 第二轮：查询在沙盒里真的执行（`--mode sandbox`，默认）

为了看到派活之后那一步，第二轮让查询和文件操作真的执行，但只在每次运行自己的临时沙盒里：

- **假数据（fixture）**：假的 HOME（worker 进程和模型代码的 `HOME`、`XDG_CONFIG_HOME` 都指向它），`~/Downloads` 里有 30 个只有几字节的占位 PDF（名字仿真：发票、合同、论文、说明书、收据等，内容是一行说明），3 个其他文件，2 个不占磁盘的稀疏大文件（3.4 GB 与 1.3 GB，好让「超过 1GB 的文件」有答案）。
- **假 CLI**：`~/.config/galley/cli-path` 指向沙盒里的假 `galley`（Python 脚本），固定回答：`sessions search` / `sessions list` 无结果；`subtask start` 返回 `{"schemaVersion":2,"ok":true,"result":{"sessionId":"s-sub0001","status":"running"}}`；`session show s-sub0001` 返回运行中、还没有回复；其余是 `unknown_command`（退出码 1）。每次调用连同 argv 记日志，C 组是否派活、派的内容就以这份日志为准。
- **`code_run`**：真的执行，但经 macOS `sandbox-exec` 套一个默认全拒的配置：只能读写沙盒目录（另可读系统库和 Python 解释器本身），没有任何网络（TCP、DNS、Unix socket，所以也连不到 Galley Core），除了 `code_run` 自己启动的解释器（Python、bash / sh）只能启动假 `galley`。工作目录和 HOME 都在沙盒里。在下载文件夹里移动、改名可以做。
- **`file_read` / `file_write` / `file_patch`**：路径（以及 `{{file:…}}` 引用）只能在沙盒里，越界按 GA 原本的报错格式拒绝；执行期间引擎进程里的读写也限制在沙盒（读另允许 GA 自己的代码目录，`code_run` 要读它的开头模板）。
- **不执行、停在那里**：浏览器工具（`web_execute_js`、`web_scan`，视为在主对话里自己动手）、`ask_user`、`inline_eval`（它会在引擎进程里执行）和沙盒里没有的工具。P 的 `start_subtask` 回假结果 `{"subtask_id":"s-sub0001","status":"running"}`。
- **上限**：每次运行最多 8 次工具调用，第 9 次不执行，记为「达到上限」。
- **记录**：每次工具调用按顺序记名称、参数、返回给模型的内容（md 里截断，json 全文），假 `galley` 的调用日志，下载文件夹前后的变化，派活与否、在第几次调用、之前查了几次、派活内容全文，派活之后的调用，以及最终回复（json 里标签全留）。
- **和真实环境的差别**：只允许假 `galley` 意味着 bash 里的外部命令都不可用，`sleep`、`sed`、`ls`、`mv` 等会报 `command not found`（Python 的 `time.sleep`、文件操作不受影响）。Galley 自己提示词里读 CLI 路径的写法用的是 `sed`，在这里会失败；占位 PDF 里没有真内容；CLI 的输出是固定的 JSON。
- 结果：`dispatch-results.json` / `.md`，md 开头有一张每次运行的一览表。big-pdfs / C 重跑过一次：第一次运行里假 `galley` 把 `subtask start --help` 也当成启动、回了「已启动」，脚本也把它算成派活；修正为 `--help` 只回一行用法、不算派活后只重跑了这一条，被替换的那次原样留在 `meta.superseded_runs`。
- 怎么跑：`run.py --suite dispatch`（`--mode firststop` 重现第一轮），可加 `--variant C,P`、`--cases big-pdfs`、`--render-only`。`--dry-test` 覆盖两轮的路径；沙盒部分验证：`code_run` 读、列真实 HOME，读 `app.galley` 与 `~/Documents/GenericAgent`，连沙盒外一个真实在监听的 Unix socket，连 TCP、查 DNS，往沙盒外和真实 HOME 写文件，启动 `/bin/ls`，全部失败；假 HOME 与假 `galley` 可用；文件工具越界被拒；浏览器工具、`inline_eval` 与第 9 次调用都不执行。

## 叫醒措辞评测（票 30）

评测票 29 的叫醒消息：子任务完成、提问、停在步数上限或出错时，Core 叫醒主对话一轮，助手照消息里的指令验收、打回、替用户答或给用户交代。同一套脚本与沙盒，`run.py --suite wake`。

- **输入**（都在 `wake/`）：
  - `cases.json`：9 个用例（票 30 列的那 9 条），每条有当前段的一小段历史、子任务的固定数据、放进假 `~/Downloads` 的证据文件、这次叫醒的几件，以及自动判定用的 `expect`。由 `cases.json` 的 `_note` 说明各字段。
  - `wording.md`：叫醒措辞。`draft` 是票 29「措辞草稿」原文，逐字；改字建议另起一版（`--variant <名字>`）。拼法照草稿：开头一次，各件依次排，不止一件时末尾加一句。
  - `galley-prompt/main_chat.plain.txt`：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（版本 0.6.2、macOS），含票 30 改过的入口层；会话 id、分段起点、日期、手册路径留成 `__…__` 占位。生成方法同上（测试模块里临时加一个测试写出文件，跑完删掉）。
  - `cli-help.json`：真实 CLI 各命令 `--help` 的原文（用开发版 `galley` 二进制、假 HOME 只跑 `--help` 取得），假 CLI 照它回答帮助。
- **组成**：GA 核心提示词与记忆照常，Galley 那段是上面的提示词；手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual.md`，拷到这次运行状态根下的 `assistant/reference/galley-assistant-manual.md`（Core 写它的位置），提示词里的路径指向它。历史经 `set_history` 装入，新消息是拼好的叫醒消息。
- **假 CLI**：`~/.config/galley/cli-path` 指向一个按固定数据回答的假 `galley`：`sessions list`（主对话、本例的子任务、用户自己的一个对话、外部 agent 开的一个会话）、`session brief` / `show`（子任务的派活说明、步骤、最终回答、提问的 `askUser`）、`project`、`llm list` 等读命令照 Agent API 的形状回答；`session send`、`stop`、`archive`、`restore`、`move`、`project create`、`llm set` 只改假 CLI 自己的状态（之后再读看得到），`session wait` / `follow` / `watch`、`project follow` 立即回一个结束帧。真实 CLI 不认的参数照样拒绝（`invalid_args`，退出码 2），例如 `llm set` 带 `--supervisor`。每次调用连同 argv 记日志。
- **沙盒**：同派活对照第二轮，另允许 `sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep` 这几个系统程序（仍然只能读写沙盒、没有网络），因为 Galley 提示词里读 CLI 路径的写法要用 `sed`，模型核对证据会用 `ls` / `cat`；`PATH` 最前面是一个指向同一解释器的 `python3`。每次运行最多 10 次工具调用。
- **判定**：脚本按 `expect` 自动判：该不该 `session send`、发的话里有没有写明要什么、带没带 `--supervisor=galley-assistant`、回复是不是只有 `<no-reply/>`（去掉 `<summary>`、`<next-suggestion>` 之后）、该交代时点没点到证据、字数上限、有没有用会卡住主对话的命令、有没有自己重开活。`ask_user` 停下算问了用户。另记有没有在第一次写命令之前读手册。
- **结果**：`wake/results.json`（原始结果）、`wake/results.md`（一览表加每条的叫醒消息、工具调用、回复）；`wake/composed/` 是两个用例第一遍的完整首个请求。
- **怎么跑**：`run.py --suite wake`（默认 `draft`，每条两遍；结果总是与已有的合并）、`--variant draft,v2 --cases ask-known,step-limit` 只跑几条、`--repeats N`、`--render-only`。`--dry-test` 覆盖这条路径：提示词里的手册路径指向状态根里的手册、叫醒消息逐字是最后一条用户消息；模型的 shell 用 `sed` 读到 CLI 路径，读、写、被拒的参数、会卡住的命令都到了假 CLI 并被记下；读真实 HOME、`/etc`、启动名单外的程序（`/usr/bin/python3`、`curl`、`touch`）、往沙盒外写都失败；`ask_user` 停下。

### 结果（2026-10-15，gpt-6.1-sol，推理强度 high）

保留的 20 次运行里 19 次判为过（`wake/results.md` 开头的一览表）：

- **打回**：说「订好了」却没交确认号和截图的，两遍都 `session send` 打回，写明要什么（确认号、存到 `~/Downloads` 的截图完整路径），并叮嘱不要重复下单；回复只有 `<no-reply/>`。
- **替答与问用户**：用户说过喜欢靠窗，两遍都答「靠窗（A/F）」并附「付款前仍须先询问用户」，`<no-reply/>`；要短信验证码、要确认付款的四遍都问用户（三遍用 `ask_user`，一遍直接问），不替答。
- **出错**：一句话说浏览器没连上、建议去「设置 → 浏览器控制」，不重开。
- **两件一起**：一条回复先交代报价（点名表格路径和三家单价），再说笔记没做成和建议。
- **已打回两次**：不再打回，交代表格路径、现有 3 家和还差 2 家。
- **结果够好**：一遍过；另一遍内容对、点名了表格路径，但 177 字超过脚本定的 160 字上限，判为不过。
- **全程**：每次写命令都带 `--supervisor=galley-assistant`，第一次写之前都读了手册；没有一次用 `session wait` / `follow` / `watch`；`<no-reply/>` 的回复都没有附建议标签。

改过的地方：

- **固定数据**：第一批 14 次运行作废重跑。截图原是几十字节的文字占位，模型读文件头识破后打回；日期按星期写错（运行当天周四），模型也指了出来。
- **手册**（本票自己的，评测不过可以直接改）：「Checking a result」一节改了两次。证据齐全时模型先是回源头重查（开浏览器、想 OCR 截图、要派活说明没要的链接）后打回，助手 PRD 反方 2 的对策是「核对证据在不在，核不了就明说没核实到」；第三版写明这就是验收的全部。被替换的运行与原因都留在 `results.json` 的 `meta.superseded_runs`，每次运行记了读的是哪一版手册（`manual_sha`）。
- **叫醒措辞**：`draft` 在所有用例上行为都对，只有 Step limit 一件看得出缺口：消息里没有子任务停下时的文字，两遍都先去翻引擎的 `model_responses` 日志再 `session show`（4～5 次模型调用）。`v2` 补上这段文字、把「the same way」写成完整命令，两遍都直接 `session send … "continue"`（3 次调用）。
- **用量**：50 次运行（保留 20 次，作废 30 次），166 次模型调用。

## 定时与提醒评测（票 36）

（票 41 起这一节在手册里并进「To-dos and reminders」，提示词、样本与 CLI 帮助已重新写出，结果是票 41 的重跑，见本节末。）

评测助理手册的新节「Reminders and scheduled tasks」、入口层新加的那句和主对话自己的「What Only The User Changes」：该建的自己建、不该建的不建、该先问的先问、改与取消、到点被叫醒时怎么做。同一套脚本与沙盒，`run.py --suite schedule`。

- **输入**（都在 `schedule/`）：
  - `cases.json`：13 个用例。票 36 列的 12 条（该建 3 条、不该建 2 条、该先问 1 条、已有同一件、不用了、改时间、叫醒按时 / 晚了 9 小时 / 已过时），另加 JC 真机要试的「十分钟后提醒我喝水」。每条有当前段的历史、假 CLI 里已有的定时任务（时间按运行那一刻算）、用户这句或这次叫醒到点的任务，以及自动判定用的 `expect`。字段见 `_note`。
  - `galley-prompt/main_chat.plain.txt`：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（版本 0.6.2、macOS），含票 36 的入口层与主对话那一段；会话 id、分段起点、日期、手册路径、「In Hand」一节留成 `__…__` 占位。生成方法同上（测试模块里临时加一个测试写出文件，跑完删掉）。
  - `cli-help.json`：当前 CLI 各命令 `--help` 的原文（开发版 `galley` 二进制、假 HOME，只跑 `--help`），含 `schedule` 命令族与票 35 的手。
  - `rust-samples.json`：同一个临时测试写出的 Rust 原文样本：一组「In Hand」（`in_hand_section`）、三条到点叫醒消息（`subtask_report::report_text`）与几个「晚了多久」。`run.py` 里的 Python 移植（`in_hand_block`、`reminder_note`、`lateness_words`）在 `--dry-test` 里逐字对照它们。
- **组成**：同叫醒评测。用例里标了 `in_hand` 的任务（分段开始前就有），照 `in_hand_section` 的格式写进提示词的「In Hand」一节，时间写成消息前一小时；没有就不写这一节（同 Core）。叫醒用例的新消息照 Core 的措辞拼出。
- **假 CLI**：叫醒评测那个，另外回答 `schedule list / show / create / update / delete / enable / disable / run`：形状照 Agent API §5.20–§5.27，参数照真实 CLI 校验（`--at` 认带偏移的 RFC 3339 与本地 `YYYY-MM-DDTHH:MM`，按本机时区；过去的时刻报 `time_in_past:`；`--target` 默认 `session`；定时规则互斥、重复的要 `--time`），状态存在假 CLI 自己的文件里，跑完连同起始的任务一起记进结果。票 35 的手（`session rename / pin / unpin / delete`、`project update / pin / unpin / archive-sessions`、`llm set-default`）也接着，主对话被拒（`main_chat_protected:`）。
- **沙盒**：同叫醒评测，另允许 `/bin/date`（手册让它算「十分钟后」之前先看钟）。每次运行最多 10 次工具调用。
- **判定**：按 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复：该建的建了一个、时间在窗口里、`--target=assistant`、记下的话里有该有的（单号）；不该建的什么都没写；该先问的问了、没建；已有的没再建、没删；不用了的删了那一个；改时间的改到了（或删了重建，不留两个）；叫醒按时的不说晚、晚了的说晚了多久、已过时的只回 `<no-reply/>`；回复里说出了时间（钟点，加上不是今天时的哪天，或「几分钟后」）；字数上限。每条都查 `schedule create` 带没带 `--target=assistant`、`schedule` 写命令带没带 `--supervisor=galley-assistant`、有没有多余的写命令、会卡住主对话的命令或 `<subtask>`。另记有没有先读手册、建之前有没有 `schedule list`（只记，不判）。
- **结果**：`schedule/results.json`（原始结果）、`schedule/results.md`（通过率表、一览表、每条的消息与工具调用、新建 / 删除 / 改动、回复）；`schedule/composed/` 是两个用例第一遍的完整首个请求。
- **怎么跑**：`run.py --suite schedule`（每条两遍，结果与已有的合并）；`--repeats 1` 只跑一遍；`--first-repeat 2` 接着补第 2 遍而不重跑第 1 遍；`--cases a,b` 只跑几条；`--supersede "<原因>"` 把被这次替换的旧结果连同原因留进 `meta.superseded_runs`；`--render-only`。

### 结果（2026-10-16，gpt-6.1-sol，推理强度 high）

最终文本下 28 次运行 27 次过（13 条各两遍，叫醒晚了 9 小时那条四遍；`schedule/results.md` 开头的通过率表）。唯一不过的是「不用了」第 2 遍：删对了那一个，但「已取消……不会再提醒你了」只写进了 `<summary>`，回复正文是空的，主对话里看不到（判定规则：该回话时正文为空算不过）。

- **该建**：「周三下午要交报告」建在周二下午或晚上，「我订了周五早上 7 点的航班」（周五晚上说的）按下周五理解、建在前一晚 8 点并说明是哪天，「下周一记得帮我看下物流」建在周一上午、记下的话里带着单号，「十分钟后提醒我喝水」先看钟再建；每次都先 `schedule list`、带 `--target=assistant` 与 `--supervisor=galley-assistant`，回复一句说出时间。
- **不该建、该先问**：学吉他、开会累都没动任何东西；「以后每天早上给我看看新闻」先问一句（几点、看什么、每天会花模型费用），没建。
- **已有、不用了、改时间**：已有的季度报告提醒（在「In Hand」里）没再建，回复说已经记着、几点提醒；「不用了」两遍都删了那一个（一遍回复正文为空，见上）；「改到 9 点」`schedule update` 到明天 9:00。
- **叫醒**：按时的一两句提醒、不说晚；晚了 9 小时的先说晚了多久再说事；已经办了的只回 `<no-reply/>`。

改过的地方（被替换的运行与原因都在 `results.json` 的 `meta.superseded_runs`）：

- **手册**：第一轮（每条一遍）12 过 1 不过。周五晚上说「周五早上 7 点的航班」，它问「你说的是下周五吗」而没建。手册「Setting one」加了一条：一天能指两个日期时取还没过的那个，建好，在那句话里说出日期让用户纠正，不先问。整组重跑。
- **叫醒措辞**（Core 的 `subtask_report::due_paragraph`）：第二轮当时判 26 过 25（「正文为空算不过」是之后才加的规则，按它算是 24，另一处就是上面「不用了」那遍，它留在最终表里），不过的是晚了 9 小时那条：「晚了 9 小时」只写进了 GA 的 `<summary>`（主对话不显示），回复只转述了记下的话。先改成「Act on it now, and say first that it comes 9 hours late」，两遍都还是写进摘要（「先说」被理解成先写在摘要里）；再改成「say in the reply itself (the user does not see your summary) that it comes 9 hours late」，四遍全过。
- **用量**：45 次运行（保留 28 次，作废 17 次），107 次模型调用。

这一轮的 `results.json` / `results.md` 已被下面的票 41 重跑替换，原文在 git 历史里（票 36 的合并提交 `3e22b3e8`）。

### 票 41 重跑（2026-10-17，gpt-6.1-sol，推理强度 high）

票 41 把手册的这一节改写成「To-dos and reminders」、入口层那一段改成待办的说法，「In Hand」也在票 39 换成了三组，票 36 的结果不再对应现在的文本，整组重跑（旧结果没有并进 `meta.superseded_runs`，见上）。

- **跟着换的输入**：`galley-prompt/main_chat.plain.txt`（票 41 的入口层，关于 Galley 的功能地图也已是票 90 之后的「待办」）、`rust-samples.json`（四组「In Hand」：三组都满并截断、只有它自己的提醒、只有待办、同一组换成 UTC；六组叫醒，含两条待办的提醒）、`cli-help.json`（顶层多了 `todo`，加 `todo` 与七个子命令的 `--help` 原文）。都由票 41 的临时测试（跑完删掉）与开发版二进制重新写出，待办评测共用这三份。
- **判定跟着改的**：用户自己的带时间的事，提醒挂在待办上也算建了那一个（`expect.via: either`：周三交报告、周五航班、十分钟后喝水）；物流这种它自己回头查的只认 `schedule create`，记成待办算不过；「已有同一件」（票 41 之前建的独立提醒）留着它、或删了换成挂在待办上的一个都算，再挂第二个算不过，可以另记一件不带提醒的待办。其余用例的期望不变。
- **结果**：26 次运行 26 次过（13 条各两遍），一次也没有改措辞。周三交报告、周五航班、十分钟后喝水三条都记成了待办并挂提醒（交报告只写日子、提醒在前一天；航班截止周五 7 点、提醒周四晚 8 点；喝水截止与提醒都在十分钟后），回复一句说出时间；物流两遍都是 `schedule create … --target=assistant` 在周一上午 10 点、带单号；学吉他、开会累、每天看新闻（先问一句）照旧；已有的独立提醒两遍都只读了 `schedule list` 与 `todo list`、回复已经记着与几点提醒；不用了、改到 9 点照旧用 `schedule delete` / `update`；三条叫醒照旧（晚了 9 小时的两遍都先说晚了多久，还顺手查了 `todo list --all` 与历史）。
- **用量**：26 次运行，77 次模型调用。

## 待办评测（票 41）

评测助理手册改写后的「To-dos and reminders」与入口层改写的那一段：你的事记成待办（有截止的挂提醒）、它自己回头查的用定时任务、信息不记、办好了去勾、从清单引用一件事改对那一件、回答「还有什么没办」之前先读清单、待办的提醒到点时只提醒。同一套脚本与沙盒，`run.py --suite todo`。

- **输入**：
  - `todo/cases.json`：11 个用例。票 41 列的 9 条（该记待办 3 条、它自己的提醒 1 条、不该记 2 条、勾掉、引用改、问还有什么没办），另加两条：清单上已有同一件、待办的提醒到点（票 39 新写的叫醒措辞第一次上真模型）。每条有当前段的历史、假 CLI 里已有的待办（截止、挂着的提醒、是不是在「In Hand」里、分段开始后有没有在面板上被勾掉）与定时任务、用户这句或这次叫醒到点的提醒，以及自动判定用的 `expect`。字段见 `_note`。
  - 提示词、CLI 帮助与 Rust 样本与定时评测共用 `schedule/` 下那三份（见上一节「票 41 重跑」）。
- **组成**：同定时评测。用例里分段开始前就有的待办与定时任务照 `in_hand_section` 的格式（票 39 的三组：用户的待办、它在办的、例行）写进「In Hand」一节，时间写成消息前一小时；之后在面板上被勾掉的，快照里仍是没做，假 CLI 里是做完的；这一段里刚记的不在快照里。「说说这件」的消息照 `gui/src/lib/composer-quote.ts` 的写法：引用块是那件事的标题，空一行，再接用户的话。待办的提醒到点时，新消息照 Core 的措辞（`subtask_report` 的待办一段）拼出。
- **假 CLI**：定时评测那个，另外回答 `todo list / show / add / update / done / reopen / cancel`：形状照 Agent API §5.28–§5.34，校验照真实 CLI 与 Core（`--due` 收本地日期或 `--at` 的写法、过去的日期不拒；`--remind-at` 过去报 `time_in_past:`；`--due=` / `--remind-at=` 空值、`--due` 与 `--no-due` 同给、`update` 什么都没给是参数错误，退出码 2，报错原文用开发版二进制在假 HOME 下抓的；未知或已取消的 id 退出码 3；勾掉与取消会取消还没提醒到的提醒，再勾不变，取消勾不恢复提醒；做完的不能挂提醒；`list` 的顺序与 `--all` 照 `todo_list_order`）。`todo add / update --remind-at` 建或挪的提醒是一个带 `todoId`、叫醒助理的一次性定时任务，`schedule list` 里看得到。
- **判定**：按 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复：该记的记了一件、标题对、截止在窗口里（要带时刻的带了）、有截止的挂了一个在截止之前的提醒、没时间的不写截止不挂提醒；它自己的提醒是 `schedule create --target=assistant`、不是待办，记下的话里带单号；不该记的什么都没写；勾掉的是那一件、记成 Galley 勾的；引用改的是那一件、截止到了新的一天、提醒跟着挪且不晚于新截止、没新建；问「还有什么没办」的先跑了 `todo list`、点到了三件、没把面板上勾掉的当成没办；已有的没再记、没再挂提醒，说出了已有提醒的时间；提醒到点的只提醒、不勾掉。每条都查 `todo` 与 `schedule` 写命令带没带 `--supervisor=galley-assistant`、`schedule create` 带没带 `--target=assistant`、有没有动不该动的待办、多余的写命令、会卡住主对话的命令或 `<subtask>`；回复里说出了提醒时间、字数上限。另记有没有先读手册、写之前有没有读清单（只记，不判）。
- **结果**：`todo/results.json`、`todo/results.md`（同定时评测的版式）；`todo/composed/` 是引用改与问还有什么没办两条第一遍的完整首个请求。
- **怎么跑**：`run.py --suite todo`，参数同定时评测（`--repeats`、`--first-repeat`、`--cases`、`--supersede`、`--render-only`）。`--dry-test` 覆盖这条路径：「In Hand」是快照（面板上勾掉的仍在、这一段刚记的不在）、假 CLI 的 `todo` 命令族照真实 CLI 拒绝与改状态（上面那些错误、勾掉取消提醒、取消后再取消是 `not_found`、`--all`、`schedule list` 里的待办提醒）、待办提醒的叫醒消息逐字是 Core 的，判定读得出该勾没勾、多记、动了不该动的和多余的写命令。

### 结果（2026-10-17，gpt-6.1-sol，推理强度 high）

22 次运行 22 次过（11 条各两遍；`todo/results.md` 开头的通过率表），一次也没有改手册或入口层的措辞。

- **该记待办**：「周三下午 3 点前要交季度报告」`todo add "交季度报告" --due=<周三>T15:00`，提醒挂在周二下午 3 点，回复一句说出截止与几点提醒；「记一下要买营养土」记一件、不写截止不挂提醒，一句话；「明天要给房东回电话」（凌晨一点多说的）按日历上的明天记、截止只写日子，提醒在明早 9 点或 10 点，回复点明是 10 月 18 日。每次都先读手册、先 `todo list`、带 `--supervisor=galley-assistant`，没有一次用 `schedule create` 给用户的事挂提醒。
- **它自己的提醒**：「下周一帮我看下物流」两遍都是 `schedule list` 后 `schedule create … --target=assistant` 在周一上午 10 点，记下的话里有单号，并叮嘱到时不要虚构结果，没记成待办。
- **不该记**：学吉他什么都没动；「我的航班号是 MU5101」没记待办、没建提醒，两遍都先查了一下历史，再问哪天出发。
- **勾掉、引用改**：「营养土买好了」`todo done` 那一件，回复「已勾掉。」或「已把“买营养土”勾掉了。」，没复述清单；引用「交季度报告」说「改到周四」，两遍都 `todo update` 到周四下午 3 点，提醒顺延到周四中午 12 点，没新建。
- **问还有什么没办、已有同一件**：两遍都先 `todo list`，答房东、季度报告、续签合同三件（续签合同不在快照里），没提面板上勾掉的营养土；清单上已有季度报告时只读了清单，回复已经记着、中午 12 点提醒，没再记。
- **待办的提醒到点**：一两句提醒季度报告几点截止、交给谁、文件在哪，没勾掉、没动任何东西。
- **用量**：22 次运行，69 次模型调用。

## 安全措施

- 拦截点在 GA 的工具分发：worker 把 `agentmain` 里的 `GenericAgentHandler` 换成子类（runner 自己装处理器子类用的也是这个接口 `GaSession.install_handler`）。子类的 `dispatch` 遇到任何真实工具就记录并返回 `should_exit`，一次模型调用后整个运行结束；只有 GA 自己判断最终回答的 `no_tool`（只读回复文本）和格式错误的重试提示 `bad_json` 走原路。子类上除 `do_no_tool` 外的所有 `do_*` 方法都换成一调用就报错的版本，作为第二道保险。
- 第三道保险是进程级护栏：worker 里启动子进程、`os.system` / `exec` / `spawn`、打开浏览器、连本地 socket（Galley Core 与 CLI）、解析模型 API 以外的域名、往临时目录以外写文件，一律拒绝并记录。唯一的例外是沙盒模式（派活对照第二轮、叫醒评测）里 `code_run` 启动解释器：只能在执行 `code_run` 的那一刻、只能经 `sandbox-exec` 套上该次运行的沙盒配置、只能带沙盒里的环境变量、工作目录必须在沙盒里。
- `--dry-test` 在任何真调用之前验证这些：用假的模型流返回一个先说话、再调 `code_run`（`touch` 一个金丝雀文件）和 `file_write` 的回复，以及一个带建议标签的普通回复，检查只发生一次模型调用、没有进入任何工具方法、护栏无记录、金丝雀文件不存在、护栏确实拒绝子进程 / 域名 / 外部写入，并检查请求的拼装（GA 核心、Galley 段、Main Chat、WITH 的草案位置、历史顺序、带过来的那句）。
- 不碰真实数据：Galley 数据库以只读、immutable 方式打开（`mode=ro&immutable=1`，不写锁、不建 WAL 索引；票 36 之前是先拷到权限 700 的临时目录再读）；不写 `~/Library/Application Support/app.galley`、真实 GA 记忆或 `~/Documents/GenericAgent`；状态根路径若像真实数据目录就拒绝运行。
- 不留 key：key 只在内存里，经 stdin 交给 worker；请求记录只存请求体不存请求头；写结果前把 key 字符串整体替换掉；worker 日志随临时目录删除。
- 不留本机路径：写结果前把系统临时目录换成 `$TMPDIR`，把跑 worker 的解释器路径换成 `$PYTHON`、它的安装目录换成 `$PYTHON_ROOT`（票 41 起；之前的结果里还留着解释器路径）。
- 设 `PYTHONDONTWRITEBYTECODE=1`，不在 `managed-ga/code/` 下留 `__pycache__`。
