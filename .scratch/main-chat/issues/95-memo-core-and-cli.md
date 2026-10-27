# 95 备忘的 Core 与命令：记录、`galley memo`、上限与期限、段首一节、巡看为前一天的新备忘叫醒

Status: done（2026-10-26 合入 `64d1489e`、`4d78db86`，JC 真机：「真机看了 OK」；库里有记、改期限、桌面删除的事件。最后一步 10-27 在 dev 库里核过：00:51 UTC 巡看为前一天的新备忘醒了（`assistant_review_log` 记 `woke`，`assistant_review_memo_window` 是 10-26 一天），叫醒提示点名了「不喜欢喝酒。」，主对话查过待办与子任务后 `<no-reply/>`，没有出声；见 v0.7.2 发布 devlog）

来源：[主聊天 PRD](../PRD.md) 裁决 140、141、143（2026-10-26，主对话的上下文与备忘；JC：「按你建议推进」）；devlog [主对话的备忘](../../../docs/devlog/2026-10-26-main-chat-memo.md)。改写 [助手 PRD](../../assistant/PRD.md) 裁决 10 与主聊天裁决 128 第 4 条的叫醒判据。本票只做 Core、CLI、Agent API 文档与 GUI 的 IPC 类型；手册与评测是票 96，卡片与面板页是票 97，两张都等本票合入后再开。

## 为什么

- 主对话要记住「关于你的事」（称呼、家人、偏好、常打交道的人、反复出现的兴趣），GA 的记忆接不住：L0 公理 1 只认工具调用的结果（「No Execution, No Memory」），用户亲口说的偏好按 L0 都不该记；L2 重置后 6 天没改过。裁决 140 定由 Galley 自己记：一份备忘记录，模型当轮用 `galley memo` 写，每段开头带上。
- 待办记动作，备忘记信息。备忘没有「办完」，只有「还对」与「不对了」，会过期的带期限。
- 信息丢在段界（空闲 4 小时开新段，只带最近 10 轮、15,000 字），所以备忘放进段首状态块，与 In Hand 并列：状态块是运行时层的一部分，起 runner 时定下，GA 的压缩与裁剪碰不到它。
- 裁决 141：记不记交给模型，总量由 Core 用确定式规则卡住。
- 裁决 143：巡看除了待办，也为「前一天」的新备忘醒；只算你发起的轮次里记下或改过的，每条只落进一个窗口。

## 要做的

照待办的路数做（迁移 `050_todos.sql`、`core/src/db/todo.rs`、`core/src/api/todo.rs`、`core/src/socket_listener/todo_cmds.rs`、`cli/src/todo.rs`、`docs/agent-api/todo-commands.md`）。名字、结构与待办不一致的地方，以本票为准；本票没说的细节照待办的现成做法，回报里列出你自己定的。

1. **迁移 `053_memos.sql`**：
   - `memos`：id（`memo_` 开头，同 `todo_` 的生成法）、正文、可选期限 `until_date`（只有日子，浮动本地日期，同 `todos.due_date`）、`created_at`、`updated_at`；出处同待办：`created_via`、`created_by_supervisor`、`created_origin_note`、`created_in_session_id`、`created_in_run_turn`、`created_in_turn_index`。
   - 一列「最近一次在你发起的轮次里记下或改过的时刻」（名字你定，下面叫 `fresh_at`）：在叫醒开头的轮次里记或改，不动它（见第 6 条）。
   - `memo_events`：每次记、改、删一行：备忘 id、动作（add / update / delete）、动作之后的正文（删除时记删之前的正文）、`via` 与 supervisor、出处的会话与轮次（同待办：`run_turn` 记那一轮开头的用户行，`turn_index` 在运行结束时填回复所在的轮，照 `settle_todo_created_in`，`core/src/db/todo.rs:637`，调用方 `core/src/message_queue.rs:232`）、`created_at`。票 97 的回复下卡片读它。
   - 删除：删掉 `memos` 那一行，`memo_events` 留着（卡片要显示「不再记 · ……」）。
   - **加迁移要补六处手写的迁移列表**：`core/tests` 里四个文件（如 `scheduler_fire_test.rs:83`、`db_test.rs:67`、`db_writes_test.rs:79`、`socket_write_handlers_test.rs:87` 那一组 `MIG_052`）加 `cli/tests` 里两处，各自 `include_str!` 手写列表；只跑 core 抓不到 cli 那两处，验证必须 `--workspace`。
2. **上限与期限**（命名常量，注释写依据「主聊天 PRD 裁决 141」）：
   - 单条：去掉首尾空白后 1–100 个 Unicode 字符（按字符，不按字节）；空的或超了，命令拒收，错误信息说清上限与这条的字数。错误类别照 `docs/agent-api/errors-and-exit-codes.md` 现有的参数错误，不新增类别。
   - 期限：`--until=YYYY-MM-DD`，按本机时区的日子算，不能早于今天；`memo update` 有 `--no-until`。过了期限那天（本地日子在期限之后）的备忘：不进段首、不进 `memo list`、不进面板、不计总量，行留着、不自动删（倾向不让 Core 删用户的数据；你若有更好的做法，回报里说）。
   - 总量：没过期的备忘正文字符数合计。`memo add` / `memo update` 之后超过 2,000，照记，JSON 里多一个字段说超了多少（名字你定，如 `overLimit: { chars, limit }`），人读的输出多一句英文：超过段首上限，先合并或删掉过时的（措辞你定，回报原样给出）。
3. **CLI 与 Agent API**（`3` 内加法；`--schema=1`、`2` 也认，同待办）：
   - `galley memo list`（没过期的，按记下的先后）、`memo add "<text>" [--until=]`、`memo update <id> [--text=] [--until= | --no-until]`、`memo delete <id>`；写命令带 `--supervisor`、`--reason`，记谁写的、在哪一轮写的，同 `todo add` 的出处规则。不要 `show`（一条只有一句），除非你发现 CLI 的命令族惯例要求有，回报里说明。
   - 事件 `memos:changed`（空载荷），写命令与面板的删除都发。
   - 文档：新增 `docs/agent-api/memo-commands.md`（照 `todo-commands.md` 的写法与 § 编号接着排），`docs/agent-api/README.md` 的表加一行；其余列命令族的地方照待办那次补。
4. **给面板与卡片的 IPC**（Tauri 命令，照 `list_assistant_todo`、`list_noted_todos`、`cancel_todo` 那组，`core/src/lib.rs:265` 一带、`core/src/commands/schedule.rs:171`）：
   - 列出没过期的备忘，带面板要的字段：id、正文、期限、`created_at`、`updated_at`、最近一次记或改的出处（会话 id 与 `turn_index`，面板「点一行回到当初那句话」用）。
   - 删除一条（`via = gui`，记为你在桌面上删的，事件照记一行 delete）。
   - 给卡片：某个会话里各轮的备忘事件（动作、正文、备忘 id、这条备忘现在还在不在），照 `list_noted_todos` 的形状。
   - `gui/src/types/ipc.ts` 补上对应的类型（Core-only 的 IPC 命令也要进这里，check.yml 的前置门禁查它）。本票不写 GUI 组件。
5. **段首的备忘一节**（`core/src/managed_prompt.rs`，接在 In Hand 后面；读的地方在 `core/src/runner_commands.rs:420` 一带，照 `in_hand_read` 的写法，读失败记日志、这一节不放，runner 照起）：
   - 有没过期的备忘才放。标题与说明照 In Hand 的英文写法（如 `### Memo`，一句说明：这是你替用户记下的、关于他的事，用 `galley memo` 改；措辞你定，回报原样给出）。
   - 每条一行：id、最近一次记或改的本地日子、正文、有期限的写到哪天。按记下的先后排（`created_at` 升序：先记的多是称呼、家人这类底子）。
   - 正文合计放到 2,000 字为止，放不下的那几条不放，最后一行写还有几条、用 `galley memo list` 查。
   - 固定文字加字节预算常量与测试，照 `IN_HAND_BUDGET_BYTES`（`managed_prompt.rs:2385`）的记账写法；Windows 检出是 CRLF，原始字符串里的提示词在 Windows 上带 `\r`，预算按本机字节数 +18 设、`contains` 别跨行（见 `docs/engineering-workflow.md` 有没有现成的说明，没有就照现有预算测试的处理）。`docs/managed-ga-runtime/prompt-composition.md` 的条款台账加一行。
   - 只在主对话。工作台、子任务、IM 的提示词一个字不变。
6. **巡看为前一天的新备忘叫醒**（`core/src/assistant_todo.rs:174` 的 `review_has_something_to_look_at`、`core/src/scheduler.rs:442` 的 `fire_review`）：
   - **窗口**：从上一次巡看（醒了或跳过都算，即巡看那条定时任务这次之前的 `last_fired_at`）那天的本地 0 点起，到今天本地 0 点止（不含）；从没巡看过就从昨天 0 点起。每条备忘只落进一个窗口；手动再跑一次巡看，同一天窗口为空。
   - **算的**：`fresh_at` 在窗口里、还没过期、还在的备忘。`fresh_at` 只在你发起的轮次里记或改时更新：那一轮开头的用户行不是 Galley 的叫醒行（巡看、提醒、子任务回报等叫醒都是 `created_via = 'system'` 的那种行，以库里实际的写法为准，回报里写你怎么判的）。不在主对话里写的（工作台、其他 supervisor）照你的判断：倾向只算主对话的，回报说明。
   - **判据**：原来的待办判据成立，或窗口里有这样的备忘，就醒；都没有照旧跳过。判断要能脱开 `chrono::Local` 测（传进「今天」与时区，同票 81 的做法）。跳过时的日志改成说清两样都没有。
   - **叫醒说明里点名**：窗口里有这样的备忘时，在巡看的叫醒说明里加一段英文，列出它们的 id 与正文，并指向 `wake.md` 的「The morning review」（手册由票 96 写）；没有就不加这一段，叫醒说明一字不变。措辞你定，回报原样给出。
   - `.scratch/assistant/closed-loop-snapshot.py` 里跳过原因的说法若随日志改，跟着改，别加逻辑。
7. **重置主对话时备忘跟着清**：`core/src/db/main_chat.rs:322` 删 `todos` 的那一处一起删 `memos` 与 `memo_events`；重置确认里若列了会清掉什么（看 `core/src/main_chat_reset.rs` 与 GUI 的确认文案），回报里说有没有要补的文案（GUI 文案留给票 97）。
8. **文档**：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`「The morning review」一条的判据补上新备忘；`docs/managed-ga-runtime/prompt-composition.md` 的段首说明补上备忘一节。devlog、PRD、`docs/project-status.md` 的历史不动。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`；JC 的数据库只读，只经备份读。
- `gui/` 只改 `gui/src/types/ipc.ts`；手册 `docs/managed-ga-runtime/galley-assistant-manual/` 与 `core/src/assistant_manual.rs` 不动（票 96）；入口层提示词（`managed_prompt.rs` 的主对话入口层条文）不动（票 96）。
- In Hand 的内容、分组、排序；待办与定时任务的表与命令；巡看的时刻、种子、补发、每天上限、两件子任务的上限（手册管）。
- `runner/`、`managed-ga/`、IM 的代码与提示词。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据、私有接口地址。

## 验证

- 干净的 target 上 `cargo check` 要 sidecar 占位文件；worktree 已克隆好 `core/target`、`core/python-bundle`、`core/gen`，照常跑即可。
- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍（窗口按本地 0 点算，日期边界最容易在这里错）。
- `pnpm --dir gui typecheck`（`ipc.ts` 改了）。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 新增中文（文档里的）用全角标点。
- 测试至少覆盖：单条 0 / 1 / 100 / 101 字（含中文与 emoji 的字符数）；期限早于今天拒收、今天可以、过了那天的不进列表、段首与总量；总量 1,999 → 加一条超过时照记并带超限字段；段首按先后排、放到 2,000 字为止与「还有几条」那一行、没有备忘时不放这一节；`fresh_at` 在叫醒轮次里不动、在你发起的轮次里动；窗口：上次巡看是昨天、前天（跳过一天）、从没巡看过、今天手动再跑一次；窗口里只有过期的、只有已删的不醒；只有新备忘、没有待办时醒且叫醒说明里点名，待办判据成立而没有新备忘时叫醒说明不变；重置后备忘与事件都清掉；运行结束时事件的 `turn_index` 填上；CLI 各命令的 JSON 与退出码。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 迁移的 SQL 原样；`fresh_at` 怎么判「你发起的轮次」，引代码行。
3. 段首一节的样子：用测试里的样例渲染出来原样贴出（不是真实数据）；固定文字的字节预算与常量。
4. 巡看：新判据与 `fire_review` 那段的 diff 原样；叫醒说明里加的那段原样；日志新措辞原样。
5. CLI：`memo add / update / delete / list` 各一例的 JSON 输出（测试数据）；超限那句原样。
6. IPC 命令与 `ipc.ts` 新类型的名字。
7. 改了哪些文档。
8. 验证命令与结果原样。
9. 你自己定的细节（本票说「你定」的那些），看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

（三张票都合入后一起走，见票 97。）本票单独合入后：dev 重启 Core，主对话下一段起段首带上备忘一节（还没有备忘时不出现）；`core/target/debug/galley memo add "测试一条" --supervisor=galley-assistant --reason=test` 能记，`memo list` 能看，重置前用 `memo delete` 删掉。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-95-memo-core`）

**1. 提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

- `64d1489e main-chat ticket 95: memos in Core, galley memo, the segment start, the review`

**2. 迁移 `053_memos.sql`**（文件头的长注释略，语句原样）：

```sql
CREATE TABLE memos (
  id                     TEXT PRIMARY KEY,
  text                   TEXT NOT NULL CHECK (text <> ''),
  until_date             TEXT,
  created_via            TEXT NOT NULL
                         CHECK (created_via IN ('gui','cli','supervisor','system')),
  created_by_supervisor  TEXT,
  created_origin_note    TEXT,
  created_in_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_in_run_turn    INTEGER,
  created_in_turn_index  INTEGER,
  fresh_at               TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE memo_events (
  id           INTEGER PRIMARY KEY,
  memo_id      TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('add','update','delete')),
  text         TEXT NOT NULL,
  until_date   TEXT,
  via          TEXT NOT NULL CHECK (via IN ('gui','cli','supervisor','system')),
  supervisor   TEXT,
  origin_note  TEXT,
  session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  run_turn     INTEGER,
  turn_index   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX memo_events_by_session
  ON memo_events(session_id, turn_index)
  WHERE session_id IS NOT NULL;

CREATE INDEX memo_events_by_memo
  ON memo_events(memo_id);
```

`fresh_at` 怎么判「你发起的轮次」：

- 写命令先照 schedule 一族的规则拿 `created_in`（`core/src/socket_listener/schedule_cmds.rs:73`；`core/src/socket_listener/memo_cmds.rs:88`、`:132`、`:156` 调它）：带 `--supervisor=galley-assistant`、主对话这时有一轮在跑，才得到「主对话 + 那一轮开头的用户行的 turn」，否则是 `None`。
- 再由 `core/src/db/memo.rs:280` 的 `turn_the_user_started` 判：`SELECT created_via FROM messages WHERE session_id = ? AND turn_index = ? AND role = 'user' ORDER BY sequence LIMIT 1`，`via != "system"` 才算（`:294`）。库里的实际写法：巡看、提醒、子任务回报这些叫醒都是同一种用户行，`created_via = 'system'`、supervisor `galley-report`（`Origin::subtask_report`，`core/src/api/origin.rs:205`，`persist_subtask_report` 写入）；你在桌面上发的是 `gui`。`create_memo`（`memo.rs:339`）判为真时 `fresh_at` 记当下，假时为 NULL；`update_memo`（`memo.rs:411`）判为真时改成当下，假时保留原值。
- 不在主对话里写的（工作台、其他 supervisor、没有在跑的一轮）：`created_in` 为 `None`，一律不算，照票面的倾向只算主对话。

**3. 段首的备忘一节**（测试 `managed_prompt::tests::memo_lines_read_like_this` 的样例，假数据，渲染原样）：

```text
### Memo

As of 2026-10-26 09:05, local time (it may have changed since: `memo list` reads it now; `memo add`, `memo update` and `memo delete` change it).

What you noted about the user, oldest first, each with the day you last noted or changed it:
- `memo_1a2b3c4d5e6f7a8b` 2026-10-20: 用户叫小林，在一家设计公司做产品经理
- `memo_2b3c4d5e6f7a8b9c` 2026-10-24: 不吃香菜
- `memo_3c4d5e6f7a8b9c0d` 2026-10-26: 看他这周常问 76 人 的比赛
- `memo_4d5e6f7a8b9c0d1e` 2026-10-26, until 2026-11-06 (Fri): 下周三起在上海出差
```

放不下时最后一行是 ``- and 3 more, past the 2000 characters this section holds: `memo list` ``；没有备忘时整节不放。接在 In Hand 后面；没有 In Hand 时接在 Main Chat 那段后面；工作台、子任务、IM 的提示词不带它（测试 `memo_lines_are_main_chat_only_after_in_hand`）。

固定文字的字节预算（`core/src/managed_prompt.rs:2764`、`:2765`，量在最长的情形上，不留余量，`\r` 不计）：`MEMO_HEAD_BUDGET_BYTES = 322`（标题、As of 那句、「What you noted…」那句、带四位数的最后一行），`MEMO_LINE_BUDGET_BYTES = 63`（每条备忘正文以外的部分：id、日子、`until` 带星期）。条数不固定，所以是两个数；二十条一百字（四字节字符）时正文以外共 1,582 字节，正好等于 322 + 20 × 63，两个数各减 1 都会红（核过）。这些文字是 `\n` 转义的普通字符串，不是原始字符串，Windows 的 CRLF 检出不改它，所以没有照静态预算加 18；测试照现有预算测试过滤 `\r`。

**4. 巡看**

新判据：原来的待办判据（`review_has_something_to_look_at`，一字未改）成立，或窗口里有备忘，就醒；都没有照旧跳过。窗口是 `MemoReviewWindow::before(last_review_at, now, tz)`（传入上一次巡看的 `last_fired_at`、现在与时区；`core/src/api/memo.rs:316`，纯函数，时区传进来，单测用上海与洛杉矶，含 11-01 洛杉矶换夏令时那天）：从上一次巡看那天的本地 0 点到今天本地 0 点（今天不含），从没巡看过就从昨天 0 点起；一条备忘算进来要 `fresh_at` 在窗口里、在巡看那天还没过期、还在（`takes`，`:369`）。`fire_review` 那段的 diff 原样：

```diff
@@ -454,5 +471,5 @@ pub async fn fire_review<Tz: TimeZone>(
     // builds it in this machine's.
     let today = at.with_timezone(&Local).date_naive();
-    let worth_a_look = match crate::assistant_todo::assistant_todo(galley, runners, at).await {
+    let todo_says = match crate::assistant_todo::assistant_todo(galley, runners, at).await {
         Ok(todo) => todo.review_has_something_to_look_at(today),
         Err(e) => {
@@ -464,5 +481,21 @@ pub async fn fire_review<Tz: TimeZone>(
         }
     };
-    if worth_a_look {
+    // Ticket 95: the memos new since the review before this one, read in
+    // the zone the to-do list reads its days in.
+    let window = MemoReviewWindow::before(task.last_fired_at.as_deref(), at, &Local);
+    let memos_say = match galley.review_memos(&window).await {
+        Ok(memos) => !memos.is_empty(),
+        Err(e) => {
+            eprintln!(
+                "[scheduler] review {}: reading the memos failed, waking it: {e:?}",
+                task.id
+            );
+            true
+        }
+    };
+    if todo_says || memos_say {
+        // Kept before the fire is stamped: a wake read from the pending
+        // fire right after it then finds its window.
+        keep_review_memo_window(galley, task.id.as_str(), &fired_at, &window).await;
         if !fire_reminder(galley, notifier, task, due_at, now).await {
             return ReviewFire::Failed;
@@ -486,7 +519,8 @@ pub async fn fire_review<Tz: TimeZone>(
             eprintln!(
                 "[scheduler] review {}: nothing to look at (no to-do any time or due within \
-                 {} days, no unfinished subtask), skipped",
+                 {} days, no unfinished subtask, no new memo since {}), skipped",
                 task.id,
-                crate::assistant_todo::REVIEW_LOOKAHEAD_DAYS
+                crate::assistant_todo::REVIEW_LOOKAHEAD_DAYS,
+                window.since
             );
             notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
```

窗口为什么要存：叫醒说明不在 `fire_review` 里写，而是之后由 `restore_pending_reminders` 从库里读挂起的那次触发再组出来（重启后也是这样），那时 `last_fired_at` 已经被这次触发覆盖，上一次巡看的时刻读不到了。所以在盖戳之前把窗口存进 pref `assistant_review_memo_window`（`{taskId, firedAt, window}`；`core/src/scheduler.rs:171`，`keep_review_memo_window` 在 `:548`），组叫醒说明时 `review_wake_memos`（`:570`）对上 `taskId` 与 `firedAt` 才读，读的是那时库里还在、还在窗口里的备忘。手动跑（`schedule run`，`run_now`）照同样的算法存窗口，所以同一天再跑一次窗口为空，叫醒说明里没有这一段（测试 `run_by_hand_the_review_names_its_own_window_and_again_today_none`）。

叫醒说明里加的那段（`core/src/subtask_report.rs:518` 的 `review_memos_paragraph`，空一行接在原来那段的 `<no-reply/>.` 后面；没有备忘时是空串，原文一字不变，单测比对了逐字节相等），原样（样例数据）：

```text
Memos noted or changed since the last review, in turns the user started:
- `memo_1a2b3c4d5e6f7a8b`: 看他这周常问 76 人 的比赛
- `memo_4d5e6f7a8b9c0d1e`: 想学吉他
For each, ask whether there is something you could get done for the user that they would want to know, as "The morning review" in `wake.md` says; most need nothing.
```

跳过时的日志新措辞：`[scheduler] review {id}: nothing to look at (no to-do any time or due within 3 days, no unfinished subtask, no new memo since 2026-10-25), skipped`（日子是窗口的起点）。读备忘失败照读待办失败的做法醒，日志 `[scheduler] review {id}: reading the memos failed, waking it: …`。`.scratch/assistant/closed-loop-snapshot.py` 只改了文件头说明跳过原因的那句，没加逻辑。

**5. CLI**（测试数据：临时写了一个测试跑真二进制与 Core 的路由、抓下输出，抓完删了那个文件）：

```text
$ galley memo add "下周三起在上海出差" --until=2026-11-06 --supervisor=galley-assistant --reason="user mentioned it"
{"memo":{"id":"memo_325a1ec63dd25387","text":"下周三起在上海出差","until":"2026-11-06","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdAt":"2026-10-26T08:49:34+00:00","updatedAt":"2026-10-26T08:49:34+00:00"}}
$ galley memo list
{"id":"memo_325a1ec63dd25387","text":"下周三起在上海出差","until":"2026-11-06","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdAt":"2026-10-26T08:49:34+00:00","updatedAt":"2026-10-26T08:49:34+00:00"}
{"id":"memo_972777208dfcdbdf","text":"不吃香菜","origin":{"via":"supervisor","supervisor":"galley-assistant"},"createdAt":"2026-10-26T08:49:35+00:00","updatedAt":"2026-10-26T08:49:35+00:00"}
$ galley memo update memo_325a1ec63dd25387 --text=下周三起在上海出差，住静安 --no-until --supervisor=galley-assistant
{"memo":{"id":"memo_325a1ec63dd25387","text":"下周三起在上海出差，住静安","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdAt":"2026-10-26T08:49:34+00:00","updatedAt":"2026-10-26T08:49:35+00:00"}}
$ galley memo delete memo_325a1ec63dd25387 --supervisor=galley-assistant --reason="trip cancelled"
{"memo":{"id":"memo_325a1ec63dd25387","text":"下周三起在上海出差，住静安","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdAt":"2026-10-26T08:49:34+00:00","updatedAt":"2026-10-26T08:49:35+00:00"}}
$ galley memo delete memo_325a1ec63dd25387                # 退出码 3
{"error":"not_found","message":"memo memo_325a1ec63dd25387 not found"}
$ galley memo add "（101 个 🏀）"                          # 退出码 2
{"error":"invalid_args","message":"create_memo: a memo is 1 to 100 characters once trimmed; this one is 101"}
$ galley memo add x --until=2026-10-25                    # 退出码 2
{"error":"invalid_args","message":"time_in_past: create_memo: until 2026-10-25 is before today (2026-10-26)"}
$ galley memo add "工作日 9 点到公司" --supervisor=galley-assistant   # 之前已有 2,002 字，退出码 0
{"memo":{"id":"memo_bb4effc4bcbf1cd3","text":"工作日 9 点到公司","origin":{"via":"supervisor","supervisor":"galley-assistant"},"createdAt":"2026-10-26T08:49:35+00:00","updatedAt":"2026-10-26T08:49:35+00:00"},"overLimit":{"chars":2012,"limit":2000,"over":12,"message":"Memos now total 2012 characters, 12 over the 2000 the start of each segment holds, so the last ones noted will be left out of it: merge memos or delete the ones out of date first."}}
```

这几例不在主对话的一轮里写，所以没有 `createdIn`；在一轮里写时带 `"createdIn":{"sessionId":…}`，运行结束填上 `turnIndex`。超限那句原样：`Memos now total {chars} characters, {over} over the 2000 the start of each segment holds, so the last ones noted will be left out of it: merge memos or delete the ones out of date first.` CLI 只往 stdout 写 JSON（`cli/src/main.rs` 的输出纪律），所以「人读的那一句」放在 `overLimit.message` 里。退出码与类别照现有：参数错误 `2 invalid_args`，找不到 `3 not_found`，没有 Core 时写命令 `4 db_unavailable`、`list` 照读（测试 `without_core_the_writes_exit_4_and_the_list_still_reads`）。

**6. IPC**：Tauri 命令 `list_memos`（返回 `MemoItem[]`：没过期的、按记下的先后，每条带 `changedIn` = 最近一次在主对话某一轮里记或改的会话与 `turnIndex`）、`list_memo_events`（返回 `MemoEventItem[]`：主对话里每一次记、改、删，含 `action`、动作后的正文（删除时为删前）、`memoId`、`turnIndex`、`memoExists`；外置运行时或还没有主对话时为空，同 `list_noted_todos`）、`delete_memo(id)`（返回删前的 `MemoBrief`，记为 `gui`，事件照记一行 delete），放在 `core/src/commands/schedule.rs` 待办那组后面，`core/src/lib.rs` 注册。事件 `memos:changed`（写命令、桌面删除、运行结束填轮次、重置都发）。`gui/src/types/ipc.ts` 新增：`MEMOS_CHANGED_EVENT`、`MemoBrief`、`MemoItem`、`MemoAction`、`MemoEventItem`。

**7. 文档**：新增 `docs/agent-api/memo-commands.md`（§5.35–§5.39）；`docs/agent-api/README.md` 的表、`docs/agent-api.md` 的节表各加一行；`docs/agent-api/stability-and-versioning.md`（`time_in_past:`、`assistant_unavailable:` 两个前缀补上 memo，§7.1 加 2026-10-26 一条）；`docs/architecture.md` 事件表加 `memos:changed`；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（「The morning review」的判据补上新备忘、窗口与 pref，新增「The User's Memos」一小节）；`docs/managed-ga-runtime/prompt-composition.md`（开头一段、新增「Memo (main chat only)」、条款台账一行）。devlog、PRD、`docs/project-status.md` 没动。

**8. 验证**（都跑过，看到输出）：

- `cargo check --manifest-path core/Cargo.toml --workspace`：通过（只有 `galley-relay` 原有的一条 deprecated 警告）。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各跑一遍，三遍都是 47 组结果、1252 条通过、0 失败。新测试：`core/tests/memo_test.rs` 9 条、`cli/tests/memo_test.rs` 5 条、`core/tests/schedule_wake_test.rs` 加 4 条、`core/tests/main_chat_reset_test.rs` 加 1 条，单元测试 `api::memo` 7 条、`managed_prompt` 4 条、`subtask_report` 1 条、`protocol::commands` 1 条。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：通过；`prettier --check gui/src/types/ipc.ts`：通过。
- `node scripts/check-ipc-protocol-drift.mjs`、`check-supervisor-sop-drift.mjs`、`check-docs-links.mjs`（478 个文件）、`check-version-consistency.mjs`、`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs`：都通过。
- rustfmt：新文件与原本就 rustfmt 干净的文件整篇 `rustfmt`；原本不干净的（`core/src/protocol/mod.rs`、`core/src/scheduler.rs` 等）只核了自己加的行（scratchpad 里一个脚本：带 `mod` 子模块打桩格式化一份副本，只报落在本分支新增行上的差异），结果全部没有差异。没跑 `cargo fmt --all`。
- `git diff --check`（含暂存后 `git diff --cached --check`）：干净。新增行查过本机路径、会话 id、私有接口地址、真实个人信息：没有（样例里原先写了你的真实背景，改成了虚构的「小林」）。新增中文是代码注释里引用的界面原文与测试数据，文档里的中文样例用全角标点。

**9. 我自己定的细节**

- 列名沿用票面的 `fresh_at`；`memo_events` 比票面多记 `until_date`（动作后的期限）与 `origin_note`（`--reason`），`id` 是自增整数，卡片按它排先后。
- 写命令一律要内置运行时且有主对话（`assistant_unavailable:`），读照常答，同待办。`--until` 早于今天用现成的稳定前缀 `time_in_past:`（多一处用法，没加类别），前缀表已补；格式不对是普通的 `invalid_args`。
- 过期的行留着、不自动删；`memo update` 与 `memo delete` 对它照常可用，给一个更晚的期限它就回来。没想到更好的做法，照票面的倾向。
- 运行结束填 `turn_index` 时备忘的 `updated_at` 不动（待办那边会动）：段首与面板显示的「最近一次记或改的日子」读它，填轮次不算改动。
- 同一秒记下的几条按写入顺序排（`ORDER BY created_at, rowid`；待办用 `id`，是随机的，不代表先后）。
- 段首一节放到第一条放不下的为止，后面即使有更短的也不再放；正文里的换行折成空格、整句不截；日子用 `updated_at` 的本地日子，期限带星期。
- 面板的 `changedIn` 取最近一次带会话的 add 或 update；之后若有一次不在一轮里的改动，仍指向上一次在对话里的那句话。`list_memos` 不按运行时拦（同 `list_assistant_todo`），`list_memo_events` 拦（同 `list_noted_todos`）。
- 巡看窗口存在 pref 里（理由见第 4 条）；读备忘失败也醒；手动跑巡看照旧不过判据（现在手动跑本来就直接醒），只是带上自己的窗口。
- 没有 `memo show`：CLI 的命令族没有「必须有 show」的惯例（`schedule`、`todo` 有，`llm` 没有），一条只有一句，`list` 已整句打出。
- 「今天」由 Core 按本机时区读（`SqliteGalley::memos_today`），CLI 二进制不必依赖 chrono。

**看到但没改的**

- `gui/src/types/ipc.ts` 是 runner IPC 协议的镜像（`check-ipc-protocol-drift.mjs` 读它），待办的 Tauri 类型在 `gui/src/lib/assistant-todo.ts`。照票面写进了 `ipc.ts`，单独一节、不带 `kind` 字段（漂移检查只读带 `kind` 的接口，跑过没受影响）；票 97 可能想把它们挪到 `lib/` 下，和调用放在一起。
- 重置主对话的确认文案（`gui/src/i18n/locales/zh.ts` 的 `resetMainChat.deletes`）列了聊天记录、待办、长期记忆、备份，没有备忘；`dialogBody` 里「它记住的关于你的事」原指 GA 记忆。票 97 补一行，建议「备忘里它记下的关于你的事」。
- 「你发起的轮次」照票面写成「开头的用户行不是 `system`」，所以别的 agent 用 `session send` 写进主对话开的一轮（`cli`、`supervisor`）也算；要更严得改成只认 `gui`，没改。
- 段首一节没有条数上限：正文以外每条 63 字节。模型若记很多很短的（比如 300 条各 6 字，合计 1,800 字，不超限），正文以外就有约 19 KB。裁决 141 第 7 条两周后的回看（条数、总字数、段首占比）可以顺带看这一项。
- `assistant_unavailable:` 的消息沿用 `ensure_assistant_available` 的「target assistant needs …」措辞，用在备忘上读着别扭，待办也一样。
- 过期的行只在重置时清掉，平时没有任何读者看得到。
- `memos.created_in_session_id` 与 `memo_events.session_id` 外键是 `ON DELETE SET NULL`，同待办：将来若有迁移重建 `sessions`，会把卡片的锚点置空（050 的注释说过这个风险）。
- 入口层与手册（票 96）还没提备忘：本票合入而票 96 未合时，段首会出现备忘一节（有备忘时），告诉它用 `galley memo` 的只有那一节的首句；巡看叫醒说明指向的 `wake.md`「The morning review」也还没有备忘那段。

**没验证到的**

- 没跑 `tauri dev`（按要求）：`runner_commands::prepare_managed_spawn_args` 里读备忘、拼进提示词那几行只过了编译，没有测试覆盖（要 Tauri app），拼接本身有单测；三个 Tauri 命令同样只过了编译，底下的库函数有集成测试。
- Windows（CRLF 检出）与 CI 没跑；新文字都是转义字符串，按理不受影响。
- 真模型怎么用段首一节、怎么回应叫醒说明里的新段落：没跑评测（票 96 的事）。
- `closed-loop-snapshot.py` 只改了文件头说明，只做了语法解析，没对库跑。
- GUI 的 vitest 没跑（只加了类型与一个常量；`typecheck`、`lint` 过了）。
