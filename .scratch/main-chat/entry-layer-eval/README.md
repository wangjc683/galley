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
- `chat/`：票 60 的闲聊组（见「它自己判断要不要跟进（票 60）」一节），票 63、64 重跑。

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

其他参数：`--parallel`（默认 3）、`--model-id`（默认 `mm_1792576875658`，即API key 接入的 gpt-6.1-sol，API key；票 64 之前的 `mm_1790734996114` 已从库里删掉，主对话自己的 gpt-6.1-sol 走 ChatGPT 登录、脚本取不到）、`--galley-db`、`--ga-lang`（默认 `en`）、`--keep-temp`（保留临时目录以便排查）。拿不到数据库时可用 `--mykey <GA 的 mykey.py> --mykey-entry <条目名>` 换成 GA 格式的配置（只读加载）。

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
  - `galley-prompt/main_chat.plain.txt`：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（版本 0.6.2、macOS），含票 30 改过的入口层；会话 id、分段起点、日期、手册路径留成 `__…__` 占位（票 59 起是手册目录 `__MANUAL_DIR__`，提示词按票 59 重新生成）。生成方法同上（测试模块里临时加一个测试写出文件，跑完删掉）。
  - `cli-help.json`：真实 CLI 各命令 `--help` 的原文（用开发版 `galley` 二进制、假 HOME 只跑 `--help` 取得），假 CLI 照它回答帮助。
- **组成**：GA 核心提示词与记忆照常，Galley 那段是上面的提示词；手册是仓库里的 `docs/managed-ga-runtime/galley-assistant-manual/`（票 59 起一部分一个文件），整套拷到这次运行状态根下的 `assistant/reference/manual/`（Core 写它的位置），提示词里的目录指向它；票 59 之前是单个文件，拷到 `assistant/reference/galley-assistant-manual.md`。历史经 `set_history` 装入，新消息是拼好的叫醒消息。
- **假 CLI**：`~/.config/galley/cli-path` 指向一个按固定数据回答的假 `galley`：`sessions list`（主对话、本例的子任务、用户自己的一个对话、外部 agent 开的一个会话）、`session brief` / `show`（子任务的派活说明、步骤、最终回答、提问的 `askUser`）、`project`、`llm list` 等读命令照 Agent API 的形状回答；`session send`、`stop`、`archive`、`restore`、`move`、`project create`、`llm set` 只改假 CLI 自己的状态（之后再读看得到），`session wait` / `follow` / `watch`、`project follow` 立即回一个结束帧。真实 CLI 不认的参数照样拒绝（`invalid_args`，退出码 2），例如 `llm set` 带 `--supervisor`。每次调用连同 argv 记日志。
- **沙盒**：同派活对照第二轮，另允许 `sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep` 这几个系统程序（仍然只能读写沙盒、没有网络），因为 Galley 提示词里读 CLI 路径的写法要用 `sed`，模型核对证据会用 `ls` / `cat`；`PATH` 最前面是一个指向同一解释器的 `python3`。每次运行最多 10 次工具调用。
- **判定**：脚本按 `expect` 自动判：该不该 `session send`、发的话里有没有写明要什么、带没带 `--supervisor=galley-assistant`、回复是不是只有 `<no-reply/>`（去掉 `<summary>`、`<next-suggestion>` 之后）、该交代时点没点到证据、字数上限、有没有用会卡住主对话的命令、有没有自己重开活。`ask_user` 停下算问了用户。另记有没有在第一次写命令之前读手册；票 59 起「读手册」一栏还写读了哪几部分、几次、落在几个模型轮次里、返回给模型共多少字节（`wake_facts` 的 `manual_reads`）。
- **结果**：`wake/results.json`（原始结果）、`wake/results.md`（一览表加每条的叫醒消息、工具调用、回复）；`wake/composed/` 是两个用例第一遍的完整首个请求。
- **怎么跑**：`run.py --suite wake`（默认 `draft`，每条两遍；结果总是与已有的合并）、`--variant draft,v2 --cases ask-known,step-limit` 只跑几条、`--repeats N`、`--render-only`。`--dry-test` 覆盖这条路径：提示词里的手册目录是状态根里的那个、目录里正好是八个部分（结果的 `manual_files`），假模型在一轮里并发读两个部分，读了哪几部分、一轮、返回的字节都记下；叫醒消息逐字是最后一条用户消息；模型的 shell 用 `sed` 读到 CLI 路径，读、写、被拒的参数、会卡住的命令都到了假 CLI 并被记下；读真实 HOME、`/etc`、启动名单外的程序（`/usr/bin/python3`、`curl`、`touch`）、往沙盒外写都失败；`ask_user` 停下。

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

（票 41 起这一节在手册里并进「To-dos and reminders」，提示词、样本与 CLI 帮助已重新写出；票 44 把「只要提醒一下」和「要办完的事」分开判，加了一条用例，结果是票 44 的重跑，见本节末。）

评测助理手册的新节「Reminders and scheduled tasks」、入口层新加的那句和主对话自己的「What Only The User Changes」：该建的自己建、不该建的不建、该先问的先问、改与取消、到点被叫醒时怎么做。同一套脚本与沙盒，`run.py --suite schedule`。

- **输入**（都在 `schedule/`）：
  - `cases.json`：14 个用例。票 36 列的 12 条（该建 3 条、不该建 2 条、该先问 1 条、已有同一件、不用了、改时间、叫醒按时 / 晚了 9 小时 / 已过时），另加 JC 真机要试的「十分钟后提醒我喝水」，票 44 再加「半小时后提醒我关火」。每条有当前段的历史、假 CLI 里已有的定时任务（时间按运行那一刻算）、用户这句或这次叫醒到点的任务，以及自动判定用的 `expect`。字段见 `_note`。
  - `galley-prompt/main_chat.plain.txt`：真实 Rust 代码 `compose_main_chat_runtime_prompt` 生成的主对话提示词（版本 0.6.2、macOS），含票 36 的入口层与主对话那一段；会话 id、分段起点、日期、手册路径、「In Hand」一节留成 `__…__` 占位。生成方法同上（测试模块里临时加一个测试写出文件，跑完删掉）。
  - `cli-help.json`：当前 CLI 各命令 `--help` 的原文（开发版 `galley` 二进制、假 HOME，只跑 `--help`），含 `schedule` 命令族与票 35 的手。
  - `rust-samples.json`：同一个临时测试写出的 Rust 原文样本：一组「In Hand」（`in_hand_section`）、三条到点叫醒消息（`subtask_report::report_text`）与几个「晚了多久」。`run.py` 里的 Python 移植（`in_hand_block`、`reminder_note`、`lateness_words`）在 `--dry-test` 里逐字对照它们。
- **组成**：同叫醒评测。用例里标了 `in_hand` 的任务（分段开始前就有），照 `in_hand_section` 的格式写进提示词的「In Hand」一节，时间写成消息前一小时；没有就不写这一节（同 Core）。叫醒用例的新消息照 Core 的措辞拼出。
- **假 CLI**：叫醒评测那个，另外回答 `schedule list / show / create / update / delete / enable / disable / run`：形状照 Agent API §5.20–§5.27，参数照真实 CLI 校验（`--at` 认带偏移的 RFC 3339 与本地 `YYYY-MM-DDTHH:MM`，按本机时区；过去的时刻报 `time_in_past:`；`--target` 默认 `session`；定时规则互斥、重复的要 `--time`），状态存在假 CLI 自己的文件里，跑完连同起始的任务一起记进结果。票 35 的手（`session rename / pin / unpin / delete`、`project update / pin / unpin / archive-sessions`、`llm set-default`）也接着，主对话被拒（`main_chat_protected:`）。
- **沙盒**：同叫醒评测，另允许 `/bin/date`（手册让它算「十分钟后」之前先看钟）。每次运行最多 10 次工具调用。
- **判定**：按 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复：该建的建了一个、时间在窗口里、`--target=assistant`、记下的话里有该有的（单号）；不该建的什么都没写；该先问的问了、没建；已有的没再建、没删；不用了的删了那一个；改时间的改到了（或删了重建，不留两个）；叫醒按时的不说晚、晚了的说晚了多久、已过时的只回 `<no-reply/>`；回复里说出了时间（钟点，加上不是今天时的哪天，或「几分钟后」）；字数上限。每条都查 `schedule create` 带没带 `--target=assistant`、`schedule` 写命令带没带 `--supervisor=galley-assistant`、有没有多余的写命令、会卡住主对话的命令或 `<subtask>`。另记有没有先读手册、建之前有没有 `schedule list`（只记，不判；票 59 起读手册一栏同叫醒评测，记读了哪几部分、几次几轮、多少字节）。
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

这一轮的 `results.json` / `results.md` 已被下面的票 44 重跑替换，原文在 git 历史里（票 41 的提交 `c3ed1604`）。

### 票 44 重跑（2026-10-17，gpt-6.1-sol，推理强度 high）

主对话 PRD 裁决 92：只要提醒一下、没有要办完的事，用它自己的提醒，不记成待办。手册「To-dos and reminders」里的判法（你不理这次提醒，这件事还要留在清单上吗）改了，判定跟着分开，整组重跑（旧结果同样没有并进 `meta.superseded_runs`）。

- **跟着换的输入**：只有手册（`run.py` 直接读仓库里的那份）。入口层没改，`galley-prompt/`、`rust-samples.json`、`cli-help.json` 照旧。
- **判定跟着改的**：要办完的事（周三交报告、周五航班）`expect.via: todo`，只认挂在待办上的提醒（`todo add --remind-at`），建成它自己的提醒（`schedule create`）算不过，待办要正好一件；只要提醒的（十分钟后喝水，新加的半小时后关火）不写 `via`，只认 `schedule create --target=assistant`，记成待办算不过。「已有同一件」照票 41（`via: either`：那是票 41 之前建的独立提醒，留着或换成挂在待办上的都算）。回复说出时间多认「半小时」「N 小时」这种相对说法（之前只认「N 分钟」）。`--dry-test` 加了四条：喝水记成待办、交报告建成它自己的提醒，判定都抓得出；关火建成它自己的提醒、交报告记成待办挂提醒，都算过。
- **结果**：28 次运行 28 次过（14 条各两遍），一次也没有改措辞。喝水两遍都是 `schedule list` 后 `schedule create … --target=assistant` 在十分钟后，回复「好，十分钟后提醒你喝水。」；关火两遍都在半小时后，回复带上钟点（「半小时后（06:21）提醒你关火。」）；两条都没碰 `todo`。周三交报告两遍都 `todo add "交报告" --due=<周三> --remind-at=<周二>T15:00`；航班两遍都截止周五 7:00、提醒周四晚 8 点挂在待办上；物流照旧是它自己的提醒、带单号；已有的独立提醒两遍都只读了 `schedule list` 与 `todo list`，回复已经记着、几点提醒；其余照旧。
- **用量**：28 次运行，85 次模型调用（05:50 开跑）。

## 待办评测（票 41）

评测助理手册改写后的「To-dos and reminders」与入口层改写的那一段：你的事记成待办（有截止的挂提醒）、它自己回头查的用定时任务、信息不记、办好了去勾、从清单引用一件事改对那一件、回答「还有什么没办」之前先读清单、待办的提醒到点时只提醒。同一套脚本与沙盒，`run.py --suite todo`。

- **输入**：
  - `todo/cases.json`：12 个用例。票 41 列的 9 条（该记待办 3 条、它自己的提醒 1 条、不该记 2 条、勾掉、引用改、问还有什么没办），另加两条：清单上已有同一件、待办的提醒到点（票 39 新写的叫醒措辞第一次上真模型）；票 44 再加「明天早上 8 点提醒我给房东回电话」（要办完的事加一个时刻：待办，提醒就在说的 8 点，`expect.reminder.clock`）。每条有当前段的历史、假 CLI 里已有的待办（截止、挂着的提醒、是不是在「In Hand」里、分段开始后有没有在面板上被勾掉）与定时任务、用户这句或这次叫醒到点的提醒，以及自动判定用的 `expect`。字段见 `_note`。
  - 提示词、CLI 帮助与 Rust 样本与定时评测共用 `schedule/` 下那三份（见上一节「票 41 重跑」）。
- **组成**：同定时评测。用例里分段开始前就有的待办与定时任务照 `in_hand_section` 的格式（票 39 的三组：用户的待办、它在办的、例行）写进「In Hand」一节，时间写成消息前一小时；之后在面板上被勾掉的，快照里仍是没做，假 CLI 里是做完的；这一段里刚记的不在快照里。「说说这件」的消息照 `gui/src/lib/composer-quote.ts` 的写法：引用块是那件事的标题，空一行，再接用户的话。待办的提醒到点时，新消息照 Core 的措辞（`subtask_report` 的待办一段）拼出。
- **假 CLI**：定时评测那个，另外回答 `todo list / show / add / update / done / reopen / cancel`：形状照 Agent API §5.28–§5.34，校验照真实 CLI 与 Core（`--due` 收本地日期或 `--at` 的写法、过去的日期不拒；`--remind-at` 过去报 `time_in_past:`；`--due=` / `--remind-at=` 空值、`--due` 与 `--no-due` 同给、`update` 什么都没给是参数错误，退出码 2，报错原文用开发版二进制在假 HOME 下抓的；未知或已取消的 id 退出码 3；勾掉与取消会取消还没提醒到的提醒，再勾不变，取消勾不恢复提醒；做完的不能挂提醒；`list` 的顺序与 `--all` 照 `todo_list_order`）。`todo add / update --remind-at` 建或挪的提醒是一个带 `todoId`、叫醒助理的一次性定时任务，`schedule list` 里看得到。
- **判定**：按 `expect` 自动判，看它发出的命令（假 CLI 的日志与最后的状态）和回复：该记的记了一件、标题对、截止在窗口里（要带时刻的带了）、有截止的挂了一个在截止之前的提醒、没时间的不写截止不挂提醒；它自己的提醒是 `schedule create --target=assistant`、不是待办，记下的话里带单号；不该记的什么都没写；勾掉的是那一件、记成 Galley 勾的；引用改的是那一件、截止到了新的一天、提醒跟着挪且不晚于新截止、没新建；问「还有什么没办」的先跑了 `todo list`、点到了三件、没把面板上勾掉的当成没办；已有的没再记、没再挂提醒，说出了已有提醒的时间；提醒到点的只提醒、不勾掉。每条都查 `todo` 与 `schedule` 写命令带没带 `--supervisor=galley-assistant`、`schedule create` 带没带 `--target=assistant`、有没有动不该动的待办、多余的写命令、会卡住主对话的命令或 `<subtask>`；回复里说出了提醒时间、字数上限。另记有没有先读手册、写之前有没有读清单（只记，不判；读手册一栏同上）。
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

这一轮的结果已被下面的票 44 重跑替换，原文在 git 历史里（票 41 的提交 `c3ed1604`）。

### 票 44 重跑（2026-10-17，gpt-6.1-sol，推理强度 high）

手册「To-dos and reminders」换了票 44 的判法（只要提醒一下的用它自己的提醒，要办完的事记成待办，用户说了几点提醒就挂在那个钟点），加了一条「明天早上 8 点提醒我给房东回电话」，整组重跑（旧结果没有并进 `meta.superseded_runs`）。判定只多一条：`expect.reminder.clock`，提醒要落在用户说的钟点；`--dry-test` 加了两条，8 点挂上的算过、提前到 7:30 的判得出。

- **结果**：24 次运行 24 次过（12 条各两遍），一次也没有改措辞。新加的那条两遍都是 `todo list` 后 `todo add "给房东回电话" --due=<明天> --remind-at=<明天>T08:00`（05:54 说的，按日历上的明天），回复「记下了，明天（10 月 18 日）早上 8 点提醒你给房东回电话。」，没用 `schedule create`。其余 11 条与票 41 那轮做法相同：季度报告截止周三 15:00、提醒周二 15:00；营养土不写截止不挂提醒；「明天要给房东回电话」截止明天、提醒明早 9 点；物流是它自己的提醒、带单号；吉他与航班号什么都没记；勾掉、引用改到周四、先读清单再答还有什么没办、已有的不再记、待办的提醒到点只提醒，都照旧。
- **用量**：24 次运行，80 次模型调用（05:53 开跑）。

## 手册按部分拆开（票 59）

主对话 PRD 裁决 111：手册从一个文件拆成 `docs/managed-ga-runtime/galley-assistant-manual/` 下的八个部分，入口层改成「写之前一起读要用的那几部分」，列出每个文件什么时候读。待办、定时、叫醒三套各重跑两遍，与上一次比通过率、请求次数、用时和读了手册的哪几部分。

- **跟着换的输入**：`run.py` 把整个目录拷到状态根下的 `assistant/reference/manual/`（Core 写它的位置），提示词里的占位换成 `__MANUAL_DIR__`；`manual_sha` 对全部部分算（文件名与内容，按文件名排序）；结果里的 `manual_files` 记下跑完时目录里有哪些文件。`schedule/` 与 `wake/` 的 `galley-prompt/` 照上面的办法重新生成（临时测试，跑完删掉）。`wake/` 的那份之前一直是票 30 的提示词，这次一并带上了票 36、41、44 的改动。
- **记读了什么**：「读手册」一栏写第一次读在不在第一次写之前，再写读了哪几部分、几次、落在几个模型轮次里、返回给模型共多少字节。一次工具调用提到手册目录就算读手册，部分按调用里出现的文件名认（模型常用一段 `code_run` 循环读几份）；`code_run` 同时做了别的事时，字节里也算上那些输出。票 59 之前的运行按旧路径认成「整本」。
- **对比**：每套 `results.md` 的「票 59 重跑」一节，由 `run.py` 从 `meta.superseded_runs` 里第一组原因以「票 59」开头的运行（即拆开之前的上一次）与现在的结果算出：通过率、平均请求次数（GA 的轮数）与用时、读手册的次数、轮数、字节、读过的部分，再逐条列出，要写的用例平均请求次数多出 1 次以上的标出来。叫醒评测另有一组同日对照（`meta.ticket59_control`：票 59 之前的提示词加整本手册，同一天跑），多一行一栏。
- **判定改了一处**：提醒在明天时，回复说出星期几或日期也算说出了哪天（之前只认「明天」；运行当天是周一，「周二下午 3 点」被判成没说哪天）。
- **`--dry-test` 加的**：提示词里的目录是状态根里的那个，目录里正好是八个部分；假模型在一轮里并发读两个部分、或读一个部分，读了哪几部分、几轮、多少字节都记得下来，「读手册」一栏写得对。

### 结果（2026-10-19，gpt-6.1-sol，推理强度 high）

| 评测 | 上一次 → 这一次 | 请求次数（均） | 用时 s（均） | 读手册字节（均） |
| --- | --- | --- | --- | --- |
| 待办 | 24/24 → 24/24 | 3.33 → 3.42 | 19.9 → 24.8 | 10419 → 6423 |
| 定时 | 28/28 → 28/28 | 3.04 → 3.04 | 21.1 → 23.9 | 10622 → 5946 |
| 叫醒 | 17/18 → 16/18（同日对照 14/18） | 2.94 → 3.44（3.56） | 24.5 → 29.0（32.2） | 3032 → 7614（7064） |

- **改过一轮措辞**：第一版（「read the parts it needs:」逐个列出部分）下待办 18/24、定时 24/28、叫醒 15/18。不过的多是身份参数：只读了 `todos-change.md` 或 `reminders.md` 去勾掉、改、取消，命令行上没有 `--supervisor=galley-assistant`，这条规则只在 `cli.md` 里；还有一遍「改到 9 点」只读了改待办的部分、另记了一件新待办。第一轮把「Every write but `llm set` carries `--supervisor=galley-assistant --reason="<why>"`.」写进入口层，改它自己的提醒指到 `reminders.md`，加上「together」，三套整组重跑。
- **叫醒那两次**：「结果够好」的报价日期写于 10-15 那一周，10-19 跑时模型当成上周的、打回去要本周的；同日对照同样 4 遍打回，所以算在用例日期上。去掉这两条三组都是 14/14。
- **补跑一次**：定时「不用了」第 2 遍话只写进 `<summary>`（票 36 见过的随机失误），补跑一遍过了。
- **用量**：第一版措辞 70 次、第一轮 70 次、补跑 1 次，同日对照 22 次（含先用票 30 的提示词跑的「结果够好」「两件一起」4 次，同样打回）。

### 票 61：「最近不要的跟进」的镜像（2026-10-19，没跑真模型）

Core 在「In Hand」的三组之后加了第四组「Follow-ups the user turned down」（主聊天 PRD 裁决 113）：Galley 建的待办与定时任务里，近 90 天被用户在桌面上取消、或它照用户的话取消的，最新在前，最多 5 条，每行写取消的时间、谁取消的、标题或任务的话与原因。镜像跟着改，没跑真模型，有内容时的效果由票 60 的评测测。

- **`in_hand_block`**：多一个参数 `declined`（`DeclinedFollowUp` 的 JSON 形状：`kind`、`id`、`text`、`cancelledAt`、`by`、可选的 `reason`），照 Rust 写第四组；为空时输出与之前逐字相同。
- **`declined_items`**：`assistant_todo::declined_items` 的移植，从 `todo show` / `schedule show` 形状的记录里挑出这一组。`sched_in_hand` 用它从假 CLI 起始的待办与定时任务里取快照之前取消的那些；现在的用例都没有取消过的，所以这一组为空，提示词与之前相同。用例里怎么写「已经取消过的」、判定怎么算，留给票 60。
- **`rust-samples.json`**：同一个临时测试（跑完删掉）多写了三组「In Hand」（四组都有并截断、只有这一组、只有这一组换成 UTC）和一组 `declined_items`（各种来源、90 天边界、同一秒按 id）；原有的样本逐字没变。`--dry-test` 逐字对照它们，另对一次「这一组为空时与票 61 之前相同」。
- **假 CLI**：`todo cancel`、`schedule delete`、`todo update --no-remind` 照真实 Core 记下 `cancelledBy`（`--supervisor`、`--reason`，没带标签时是 `{"via": "cli"}`），勾掉或取消待办时顺带取消的提醒记 `{"via": "system"}`；`show` 与 `--all` 都带上它。`--dry-test` 加了一条 `todo-cancel-by` 逐项核对。

## 它自己判断要不要跟进（票 60）

主对话 PRD 裁决 112、113：用户提到将来某天会发生、到时有用的事，它不等「提醒我」，按手册的三条门槛自己判断要不要跟进；清单收「你要跟的事」。手册改了 `todos.md`、`reminders.md`、`todos-change.md`，入口层的待办那一段加了一句（what comes up on a date and will be worth raising then）。待办、定时两套整组重跑，待办加 15 条新用例，入口层的 15 条闲聊用例另起一组重跑。

- **跟着换的输入**：`schedule/galley-prompt/main_chat.plain.txt` 照上面的办法重新生成（临时测试，跑完删掉），另生成 `main_chat.carried-1.txt`（带过来 1 轮的写法，闲聊组用）。`wake/galley-prompt/` 没有重新生成：叫醒评测这次没跑，那份仍是票 59 的提示词，与它的结果对应。
- **新用例**（`todo/cases.json` 第 13–27 条，每条两遍）：该跟进 5 条（`reno-asked` 是 JC 的原话）、不该跟进 3 条、两可 3 条（只记录、不判，通过率不算它们）、到点与取消 4 条（`wake-reno`、`stop-this-kind`、`declined-before` 与它的明说版 `declined-before-asked`）。
- **起始就取消过的事**：用例的 `cancelled` 字段。分段开始前取消的照票 61 的镜像写进「In Hand」的第四组；它的提醒照 Core 记成 `system` 顺带取消，不进这一组。`declined-before` 的完整首个请求在 `todo/composed/`。
- **判定改的**：
  - 只认这次运行里发生的取消：定时评测的「删了哪些」与 `move`、`keep`、`keep_or_replace`，待办评测的取消，都和起始状态比。之前按最终状态里有没有 `cancelledAt` 认，起始就取消过的会被算成这次删的（票 61 留下的坑）。
  - 新的 `expect`：`follow_up`、`todo: optional`、`cancel`、`asks_or_any`、`record_only`，写法见 `todo/cases.json` 的 `_note`。`flags` 记下过了但值得看一眼的（offer 记成了待办、原因超过 40 字会被「In Hand」截断、写了记忆等），写在判定一栏的「注」里。
  - 时间写法：一年里的某天（`month`、`day`、`year_offset`）、下周的星期几（`week_after`）。
  - 回复说出时间：提醒在两天以后的，说出哪天就算（手册自己的例子「11 月 20 号我问你一下装修完没。」不带钟点）；之前一律要钟点。
  - `results.md` 的对比一节改成按票：「票 60 重跑」比票 59 重跑后的结果与这一次，「票 59 重跑」仍比它自己的两次（这一次取自 `meta.superseded_runs` 里票 60 那一组）。
- **闲聊组**（`chat/`）：入口层评测的 15 条在票 60 的提示词下各跑一遍，用待办评测的沙盒与假 CLI，没有待办与定时任务。票 03d 那套（`--variant with`）是票 03d 的提示词、第一次工具调用就停，看不到它会不会真的写，所以另起一组。`chat/cases.json` 只写每条的期望，消息仍只在 `cases.json`。只判它设了什么：12 条不该设，转房租那条该记待办挂提醒，妈妈手术、成都机票两条两可只记录；回答本身（查网页停下、长短）不判，写在「另记」里。怎么跑：`run.py --suite chat --repeats 1`，`--render-only` 同上。
- **`--dry-test` 加的**：时间写法、两天以后只说哪天、定时评测不把起始就取消的算成这次删的；待办评测里它自己的跟进在窗口里算过、该跟进却没设算错、取消写明了类别算过与没写算错、「最近不要的跟进」的「In Hand」写法、有同类时不设算过与设了算错、两可只记录、到点复述算错与给下一步算过；闲聊组的提示词（带过来的写法、票 60 的入口层、没有「In Hand」）与判定。

### 结果（2026-10-19，gpt-6.1-sol，推理强度 high）

| 评测 | 票 59 → 票 60 | 请求次数（均） | 用时 s（均） | 读手册字节（均） |
| --- | --- | --- | --- | --- |
| 待办，原有 12 条 | 24/24 → 24/24 | 3.42 → 3.50 | 24.8 → 24.6 | 6423 → 8100 |
| 定时 | 28/28 → 28/28 | 3.04 → 3.11 | 23.9 → 24.6 | 5946 → 9120 |
| 待办，新 15 条 | 24/24（另 6 遍两可只记录） | 3.40 | 27.8 | 9634 |
| 闲聊 | 13/13（另 2 条两可） | 1.93 | 18.3 | 2209 |

- **没改措辞**：第一版手册与入口层下全过，没有第二轮。
- **该跟进**：JC 的原话两遍都记成待办，截止 11 月 20 日，提醒当天上午 9 点，回复说出何时提醒；「装修师傅说……能完工」没让记也两遍都记了同样的待办，回复「当天上午 9 点我提醒你确认是否如期完成」；租约两遍截止 2027-03-31、提醒 3 月 1 日；offer 两遍都是它自己的提醒、周五 18:00，回复「周五（10 月 23 日）傍晚 6 点我问你一下」；航班两遍都按 10 月 28 日（下周三）记、提醒 27 日晚 8 点。
- **不该跟进**：过去的事、公司成立日、「不用提醒我」都没设（成立日有一遍回「记下了」却什么都没写，见下）；「不用提醒我」两遍都没记待办。
- **两可**：复查、开学、火锅六遍都记成待办挂提醒（复查明早 8 点或今晚 8 点；开学前一晚 7 点；火锅提醒就在 7 点整，两遍一样）。回复原文在 `todo/results.md` 第 21–23 条。
- **到点与取消**：装修那天的提醒两遍都没复述，说「预计今天完工，确认进度、能否安排验收」，没勾掉；「这种装修进度的事别提醒我了」两遍都 `todo cancel` 那一件，原因 `user: no renovation progress reminders`（手册的例子原样）；「最近不要的跟进」里有 702 装修时，801 那句两遍都没设（一遍先查了历史、回「按你之前的意思，不另设装修进度提醒」），明说「801 那个 12 月 1 号提醒我一下」两遍都照办（12 月 1 日上午 9 点）。
- **闲聊**：12 条闲聊、问答、干活都没设任何东西；转房租记成待办，截止周五、提醒周四上午 9 点；妈妈手术那条建了它自己的提醒（明晚 7 点问一句），回复里说了；成都机票那条查了历史、没设，问哪天飞。
- **读手册**：要写的用例几乎都一起读 `todos.md`、`reminders.md`、`times.md`、`todos-change.md` 四份，约 13 KB（票 59 是 8–10 KB）：`todos.md` 3867 → 5853 字节，`reminders.md` 3413 → 4423，`todos-change.md` 1294 → 1653。请求次数与用时没有变多。
- **用量**：待办 54 次运行、186 次模型调用（18:48 开跑，约 9 分钟），定时 28 次、87 次（约 4 分钟），闲聊 15 次、29 次（约 2 分钟），共 302 次。

## 到点时说此刻有用的话（票 63）

主对话 PRD 裁决 115：Core 的两段叫醒说明（`subtask_report.rs` 的 `due_paragraph`、`todo_due_paragraph`）改成「说此刻对用户有用的话，不把原话念回去」，待办是清单上的事、不只是要办的，用户说办完或发生了才勾；手册「When one comes due」整节从 `reminders.md` 挪进 `wake.md`（改名「When a reminder comes due」，`<no-reply/>` 那条并进 `wake.md` 原有的一条），`reminders.md` 留一句指过去；`todos.md` 的第③条加了今晚就去、没什么要准备的不跟，「hang one reminder」那条加了它自己选时间时不定在开始那一刻；入口层待办那一段末尾加「Say 「记下了」 or the like only after you wrote it down this turn (a to-do, a reminder, your memory).」。待办、定时、叫醒三套与闲聊组重跑。

- **跟着换的输入**：`schedule/galley-prompt/` 两份与 `wake/galley-prompt/main_chat.plain.txt` 照上面的办法重新生成（临时测试，跑完删掉）；`wake/` 那份之前一直是票 59 的提示词，这次一并带上了票 60 的待办那一段。`schedule/rust-samples.json` 的六条叫醒消息由同一个临时测试从 `subtask_report::report_text` 重新写出（其余样本没变），`run.py` 的 `due_paragraph` 跟着改，`--dry-test` 逐字对过。
- **两个老问题**：「结果够好」（done-evidence）与「两件一起」（two-at-once）用同一份报价，日期改成按运行那天填（`wake/cases.json` 的 `_note`：当天、前一天、前两天，都不早于本周一）。`wake/cli-help.json` 用开发版二进制、假 HOME 重新抓了原来那 29 条（与 `schedule/cli-help.json` 的同名条目逐字相同：`session send` 多了 `--ensure-runner`，顶层与 `session`、`project`、`llm` 也是现在的），假 CLI 的 `session send` 认 `--ensure-runner`。
- **新用例**（`todo/cases.json` 第 21–23、28–32 条，每条两遍）：两可的三条改成判定（`hospital-tomorrow`、`school-monday` 该跟进，`hotpot-tonight` 不跟），它们票 60 的运行并进 `meta.superseded_runs` 的票 63 一组；另加 `hotpot-asked`（明说「记一下」：待办，挂了提醒就要早于开始）、`meeting-3pm`（提醒早于 15:00）、`remind-named-time`（「明天下午 3 点和客户开会，2 点 50 提醒我」：提醒就在 14:50）、`wake-offer` 与 `wake-surgery`（它自己的提醒到点：问一句，不念原话）。`wake-reno` 加判不复述（不以「提醒：」开头、不是标题原话）。闲聊组的 `personal-surgery` 照票 60 的做法改成判定：设次日的问候并在回复里说出来。
- **钟点按运行时间**：火锅与开会两条说的是今天的钟点，晚上跑就成了过去的事（票 60 在 18:48 跑「今晚 7 点」）。用例的 `clock` 让消息里的钟点取运行时还在前面的那个：火锅取晚上第一个离运行时刻还有 45 分钟以上的整点（「今晚 9 点」），开会离下午 3 点不足两小时就说「明天下午 3 点」；判定里的时间跟着算（`{"stated": true, "minutes": k}`）。21:15 以后跑会直接拒绝（晚上最晚的整点是 22 点）。这一次是 20:06 开跑：「今晚 9 点和朋友吃火锅」「明天下午 3 点要和客户开会，记一下」。
- **判定改的**：
  - 每条都判：回复里有「记下了 / 记住了 / 记好了 / 已记」时，这一轮必须有写（改动了假 CLI 的清单或提醒，或写了 GA 记忆）。待办、定时、闲聊三套都用；对比表里上一次的运行也按它重判，票 60 的 `founding-date` 第 2 遍因此不过。
  - 写记忆按运行前后状态根 `memory/` 下每个文件的哈希比（worker 的 `memory_snapshot`，结果里的 `memory_changes`；GA 自己记读取次数的 `file_access_stats.json` 不算），不只认 `file_write` / `file_patch`。
  - `follow_up.windows`（几个窗口任一个：复查的前一晚或当天早上）、`follow_up.clock`、`reminder.optional`、`no_recite`。
  - `wake-reno` 的「点到那件事」从只认「装修」放宽到「装修」或「702」：这一次第 1 遍「702 办公室今天按计划完工了吗？如果师傅已经收尾，可以约个时间现场验收……」没有「装修」二字，内容是对的。
  - 闲聊组有 `follow_up` 的用例，「回复没说出」算进判定（其余照旧另记）。
- **`--dry-test` 加的**：报价日期在用例写成的那个周四是原来的日期、在周一都是那个周一，文件名也填了；`--ensure-runner` 的发送到了假 CLI 且没被拒；钟点的取法（傍晚、上午、太晚拒绝）与判定里的时间；火锅明说「记一下」提醒在开始那一刻判错、提前半小时判过、不挂提醒判过并注出；今晚的火锅设了提醒判错；开会、点了时间的、复查的两个窗口、开学前一天；「记下了」没写判错、写了记忆判过、没说就不判；它自己的提醒被念回去判错；定时评测的「记住了」没写判错；闲聊组妈妈手术设了没说判错、没设判错、成都机票仍只记录；worker 跑的三条：一条什么都没写的运行记忆目录不变、一条用 `code_run` 往 `global_mem.txt` 追加一行认得出、它自己的提醒到点的叫醒消息是 Core 改后的措辞。

### 结果（2026-10-19，gpt-6.1-sol，推理强度 high）

| 评测 | 上一次 → 这一次 | 请求次数（均） | 用时 s（均） | 读手册字节（均） |
| --- | --- | --- | --- | --- |
| 待办，原有 12 条（票 60 → 票 63） | 24/24 → 24/24 | 3.50 → 3.54 | 24.6 → 26.9 | 8100 → 8146 |
| 待办，票 60 的 12 条判定用例 | 23/24 → 24/24 | 3.13 → 3.42 | 25.5 → 29.2 | 8935 → 9403 |
| 待办，票 63 的 8 条 | 16/16 | 3.81 | 31.0 | 10758 |
| 定时（票 60 → 票 63） | 28/28 → 28/28（补跑 1 次） | 3.11 → 3.07 | 24.6 → 25.1 | 9120 → 8733 |
| 叫醒（票 59 → 票 63） | 16/18 → 16/18 | 3.44 → 3.06 | 29.0 → 28.4 | 7614 → 6380 |
| 闲聊（票 60 → 票 63） | 14/14 → 14/14（另 1 条两可） | 1.93 → 2.07 | 18.3 → 22.0 | 2209 → 2369 |

上一次的运行都按现在的判定重判：票 60 待办的 23/24 是 `founding-date` 第 2 遍「记下了，你们公司成立于 2019 年 11 月 20 日。」，那一遍没有任何工具调用；闲聊的 14 条里算上了改成判定的妈妈手术（票 60 那一遍设了明晚 7 点的问候并说了，现在也算过）。待办这一轮开跑时，Rust 的全量测试在同一台机器上跑着，用时可能偏长。

- **没改措辞**：第一版 Core 说明、手册与入口层下就是上面的结果，没有第二轮。判定只放宽了 `wake-reno` 的「点到那件事」（见上）。
- **到点**：待办与定时套件里拼叫醒的七条（`wake-todo`、`wake-reno`、`wake-offer`、`wake-surgery`、`wake-on-time`、`wake-late`、`wake-obsolete`）十四遍都读了 `wake.md`（票 60 的 `wake-reno` 两遍只一遍读了），都没复述。`wake-reno` 两遍都问完没完、给验收这一步；`wake-offer` 两遍都只问一句（「之前等的那个 offer，有消息了吗？」「offer 有结果了吗，进展怎么样？」）；`wake-surgery` 两遍都先问手术顺不顺利、再问用户自己（「妈妈手术还顺利吗？她现在怎么样了？你有空再回我就好。」）；待办的季度报告那条两遍都改成先问交了没有。都没勾、没动任何东西。
- **今晚的火锅**：不说「记一下」的两遍都没设，但都先在第一轮说了要记（「我把今晚的安排记到待办里。」，另一遍写在 `<summary>` 里），读了手册再改口（「刚才说要加待办有点多此一举，就不加了。」「刚才说记待办有点多余」），见 `todo/results.md` 第 23 条；说「记一下」的两遍都记成待办，截止 21:00、提醒 20:30。开会两遍截止明天 15:00、提醒 14:30；「2 点 50 提醒我」两遍都在 14:50，没被第③条挪早。复查两遍都提醒在今晚 9 点（带证件、病历、报告），开学两遍都在周日晚 7 点。
- **「记下了」**：`founding-date` 第 1 遍说了「记下了」，这一遍用 `file_patch` 写进了 `global_mem.txt` 与 `global_mem_insight.txt`（判过，注出写了记忆）；第 2 遍没写也没说「记下了」。四套里再没有没写却说「记下了」的。
- **叫醒套件**：日期修好了，「结果够好」两遍都不再把报价当成上周的、没有打回，「两件一起」两遍都过。但「结果够好」两遍仍不过：都在交代之前想读截图里的字（读 `vision_sop.md`、`ocr_utils.py`，找系统的识别工具），一遍交代对了但多了一句「未能独立核验截图文字」，186 字超过 160 的上限，一遍用满工具调用、没走到回复。这是票 30 注 3 见过的过度核实，票 59 那两遍被日期问题盖住了；与本票改的叫醒说明（只改了提醒的两段）和 `wake.md` 新加的那一节无关，没改。`step-limit` 两遍都带 `--ensure-runner` 一次发成，请求次数 6.0 → 4.0。
- **闲聊**：12 条闲聊、问答、干活都没设任何东西；转房租记成待办挂提醒；妈妈手术建了它自己的提醒（明晚 7 点），回复里说了；成都机票查了历史、没设，问哪天出发。
- **补跑一次**：定时「不用了」第 2 遍删对了那一个，话只写进了 `<summary>`（票 36、票 59 见过的随机失误），补跑一遍过了。
- **用量**：待办 64 次运行、228 次模型调用（20:04 开跑，约 12 分钟），叫醒 18 次、55 次，定时 28 次、86 次，补跑 1 次、4 次，闲聊 15 次、31 次，共 126 次运行、404 次模型调用；`--dry-test` 不连模型。

## 先读手册再表态（票 64）

主对话 PRD 裁决 116：票 63 评测里「今晚 9 点和朋友吃火锅」两遍都没设（对），但第一轮先说了要记（一遍在正文「我把今晚的安排记到待办里。」，一遍在 `<summary>`），读了 `todos.md` 的第③条再在最终回复里改口（「刚才说要加待办有点多此一举，就不加了。」）。入口层待办那一段的「Do it unasked, and read `todo list` before saying what is left: see `todos.md` in your manual.」改成「Do it unasked, but read `todos.md` in your manual before saying you will (it says when), and `todo list` before saying what is left.」，「记下了」那句后面接「; if you write nothing down, do not bring up noting it.」。手册没动。待办套件重跑，先在同一时段用票 63 的提示词跑不该设的用例做基线；闲聊组重跑一遍；定时、叫醒两套没跑。

- **跟着换的输入**：`schedule/galley-prompt/` 两份照「怎么跑」的办法重新生成（临时测试，跑完删掉；同一个测试先在改动前的代码上跑过一遍，写出的两份与仓库里的逐字相同）。定时评测共用这两份，但这次没跑，`schedule/results.*` 仍是票 63 提示词下的结果；`wake/galley-prompt/` 没动。
- **判定加的**：什么都不该设的 7 条（`guitar`、`flight-number`、`past-trip`、`founding-date`、`reno-no-remind`、`hotpot-tonight`、`declined-before`，即 `expect` 不许任何写、`reno-no-remind` 可以记一件不挂提醒的）与闲聊组里不该设的 12 条加了 `expect.no_retract`：最终回复（去掉 `<summary>`、`<next-suggestion>`）不能有 `run.py` 的 `RETRACT_RE`（「刚才说」「多此一举」「多余」「本来要」「就不加了」「不特意设」一类）。这个正则对待办、闲聊、定时三套以前的全部 362 次运行只命中票 63 火锅那两遍。另记第一轮（不是最后一轮时）的正文与 `<summary>` 里有没有说要记（`STANCE_RE`：「记到待办」「设个提醒」「我先记下」「记下安排」一类，「不设提醒」不算，「记下了」另有判定），只记录、不判。`results.md` 多一节「票 64：改口与第一轮表态」，列票 63 的运行、基线与这一次。
- **基线**：`run.py --control 64` 把这次的运行存进 `meta.ticket64_control`，不替换结果、不写 `composed/`。21:23 用票 63 的提示词跑那 7 条各两遍，21:27 换成票 64 的提示词整组重跑，同一个小时里。
- **钟点**：火锅两条的 `hours` 加了 23（「今晚 11 点」，夜宵），21:15 到 22:15 之间也能跑；22:15 以后仍拒绝。这一次基线与重跑都是「今晚 11 点和朋友吃火锅」，与票 63 的「今晚 9 点」不同。
- **`--dry-test` 加的**：火锅那两句改口判错、不改口判过、要设东西的用例不按它判；闲聊里改口判错、平常的回复判过；第一轮表态记得下（正文与 `<summary>` 分开），「先看看手册」「不设提醒」、只有一轮的运行都不算表态；21:30 取「今晚 11 点」、22:30 拒绝；提示词是票 64 的那一段。

### 结果（2026-10-19，gpt-6.1-sol，推理强度 high）

| 评测 | 上一次 → 这一次 | 请求次数（均） | 用时 s（均） | 读手册字节（均） |
| --- | --- | --- | --- | --- |
| 待办，整组（票 63 → 票 64） | 62/64 → 64/64（补跑 1 次） | 3.56 → 3.55 | 28.8 → 27.9 | 9270 → 8776 |
| 待办，不该设的 7 条（票 63 / 基线 / 票 64） | 12/14 / 14/14 / 14/14 | 2.43 / 2.64 / 2.43 | 23.4 / 24.5 / 21.7 | 见 `todo/results.md` |
| 闲聊（票 63 → 票 64） | 14/14 → 14/14（另 1 条两可） | 2.07 → 1.93 | 22.0 → 18.0 | 2360 → 2823 |

上一次的运行按现在的判定重判：票 63 的 62/64 是火锅那两遍改口。

- **没改措辞**：第一版入口层下就是上面的结果，没有第二轮。
- **改口与表态**（「改口 / 表态 / 运行」，不该设的 7 条）：票 63 的运行 2 / 5 / 14，基线 0 / 5 / 14，票 64 0 / 1 / 14。基线在「今晚 11 点」下没有复现改口（两遍都没改口），所以改口这一项同一时段是 0 → 0，看不出差别；第一轮表态 5 → 1。基线的五次表态：成立日正文「我把这个日期记下来。」（之后写了记忆，说「记住了」）；装修不用提醒两遍（`<summary>`「我会只记待办，不设提醒。」、正文「我把完工日期记在待办里」，最终都没记）；火锅 `<summary>`「记下安排」；801 `<summary>`「我先记下日期」。票 64 只剩火锅第 1 遍的 `<summary>`「我先确认时间并记入待办。」，那一遍最终回复「11 点才开吃，妥妥的深夜火锅局呀 😄 和朋友吃得开心！」，没改口；第 2 遍「夜宵局呀 😄 吃得开心！」。闲聊 12 条两次都 0 / 0。
- **不退步**：该设的照样设，`hotpot-asked`、`hospital-tomorrow`、`school-monday`、`meeting-3pm`、`reno-mention`、`offer-friday` 等两遍都过；不该设的 7 条请求次数没变多（2.43 → 2.43，基线 2.64）。
- **补跑一次**：`wake-reno` 第 2 遍排在 64 次运行的队尾附近，比叫醒消息写的到点时刻晚了约 8 分钟才开跑，它查了时间，回复末尾加了「这次提醒晚了约 8 分钟」（判定不许说「晚了」）。与入口层的改动无关（叫醒消息里的到点时刻取的是整组开跑的时间），单独补跑一遍过了，原来那遍在 `meta.superseded_runs` 的「票 64 补跑」一组。
- **用量**：基线 14 次运行、37 次模型调用，待办整组 64 次、228 次（21:27 开跑，约 10 分钟），补跑 1 次、2 次，闲聊 15 次、29 次，共 94 次运行、296 次模型调用；`--dry-test` 不连模型。Rust 的全量测试在评测跑完之后才跑。

## 主动的第一阶段（票 73）

助手 PRD 裁决 10：没日子、在推进的事也记；记下时想一步，主动的是动作不是建议；每天 9:00 巡看在办的事。手册改了 `todos.md`（没日子的在办之事）、`reminders.md`（巡看的例外）、`wake.md`（「The morning review」，`<no-reply/>` 那条的例外），新加一部分 `unasked.md`；入口层待办那一段加「what they are in the middle of and will come back to」，后面加一段「记下时想一步、不提建议、交文件写 `[FILE:<绝对路径>]`」，手册列表里 `todos.md` 与 `unasked.md` 一起读；Core 加了巡看（`scheduler.rs` 的 `fire_review`，叫醒措辞是 `subtask_report.rs` 的 `review_paragraph`）。待办、定时、叫醒、闲聊四套重跑，待办加 9 条、叫醒加 1 条。

- **跟着换的输入**：`schedule/galley-prompt/` 两份与 `wake/galley-prompt/main_chat.plain.txt` 照「怎么跑」的办法重新生成（临时测试，跑完删掉；与仓库里的旧文件只差入口层那几段，`wake/` 那份之前一直是票 63 的提示词，这次一并带上了票 64 的那一段）。`schedule/rust-samples.json` 多了三组 Rust 原文：一组「In Hand」（一条没日子的待办加巡看那条例行，启用与停用各一）、两条巡看的叫醒（按时、晚了 8 小时）；原有样本逐字没变，`--dry-test` 逐字对照它们。
- **移植跟着改的**：`review_paragraph`、`OPENING_REVIEW`（叫醒里只有巡看时的开头；与别的混在一起照旧是 `OPENING_MIXED`）、`REVIEW_PROMPT`；`in_hand_block` 里巡看那条写「Galley's morning review, not set by you」；`in_hand_todo` 的「谁建的」照 `assistant_todo::creator`（`system` + 别的标签算 agent、标签带出来）。
- **巡看那条的写法**（`todo/cases.json` 的 `_note`）：`tasks` 里 `review` 为真的一条，origin 是 `system` + `galley-review`、每天、`target = assistant`、三天前建的；`time` 不写时取运行那一分钟，好让叫醒按时（措辞里的规则因此是「every day at 运行那一分钟」，不是 09:00；巡看不论几点叫醒措辞都一样）；`fired` 表示这一次到点、等着叫醒。分段开始前就有的写进「In Hand」的例行一组（下次到点是这一次）。
- **新用例**（每条两遍）：
  - 待办套件「在推进」：`half-done`（查阿里云费用暴涨查到一半，「先吃饭，回来再说」→ 没日子的待办，可做一步或派 1 件，不提建议）、`supplier-quote`（「供应商的报价还没回，我在等」→ 它自己回头问的提醒，今晚到明天中午，不是没日子的待办）、`tired-today`（「今天好累，不想动」→ 什么都不设、不派）。
  - 待办套件「两可」（只记录）：`shanghai-trip`（「下周三去上海出差」）、`report-half`（「季度报告我写了一半」）。
  - 待办套件「早上巡看」：`review-nothing-to-do`（只有一条 11 月 20 号的装修待办、提醒挂好了 → `<no-reply/>`）、`review-advance`（有没日子的「查清阿里云费用暴涨的原因」→ 做一步或派 1～2 件；只派出去时不出声，开口时带出是过了一遍在办的事）、`review-overdue`（只有昨天到期没勾的「交季度报告」→ 不催，`<no-reply/>`）、`review-stop`（「早上那个巡看别弄了」→ `schedule disable` 那一条，不是 delete，说一句怎么恢复）。巡看几条放在待办套件，不放叫醒套件：叫醒套件的假 CLI 数据只有会话（子任务），待办套件有待办与定时任务，到点叫醒也照 Core 的措辞拼（叫醒套件用的是 `wording.md` 的草稿）。
  - 叫醒套件：`file-handover`（子任务交回一个绝对路径的文件 → 交代里单独一行 `[FILE:那个路径]`）。路径写成 `{{HOME}}`，每次运行换成那次沙盒的假 HOME（`run_job`），结果里是 `$TMPDIR/…`，不写本机真实路径。
- **判定加的**（`todo_facts`，写法见 `todo/cases.json` 的 `_note`）：`subtasks_max`（回复里最多几个 `<subtask>`，不写就一个都不许，同以前）、`no_offer`（回复与末尾的建议里不能有「要不要我」「需要的话我可以」一类，`OFFER_RE`；别的用例只在「注」里写出来）、`allow_web_stop`（停在浏览器工具只注出来：它在做一步只读的事，沙盒里看不到结果）、`review_advance`、`disable`；`wake_facts` 加 `file_ref`（要有、是绝对路径、单独一行）。`--dry-test` 对这些各造了过与不过的运行（`synth_run`）。
- **记读了什么**：同票 59，「读手册」一栏写读了哪几部分、几次几轮、多少字节；票 73 起手册是九个部分。
- **模型**：评测一直用的 gpt-6.1-sol API key 条目（`mm_1790734996114`）已从 Galley 库里删掉，主对话自己的 gpt-6.1-sol 走 ChatGPT 登录（`chatgpt_codex_oauth`），凭据在 Core 的凭据通道里，评测脚本取不到（`model_from_galley_db` 只认 `api_key` 与 `none`）。票 73 起默认用 JC 新加的 `mm_1792576875658`（API key 接入的 gpt-6.1-sol，API key，`DEFAULT_MODEL_ID`），与票 63、64 同一个模型。中间先用外置 GA 配置里的 gpt-6-astra 跑过一轮，结果没有进仓库（主对话不是这个模型）。
- **对照**：原有用例的「上一次」就是 main 上票 63、64 在 gpt-6.1-sol 上的结果（提示词与 main 一致），不重跑；新用例另用 main 的提示词与八个部分的手册在 gpt-6.1-sol 上各跑一遍，存在 `meta.ticket73_control`（`--control 73`；叫醒套件的 `--control` 是票 73 加的）。

### 结果（2026-10-21，gpt-6.1-sol，推理强度 high）

模型同票 63、64（gpt-6.1-sol，推理强度 high、`chat_completions`、温度 1），条目换成 `mm_1792576875658`。「上一次」是 main 上票 63、64 的结果，用现在的判定重判。

| 评测 | 上一次 → 这一次 | 请求次数（均） | 读手册字节（均） |
| --- | --- | --- | --- |
| 待办，原有 32 条 | 64/64 → 63/64（补跑 2 次） | 3.55 → 3.67 | 8776 → 11287 |
| 待办，票 73 的 7 条判定用例（另 2 条两可只记录） | 新用例在 main 的提示词下 5/7 → 这一次 12/14 | 3.00 → 3.33 | 7066 → 11616 |
| 定时 | 28/28 → 28/28（补跑 1 次） | 3.07 → 3.11 | 8732 → 9225 |
| 叫醒，原有 9 条 | 16/18 → 18/18 | 3.06 → 3.11 | 6350 → 8276 |
| 叫醒，file-handover | 在 main 的提示词下 0/1 → 这一次 2/2 | 2.00 → 3.00 | 6579 → 3136 |
| 闲聊（15 条，判定 14 条） | 14/14 → 14/14（第二轮措辞，见下） | 1.93 → 2.20 | 2814 → 4394 |

- **改了一轮措辞**：第一版（入口层「what they are in the middle of and will come back to」，`todos.md`「it will not be done this turn」）下，闲聊组两条带过来的对话记了待办：`carry-quote`（分段前「我先出门，晚点回来再说这个报价」，这一段「回来了」）记「核对供应商上涨 12% 的报价」，`carry-laptop`（「那我就要第二台吧，还有什么要注意的？」）记「核对 B 配置后购买笔记本」，用户都在接着办这件事（闲聊 14/14 → 12/14；先跑的 gpt-6-astra 上也是这两条）。改成入口层「what they are in the middle of and set aside to come back to」，`todos.md`「sets aside to come back to … and they stop here for now」，加一句「Not while they carry on with it here: back to it (「回来了」), or asking about what they just chose, it needs no to-do.」，入口层 3132 → 3140 字节。只重跑这两条和待办套件「在推进」「两可」的五条：两条闲聊都不记了，`half-done` 仍记成没日子的待办。被替换的第一轮在 `meta.superseded_runs` 的「票 73 第二轮」一组（待办那五条第一轮判定 6/6 过）。
- **新用例逐条**（这一次）：
  - `half-done`：两遍都 `todo add "查清阿里云费用暴涨的原因"`，不写截止、不挂提醒，备注里是断点、线索与下一步，没有派活、没有建议；第 1 遍「好，先吃饭。我把账单排查记到待办了，回来接着查实例背后的负责人和 OSS 流量来源，不设提醒打扰你。」过；第 2 遍「好，先吃饭。回来接着查 deploy-bot 背后是谁，以及 OSS 流量对应哪个业务。」记了却只在 `<summary>` 里说，判不过（「Never note one without saying so」）。main 的提示词下那一遍什么都没记（「好，先吃饭，回来接着查。」）。
  - `supplier-quote`：两遍都是它自己的提醒，今晚 7 点问报价到了没（`schedule create --target=assistant`），都顺手起草了一段催报价的话、写明没发；第 1 遍「今晚 7 点」只写进了 `<summary>`，正文没说出时间，判不过；第 2 遍「他们说今天下班前发，我设好了今晚 7 点问你一下华立、东辰的报价到没到，免得一直干等。」过。main 的提示词下那一遍同样设了今晚 7 点的提醒，没有起草。
  - `tired-today`：两遍什么都没动，一两句陪着（「那就先不动，怎么舒服怎么待着。……我陪你待会儿，不催你。」）。
  - `review-nothing-to-do`、`review-overdue`：四遍都先读 `todo list`、`schedule list`、`sessions list`，回复只有 `<no-reply/>`，逾期的季度报告没催。
  - `review-advance`：第 1 遍读完清单和历史后要用浏览器去看账单（停在浏览器工具，判定只注出来）；第 2 遍派了 1 件只读调查的子任务（查 OSS 外网下行的业务归属，交回证据、不改配置、不开收费日志、不写用户的会话），回复只有子任务和 `<no-reply/>`。
  - `review-stop`：两遍都 `schedule disable` 巡看那一条（原因 `user: stop morning review`），没用 delete；「关掉了，以后早上不再巡看。想恢复时跟我说一声就行。」「已经关掉每天早上 9 点的巡看，不会再自动跑了。以后想恢复，跟我说一声就行。」main 的提示词下也停对了，但没说怎么恢复。
  - `file-handover`：两遍都单独一行 `[FILE:<绝对路径>]`，话里说了是什么（「你可以先打开预览，晚点把 HTML 文件发到群里。」）。main 的提示词下写成了 Markdown 链接（`[打开团建方案网页](…)`）。
- **两可的回复原文**（这一次，第二轮措辞）：
  - 「下周三去上海出差」：两遍都记成待办，截止 10 月 28 日（下周三），提醒 27 日晚 8 点，备注放了核对清单，没去查车次。「记下了：下周三 **10月28日去上海出差**。我会在 **10月27日晚上8点** 提醒你检查车票、住宿和随身物品。」「记下了：**10 月 28 日（下周三）去上海出差**，10 月 27 日晚 8 点提醒你准备。也附上了出发前检查清单：车票或机票、酒店、身份证、电脑和充电器、会议资料。」main 的提示词下同样记了。
  - 「季度报告我写了一半」：第 1 遍什么都没记，只问「后半段有思路了吗，还是卡在哪一部分？」；第 2 遍记成没日子的「写完季度报告」，回复「剩下主要是哪部分，是还没写到，还是卡住了？」（记了却没在正文里说，只在 `<summary>`）。第一轮两遍都记了、都说了「记下了」。main 的提示词下没记，问写到哪了。
- **原有用例**：待办 63/64，剩下的一遍是 `whats-left` 第 2 遍「买营养土已经不在未完成清单里了」被判成把勾掉的当成没办（判定的 `forbid_unless` 认的词里没有「不在」，回答本身是对的）；`wake-todo` 两遍排在后面、比叫醒消息写的到点时刻晚了约 5 分钟才开跑，照实说了晚，补跑两遍过（同票 64 的 `wake-reno`）。定时 `no-need` 第 1 遍话只写进 `<summary>`（票 36、59、63 都见过），补跑一遍过。叫醒 18/18：`done-evidence` 两遍都不再超长（上一次一遍超长、一遍用满工具调用），三个原有用例（`done-evidence`、`two-at-once`、`third-round`）都用 `[FILE:]` 交出了表格；长度判定不算 `[FILE:]` 那一行（`shown_len`，界面上它是卡片）。闲聊 12 条闲聊、问答、干活都没设任何东西，没有派活，回复与建议里没有「要不要我」一类。
- **读手册**：要记一件事时几乎都一起读 `todos.md`、`unasked.md`、`todos-change.md`，比上一次多 2.5 KB 上下；巡看读 `wake.md`、`subtasks.md`、`unasked.md`、`todos-change.md`；停掉巡看读 `reminders.md`、`times.md`、`wake.md`。请求次数略多（待办 3.55 → 3.67，闲聊 1.93 → 2.20）。
- **先跑过一轮 gpt-6-astra**（外置 GA 配置里的条目，结果没进仓库）：结论与这一次大体一致；不一致的是 `supplier-quote` 在 Astra 上一遍记成了带截止的待办（Sol 两遍都是它自己的提醒），`half-done` 在 Astra 上两遍都过，叫醒 `done-evidence` 在 Astra 上两组都超长。
- **用量**：gpt-6.1-sol 约 560 次模型调用（含补跑、第二轮与新用例的对照），`--dry-test` 不连模型。

## 安全措施

- 拦截点在 GA 的工具分发：worker 把 `agentmain` 里的 `GenericAgentHandler` 换成子类（runner 自己装处理器子类用的也是这个接口 `GaSession.install_handler`）。子类的 `dispatch` 遇到任何真实工具就记录并返回 `should_exit`，一次模型调用后整个运行结束；只有 GA 自己判断最终回答的 `no_tool`（只读回复文本）和格式错误的重试提示 `bad_json` 走原路。子类上除 `do_no_tool` 外的所有 `do_*` 方法都换成一调用就报错的版本，作为第二道保险。
- 第三道保险是进程级护栏：worker 里启动子进程、`os.system` / `exec` / `spawn`、打开浏览器、连本地 socket（Galley Core 与 CLI）、解析模型 API 以外的域名、往临时目录以外写文件，一律拒绝并记录。唯一的例外是沙盒模式（派活对照第二轮、叫醒评测）里 `code_run` 启动解释器：只能在执行 `code_run` 的那一刻、只能经 `sandbox-exec` 套上该次运行的沙盒配置、只能带沙盒里的环境变量、工作目录必须在沙盒里。
- `--dry-test` 在任何真调用之前验证这些：用假的模型流返回一个先说话、再调 `code_run`（`touch` 一个金丝雀文件）和 `file_write` 的回复，以及一个带建议标签的普通回复，检查只发生一次模型调用、没有进入任何工具方法、护栏无记录、金丝雀文件不存在、护栏确实拒绝子进程 / 域名 / 外部写入，并检查请求的拼装（GA 核心、Galley 段、Main Chat、WITH 的草案位置、历史顺序、带过来的那句）。
- 不碰真实数据：Galley 数据库以只读、immutable 方式打开（`mode=ro&immutable=1`，不写锁、不建 WAL 索引；票 36 之前是先拷到权限 700 的临时目录再读）；不写 `~/Library/Application Support/app.galley`、真实 GA 记忆或 `~/Documents/GenericAgent`；状态根路径若像真实数据目录就拒绝运行。
- 不留 key：key 只在内存里，经 stdin 交给 worker；请求记录只存请求体不存请求头；写结果前把 key 字符串整体替换掉；worker 日志随临时目录删除。
- 不留本机路径：写结果前把系统临时目录换成 `$TMPDIR`，把跑 worker 的解释器路径换成 `$PYTHON`、它的安装目录换成 `$PYTHON_ROOT`（票 41 起；之前的结果里还留着解释器路径）。
- 设 `PYTHONDONTWRITEBYTECODE=1`，不在 `managed-ga/code/` 下留 `__pycache__`。
