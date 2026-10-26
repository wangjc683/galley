# 96 备忘的手册与评测：`memo.md`、待办与叫醒两份手册改指备忘、入口层一句、「备忘」评测套件

Status: needs-dogfood（2026-10-26 rebase 到含票 97 的 main 后快进合入 `bc4af9d9`–`98e25d55`；主会话机器验收：worktree 里复跑 `cargo test --workspace` 本机时区与 `TZ=UTC` 各 1254 条全过，评测 `--dry-test` 过、没有 `__pycache__`，`git diff --check` 过，新增行无本机路径、key 与真实会话 id（`s-mgn4k2x1-…` 是评测旧样例里就有的假 id）。评测改后的措辞 14/15，「看出来的兴趣」两遍都没记成；它与回报里「看到但没改」的三条交给票 [98](./98-memo-interest-and-follow-ups.md)。与票 95、97 一起真机走）

来源：[主聊天 PRD](../PRD.md) 裁决 140–143（2026-10-26，主对话的备忘；JC：「按你建议推进」）；devlog [主对话的备忘](../../../docs/devlog/2026-10-26-main-chat-memo.md)。依赖票 [95](./95-memo-core-and-cli.md)（`galley memo` 命令、段首的备忘一节、巡看叫醒说明里点名的那一段）。与票 97（GUI）同时在跑，不碰同一处。

## 为什么

票 95 给了记录与命令，模型还不知道什么时候记、记什么、怎么跟待办分。裁决定了：

- **定位**：待办记动作，备忘记信息。拿不准时问「这件事会结束吗」：会结束进待办这一家，不会结束、只有「还对」与「不对了」的进备忘，会过期的带 `--until`。
- **门槛**（裁决 141）：只记下一段还用得上的。记：你是谁（称呼、家人、工作）、偏好与忌讳、常打交道的人和地方、反复出现的兴趣、有日子但到时不用做事的信息（公司成立日）。不记：聊过的内容（查得到）、这一轮办完就没用的、已经是待办或提醒的、单纯的情绪、密码与验证码这类秘密。
- **一件事一条**：记之前看段首的备忘一节，同一件 `memo update` 那条，不新加；「常问 76 人」再问十次还是一条。总量超了（命令会说），先合并或删掉过时的。
- **写法**：写给用户看，用用户自己的说法，一句话，不写成关于用户的记录（不写「用户说……」「JC 告知……」）。看出来的兴趣也记，字面写明来源（「看你这周常问 76 人」），不写成「你说你关注 NBA」。
- **四处重叠按寿命分，一件事只放一处**（裁决 142）：有日子的事分三种（到那天要动手或想知道 → 待办；值得到时问一句 → 跟进；什么都不用做 → 备忘）；只为这一件用的写进待办的 `--notes`，这件之外还用得上的进备忘、待办里不再抄；要它提醒的是例行，只是作息是备忘；一句话两种寿命各写各的一半（「下周三去上海出差，周二提醒我订酒店」→ 待办「订上海的酒店」加备忘「下周三起在上海出差」`--until` 周五）。手册不记成待办的「我最近想学吉他」（`todos.md:62`）可进备忘、标成兴趣。
- **配合**：备忘决定待办怎么记（你说过「提醒提前一天」「早上 9 点前别吵我」，挂提醒时照办）；待办办完改了一件事实，备忘跟着改；过时的备忘顺手删（这是每一轮的规矩，不是巡看的）。
- **与 GA 记忆的边界**：关于用户这个人的进备忘；怎么做事的（环境、路径、踩过的坑）照旧进 GA 自己的记忆。
- **巡看**（裁决 143）：叫醒说明里点名的新备忘，每条问一句「过了一夜，有什么是我能替你做成、而你会想知道的？」多数答案是没有：固定的事实与偏好跳过；外面会变的（球队、关注的政策）查一下，有用户会想知道的才说；想做但没交代下一步的（想学吉他）能做成一份准备才说，不问「要不要我帮你找」；有结束时间的处境一般跳过。开口门槛照旧「做成了，而且你会想知道」；一次巡看两件子任务的名额待办与备忘共用，待办优先；对外、花钱、不可逆的先问；来源随话带出（「你昨天说……」）。

## 要做的

手册在 `docs/managed-ga-runtime/galley-assistant-manual/`，Core 把它嵌进去、主对话起 runner 时写到状态根（`core/src/assistant_manual.rs`，`part!` 列表与断言条文的测试）。英文写，中文用户的例子用中文，照现有各部分的文风与长短。

1. **新部分 `memo.md`**：写上面「为什么」里定位、门槛、一件事一条、写法、四处重叠、配合、与 GA 记忆的边界；命令用法（`memo add / update / delete / list`，`--until`、`--no-until`，单条 100 字、总量 2,000 字的上限与超限时怎么办，`--supervisor=galley-assistant`、`--reason`，照 `todos.md` 写命令的那段格式）。说明回复下会挂卡片给用户看（记下了 / 改为 / 不再记），所以「记下了」只在这一轮真写了才说。`assistant_manual.rs` 的 `part!` 列表加它，断言条文的测试加几条关键句（单行片段）。
2. **`todos.md`**：`:25-28` 那段「an address, a flight number or a preference belongs in your memory, and so does a date with nothing to do」改指备忘（`memo.md`）；`:62` 的愿望一句补「可进备忘，作为兴趣」；「记一下」带日子的那句（`:72-74` 附近，「never into your memory alone」）改成备忘。`--notes` 一条（`:107-111`）补半句：这件之外还用得上的（房东的电话）进备忘，备注里不抄。改法照原文的口气，不重写整段。
3. **`wake.md`「The morning review」**：叫醒说明里列了新备忘时怎么做（上面「巡看」一条）；两件子任务的名额与待办共用、待办优先；原来的「skips the morning when there is nothing to look at」补上新备忘也算。看 `unasked.md` 有没有要跟着改的一句（它讲「主动的是动作」），有就改、没有不动。
4. **入口层**（`core/src/managed_prompt.rs:418-440` 一带的主对话入口层）：
   - 「Note what the user has to do …」那段后面加一句：用户说出的、以后用得上的关于他的事，记进备忘，见 `memo.md`（措辞你定，越短越好）。
   - 「Say 「记下了」 … (a to-do, a reminder, your memory)」改成 `your memo`。
   - 「Before a Galley CLI write (… or to-do command)」那句加上 memo 命令与「`memo.md` to note or change what you know about the user」。
   - 预算常量（`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`、`STATIC_PROMPT_BUDGET_BYTES` 等）照现有记账写法上调，加了多少写进常量注释；Windows 检出是 CRLF，原始字符串里的提示词在 Windows 上带 `\r`，`contains` 别跨行，预算按本机 +18 的余量处理（照现有预算测试的做法）。`docs/managed-ga-runtime/prompt-composition.md` 的条款台账照改。
5. **评测**（`.scratch/main-chat/entry-layer-eval/`，先读 README）：
   - 手册与入口层改了：照 README 的做法重新生成 `galley-prompt/`（README「改了 Rust 提示词之后」那段），`--dry-test` 要过；`run.py` 若没有段首备忘一节的移植（票 79 发现过状态块没移植），补上，能给用例塞几条现成的备忘。
   - 新建 `memo/` 套件，用例各跑两遍，模型 `--model-id mm_1792576875658`（API key 接入的 gpt-6.1-sol，与主对话同一个模型），总共不超过 30 次运行。用例（措辞你定，覆盖这些）：
     - 该记：亲口说的偏好（「我不吃香菜」）；家人（「我女儿今年上小学一年级」）；常打交道的人带电话（「房东王先生，电话 …」，号码用明显虚构的）；有日子但到时不用做事的（「公司是 3 月 15 号成立的」）；看出来的兴趣（历史里三轮都在问同一支球队，这一轮又问）→ 记成「看你……常问」。
     - 不该记：闲聊（「今天好累」）；一次性的（「帮我算一下 37 乘 48」）；已经在待办里的（「周三要交季度报告」只记待办）；单纯的情绪；密码或验证码。
     - 该改不该加：段首已有「房东王先生，电话 A」，用户说房东换号了 → `memo update` 那条。
     - 重叠：「下周三去上海出差，周二提醒我订酒店」→ 一件待办加一条带期限的备忘，各写各的一半；「明天给房东回个电话」且备忘里已有房东电话 → 只记待办，备注里不抄号码。
     - 巡看：叫醒说明点名一条偏好类新备忘 → 不开口（`<no-reply/>`）；点名一条兴趣类新备忘 → 它可以查、派子任务或不开口，不能只问「要不要我帮你……」。
   - 判卷照现有套件的写法（看工具调用：记了几条、记在哪、正文是不是写给用户看、有没有复述成「用户说」）；结果文件按 README 的合并做法写回，结果里不写服务商名、域名、本机路径。README 加一节「备忘（票 96）」。
6. **对真实数据核对**：不需要。别读 JC 的 GA 记忆与库。

## 票 95 合入后补（主会话）

- 票 95 已合入 main（`64d1489e`、`4d78db86`）。命令、JSON、超限字段 `overLimit`、段首「### Memo」一节的原文、巡看叫醒说明里加的那段原文，都在票 95 的 Comments「实现报告」里，手册照那里的实际写法写，别照本票的设想。
- 巡看叫醒说明里那段的结尾指向 `wake.md` 的「The morning review」，那一节要接得上它的说法（「most need nothing」）。
- 「你发起的轮次」在 Core 里判为「那一轮开头的用户行不是 `system`」，别的 agent 往主对话 `session send` 的也算；手册不用为此加话。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 票 95 的 Core 逻辑（表、命令、段首一节、巡看判据与叫醒说明）：只读；发现要改的写进回报，不在本票改。
- `gui/`（票 97 在改）、`runner/`、`managed-ga/`、IM 的提示词。
- 手册里与本票无关的条文；GA 自己的 L0 / L1 / L2（属于用户状态，也不改种子）。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据、私有接口地址、服务商名。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`（手册断言与预算测试），再在 `TZ=UTC` 下跑一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 评测 `--dry-test` 全过（命令照 README：`PYTHONDONTWRITEBYTECODE=1` 与它点名的解释器）；`managed-ga/` 下没有 `__pycache__`。
- 手册与文档里新增的中文用全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `memo.md` 全文；其他手册改动的 diff 原样；入口层改动的 diff 原样与预算变化。
3. 评测：`--dry-test` 结果；`memo/` 每个用例两遍的结果表（过 / 不过、记了什么、记在哪），不过的贴原文；跑了几次运行、多少次模型调用。
4. 验证命令与结果原样。
5. 看到但没改的问题（尤其票 95 那边的），没验证到的地方。

## 给 JC 的真机步骤

见票 [97](./97-memo-cards-and-panel-page.md)（三张票合入后一起走）。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-96-memo-manual`）

**1. 提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

```text
f356019d Eval: memo suite results on gpt-6.1-sol, two repeats on two wordings
7623e4b3 main-chat ticket 96: name the noticed interest in the entry layer, split the trip in todos.md
6984b34c Eval: the memo suite (ticket 96), prompts regenerated, memo lines and the review's memos ported
85c3648d main-chat ticket 96: the memos' manual, todos.md and wake.md point to them, the entry layer's sentence
```

**2. 手册与入口层**

`memo.md` 全文（手册第十部分，`assistant_manual.rs` 的 `PARTS` 排在 `todos-change.md` 之后）：

````markdown
# Galley Assistant Manual: Memos

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## The user's memos

Your memos are what you know about the user, kept by Galley: your "Memo"
lines at the start of each segment, and 「备忘」 beside this chat, where
the user can only delete one; anything else, they tell you. A to-do is
something to do; a memo is something you know. When you are not sure
which, ask: will it end? When it gets done, dropped or reminded, it goes
with the to-dos and reminders (see `todos.md`). When it is only ever still
true or no longer true, it is a memo, with a last day when it will stop
holding.

### What to note

Note, without being asked, only what you will still need in a later
segment:

- Who they are: what they are called, their family, their work.
- What they prefer or avoid.
- The people and places they deal with (their landlord, and the number).
- An interest that keeps coming up, said or seen (the same team asked
  about again and again).
- A date with nothing to do when it comes (the day their company was
  founded).

Not what you talked about (the history has it), what is of no use once
this turn is done, what is already a to-do or a reminder, a passing mood,
or a secret such as a password or a verification code.

One thing, one memo. Before you note one, look at your "Memo" lines and
what you noted since: when the same thing is there, `memo update` that
one instead of adding a second (「常问 76 人」 asked ten more times is
still one memo). When a fact changes (a new number, a move), change its
memo; when you see one is out of date, delete it then, in any turn.

Write it for the user, who reads the list: one sentence, in their words,
not a record about them (not 「用户说……」 or 「他提到……」). An interest
you noticed says where it comes from (「看你这周常问 76 人」), not
「你说你关注 NBA」.

### A memo, a to-do, or both

One thing goes in one place, by how long it lasts:

- A date: when the user will act on it or want to hear of it then, a
  to-do; when it is worth your asking after then, your own reminder; when
  nothing is to be done then, a memo.
- What only one to-do needs goes in its `--notes` and ends with it
  (「A 座 3 楼，带身份证」); what is of use beyond it (the landlord's
  number) is a memo, not copied into the notes.
- What they want to be reminded of each time is a repeating reminder
  (「每周一提醒我交周报」); only knowing their routine is a memo
  (「工作日 9 点到公司」).
- One sentence, two lifetimes: write each half where it belongs.
  「下周三去上海出差，周二提醒我订酒店」 is the to-do 「订上海的酒店」 and the
  memo 「下周三起在上海出差」 until that Friday; the to-do does not retell
  the trip, and the memo does not mention the hotel.
- A wish with nothing to do yet (「我最近想学吉他」) is no to-do; it can be
  a memo, as an interest.

A memo shapes how you note a to-do: 「提醒提前一天」 or 「早上 9 点前别吵我」
decides when its reminder goes off. A to-do done that changes a fact
(「搬去 702」) changes that memo too. Noting a memo is all you do for it
then: what you could get done for it waits for the morning review (see
`wake.md`).

What is about the user goes here; how to do things (their setup, paths,
what went wrong before) stays in your own memory, as before.

### The commands

    memo add "<text>" --until=<YYYY-MM-DD> --supervisor=galley-assistant --reason="<why>"

- The text is one sentence, 1 to 100 characters. `--until` is its last
  day, for something that will stop holding (a trip, a stay); leave it
  out otherwise. After that day it is gone from your "Memo" lines and the
  list.
- `memo update <memo-id>` with `--text=`, `--until=` or `--no-until`;
  `memo delete <memo-id>`; `memo list` reads them now. The ids are in your
  "Memo" lines, and in what `memo add` printed.
- The memos come to at most 2,000 characters at the start of a segment.
  A write past that is kept, and its result carries `overLimit`: merge
  memos, or delete the ones out of date, before you note another.

These are yours to do without asking. The desktop shows a card under your
reply for each memo you note, change or delete (「记下了 · 不吃香菜」,
「改为 · ……」, 「不再记 · ……」), so the user sees it without your saying
so; do not describe the card. Say 「记下了」 only when you wrote one this
turn.
````

其他手册改动（`todos.md`、`wake.md`），diff 原样（`570ab24a..HEAD`；空白的上下文行去掉了行尾那个空格，免得 `git diff --check` 报错）：

```diff
diff --git a/docs/managed-ga-runtime/galley-assistant-manual/todos.md b/docs/managed-ga-runtime/galley-assistant-manual/todos.md
index e5e7244f..461d19af 100644
--- a/docs/managed-ga-runtime/galley-assistant-manual/todos.md
+++ b/docs/managed-ga-runtime/galley-assistant-manual/todos.md
@@ -23,13 +23,15 @@ fill in a form for either:
   tasks, once or repeating.

 Neither holds information: an address, a flight number or a preference
-belongs in your memory, and so does a date with nothing to do when it
+is a memo (see `memo.md`), and so is a date with nothing to do when it
 comes (the day their company was founded). What will happen on a date and
-be of use to raise then is not information: follow it up. Do not tidy the
-list on your own. When the user asks you to turn what you talked about
-into to-dos (「把最近聊的事整理成待办」), look through the conversation
-(search the history if you need to), show them the list first, and note
-them once they say yes.
+be of use to raise then is not information: follow it up. One sentence
+can be both: 「下周三去上海出差，周二提醒我订酒店」 is the to-do 「订上海的酒店」
+and the memo 「下周三起在上海出差」, each with its own half (see `memo.md`).
+Do not tidy the list on your own. When the user asks you to turn what you
+talked about into to-dos (「把最近聊的事整理成待办」), look through the
+conversation (search the history if you need to), show them the list first,
+and note them once they say yes.

 ### Noting a to-do

@@ -67,11 +69,12 @@ second. Before you follow something up unasked, read
 "Follow-ups the user turned down" in your "In Hand" lines: one of the
 same kind there means leave it, unless the user asks for it outright. A
 passing wish, a complaint, or something already finished is not something
-they are in the middle of.
+they are in the middle of. A wish with nothing to do yet can be a memo
+instead, as an interest.

 When the user says 「记一下」, 「帮我记着」 or 「提醒我」 about something with
 a date, it goes on their list or into your own reminders, always; never
-into your memory alone.
+into a memo alone.

 When the user asks to be reminded, or you follow something up, ask
 yourself: if they ignored the reminder, would the thing still need to be
@@ -109,7 +112,8 @@ on their list?
   this conversation may be out of your context by then. The user sees the
   notes under the to-do in their list: write them for the user, in their
   language (「A 座 3 楼，带身份证」), without the title or the day again,
-  and not as a record about them (「用户说……」).
+  and not as a record about them (「用户说……」). What is of use beyond this
+  to-do (the landlord's number) is a memo instead, not copied here.
 - A to-do's reminder is set, moved and removed only with `todo add` and
   `todo update` (`--remind-at`, `--no-remind`), never with the `schedule`
   commands: a reminder made with `schedule create` is not on the to-do.
diff --git a/docs/managed-ga-runtime/galley-assistant-manual/wake.md b/docs/managed-ga-runtime/galley-assistant-manual/wake.md
index 69aadb10..0e5020c0 100644
--- a/docs/managed-ga-runtime/galley-assistant-manual/wake.md
+++ b/docs/managed-ga-runtime/galley-assistant-manual/wake.md
@@ -55,8 +55,8 @@ Every morning a little before or after 9:00 (the time is in
 `schedule list`) Galley wakes you to go over what is in hand; the note
 says it is the morning review. Galley made this task, not you, and
 skips the morning when there is nothing to look at (what is due further
-off and your own reminders come up at their own time); when it wakes
-you, go over everything in hand.
+off and your own reminders come up at their own time) and no memo is new
+since the last review; when it wakes you, go over everything in hand.

 - Read what is current first: `todo list`, `schedule list`, and your
   subtasks still running (`sessions list`).
@@ -64,12 +64,23 @@ you, go over everything in hand.
   `unasked.md` says, at most two subtasks in all. Do not raise early a
   reminder that has its own time, and do not chase the user's own
   to-dos, overdue ones included: their reminders do that.
+- When the note lists memos noted or changed since the last review, ask
+  of each whether, now a night has passed, there is something you could
+  get done for the user that they would want to know. Most need nothing.
+  A settled fact or a preference (「不吃香菜」): skip it, and usually a
+  situation with an end date too (a trip). Something out in the world
+  that changes (a team they follow, a policy they watch): look it up, and
+  speak only when there is something they would want to know. Something
+  they want to do but gave no next step for (「想学吉他」): speak only with
+  groundwork you can hand them, never 「要不要我帮你找」. The two subtasks
+  are for the to-dos and the memos together, the to-dos first.
 - Speak only when you got something done that the user will want to
   know: something you found, a file you made, something ready for them
   to decide on. Not that you looked and nothing changed, nor what they
   can already see. One message for all of it, in your own words: say
   what each thing is and that you did it this morning
-  (「阿里云那件我早上查了一下：……」); no fixed heading. When you only
+  (「阿里云那件我早上查了一下：……」), and for a memo where it came from
+  (「你昨天说想学吉他，……」); no fixed heading. When you only
   started subtasks, with no result yet, write nothing for the user: the
   subtask tags and `<no-reply/>`, nothing else (you tell them when the
   subtasks are back). When you did nothing worth telling, your whole
```

`unasked.md` 没改：它讲「主动的是动作」，巡看里每件只做成了才说、两件的名额（「in a morning review, at most two in all」）对备忘照样成立；「记下时想一步」那句会不会让记一条备忘时当场去做，由 `memo.md` 的「Noting a memo is all you do for it then: what you could get done for it waits for the morning review」收住（记备忘时读的是 `memo.md`，不读 `unasked.md`）。

入口层改动，diff 原样：

```diff
diff --git a/core/src/managed_prompt.rs b/core/src/managed_prompt.rs
index 1ec78cb7..030a5c9d 100644
--- a/core/src/managed_prompt.rs
+++ b/core/src/managed_prompt.rs
@@ -441,8 +449,10 @@ to finish, a lease ending), as a to-do, with a reminder when it has a date,
 and tick it off when it is done; set yourself a reminder when you promise
 to follow up. Do it unasked, but read `todos.md` in your manual before
 saying you will (it says when), and `todo list` before saying what is left.
+Note what you learn about the user that you will need later as a memo,
+an interest you notice in what they keep asking too (see `memo.md`).
 Say 「记下了」 or the like only after you wrote it down this turn (a to-do, a
-reminder, your memory); if you write nothing down, do not bring up
+reminder, a memo); if you write nothing down, do not bring up
 noting it.

 When you note something, think a step ahead: do what you can for it
@@ -452,9 +462,10 @@ unasked, then say what you did; offer nothing you have not done (see
 desktop shows it as a card.

 Your manual is in `{manual_dir}`, one file per part. Before a Galley CLI
-write (a session, project, model, schedule or to-do command), read the
+write (a session, project, model, schedule, to-do or memo command), read the
 parts it needs, together: `todos.md` and `unasked.md` to note a to-do;
-`todos-change.md` to change, tick off or list to-dos; `reminders.md` for
+`todos-change.md` to change, tick off or list to-dos; `memo.md` to note or
+change what you know about the user; `reminders.md` for
 your own reminders, changing them, and when the user asks to be reminded;
 `times.md` for any date or time; `authority.md` and `cli.md` for sessions,
 projects and models; `wake.md` and `subtasks.md` when Galley wakes you. Every
```

预算：`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 3140 → 3339（+199，量法照旧：空手册目录、`\r` 不计）。记备忘那句连换行 +140（第一版 +87，评测第 1 遍后点名看出来的兴趣 +53），「your memory」→「a memo」−5，写命令列表的 `memo` +6，手册列表的 `memo.md` 一句 +58。静态预算没动（主对话的静态规则没改）。入口层不是按平台变的原始字符串里的文字（测试量的是去 `\r` 的字节、单行片段），所以不需要 Windows 的 +18。`prompt-composition.md` 的条款台账加了一行，「Bounded」那段的数字顺手从 2767 改成 3339（票 73 把上限改成 3140 时这一处没跟着改）。

测试：`assistant_manual::tests` 新增 `manual_keeps_the_users_memos`（`memo.md` 的规则逐条单行片段，「Memo」一节的标题、`overLimit` 字段与 100 / 2,000 两个限额都对 Core 的实际写法；`wake.md` 新的一条在「The morning review」下面；`todos.md` 改指备忘的几句），`manual_spells_commands_as_the_cli_does` 加 `memo` 命令族的拼法，交叉引用数 18 → 22；`managed_prompt::tests` 新增 `main_chat_entry_layer_notes_what_it_learns_as_a_memo`，原有两条跟着改片段。

**3. 评测**（`.scratch/main-chat/entry-layer-eval/memo/`，README「备忘（票 96）」一节）

- `--dry-test`：`DRY TEST PASSED`，653 条检查（新加的：两个移植逐字对 Rust 样本，限额与 `ga.py` 的报错原文，提示词里「Memo」一节的位置与内容，巡看叫醒点名新备忘的原文，假 CLI 的 `memo` 命令族照真实 CLI 与 Core 拒绝与改状态，判定的 30 来条自造运行）；`managed-ga/` 与 `runner/` 下没有 `__pycache__`（`find` 为 0，`check-managed-ga-payload.mjs` OK）。待办、闲聊、定时、叫醒四套 `--render-only` 重出逐字不变。
- 输入：`schedule/galley-prompt/` 两份用临时测试（跑完删掉）重新生成，加了 `__MEMO__` 占位；另写的一份不带占位的与仓库里的旧文件比，只差入口层那几行。`cli-help.json` 用开发版二进制在假 HOME 下重抓（56 条里只有顶层多一行 `memo`，加 5 条 `memo` 帮助）。`rust-samples.json` 加四组「Memo」一节与两条点名新备忘的巡看叫醒。
- 模型 `mm_1792576875658`（API key 接入的 gpt-6.1-sol），推理强度 high。**两遍不是同一份措辞**：第 1 遍（17:50，手册 `9e81e131`）是第一版，13/15；按它的两条不过改了措辞（`7623e4b3`），第 2 遍（17:59，手册 `c3cd6798`）是改后的，14/15。30 次运行用完，改后的措辞每条只跑了一遍。

| # | 用例 | 第 1 遍（第一版） | 第 2 遍（改后） | 记了什么、记在哪 |
| --- | --- | --- | --- | --- |
| 1 | pref-cilantro | 过 | 过 | 两遍各一条备忘「不吃香菜。」「不吃香菜」 |
| 2 | family-daughter | 过 | 过 | 两遍各一条备忘「女儿2026年上小学一年级。」 |
| 3 | landlord-phone | 过 | 过 | 两遍各一条备忘「房东王先生的电话是 138 0000 1111，以后房子的事都找他。」 |
| 4 | founding-date | 过 | 过 | 两遍各一条备忘「我们公司是 3 月 15 日成立的。」，没记待办、没建提醒 |
| 5 | interest-team | **不过** | **不过** | 两遍都什么都没记 |
| 6 | chat-tired | 过 | 过 | 都没动 |
| 7 | one-off-math | 过 | 过 | 都没动，答 1776 |
| 8 | report-todo | 过 | 过 | 两遍都只记待办「交季度报告」，截止周三 15:00、提醒周二 15:00，没记备忘 |
| 9 | mood-traffic | 过 | 过 | 都没动 |
| 10 | secret-wifi | 过 | 过 | 都没动，没写 GA 记忆；第 2 遍说「密码我不写进备忘」 |
| 11 | landlord-new-number | 过 | 过 | 两遍都 `memo update` 原来那条为「房东王先生，电话 139 0000 2222」，没新加 |
| 12 | trip-hotel | **不过** | 过 | 第 1 遍只有待办「订上海出差酒店」（11 月 3 日 9 点提醒，备注复述出差）；第 2 遍待办「订上海的酒店」（11 月 3 日 10 点提醒，备注没复述）加备忘「11月4日起在上海出差」到 11 月 6 日 |
| 13 | landlord-callback | 过 | 过 | 两遍都只记待办「给房东回电话」（明天、明早 10 点提醒），备注没抄号码，没动备忘 |
| 14 | review-pref | 过 | 过 | 两遍都只回 `<no-reply/>` |
| 15 | review-interest | 过 | 过 | 第 1 遍派 1 件只读查证的子任务 + `<no-reply/>`；第 2 遍要用浏览器去查（停在浏览器工具，注出来）；都没有「要不要我」 |

不过的原文：

- interest-team 第 1 遍（1 次模型调用，没调工具）：「我前面说的是**主场，对凯尔特人**。不过那条赛程我当时没核实，抱歉，不能当作已确认的信息。」判定：该记 1 条备忘，记了 0 条。
- interest-team 第 2 遍（3 次调用：读 GA 记忆里的 `web_setup_sop.md`，`web_execute_js` 开搜索页拿到没连浏览器的报错，回复）：「我前面说的是**主场，对凯尔特人**。不过那条赛程当时没核实，先别当准信，抱歉。」判定同上。改后的入口层点名了看出来的兴趣，它仍然只顾着核实上文的赛程。
- trip-hotel 第 1 遍：读了 `todos.md`、`unasked.md`、`reminders.md`、`times.md`、`todos-change.md`（没读 `memo.md`），`todo add "订上海出差酒店" --due=2026-11-03 --remind-at=2026-11-03T09:00 --notes="11 月 4 日（周三）去上海出差，提前订好酒店。"`，回复「记下了：**11 月 3 日（下周二）上午 9 点**提醒你订酒店，为周三去上海出差做准备。」判定：该记 1 条备忘，记了 0 条（注：待办里复述了出差）。

用量：30 次运行、90 次模型调用（第 1 遍 44 次，第 2 遍 46 次）；`--dry-test` 不连模型。结果里没有服务商名、接口域名与本机路径（结果写出前照旧换成 `$TMPDIR`，key 没有出现过）。

**4. 验证**（都跑过，看到输出）

- `cargo test --manifest-path core/Cargo.toml --workspace`：最终文本上本机时区 47 组、1254 条通过、0 失败；`TZ=UTC` 同样 47 组、1254 条、0 失败。第一版措辞时两种时区也各跑过一遍，结果相同。
- `rustfmt --edition 2021 --check core/src/managed_prompt.rs core/src/assistant_manual.rs`：干净（两个文件在 `570ab24a` 上本来就 rustfmt 干净，所以整篇格式化过；没跑 `cargo fmt --all`）。
- `git diff 570ab24a --check`：干净。
- `node scripts/check-docs-links.mjs`：OK，479 个文件；`node scripts/check-managed-ga-payload.mjs`：OK。
- 评测 `--dry-test`：PASSED（`PYTHONDONTWRITEBYTECODE=1`，README 点名的 3.14 解释器）。
- 新增中文的全角标点：scratchpad 里的脚本扫 `570ab24a` 以来的新增行与新文件，只有 `memo.md` 一处误报（英文句子里括住「工作日 9 点到公司」的半角括号）。
- 新增行查过本机路径、会话 id、私有接口地址、服务商名、key：没有（号码都是 138 0000 1111 / 139 0000 2222 这种明显虚构的）。

**5. 看到但没改的，没验证到的**

看到但没改的：

- 票 95 的样例数据与手册的写法对不上：`managed_prompt.rs` 的测试 `memo_lines_read_like_this` 和 `prompt-composition.md` 的样例里是「用户叫小林，在一家设计公司做产品经理」「看他这周常问 76 人 的比赛」，`subtask_report.rs` 的测试也是「看他……」。这正是 `memo.md` 说的不该写成的样子（「用户……」、第三人称；该是「看你……」）。只是假数据、不进提示词，但 JC 读文档时会拿它当范例。建议改成「叫小林……」「看你这周常问 76 人」，属于票 95 的文件，没动。
- `memo update` 在你发起的一轮里会重新盖 `fresh_at`（`core/src/db/memo.rs` `update_memo`）。`memo.md` 写的是「同一件 `memo update` 那条，不新加」，模型要是每问一次 76 人就 update 一次（比如改成「看你这两周常问」），第二天的巡看就会因它再醒一次，等于裁决 143 第 1 条想避开的「每天推比分」。评测里没有「同一件事又说了一遍、没有新内容」的用例，不知道它会不会这样做。可选：手册改成「keep it, or update it when something changed」，或 Core 只在正文或期限真的变了时才重新盖 `fresh_at`。都没改。
- `authority.md` 的三级权限里没有备忘，`cli.md` 的命令目录里没有 `memo`：备忘的「不用问就可以做」和命令只写在 `memo.md` 里（写备忘时入口层只让读 `memo.md`）。要目录完整，可以在两处各补一行。
- 入口层「When you note something, think a step ahead」字面上也盖住了记备忘；我没改它，靠 `memo.md` 那句「Noting a memo is all you do for it then」收住。
- 待办与闲聊套件里成立日、航班号、学吉他几条的期望是票 96 之前定的，不判备忘；现在备忘写在那两套里只注出来（「写了备忘：…」），要判得先改期望。`wake/galley-prompt/` 仍是票 73 的提示词，`schedule/`、`todo/`、`chat/` 的结果也都是旧提示词下的（这次只重跑了 memo 套件）。
- landlord-callback 两遍的回复都把备忘里的号码念给了用户（「王先生的电话是 138 0000 1111」）：待办备注里没抄，判过；只是记一下它会这样用备忘。

没验证到的：

- **interest-team 两份措辞都是 0/1**，看出来的兴趣在这个用例里一次也没记成；改了一次，原因没有再验证（运行额度用完了）。可能的方向：入口层说得更具体（比如同一件事问到第三次）；或者照裁决 140 第 6 条，把补记漏掉的挂在段界（deferred「主对话的跨段连续性」第 3 级）；也可能是用例本身（答案就在带过来的上文里，模型把注意力放在了「上文靠不靠得住」）。需要 JC 定下一步，再花几次运行确认。
- 改后的措辞每条只跑了一遍；trip-hotel 的修法只过了一遍。
- 巡看为兴趣醒之后真查到东西时怎么开口，沙盒里看不到（第 1 遍派了子任务，第 2 遍停在浏览器工具）。巡看的「前一天」窗口在评测里不模拟，点名哪几条是用例直接写的。
- 总量超过 2,000 字（`overLimit`）时模型怎么合并或删：只在 `--dry-test` 的假 CLI 里验了回不回这个字段，没让真模型碰到它。
- 没跑 `tauri dev`（按要求），回复下的备忘卡片与真 Core 的配合要等票 97 一起走真机；Windows（CRLF 检出）与 CI 没跑，新加的断言都是单行片段，入口层预算本来就去掉 `\r` 量。
