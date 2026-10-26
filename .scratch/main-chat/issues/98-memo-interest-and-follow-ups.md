# 98 备忘的收尾：看出来的兴趣记得上；没变化的 update 不再叫醒巡看；样例写法与手册对齐

Status: ready-for-agent

来源：票 [96](./96-memo-manual-and-eval.md) 的实现回报（「没验证到的」第 1 条与「看到但没改的」三条），主会话验收时定下全做（2026-10-26，JC 对这一组的授权：「按你建议推进」）。依赖票 95、96、97（都已合入 main）。只改 Core 的一个判断、手册、几处样例与评测；外置运行时零变化。

## 为什么

1. **看出来的兴趣两遍都没记**：评测 `memo/` 的 `interest-team`（上文三轮都在问同一支球队，这一轮又问）两份措辞各 0/1，模型的注意力都在「上文的赛程靠不靠得住」，没想到这是反复出现的兴趣。JC 定过要记（裁决 140 第 6 条：「了解用户的兴趣习惯也很有帮助」），这是裁决里唯一没做到的一类。
2. **没变化的 `memo update` 也会重新盖 `fresh_at`**（`core/src/db/memo.rs` 的 `update_memo`）：手册写「同一件 `memo update` 那条，不新加」，模型若每问一次 76 人就 update 一次（比如把「这周」改成「这两周」也算变化，但原样再写一遍不算），第二天巡看又会因它醒，正是裁决 143 第 1 条要避开的「每天推比分」。
3. **票 95 的样例写法与手册相反**：`core/src/managed_prompt.rs` 的测试 `memo_lines_read_like_this`、`core/src/subtask_report.rs` 的相应测试、`docs/managed-ga-runtime/prompt-composition.md` 的样例里写「用户叫小林……」「看他这周常问 76 人」，是 `memo.md` 说不该写成的样子；JC 读文档会拿它当范例。
4. **目录不全**：`authority.md`、`cli.md` 里没有备忘命令，权限与命令只在 `memo.md`。
5. **旧套件的期望早于备忘**：`todo/`、`chat/` 套件里公司成立日、航班号、学吉他这几条，现在记了备忘只会被注出来、判法没跟上。

## 要做的

1. **兴趣**：改手册与（必要时）入口层，让「同一样东西反复问」被认出来。方向（你按评测选，回报里写选了哪个、为什么）：
   - 给一个看得见的判据，例如「最近几轮里第三次问到同一样东西（一支球队、一只股票、一部剧、一个地方），记成兴趣」，写进 `memo.md`「What to note」；
   - 入口层那句（`managed_prompt.rs` 主对话入口层「Note what you learn about the user…」）若要再改，字数越少越好，预算照记账写法调；
   - 不在 Core 加计数或后台整理（裁决 140、141：记不记交给模型；段界补记仍在 deferred 等信号）。
   评测：`interest-team` 之外再加两条同类用例（一只股票、一部剧，上文各三轮），三条各跑两遍；`trip-hotel` 再跑两遍（上一轮改后只过了一遍）；`pref-cilantro` 跑一遍看没回退。总共不超过 10 次运行，模型 `--model-id mm_1792576875658`。改了措辞就重新生成 `galley-prompt/`、`--dry-test` 要过。
2. **`fresh_at` 只在真有变化时重盖**：`update_memo` 在正文（去掉首尾空白后）与期限都和原来一样时，不改 `fresh_at`、不改 `updated_at`；事件照写还是不写，你定（倾向不写：卡片上不该出现一张「改为」同样的话），回报说明。加测试：原样 update 不动 `fresh_at` 与 `updated_at`；只改期限、只改正文各算一次变化。`docs/agent-api/memo-commands.md` 若描述了 update 的效果，补一句。
3. **样例改成手册的写法**：上面三处样例的正文改成写给用户看的样子（如「叫你小林，在一家设计公司做产品经理」「看你这周常问 76 人的比赛」），测试断言跟着改；顺手看 `docs/agent-api/memo-commands.md` 与 `.scratch/main-chat/issues/95-memo-core-and-cli.md` 之外的现行文档有没有同样的写法（票 95 的票面与 Comments 是历史，不动）。
4. **目录**：`authority.md` 列「不用问就能做的」那里、`cli.md` 列命令那里，各补一行备忘（照两份现有的写法），`assistant_manual.rs` 的断言与交叉引用数跟着改。
5. **旧套件的期望**：`todo/`、`chat/` 套件里会因记了备忘而被注出来的几条，把期望改成「记成备忘也对（或应当记成备忘）」，只改判卷，不重跑；README 对应几节补一句。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`；备忘的表结构、命令的形状、段首一节的格式、巡看窗口与叫醒说明；其他套件的结果文件（只改判卷与 README）。
- Core 里不加兴趣计数、不加后台整理。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新增行不能有本机路径、会话 id、真实数据、私有接口地址、服务商名、key。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`，再 `TZ=UTC` 一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 评测 `--dry-test` 过（`PYTHONDONTWRITEBYTECODE=1` 与 README 点名的解释器），`managed-ga/`、`runner/` 下没有 `__pycache__`。
- 新增中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 兴趣：选了哪个方向、改动的 diff 原样、预算变化；评测每条两遍的结果表，不过的贴原文；运行次数与模型调用次数。
3. `update_memo` 的 diff 原样，事件写不写的决定。
4. 改了哪些样例与文档。
5. 验证命令与结果原样。
6. 看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

并进票 97 的真机步骤（一组走）：第 1 步之后，连着三轮问同一支球队的事，第三轮回复下应当出现「记下了 · 看你……常问……」的卡片。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-98-memo-follow-ups`）

**1. 提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

```text
c384d1d7 Eval (ticket 98): the interest noted 6/6, trip-hotel 2/2, pref-cilantro 1/1
3fa6ebd4 Eval (ticket 98): two more interest cases, memo expectations in the to-do and chat suites
beed8025 main-chat ticket 98: a count for the noticed interest, memos in the catalogs, samples written for the user
0e7fb9ee main-chat ticket 98: a memo update that changes nothing is no write
```

**2. 兴趣**

选的方向：给一个看得见的判据，「同一样东西问到第三次」。入口层那句与 `memo.md`「What to note」都写进去，不在 Core 加计数。

为什么两处都要改：票 96 的 interest-team 两遍都没打开过 `memo.md`（第 1 遍一次工具都没调，第 2 遍去核对赛程），只改手册，这一轮根本读不到。入口层那句原来的「an interest you notice in what they keep asking too」是一个要它自己去「看出来」的说法，换成能数的次数。同时 `memo.md` 的「一件事一条」改成同一件在那里就留着、有变化才 `memo update`，与下面第 3 条的 Core 改动对上。

`memo.md` 的 diff 原样（空白的上下文行去掉了行尾空格，免得 `git diff --check` 报错，下同）：

```diff
diff --git a/docs/managed-ga-runtime/galley-assistant-manual/memo.md b/docs/managed-ga-runtime/galley-assistant-manual/memo.md
index c8ad9b31..71ce59d8 100644
--- a/docs/managed-ga-runtime/galley-assistant-manual/memo.md
+++ b/docs/managed-ga-runtime/galley-assistant-manual/memo.md
@@ -22,8 +22,9 @@ segment:
 - Who they are: what they are called, their family, their work.
 - What they prefer or avoid.
 - The people and places they deal with (their landlord, and the number).
-- An interest that keeps coming up, said or seen (the same team asked
-  about again and again).
+- An interest that keeps coming up, said or seen: once they have asked
+  about the same thing three times (a team, a stock, a show, a place),
+  note it, saying where it comes from.
 - A date with nothing to do when it comes (the day their company was
   founded).

@@ -32,10 +33,11 @@ this turn is done, what is already a to-do or a reminder, a passing mood,
 or a secret such as a password or a verification code.

 One thing, one memo. Before you note one, look at your "Memo" lines and
-what you noted since: when the same thing is there, `memo update` that
-one instead of adding a second (「常问 76 人」 asked ten more times is
-still one memo). When a fact changes (a new number, a move), change its
-memo; when you see one is out of date, delete it then, in any turn.
+what you noted since: when the same thing is there, keep it, or
+`memo update` it when something changed, instead of adding a second
+(「常问 76 人」 asked ten more times is still one memo). When a fact
+changes (a new number, a move), change its memo; when you see one is out
+of date, delete it then, in any turn.

 Write it for the user, who reads the list: one sentence, in their words,
 not a record about them (not 「用户说……」 or 「他提到……」). An interest
```

入口层的 diff 原样：

```diff
diff --git a/core/src/managed_prompt.rs b/core/src/managed_prompt.rs
index 030a5c9d..07c3452e 100644
--- a/core/src/managed_prompt.rs
+++ b/core/src/managed_prompt.rs
@@ -449,8 +449,9 @@ to finish, a lease ending), as a to-do, with a reminder when it has a date,
 and tick it off when it is done; set yourself a reminder when you promise
 to follow up. Do it unasked, but read `todos.md` in your manual before
 saying you will (it says when), and `todo list` before saying what is left.
-Note what you learn about the user that you will need later as a memo,
-an interest you notice in what they keep asking too (see `memo.md`).
+Note what you learn about the user that you will need later as a memo;
+once they have asked about the same thing three times (a team, a stock),
+note it as an interest (see `memo.md`).
 Say 「记下了」 or the like only after you wrote it down this turn (a to-do, a
 reminder, a memo); if you write nothing down, do not bring up
 noting it.
```

预算：`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` 3339 → 3383（+44，量法照旧：空手册目录、`\r` 不计），常量注释与 `prompt-composition.md` 的「Bounded」、条款台账一起记了。

评测（`memo/`，模型 `mm_1792576875658`，推理强度 high，18:39 开跑，手册版本 `4826765f`）。只跑了票面点名的几条，记作第 3、4 遍；第 1、2 遍是票 96 的两份措辞：

| 用例 | 第 1 遍（票 96 第一版） | 第 2 遍（票 96 改后） | 第 3 遍（票 98） | 第 4 遍（票 98） | 票 98 记了什么 |
| --- | --- | --- | --- | --- | --- |
| interest-team | 不过 | 不过 | 过 | 过 | 「看你最近几次问76人的比赛和排名，关注费城76人。」「看你这几次常问费城76人的赛果、赛程和排名，关注这支球队。」 |
| interest-stock（新） | — | — | 过 | 过 | 「最近持续关注英伟达（NVDA），这几次常问股价、周涨幅和财报日期。」「关注英伟达（NVDA）的股价表现和财报时间，这几天多次问起。」 |
| interest-show（新） | — | — | 过 | 过 | 「看你最近连续问起《长街夜行》，你在关注这部剧。」「最近在关注《长街夜行》，这几次常问剧情、集数和更新安排。」 |
| trip-hotel | 不过 | 过 | 过 | 过 | 两遍都是待办「订上海的酒店」（11 月 3 日上午 9 点提醒，备注空）加备忘「11月4日（周三）起在上海出差」，到 11 月 6 日 |
| pref-cilantro | 过 | 过 | 过 | — | 「不吃香菜」 |

- 9 次运行全过，没有不过的原文可贴。六遍兴趣都先读 `memo.md`、先 `memo list` 再记一条，正文都写明了是从哪几次问里看出来的；回复照旧回答上文的问题。
- 用量：9 次运行、39 次模型调用。没动过措辞，额度还剩 1 次，没用。

**3. `update_memo`**

diff 原样：

```diff
diff --git a/core/src/db/memo.rs b/core/src/db/memo.rs
index 26f7bda4..adf06349 100644
--- a/core/src/db/memo.rs
+++ b/core/src/db/memo.rs
@@ -382,6 +382,15 @@ impl SqliteGalley {
     /// again for the next morning review when the user started the turn,
     /// as when it was noted; an `update` event records it.
     ///
+    /// An update that changes nothing (main chat ticket 98) — the same text
+    /// once trimmed and the same last day — is not a write: `updated_at`
+    /// and `fresh_at` stay as they were, and no event is recorded (its card
+    /// would read 「改为」 the words it already had). Otherwise the
+    /// assistant writing the same memo again each time the user brings the
+    /// thing up would wake the next morning review for it every day (PRD
+    /// ruling 143 point 1). It answers as a write does: the memo, and
+    /// `overLimit` when the memos are past the total.
+    ///
     /// **Errors**: `not_found`, `invalid_args` (as [`Self::create_memo`]).
     pub async fn update_memo(
         &self,
@@ -407,6 +416,9 @@ impl SqliteGalley {
             Some(None) => None,
             None => row.until_date.clone(),
         };
+        if text == row.text && until == row.until_date {
+            return self.memo_write(id.as_str(), today).await;
+        }
         let now = chrono_now_iso();
         let fresh_at = if self.turn_the_user_started(created_in.as_ref()).await? {
             Some(now.clone())
```

事件不写。原样的 update 不是一次写：卡片读的是事件，写了就会在回复下挂一张「改为」原话的卡片。它照常回 `{"memo": …}`（总量超了照样带 `overLimit`）。新测试 `an_update_that_changes_nothing_is_no_write`（`core/tests/memo_test.rs`）覆盖四种情况：
- 原样正文（前后带空格）不动 `fresh_at`、`updated_at`；
- 对没有期限的那条 `--no-until`，同样不动；
- 只改期限、只改正文，各算一次变化，在你发起的轮次里重新盖 `fresh_at`；
- 同一个期限再给一次，不算变化。

事件只记了一条 add 和两条 update。
- **文档**：`docs/agent-api/memo-commands.md` §5.38 补了一条；`stability-and-versioning.md` §7.1 加了一行（没有命令、字段、退出码变化，`updatedAt` 本来就写的是「正文或期限最后一次改的时候」）；`runtime-modes-and-sessions.md`「Fresh」一条补了一句。
- **评测**：假 CLI 的 `memo update` 照样改了（不写、不记），`--dry-test` 里加了一次原样 update，事件序列不变。

**4. 样例与文档**

- **改成写给用户看的样子**（「叫你小林，在一家设计公司做产品经理」「看你这周常问 76 人的比赛」）：
  - `core/src/managed_prompt.rs` 的测试 `memo_lines_read_like_this`（输入与期望各一处）；
  - `core/src/subtask_report.rs` 的测试 `the_morning_review_names_the_new_memos`；
  - `core/tests/schedule_wake_test.rs`（票面没点名，同一句「看他这周常问 76 人」，两处）；
  - `docs/managed-ga-runtime/prompt-composition.md` 的样例。
- **扫过的范围**：`git grep` 全仓（含 `gui/`）没有别的「看他」「用户叫」写法；`docs/agent-api/memo-commands.md` 的样例本来就是「不吃香菜」「下周三起在上海出差」。票 95 的票面与 Comments 没动。
- **目录**：
  - `authority.md` 在「Do it yourself」里加「Note, change or delete your memos about the user.」；
  - `cli.md` 在 Read 里加「`memo list`: what you noted about the user.」，在 Write 里加「`memo add`, `update`, `delete`: see `memo.md`.」；
  - `assistant_manual.rs` 的交叉引用数 22 → 23，加了这三行的断言（authority 那条要落在「Do it yourself」与「Ask the user first」之间），`cli.md` 的命令拼法列表加 `memo list`。
- **旧套件的期望**（只改判卷，没重跑）：
  - `memo_facts` 的备忘判法抽成 `memo_judgement`，`todo_facts` 用它判 `expect.memo`；
  - 公司成立日该记成一条备忘、有 11 月 20 日；
  - 学吉他、航班号、「装修 11 月 20 号完工，不用提醒我」、「下周三去上海出差」，闲聊组的成都机票、妈妈手术，可以记成一条备忘，记了只注出来（「记了备忘（也对）」）；
  - 只对手册里有 `memo.md` 的运行判，所以现有结果的判定一条没变（四套 `--render-only` 重出，判定逐条相同，只差 `expect_text` 的回显；结果文件按票面没动，重出的已还原）；
  - 两份 `cases.json` 的 `_note` 与 README 待办、闲聊两节各补了一句。

**5. 验证**（都跑过，看到输出）

- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区 47 组、1255 条通过、0 失败；`TZ=UTC` 同样 47 组、1255 条、0 失败（比票 96 多一条，新测试）。
- 改过的 Rust 文件逐个 `rustfmt --edition 2021 --check`：`core/src/db/memo.rs`、`core/tests/memo_test.rs`、`core/src/assistant_manual.rs`、`core/src/managed_prompt.rs`、`core/src/subtask_report.rs`、`core/tests/schedule_wake_test.rs` 都干净（六个在 `a17083d3` 上本来就干净；没跑 `cargo fmt --all`）。
- `git diff a17083d3 --check`：干净。`node scripts/check-docs-links.mjs`：OK，479 个文件；`node scripts/check-managed-ga-payload.mjs`：OK；`managed-ga/`、`runner/` 下 `__pycache__` 为 0。
- 评测 `--dry-test`：`DRY TEST PASSED`，663 条检查（`PYTHONDONTWRITEBYTECODE=1`，README 点名的 3.14 解释器）。新加的检查：原样 update 不记事件、两条新兴趣用例的判定、待办与闲聊套件里 `expect.memo` 只对有 `memo.md` 的运行判。票 63 那条「代码写记忆算有写」的检查改成只核「算有写」，因为成立日现在该记备忘。
- 新增中文的全角标点：scratchpad 里的脚本扫 `a17083d3` 以来的新增行，命中只在评测结果文件里（模型与 GA 的输出原文），我写的文字没有。
- 新增行查过本机路径、会话 id、私有接口地址、服务商名、key：没有（结果文件照旧换成 `$TMPDIR`，key 没出现过）。

**6. 看到但没改的，没验证到的**

看到但没改的：

- **兴趣用例的回复都说上文「当时没核实」**：六遍都是，票 96 的两遍也是（「那条赛程当时没有核实」「先别把 19 号当作确定日期」）。上文里助手的回答没有工具调用的痕迹，模型就不认自己说过的话。与备忘无关，可能是用例写法的副作用，也可能真机上也会这样，没改。
- **备忘的正文**有的没有主语、只写「关注英伟达（NVDA）……」，有的写成「你在关注这部剧」；都带了「这几次常问」一类的来源，判过。正文还可以更短。
- **原样 update 仍会广播一次 `memos:changed`**（`session_writes.rs` 的 `Writes::update_memo` 写完就发）：面板多刷新一次，没有卡片，无害，没改。
- **「问到第三次」这条判据**可能让工作上反复问的同一件事（比如同一段代码）也被记成兴趣；没有用例测过。
- `authority.md` 的「To undo」那句没提备忘：删掉的备忘只能再记一条。没改。

没验证到的：

- **记忆套件的其余 12 条在新措辞下没跑**（这次只跑了兴趣三条、trip-hotel 与 pref-cilantro），入口层那句变了，它们会不会受影响没测。待办与闲聊套件的新期望没有真跑过，只在 `--dry-test` 里用自造运行验过。
- 「同一件事又说一遍、没有新内容」时模型还会不会去 `memo update`：没有用例。Core 那边原样 update 已不算写，就算它去写也不会叫醒巡看。
- CLI 二进制上的原样 update 只在 Core 层测了（`core/tests/memo_test.rs`），`cli/tests/memo_test.rs` 没加一条。
- 没跑 `tauri dev`（按要求）：卡片在原样 update 时不出现、面板的刷新，要在票 97 的真机步骤里看。Windows（CRLF 检出）与 CI 没跑，新断言都是单行片段。
