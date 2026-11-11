# 「问一句」评测（票 02）

[IM 撤掉过程入口](../PRD.md)裁决 5：回答下面的「过程」入口撤掉之后，想知道它怎么做的就在聊天里问一句。这里用真模型量问一句的效果：一个多步任务答完，在同一个 Telegram 聊天里问它怎么做的，它会不会照实、简短地说出刚才那几步；渠道重启、从内核日志接回之后再问，是不是一样。只量，不改产品提示词。第二轮加了变体 `with_line`：入口层多一段「问起过程就复述、别重跑」，与第一轮（`without`）同样跑 16 次对照。结论、对照与逐条判定在 `results.md`。

## 文件

- `cases.json`：任务（第一条消息）、四种问法（第二条消息，三种计分、`elapsed` 只记录）、两个条件、每格遍数、变体（`variants`：`with_line` 那段话原文与它插在入口层哪一行之后），以及假 `~/Downloads` 的夹具（文件名与内容都是虚构的；几个大文件开头是真的文件头或真的 SQLite 库，后面是稀疏空洞，不占磁盘）。
- `galley-prompt/`：今天的 IM 提示词，由真实 Rust 代码写出：`im_runtime.txt` 是 `compose_im_runtime_prompt`（版本 0.7.8、macOS），`im_entry.telegram.txt` 是 `im_supervisor_prompt`（Telegram，SOP 路径留成 `__SOP_PATH__`）。生成办法同主评测 README：在 `core/src/managed_prompt.rs` 的测试模块里临时加一个测试写出这两个文件，跑完删掉。入口层与 `.scratch/im-polish/entry-layer-eval/galley-prompt/im_entry.telegram.with.txt` 一字不差；运行时提示词与那里的不同（待办一段的措辞、版本号），所以重新生成在这里，旧目录没动。
- `run.py`：脚本。把主评测（`.scratch/main-chat/entry-layer-eval/run.py`）与 IM 评测（`.scratch/im-polish/entry-layer-eval/run.py`）当模块导入、不改它们；自己补的是：多条消息发给同一个 agent、渠道接回的挂法、一次运行两个进程共用一个状态根、夹具、事实与判定、渲染。
- `results.md`：结论、一览表、每次运行的工具调用清单、回复原文与判定。
- `results.json`：原始结果，不进仓库（`.gitignore`），`--render-only` 从本机那份重出 `results.md`。

## 怎么跑

解释器用主评测 README「怎么跑」一节写的那个（要能 `import cryptography`，从 Galley 数据库只读解出 API key）。

```bash
PY=<主评测 README 里的解释器>
export PYTHONDONTWRITEBYTECODE=1   # managed-ga/code/ 下不许出现 __pycache__

$PY .scratch/im-answer-only/ask-process-eval/run.py --dry-test       # 不连模型：两个条件、接回、重跑、拦截
$PY .scratch/im-answer-only/ask-process-eval/run.py                  # 2 变体 × 4 问法 × 2 条件 × 2 遍 = 32 次
$PY .scratch/im-answer-only/ask-process-eval/run.py --variant with_line   # 只跑一个变体（第二轮就是这样跑的），结果合并
$PY .scratch/im-answer-only/ask-process-eval/run.py --asks how --conditions resumed --repeats 1 --first-repeat 2   # 补跑，结果合并
$PY .scratch/im-answer-only/ask-process-eval/run.py --judge <判词.json>   # 把读者的判定并进 results.json，重出 results.md
$PY .scratch/im-answer-only/ask-process-eval/run.py --render-only    # 只从 results.json 重出 results.md
```

模型只用 gpt-6.1-sol：`--model-id` 的默认值就是主评测脚本的默认值（API key 接入的那一条）。运行 id：`without` 是 `live-how-1` 这样（第一轮的 16 次保留原 id），其他变体前面加变体名，如 `with_line-live-how-1`。其他参数：`--parallel`（默认 3）、`--galley-db`、`--ga-lang`（默认 `en`）、`--keep-temp`。

判词文件按运行 id 给：`accurate`、`no_deflect`（真假）各带一句 `accurate_note`、`deflect_note`，可选 `redo_note`；`elapsed` 的运行另给 `elapsed`（`unknown` / `grounded` / `made_up`）与 `elapsed_note`。第 1 项（第二条消息之后的工具调用数）与第 4 项（字数、表格、标题、代码块、路径）是脚本数的。

## 它复现了什么

- 提示词：Galley 那段是 IM 渠道今天拿到的组合，按 runner 的 `managed_prompt_profile` 拼接；GA 核心提示词与记忆由引擎自己拼。消息照 tgapp 的写法（`FILE_HINT` 一行加空行加用户的话）经 `put_task` 发出。
- 引擎与工具：主评测的 worker（托管模式、全新状态根、模型配置从 Galley 数据库只读取得），工具在每次运行自己的沙盒里真的执行（假 HOME、没有网络、可启动的程序有限，见 `results.md`「怎么跑的」）；Supervisor SOP 在状态根的 `im/reference/`，假 `galley` 用 IM 评测的那份。
- `live`：同一个 agent 进程，任务答完后接着发第二条消息。
- `resumed`：任务答完后进程退出；第二个进程用同一个状态根与渠道状态目录，照 `runner/managed_im_supervisor.py` 的 `_run_telegram` 在装好提示词后 `im_resume.load` + `ChannelResume.attach`，也就是渠道真实的接回路径（`continue_cmd.continue_inplace(..., restore_wm=True)`，从内核日志装回含工具调用与结果的原生历史和工作记忆），再发第二条消息。每次运行记下接回调用了什么、返回了什么、装回多少条消息。

## 它没有复现什么

- Telegram 本身（发送、渲染、分条、在跑时的状态消息）与渠道进程的其余部分（完成汇报、`/new`、`/continue`）；第二个进程不是被 Core 杀掉重启的，而是第一个进程自己退出后再起一个；第二条消息紧接着任务发出。
- 真实的工具环境与 JC 的 GA 记忆；只量了一个任务，每格两遍。
