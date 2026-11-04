# 145 主对话：给定位与代价，不给界线；评测量结果，三个模型

Status: needs-dogfood（2026-11-04 三轮后快进合入 `6ab41b9c`（裁决 194、195、196）。主会话验收：读过三轮报告与最终原文；第一轮「先说一句打算没起作用」是只看总数的误读，代理第二轮按做法拆开更正，主会话转述时没核，记在裁决 196 第 1 条；第三轮 v9 三个条件都过（gpt-6.1-sol 自己上网先说打算 2/37 → 13/38、见字中位 23.7 → 10.7 秒；三件差事 3、3、3；对比仍按款拆）；代理验证 workspace 1,345 条、文档链接、`--dry-test` 与门禁过。dev 真机走过两句，见 Comments）

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

（2026-11-04，执行代理。分支 `t145-standing-and-costs`，基于 main `7fa6e779`。没动 GA 的 `sys_prompt`、工作台与子任务的提示词、Core 的子任务与叫醒逻辑、GUI、runner、CLI、Agent API、迁移、IM、外置。）

### 1. 定位段与派活段的最终原文

定位（`core/src/managed_prompt.rs` 的 `MAIN_CHAT_STANDING`；`main_chat_static_prompt()` 在换掉那段配置之后，再把共享静态规则里的开头一行 `GALLEY_OPENING`「You are running inside Galley.」换成它，只在主对话）：

```text
You are running inside Galley. In this conversation you are the user's
personal assistant, with a team behind you. The role above is how your
engine works with its own hands, and you still use them; here you also
decide, as a good chief of staff would for this user, what you do
yourself and what you hand to the team, and you keep them told.
```

与票面初稿一字不差。

入口层派活一段（`main_chat_entry_layer`，接在开头 `MAIN_CHAT_ENTRY_LAYER_HEAD` 之后，「Note what the user has to do」之前）：

```text
How to go about a thing is yours to weigh. Doing it yourself is quicker
and lighter, and the user can talk to you while you work: what they say
reaches you at your next step, and `tell_user` answers them in a line
without stopping. A subtask starts fresh with this conversation's last
turns as background, looks into one thing in depth and runs alongside any
others; each takes a few minutes, and Galley wakes you once they are all
back, for you to check and put together. As a starting point, what the
user will decide on or keep is worth a subtask's wait for depth, and a question
in passing wants an answer now; their memos on how they like things done
come first. When something will take more than a moment, say in a line
how you will go about it; when the user says otherwise, do it their way,
and note it as a memo when it is how they want such things done.
A fact in the world (a person, an event, a game, the news, a figure, a
price, how someone is doing lately): look it up before you answer,
yourself or by a subtask, and give your sources. An idea, a reason, how
to do something, your view, or what this conversation already answers
(what a subtask brought back included): answer it directly, without
looking it up again.
To change things on the user's computer or accounts, go by the three
levels of authority in `authority.md`.
To hand something off, end your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
Write one tag per part, in the same reply, and they run at the same time;
keep in one tag the parts that need the same browser tab or the same files.
Galley starts each after this reply, with this conversation's last turns
as background, so write the goal, what you have found so far, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path).
Do not call this chat the main chat. Galley wakes you when they finish,
ask something or fail, so do not wait on them or watch them.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.
```

- 顺序：先怎么权衡（代价、出发点、先说一句、听用户改），再底线（事实先查附出处、`authority.md`），再标签与派活说明的写法。
- 对票面初稿的改动：两处。①出发点那半句：初稿「what the user will decide on or keep is worth the wait for depth」，现在是「is worth a subtask's wait for depth」：票面允许的那一轮，评测之后改的，理由与重跑的数见 4。②「keep in one tag the parts that need the same browser tab or the same files.」换了行（初稿在「the same」后断行），字没动，只为这句契约落在一行里、断言不跨行。
- 删掉的：「You can do the work yourself, on the web too, or hand it to subtasks, several at once.」与票 143 那句分类（「Something the user will use to decide … you do yourself.」整段）；「The user can talk to you at any time … and carry on.」；「When the user hands you several errands that do not depend on each other, or one piece of work splits into parts done apart, whether they stand on their own or you merge them when they are back, write one tag per part in the same reply: they run at the same time. Keep in one tag the parts that need the same browser tab or the same files.」（换成新的两行）；「Tell the user in a sentence that it is on its way, without calling this chat the main chat. When it finishes, asks something or fails, Galley wakes you to check it and tell the user, so do not wait on it or watch it.」（换成「Do not call this chat the main chat. …」两行）。
- 原样留着：事实先查附出处那两句、`authority.md` 那句、标签写法与标题那两句、派活说明写什么那句、不用 `subagent.md` 那句、入口层开头、待办、备忘、主动做、手册那几段。

手册 `docs/managed-ga-runtime/galley-assistant-manual/memo.md`「What to note」那一条：

```text
- What they prefer or avoid, how they want things done included
  (「对比类不用派，直接查就行」).
```

（原来是「- What they prefer or avoid.」。补了「how they want things done included」半句，不只是例子：同一份 `memo.md` 末尾有「how to do things (their setup, paths, what went wrong before) stays in your own memory」，不写明的话，「事情怎么办」的偏好可能被当成那一类记进 GA 记忆。那一句没动。）

### 2. 字节预算

入口层 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：旧值 5268，新值 5008，本机实测 5008（不留余量，测试数之前去掉 `\r`，同票 139、143）。分项（−260）：

- 开头那句（「You can do the work yourself …」605，含裁决 193 那句分类）与「The user can talk to you at any time …」（246）换成一段代价（865，+14）：「yours to weigh」43；自己做快而轻、用户下一步就够得着、`tell_user` 一句不停 189；子任务带着最近几轮从头开始、深查一件、几件同时跑、要几分钟、齐了叫醒一次 241；出发点 142（其中「a subtask's」换掉「the」+8，是评测之后那一轮改的）；备忘优先 53；先说一句打算 85；照用户的办、是一贯的做法就记成备忘 112。
- 并行那句只留「一块一个标签、同时跑」与同一个标签页或同一批文件放一个标签：340 → 150（−190），前面那半句条件（几件互不相干的差事、或一件拆成几块）删了。
- 「on its way」与不等不盯：217 → 133（−84），换成「Do not call this chat the main chat.」与「Galley wakes you when they finish, ask something or fail, so do not wait on them or watch them.」。

主对话静态规则：原来没有自己的预算，测试 `main_chat_static_rules_stay_within_the_static_budget` 要它不超过共享的 `STATIC_PROMPT_BUDGET_BYTES`（6869，Windows；POSIX 6851）、也不比共享的长（票 36 那段配置换下来短 89 字节，POSIX 6762）。定位段让它比共享的长，所以给它单独一个常量 `MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES` = 7092，照共享那个的规矩设：不留余量、按较长的平台（Windows 的历史查询命令比 POSIX 长 18 字节），`\r` 不计；POSIX 实测 7074。分项：6762 + 定位段 312（段落 342 字节，换掉 30 字节的开头一行）= 7074，Windows +18 = 7092。共享的 `STATIC_PROMPT_BUDGET_BYTES` 没动（工作台、子任务、IM 的静态规则一字没变，`prompt_hash` 也不变）。

都写在常量注释与 `docs/managed-ga-runtime/prompt-composition.md`（Budget 一节、预算一条、条款台账）里。

### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：
  - 新 `GALLEY_OPENING`、`MAIN_CHAT_STANDING`（文档注释写为什么：GA 的执行者角色在最前，「身后有团队」只在 `subtasks.md`、被叫醒才读；不打补丁）；`main_chat_static_prompt()` 多一次 `replacen`。
  - 派活一段换成新文；入口层上方文档注释首段补一句，末尾加第七轮一段（裁决 194；八版、139 的 72 遍派 6 遍、193 的翻车点、执行者角色在最前；删了什么、留了什么）。
  - 预算：入口层常量与分项；新常量 `MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES` 与注释。
  - 测试：`main_chat_entry_layer_leaves_the_hand_off_to_judgment` 重写（新段落 12 个单行片段；删掉的 13 句各断言不在，含票面点名的 `Something the user will use to decide`、`Tell the user in a sentence that it is on its way`、`When the user hands you several errands`、`The user can talk to you at any time`；留着的契约：事实两句的 6 个片段、`authority.md` 两个片段（「go by the three levels of authority」在原文里跨行，按单行拆成「…, go by the three」与「levels of authority in `authority.md`.」两段断言）、标签与标题、`Write one tag per part …` 与 `keep in one tag the parts that need the same browser tab or the same files.`、派活说明 4 个片段、`Do not call this chat the main chat. …` 两行、`subagent.md`；顺序：权衡 < 事实 < authority < 标签 < 待办；工作台与 IM 的提示词里没有新段落的 7 个片段，也没有 `<subtask`、`tell_user`）。新测试 `only_the_main_chat_opens_with_its_standing`（定位段 5 行在主对话里、在 `## About Galley` 之前，开头一行只出现一次；共享静态规则里开头一行正好一次、建议那节里没有；`RUNTIME_PROMPT_STATIC`、工作台静态规则、工作台提示词、IM 提示词、子任务提示词都有那一行、都没有定位段的后四行与「with a team behind you」「chief of staff」）。`main_chat_static_rules_stay_within_the_static_budget` 改名 `main_chat_static_rules_stay_within_their_budget`（新常量；长度 = 共享 − 配置那段的差 + 定位段的差；去掉定位段后仍在共享预算内）。`only_the_main_chat_sets_scheduled_tasks_itself` 与 `main_chat_section_names_the_conversation_and_its_segment` 的「只差这几处」改成两次替换都还原。所有 contains 都是单行片段。
- `core/src/assistant_manual.rs`：`manual_keeps_the_users_memos` 里「- What they prefer or avoid.」换成新那条的两个单行片段。
- `docs/managed-ga-runtime/galley-assistant-manual/memo.md`：上面那条。
- `docs/managed-ga-runtime/prompt-composition.md`：开头组成一段（主对话静态规则还差开头一行）；Budget 一节加主对话静态规则自己的预算；「The main chat reads its own paragraph」那条改写预算一句，后面加「The main chat opens with its standing」一条；入口层那条改成「How to go about it is the model's to weigh, given the costs」（新文的意思、裁决 193 那句的历史、删掉的原因）；并行、「on its way」、不等不盯的历史句；预算一条 5268 → 5008 与分项；`memo.md` 的说明；条款台账加一行。
- 评测（`.scratch/main-chat/entry-layer-eval/`）：`run.py`、`dispatch-criterion/cases.json`（每条加 `v7`，`q-followup-quick` 加 `v7_scored: false`）、`dispatch-parallel/cases.json`（`p-same-tab`、`p-same-files` 加 `v7_together`）、新 `preference/cases.json`、新 `dispatch-criterion/galley-prompt/main_chat.v7.txt`、`main_chat.v7-r1.txt`（第一轮措辞，v7、v7glm、v7ds 都跑在它下面；`main_chat.v7.txt` 是第二轮、与 Rust 一字不差）、各套件 `results.*`、`composed/` 新请求、`README.md`。

`docs/project-status.md`、主对话 PRD、devlog 没动，留给主会话。

### 4. 评测

v7 的提示词由 Rust 现生成（临时测试写出文件，跑完删掉），`--dry-test` 读 Rust 源码核对：开头那段与 `MAIN_CHAT_STANDING` 一字不差、入口层一字不差、与 v6 只差开头那段和派活那一段。解释器是 README 写的系统 python3.14，加 `PYTHONDONTWRITEBYTECODE=1`。模型都是 API key 接入：gpt-6.1-sol（`mm_1792576875658`，下称 sol）、glm-5.3-flash（`mm_1787796272610`，下称 glm）、deepseek-flash（`mm_1789025687188`，下称 ds）；没有一个报错或格式不兼容到要跳过（glm 撞过速率限制，见下）。

**评测脚本改了什么**（`run.py`，README「量结果（票 145）」一节有全文）：

- 变体就是模型：`v7`、`v7glm`、`v7ds`（`V7_MODELS`），`--variant` 与 `--model-id` 对不上就拒跑；另有第二轮措辞 `v7r2`、`v7glmr2`、`v7dsr2` 与 v6 对照 `v6glm`、`v6ds`。
- v7 的运行同主对话一样提供 `tell_user`（runner 自己的那一条），调工具那一步 `<summary>` 外的字算送到（读法同 `runner/step_text.py`）。
- 判法换成 `crit_judge_v7`：派没派、几个标签、没派时自己上没上网照记、不计分；量四样（定义见下）；计分的只有事实带出处与照不照备忘。并行套件里留着的契约照判（标题、同一个标签页或同一批文件只放一个标签）。
- 新套件 `preference/`；叫醒加 `--wake-prompt`（换掉用例写的提示词，结果放 `meta.prompt_<名>_runs`）。
- 用量：glm、ds 走 Anthropic 格式，GA 不把输出 token 交给 `_record_usage`，脚本在流交给 GA 的解析器之前读 `message_delta` 的 `output_tokens`（不改流）；`scrub` 加了本机登录名（有一遍的代码把 `USER=` 打印了出来）。

**四样量的读法**：①先说打算：不止一步（调了工具）或派出去的那些遍，用户最先看到的字（步骤里的字、`tell_user`、派活那条回复）里有没有说怎么做（`PLAN_CUE_RE`；`results.md`「最先看到的字」一节列了每遍的原文，我逐条核过：没说的里只有一遍是漏判（「默认按通用酒店设计……」，补了「默认按」），说了的里没有误判成答案的）；最先看到的是做完的答案、或停下之前一个字也没有，都算没说。②第一次见字：开跑到最先看到的字的秒数；沙盒里浏览器工具不执行、运行停在那里，停下之前没字的另记（真机上那几遍要等查完才见字，所以中位数只代表「有字的那些遍」）。③事实带出处：`cases.json` 的 `v7`（fact 16 条、direct 5 条、none 9 条，`q-followup-quick` 不计分），判法同 v5。④照不照备忘：「要快」下没派、「要细」下派出去算照了。

**每个用例各遍的记录**。格里每一遍用「·」连：做法（派 N＝最终回复里 N 个标签；自己上网；自己做；直接答；凭记忆答）、先没先说打算（只在不止一步或派出去的那些遍）、第一次见字的秒数（「停前无字 N 秒」＝停在浏览器前一个字没有，N 是停下的时刻）、出处 ✓✗（计分的用例）、照备忘 ✓✗（偏好套件）。「sol v6」是票 143 那 90 遍按 v7 的量重新读（那时没提供 `tell_user`，步骤里的字照 v7 的读法算）。

##### 派活判据（dispatch-criterion）

| 用例 | sol v6 | sol v7 | glm v7 | ds v7 | ds v6 对照 |
| --- | --- | --- | --- | --- | --- |
| q-injuries | 自己上网·先说·8.8 秒·出处✓；自己上网·没先说·停前无字 19 秒·出处✓；自己上网·没先说·停前无字 19 秒·出处✓ | 自己上网·没先说·停前无字 18.1 秒·出处✓；自己上网·没先说·停前无字 18.8 秒·出处✓；自己上网·先说·9.1 秒·出处✓ | 凭记忆答·没先说·196.5 秒·出处✗；自己上网·先说·63.8 秒·出处✓；自己上网·先说·130 秒·出处✓ | 自己上网·没先说·停前无字 14.1 秒·出处✓；自己上网·没先说·停前无字 21.9 秒·出处✓ | 凭记忆答·没先说·31.6 秒·出处✗；凭记忆答·没先说·37.9 秒·出处✗ |
| q-east | 自己上网·没先说·停前无字 19.8 秒；自己上网·先说·10.4 秒；自己上网·先说·9.3 秒 | 自己上网·没先说·停前无字 9.7 秒；自己上网·没先说·停前无字 8.8 秒；自己上网·没先说·停前无字 19.6 秒 | 自己上网·先说·38.8 秒；直接答·109 秒；直接答·57.8 秒 | 直接答·5.7 秒；直接答·9.8 秒 | 自己上网·没先说·停前无字 4.2 秒；直接答·4.8 秒 |
| q-story | 自己上网·先说·6.5 秒·出处✓；自己上网·没先说·停前无字 15.5 秒·出处✓；自己上网·先说·6.8 秒·出处✓ | 自己上网·没先说·停前无字 6.8 秒·出处✓；自己上网·没先说·停前无字 27.1 秒·出处✓；自己上网·先说·17.3 秒·出处✓ | 自己上网·没先说·停前无字 42.1 秒·出处✓；自己上网·没先说·停前无字 34 秒·出处✓ | 自己上网·先说·2.5 秒·出处✓；自己上网·先说·2.4 秒·出处✓ | 自己上网·没先说·停前无字 2.3 秒·出处✓；自己上网·没先说·停前无字 7 秒·出处✓ |
| q-weather | 自己上网·没先说·停前无字 10.1 秒·出处✓；自己上网·没先说·停前无字 7.7 秒·出处✓；自己上网·没先说·停前无字 15 秒·出处✓ | 自己上网·没先说·停前无字 15.7 秒·出处✓；自己上网·没先说·停前无字 15.8 秒·出处✓；自己上网·先说·11.3 秒·出处✓ | 自己上网·先说·26.6 秒·出处✓；自己上网·没先说·停前无字 29.2 秒·出处✓ | 自己上网·没先说·停前无字 6.5 秒·出处✓；自己上网·没先说·停前无字 4.3 秒·出处✓ | 自己上网·没先说·停前无字 7 秒·出处✓；自己上网·没先说·停前无字 4.4 秒·出处✓ |
| q-notes-apps | 派 1·先说·29.2 秒·出处✓；派 1·先说·29.4 秒·出处✓；派 1·先说·13.6 秒·出处✓ | 自己上网·没先说·停前无字 9.4 秒·出处✓；自己上网·先说·8.7 秒·出处✓；自己上网·先说·10.6 秒·出处✓ | 凭记忆答·27.1 秒·出处✗；自己上网·没先说·停前无字 35.9 秒·出处✓；凭记忆答·32.6 秒·出处✗ | 凭记忆答·8 秒·出处✗；凭记忆答·13.7 秒·出处✗ | 凭记忆答·10 秒·出处✗；凭记忆答·7.9 秒·出处✗ |
| quick-usd | 自己上网·没先说·停前无字 4.5 秒·出处✓；自己上网·没先说·停前无字 7.1 秒·出处✓；自己上网·没先说·停前无字 8.9 秒·出处✓ | 自己上网·先说·6.6 秒·出处✓；自己上网·没先说·停前无字 6.9 秒·出处✓；自己上网·没先说·停前无字 6.6 秒·出处✓ | 自己上网·没先说·停前无字 28.7 秒·出处✓；自己上网·没先说·停前无字 34.7 秒·出处✓ | 自己上网·没先说·停前无字 3.5 秒·出处✓；自己上网·没先说·停前无字 3.6 秒·出处✓ | 自己上网·没先说·停前无字 3.9 秒·出处✓；自己上网·没先说·停前无字 3.7 秒·出处✓ |
| quick-downloads | 自己做·先说·8.7 秒；自己做·先说·6.2 秒；自己做·没先说·22 秒 | 自己做·先说·6.7 秒；自己做·先说·15.6 秒；自己做·没先说·29.1 秒 | 自己做·没先说·28.3 秒；自己做·没先说·18.3 秒 | 自己做·没先说·6 秒；自己做·没先说·6.2 秒 | 自己做·没先说·4.8 秒；自己做·没先说·5.2 秒 |
| todo-note | 自己做·先说·8 秒；自己做·先说·7.4 秒；自己做·先说·7.6 秒 | 自己做·没先说·40.9 秒；自己做·先说·7.3 秒；自己做·先说·8.8 秒 | 自己做·先说·33.6 秒；自己做·先说·13.7 秒 | 自己做·没先说·停前无字 13.8 秒；自己做·没先说·17.4 秒 | 自己做·没先说·14.2 秒；自己做·没先说·停前无字 20.2 秒 |
| conv-writeup | 自己做·先说·7 秒；自己做·没先说·50.3 秒；自己做·没先说·48.5 秒 | 自己做·先说·7 秒；自己做·没先说·54.9 秒；自己做·先说·8.8 秒 | 自己做·先说·18.4 秒；自己做·先说·38.7 秒 | 自己做·没先说·17.6 秒；自己做·没先说·20.8 秒 | 自己做·没先说·25.1 秒；自己做·没先说·18.7 秒 |
| e-invoices | 派 1·先说·50.5 秒；派 1·先说·11.8 秒；派 1·先说·11.1 秒 | 自己做·先说·8 秒；派 1·先说·8.9 秒；自己做·先说·8.2 秒 | 自己做·先说·80.9 秒；自己做·先说·14.5 秒 | 自己做·先说·1.7 秒；自己做·先说·2.4 秒 | 自己做·没先说·停前无字 43.4 秒；自己做·没先说·37.9 秒 |
| e-template | 派 1·先说·39.2 秒；自己做·先说·9.7 秒；自己做·没先说·254.4 秒 | 自己做·先说·11.2 秒；自己做·先说·11.3 秒；自己做·先说·7 秒 | 自己做·先说·175.1 秒；自己做·先说·223.4 秒 | 自己做·先说·3.6 秒；自己做·没先说·128.9 秒 | 自己做·先说·71.9 秒；自己做·没先说·71.3 秒 |
| big-quotes | 自己上网·没先说·停前无字 24.4 秒·出处✓；自己上网·先说·7.5 秒·出处✓；自己上网·先说·7.6 秒·出处✓ | 自己上网·先说·11.5 秒·出处✓；自己上网·先说·10.4 秒·出处✓；自己上网·先说·9.4 秒·出处✓ | 自己上网·先说·21.1 秒·出处✓；自己上网·先说·20.7 秒·出处✓ | 自己上网·先说·2.5 秒·出处✓；自己上网·先说·2.3 秒·出处✓ | 自己上网·没先说·停前无字 4.3 秒·出处✓；自己上网·没先说·停前无字 2.5 秒·出处✓ |
| big-pdfs | 自己做·先说·47 秒；自己做·先说·7 秒；自己做·先说·8.8 秒 | 自己做·先说·9.4 秒；自己做·先说·8.9 秒；自己做·先说·7.9 秒 | 自己做·先说·13 秒；自己做·先说·9.7 秒 | 自己做·没先说·23.1 秒；自己做·没先说·32.9 秒 | 自己做·先说·1.7 秒；自己做·先说·1.8 秒 |
| big-research | 派 6·先说·8.5 秒·出处✓；派 6·先说·10.7 秒·出处✓；派 6·先说·9.5 秒·出处✓ | 派 3·先说·14.5 秒·出处✓；派 3·先说·7.8 秒·出处✓；派 3·先说·7.5 秒·出处✓ | 派 3·先说·107.1 秒·出处✓；派 3·先说·100.6 秒·出处✓ | 自己上网·没先说·停前无字 5.1 秒·出处✓；自己上网·没先说·停前无字 4.7 秒·出处✓ | 派 3·先说·23.1 秒·出处✓；派 4·先说·19.4 秒·出处✓ |
| ask-dispatch | 派 1·先说·26.3 秒·出处✓；派 1·先说·19.9 秒·出处✓；派 1·先说·21.2 秒·出处✓ | 派 1·先说·24.3 秒·出处✓；派 1·先说·22.6 秒·出处✓；派 1·先说·8.1 秒·出处✓ | 自己做·先说·37.5 秒·出处✗；派 1·先说·13.5 秒·出处✓；派 1·先说·30.7 秒·出处✓ | 派 1·先说·9.9 秒·出处✓；派 1·先说·9.8 秒·出处✓ | 派 1·先说·4.7 秒·出处✓；派 1·先说·5.4 秒·出处✓ |
| midway-invoices | 自己做·先说·7.5 秒；自己做·先说·8.1 秒；自己做·先说·7.5 秒 | 自己做·先说·7.6 秒；自己做·先说·16.3 秒；自己做·先说·8.3 秒 | 自己做·先说·19.3 秒；自己做·先说·7.6 秒 | 自己做·没先说·37.1 秒；自己做·先说·2.7 秒 | 自己做·没先说·26.1 秒；自己做·没先说·停前无字 34.2 秒 |
| q-headphones | 派 2·先说·22.8 秒·出处✓；派 2·先说·10.3 秒·出处✓；派 2·先说·9.7 秒·出处✓ | 自己上网·先说·9.2 秒·出处✓；自己上网·先说·6.2 秒·出处✓；自己上网·先说·5.5 秒·出处✓ | 自己上网·先说·18.1 秒·出处✓；自己上网·先说·41.7 秒·出处✓ | 自己上网·没先说·停前无字 6.3 秒·出处✓；自己上网·没先说·停前无字 2 秒·出处✓ | 派 2·先说·8.8 秒·出处✓；派 2·先说·12.1 秒·出处✓ |
| q-fact-injury | 自己上网·没先说·停前无字 13.5 秒·出处✓；自己上网·没先说·停前无字 13.6 秒·出处✓；自己上网·没先说·停前无字 21.5 秒·出处✓ | 自己上网·没先说·停前无字 7.7 秒·出处✓；自己上网·没先说·停前无字 14 秒·出处✓；自己上网·没先说·停前无字 13 秒·出处✓ | 自己上网·没先说·停前无字 8 秒·出处✓；自己上网·先说·11.1 秒·出处✓ | 自己上网·没先说·停前无字 2 秒·出处✓；自己上网·没先说·停前无字 1.7 秒·出处✓ | 自己上网·没先说·停前无字 1.8 秒·出处✓；自己上网·没先说·停前无字 2.4 秒·出处✓ |
| q-followup-quick | 自己上网·没先说·停前无字 7.6 秒；自己上网·没先说·停前无字 7.4 秒；自己上网·没先说·停前无字 6.2 秒 | 自己上网·没先说·停前无字 12 秒；自己上网·先说·6.7 秒；自己上网·没先说·停前无字 17.7 秒 | 自己上网·没先说·停前无字 11 秒；直接答·12.3 秒；自己上网·没先说·停前无字 9.1 秒 | 自己上网·先说·2.6 秒；自己上网·没先说·停前无字 4.8 秒 | 自己上网·没先说·停前无字 3 秒；直接答·8 秒 |
| q-followup-sourced | 自己上网·没先说·停前无字 16 秒·出处✗；自己做·没先说·34.2 秒·出处单列；自己做·没先说·29.1 秒·出处单列 | 自己上网·没先说·停前无字 22.7 秒·出处✗；自己做·没先说·33.9 秒·出处单列；自己上网·没先说·停前无字 47.6 秒·出处✗ | 直接答·14.2 秒·出处✓；直接答·15.7 秒·出处✓ | 直接答·7.5 秒·出处✓；直接答·5.1 秒·出处✓ | 直接答·5 秒·出处✓；自己上网·没先说·停前无字 19.6 秒·出处✗ |
| q-followup-shown | 自己做·没先说·26.8 秒·出处单列；直接答·14.9 秒·出处✓；自己上网·先说·13.1 秒·出处✗ | 自己做·没先说·23 秒·出处单列；自己做·没先说·25.3 秒·出处单列；自己做·没先说·35.1 秒·出处单列 | 直接答·19.4 秒·出处✓；直接答·16.7 秒·出处✓ | 自己上网·没先说·停前无字 7.1 秒·出处✗；直接答·8.5 秒·出处✓；自己做·没先说·18.8 秒·出处单列 | 直接答·6.2 秒·出处✓；自己做·没先说·9.8 秒·出处单列 |
| q-recent-fact | 自己上网·没先说·停前无字 11.1 秒·出处✓；自己上网·没先说·停前无字 9.2 秒·出处✓；自己上网·没先说·停前无字 11.2 秒·出处✓ | 自己上网·没先说·停前无字 6.3 秒·出处✓；自己上网·没先说·停前无字 8.4 秒·出处✓；自己上网·先说·4.6 秒·出处✓ | 自己上网·没先说·停前无字 8.5 秒·出处✓；自己上网·没先说·停前无字 7.5 秒·出处✓ | 自己上网·没先说·停前无字 6.2 秒·出处✓；自己上网·先说·2.4 秒·出处✓ | 自己上网·没先说·停前无字 2.1 秒·出处✓；自己上网·没先说·停前无字 1.6 秒·出处✓ |
| q-concept | 直接答·11.8 秒·出处✓；直接答·12.1 秒·出处✓；直接答·10.3 秒·出处✓ | 直接答·13.2 秒·出处✓；直接答·11.7 秒·出处✓；直接答·13 秒·出处✓ | 直接答·28 秒·出处✓；直接答·18.5 秒·出处✓ | 直接答·3.7 秒·出处✓；直接答·5.4 秒·出处✓ | 直接答·3.1 秒·出处✓；直接答·4.2 秒·出处✓ |
| q-howto | 直接答·20.2 秒·出处✓；直接答·21.2 秒·出处✓；直接答·26.6 秒·出处✓ | 直接答·31.7 秒·出处✓；直接答·26.1 秒·出处✓；直接答·26.7 秒·出处✓ | 直接答·30.3 秒·出处✓；直接答·15.7 秒·出处✓ | 自己做·没先说·14.7 秒·出处单列；自己做·没先说·10.3 秒·出处单列 | 直接答·10 秒·出处✓；直接答·7.7 秒·出处✓ |
| q-browser-insist | 自己上网·没先说·停前无字 8.3 秒；自己上网·没先说·停前无字 7.2 秒；自己上网·没先说·停前无字 3.8 秒 | 自己上网·没先说·停前无字 4.8 秒；自己上网·没先说·停前无字 4.2 秒；自己上网·没先说·停前无字 3.7 秒 | 自己上网·先说·4.3 秒；自己上网·先说·7.1 秒 | 自己上网·没先说·停前无字 1.1 秒；自己上网·没先说·停前无字 1.5 秒 | 自己上网·先说·1.5 秒；自己上网·没先说·停前无字 1.5 秒 |
| c-headphones-pair | 派 2·先说·9.4 秒·出处✓；派 2·先说·8.5 秒·出处✓；派 2·先说·14.5 秒·出处✓ | 自己上网·先说·4.9 秒·出处✓；自己上网·没先说·停前无字 11.3 秒·出处✓；自己上网·没先说·停前无字 11.2 秒·出处✓ | 自己上网·先说·57.7 秒·出处✓；自己上网·先说·34.9 秒·出处✓ | 自己上网·没先说·停前无字 4.5 秒·出处✓；自己上网·没先说·停前无字 1.9 秒·出处✓ | 自己上网·没先说·停前无字 6.8 秒·出处✓；自己上网·没先说·停前无字 5.2 秒·出处✓ |
| c-phones-three | 派 3·先说·9.2 秒·出处✓；派 3·先说·10.9 秒·出处✓；派 3·先说·10.2 秒·出处✓ | 自己上网·先说·5.5 秒·出处✓；自己上网·先说·8.5 秒·出处✓；自己上网·先说·8.8 秒·出处✓ | 自己上网·先说·23.6 秒·出处✓；自己上网·没先说·停前无字 162 秒·出处✓ | 自己上网·没先说·停前无字 2 秒·出处✓；自己上网·没先说·停前无字 2.8 秒·出处✓ | 自己上网·没先说·停前无字 4.7 秒·出处✓；派 3·先说·8.1 秒·出处✓ |
| c-research-report | 派 5·先说·11.9 秒·出处✓；派 3·先说·12.1 秒·出处✓；派 3·先说·10.4 秒·出处✓ | 派 1·先说·13.1 秒·出处✓；派 1·先说·16.2 秒·出处✓；派 1·先说·12.7 秒·出处✓ | 派 3·先说·159.3 秒·出处✓；自己上网·没先说·停前无字 68.4 秒·出处✓；派 3·先说·78.2 秒·出处✓ | 自己上网·没先说·停前无字 8.3 秒·出处✓；自己上网·先说·5.8 秒·出处✓ | 派 3·先说·36.9 秒·出处✓；自己上网·没先说·停前无字 8.5 秒·出处✓ |
| c-weather-sh | 自己上网·没先说·停前无字 6 秒·出处✓；自己上网·没先说·停前无字 8.9 秒·出处✓；自己上网·没先说·停前无字 8.1 秒·出处✓ | 自己上网·没先说·停前无字 7.5 秒·出处✓；自己上网·没先说·停前无字 16.1 秒·出处✓；自己上网·没先说·停前无字 4.4 秒·出处✓ | 自己上网·没先说·停前无字 11.6 秒·出处✓；自己上网·先说·23.3 秒·出处✓ | 自己上网·没先说·停前无字 4.8 秒·出处✓；自己上网·没先说·停前无字 7.3 秒·出处✓ | 自己上网·没先说·停前无字 3.5 秒·出处✓；自己上网·没先说·停前无字 4.6 秒·出处✓ |
| c-story-finals | 自己上网·没先说·停前无字 11.6 秒·出处✓；自己上网·先说·9.2 秒·出处✓；自己上网·没先说·停前无字 10.7 秒·出处✓ | 自己上网·先说·10.3 秒·出处✓；自己上网·先说·15.3 秒·出处✓；自己上网·没先说·停前无字 16 秒·出处✓ | 自己上网·先说·186.7 秒·出处✓；凭记忆答·62.9 秒·出处✗；自己上网·先说·57.4 秒·出处✓ | 自己上网·没先说·18.1 秒·出处✓；自己上网·没先说·停前无字 4.7 秒·出处✓ | 自己上网·没先说·停前无字 9.9 秒·出处✓；自己上网·没先说·停前无字 6.6 秒·出处✓ |

- **sol v6**：90 遍；派出去 25 遍（标签数 1、1、1、1、1、1、1、1、1、1、2、2、2、2、2、2、3、3、3、3、3、5、6、6、6）；没派、自己上网 38 遍；先说打算 47/83（不止一步或派出去的那些遍；没说 36，先问用户单列 0）；第一次见字的秒数中位 10.7、最长 254.4（61 遍；停下前没字 29 遍）；事实带出处合格 55/60（不合格 2，单列 3）；模型调用 209 次，输入 1,435,199 token（缓存 724,608），输出 94,161。
- **sol v7**：90 遍；派出去 10 遍（标签数 1、1、1、1、1、1、1、3、3、3）；没派、自己上网 50 遍；先说打算 47/84（不止一步或派出去的那些遍；没说 37，先问用户单列 0）；第一次见字的秒数中位 9.9、最长 54.9（60 遍；停下前没字 30 遍）；事实带出处合格 54/60（不合格 2，单列 4）；模型调用 215 次，输入 1,536,364 token（缓存 766,464），输出 90,809。
- **glm v7**：67 遍；派出去 6 遍（标签数 1、1、3、3、3、3）；没派、自己上网 31 遍；先说打算 36/53（不止一步或派出去的那些遍；没说 17，先问用户单列 0）；第一次见字的秒数中位 28.0、最长 223.4（53 遍；停下前没字 14 遍）；事实带出处合格 40/45（不合格 5，单列 0）；模型调用 149 次，输入 1,370,678 token（缓存 813,952），输出 176,042。
- **ds v7**：61 遍；派出去 2 遍（标签数 1、1）；没派、自己上网 33 遍；先说打算 13/52（不止一步或派出去的那些遍；没说 39，先问用户单列 0）；第一次见字的秒数中位 7.5、最长 128.9（35 遍；停下前没字 26 遍）；事实带出处合格 35/41（不合格 3，单列 3）；模型调用 161 次，输入 1,450,288 token（缓存 991,360），输出 121,502。
- **ds v6 对照**：60 遍；派出去 8 遍（标签数 1、1、2、2、3、3、3、4）；没派、自己上网 25 遍；先说打算 12/50（不止一步或派出去的那些遍；没说 38，先问用户单列 0）；第一次见字的秒数中位 8.8、最长 71.9（33 遍；停下前没字 27 遍）；事实带出处合格 34/40（不合格 5，单列 1）；模型调用 153 次，输入 1,369,901 token（缓存 925,824），输出 119,708。

##### 并行（dispatch-parallel，本票 7 条）

| 用例 | sol v6 | sol v7 | glm v7 | ds v7 |
| --- | --- | --- | --- | --- |
| p-three-errands | 派 3·先说·11.1 秒；派 3·先说·28.3 秒；派 3·先说·28.1 秒 | 派 3·先说·9 秒；派 3·先说·7.9 秒；派 3·先说·7.1 秒 | 自己做·先说·18.7 秒；自己做·先说·16.1 秒 | 自己做·先说·4.2 秒；自己做·没先说·40.4 秒 |
| p-split-one | 派 3·先说·34.1 秒；派 3·先说·7.5 秒；派 3·先说·10.1 秒 | 自己做·先说·8.4 秒；自己做·先说·7.7 秒；自己做·先说·5.7 秒 | 自己做·先说·8.6 秒；自己做·没先说·43.9 秒 | 自己做·没先说·18.3 秒；自己做·没先说·22.6 秒 |
| p-same-tab | 自己上网·先说·9.3 秒；自己上网·没先说·停前无字 14.2 秒；自己上网·没先说·停前无字 8.2 秒 | 自己上网·先说·6.3 秒；自己上网·先说·7 秒；自己上网·没先说·停前无字 14.6 秒 | 自己上网·先说·18.1 秒；自己上网·先说·11.6 秒 | 自己上网·先说·1.9 秒；自己上网·先说·1.8 秒 |
| p-same-files | 自己做·先说·7.4 秒；自己做·先说·10 秒；派 1·先说·11.1 秒 | 自己做·先说·9 秒；自己做·先说·7.9 秒；自己做·先说·7.6 秒 | 自己做·先说·23.1 秒；自己做·没先说·97.1 秒 | 自己做·没先说·33.3 秒；自己做·没先说·26.9 秒 |
| p-question-parts | 派 2·先说·20.3 秒；派 2·先说·13.2 秒；派 2·先说·13.2 秒 | 自己上网·没先说·停前无字 20.8 秒；自己上网·没先说·停前无字 12.4 秒；自己上网·没先说·停前无字 11.6 秒 | 自己上网·没先说·停前无字 13.6 秒；自己上网·先说·17.2 秒 | 自己上网·没先说·停前无字 2.4 秒；自己上网·先说·3.8 秒 |
| p-errand-and-question | 派 1·先说·43.8 秒；派 1·先说·42.4 秒；自己上网·先说·10.3 秒 | 自己上网·先说·9.5 秒；自己上网·先说·11 秒；自己上网·没先说·停前无字 55.5 秒 | 自己上网·先说·20.9 秒；自己上网·没先说·停前无字 105 秒 | 自己上网·没先说·停前无字 11.4 秒；自己上网·没先说·停前无字 4.5 秒 |
| p-errand-and-question-full | 派 2·先说·9.2 秒；派 2·先说·10 秒；派 2·先说·41.6 秒 | 自己上网·先说·9.6 秒；自己上网·先说·10.4 秒；自己上网·先说·15.3 秒 | 自己上网·先说·80.8 秒；自己上网·先说·34.2 秒 | 自己上网·没先说·停前无字 4.1 秒；自己上网·没先说·停前无字 4.6 秒 |

- **sol v6**：21 遍；派出去 15 遍（标签数 1、1、1、2、2、2、2、2、2、3、3、3、3、3、3）；没派、自己上网 4 遍；先说打算 19/21（不止一步或派出去的那些遍；没说 2，先问用户单列 0）；第一次见字的秒数中位 11.1、最长 43.8（19 遍；停下前没字 2 遍）；模型调用 62 次，输入 476,245 token（缓存 277,248），输出 27,027。
- **sol v7**：21 遍；派出去 3 遍（标签数 3、3、3）；没派、自己上网 12 遍；先说打算 16/21（不止一步或派出去的那些遍；没说 5，先问用户单列 0）；第一次见字的秒数中位 8.2、最长 15.3（16 遍；停下前没字 5 遍）；模型调用 60 次，输入 447,303 token（缓存 228,480），输出 21,391。
- **glm v7**：14 遍；派出去 0 遍；没派、自己上网 8 遍；先说打算 10/14（不止一步或派出去的那些遍；没说 4，先问用户单列 0）；第一次见字的秒数中位 19.8、最长 97.1（12 遍；停下前没字 2 遍）；模型调用 40 次，输入 316,495 token（缓存 186,880），输出 35,069。
- **ds v7**：14 遍；派出去 0 遍；没派、自己上网 8 遍；先说打算 4/14（不止一步或派出去的那些遍；没说 10，先问用户单列 0）；第一次见字的秒数中位 18.3、最长 40.4（9 遍；停下前没字 5 遍）；模型调用 47 次，输入 416,818 token（缓存 302,592），输出 25,317。

##### 偏好（preference）

| 用例 | sol v7 | sol v7 第二轮 | glm v7 | glm v7 第二轮 | ds v7 | ds v7 第二轮 |
| --- | --- | --- | --- | --- | --- | --- |
| fast-q-headphones | 自己上网·没先说·停前无字 7.2 秒·出处✓·照备忘✓；自己上网·先说·5.6 秒·出处✓·照备忘✓；自己上网·先说·4.2 秒·出处✓·照备忘✓ | — | 自己上网·先说·34.2 秒·出处✓·照备忘✓；自己上网·先说·27.5 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 2.5 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 1.6 秒·出处✓·照备忘✓ | — |
| fast-c-phones-three | 自己上网·先说·5.2 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 10.6 秒·出处✓·照备忘✓；自己上网·先说·4.9 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 27.3 秒·出处✓·照备忘✓；自己上网·先说·133.4 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 3.3 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 1.8 秒·出处✓·照备忘✓ | — |
| fast-c-research-report | 自己上网·先说·13.6 秒·出处✓·照备忘✓；自己上网·先说·8.4 秒·出处✓·照备忘✓；自己上网·先说·11.5 秒·出处✓·照备忘✓ | — | 自己上网·先说·35 秒·出处✓·照备忘✓；自己上网·先说·23.5 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 3.1 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 4.2 秒·出处✓·照备忘✓ | — |
| fast-q-east | 自己上网·先说·5 秒·照备忘✓；自己上网·没先说·停前无字 7.2 秒·照备忘✓；自己上网·没先说·停前无字 8.8 秒·照备忘✓ | — | 直接答·30.2 秒·照备忘✓；自己上网·先说·50.8 秒·照备忘✓；自己上网·没先说·停前无字 18 秒·照备忘✓ | — | 直接答·9.2 秒·照备忘✓；自己上网·没先说·停前无字 4.3 秒·照备忘✓；直接答·7.2 秒·照备忘✓ | — |
| fast-q-notes-apps | 自己上网·先说·5 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 19 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 13.7 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 38.7 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 9.6 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 7.6 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 4.6 秒·出处✓·照备忘✓ | — |
| deep-q-headphones | 自己上网·先说·4.7 秒·出处✓·照备忘✗；自己上网·先说·10.6 秒·出处✓·照备忘✗；自己上网·先说·7.1 秒·出处✓·照备忘✗ | 自己上网·先说·6.1 秒·出处✓·照备忘✗；自己上网·先说·11.3 秒·出处✓·照备忘✗；自己上网·先说·16.2 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 29.6 秒·出处✓·照备忘✗；派 2·先说·33.2 秒·出处✓·照备忘✓；派 2·先说·50.6 秒·出处✓·照备忘✓ | 自己上网·先说·22.3 秒·出处✓·照备忘✗；自己上网·先说·33.8 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 5.1 秒·出处✓·照备忘✗；自己上网·先说·4.8 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 3.5 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 4.5 秒·出处✓·照备忘✗ |
| deep-c-phones-three | 自己上网·先说·10.5 秒·出处✓·照备忘✗；自己上网·先说·14.1 秒·出处✓·照备忘✗；自己上网·先说·5 秒·出处✓·照备忘✗ | 自己上网·先说·11.2 秒·出处✓·照备忘✗；自己上网·先说·5.4 秒·出处✓·照备忘✗；自己上网·先说·5.5 秒·出处✓·照备忘✗ | 派 3·先说·57 秒·出处✓·照备忘✓；自己上网·先说·50.5 秒·出处✓·照备忘✗；派 3·先说·50.8 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 2.1 秒·出处✓·照备忘✗；自己上网·先说·3.5 秒·出处✓·照备忘✗ | 自己上网·先说·3.9 秒·出处✓·照备忘✗；自己上网·先说·3.3 秒·出处✓·照备忘✗ |
| deep-c-research-report | 派 1·先说·16.4 秒·出处✓·照备忘✓；派 3·先说·14.2 秒·出处✓·照备忘✓；派 1·先说·14 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 34.9 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 32 秒·出处✓·照备忘✗ | 派 4·先说·96.6 秒·出处✓·照备忘✓；派 3·先说·220.1 秒·出处✓·照备忘✓ | 自己上网·先说·5.8 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 10.2 秒·出处✓·照备忘✗ | 派 2·先说·46.3 秒·出处✓·照备忘✓；自己上网·先说·4.1 秒·出处✓·照备忘✗ |
| deep-q-east | 自己上网·先说·8.1 秒·照备忘✗；自己上网·先说·6.9 秒·照备忘✗；自己上网·先说·8.8 秒·照备忘✗ | 自己上网·没先说·停前无字 13.4 秒·照备忘✗；自己上网·没先说·停前无字 20.6 秒·照备忘✗；自己上网·先说·8.8 秒·照备忘✗ | 自己上网·没先说·停前无字 26.6 秒·照备忘✗；直接答·49.5 秒·照备忘✗；直接答·52.2 秒·照备忘✗ | 自己上网·先说·23.7 秒·照备忘✗；直接答·32.3 秒·照备忘✗ | 直接答·5.6 秒·照备忘✗；自己上网·先说·5 秒·照备忘✗；自己上网·先说·4.6 秒·照备忘✗ | 自己上网·没先说·停前无字 6.8 秒·照备忘✗；直接答·4.4 秒·照备忘✗ |
| deep-q-notes-apps | 自己上网·先说·9 秒·出处✓·照备忘✗；自己上网·先说·7.5 秒·出处✓·照备忘✗；自己上网·先说·11.2 秒·出处✓·照备忘✗ | 自己上网·先说·11.8 秒·出处✓·照备忘✗；自己上网·先说·10.6 秒·出处✓·照备忘✗；自己上网·先说·8.6 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 41.7 秒·出处✓·照备忘✗；自己上网·先说·36.4 秒·出处✓·照备忘✗ | 凭记忆答·49 秒·出处✗·照备忘✗；自己上网·先说·27.6 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 3.3 秒·出处✓·照备忘✗；自己上网·先说·6.1 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 9.8 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 3.9 秒·出处✓·照备忘✗ |

- **sol v7**：30 遍；派出去 3 遍（标签数 1、1、3）；没派、自己上网 27 遍；先说打算 24/30（不止一步或派出去的那些遍；没说 6，先问用户单列 0）；第一次见字的秒数中位 8.2、最长 16.4（24 遍；停下前没字 6 遍）；事实带出处合格 24/24（不合格 0，单列 0）；照备忘 18/30（没照 12，单列 0）；模型调用 62 次，输入 414,705 token（缓存 183,040），输出 15,401。
- **sol v7 第二轮**：12 遍；派出去 0 遍；没派、自己上网 12 遍；先说打算 10/12（不止一步或派出去的那些遍；没说 2，先问用户单列 0）；第一次见字的秒数中位 9.7、最长 16.2（10 遍；停下前没字 2 遍）；事实带出处合格 9/9（不合格 0，单列 0）；照备忘 0/12（没照 12，单列 0）；模型调用 23 次，输入 130,609 token（缓存 52,608），输出 3,832。
- **glm v7**：24 遍；派出去 4 遍（标签数 2、2、3、3）；没派、自己上网 17 遍；先说打算 12/21（不止一步或派出去的那些遍；没说 9，先问用户单列 0）；第一次见字的秒数中位 49.5、最长 133.4（15 遍；停下前没字 9 遍）；事实带出处合格 18/18（不合格 0，单列 0）；照备忘 15/24（没照 9，单列 0）；模型调用 38 次，输入 266,641 token（缓存 119,808），输出 51,889。
- **glm v7 第二轮**：8 遍；派出去 2 遍（标签数 3、4）；没派、自己上网 4 遍；先说打算 6/6（不止一步或派出去的那些遍；没说 0，先问用户单列 0）；第一次见字的秒数中位 33.0、最长 220.1（8 遍；停下前没字 0 遍）；事实带出处合格 5/6（不合格 1，单列 0）；照备忘 2/8（没照 6，单列 0）；模型调用 11 次，输入 88,082 token（缓存 25,664），输出 21,215。
- **ds v7**：22 遍；派出去 0 遍；没派、自己上网 19 遍；先说打算 6/19（不止一步或派出去的那些遍；没说 13，先问用户单列 0）；第一次见字的秒数中位 5.6、最长 9.2（9 遍；停下前没字 13 遍）；事实带出处合格 16/16（不合格 0，单列 0）；照备忘 11/22（没照 11，单列 0）；模型调用 23 次，输入 140,705 token（缓存 6,272），输出 13,135。
- **ds v7 第二轮**：10 遍；派出去 1 遍（标签数 2）；没派、自己上网 8 遍；先说打算 4/9（不止一步或派出去的那些遍；没说 5，先问用户单列 0）；第一次见字的秒数中位 4.1、最长 46.3（5 遍；停下前没字 5 遍）；事实带出处合格 8/8（不合格 0，单列 0）；照备忘 1/10（没照 9，单列 0）；模型调用 17 次，输入 138,885 token（缓存 68,608），输出 11,092。

**几点读法**：

- **派得少了**（照记，不计分）：sol 的派活判据从 v6 的 25/90 遍到 v7 的 10/90。对比（`q-headphones`、`c-headphones-pair`、`c-phones-three`）v6 九遍都按款拆开派，v7 九遍都自己上网查；调研报告照样派（`big-research` 3 个标签 ×3，`c-research-report` 1 个 ×3）；`q-notes-apps` v6 三遍派、v7 三遍自己查；`e-invoices` 3/3 → 1/3。并行套件 15/21 → 3/21：只剩三件互不相干的差事那条照样 3 个标签 ×3；`p-question-parts`（票 143 Open risk 1，一句问题被拆成东西部两个标签）v7 三遍都自己查；`p-split-one` 从 3 个标签变成自己做。glm 派出去 6/67、ds 2/61，并行套件两家都 0/14。
- **先说打算没跟着变**：sol v6 47/83、v7 47/84；ds v7 13/52，ds 的 v6 对照 12/50。「say in a line how you will go about it」这句在这三家身上都看不出作用。没说的多半是直接开浏览器、那一步只写了 `<summary>`（sol v7 30 遍停在浏览器前没字，天气、汇率、某人近况几乎都是这样）；ds 常把打算写在 `<summary>` 里（主对话画成进展小字，不算「看到的字」）。glm 说得最多（36/53），但慢。
- **第一次见字**：中位 sol 9.9 秒（v6 10.7）、glm 28.0、ds 7.5；最长 sol 54.9（v6 254.4，那是一遍自己写模板写到最后才回）、glm 223.4、ds 128.9。glm 是模型本身慢，单遍做模板就有 519 秒的。
- **事实带出处**（计分）：sol 54/60（v6 55/60），不合格的 2 遍都是 `q-followup-sourced`（假 CLI 里看不到子任务记录、就去上网核实，票 139 起的老问题），单列 4 遍是追问先读了子任务记录再答；glm 40/45，凭记忆答 5 遍（`q-notes-apps` 2、`q-injuries` 1、`c-story-finals` 1、`ask-dispatch` 1：用户明说「派个子任务」，它没派，凭记忆写了一份带「出处」的新闻）；ds 35/41（`q-notes-apps` 两遍凭记忆、`q-followup-shown` 一遍上网核实；单列 3），ds 的 v6 对照 34/40（`q-notes-apps`、`q-injuries` 各两遍凭记忆）。凭记忆答推荐、伤病史是这两家模型本来就有的，v6 下一样。
- **照备忘**（计分）：「要快」下三家都照了（sol 15/15、glm 11/11、ds 11/11），但这一半区分不出什么：没有备忘它们也很少派。「要细」下 sol 3/15（只有调研报告三遍派了；两款耳机、三款手机、东部预测、笔记软件都自己查，步骤里写「我会核对官方规格和独立评测……」，把「查细」读成自己仔细查）、glm 4/13（两款耳机 2/3、三款手机 2/3，报告、预测、推荐都没派）、ds 0/11。
- **第二轮措辞**：票面允许改一轮、只重跑没过的。没过的集中在「要细」，我判断卡在「worth the wait for depth」没把「多等」和子任务连起来（自己做「更快」，模型就觉得自己细查也算），所以只改出发点那半句：「worth a subtask's wait for depth」。重跑「要细」下没照的：sol 0/12（第一轮 0/12）；glm 2/8（调研报告 2/2，第一轮 0/2；对比、预测、推荐 0/6）；ds 1/10（调研报告 1/2，第一轮 0/2）。叫醒里没过的 `w-two-of-three` 也重跑了：2/3（第一轮 1/3）。在用户明说要买、最该照的那条上，glm、ds 从 0/4 到 3/4，其余没变、也没看到变坏；留下了。没在「要快」和派活判据上重跑第二轮（票面只许重跑没过的）。
- **v6 对照**：ds 的先说打算明显少，跑了 v6 对照（`v6ds`，同样提供 `tell_user`，只差条款）：先说打算 12/50 对 13/52、事实 34/40 对 35/41、派出去 8 对 2。先说得少是模型本身，条款只让它派得更少。glm 在计分的两样上不比 sol 差（事实 40/45、先说打算 36/53），只是慢，按「不差就不跑 v6」没跑（`v6glm` 备好了）。
- **叫醒**（sol，v7 第一轮，各 3 遍）：`w-merge-three` 3/3、`w-third-back` 3/3、`w-two-of-three` 1/3：另两遍那句进度（「星澜 S9 和青梧 P70 的参数已查齐；还差远岫 M5……」）只写在 `<summary>` 里，回复正文是空的。票 143 的 v6 九遍全过。第二轮措辞下 `w-two-of-three` 2/3。
- **留着的契约**：并行套件 v7 49 遍，标题都合规，同一个标签页、同一批文件没有一遍拆开。给用户看的字里讲「主对话」「主聊」「main chat」的 0 遍（命中「规则」的 4 遍都是说手册里的规矩，不是讲内部名字）。
- **glm 撞速率限制**：第一轮 glm 有两个进程同时跑时，4 遍收到 HTTP 429（运行失败），之后单独重跑（被替换的在各自 `meta.superseded_runs`）；并行套件第一遍 14 遍的输出 token 没记到（脚本当时从 GA 的 `STATS` 读，GA 对兼容服务商的补记把它清零），改从流里读之后重跑了一遍，第一遍同样留在 `meta.superseded_runs`。

**两遍分歧补到 3 遍的**：glm 派活判据 `q-injuries`、`q-east`、`q-notes-apps`、`ask-dispatch`、`q-followup-quick`、`c-research-report`、`c-story-finals`，偏好 `fast-q-east`、`deep-q-headphones`、`deep-q-east`、`deep-c-phones-three`；ds 派活判据 `q-followup-shown`，偏好 `fast-q-east`、`deep-q-east`。

**真模型调用**（本票留在结果里的运行）：sol 165 次运行、417 次模型调用（输入 3,179,483 token，缓存 1,620,480，输出 147,906）；glm 113 次、238 次（输入 2,041,896，缓存 1,146,304，输出 284,215）；ds 167 次、401 次（输入 3,516,597，缓存 2,294,656，输出 290,754）。合计 445 次运行、1,056 次调用。另有 glm 被替换的 18 次运行、53 次调用（输入 415,406，缓存 231,488，输出 11,126，其中 14 次没记到输出），与冒烟 6 次运行（核对格式与 token 记法，没留）。各套件分项：派活判据 sol 90 次 215 次调用、glm 67 次 149 次、ds 61 次 161 次、ds v6 对照 60 次 153 次；并行 sol 21 次 60 次、glm 14 次 40 次、ds 14 次 47 次；偏好 sol 30＋12 次 62＋23 次、glm 24＋8 次 38＋11 次、ds 22＋10 次 23＋17 次（＋后是第二轮）；叫醒 sol 9＋3 次 43＋14 次。

### 5. 验证

数字照抄输出：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1345 passed，0 failed，0 ignored（`exit 0`）。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- `git diff --check main`（含新文件）：无输出。
- `rustfmt --check`：`managed_prompt.rs`、`assistant_manual.rs` 干净。
- `run.py --dry-test`：1329 条 PASS、0 条 FAIL，`DRY TEST PASSED`（票 143 时 1266 条；新加的是 v7 与第二轮提示词对 Rust 源码、对 v6 的核对，偏好套件的用例与备忘，变体与模型的对应，Anthropic 格式的用量，`PLAN_CUE_RE`，`crit_judge_v7` 的 15 种合成运行，并行的契约，四次经 worker 的 v7 运行：提供了 `tell_user`、读到步骤里的字与 `tell_user` 那句、备忘在提示词与 `memo list` 里）。
- `--render-only` 重出四套 `results.md`；没动 runner、GUI，没跑那几组检查。`managed-ga/`、`runner/`、`.scratch/` 下没有 `__pycache__`。
- 新增行扫过本机用户目录、登录名、worktree 与临时目录路径、密钥格式、服务商名与接口主机：只命中一处「DeepSeek」，是 sol 在一遍的思考里猜一篇论文编号（「2410.05229 is "DeepSeek-R1"? No.」），不是服务商的配置，留着；`/private/var/folders/…` 的几处是模型思考里自己缩写的沙盒路径（`…` 是它写的），没有本机信息。
- 全角标点：自写正则（scratchpad 的 `t145-cjk-punct.py`）扫新增行（`results.*`、`composed/` 是模型原文，不扫），命中 23 处，都是英文语境：由 Rust 生成的两份 v7 提示词里的中文标签（「内核」「通用」等，原文如此）、英文句子里引的中文例子（`memo.md` 那条与它的断言、`prompt-composition.md`、本报告里照抄的那一行）、Rust 与文档英文注释里的「甲」、`run.py` 里的正则与英文注释。

### 6. 看到但没改的（Open risks）

1. **派得少了，对比留在主对话**：v7 下 sol 把对比全留在主对话自己查（v6 9/9 拆开派），报告照样派；glm、ds 几乎什么都不派（派活判据 6/67、2/61，并行 0/14）。裁决 193 真机对照里三款手机拆开派细到每颗镜头、9 个出处，主对话自己查是 3 个出处；按 v7，对比的深度回到了 193 之前。代价写了、出发点写了（「what the user will decide on or keep is worth a subtask's wait for depth」），模型还是把对比当成自己能查细的。要不要再往前推，是 JC 的判断，不是措辞能在一轮里解决的。
2. **「先说一句打算」这句没有可见作用**：sol 47/84 对 v6 的 47/83，ds 13/52 对 12/50。多数没说的是一上来就开浏览器、那一步只写 `<summary>`。真机上 `<summary>` 是进展小字（票 135），用户看得到在干什么，但不是「一句打算」；ds 尤其爱把打算写在 `<summary>` 里。
3. **「要细」的备忘多半没被照**：第二轮之后，明说要买的调研报告三家都会派（sol 3/3、glm 2/2、ds 1/2），对比、预测、推荐几乎都不派。也可能是用例与备忘的范围不对：「要拿来做决定的东西」在两款耳机、三款手机的问法里没写要买，模型未必当成「做决定」；预测与推荐更不是。票面规定「要细」下这五条派出去都算照了，我照判；按「用户的话里有没有在做决定」读，只有调研报告一条该派。
4. **第二轮措辞只在没过的用例上测过**：「worth a subtask's wait for depth」没在「要快」、派活判据、并行上重跑（票面只许重跑没过的），会不会让没有备忘的对比也派出去、或让「要快」下也派，没有数。要退回初稿只改一处（−8 字节，预算 5008 → 5000，断言一行）。
5. **沙盒在第一次浏览器调用就停**：没派的那些遍里，「先自己看一眼再派」与「整件自己做」分不开（票 143 Open risk 9 同一处）；第一次见字的秒数只有有字的那些遍，停在浏览器前没字的（sol 30、glm 14、ds 26 遍）真机上要等查完才见字，中位数偏小。
6. **叫醒里一句进度写进了 `<summary>`**：`w-two-of-three` 第一轮 3 遍里 2 遍、第二轮 1 遍，回复正文空、那句只在 `<summary>`。v6 九遍都没有这样。主对话会画出一条空回复加进展小字，用户看不到「还差远岫 M5」这句。是不是 v7 的「say in a line」让它觉得 `<summary>` 就够了，没有查清。
7. **glm 用户明说派却没派**：`ask-dispatch`（「派个子任务，把昨天 NBA 的主要新闻整理一份给我」）三遍里一遍没派，凭记忆写了一份带「出处」的新闻。条款里「when the user says otherwise, do it their way」管的是用户改口，明说派的这一条没有单独写（v6 有「When the user says to do it here or to hand it off, do that」，v7 删了）。sol、ds 三遍、两遍都派了。
8. **主对话静态规则有了自己的预算**：原来的测试要它不长于共享静态规则，现在定位段让它长 312 字节，换成单独的 `MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES`（7092）。按 Windows 比 POSIX 长 18 字节设，但 Windows 上没实测（CI 会跑）。
9. **`memo.md` 的张力**：同一份 `memo.md` 末尾仍是「how to do things (their setup, paths, what went wrong before) stays in your own memory」，与新加的「how they want things done included」字面相近。我只在例子那条里写明「事情怎么办的偏好算备忘」，末尾那句没动；评测里没有用例测「用户改口后记成备忘」这一步（偏好套件是备忘已经在了）。
10. **v6 对照只跑了 ds**：glm 没跑（不比 sol 差，且一遍要一到九分钟）。glm 凭记忆答的 5 遍是不是条款造成的，没有对照；ds 的对照里同样的两条（推荐、伤病史）v6 下也凭记忆。
11. **用例与判法是我定的**：`v7` 标注（对比、调研、推荐、新闻算 fact，`q-east` 预测算 none），`PLAN_CUE_RE` 的口径，「两遍有分歧」的定义（派没派、自己上没上网、事实与备忘的判定任一不同），请看是否同意。
12. **没动的文档**：`docs/project-status.md` 的未发版范围、主对话 PRD、devlog 都没改，留给主会话。

### 第二轮（裁决 195）

（2026-11-04，执行代理。分支 rebase 到 main `86ddd8d4`（只多了裁决 195 那一个提交），无冲突，接着在同一条分支上做。没动 GA 的 `sys_prompt`、工作台与子任务的提示词、Core 的子任务与叫醒逻辑、GUI、runner、CLI、Agent API、迁移、IM、外置。）

#### 1. 派活段的最终原文

定位段与代价那几句一字没动。代价之后，出发点那句与「先说一句打算」换掉，整段是：

```text
How to go about a thing is yours to weigh. Doing it yourself is quicker
and lighter, and the user can talk to you while you work: what they say
reaches you at your next step, and `tell_user` answers them in a line
without stopping. A subtask starts fresh with this conversation's last
turns as background, looks into one thing in depth and runs alongside any
others; each takes a few minutes, and Galley wakes you once they are all
back, for you to check and put together. Something the user will use to
decide, pass on or keep, and that takes looking into (a comparison, a
plan, a report, a survey), goes to subtasks to be done in depth: one tag
per part when it splits (a product, a place, a source each), all at once,
and you merge them when they are back. A question, a remark or a single
fact you answer yourself. Their memos on how they like things done come
first. When the user says to do it here or to hand it off, do that; when
they say otherwise, do it their way, and note it as a memo when it is how
they want such things done.
```

其后（事实与出处、`authority.md`、标签写法、一块一个标签、派活说明、不叫主对话、不等不盯、不用 `subagent.md`）照第一轮原样。与主会话给的原文一字不差，只按 76 列左右换行。

- 删掉的：「As a starting point, what the user will decide on or keep is worth a subtask's wait for depth, and a question in passing wants an answer now;」与「When something will take more than a moment, say in a line how you will go about it;」。
- 放回的：裁决 193 那句（末尾「when the last part is back you merge them into one」照主会话的原文写成「you merge them when they are back」：票 144 起同一批派出的几件等齐了一起叫醒）、「A question, a remark or a single fact you answer yourself.」、「When the user says to do it here or to hand it off, do that」。
- 用户的办那半句从「when the user says otherwise」变成「when they say otherwise」（前面刚说过 the user）。

`memo.md` 末尾那句（第一轮 Open risk 9 的张力）：

```text
What is about the user goes here, how they want you to do things for
them included (quick or in depth, here or handed off); how to do a task
itself (their setup, paths, what went wrong before) stays in your own
memory, as before.
```

（原来是「What is about the user goes here; how to do things (their setup, paths, what went wrong before) stays in your own memory, as before.」。）

#### 2. 字节预算

入口层 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：5008 → 5183，本机实测 5183（不留余量，`\r` 不计）。+175 全在派活那一段（865 → 1040）：

- 裁决 193 那句 287 与「A question, a remark or a single fact you answer yourself.」59，换掉出发点 142；
- 「When the user says to do it here or to hand it off, do that;」61 与用户的办 107，换掉先说一句打算 85 与用户的办 112；
- yours to weigh 43、自己做 189、子任务 241、备忘优先 53 不变。

主对话静态规则的 `MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES`（7092）与共享的不变（第二轮没碰静态规则）。

#### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：派活段；入口层文档注释首段补一句，末尾加第八轮一段（裁决 195；v7 的数：派出去 25/90 → 10/90、对比全自己查，glm 6/67、ds 2/61，先说一句打算总数 47/83 → 47/84，按做法拆开看其实有作用、被派活变少抵掉了（见 4），事实 55/60 → 54/60，备忘写明了的全照、留给判断的挑快的；JC 两头都要，所以产品给默认、备忘推翻；193 的溢出回来，接受）；预算常量与分项。测试 `main_chat_entry_layer_leaves_the_hand_off_to_judgment`：放回的句子 9 个单行片段在（「Something the user will use to」到「they want such things done.」）；不在的加了 `say in a line`、`how you will go about it`、`As a starting point`、`wait for depth`，原来断言「不在」的 `Something the user will use to decide`、`to be done in depth`、`merge them`、`A question, a remark or a single fact`、`When the user says to do it here or to hand it off` 移出；工作台与 IM 的提示词里没有 `Something the user will use to decide`、`to be done in depth`。测试上方说明改写。
- `core/src/assistant_manual.rs`：`manual_keeps_the_users_memos` 里 `memo.md` 末尾那句的两个片段换成新的四个；说明里补一句。
- `docs/managed-ga-runtime/galley-assistant-manual/memo.md`：上面那句。
- `docs/managed-ga-runtime/prompt-composition.md`：入口层那条（默认放回、第一轮为什么没留、v7 的数）、预算一条 5183 与分项、`memo.md` 的说明、条款台账加一行；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`：`memo.md` 的说明一句。
- 评测：`run.py`（v8 三个变体与 v6 对照的并行套件、偏好套件第三种备忘、结果文件加锁、`--dry-test` 的 v8 检查）、`dispatch-criterion/galley-prompt/main_chat.v8.txt`（新）、`preference/cases.json`（加 `handoff`）、各套件 `results.*`、`composed/`、`README.md`。

#### 4. 评测 v8

v8 由 Rust 现生成（临时测试，跑完删掉），`--dry-test` 核对：入口层与 Rust 一字不差，与 v7 第二轮（`main_chat.v7.txt`）只差派活那一段，定位段同上。三个模型同时跑，同一个结果文件由 `run.py` 加锁读写。gpt-6.1-sol（下称 sol）每条 3 遍；glm-5.3-flash（glm）、deepseek-flash（ds）各 2 遍，两遍分歧的补到 3 遍。为了每个模型都有 v6 一列，补跑了 v6 提示词：glm 的派活判据与并行、ds 的并行（ds 的派活判据第一轮已跑）；sol 的 v6 是票 143 那几遍（没提供 `tell_user`，步骤里的字照 v7 的读法算），glm、ds 的 v6 都提供了 `tell_user`。偏好套件在 v6 下没跑（它是本票新加的）。

偏好套件的「要细」换成与「要快」对称、明说派的「对比、调研这类宁可多等，派出去分头查细」（用例 `handoff-…`，照了是派出去）。v7 的「要细」（「要拿来做决定的东西宁可多等，也要查细」，`deep-…`）只在 v7 下跑过，下表 v7 一行照它列；两种备忘的话不一样，v7 与 v8 在这一栏不能直接比。

**三版并列**（派活判据一套，加并行与偏好）：

| 模型 | 版本 | 派活判据：派出去（标签数） / 自己上网 / 遍数 | 先说打算 | 第一次见字 中位 / 最长（秒；停前无字） | 事实带出处 | 并行：派出去（标签数） | 偏好：要快照了 / 要细或派出去照了 | 模型调用、输入 / 缓存 / 输出 token |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | v6 | 25（1、1、1、1、1、1、1、1、1、1、2、2、2、2、2、2、3、3、3、3、3、5、6、6、6） / 38 / 90 | 47/83 | 10.7 / 254.4（29） | 55/60 | 15/21（1、1、1、2、2、2、2、2、2、3、3、3、3、3、3） | — | 111 遍 271 次，1,911,444 / 1,001,856 / 121,188 |
| gpt-6.1-sol | v7 | 10（1、1、1、1、1、1、1、3、3、3） / 50 / 90 | 47/84 | 9.9 / 54.9（30） | 54/60 | 3/21（3、3、3） | 15/15 / 3/15（要细） | 141 遍 337 次，2,398,372 / 1,177,984 / 127,601 |
| gpt-6.1-sol | v8 | 21（1、1、1、1、1、1、2、2、2、2、2、2、2、3、3、3、3、3、3、4、4） / 37 / 90 | 31/82 | 23.7 / 247.1（35） | 56/60 | 8/21（2、2、2、2、2、3、3、3） | 15/15 / 15/15（派出去） | 141 遍 356 次，2,511,169 / 1,261,312 / 153,316 |
| glm-5.3-flash | v6 | 11（1、1、2、2、2、2、3、3、3、3、4） / 23 / 65 | 35/51 | 23.9 / 195.7（11） | 36/43 | 1/15（2） | — | 80 遍 196 次，1,702,788 / 1,007,424 / 217,051 |
| glm-5.3-flash | v7 | 6（1、1、3、3、3、3） / 31 / 67 | 36/53 | 28.0 / 223.4（14） | 40/45 | 0/14（—） | 11/11 / 4/13（要细） | 105 遍 227 次，1,953,814 / 1,120,640 / 263,000 |
| glm-5.3-flash | v8 | 11（1、1、2、2、2、3、3、3、3、3、4） / 23 / 65 | 33/52 | 24.4 / 209.9（12） | 36/44 | 0/14（—） | 11/11 / 4/13（派出去） | 103 遍 250 次，2,135,732 / 1,268,928 / 270,256 |
| deepseek-flash | v6 | 9（1、1、2、2、3、3、3、3、4） / 27 / 66 | 13/54 | 8.1 / 71.9（30） | 37/44 | 0/14（—） | — | 80 遍 211 次，1,896,726 / 1,296,256 / 151,372 |
| deepseek-flash | v7 | 2（1、1） / 33 / 61 | 13/52 | 7.5 / 128.9（26） | 35/41 | 0/14（—） | 11/11 / 0/11（要细） | 97 遍 231 次，2,007,811 / 1,300,224 / 159,954 |
| deepseek-flash | v8 | 8（1、1、2、3、3、3、5、5） / 30 / 67 | 16/56 | 8.0 / 65.5（28） | 39/46 | 0/14（—） | 10/10 / 8/15（派出去） | 106 遍 263 次，2,340,490 / 1,551,744 / 203,908 |

（「停前无字」：停在浏览器之前一个字也没有的遍数，真机上那几遍要等查完才见字，中位数只算有字的。先说打算只算不止一步或派出去的那些遍。）

**先说打算按做法拆开**（派活判据，有字的遍数/那一类的遍数）：

| 模型 | 版本 | 派出去 | 自己上网 | 自己做 |
| --- | --- | --- | --- | --- |
| gpt-6.1-sol | v6 | 25/25 | 9/38 | 13/20 |
| gpt-6.1-sol | v7 | 10/10 | 20/50 | 17/24 |
| gpt-6.1-sol | v8 | 21/21 | 2/37 | 8/24 |
| glm-5.3-flash | v6 | 11/11 | 12/23 | 12/17 |
| glm-5.3-flash | v7 | 6/6 | 17/31 | 13/16 |
| glm-5.3-flash | v8 | 11/11 | 11/23 | 11/18 |
| deepseek-flash | v6 | 9/9 | 1/27 | 3/18 |
| deepseek-flash | v7 | 2/2 | 7/33 | 4/17 |
| deepseek-flash | v8 | 8/8 | 7/30 | 1/18 |

**读法**：

- **默认回来了，sol 的派活回到 v6 的样子**：派活判据 25（v6）→ 10（v7）→ 21（v8）/90。对比三条（`q-headphones`、`c-headphones-pair`、`c-phones-three`）v8 九遍全按款拆开派（2、2、3 个标签），v7 九遍全自己查；报告照样派（`big-research` 3–4 个、`c-research-report` 2–3 个）；`q-notes-apps` 2/3 派（v6 3/3）；`e-invoices` 1/3（v6 3/3）。并行 15 → 3 → 8/21：`p-question-parts` 一句问题又拆成东西部两个标签 2/3（裁决 195 第 5 条接受的溢出），订票加天气 3/3 派 2 个。
- **几件互不相干的差事 sol 不再分头派**：`p-three-errands`（发票归档、截图整理、合同改名）v6、v7 都 3 个标签 ×3，v8 只派了 1 遍、另两遍自己一件件做；`p-split-one` 3/3 → 3/3 → 2/3。第一轮删了「When the user hands you several errands that do not depend on each other … write one tag per part」那半句条件，v7 还照样分头派，v8 加回的默认只讲成品（对比、方案、报告、盘点），差事落到「自己做」那边。
- **glm、ds 的默认作用有限**：glm 派活判据 11/65（v6）→ 6/67（v7）→ 11/65（v8），ds 9/66 → 2/61 → 8/67，都回到各自 v6 的水平。对比与报告重新拆开派（glm：三款手机 2/2、两款耳机 2/3 与 1/3、两份报告都派；ds：三款手机 2/3、扫地机报告 2/2、笔记软件报告 2/2，两款耳机仍自己查），但差事、推荐两家照旧自己做；并行套件三版几乎都不派（glm v6 1/15，其余都是 0）。用户明说「派个子任务」的 `ask-dispatch` 三家 v8 全派（glm 在 v7 下漏过 1/3）。
- **先说打算：第一轮那句其实有作用，被总数盖住了（我第一轮读错了）**：总数 47/83（v6）、47/84（v7）、31/82（v8）。按做法拆开，派出去的那些遍派活回复本来就有字（v6、v7、v8 都是全部）；自己上网的 9/38 → 20/50 → 2/37，自己做的 13/20 → 17/24 → 8/24。v7 那句让自己做的那些遍多说了打算，但 v7 派得少、有字的派活回复也少，两头抵掉，总数一样；我第一轮只看了总数，写成「没有可见作用」，裁决 195 删它用的正是这个数。v8 删了它，又没有 v6 那句「Tell the user in a sentence that it is on its way」，自己上网的那些遍几乎都是一上来就开浏览器、只写 `<summary>`（2/37），比 v6 还少。ds 拆开看没有这个规律（自己上网 1/27 → 7/33 → 7/30，自己做 3/18 → 4/17 → 1/18）；glm 见上表。
- **第一次见字**：sol 中位 10.7 → 9.9 → 23.7 秒。v8 派得多，派之前先读手册、`subtasks.md`，派活回复多在 20–40 秒才出来；自己做的那些遍又少说打算，最先看到的常是做完的答案。最长 254.4 → 54.9 → 247.1（v6、v8 的最长都是自己写模板写到最后才回）。
- **事实带出处**（计分）：sol 55/60 → 54/60 → 56/60；ds 37/44 → 35/41 → 39/46；glm 36/43 → 40/45 → 36/44。不合格的仍是那几条：sol 的 `q-followup-sourced`（假 CLI 看不到子任务记录就上网核实），glm、ds 凭记忆答推荐（`q-notes-apps`）、伤病史（`q-injuries`）。
- **照备忘**（计分）：「要快」三版都全照（v8：sol 15/15、glm 11/11、ds 10/10）。改成明说派的「派出去分头查细」以后，sol 15/15 派出去（对比按款拆、报告按品牌拆，`q-east` 三遍也都派了 1 个），ds 8/15，glm 4/13（三款手机 2/2、笔记软件 2/3；扫地机报告两遍自己写、两款耳机与东部预测都没派）。v7 那种只写「查细」的备忘，sol 只在调研报告上派。用户把怎么办写明了，模型照得好；这正是裁决 195 的前提。
- **叫醒**（sol，各 3 遍）：`w-merge-three` 3/3、`w-third-back` 3/3（三版都一样）；`w-two-of-three` v6 3/3、v7 1/3、v7 第二轮 2/3、v8 2/3。v8 下还有 1 遍把那句进度（「星澜 S9、青梧 P70 的规格已查齐，远岫 M5 还在查；齐了后合成一张对比表给你。」）只写在 `<summary>` 里，回复正文为空。v8 没有了「先说一句打算」，这一遍仍出现，所以不是那句造成的；三遍里一遍，样本小，说不准是不是 v7、v8 共同的什么（定位段、代价）带出来的。
- **留着的契约**：并行套件 v8 三家 49 遍，标题都合规，同一个标签页、同一批文件没有拆开；给用户看的字里讲「主对话」的 0 遍（命中「规则」的几遍都是说手册、授权或填表的规矩）。

**每条用例各遍的记录**（格式同第一轮第 4 节：做法·先没先说·第一次见字的秒数·出处·照备忘；sol v6 是票 143 那几遍按 v7 的量读）：

##### 派活判据（dispatch-criterion）

| 用例 | sol v6 | sol v7 | sol v8 | glm v6 | glm v7 | glm v8 | ds v6 | ds v7 | ds v8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| q-injuries | 自己上网·先说·8.8 秒·出处✓；自己上网·没先说·停前无字 19 秒·出处✓；自己上网·没先说·停前无字 19 秒·出处✓ | 自己上网·没先说·停前无字 18.1 秒·出处✓；自己上网·没先说·停前无字 18.8 秒·出处✓；自己上网·先说·9.1 秒·出处✓ | 自己上网·没先说·停前无字 27 秒·出处✓；自己上网·没先说·停前无字 23.7 秒·出处✓；自己上网·没先说·停前无字 18.7 秒·出处✓ | 凭记忆答·没先说·143.1 秒·出处✗；凭记忆答·没先说·135 秒·出处✗ | 凭记忆答·没先说·196.5 秒·出处✗；自己上网·先说·63.8 秒·出处✓；自己上网·先说·130 秒·出处✓ | 自己上网·没先说·停前无字 90.9 秒·出处✓；凭记忆答·没先说·159.3 秒·出处✗；凭记忆答·没先说·130.9 秒·出处✗ | 凭记忆答·没先说·31.6 秒·出处✗；凭记忆答·没先说·37.9 秒·出处✗ | 自己上网·没先说·停前无字 14.1 秒·出处✓；自己上网·没先说·停前无字 21.9 秒·出处✓ | 凭记忆答·24.7 秒·出处✗；自己上网·没先说·停前无字 19.6 秒·出处✓；自己上网·没先说·停前无字 25.8 秒·出处✓ |
| q-east | 自己上网·没先说·停前无字 19.8 秒；自己上网·先说·10.4 秒；自己上网·先说·9.3 秒 | 自己上网·没先说·停前无字 9.7 秒；自己上网·没先说·停前无字 8.8 秒；自己上网·没先说·停前无字 19.6 秒 | 自己上网·没先说·停前无字 17.2 秒；自己上网·没先说·停前无字 20.3 秒；自己上网·没先说·停前无字 15 秒 | 自己上网·没先说·停前无字 18.2 秒；直接答·55.7 秒；自己上网·先说·12.1 秒 | 自己上网·先说·38.8 秒；直接答·109 秒；直接答·57.8 秒 | 直接答·33.9 秒；自己上网·没先说·停前无字 30.1 秒；自己上网·没先说·停前无字 25.8 秒 | 自己上网·没先说·停前无字 4.2 秒；直接答·4.8 秒；自己上网·没先说·停前无字 5.1 秒 | 直接答·5.7 秒；直接答·9.8 秒 | 直接答·6.3 秒；自己上网·没先说·停前无字 6.8 秒；直接答·6.4 秒 |
| q-story | 自己上网·先说·6.5 秒·出处✓；自己上网·没先说·停前无字 15.5 秒·出处✓；自己上网·先说·6.8 秒·出处✓ | 自己上网·没先说·停前无字 6.8 秒·出处✓；自己上网·没先说·停前无字 27.1 秒·出处✓；自己上网·先说·17.3 秒·出处✓ | 自己上网·没先说·停前无字 20 秒·出处✓；自己上网·没先说·停前无字 9.1 秒·出处✓；自己上网·没先说·停前无字 12.5 秒·出处✓ | 自己上网·先说·28.3 秒·出处✓；自己上网·没先说·停前无字 16.1 秒·出处✓ | 自己上网·没先说·停前无字 42.1 秒·出处✓；自己上网·没先说·停前无字 34 秒·出处✓ | 自己上网·没先说·停前无字 18.3 秒·出处✓；自己上网·没先说·停前无字 46.5 秒·出处✓ | 自己上网·没先说·停前无字 2.3 秒·出处✓；自己上网·没先说·停前无字 7 秒·出处✓ | 自己上网·先说·2.5 秒·出处✓；自己上网·先说·2.4 秒·出处✓ | 自己上网·先说·2.4 秒·出处✓；自己上网·先说·4.9 秒·出处✓ |
| q-weather | 自己上网·没先说·停前无字 10.1 秒·出处✓；自己上网·没先说·停前无字 7.7 秒·出处✓；自己上网·没先说·停前无字 15 秒·出处✓ | 自己上网·没先说·停前无字 15.7 秒·出处✓；自己上网·没先说·停前无字 15.8 秒·出处✓；自己上网·先说·11.3 秒·出处✓ | 自己上网·没先说·停前无字 12.8 秒·出处✓；自己上网·没先说·停前无字 10.1 秒·出处✓；自己上网·没先说·停前无字 22.7 秒·出处✓ | 自己上网·先说·19.7 秒·出处✓；自己上网·没先说·停前无字 47.6 秒·出处✓ | 自己上网·先说·26.6 秒·出处✓；自己上网·没先说·停前无字 29.2 秒·出处✓ | 自己上网·先说·18.3 秒·出处✓；自己上网·没先说·停前无字 39.1 秒·出处✓ | 自己上网·没先说·停前无字 7 秒·出处✓；自己上网·没先说·停前无字 4.4 秒·出处✓ | 自己上网·没先说·停前无字 6.5 秒·出处✓；自己上网·没先说·停前无字 4.3 秒·出处✓ | 自己上网·先说·2.3 秒·出处✓；自己上网·没先说·停前无字 5 秒·出处✓ |
| q-notes-apps | 派 1·先说·29.2 秒·出处✓；派 1·先说·29.4 秒·出处✓；派 1·先说·13.6 秒·出处✓ | 自己上网·没先说·停前无字 9.4 秒·出处✓；自己上网·先说·8.7 秒·出处✓；自己上网·先说·10.6 秒·出处✓ | 自己上网·先说·14.1 秒·出处✓；派 1·先说·41.5 秒·出处✓；派 1·先说·33.2 秒·出处✓ | 自己上网·没先说·停前无字 36.6 秒·出处✓；凭记忆答·34.3 秒·出处✗；凭记忆答·57.2 秒·出处✗ | 凭记忆答·27.1 秒·出处✗；自己上网·没先说·停前无字 35.9 秒·出处✓；凭记忆答·32.6 秒·出处✗ | 凭记忆答·51.8 秒·出处✗；凭记忆答·51.6 秒·出处✗ | 凭记忆答·10 秒·出处✗；凭记忆答·7.9 秒·出处✗ | 凭记忆答·8 秒·出处✗；凭记忆答·13.7 秒·出处✗ | 凭记忆答·没先说·24.1 秒·出处✗；自己上网·没先说·停前无字 5.5 秒·出处✓；凭记忆答·没先说·13.9 秒·出处✗ |
| quick-usd | 自己上网·没先说·停前无字 4.5 秒·出处✓；自己上网·没先说·停前无字 7.1 秒·出处✓；自己上网·没先说·停前无字 8.9 秒·出处✓ | 自己上网·先说·6.6 秒·出处✓；自己上网·没先说·停前无字 6.9 秒·出处✓；自己上网·没先说·停前无字 6.6 秒·出处✓ | 自己上网·没先说·停前无字 14 秒·出处✓；自己上网·没先说·停前无字 9.6 秒·出处✓；自己上网·没先说·停前无字 14.6 秒·出处✓ | 自己上网·先说·10.3 秒·出处✓；自己上网·没先说·停前无字 15.5 秒·出处✓ | 自己上网·没先说·停前无字 28.7 秒·出处✓；自己上网·没先说·停前无字 34.7 秒·出处✓ | 自己上网·没先说·停前无字 8.6 秒·出处✓；自己上网·先说·5.7 秒·出处✓ | 自己上网·没先说·停前无字 3.9 秒·出处✓；自己上网·没先说·停前无字 3.7 秒·出处✓ | 自己上网·没先说·停前无字 3.5 秒·出处✓；自己上网·没先说·停前无字 3.6 秒·出处✓ | 自己上网·没先说·停前无字 4.7 秒·出处✓；自己上网·没先说·停前无字 1.7 秒·出处✓ |
| quick-downloads | 自己做·先说·8.7 秒；自己做·先说·6.2 秒；自己做·没先说·22 秒 | 自己做·先说·6.7 秒；自己做·先说·15.6 秒；自己做·没先说·29.1 秒 | 自己做·没先说·25.9 秒；自己做·没先说·27.2 秒；自己做·没先说·25.9 秒 | 自己做·没先说·14.9 秒；自己做·没先说·11.5 秒 | 自己做·没先说·28.3 秒；自己做·没先说·18.3 秒 | 自己做·没先说·13 秒；自己做·没先说·7 秒 | 自己做·没先说·4.8 秒；自己做·没先说·5.2 秒 | 自己做·没先说·6 秒；自己做·没先说·6.2 秒 | 自己做·没先说·7.1 秒；自己做·没先说·4.8 秒 |
| todo-note | 自己做·先说·8 秒；自己做·先说·7.4 秒；自己做·先说·7.6 秒 | 自己做·没先说·40.9 秒；自己做·先说·7.3 秒；自己做·先说·8.8 秒 | 自己做·没先说·29.6 秒；自己做·没先说·31.6 秒；自己做·没先说·23.7 秒 | 自己做·先说·34.4 秒；自己做·没先说·53 秒 | 自己做·先说·33.6 秒；自己做·先说·13.7 秒 | 自己做·没先说·79.2 秒；自己做·没先说·88.9 秒 | 自己做·没先说·14.2 秒；自己做·没先说·停前无字 20.2 秒 | 自己做·没先说·停前无字 13.8 秒；自己做·没先说·17.4 秒 | 自己做·没先说·停前无字 13.3 秒；自己做·没先说·12.7 秒 |
| conv-writeup | 自己做·先说·7 秒；自己做·没先说·50.3 秒；自己做·没先说·48.5 秒 | 自己做·先说·7 秒；自己做·没先说·54.9 秒；自己做·先说·8.8 秒 | 自己做·没先说·50.6 秒；自己做·没先说·48.9 秒；自己做·先说·8.1 秒 | 自己做·先说·22.7 秒；自己做·先说·17.1 秒 | 自己做·先说·18.4 秒；自己做·先说·38.7 秒 | 自己做·先说·22.9 秒；自己做·先说·21.3 秒 | 自己做·没先说·25.1 秒；自己做·没先说·18.7 秒 | 自己做·没先说·17.6 秒；自己做·没先说·20.8 秒 | 自己做·没先说·14.7 秒；自己做·没先说·12.5 秒 |
| e-invoices | 派 1·先说·50.5 秒；派 1·先说·11.8 秒；派 1·先说·11.1 秒 | 自己做·先说·8 秒；派 1·先说·8.9 秒；自己做·先说·8.2 秒 | 派 1·先说·52.1 秒；自己做·没先说·85.3 秒；自己做·先说·9.1 秒 | 自己做·先说·19.7 秒；自己做·先说·17.1 秒 | 自己做·先说·80.9 秒；自己做·先说·14.5 秒 | 自己做·先说·131.4 秒；自己做·没先说·89.7 秒 | 自己做·没先说·停前无字 43.4 秒；自己做·没先说·37.9 秒 | 自己做·先说·1.7 秒；自己做·先说·2.4 秒 | 自己做·没先说·停前无字 38.6 秒；自己做·没先说·65.5 秒 |
| e-template | 派 1·先说·39.2 秒；自己做·先说·9.7 秒；自己做·没先说·254.4 秒 | 自己做·先说·11.2 秒；自己做·先说·11.3 秒；自己做·先说·7 秒 | 自己做·先说·24.4 秒；自己做·没先说·247.1 秒；自己做·没先说·239.2 秒 | 自己做·先说·195.7 秒；自己做·先说·73 秒 | 自己做·先说·175.1 秒；自己做·先说·223.4 秒 | 自己做·先说·53.9 秒；自己做·先说·209.9 秒 | 自己做·先说·71.9 秒；自己做·没先说·71.3 秒 | 自己做·先说·3.6 秒；自己做·没先说·128.9 秒 | 自己做·没先说·停前无字 110.8 秒；自己做·没先说·停前无字 151.2 秒 |
| big-quotes | 自己上网·没先说·停前无字 24.4 秒·出处✓；自己上网·先说·7.5 秒·出处✓；自己上网·先说·7.6 秒·出处✓ | 自己上网·先说·11.5 秒·出处✓；自己上网·先说·10.4 秒·出处✓；自己上网·先说·9.4 秒·出处✓ | 自己上网·没先说·停前无字 28.8 秒·出处✓；自己上网·没先说·停前无字 18.3 秒·出处✓；自己上网·先说·7.8 秒·出处✓ | 自己上网·先说·21.1 秒·出处✓；自己上网·先说·25.8 秒·出处✓ | 自己上网·先说·21.1 秒·出处✓；自己上网·先说·20.7 秒·出处✓ | 自己上网·先说·19.7 秒·出处✓；自己上网·先说·15.6 秒·出处✓ | 自己上网·没先说·停前无字 4.3 秒·出处✓；自己上网·没先说·停前无字 2.5 秒·出处✓ | 自己上网·先说·2.5 秒·出处✓；自己上网·先说·2.3 秒·出处✓ | 自己上网·没先说·停前无字 8 秒·出处✓；自己上网·没先说·停前无字 7 秒·出处✓ |
| big-pdfs | 自己做·先说·47 秒；自己做·先说·7 秒；自己做·先说·8.8 秒 | 自己做·先说·9.4 秒；自己做·先说·8.9 秒；自己做·先说·7.9 秒 | 自己做·没先说·48.5 秒；自己做·先说·7.9 秒；自己做·先说·8.3 秒 | 自己做·先说·7.1 秒；自己做·先说·5.9 秒 | 自己做·先说·13 秒；自己做·先说·9.7 秒 | 自己做·先说·44.1 秒；自己做·先说·21.3 秒 | 自己做·先说·1.7 秒；自己做·先说·1.8 秒 | 自己做·没先说·23.1 秒；自己做·没先说·32.9 秒 | 自己做·没先说·30 秒；自己做·先说·2.5 秒 |
| big-research | 派 6·先说·8.5 秒·出处✓；派 6·先说·10.7 秒·出处✓；派 6·先说·9.5 秒·出处✓ | 派 3·先说·14.5 秒·出处✓；派 3·先说·7.8 秒·出处✓；派 3·先说·7.5 秒·出处✓ | 派 3·先说·13.6 秒·出处✓；派 4·先说·15.9 秒·出处✓；派 4·先说·13.6 秒·出处✓ | 派 2·先说·24 秒·出处✓；派 3·先说·33.3 秒·出处✓ | 派 3·先说·107.1 秒·出处✓；派 3·先说·100.6 秒·出处✓ | 派 3·先说·33.2 秒·出处✓；派 3·先说·53.3 秒·出处✓ | 派 3·先说·23.1 秒·出处✓；派 4·先说·19.4 秒·出处✓ | 自己上网·没先说·停前无字 5.1 秒·出处✓；自己上网·没先说·停前无字 4.7 秒·出处✓ | 派 3·先说·22.9 秒·出处✓；派 2·先说·17.9 秒·出处✓ |
| ask-dispatch | 派 1·先说·26.3 秒·出处✓；派 1·先说·19.9 秒·出处✓；派 1·先说·21.2 秒·出处✓ | 派 1·先说·24.3 秒·出处✓；派 1·先说·22.6 秒·出处✓；派 1·先说·8.1 秒·出处✓ | 派 1·先说·34.1 秒·出处✓；派 1·先说·24.4 秒·出处✓；派 1·先说·21 秒·出处✓ | 派 1·先说·25.8 秒·出处✓；派 1·先说·23.7 秒·出处✓ | 自己做·先说·37.5 秒·出处✗；派 1·先说·13.5 秒·出处✓；派 1·先说·30.7 秒·出处✓ | 派 1·先说·17.7 秒·出处✓；派 1·先说·9.9 秒·出处✓ | 派 1·先说·4.7 秒·出处✓；派 1·先说·5.4 秒·出处✓ | 派 1·先说·9.9 秒·出处✓；派 1·先说·9.8 秒·出处✓ | 派 1·先说·7.1 秒·出处✓；派 1·先说·8 秒·出处✓ |
| midway-invoices | 自己做·先说·7.5 秒；自己做·先说·8.1 秒；自己做·先说·7.5 秒 | 自己做·先说·7.6 秒；自己做·先说·16.3 秒；自己做·先说·8.3 秒 | 自己做·先说·7.2 秒；自己做·先说·7.1 秒；自己做·先说·7.4 秒 | 自己做·先说·39.8 秒；自己做·先说·31.8 秒 | 自己做·先说·19.3 秒；自己做·先说·7.6 秒 | 自己做·先说·13.2 秒；自己做·先说·49.5 秒 | 自己做·没先说·26.1 秒；自己做·没先说·停前无字 34.2 秒 | 自己做·没先说·37.1 秒；自己做·先说·2.7 秒 | 自己做·没先说·停前无字 31.7 秒；自己做·没先说·31 秒 |
| q-headphones | 派 2·先说·22.8 秒·出处✓；派 2·先说·10.3 秒·出处✓；派 2·先说·9.7 秒·出处✓ | 自己上网·先说·9.2 秒·出处✓；自己上网·先说·6.2 秒·出处✓；自己上网·先说·5.5 秒·出处✓ | 派 2·先说·9.5 秒·出处✓；派 2·先说·30.9 秒·出处✓；派 2·先说·32.2 秒·出处✓ | 派 2·先说·27 秒·出处✓；派 2·先说·28.3 秒·出处✓ | 自己上网·先说·18.1 秒·出处✓；自己上网·先说·41.7 秒·出处✓ | 派 2·先说·14.5 秒·出处✓；自己做·先说·26.6 秒·出处单列；派 2·先说·23.3 秒·出处✓ | 派 2·先说·8.8 秒·出处✓；派 2·先说·12.1 秒·出处✓ | 自己上网·没先说·停前无字 6.3 秒·出处✓；自己上网·没先说·停前无字 2 秒·出处✓ | 自己上网·先说·5 秒·出处✓；自己上网·没先说·停前无字 2 秒·出处✓ |
| q-fact-injury | 自己上网·没先说·停前无字 13.5 秒·出处✓；自己上网·没先说·停前无字 13.6 秒·出处✓；自己上网·没先说·停前无字 21.5 秒·出处✓ | 自己上网·没先说·停前无字 7.7 秒·出处✓；自己上网·没先说·停前无字 14 秒·出处✓；自己上网·没先说·停前无字 13 秒·出处✓ | 自己上网·没先说·停前无字 10.7 秒·出处✓；自己上网·没先说·停前无字 12.2 秒·出处✓；自己上网·没先说·停前无字 14 秒·出处✓ | 自己上网·先说·10.2 秒·出处✓；自己上网·没先说·停前无字 6.9 秒·出处✓ | 自己上网·没先说·停前无字 8 秒·出处✓；自己上网·先说·11.1 秒·出处✓ | 自己上网·先说·7.5 秒·出处✓；自己上网·没先说·停前无字 6.7 秒·出处✓ | 自己上网·没先说·停前无字 1.8 秒·出处✓；自己上网·没先说·停前无字 2.4 秒·出处✓ | 自己上网·没先说·停前无字 2 秒·出处✓；自己上网·没先说·停前无字 1.7 秒·出处✓ | 自己上网·没先说·停前无字 1.4 秒·出处✓；自己上网·没先说·停前无字 1.8 秒·出处✓ |
| q-followup-quick | 自己上网·没先说·停前无字 7.6 秒；自己上网·没先说·停前无字 7.4 秒；自己上网·没先说·停前无字 6.2 秒 | 自己上网·没先说·停前无字 12 秒；自己上网·先说·6.7 秒；自己上网·没先说·停前无字 17.7 秒 | 自己上网·没先说·停前无字 12.6 秒；自己上网·没先说·停前无字 13.6 秒；自己上网·没先说·停前无字 8 秒 | 直接答·15.9 秒；自己上网·没先说·停前无字 6.2 秒；自己上网·先说·9.2 秒 | 自己上网·没先说·停前无字 11 秒；直接答·12.3 秒；自己上网·没先说·停前无字 9.1 秒 | 自己上网·先说·8.4 秒；自己上网·先说·6.3 秒 | 自己上网·没先说·停前无字 3 秒；直接答·8 秒；自己上网·没先说·停前无字 2.6 秒 | 自己上网·先说·2.6 秒；自己上网·没先说·停前无字 4.8 秒 | 自己上网·没先说·停前无字 2.7 秒；自己上网·没先说·停前无字 2.4 秒 |
| q-followup-sourced | 自己上网·没先说·停前无字 16 秒·出处✗；自己做·没先说·34.2 秒·出处单列；自己做·没先说·29.1 秒·出处单列 | 自己上网·没先说·停前无字 22.7 秒·出处✗；自己做·没先说·33.9 秒·出处单列；自己上网·没先说·停前无字 47.6 秒·出处✗ | 自己做·没先说·32.2 秒·出处单列；直接答·14.3 秒·出处✓；自己做·没先说·31.5 秒·出处单列 | 直接答·20.5 秒·出处✓；直接答·18.5 秒·出处✓ | 直接答·14.2 秒·出处✓；直接答·15.7 秒·出处✓ | 直接答·12.2 秒·出处✓；直接答·24.4 秒·出处✓ | 直接答·5 秒·出处✓；自己上网·没先说·停前无字 19.6 秒·出处✗；直接答·4 秒·出处✓ | 直接答·7.5 秒·出处✓；直接答·5.1 秒·出处✓ | 自己上网·没先说·停前无字 9.5 秒·出处✗；直接答·4.5 秒·出处✓；自己做·没先说·10.8 秒·出处单列 |
| q-followup-shown | 自己做·没先说·26.8 秒·出处单列；直接答·14.9 秒·出处✓；自己上网·先说·13.1 秒·出处✗ | 自己做·没先说·23 秒·出处单列；自己做·没先说·25.3 秒·出处单列；自己做·没先说·35.1 秒·出处单列 | 自己做·没先说·21.8 秒·出处单列；自己做·没先说·21.6 秒·出处单列；直接答·11.2 秒·出处✓ | 直接答·26.4 秒·出处✓；直接答·16.6 秒·出处✓ | 直接答·19.4 秒·出处✓；直接答·16.7 秒·出处✓ | 直接答·13.9 秒·出处✓；直接答·29.4 秒·出处✓ | 直接答·6.2 秒·出处✓；自己做·没先说·9.8 秒·出处单列；直接答·4.4 秒·出处✓ | 自己上网·没先说·停前无字 7.1 秒·出处✗；直接答·8.5 秒·出处✓；自己做·没先说·18.8 秒·出处单列 | 直接答·7 秒·出处✓；自己做·没先说·9.2 秒·出处单列；直接答·7.1 秒·出处✓ |
| q-recent-fact | 自己上网·没先说·停前无字 11.1 秒·出处✓；自己上网·没先说·停前无字 9.2 秒·出处✓；自己上网·没先说·停前无字 11.2 秒·出处✓ | 自己上网·没先说·停前无字 6.3 秒·出处✓；自己上网·没先说·停前无字 8.4 秒·出处✓；自己上网·先说·4.6 秒·出处✓ | 自己上网·没先说·停前无字 12.7 秒·出处✓；自己上网·没先说·停前无字 8.5 秒·出处✓；自己上网·没先说·停前无字 17.3 秒·出处✓ | 自己上网·先说·5.5 秒·出处✓；自己上网·没先说·停前无字 11.5 秒·出处✓ | 自己上网·没先说·停前无字 8.5 秒·出处✓；自己上网·没先说·停前无字 7.5 秒·出处✓ | 自己上网·先说·4.1 秒·出处✓；自己上网·没先说·停前无字 16.3 秒·出处✓ | 自己上网·没先说·停前无字 2.1 秒·出处✓；自己上网·没先说·停前无字 1.6 秒·出处✓ | 自己上网·没先说·停前无字 6.2 秒·出处✓；自己上网·先说·2.4 秒·出处✓ | 自己上网·没先说·停前无字 1.9 秒·出处✓；自己上网·先说·1.5 秒·出处✓ |
| q-concept | 直接答·11.8 秒·出处✓；直接答·12.1 秒·出处✓；直接答·10.3 秒·出处✓ | 直接答·13.2 秒·出处✓；直接答·11.7 秒·出处✓；直接答·13 秒·出处✓ | 直接答·12.8 秒·出处✓；直接答·14.1 秒·出处✓；直接答·16.8 秒·出处✓ | 直接答·18.8 秒·出处✓；直接答·21.7 秒·出处✓ | 直接答·28 秒·出处✓；直接答·18.5 秒·出处✓ | 直接答·22.6 秒·出处✓；直接答·17 秒·出处✓ | 直接答·3.1 秒·出处✓；直接答·4.2 秒·出处✓ | 直接答·3.7 秒·出处✓；直接答·5.4 秒·出处✓ | 直接答·3.6 秒·出处✓；直接答·3.2 秒·出处✓ |
| q-howto | 直接答·20.2 秒·出处✓；直接答·21.2 秒·出处✓；直接答·26.6 秒·出处✓ | 直接答·31.7 秒·出处✓；直接答·26.1 秒·出处✓；直接答·26.7 秒·出处✓ | 直接答·26.3 秒·出处✓；直接答·26.4 秒·出处✓；直接答·29.2 秒·出处✓ | 直接答·17.1 秒·出处✓；直接答·23.1 秒·出处✓ | 直接答·30.3 秒·出处✓；直接答·15.7 秒·出处✓ | 直接答·22.1 秒·出处✓；直接答·21.9 秒·出处✓ | 直接答·10 秒·出处✓；直接答·7.7 秒·出处✓ | 自己做·没先说·14.7 秒·出处单列；自己做·没先说·10.3 秒·出处单列 | 直接答·7.9 秒·出处✓；直接答·6.4 秒·出处✓ |
| q-browser-insist | 自己上网·没先说·停前无字 8.3 秒；自己上网·没先说·停前无字 7.2 秒；自己上网·没先说·停前无字 3.8 秒 | 自己上网·没先说·停前无字 4.8 秒；自己上网·没先说·停前无字 4.2 秒；自己上网·没先说·停前无字 3.7 秒 | 自己上网·没先说·停前无字 3.6 秒；自己上网·没先说·停前无字 4.1 秒；自己上网·没先说·停前无字 3.6 秒 | 自己上网·没先说·停前无字 5.9 秒；自己上网·先说·3.7 秒 | 自己上网·先说·4.3 秒；自己上网·先说·7.1 秒 | 自己上网·先说·7.7 秒；自己上网·没先说·停前无字 6.1 秒 | 自己上网·先说·1.5 秒；自己上网·没先说·停前无字 1.5 秒 | 自己上网·没先说·停前无字 1.1 秒；自己上网·没先说·停前无字 1.5 秒 | 自己上网·没先说·停前无字 1.2 秒；自己上网·没先说·停前无字 1.5 秒 |
| c-headphones-pair | 派 2·先说·9.4 秒·出处✓；派 2·先说·8.5 秒·出处✓；派 2·先说·14.5 秒·出处✓ | 自己上网·先说·4.9 秒·出处✓；自己上网·没先说·停前无字 11.3 秒·出处✓；自己上网·没先说·停前无字 11.2 秒·出处✓ | 派 2·先说·31 秒·出处✓；派 2·先说·42.8 秒·出处✓；派 2·先说·12.2 秒·出处✓ | 自己上网·先说·35.4 秒·出处✓；自己做·先说·104 秒·出处单列；派 2·先说·27.7 秒·出处✓ | 自己上网·先说·57.7 秒·出处✓；自己上网·先说·34.9 秒·出处✓ | 派 2·先说·32.9 秒·出处✓；自己上网·先说·116.8 秒·出处✓；问用户·先说·36.5 秒·出处单列 | 自己上网·没先说·停前无字 6.8 秒·出处✓；自己上网·没先说·停前无字 5.2 秒·出处✓ | 自己上网·没先说·停前无字 4.5 秒·出处✓；自己上网·没先说·停前无字 1.9 秒·出处✓ | 自己上网·没先说·停前无字 5.1 秒·出处✓；自己上网·没先说·停前无字 3.9 秒·出处✓ |
| c-phones-three | 派 3·先说·9.2 秒·出处✓；派 3·先说·10.9 秒·出处✓；派 3·先说·10.2 秒·出处✓ | 自己上网·先说·5.5 秒·出处✓；自己上网·先说·8.5 秒·出处✓；自己上网·先说·8.8 秒·出处✓ | 派 3·先说·6.7 秒·出处✓；派 3·先说·12.1 秒·出处✓；派 3·先说·38.8 秒·出处✓ | 派 3·先说·9.5 秒·出处✓；派 3·先说·23.3 秒·出处✓ | 自己上网·先说·23.6 秒·出处✓；自己上网·没先说·停前无字 162 秒·出处✓ | 派 3·先说·18.5 秒·出处✓；派 3·先说·41.6 秒·出处✓ | 自己上网·没先说·停前无字 4.7 秒·出处✓；派 3·先说·8.1 秒·出处✓；派 3·先说·6.9 秒·出处✓ | 自己上网·没先说·停前无字 2 秒·出处✓；自己上网·没先说·停前无字 2.8 秒·出处✓ | 派 3·先说·16.4 秒·出处✓；自己上网·没先说·停前无字 7.1 秒·出处✓；派 3·先说·13.2 秒·出处✓ |
| c-research-report | 派 5·先说·11.9 秒·出处✓；派 3·先说·12.1 秒·出处✓；派 3·先说·10.4 秒·出处✓ | 派 1·先说·13.1 秒·出处✓；派 1·先说·16.2 秒·出处✓；派 1·先说·12.7 秒·出处✓ | 派 3·先说·14.4 秒·出处✓；派 3·先说·12.5 秒·出处✓；派 2·先说·13.3 秒·出处✓ | 派 4·先说·67.5 秒·出处✓；派 3·先说·50.1 秒·出处✓ | 派 3·先说·159.3 秒·出处✓；自己上网·没先说·停前无字 68.4 秒·出处✓；派 3·先说·78.2 秒·出处✓ | 派 4·先说·119.5 秒·出处✓；派 3·先说·200.5 秒·出处✓ | 派 3·先说·36.9 秒·出处✓；自己上网·没先说·停前无字 8.5 秒·出处✓；自己做·没先说·停前无字 34.8 秒·出处单列 | 自己上网·没先说·停前无字 8.3 秒·出处✓；自己上网·先说·5.8 秒·出处✓ | 派 5·先说·26.5 秒·出处✓；派 5·先说·29 秒·出处✓ |
| c-weather-sh | 自己上网·没先说·停前无字 6 秒·出处✓；自己上网·没先说·停前无字 8.9 秒·出处✓；自己上网·没先说·停前无字 8.1 秒·出处✓ | 自己上网·没先说·停前无字 7.5 秒·出处✓；自己上网·没先说·停前无字 16.1 秒·出处✓；自己上网·没先说·停前无字 4.4 秒·出处✓ | 自己上网·没先说·停前无字 14.1 秒·出处✓；自己上网·没先说·停前无字 4.8 秒·出处✓；自己上网·没先说·停前无字 10 秒·出处✓ | 自己上网·没先说·停前无字 24.3 秒·出处✓；自己上网·没先说·停前无字 29.9 秒·出处✓ | 自己上网·没先说·停前无字 11.6 秒·出处✓；自己上网·先说·23.3 秒·出处✓ | 自己上网·没先说·停前无字 22.6 秒·出处✓；自己上网·先说·34.5 秒·出处✓ | 自己上网·没先说·停前无字 3.5 秒·出处✓；自己上网·没先说·停前无字 4.6 秒·出处✓ | 自己上网·没先说·停前无字 4.8 秒·出处✓；自己上网·没先说·停前无字 7.3 秒·出处✓ | 自己上网·先说·2.1 秒·出处✓；自己上网·没先说·停前无字 4.5 秒·出处✓ |
| c-story-finals | 自己上网·没先说·停前无字 11.6 秒·出处✓；自己上网·先说·9.2 秒·出处✓；自己上网·没先说·停前无字 10.7 秒·出处✓ | 自己上网·先说·10.3 秒·出处✓；自己上网·先说·15.3 秒·出处✓；自己上网·没先说·停前无字 16 秒·出处✓ | 自己上网·没先说·停前无字 7.6 秒·出处✓；自己上网·没先说·停前无字 16.7 秒·出处✓；自己上网·没先说·停前无字 18.8 秒·出处✓ | 凭记忆答·82.7 秒·出处✗；自己上网·先说·62.5 秒·出处✓；凭记忆答·59 秒·出处✗ | 自己上网·先说·186.7 秒·出处✓；凭记忆答·62.9 秒·出处✗；自己上网·先说·57.4 秒·出处✓ | 自己上网·没先说·停前无字 59.7 秒·出处✓；凭记忆答·93.1 秒·出处✗；凭记忆答·127 秒·出处✗ | 自己上网·没先说·停前无字 9.9 秒·出处✓；自己上网·没先说·停前无字 6.6 秒·出处✓ | 自己上网·没先说·18.1 秒·出处✓；自己上网·没先说·停前无字 4.7 秒·出处✓ | 凭记忆答·16.6 秒·出处✗；自己上网·没先说·停前无字 3.7 秒·出处✓；自己上网·先说·12.4 秒·出处✓ |


##### 并行（dispatch-parallel，本票 7 条）

| 用例 | sol v6 | sol v7 | sol v8 | glm v6 | glm v7 | glm v8 | ds v6 | ds v7 | ds v8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| p-three-errands | 派 3·先说·11.1 秒；派 3·先说·28.3 秒；派 3·先说·28.1 秒 | 派 3·先说·9 秒；派 3·先说·7.9 秒；派 3·先说·7.1 秒 | 派 3·先说·50.8 秒；自己做·先说·7.6 秒；自己做·先说·61.3 秒 | 自己做·先说·14.2 秒；自己做·先说·10.1 秒 | 自己做·先说·18.7 秒；自己做·先说·16.1 秒 | 自己做·先说·16.2 秒；自己做·先说·11.2 秒 | 自己做·没先说·停前无字 2.3 秒；自己做·先说·2.6 秒 | 自己做·先说·4.2 秒；自己做·没先说·40.4 秒 | 自己做·没先说·34 秒；自己做·没先说·37.2 秒 |
| p-split-one | 派 3·先说·34.1 秒；派 3·先说·7.5 秒；派 3·先说·10.1 秒 | 自己做·先说·8.4 秒；自己做·先说·7.7 秒；自己做·先说·5.7 秒 | 派 3·先说·8.9 秒；自己做·没先说·64.6 秒；派 3·没先说·48.2 秒 | 自己做·先说·7 秒；自己做·先说·6.5 秒 | 自己做·先说·8.6 秒；自己做·没先说·43.9 秒 | 自己做·先说·5.9 秒；自己做·先说·7.9 秒 | 自己做·先说·1.8 秒；自己做·没先说·14.9 秒 | 自己做·没先说·18.3 秒；自己做·没先说·22.6 秒 | 自己做·没先说·21.8 秒；自己做·没先说·23 秒 |
| p-same-tab | 自己上网·先说·9.3 秒；自己上网·没先说·停前无字 14.2 秒；自己上网·没先说·停前无字 8.2 秒 | 自己上网·先说·6.3 秒；自己上网·先说·7 秒；自己上网·没先说·停前无字 14.6 秒 | 自己上网·先说·8.2 秒；自己上网·没先说·停前无字 14.6 秒；自己上网·没先说·停前无字 6.4 秒 | 自己上网·先说·13.1 秒；自己上网·先说·8.4 秒 | 自己上网·先说·18.1 秒；自己上网·先说·11.6 秒 | 自己上网·没先说·停前无字 5.4 秒；自己上网·没先说·停前无字 12.6 秒 | 自己上网·没先说·停前无字 1.7 秒；自己上网·没先说·停前无字 2.7 秒 | 自己上网·先说·1.9 秒；自己上网·先说·1.8 秒 | 自己上网·没先说·停前无字 1.8 秒；自己上网·先说·2.3 秒 |
| p-same-files | 自己做·先说·7.4 秒；自己做·先说·10 秒；派 1·先说·11.1 秒 | 自己做·先说·9 秒；自己做·先说·7.9 秒；自己做·先说·7.6 秒 | 自己做·先说·9.4 秒；自己做·先说·8.4 秒；自己做·先说·7.9 秒 | 自己做·没先说·78.4 秒；自己做·没先说·135 秒 | 自己做·先说·23.1 秒；自己做·没先说·97.1 秒 | 自己做·先说·8.9 秒；自己做·先说·15.1 秒 | 自己做·没先说·停前无字 48.8 秒；自己做·没先说·36.8 秒 | 自己做·没先说·33.3 秒；自己做·没先说·26.9 秒 | 自己做·没先说·25.3 秒；自己做·没先说·34.5 秒 |
| p-question-parts | 派 2·先说·20.3 秒；派 2·先说·13.2 秒；派 2·先说·13.2 秒 | 自己上网·没先说·停前无字 20.8 秒；自己上网·没先说·停前无字 12.4 秒；自己上网·没先说·停前无字 11.6 秒 | 自己上网·先说·14.4 秒；派 2·先说·18.6 秒；派 2·先说·34.1 秒 | 自己上网·先说·20.4 秒；派 2·先说·34.3 秒；自己上网·没先说·停前无字 16.3 秒 | 自己上网·没先说·停前无字 13.6 秒；自己上网·先说·17.2 秒 | 自己上网·先说·23.3 秒；自己上网·没先说·停前无字 22.9 秒 | 自己上网·没先说·停前无字 2 秒；自己上网·没先说·停前无字 3 秒 | 自己上网·没先说·停前无字 2.4 秒；自己上网·先说·3.8 秒 | 自己上网·没先说·停前无字 4 秒；自己上网·先说·2.7 秒 |
| p-errand-and-question | 派 1·先说·43.8 秒；派 1·先说·42.4 秒；自己上网·先说·10.3 秒 | 自己上网·先说·9.5 秒；自己上网·先说·11 秒；自己上网·没先说·停前无字 55.5 秒 | 自己上网·没先说·停前无字 33.2 秒；自己上网·没先说·停前无字 23.4 秒；自己上网·没先说·停前无字 23.3 秒 | 自己上网·先说·79.8 秒；自己上网·先说·54.8 秒 | 自己上网·先说·20.9 秒；自己上网·没先说·停前无字 105 秒 | 自己上网·没先说·停前无字 76.2 秒；自己上网·先说·39.8 秒 | 自己上网·没先说·停前无字 8.4 秒；自己上网·没先说·停前无字 6.3 秒 | 自己上网·没先说·停前无字 11.4 秒；自己上网·没先说·停前无字 4.5 秒 | 自己上网·没先说·停前无字 11.3 秒；自己上网·没先说·停前无字 10.7 秒 |
| p-errand-and-question-full | 派 2·先说·9.2 秒；派 2·先说·10 秒；派 2·先说·41.6 秒 | 自己上网·先说·9.6 秒；自己上网·先说·10.4 秒；自己上网·先说·15.3 秒 | 派 2·先说·65.3 秒；派 2·先说·73 秒；派 2·先说·10.5 秒 | 自己上网·先说·33.2 秒；自己上网·先说·17.5 秒 | 自己上网·先说·80.8 秒；自己上网·先说·34.2 秒 | 自己上网·先说·78.7 秒；自己上网·没先说·停前无字 25.9 秒 | 自己上网·没先说·停前无字 6.6 秒；自己上网·没先说·停前无字 5.4 秒 | 自己上网·没先说·停前无字 4.1 秒；自己上网·没先说·停前无字 4.6 秒 | 自己上网·没先说·停前无字 9.2 秒；自己上网·没先说·停前无字 7.5 秒 |


##### 偏好（preference）

| 用例 | sol v7 | sol v7 第二轮 | sol v8 | glm v7 | glm v7 第二轮 | glm v8 | ds v7 | ds v7 第二轮 | ds v8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fast-q-headphones | 自己上网·没先说·停前无字 7.2 秒·出处✓·照备忘✓；自己上网·先说·5.6 秒·出处✓·照备忘✓；自己上网·先说·4.2 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 16.3 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 16.2 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 12.4 秒·出处✓·照备忘✓ | 自己上网·先说·34.2 秒·出处✓·照备忘✓；自己上网·先说·27.5 秒·出处✓·照备忘✓ | — | 自己上网·先说·15 秒·出处✓·照备忘✓；自己上网·先说·17.1 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 2.5 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 1.6 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 2.8 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 5.1 秒·出处✓·照备忘✓ |
| fast-c-phones-three | 自己上网·先说·5.2 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 10.6 秒·出处✓·照备忘✓；自己上网·先说·4.9 秒·出处✓·照备忘✓ | — | 自己上网·先说·4.8 秒·出处✓·照备忘✓；自己上网·先说·4.9 秒·出处✓·照备忘✓；自己上网·先说·9.9 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 27.3 秒·出处✓·照备忘✓；自己上网·先说·133.4 秒·出处✓·照备忘✓ | — | 自己上网·先说·22.9 秒·出处✓·照备忘✓；自己上网·先说·39.9 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 3.3 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 1.8 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 3.8 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 2.5 秒·出处✓·照备忘✓ |
| fast-c-research-report | 自己上网·先说·13.6 秒·出处✓·照备忘✓；自己上网·先说·8.4 秒·出处✓·照备忘✓；自己上网·先说·11.5 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 15.7 秒·出处✓·照备忘✓；自己上网·先说·11.4 秒·出处✓·照备忘✓；自己上网·先说·10.7 秒·出处✓·照备忘✓ | 自己上网·先说·35 秒·出处✓·照备忘✓；自己上网·先说·23.5 秒·出处✓·照备忘✓ | — | 自己上网·先说·46.2 秒·出处✓·照备忘✓；自己上网·先说·26.1 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 3.1 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 4.2 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 2.3 秒·出处✓·照备忘✓；自己上网·先说·2.9 秒·出处✓·照备忘✓ |
| fast-q-east | 自己上网·先说·5 秒·照备忘✓；自己上网·没先说·停前无字 7.2 秒·照备忘✓；自己上网·没先说·停前无字 8.8 秒·照备忘✓ | — | 自己上网·没先说·停前无字 14.3 秒·照备忘✓；自己上网·没先说·停前无字 8.5 秒·照备忘✓；自己上网·没先说·停前无字 9.7 秒·照备忘✓ | 直接答·30.2 秒·照备忘✓；自己上网·先说·50.8 秒·照备忘✓；自己上网·没先说·停前无字 18 秒·照备忘✓ | — | 直接答·33.3 秒·照备忘✓；直接答·80.8 秒·照备忘✓ | 直接答·9.2 秒·照备忘✓；自己上网·没先说·停前无字 4.3 秒·照备忘✓；直接答·7.2 秒·照备忘✓ | — | 直接答·8.9 秒·照备忘✓；直接答·6.7 秒·照备忘✓ |
| fast-q-notes-apps | 自己上网·先说·5 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 19 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 13.7 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 16.2 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 14.6 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 19.8 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 38.7 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 9.6 秒·出处✓·照备忘✓ | — | 凭记忆答·15.2 秒·出处✗·照备忘✓；自己上网·没先说·停前无字 32.9 秒·出处✓·照备忘✓；自己上网·先说·10.1 秒·出处✓·照备忘✓ | 自己上网·没先说·停前无字 7.6 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 4.6 秒·出处✓·照备忘✓ | — | 自己上网·没先说·停前无字 4.4 秒·出处✓·照备忘✓；自己上网·没先说·停前无字 3.6 秒·出处✓·照备忘✓ |
| deep-q-headphones | 自己上网·先说·4.7 秒·出处✓·照备忘✗；自己上网·先说·10.6 秒·出处✓·照备忘✗；自己上网·先说·7.1 秒·出处✓·照备忘✗ | 自己上网·先说·6.1 秒·出处✓·照备忘✗；自己上网·先说·11.3 秒·出处✓·照备忘✗；自己上网·先说·16.2 秒·出处✓·照备忘✗ | — | 自己上网·没先说·停前无字 29.6 秒·出处✓·照备忘✗；派 2·先说·33.2 秒·出处✓·照备忘✓；派 2·先说·50.6 秒·出处✓·照备忘✓ | 自己上网·先说·22.3 秒·出处✓·照备忘✗；自己上网·先说·33.8 秒·出处✓·照备忘✗ | — | 自己上网·没先说·停前无字 5.1 秒·出处✓·照备忘✗；自己上网·先说·4.8 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 3.5 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 4.5 秒·出处✓·照备忘✗ | — |
| deep-c-phones-three | 自己上网·先说·10.5 秒·出处✓·照备忘✗；自己上网·先说·14.1 秒·出处✓·照备忘✗；自己上网·先说·5 秒·出处✓·照备忘✗ | 自己上网·先说·11.2 秒·出处✓·照备忘✗；自己上网·先说·5.4 秒·出处✓·照备忘✗；自己上网·先说·5.5 秒·出处✓·照备忘✗ | — | 派 3·先说·57 秒·出处✓·照备忘✓；自己上网·先说·50.5 秒·出处✓·照备忘✗；派 3·先说·50.8 秒·出处✓·照备忘✓ | — | — | 自己上网·没先说·停前无字 2.1 秒·出处✓·照备忘✗；自己上网·先说·3.5 秒·出处✓·照备忘✗ | 自己上网·先说·3.9 秒·出处✓·照备忘✗；自己上网·先说·3.3 秒·出处✓·照备忘✗ | — |
| deep-c-research-report | 派 1·先说·16.4 秒·出处✓·照备忘✓；派 3·先说·14.2 秒·出处✓·照备忘✓；派 1·先说·14 秒·出处✓·照备忘✓ | — | — | 自己上网·没先说·停前无字 34.9 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 32 秒·出处✓·照备忘✗ | 派 4·先说·96.6 秒·出处✓·照备忘✓；派 3·先说·220.1 秒·出处✓·照备忘✓ | — | 自己上网·先说·5.8 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 10.2 秒·出处✓·照备忘✗ | 派 2·先说·46.3 秒·出处✓·照备忘✓；自己上网·先说·4.1 秒·出处✓·照备忘✗ | — |
| deep-q-east | 自己上网·先说·8.1 秒·照备忘✗；自己上网·先说·6.9 秒·照备忘✗；自己上网·先说·8.8 秒·照备忘✗ | 自己上网·没先说·停前无字 13.4 秒·照备忘✗；自己上网·没先说·停前无字 20.6 秒·照备忘✗；自己上网·先说·8.8 秒·照备忘✗ | — | 自己上网·没先说·停前无字 26.6 秒·照备忘✗；直接答·49.5 秒·照备忘✗；直接答·52.2 秒·照备忘✗ | 自己上网·先说·23.7 秒·照备忘✗；直接答·32.3 秒·照备忘✗ | — | 直接答·5.6 秒·照备忘✗；自己上网·先说·5 秒·照备忘✗；自己上网·先说·4.6 秒·照备忘✗ | 自己上网·没先说·停前无字 6.8 秒·照备忘✗；直接答·4.4 秒·照备忘✗ | — |
| deep-q-notes-apps | 自己上网·先说·9 秒·出处✓·照备忘✗；自己上网·先说·7.5 秒·出处✓·照备忘✗；自己上网·先说·11.2 秒·出处✓·照备忘✗ | 自己上网·先说·11.8 秒·出处✓·照备忘✗；自己上网·先说·10.6 秒·出处✓·照备忘✗；自己上网·先说·8.6 秒·出处✓·照备忘✗ | — | 自己上网·没先说·停前无字 41.7 秒·出处✓·照备忘✗；自己上网·先说·36.4 秒·出处✓·照备忘✗ | 凭记忆答·49 秒·出处✗·照备忘✗；自己上网·先说·27.6 秒·出处✓·照备忘✗ | — | 自己上网·没先说·停前无字 3.3 秒·出处✓·照备忘✗；自己上网·先说·6.1 秒·出处✓·照备忘✗ | 自己上网·没先说·停前无字 9.8 秒·出处✓·照备忘✗；自己上网·没先说·停前无字 3.9 秒·出处✓·照备忘✗ | — |
| handoff-q-headphones | — | — | 派 2·先说·9.6 秒·出处✓·照备忘✓；派 2·先说·9.5 秒·出处✓·照备忘✓；派 2·先说·29.1 秒·出处✓·照备忘✓ | — | — | 自己上网·先说·101.7 秒·出处单列·照备忘✗；问用户·先说·13.4 秒·出处单列·照备忘单列；自己上网·先说·13.9 秒·出处✓·照备忘✗ | — | — | 自己上网·先说·4.8 秒·出处✓·照备忘✗；派 2·先说·14.3 秒·出处✓·照备忘✓；派 2·先说·8.7 秒·出处✓·照备忘✓ |
| handoff-c-phones-three | — | — | 派 3·先说·9 秒·出处✓·照备忘✓；派 3·先说·8.7 秒·出处✓·照备忘✓；派 3·先说·35.7 秒·出处✓·照备忘✓ | — | — | 派 3·先说·22.6 秒·出处✓·照备忘✓；派 3·先说·19 秒·出处✓·照备忘✓ | — | — | 自己上网·没先说·停前无字 9.3 秒·出处✓·照备忘✗；派 3·先说·15 秒·出处✓·照备忘✓；派 3·先说·7.5 秒·出处✓·照备忘✓ |
| handoff-c-research-report | — | — | 派 3·先说·12.2 秒·出处✓·照备忘✓；派 5·先说·13 秒·出处✓·照备忘✓；派 5·先说·14.7 秒·出处✓·照备忘✓ | — | — | 自己做·先说·74.5 秒·出处单列·照备忘✗；自己做·没先说·停前无字 199.8 秒·出处单列·照备忘✗ | — | — | 自己做·没先说·停前无字 16.8 秒·出处单列·照备忘✗；派 4·先说·37.2 秒·出处✓·照备忘✓；派 1·先说·39.5 秒·出处✓·照备忘✓ |
| handoff-q-east | — | — | 派 1·先说·29.8 秒·照备忘✓；派 1·先说·20.4 秒·照备忘✓；派 1·先说·16.3 秒·照备忘✓ | — | — | 自己上网·先说·28.9 秒·照备忘✗；直接答·38.7 秒·照备忘✗；直接答·39.3 秒·照备忘✗ | — | — | 直接答·8.7 秒·照备忘✗；自己上网·没先说·停前无字 5.2 秒·照备忘✗；直接答·3.6 秒·照备忘✗ |
| handoff-q-notes-apps | — | — | 派 2·先说·17 秒·出处✓·照备忘✓；派 4·先说·12.2 秒·出处✓·照备忘✓；派 2·先说·10.6 秒·出处✓·照备忘✓ | — | — | 派 2·先说·51.3 秒·出处✓·照备忘✓；凭记忆答·35.2 秒·出处✗·照备忘✗；派 4·先说·65.9 秒·出处✓·照备忘✓ | — | — | 派 3·先说·16.3 秒·出处✓·照备忘✓；凭记忆答·9.3 秒·出处✗·照备忘✗；派 2·先说·15.5 秒·出处✓·照备忘✓ |


**真模型调用**（本轮，留在结果里的）：sol 150 次运行、399 次模型调用（输入 3,034,326 token，缓存 1,600,512，输出 166,592）；glm 183 次、446 次（输入 3,838,520，缓存 2,276,352，输出 487,307）；ds 126 次、321 次（输入 2,867,315，缓存 1,922,176，输出 235,572）。合计 459 次运行、1,166 次调用。分项：sol 派活判据 90 次 220 次调用、并行 21 次 70 次、偏好 30 次 66 次、叫醒 9 次 43 次；glm 派活判据 130 次 314 次（v8 65、v6 65）、并行 29 次 90 次（v8 14、v6 15）、偏好 24 次 42 次；ds 派活判据 73 次 177 次（v8 67、v6 补第 3 遍的 6）、并行 28 次 102 次（v8 14、v6 14）、偏好 25 次 42 次。没有运行失败或撞速率限制（glm 单独一条线、5 个并发）。

#### 5. 验证

数字照抄输出：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1345 passed，0 failed，0 ignored（`exit 0`）。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- `git diff --check main`（含新文件）：无输出。
- `rustfmt --check`：`managed_prompt.rs`、`assistant_manual.rs` 干净。
- `run.py --dry-test`：1342 条 PASS、0 条 FAIL，`DRY TEST PASSED`（第一轮 1329 条；新加的是 v8 对 Rust 源码与对 v7 的核对、偏好套件第三种备忘、一次 v8 经 worker 的运行）。
- 新增行扫过本机用户目录、登录名、worktree 与临时目录路径、密钥格式、服务商名与接口主机：本机登录名 0 处；`/Users/…` 的都是模型在自己的探查代码里随手写的路径（`/Users/Shared`、编出来的用户名），不是本机的；「DeepSeek」只命中第一轮那一处（sol 思考里猜论文编号，`results.json` 重写后又出现在 diff 里）。没有 worktree 路径、密钥或接口主机。`managed-ga/`、`runner/`、`.scratch/` 下没有 `__pycache__`。
- 全角标点：`t145-cjk-punct.py` 扫本轮新增行，整条分支新增行命中 29 处，都是英文语境：由 Rust 生成的提示词里的中文标签、`run.py` 的正则与英文注释、Rust 与文档英文注释里的「甲」、英文句子里引的中文例子、本报告里照抄的两句以分号结尾的英文原文。

#### 6. 看到但没改的（Open risks）

1. **删掉「先说一句打算」有代价，第一轮的数被总数盖住了**：gpt-6.1-sol 自己上网的那些遍先说打算 9/38（v6）→ 20/50（v7）→ 2/37（v8），自己做的 13/20 → 17/24 → 8/24；派出去的那些遍派活回复本来就有字。第一轮我只看了总数（47/83 对 47/84），写成「没有可见作用」，裁决 195 删它用的就是这个读法，是我读错了。v8 下 sol 自己查的时候几乎一上来就开浏览器、打算只在 `<summary>` 里，比 v6 还少（v6 有「Tell the user in a sentence that it is on its way」，只管派出去的那些遍）；第一次见字的中位也从 9.9 秒到 23.7 秒。要不要把那句（或只对自己做的情形）放回来，是 JC 的判断；我没改，照主会话给的原文。glm 拆开看也是 v7 最高（自己做 13/16 对 v6 12/17、v8 11/18），ds 看不出规律。
2. **几件互不相干的差事不再分头派**：`p-three-errands` gpt-6.1-sol v6、v7 都 3 个标签 ×3，v8 只 1/3，另两遍自己一件件做；`p-split-one` 3/3 → 3/3 → 2/3。第一轮删了「When the user hands you several errands that do not depend on each other … write one tag per part」那半句条件，v8 加回的默认只讲成品（对比、方案、报告、盘点），差事不在里面。真机上三件差事会在主对话里排着做。
3. **裁决 193 的溢出回来了**（裁决 195 第 5 条接受）：`p-question-parts`（新赛季东西部各哪几队进季后赛）2/3 又拆成两个标签；`q-notes-apps` 2/3 派；`e-invoices` 1/3 派。
4. **glm、deepseek 上默认与备忘的作用有限**：「派出去分头查细」下 glm 4/13、ds 8/15 照了（sol 15/15）；并行套件三版两家几乎都不派；凭记忆答推荐与伤病史两家三版都有。
5. **叫醒里一句进度只写进 `<summary>`**：`w-two-of-three` v8 下 3 遍里还有 1 遍（v6 0/3、v7 2/3、v7 第二轮 1/3）。v8 没有「先说一句打算」仍出现，所以不是那句造成的，原因没查清；主对话会画一条空回复加进展小字。
6. **偏好套件 v7 与 v8 的「要细」不是同一句话**：v7 是「要拿来做决定的东西宁可多等，也要查细」，v8 是「对比、调研这类宁可多等，派出去分头查细」，这一栏两版不能直接比；v8 没在旧备忘下跑，v7 也没在新备忘下跑。
7. **v6 一列条件不完全一样**：sol 的 v6 是票 143 那几遍，没提供 `tell_user`；glm、ds 的 v6 是本票补跑的，提供了 `tell_user`。偏好套件没有 v6。
8. **沙盒在第一次浏览器调用就停**（同第一轮）：「先看一眼再派」与「整件自己做」分不开；第一次见字的中位只算有字的那些遍，停前无字的 sol v8 35 遍、glm 12 遍、ds 28 遍。
9. **`memo.md` 的张力解了，但没有用例测**：用户改口后「记成备忘」那一步，三轮评测都没有用例（偏好套件是备忘已经在了）。
10. **评测脚本加了锁**：`run.py` 在系统临时目录放 `entry-layer-eval-<套件>-results.lock` 一类的锁文件，进程退出就释放，不进仓库。
11. **没动的文档**：`docs/project-status.md`、主对话 PRD、devlog，留给主会话。

### 第三轮（裁决 196）

（2026-11-04，执行代理。分支 rebase 到 main `6291cf02`（只多了裁决 196 那一个提交），无冲突。没动入口层这两句以外的条款、静态规则、手册、GUI、runner、CLI、Agent API、迁移、IM、外置。）

#### 1. 派活段的最终原文

```text
How to go about a thing is yours to weigh. Doing it yourself is quicker
and lighter, and the user can talk to you while you work: what they say
reaches you at your next step, and `tell_user` answers them in a line
without stopping. A subtask starts fresh with this conversation's last
turns as background, looks into one thing in depth and runs alongside any
others; each takes a few minutes, and Galley wakes you once they are all
back, for you to check and put together. Something the user will use to
decide, pass on or keep, and that takes looking into (a comparison, a
plan, a report, a survey), goes to subtasks to be done in depth: one tag
per part when it splits (a product, a place, a source each), all at once,
and you merge them when they are back. A question, a remark or a single
fact you answer yourself. When you do it yourself and it will take more
than a moment, say in a line how you will go about it before you start.
Their memos on how they like things done come first. When the user says
to do it here or to hand it off, do that; when they say otherwise, do it
their way, and note it as a memo when it is how they want such things
done.
A fact in the world (a person, an event, a game, the news, a figure, a
price, how someone is doing lately): look it up before you answer,
yourself or by a subtask, and give your sources. An idea, a reason, how
to do something, your view, or what this conversation already answers
(what a subtask brought back included): answer it directly, without
looking it up again.
To change things on the user's computer or accounts, go by the three
levels of authority in `authority.md`.
To hand something off, end your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
Write one tag per part, in the same reply, and they run at the same time;
when the user hands you several errands that do not depend on each other,
send them all out at once, one tag each. Keep in one tag the parts that
need the same browser tab or the same files.
Galley starts each after this reply, with this conversation's last turns
as background, so write the goal, what you have found so far, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path).
Do not call this chat the main chat. Galley wakes you when they finish,
ask something or fail, so do not wait on them or watch them.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.
```

放回的两句，原文：

- 打算句（裁决 196 第 3 条，只管自己做的），接在「A question, a remark or a single fact you answer yourself.」之后：「When you do it yourself and it will take more than a moment, say in a line how you will go about it before you start.」与主会话给的意思一字不差，没改措辞。
- 差事并行（裁决 174 的意思放回），接在「Write one tag per part, in the same reply, and they run at the same time;」之后：「when the user hands you several errands that do not depend on each other, send them all out at once, one tag each.」原来那半句「keep in one tag the parts that need the same browser tab or the same files」照留，因为前面句号断开，改成大写开头的「Keep in one tag …」一句，字没动。

#### 2. 字节预算

入口层 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`：5183 → 5416，本机实测 5416（不留余量，`\r` 不计）。+233：打算句 118；差事并行 115（标签那一段 150 → 265）。静态规则的两个预算不变。

#### 3. 改了哪些文件、哪些断言

- `core/src/managed_prompt.rs`：两句；入口层文档注释末尾加第九轮一段（裁决 196；自己上网先说打算 9/38 → 20/50 → 2/37，第一次见字中位 10.7 → 9.9 → 23.7 秒；裁决 195 只看了总数 47/83 对 47/84；三件差事 3/3 → 1/3，裁决 174 那句是第一轮连带删掉的）；预算常量与分项。测试 `main_chat_entry_layer_leaves_the_hand_off_to_judgment`：打算句的两个单行片段（「fact you answer yourself. When you do it yourself and it will take more」「than a moment, say in a line how you will go about it before you start.」）与其后重新换行的三个片段；差事并行的三个片段（「when the user hands you several errands that do not depend on each other,」「send them all out at once, one tag each. Keep in one tag the parts that」「need the same browser tab or the same files.」），替换原来那一行「keep in one tag the parts that need the same browser tab or the same files.」；「不在」的清单去掉 `say in a line`、`how you will go about it`、`When the user hands you several errands`；工作台与 IM 的提示词里没有 `say in a line how you will go about it`、`several errands that do not depend on each other`。测试上方说明补第三轮一句。
- `docs/managed-ga-runtime/prompt-composition.md`：入口层那条（打算句与理由的数、差事并行回来）、预算一条 5416 与分项、条款台账加一行。
- 评测：`run.py`（`v9`、`v9glm`、`v9ds`；`--dry-test` 的 Rust 核对移到 v9，另核 v9 与 v8 只差这两句）、`dispatch-criterion/galley-prompt/main_chat.v9.txt`（新）、两套 `results.*`、`composed/`、`README.md`。

#### 4. 评测 v9

v9 由 Rust 现生成（临时测试，跑完删掉），`--dry-test` 核对：入口层与 Rust 一字不差，与 v8 只差这两句（打算句接在「A question, a remark or a single fact you answer yourself.」之后，差事并行接在「they run at the same time;」之后，其余一字不差）。只重跑这两句碰到的：gpt-6.1-sol（下称 sol）的派活判据与并行各 3 遍，glm-5.3-flash（glm）、deepseek-flash（ds）的并行各 2 遍，分歧的补第 3 遍（glm 的 `p-three-errands`）。v8 一列是第二轮那几遍。

| 模型·套件·版本 | 派出去 | 先说打算（合计） | 派出去的那些遍 | 自己上网 | 自己做 | 第一次见字 中位 / 最长（秒；停前无字） | 事实带出处 | 对比与报告各遍的标签数 | p-three-errands 各遍标签数 | 模型调用、输入 / 缓存 / 输出 token |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol 派活判据 v8 | 21/90 | 31/82 | 21/21 | 2/37 | 8/24 | 23.7 / 247.1（35） | 56/60 | q-headphones 2、2、2；c-headphones-pair 2、2、2；c-phones-three 3、3、3；big-research 3、4、4；c-research-report 3、3、2 | — | 90 遍 220 次，1,526,266 / 755,200 / 98,783 |
| gpt-6.1-sol 派活判据 v9 | 26/90 | 52/84 | 26/26 | 13/38 | 13/20 | 10.7 / 65.2（25） | 54/60 | q-headphones 2、2、2；c-headphones-pair 2、2、2；c-phones-three 3、3、3；big-research 3、3、6；c-research-report 3、3、3 | — | 90 遍 209 次，1,466,745 / 740,224 / 82,149 |
| gpt-6.1-sol 并行 v8 | 8/21 | 14/21 | 7/8 | 2/7 | 5/6 | 16.5 / 73.0（5） | — | — | 3、自己、自己 | 21 遍 70 次，559,477 / 326,656 / 29,701 |
| gpt-6.1-sol 并行 v9 | 12/21 | 19/21 | 12/12 | 4/6 | 3/3 | 9.8 / 35.4（2） | — | — | 3、3、3 | 21 遍 60 次，445,372 / 248,832 / 25,605 |
| glm-5.3-flash 并行 v8 | 0/14 | 9/14 | 0/0 | 3/8 | 6/6 | 15.1 / 78.7（5） | — | — | 自己、自己 | 14 遍 46 次，397,137 / 243,968 / 36,830 |
| glm-5.3-flash 并行 v9 | 1/15 | 11/15 | 1/1 | 5/8 | 5/6 | 18.4 / 44.2（3） | — | — | 自己、3、自己 | 15 遍 45 次，416,119 / 267,776 / 49,830 |
| deepseek-flash 并行 v8 | 0/14 | 2/14 | 0/0 | 2/8 | 0/6 | 24.1 / 37.2（6） | — | — | 自己、自己 | 14 遍 56 次，501,025 / 374,784 / 29,514 |
| deepseek-flash 并行 v9 | 0/14 | 6/14 | 0/0 | 5/8 | 1/6 | 3.0 / 35.9（4） | — | — | 自己、自己 | 14 遍 47 次，425,826 / 304,896 / 29,500 |

（先说打算只算不止一步或派出去的那些遍，按做法拆成派出去 / 自己上网 / 自己做；第一次见字的中位只算有字的那些遍，括号里是停在浏览器前一个字也没有的遍数。）

**读法**（对着裁决 196 第 3 条的三个条件）：

- **打算句回来了**：sol 派活判据自己上网的那些遍先说打算 2/37（v8）→ 13/38（v9），自己做的 8/24 → 13/20；合计 31/82 → 52/84，比 v6（47/83）、v7（47/84）都多。第一次见字的中位 23.7 → 10.7 秒，最长 247.1 → 65.2 秒；停前无字 35 → 25 遍。并行套件 14/21 → 19/21，中位 16.5 → 9.8 秒。glm、ds 的并行也多说了（9/14 → 11/15，2/14 → 6/14）。
- **差事并行回来了**：`p-three-errands` sol 3 个标签 ×3（v8 是 1/3，v6、v7 都是 3/3）；glm 1/3（v8 0/2），ds 0/2（v8 0/2，三版都没派过）。`p-split-one` sol 照旧 2/3。
- **对比没被带偏**：sol 的对比三条仍一款一个标签，`q-headphones` 2、2、2，`c-headphones-pair` 2、2、2，`c-phones-three` 3、3、3（与 v8 一样）；报告 `big-research` 3、3、6，`c-research-report` 3、3、3。派活判据派出去 21 → 26/90。
- **事实带出处**：sol 56/60 → 54/60，v9 的 2 遍不合格都是 `q-followup-sourced`（假 CLI 看不到子任务记录就上网核实，票 139 起的老问题）；世上的事实没有一遍凭记忆答。
- **193 的溢出更足了**（裁决 195 第 5 条接受的）：`q-notes-apps` 3/3 派（v8 2/3）、`e-invoices` 3/3 派（v8 1/3）、`p-question-parts` 3/3 拆成东西部两块（v8 2/3），都回到 v6 的样子。

**每条用例各遍的记录**（只列这一轮跑过的；格式同第一轮第 4 节）：

派活判据（「网」自己上网，「做」自己做，「答」直接答，「派N」派了 N 个标签，×后是遍数）：

| 用例 | sol v8 | sol v9 |
| --- | --- | --- |
| q-injuries | 网×3 | 网×3 |
| q-east | 网×3 | 网×3 |
| q-story | 网×3 | 网×3 |
| q-weather | 网×3 | 网×3 |
| q-notes-apps | 派1×2 网×1 | 派1×3 |
| quick-usd | 网×3 | 网×3 |
| quick-downloads | 做×3 | 做×3 |
| todo-note | 做×3 | 做×3 |
| conv-writeup | 做×3 | 做×3 |
| e-invoices | 做×2 派1×1 | 派1×3 |
| e-template | 做×3 | 做×1 派1×2 |
| big-quotes | 网×3 | 网×3 |
| big-pdfs | 做×3 | 做×3 |
| big-research | 派3×1 派4×2 | 派3×2 派6×1 |
| ask-dispatch | 派1×3 | 派1×3 |
| midway-invoices | 做×3 | 做×3 |
| q-headphones | 派2×3 | 派2×3 |
| q-fact-injury | 网×3 | 网×3 |
| q-followup-quick | 网×3 | 网×3 |
| q-followup-sourced | 做×2 答×1 | 做×1 网×2 |
| q-followup-shown | 做×2 答×1 | 做×3 |
| q-recent-fact | 网×3 | 网×3 |
| q-concept | 答×3 | 答×3 |
| q-howto | 答×3 | 答×3 |
| q-browser-insist | 网×3 | 网×3 |
| c-headphones-pair | 派2×3 | 派2×3 |
| c-phones-three | 派3×3 | 派3×3 |
| c-research-report | 派2×1 派3×2 | 派3×3 |
| c-weather-sh | 网×3 | 网×3 |
| c-story-finals | 网×3 | 网×3 |

并行：

| 用例 | sol v8 | sol v9 | glm v8 | glm v9 | ds v8 | ds v9 |
| --- | --- | --- | --- | --- | --- | --- |
| p-three-errands | 做×2 派3×1 | 派3×3 | 做×2 | 做×2 派3×1 | 做×2 | 做×2 |
| p-split-one | 做×1 派3×2 | 做×1 派3×2 | 做×2 | 做×2 | 做×2 | 做×2 |
| p-same-tab | 网×3 | 网×3 | 网×2 | 网×2 | 网×2 | 网×2 |
| p-same-files | 做×3 | 做×2 派1×1 | 做×2 | 做×2 | 做×2 | 做×2 |
| p-question-parts | 派2×2 网×1 | 派2×3 | 网×2 | 网×2 | 网×2 | 网×2 |
| p-errand-and-question | 网×3 | 网×3 | 网×2 | 网×2 | 网×2 | 网×2 |
| p-errand-and-question-full | 派2×3 | 派2×3 | 网×2 | 网×2 | 网×2 | 网×2 |

**真模型调用**（本轮）：sol 111 次运行、269 次模型调用（派活判据 90 次 209 次，并行 21 次 60 次；输入 1,912,117 token，缓存 989,056，输出 107,754）；glm 15 次、45 次（输入 416,119，缓存 267,776，输出 49,830）；ds 14 次、47 次（输入 425,826，缓存 304,896，输出 29,500）。合计 140 次运行、361 次调用。没有运行失败或撞速率限制。

#### 5. 验证

数字照抄输出：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组 `test result`，合计 1345 passed，0 failed，0 ignored（`exit 0`）。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 493 files checked.`
- `git diff --check main`（含新文件）：无输出。
- `rustfmt --check`：`managed_prompt.rs`、`assistant_manual.rs` 干净。
- `run.py --dry-test`：1349 条 PASS、0 条 FAIL，`DRY TEST PASSED`（第二轮 1342 条；新加的是 v9 对 Rust 源码与对 v8 的核对）。
- 新增行扫过本机用户目录、登录名、worktree 与临时目录路径、密钥格式、服务商名与接口主机：本机登录名、worktree 路径、密钥、服务商名、接口主机都是 0 处；`managed-ga/`、`runner/`、`.scratch/` 下没有 `__pycache__`。
- 全角标点：`t145-cjk-punct.py` 扫整条分支新增行，命中 36 处（第二轮 29 处），多出的 7 处是 v9 提示词里的中文标签与本报告照抄的几段以逗号、分号结尾的英文原文，都是英文语境。

#### 6. 看到但没改的（Open risks）

1. **193 的溢出回到 v6 的样子**：`q-notes-apps`（一句「Mac 上有哪些好用的本地笔记软件？」）、`e-invoices`（整理下载文件夹里的发票）都 3/3 派出去，`p-question-parts` 一句预测问题 3/3 拆成东西部两块。裁决 195 第 5 条接受了，用户可以用一条备忘改；真机上一句问题会起两个子任务。
2. **glm、ds 上差事并行与派活作用有限**：三件差事 glm 1/3、ds 0/2 分头派；并行套件两家几乎都不派（glm 1/15、ds 0/14），v6 起一直这样，是模型本身。
3. **打算句的口径**：「先说打算」按 `PLAN_CUE_RE` 判，原文在 `results.md`「最先看到的字」一节可逐条核；v9 下停在浏览器前一个字也没有的 sol 仍有 25 遍（多是天气、汇率、某人近况这类一上来就开浏览器的），那几遍第一次见字要等查完。
4. **只重跑了这两句碰到的**：偏好套件、叫醒没用 v9 重跑（第二轮 v8 下偏好 sol 全照、叫醒 `w-two-of-three` 2/3），glm、ds 的派活判据也没用 v9 跑。
5. **沙盒在第一次浏览器调用就停**（同前两轮）：「先看一眼再派」与「整件自己做」分不开。
6. **没动的文档**：`docs/project-status.md`、主对话 PRD、devlog，留给主会话。

## Comments

- 2026-11-04 13:09–13:24 主会话 dev 真机（真实模型，CLI 发、查库；Core 带票 145 第三轮）：
  1. 「湖人最近几场打得怎么样？」：自己查，7 步、66 秒，附出处，没派。打算没写在 `<summary>` 之外；第一步的 `<summary>` 是「先查湖人最近几场比分和战绩，再看状态走势」，界面上是进展小字，10 秒见到。评测只算 `<summary>` 之外的字，真机上这行小字也是用户看得到的打算。
  2. 「帮我分头准备三份东西：杭州三日游的行程安排、上海到北京坐高铁和坐飞机的对比、适合新手的家用咖啡机推荐清单」：48 秒后回「我把这三份分头准备，同时进行」并说明先按什么口径（没给日期与预算），派出 3 个。三件 6 分 22 秒、7 分 27 秒、10 分 52 秒做完；Core 攒齐，第三件做完的同一秒叫醒一次，三份报告一起到；主对话 95 秒写成一条回复，三份各给快速看的版本，完整的三份 Markdown 以文件卡片给出（在引擎临时目录 `managed-ga-state/temp/`，没写进用户文件夹）。从发出到回复 13 分 15 秒。
  3. 看到的代价：三件互不相干，先做完的那件（6 分 22 秒）因为同批攒齐，晚了 4 分半才到主对话。裁决 193 第 5 条按「同一条回复派出的算一批」定，没区分「拆开的几块」与「互不相干的几件」。
  4. 没写备忘、待办、提醒；界面没截（CLI 走查）。
