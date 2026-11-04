# 145 主对话：给定位与代价，不给界线；评测量结果，三个模型

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 194（JC 11-04：「按你推荐推进」；原文初稿给 JC 看过，JC 只回了评测模型：「评测用 gpt-6.1-sol、glm-5.3-flash 和 deepseek-flash」）。只在内置运行时的主对话；外置零变化（外置没有主对话），工作台、子任务、IM 不动。

## 为什么

- 派活一段一个月改了八版。139 只写「可以自己做，也可以交出去」，72 遍派 6 遍；193 加一句分类，对比按款拆对了，但预测问题、推荐笔记软件、整理发票也跟着派（票 143 Open risks 1、3、4）。
- 模型每轮收到的提示词，最前面是 GA 的「Physical-Level Omnipotent Executor」（`managed-ga/code/assets/sys_prompt_en.txt`），「你身后有一个团队」只在 `subtasks.md`、被叫醒才读。
- JC：不是把界线写得更细更多，而是把定位和能力告诉模型，让它自己判断怎么统筹。主会话补：能力之外还要给代价和用户偏好，139 缺的正是这些；有了插话改道（票 136），判错了一句话能改。

## 要做到

### 1. 定位：主对话里 Galley 层的开头（`core/src/managed_prompt.rs`）

`main_chat_static_prompt()` 现在由工作台的静态提示词替换一段而来。再替换开头「You are running inside Galley.」那一行，只在主对话里换成（初稿，给 JC 看过；措辞只在读不通时动，动了报告里写出来）：

```text
You are running inside Galley. In this conversation you are the user's
personal assistant, with a team behind you. The role above is how your
engine works with its own hands, and you still use them; here you also
decide, as a good chief of staff would for this user, what you do
yourself and what you hand to the team, and you keep them told.
```

工作台、子任务、`RUNTIME_PROMPT_STATIC` 不变。静态提示词若有字节预算，照它的规则重设（静态提示词有 Windows 那 18 字节的讲究，看预算常量上的注释，别照搬入口层的做法）。

### 2. 入口层派活一段（`main_chat_entry_layer`）

把下面这些删掉或并掉：

- 「You can do the work yourself, on the web too, or hand it to subtasks, several at once.」与票 143 那句分类（「Something the user will use to decide … you do yourself.」整段）；
- 「The user can talk to you at any time … and carry on.」；
- 「When the user hands you several errands … the same files.」；
- 「Tell the user in a sentence that it is on its way, without calling this chat the main chat. When it finishes, asks something or fails, Galley wakes you to check it and tell the user, so do not wait on it or watch it.」

换成（初稿，给 JC 看过）：

```text
How to go about a thing is yours to weigh. Doing it yourself is quicker
and lighter, and the user can talk to you while you work: what they say
reaches you at your next step, and `tell_user` answers them in a line
without stopping. A subtask starts fresh with this conversation's last
turns as background, looks into one thing in depth and runs alongside any
others; each takes a few minutes, and Galley wakes you once they are all
back, for you to check and put together. As a starting point, what the
user will decide on or keep is worth the wait for depth, and a question
in passing wants an answer now; their memos on how they like things done
come first. When something will take more than a moment, say in a line
how you will go about it; when the user says otherwise, do it their way,
and note it as a memo when it is how they want such things done.
```

并在标签那几句里接上：

```text
Write one tag per part, in the same reply, and they run at the same time;
keep in one tag the parts that need the same browser tab or the same
files.
```

```text
Do not call this chat the main chat. Galley wakes you when they finish,
ask something or fail, so do not wait on them or watch them.
```

**原样留着**：事实先查附出处那两句（「A fact in the world …」「An idea, a reason …」）；`authority.md` 那句；标签写法与标题那两句；派活说明写什么那句（「Galley starts each after this reply …」）；不用 `subagent.md` 那句；入口层开头（`MAIN_CHAT_ENTRY_LAYER_HEAD`）；待办、备忘、主动做、手册那几段。

段落的顺序你排，读起来像一段话：先怎么权衡，再事实与授权的底线，再标签与派活说明的写法。字节预算按实测重设（入口层的测试数之前去掉 `\r`，同票 139、143）；入口层上方文档注释加第七轮一段：裁决 194，为什么（八版、139 与 193 的数、执行者角色在最前），删了什么、留了什么。

### 3. 手册 `docs/managed-ga-runtime/galley-assistant-manual/memo.md`

「What they prefer or avoid.」补一个「事情怎么办」的例子，写成用户的话，例如「对比类不用派，直接查就行」。对应断言在 `core/src/assistant_manual.rs`。`docs/managed-ga-runtime/prompt-composition.md` 跟着改。

### 4. Core 断言

- 主对话静态提示词有新定位段的单行片段；工作台、`RUNTIME_PROMPT_STATIC` 没有。
- 入口层：新段落的单行片段在；删掉的几句（`Something the user will use to decide`、`Tell the user in a sentence that it is on its way`、`When the user hands you several errands`、`The user can talk to you at any time`）不在；留着的契约（`go by the three levels of authority`、`need the same browser tab or the same files`、`Do not call this chat the main chat`、`subagent.md`）在。工作台与 IM 的提示词里都没有新段落。
- contains 别跨行（Windows CRLF）。

### 5. 评测 `v7`（`.scratch/main-chat/entry-layer-eval/`）

提示词从 Rust 现生成，与 `managed_prompt.rs` 一字不差（含新的主对话静态提示词开头）；先 `--dry-test`。判法换掉：

- **不再判「该派不该派」**。派没派、拆几块、自己上没上网，照记，不计分。
- **量四样**：
  1. **先说一句打算**：要不止一步、或派出去的那些遍，用户第一次看到的字里有没有说它打算怎么做（派活那条回复、调工具那一步 `<summary>` 之外的字、`tell_user` 都算；读法同 `runner/step_text.py`）。
  2. **第一次看到字的时间**：从开始到用户第一次看到字的秒数（同上三种来源，或最后的回复）。
  3. **事实带出处**：事实类照旧，查了（自己或派出去且说明里要出处）、回复或派活说明里有出处才合格；凭记忆答不合格。概念、怎么做、凭这段对话的追问，直接答合格。这一条计分。
  4. **照不照偏好**：加一组带备忘的用例。备忘行写进提示词的 `### Memo` 一节（照 Core 的格式，看 `managed_prompt.rs` 里 `### Memo` 那段），两种：「对比、调研这类你要快的，直接查就行，不用派出去」与「要拿来做决定的东西，你宁可多等，也要查细」（用户的话、可改得更像备忘的写法，两种意思不变）。各配同一批用例：`q-headphones`、`c-phones-three`、`c-research-report`、`q-east`、`q-notes-apps`。「要快」下自己做、「要细」下派出去算照了。这一条计分。
- **派活判据**（`dispatch-criterion`，现有用例）、**并行**（`dispatch-parallel`）、**偏好**（新）三套用 v7 跑；**叫醒**（`wake/` 里票 143 加的三条）只用 gpt-6.1-sol 跑。
- **模型**（JC 点名）：`mm_1792576875658`（gpt-6.1-sol）、`mm_1787796272610`（glm-5.3-flash）、`mm_1789025687188`（deepseek-flash），都是 API key 接入，`--model-id` 换。gpt-6.1-sol 每条 3 遍；另两个先各 2 遍，结果分歧大的用例补到 3 遍。某个模型 v7 明显差时，用 v6 跑同一套派活判据对照一遍，判断是条款还是模型；不差就不跑 v6。
- 模型名可以写进结果（gpt-6.1-sol、glm-5.3-flash、deepseek-flash）；服务商的名字（`managed_model_providers.display_name`）与接口主机不写。某个模型报错、超时或格式不兼容，照实记下、跳过，别为它改 runner。
- 解释器用评测 README 写的系统 python3.14，加 `PYTHONDONTWRITEBYTECODE=1`。额度够（JC 11-03），用量写进报告。新条款有用例不过时，最多改一轮措辞、只重跑没过的，然后回报；措辞改了，改动原样写进报告。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

`rustfmt --check` 只查自己改过的 Rust 文件。预计不动 runner、GUI；动了就加对应检查。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t145-standing-and-costs <scratchpad>/wt-145 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：GA 的 `sys_prompt`、工作台与子任务的提示词、Core 的子任务与叫醒逻辑、GUI、runner、CLI、Agent API、迁移、IM、外置。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t145-` 前缀。票面与结果里不写本机用户目录、worktree 路径、服务商名、接口主机。
- 长命令前台跑，跑完再往下；别把评测交给后台进程后停下等。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：定位段与派活段的最终原文；字节预算旧值、新值、分项（入口层与静态提示词各自）；改了哪些文件、哪些断言；评测按模型分列：每套每个用例各遍的记录（派没派、几块、上没上网）与四样量的结果（先说打算的比例、第一次看到字的秒数中位与最长、事实出处合格数、偏好照做数），gpt-6.1-sol 的 v7 与 v6 并列；真模型调用次数与 token；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

## Comments
