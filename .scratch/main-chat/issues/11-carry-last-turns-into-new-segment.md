# 11 新段带上段首之前的最近几轮

Status: done（2026-10-19 JC：日常使用里隔几个小时后前几轮原话都在；dev 日志 `[segment s-mvbu2ofu-vgao8ozm] idle since 2026-10-18T02:00:50+00:00: new segment from turn 6`、`load_history (6 messages, opening with 3 turns carried over)`。`b9c1eef8`、`4435b4d7`、`db3954fe`，2026-10-13 已推送；真机复现待 JC 在 dev 试用中遇到自然切段时看，不写隐藏设置）

来源：主聊天 PRD 裁决 50（2026-10-13，JC 按建议推进）。deferred「主对话的跨段连续性」第 1 级，不等两周信号提前做。

## 为什么

主对话空闲超过 4 小时，下一条消息开新段（03a，`core/src/session_runner/segment.rs`），新 runner 只拿到本段（`core/src/session_runner/replay.rs:234`）。
用户发一条，4 小时后接着发，助理已经不记得上一次说了什么；界面上那几句还在眼前。JC：「这体验非常不好」。
事项账本撤掉（裁决 49）之后，段首没有任何东西垫着，这一条要先补上。

## 规则（确定式，Core 内，不加模型调用）

- **只在主对话、只在新段**：主对话有段界（`main_chat_segment_start` 不为 `None`）时，回放在本段之前带上**段首之前最近 3 轮**。第一段（没有段界）照旧从头回放；其他会话、外置运行时零变化。
- **一轮**：同一 `turn_index` 的用户消息与它的回复（`rows_to_conversation_messages` 认的 `user` / `assistant` 行）。只算有用户消息、也有回复的完整轮；问候（`shown_only`，`turn_index -1`）不算、不带。
  取的是段首之前最近的 3 轮，不管它们在哪一段（上一段只有 1 轮，就再往前取）。
- **字数上限 6,000 字**（按 Unicode 字符计，带过去的部分合计）：超了从最早的一轮整轮丢。
  最近一轮单独就超限时：用户的话完整保留，回复只留结尾（最终答案在结尾），截掉处用明确的标记（如 `[…]`）让模型知道被截过；
  用户的话本身就超过上限的一半时，也截到一半，规则一样（回报你怎么定的）。
- **常量**：3 轮、6,000 字写成常量，不做 prefs、不进设置。
- **确定、可重放**：带哪几轮只由库里的行与段界算出，Core 重启、runner 变冷再回放，结果一样。建议回放与状态块共用一个算「带过去的窗口」的函数，免得两边对不上。

## 告诉模型

- 状态块的「## Main Chat」一节（`core/src/managed_prompt.rs` `main_chat_section`，`segment.rs` 的 `MainChatPromptState`）补一句：
  上下文开头那几轮来自上一段，最后一条是什么时候说的（本地时间，精确到分钟），中间隔了一段时间。不然用户 5 小时前说的「我出门了」会被当成刚说的。
- 没有带过去的轮（第一段，或段首之前没有完整轮）时，这一句不出现。
- 「Earlier parts are not in your context」的说法跟着改准：更早的部分仍要查历史。
- `MAIN_CHAT_SECTION_BUDGET_BYTES` 跟着调，测试里写清新的最长取值与理由（这一节每次请求都带）；字节数去掉 `\r` 计（Windows CI 检出是 CRLF）。

## 文档

- `docs/managed-ga-runtime/runtime-modes-and-sessions.md`「main chat segments」一节（回放只给当前段那条）。
- `docs/managed-ga-runtime/prompt-composition.md`「Main Chat」一节的原文块。
- `docs/architecture.md:138-144` 如有说法对不上就改。
- 不改：devlog、票 03、PRD 的历史裁决、`docs/devlog/deferred.md`（主会话结票时改）。

## 验收

- 新测试覆盖：第一段不带；新段带最近 3 轮；上一段不足 3 轮时往前取；问候不带；未完成的轮（只有用户消息）不带；整轮丢弃与最近一轮截尾；重放结果一致；状态块那一句有 / 无两种情况。
- 用 03a 的真机办法能复现（PRD 票 03 第 101 行：把 `main_chat_segment_idle_hours` 设成 `0.01`，发一句、等 36 秒再发，问「我们刚才聊了什么」），这次应接得上。这一步在合入后由主会话做，子代理只写清步骤。
- `cargo test --manifest-path core/Cargo.toml --workspace`，并在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍（状态块里有本地时间）。
- 六个门禁脚本：`node scripts/check-{ipc-protocol-drift,supervisor-sop-drift,docs-links,version-consistency,managed-ga-payload,ga-baseline-drift}.mjs`；`git diff --check`。
- 只对自己动过的文件跑 `rustfmt`（core 不是 rustfmt-clean）。

## Comments

2026-10-13 实现回报（Opus 子代理，`b9c1eef8`，基于 `282c0f9b`）：
- 新模块 `core/src/session_runner/carry.rs`：纯函数 `CarriedWindow::from_rows` 从段界之前的行里取最近 3 个完整轮次并按 6,000 字封顶；`carry::read` 是回放与状态块共用的唯一入口，先用新的 `main_chat_carry_from`（`core/src/db/main_chat.rs`，带 `LIMIT` 的有界查询）找出要读的最早一轮，再一次读出这几轮加当前段，在段界处切开。
  只看库里的行与段界，不看时钟、不读 prefs，所以 Core 重启后回放一样（有测试）。常量 `CARRY_TURNS = 3`、`CARRY_MAX_CHARS = 6_000`，不进 prefs。
- 一轮：同一 `turn_index` 的用户消息与回复，沿用回放自己的规则（`rows_to_conversation_messages` 拆出 `continue_conversation` 共用，黄金用例不变）：多条回复行用空行合并，用户消息的图片照带、不计字数。
  问候、没等到回复的消息、其他角色的行都不算；上一段不足 3 轮就往更早的段取。
- 封顶：超了从最早一轮整轮丢；只剩最近一轮还超限时，用户的话与回复各保底一半（3,000 字），一方用不完的让给另一方，合计正好 6,000 字。
  回复截掉开头、留结尾；用户的话要截时留头尾、截中间：长消息多是「帮我看看：<粘贴>」或「<粘贴>这是什么意思？」，请求在两头（GA 截旧工具输出也是留头尾，`llmcore.py` `compress_history_tags`）。截掉处写 `[… cut for length …]`。
  与票面字面的差别：字面是「用户的话超过一半就截到一半」，回复很短时会白白空出几千字；改成「各保底一半、用不完的让出」，回复不短于一半时结果与字面相同。
- 回放：主聊天有段界时，段内有回复或段界之前有完整轮次就回放（`has_history`）。所以空闲后打开主聊天、发第一句之前，新 runner 已经拿到带过去的几轮（原来新段没回复时不回放）；第一段、旁聊、外置都走原路。
  日志：`load_history (N messages, opening with K turns carried over) into pid …`。
- 状态块「## Main Chat」：有带过去的轮时换一段文字，没有时与 03b 逐字节相同。时间取最后一轮回复行的 `created_at`，按本地时区到分钟。3 轮时的原文：

  ```text
  This conversation is the user's main chat, session `s-mgn4k2x1-7q3z9w0e`. Your context
  holds it from turnIndex 42 on, a segment that began 2026-10-12, and opens
  with 3 exchanges from before it, the last said 2026-10-12 09:41: time has passed
  since. Anything older is not in your context: when the user refers to it,
  look it up with the Galley CLI (search, then
  `session show <id> --around=<messageId>`).
  ```

  1 轮时是「1 exchange」。`MAIN_CHAT_SECTION_BUDGET_BYTES` 327 → 421（+94 字节），按最长取值量（19 位会话 id、六位轮次、3 轮），不留余量，不计 `\r`，理由写在测试注释里，条款台账加了一行。
- 文档：`runtime-modes-and-sessions.md`（main chat segments 加一条、改两条）、`prompt-composition.md`（第二个原文块、Facts、Bounded、条款台账、回归清单第 18 条改写、新增第 20 条）、`architecture.md`、`ipc-protocol.md` §7 主聊天那条。
- 测试：`carry.rs` 单元 7 个；`main_chat_segment_test.rs` 新增 6 个，改了 5 个已有的（新段现在会回放带过去的轮）；`managed_prompt.rs` 新增 1 个，预算测试改量带轮的那段。
  Rust 全量在默认时区、`TZ=UTC`、`TZ=America/Los_Angeles` 下各 924 个通过；六个门禁、`git diff --check`、改过文件的 `rustfmt --check` 都通过。
- 没动 `core/src/db/session.rs`（票 12 在改），因此：
  - 状态块那次读也把当前段的行一起读出再丢掉，紧接着的回放还会再读一遍；本段很长时 spawn 多一次读。
  - `persisted_message_rows_from` 的文档注释「which is all its runner is given back」已经不准，合入时顺手改。
- 待定 / 留意：
  - 带过去的轮里有截图时图片照带（与回放一致），首轮输入会多几张图。
  - 「the last said」取回复落库时间（`turn_end` 时写），不是用户发消息的时间；一轮跑得很久时两者差得多。
  - 截断标记是英文，中文对话里也用它。
  - 段界之前只有没回复的消息时，不回放，状态块也不加这句（有测试）。
- 真机验法（合入后主会话做）：
  1. 合入后重启 `pnpm --dir gui tauri dev`（Core 是 Rust，不热更）。
  2. 设 prefs：`sqlite3 "$HOME/Library/Application Support/app.galley/workbench.db" "INSERT INTO prefs (key, value, updated_at) VALUES ('main_chat_segment_idle_hours', '0.01', strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;"`（36 秒，每次判断时读，不用重启）。
  3. 主聊天里发「我出门了，晚点回来再说那个报价」，等它回完；可以再聊一两轮。
  4. 等 36 秒以上，发「我们刚才聊了什么？」。日志应先有 `[segment …] idle since …: new segment from turn N; retired runner pid …`，再有 `load_history (… messages, opening with K turns carried over)`；模型不用搜索就答得上，也不把「我出门了」当成刚说的。
  5. 再问「你的上下文从哪开始？最前面那几轮是什么时候说的？」，应答出本段起点与最后一轮的时间（到分钟）。
  6. `SELECT * FROM main_chat_segments;` 看段界；重启 dev 后再发一句，`load_history` 仍以同样的 K 轮开头。
  7. 还原：`DELETE FROM prefs WHERE key = 'main_chat_segment_idle_hours';`。
