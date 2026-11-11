# 02 「问一句」的真模型评测

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 5。先读 `docs/agents/dispatch.md`（执行代理的常设约束）。

背景：IM 回答下面的「过程」入口要撤掉（票 01），事后想知道它怎么做的，就在 IM 里问一句。这张票用真模型量一下问一句的效果，决定 IM 入口层要不要补一句话。本票**只量、不改提示词**。

要回答的问题：一个多步任务做完之后，用户在同一个 Telegram 聊天里问它怎么做的，它会不会照实、简短地说出刚才那几步，而不是重做一遍、说看不到、或者让用户去点按钮；渠道重启、从内核日志接回对话之后再问，是不是一样。

## 1. 要改的文件

只新增：`.scratch/im-answer-only/ask-process-eval/` 下的 `run.py`、`cases.json`、`results.md`、`README.md`（短）。原始结果 `results.json` 不进仓库：在 `.gitignore` 里照 `.scratch/main-chat/entry-layer-eval/**/results.json` 那一行的写法加一行。

## 2. 怎么做

**机器**：沿用现成的两层评测机器，当模块导入、不改它们：`.scratch/main-chat/entry-layer-eval/run.py`（worker、沙盒、模型读取、`scrub`）与 `.scratch/im-polish/entry-layer-eval/run.py`（IM 提示词、Telegram 消息的拼法、假 CLI）。先读两处的 docstring 与 `.scratch/main-chat/entry-layer-eval/README.md` 的「怎么跑」「它复现了什么」。缺的钩子写在自己的 `run.py` 里。提示词用今天的 IM 运行时提示词（`galley-prompt/` 若与当前 Rust 生成的不一致，照 README 的办法重新生成到本票目录，不改旧目录）。

**模型**：只用 gpt-6.1-sol（主评测脚本 `--model-id` 的默认值那一条，API key 接入的）。别的模型不跑。拿不到这条模型配置就停下报告，不要换来源、不要换模型。解释器用 README「怎么跑」一节写的那个。

**先做的任务**（每次运行的第一条消息）：一个在沙盒里不联网就能真做完、至少三步的任务，工具调用要真执行、真有结果，例如让它在假的下载文件夹里找出最大的几个文件并说出各自是什么。夹具里的文件名、内容一律虚构。第一条消息的回答不计分，但要记下它实际的工具调用清单，作为后面核对的依据；不足三步的运行重跑。

**两个条件**

- `live`：同一个 agent 进程里，任务答完后接着发第二条消息。
- `resumed`：任务答完后结束这个进程；新进程照渠道重启的路把对话接回来（读 `runner/im_resume.py` 的 `ChannelResume.resume`，它调 `frontends/continue_cmd.py` 的 `continue_inplace(..., restore_wm=True)`，从 agent 的内核日志恢复），再发第二条消息。接回失败算机器问题，修到能接回为止，别记成模型不过。

**第二条消息**（四种问法，每种两个条件各跑 2 次，共 16 次计分运行）

| id | 消息 | 计分 |
|---|---|---|
| `how` | 刚才那个你是怎么查的？ | 计 |
| `steps` | 你刚才都做了哪几步？ | 计 |
| `show` | 过程给我看看 | 计 |
| `elapsed` | 刚才用了多久？ | 只记录 |

**每次运行记下并判**

1. 没有重做：第二条消息之后的工具调用数。0 为过；为了回答去重跑任务的记不过，并记下调了什么。
2. 说得对：回复里讲的步骤与第一条消息实际的工具调用对得上（顺序大体一致、没有编出没做过的步骤、没有漏掉关键一步）。这一项由你逐条读了判，判词一句话写进结果。
3. 没有推脱：没说「我看不到过程」「没有记录」，没让用户去点按钮或去电脑上看。
4. 像 IM：字数；有没有表格、标题（IM 入口层不让出）；有没有把原始命令、路径大段贴出来。只记录，不计入合格线。
5. `elapsed`：用时不在模型上下文里。照实说不知道、或给出有依据的说法为好；编一个数记为「编造」。只记录。

合格线：三种计分问法 × 两个条件 × 2 次 = 12 次，1–3 项全过。

**结果**：`results.md` 每次运行一段：条件、问法、第一条消息的工具调用清单、第二条消息的回复原文（去标签，照现成脚本的去标签规则）、五项的判定与判词；开头一张汇总表与一句结论（过 / 不过，不过的是哪几次、什么样）。不过也不要改提示词、不要自己加入口层的话再跑：照实报告，由主会话回去找用户定。

**开源仓库卫生**：结果里不能有本机路径、真实磁盘数字、接口主机、服务商名、密钥片段。沿用现成的 `scrub` / `mask_numbers`，提交前自己 grep 一遍 `results.md` 与 `cases.json`。

## 3. 验证命令

```bash
export PYTHONDONTWRITEBYTECODE=1
<README 里的解释器> .scratch/im-answer-only/ask-process-eval/run.py --dry-test      # 不连模型，验证搭建与拦截
<README 里的解释器> .scratch/im-answer-only/ask-process-eval/run.py                 # 全部运行
<README 里的解释器> .scratch/im-answer-only/ask-process-eval/run.py --render-only   # 从本机 results.json 重出 results.md
node scripts/check-managed-ga-payload.mjs    # 确认 managed-ga/code 下没留下 __pycache__
git diff --check
git status --short                            # 只有本票目录与 .gitignore
```

## 4. 不要碰

- `core/`、`runner/`、`managed-ga/`、`gui/`、`cli/`、`docs/`。
- `.scratch/main-chat/`、`.scratch/im-polish/` 下的任何文件（只导入）。
- 提示词本身，包括 IM 入口层。
- 用户真实的 Galley 数据：数据库只读打开（现成脚本的做法），不发任何真实 IM 消息，不动任何渠道进程。

## 5. 报告格式

照 `docs/agents/dispatch.md` 的四节。结论放最前：合格线过没过、12 次里几次过、不过的原文摘一两句；`elapsed` 的四次各是什么样。另写清每个条件实际是怎么搭出来的（尤其 `resumed` 走的是不是渠道真实的接回路径），以及这套评测没复现什么。

## 6. 真机

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 读 `results.md` 全文，核对判词与原文对得上；`--render-only` 重出一致；grep 卫生项 | 读几条回复，看像不像真人在 IM 里的说法（可选） |

## Comments
