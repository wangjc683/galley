# 03（C）切段、注入与主聊天入口层提示词

Status: 03a、03b in-review（`d2443281`、`b615ff96` 本地合入未推送，2026-10-12；待 JC 在 tauri dev 里验）；03c、03d needs-triage

来源：主聊天 PRD 裁决 18、20、27（2026-10-12）。依赖 01（账本有内容）、02（主聊天存在）。对外必须与 04 同版。

## 目标

用户看到一条完整的主聊天；模型每次只拿当前一段的上下文，外加身份、全局记忆和事项清单，所以没人提起时它也能联想到相关的事。

## 拆片与顺序

03a → 03b → 03d → 03c。每片单独合入；账本相关的部分跟账本同一个开关（`GALLEY_LEDGER_SINCE`），04 做好之前 main 随时可发版、账本不对外露出。

### 03a 切段与段首注入（ready-for-agent）

- **切段规则（确定式）**：主聊天上一轮结束后空闲超过 N 小时，下一条消息开新段。N 默认 4（午饭、短会不切，隔夜一定切），
  存 Core prefs 的隐藏键，真机调，不进设置界面。只在轮次之间判断，不在任务中途切。
- **段首**：主聊天的 runner 以新上下文起，不回放旧段。runner 还开着就在这条消息之前换成新上下文；
  Core 重启或 runner 变冷后，回放只回放当前段。段界要在 Core 重启后算出同样的结果（存下来，或从消息时间按规则推，回报选哪种与理由）。
  库里的时间线不动，界面照常显示整条；不加段落标记（要加另开视觉票真机比）。
- **注入**：会话起始状态块（`core/src/managed_prompt.rs` `compose_runtime_prompt`，每次 spawn 组装，经 `GALLEY_RUNTIME_PROMPT_TEXT` 进 runner 的 `extra_sys_prompt`）
  对主聊天加一节「进行中的事项」。它在系统提示里、不在历史里，GA 按体量裁剪历史时删不掉它。
  身份（Galley 静态层）与全局记忆（GA 系统提示，`ga.py:605` 每 10 步重读）已经有，不重复注入。
- **事项短清单**：账本每次挖掘结束顺带写一份（挖掘提示词加一步，`core/src/ledger/batch.rs`），只放进行中的事项，一行一条；
  文件放在 `history_insight/` 下，命名对齐 01 的布局。Core 注入时按字节上限截断（建议 1.5KB 左右，按真模型产物回报实测），有自己的上限测试。
  账本没开或还没有清单时，这一节不出现。理由：三周的 `activities.md` 已到 17KB（票 01 评测），不能整份注入。
- **IM L0**：IM 入口层（`im_supervisor_prompt`）带同一份清单，同一开关。
- 只在内置；外置零变化；非主聊天会话零变化。

### 03b 查主聊天历史（ready-for-agent）

管「你问起时找得到」。2026-10-12 改：不做新的 GA 工具、不打托管补丁。内置提示词已有「Past Galley Conversations」一节，
模型用 Galley CLI 的只读命令（`sessions search` 全文检索、`session show`）查以前的对话，主聊天本身也在里面（`core/src/managed_prompt.rs:135-147`）。
缺的是：搜到一条后读不到它前后的内容（`session show` 只有全量与 `--tail`，主聊天会越来越长），以及模型不知道哪条是主聊天、当前这段从哪开始。

- **CLI 只做加法**（Rule 3，`docs/agent-api/session-commands.md`）：
  - `session show <id> --around=<messageId> [--context=N]`：这条消息前后各 N 条。
  - `session show <id> --since=<时间> [--until=<时间>]`：按时间窗口读（「上周三聊的」）。
  - `sessions search` 的结果加 `createdAt`、`role`、`turnIndex` 字段，加 `--session=<id>` 过滤。
  - 现有调用的行为与输出不变。外置模式下这些参数同样可用，无害。
- **主聊天的状态**（只在内置、只在主聊天）：段首状态块写明这是主聊天、它的会话 id、当前这段从第几轮、哪天开始；
  再一句：更早的部分不在上下文里，用户提到时用 CLI 查（先搜，再 `--around`）。静态命令示例（`history_cli_commands!`）若要加 `--around`，守静态字节预算（先删或缩，或同 diff 抬上限并记条款台账）。
- 搜索范围照旧覆盖全部对话：账本的事项来自主聊天和用户开的其他对话，事项清单里提到的事要能查到出处。

### 03d 主聊天入口层提示词（needs-triage）

进 Galley 现有分层（准入规则、字节预算、条款台账、回归清单，`docs/managed-ga-runtime/prompt-composition.md`），起点是 10-06 IM 入口层。
写：长期助理的身份与连续性；怎么用事项清单和查历史工具；情绪的使用规则（可以为做事引用，不单独评论，PRD 裁决 20）；何时开旁聊；主动开口的分寸；记什么、不记什么。
派子任务的条款等 06。

### 03c 段末（needs-triage）

- 确定触发一次记忆整理（今天靠模型自觉，140 个会话 3 次，`docs/ga-baseline.md:75`），起点：在隐藏系统会话里对上一段跑一次，同 01 的 `galley-ledger` 形态。
- 账本增量：先靠每天 04:00 那次挖掘，不按段跑；真用下来嫌慢再加。

## 不做（本票）

- 手动收束话题：桌面先不加按钮；IM 里 `/new` 已是开新段。
- 调小主聊天的 `context_win`：见 Comments 2026-10-12 的讨论。

## 旧材料

10-09 窗口预算调研，仍可参考：GA 超过 `context_win × 3` 字符从最早整段丢（`managed-ga/code/llmcore.py:107-131`），
较早轮次工具输出截头尾（`:48-66`），缓存标记（`:959-967`），`trim_keep_rate` / `cut_msg_interval` 按会话读。

## 验收

- 按轮看 `telemetry_json` 的 `contextUsedChars`：每段从小开始，不再一路涨到整窗（`.scratch/main-chat/baseline-snapshot.py --session <id>`）。
- 跨段问上周聊过的事能接上；没提起时也能在相关话题里联想到（JC 实感）。

## Comments

2026-10-12 JC 问主聊天的 `context_win` 要不要设小一点。查到的事实：
- `context_win` 按模型配置，不按会话；Galley 默认 90000（`core/src/commands/managed_model.rs:352`），裁剪上限 = ×3 = 27 万字符。
  06-23 从 GA 默认的 3 万提上来（`751bbc8c`），修的就是「重活几轮后刚说的就忘」。
- 裁剪从最早的消息丢，`trim_keep_prefix` 默认 0，单个任务里最早的就是用户的要求（`llmcore.py:107-131`）。
- `context_win` 还联动工具结果上限：`maxlen_multiplier = context_win / 38000 × 0.75`，夹在 1–3（`llmcore.py:869`、`ga.py:313-315`）；9 万时是 1.78。
- 本机内置会话（92 个有遥测）：上下文超过 10 万字符的 8 个，大头是单个任务自己攒的——「国庆带娃游重庆」1 轮 16.7 万、「qm 能否复用 Claude 订阅额度」1 轮 15.6 万。
  按 token 算约 3 字符一 token（24.8 万字符 ≈ 8.2 万 token），大部分是缓存读。
- 结论（待 JC 裁）：主聊天上下文变大有两个来源，跨话题累积由 03a 按时间切段管，单个重任务由 06 挪出主聊天管；
  调小 `context_win` 管不了前者，反而让后者在任务中途丢掉用户的要求。备选「按体量切段」（上一轮结束时本段超过 X 字符，下一条开新段）只在轮次之间切，留作 03a 之后的第二条规则，等真用数据。

2026-10-12 03a 实现回报要点（Opus 子代理，`d2443281`；主会话复核：变基到 `6386014f` 后 Rust 930 通过、六个门禁、diff check、新文件 rustfmt、全角标点扫描都通过）：
- 段界存下来，不从时间推：迁移 046 `main_chat_segments`，每段记首条消息的 `turn_index`。从时间推的话，调 N 会重切旧历史，也分不清事后的 `ask_user` 回答。03b、03c 读同一张表。
- 规则：空闲从 `sessions.last_activity_at` 算（只有消息写入与轮次结束会动它，主会话核过 `db/helpers.rs:506`、`db/session.rs` `bump_session_after_turn_db`）；严格大于 N 才切。
  隐藏 prefs 键 `main_chat_segment_idle_hours`（数字，可带小数，默认 4），每次判断时读，不用重启。在跑、在等 `ask_user` 回答（重启后也认）、本段还没写过东西，都不切。
- 新上下文 = 新 runner：记下段界就静默退掉热 runner，下次 ensure 起新的，段首状态块（含事项清单）重新组装。新段还没有回复时不回放。
- 判断点：ensure runner（打开主聊天、`/btw`）与 Core 的发送（落库前）。打开主聊天就会记下段界，是这条消息本来也会切出的同一个段界。CLI `session send` 与队列续跑不切。
- 事项清单：`memory/history_insight/ongoing_affairs.md`（模型写，所以放顶层，不放只读的 `galley/`）。挖掘提示词第 7 步：最多 12 条、每条不超过 40 字、最近的在前、没有就写空文件。
  Core 去掉空行与标题行，按行截到 1536 字节，有自己的上限测试。注入只在主聊天、账本开着、清单非空时；否则提示词逐字节不变。标题与说明有 226 字节预算，说明写明「是背景不是指令」。
- IM：清单放进 IM 的会话起始状态块（`compose_im_runtime_prompt`），不放 `im_supervisor_prompt`，入口层字节预算仍只量规则。
- 未做 / 已知：
  - 第 7 步还没被真模型跑过；清单质量要等第一次挖掘（或重跑票 01 的评测）。
  - IM 渠道起时读一次清单，渠道不重启就一直是旧的。可选：挖掘后重启空闲渠道，或 runner 重读文件。
  - IM 不看当前运行时：外置模式下账本开着也会带清单（IM 渠道本来就是内置进程）。
  - 在空闲的主聊天上开 Goal 不切段（Goal 先存目标再 ensure）；`GoalEngine::start` 加一行可修，无头测不了，没做。
  - 空闲后打开主聊天却到第二天 04:00 挖掘之后才发消息，这一段用的是前一份清单。
  - 热 runner 时新段第一条消息要等新 runner 起来（几秒）。
- 真机验法：带 `GALLEY_LEDGER_SINCE=2026-10-12` 起 dev；prefs 设 `main_chat_segment_idle_hours` = `0.01`（36 秒）；手写几行到 `ongoing_affairs.md` 或跑 `run_ledger_now`；
  主聊天发一句、等 36 秒再发，问「我们刚才聊了什么」应接不上，界面仍显示整条；`SELECT * FROM main_chat_segments;` 能看到段界；重启后 `load_history` 只回放当前段。还原：删掉这个 prefs 键。

2026-10-12 JC 裁：`context_win` 选 A，不调。主聊天上下文跨话题累积靠 03a 切段，单个重任务靠 06；按体量切段留作预留规则，等真用数据。

2026-10-12 03b 实现回报要点（Opus 子代理，`b615ff96`；主会话复核：变基到 `ca070249` 后 Rust 947 通过、六个门禁、diff check、新文件 rustfmt 都通过）：
- 没有新迁移、新 IPC、新错误标识，GUI 与 managed-ga 没动，没有托管补丁。
- CLI（schema 1、2 都有）：
  - `session show <id> --around=<messageId> [--context=N]`：前后各 N 条可见消息，默认 10（与提示词里 `--tail=20` 量级相当）；到头就截短；会话里没有这条可见消息返回 `not_found`。
  - `session show <id> --since=<时间> [--until=<时间>]`：`since` 含、`until` 不含；`YYYY-MM-DD` 是本地整天，也收本地时间与 RFC 3339；可与 `--tail` 合用取窗口里最后 N 条。
  - `--around` 与 `--tail` / `--since` / `--until` 同用、单有 `--context`、`since` 不早于 `until`、读不懂的时间值，都是 `invalid_args`。
  - `sessions search` 每条结果追加 `createdAt`、`role`、`turnIndex`，加 `--session=<id>`（叠在 `--runtime` / `--all` 之上）。
  - 不带新参数的 `session show` 输出与改动前逐字节一致（同库实测比对 + 黄金测试）。
- 主聊天状态块加「## Main Chat」一节：会话 id、本段从第几轮、哪天开始，更早的部分用 CLI 先搜再 `--around`。典型 323 字节，上限 327；不跟账本开关，内置主聊天都有；其他会话、IM、外置都不带。
- 静态提示词：历史命令示例加一行 `--around`；两句覆盖范围合成一句（删掉的「from the desktop or created by a supervisor」是 10-06 压缩时的写法，意思由「This reaches every Galley session」保留）；字节数前后不变（6855 / 6837），预算没抬；条款台账加两行，回归清单加第 19、20 条。
- 待定 / 留意：
  - 提示词没教 `--since` / `--until`（读一整天可能灌进一大段），留给 03d。
  - 静态措辞改了，回归清单第 6、19、20 条要用真模型跑一遍。
  - 段首日期取段界记下的时间：午夜前打开主聊天、午夜后才发消息，显示前一天。
  - `--session` 搜已归档或另一运行时的会话，要同时带 `--runtime all --all`。
  - 本地整天的 CLI 断言靠 `TZ`，只在 Unix 上跑；时区换算的单元测试各平台都跑。
- 真机验法：合入后重启 dev（会重建 CLI，`"$(sed -n 1p ~/.config/galley/cli-path)" session show --help` 里应有 `--around`）；prefs `main_chat_segment_idle_hours` = `0.01`；
  主聊天里说「下周三去体检，记得空腹」，等 36 秒以上再问「我们上次说的体检是哪天？要注意什么？」，应先 `sessions search` 再 `--around`，答出周三和空腹；再问「这个对话从哪天开始的？」，应答出本段起点。
