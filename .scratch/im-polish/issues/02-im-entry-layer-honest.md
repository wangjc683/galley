# 02 IM 入口层改成如实说

Status: done

来源：[PRD](../PRD.md) 裁决 4。

## 要做的

`core/src/managed_prompt.rs` 的 `im_supervisor_prompt`（`## Galley IM Entry Layer`）第一段今天写着：

> The user is talking to you through {platform_label}, usually on a phone. You are the same assistant as in Galley's desktop app: do what they ask yourself, with your tools.

IM 里的它是这个渠道自己养的 agent：和桌面共用 GA 长期记忆（IM 进程的工作目录就是内置状态根，`runner/managed_im_supervisor.py:370`），但看不到主对话和桌面会话的内容，也没有设提醒、待办、定时任务的手（这些归主对话的助理，`managed_prompt.rs` 里 `user_only_configuration!` 的最后一句）。改成如实说，要点：

1. 它是用户在这个渠道里的 Galley，自己动手办事（保留「do what they ask yourself, with your tools」）。
2. 长期记忆和桌面共用；桌面上的对话看不到。用户提到在电脑上说过的事，说明看不到、请他说一下要点，不要装作知道。
3. 提醒、待办、定时任务：说明要在电脑上的 Galley 对话里设，绝不说已设好。今天 IM 读的是通用那段（「in the Galley conversation atop the sidebar」），手机上读着别扭，入口层里给 IM 的说法，别和通用段打架。
4. 不在回复里自称「助理」以外的身份、不解释内部架构（agent、supervisor 这些词不进回复）。

措辞你来起草，短：入口层今天四段，这一改不该让它变长很多。

## 真模型对照

照 `.scratch/main-chat/entry-layer-eval/` 的做法（README 写了怎么跑、怎么从 Galley 数据库读模型配置），新建 `.scratch/im-polish/entry-layer-eval/`：WITHOUT 是 IM 渠道今天拿到的提示词（`compose_im_runtime_prompt` + `im_supervisor_prompt`，平台取 Telegram），WITH 只换入口层第一段。用例至少：

- 「明早八点提醒我开会」
- 「我刚才在电脑上让你查的耳机，结果怎么样了」
- 「你和电脑上那个 Galley 是一个吗」
- 「帮我看下这台电脑磁盘还剩多少」（正常干活，不该被新措辞带偏）
- 「记住我对花生过敏」（写长期记忆，照常办）
- 「把这个长活交给电脑上跑：整理下载文件夹」（派给桌面会话，照常走 Supervisor SOP）

产出 `results.md`（逐用例 WITHOUT / WITH 并排），供 JC 读。先 `--dry-test` 零额度验拦截，再真跑。

## 约束

- Rust 提示词：读 `core/src/managed_prompt.rs` 的测试，凡有字节预算的，Windows CI 检出是 CRLF，原始字符串每行多 1 字节（本机记忆：静态提示词 Windows 版比本机长 18 字节，预算按本机 +18 设）；`contains` 断言别跨行。
- `core` 不是 rustfmt-clean：只对自己动过的文件跑 `rustfmt --check`，别 `cargo fmt --all`。
- 开源仓库：评测结果、脚本、提交里不写接口域名、`api_host`、本机绝对路径。
- 改了提示词，`docs/managed-ga-runtime/prompt-composition.md` 若引用了这段原文，同步。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`。
- 对照结果交给 JC 读，JC 定稿后才算完；JC 若要改措辞，回到 WITH 重跑相关用例。

## 交付

在 worktree 分支上提交（只点名文件）。票 Comments 写措辞草稿、对照结论（逐用例一句）和没验证到的；Status 改 `ready-for-human`（等 JC 读对照）。

## Comments

### 2026-10-21 执行（worktree 分支 `im-polish-02`）

提交：`54915ee0`（入口层第一段与测试，`IM_PROMPT_BUDGET_BYTES` 1376 → 1738）、`750ef31b`（`prompt-composition.md`：IM 入口层一节、预算、条款台账一行、真机清单第 41、42 条）、`cf568aad`（对照评测）。没 push。`cargo check` / `cargo test --workspace`（45 个测试二进制全过）、`git diff --check` 都过；`managed_prompt.rs` 只格式化了自己的改动。

**措辞草稿（WITH，已写进 `core/src/managed_prompt.rs`）**，第一段：

```text
The user is talking to you through {platform_label}, usually on a phone. You
are their Galley here: do what they ask yourself, with your tools. You share
long-term memory with the desktop app, not its conversations: look up what
they said there (Past Galley Conversations) or ask for the gist, and never act
as if you knew. Reminders, to-dos and scheduled tasks are set on their
computer, in the Galley conversation, not from here. To the user you are their
assistant (助理); keep agents, supervisors and other inner workings out of
replies.
```

今天（WITHOUT）这一段 163 字节，WITH 535 字节，入口层整体（Telegram）1366 → 1738 字节，多 27%。

**和票面要点 2 不一样的一处**：票面写「说明看不到、请他说一下要点」，草稿写的是「去查，或者请他说要点」。依据：IM 拿到的通用规则里有「Past Galley Conversations」一节（`RUNTIME_PROMPT_STATIC`，`compose_im_runtime_prompt` 照用），教它用 `sessions search` / `session show --around` 查任何 Galley 会话；`sessions search` 不排除主对话（`core/src/db/search.rs` 的查询只按归档与运行时过滤）。所以 IM 其实查得到电脑上说过的话，写「看不到」是假话，还和通用段打架。对照里专门放了照票面写的 WITH-ask：4 次运行里模型全都照样去查了，「看不到」那句等于没写。

**对照**：`.scratch/im-polish/entry-layer-eval/results.md`。模型是 IM 渠道实际用的 gpt-6.1-sol（ChatGPT 套餐登录，推理强度 high），Telegram，每个用例每组 2 遍，共 40 次运行；`--dry-test` 先零额度验过拦截。另跑了两种第一段：WITH-ask（照票面：说看不到、请他说要点）和 WITH-short（更短，见下）。逐用例：

1. 「明早八点提醒我开会」：哪一组都没写定时任务或待办，也没说「设好了」；WITHOUT 已经会让用户去电脑上的对话里说（通用段那句），WITH 与 WITH-short 多了一句明说「这里不能设置提醒」。
2. 「我刚才在电脑上让你查的耳机」：所有组 8 次全都用 CLI 查到主对话那一轮，照原文答（型号、价格、结论都对），没有一次编；WITH-ask 也照查不误。
3. 「上午在电脑上跟你说的快递单号」（库里没有）：所有组都搜了「快递」「单号」，没找到就照实说、请他给线索，没有一次编单号；WITH-ask 两次改用 `ask_user` 问。
4. 「你和电脑上那个 Galley 是一个吗」：WITHOUT 答「同一个助手」，说别的「会话」上下文不会自动带进来；WITH 答「同一个 Galley 助理」，并说清共享长期记忆、不共享聊天上下文、需要时可以去查。这是差别最明显的一条。
5. 「帮我看下这台电脑磁盘还剩多少」：所有组都自己跑了 `shutil.disk_usage` 或 `df`，开头就给结论、一行一项，没被新措辞带偏。
6. 「记住我对花生过敏」：所有组都先读记忆 SOP，再写 `global_mem.txt` 与 `global_mem_insight.txt`，然后说「记住了」，没有差别。
7. 「把这个长活交给电脑上跑：整理下载文件夹」：所有组都先读 SOP 再 `session new`，带 `--supervisor=galley-im/telegram` 与 `--reason`，短暂 `session wait` 拿到 `timed_out` 后告诉用户在后台跑、做完在这里通知，没有差别。

合计：40 条回复里没有一条出现 agent、supervisor 这类词；「会话」一词 WITHOUT 14 条里 5 条、WITH 14 条里 3 条。

**我的推荐：用 WITH-short 替换现在写进代码的 WITH**（这一段 427 字节，比 WITH 少 108，入口层 1630）：

```text
The user is talking to you through {platform_label}, usually on a phone. You
are their Galley here: do what they ask yourself, with your tools. You share
long-term memory with the desktop app, not its conversations: never act as if
you knew what they said there. Reminders, to-dos and scheduled tasks are not
set from here. To the user you are their assistant (助理); keep agents,
supervisors and other inner workings out of replies.
```

理由：在措辞会起作用的四个用例上（1–4），WITH-short 8 次运行和 WITH 一样，提醒那条两次都指到「电脑端侧边栏顶部的助理对话」，身份那条两次都说清共享记忆、不共享对话；「去查」和「电脑上的 Galley 对话」两处，WITHOUT 和 WITH-ask 的结果说明通用段已经在管（查找靠 Past Galley Conversations，去哪儿设靠「What Only The User Changes」那句），入口层再写一遍是重复。代价：WITH-short 只在这四个用例上跑过、每例 2 遍；去哪儿设提醒全靠通用段那句，那句以后改了，IM 就跟着变。另一个选项是保留 WITH（已提交、全部 7 个用例跑过）。不推荐 WITH-ask：「看不到」不是事实，模型也不照做。

换 WITH-short 要做的：改 `im_supervisor_prompt` 第一段、`IM_PROMPT_BUDGET_BYTES` 改成 1630、`im_supervisor_prompt_says_what_it_shares_with_the_desktop` 里两条断言换片段、`prompt-composition.md` 同步，再用临时测试重写 `galley-prompt/im_entry.telegram.with.txt`，补跑用例 5–7（`run.py --cases disk,peanut,delegate-downloads --variant with`）。

**没验证到的、open risks**：

- 只跑了 Telegram。WeChat、飞书、Discord 的入口层只差平台名，没跑。
- 每组只跑 2 遍，看不出更细的波动；状态根是全新安装的样子，JC 真实的 GA 记忆没进来。
- 假 CLI 的 `sessions search` 是「每个词都出现」的子串匹配，真 CLI 是 FTS5（两个字的词走 LIKE），命中可能不同；`session wait` 立刻回 `timed_out`，真实情况下 IM 会按模型给的 5–15 秒真的等。主对话还在跑那个耳机查询的情形没测。
- 结果里有 JC 这台 Mac 的真实磁盘数字（容量、剩余量），已提交进开源仓库。不是路径、域名或 key，但要不要留请 JC 定。
- IM 的模型手里有 CLI，CLI 对 `schedule create` / `todo add` 不检查调用方是谁；这一轮没有一次去调，但只靠提示词挡着，没改。
- 评测用的是 ChatGPT 登录的访问令牌：从 Galley 数据库的副本（连 WAL 一起，复制到权限 700 的临时目录，读完即删）取出，原样使用、不刷新；脚本在令牌剩余不足 `--min-token-minutes`（默认 25 分钟）时拒绝开跑。以后复跑要赶在 Core 刷新过令牌之后。
- 文档里新加的真机清单第 41、42 条没在真机上跑过。

复跑：`PYTHONDONTWRITEBYTECODE=1 <有 cryptography 的 python3> .scratch/im-polish/entry-layer-eval/run.py --dry-test`，再去掉 `--dry-test` 真跑；`--cases`、`--variant` 只补跑几条，结果合并进 `results.json`。改了 Rust 措辞要先重写 `galley-prompt/`（`run.py` 文件头和 `results.md`「怎么跑的」写了来源）。

### 2026-10-21 定稿（JC：用推荐的 WITH-short；评测里的磁盘数字换成占位）

- **定稿**：`im_supervisor_prompt` 第一段换成 WITH-short 原文（上一条 Comments 里那段）；`IM_PROMPT_BUDGET_BYTES` 按实测设为 1630（Telegram 模板，不计 `\r`，比票 02 之前多 264 字节，零余量）；`im_supervisor_prompt_says_what_it_shares_with_the_desktop` 改查短版里有的单行片段，并保留对通用段两处的检查（IM 组合里有「Past Galley Conversations」、有「in the Galley conversation atop the sidebar」），因为短版把「怎么查」「去哪儿设」交给了它们；`prompt-composition.md` 同步。提交 `139c5ae1`。
- **评测对齐定稿**：`galley-prompt/im_entry.telegram.with.txt` 用临时测试从 Rust 重写（测试已删，产品代码没留）。原来叫 WITH-short 的那几次运行（用例 1–4）文字与定稿逐字相同，改名为 WITH；初稿改名为 WITH-long，它的请求样本改名为 `composed/desktop-earbuds.with_long-1.txt`；`results.md` 的说明里写了这次改名。提交 `ca02c4d5`。
- **补跑用例 5–7（WITH 定稿，各 2 遍，令牌 Core 刷新后才跑，剩 59 分钟）**：
  - 「帮我看下这台电脑磁盘还剩多少」：两次都自己跑 `shutil.disk_usage` / `df`，开头给结论、一行一项，和 WITHOUT、WITH-long 一样。
  - 「记住我对花生过敏」：两次都先读记忆 SOP，再写 `global_mem.txt` 与 `global_mem_insight.txt`，然后说「记住了」，没有差别。
  - 「把这个长活交给电脑上跑：整理下载文件夹」：两次都先读 SOP 再 `session new`，带 `--supervisor=galley-im/telegram` 与 `--reason`，拿到 `timed_out` 后告诉用户在后台跑、做完在这里通知；第 1 遍回复里说了「独立会话」（WITHOUT 第 1 遍也这样说过）。
- **磁盘数字**：评测目录里这台 Mac 的真实容量、用量、剩余量、百分比都换成了占位（大小写成 X，百分比写成 Y，工具输出里的原始数字写成 N），`results.md` 开头的说明写了一句「磁盘用例的数字已换成占位」。`run.py` 现在对 `cases.json` 里标了 `mask_numbers` 的用例在写结果前自动换掉，复跑不会再写出真数字；文件头写了这件事，并提醒新加读本机数字的用例也要标、提交前 grep 一遍。`--dry-test` 加了一条检查：模拟回复与真实 `df` 输出里的数字都被换掉，设备名与表头保留。按真实的容量、用量、剩余量、百分比（各种写法）grep 过，评测目录里没有残留；磁盘用例的回复与工具输出里剩下的数字只有设备名、临时目录名和退出码。
- **还在的**：真实数字仍在这个分支更早的提交 `cf568aad` 里（`results.md`、`results.json`），分支没 push；合入前若要历史里也没有，需要把这几个提交压成一个再合。WITH 定稿在用例 5–7 上是补跑的，用例 1–4 用的是定稿前同一段文字的那几次运行；只跑了 Telegram，每组 2 遍。
