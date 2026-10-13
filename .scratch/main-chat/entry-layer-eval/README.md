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
- 模型配置：从 Galley 数据库的临时副本读出 gpt-6.1-sol 这一行，按 `managed_model_layers` 的规则合并预设、全局默认与模型自己的选项（结果是 `chat_completions`、`stream`、`temperature` 1、`reasoning_effort` high），解出 key，交给 runner 自己的 `managed_model_config_from_env` 转成 GA 的配置。主对话会话行没有单独设推理强度，所以沿用模型配置。
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

## 安全措施

- 拦截点在 GA 的工具分发：worker 把 `agentmain` 里的 `GenericAgentHandler` 换成子类（runner 自己装处理器子类用的也是这个接口 `GaSession.install_handler`）。子类的 `dispatch` 遇到任何真实工具就记录并返回 `should_exit`，一次模型调用后整个运行结束；只有 GA 自己判断最终回答的 `no_tool`（只读回复文本）和格式错误的重试提示 `bad_json` 走原路。子类上除 `do_no_tool` 外的所有 `do_*` 方法都换成一调用就报错的版本，作为第二道保险。
- 第三道保险是进程级护栏：worker 里启动子进程、`os.system` / `exec` / `spawn`、打开浏览器、连本地 socket（Galley Core 与 CLI）、解析模型 API 以外的域名、往临时目录以外写文件，一律拒绝并记录。唯一的例外是派活对照第二轮（沙盒）里 `code_run` 启动解释器：只能在执行 `code_run` 的那一刻、只能经 `sandbox-exec` 套上该次运行的沙盒配置、只能带沙盒里的环境变量、工作目录必须在沙盒里。
- `--dry-test` 在任何真调用之前验证这些：用假的模型流返回一个先说话、再调 `code_run`（`touch` 一个金丝雀文件）和 `file_write` 的回复，以及一个带建议标签的普通回复，检查只发生一次模型调用、没有进入任何工具方法、护栏无记录、金丝雀文件不存在、护栏确实拒绝子进程 / 域名 / 外部写入，并检查请求的拼装（GA 核心、Galley 段、Main Chat、WITH 的草案位置、历史顺序、带过来的那句）。
- 不碰真实数据：Galley 数据库先拷到权限 700 的临时目录再读，读完即删；不写 `~/Library/Application Support/app.galley`、真实 GA 记忆或 `~/Documents/GenericAgent`；状态根路径若像真实数据目录就拒绝运行。
- 不留 key：key 只在内存里，经 stdin 交给 worker；请求记录只存请求体不存请求头；写结果前把 key 字符串整体替换掉；worker 日志随临时目录删除。
- 设 `PYTHONDONTWRITEBYTECODE=1`，不在 `managed-ga/code/` 下留 `__pycache__`。
