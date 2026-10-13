# 去掉 Goal：说清目标交给模型，契约升 schemaVersion 3

Date: 2026-10-13
Status: 已实施，静态门禁全绿；待 JC 真机验收；unreleased（随主对话那次 minor 一起发）
Related: [票面](../../.scratch/remove-goal/PRD.md)、
[goal v2 重做](./2026-09-16-goal-v2-codex-shape.md)、
[定位：Less harness. More model.](./2026-09-09-positioning-less-harness-more-model.md)、
[去掉审批（先例）](./2026-10-05-remove-approval.md)、
[Agent API 稳定性 §7.1](../agent-api/stability-and-versioning.md)、
[deferred：长任务续跑](./deferred.md)

## 起因

JC 提出按「Less harness. More model.」完全去掉 Goal：模型够强，说清目标就能一直干下去，长任务能力越来越强。

agent 先挑了论证：「模型够强就会一直干」只覆盖「干完为止」一种用法。模型停下多半不是能力不够，而是三个
结构性原因——收口习惯（做完一段就汇报交还）、`ask_user`（人不在桌前就卡住）、GA 每次 `put_task` 180 步上限
（`managed-ga/code/agentmain.py:218`）——它们不随模型变强消失，所以从「模型变强」推不出「Goal 没用」。
但使用数据与定位撑得住「去掉」。

## 事实底座（只读 `workbench.db`）

- **续跑从未触发**：v2 上线四周，`goals` 表 5 行——3 行 09-16 当天 dogfood，2 行 10-09 / 10-10 借 Goal 做的
  暗号测试；`continuation_count` 全为 0。v1 三个月 0 条。
- **离步数上限很远**：478 个用户任务，单任务最多 52 步，≥80 步的 0 个。
- **强模型自己做完**：09-16「了解三星折叠屏」10 分钟上限，2 分半自判完成。
- **留着的形态不是 JC 要的**：主场景「离桌扔长任务 / 把 quota 用满」是「用满时间」，09-16 进了 deferred 没做；
  留着的「干完为止」恰好是强模型不需要的那种。
- **补偿型脚手架**：主对话 PRD 已立「补偿型脚手架不做」；续跑循环补的是「模型提早收口」。
- **上游有同类**：`reflect/goal_mode.py` + `memory/goal_mode_sop.md`（「用满预算」语义），TUI 有 `/goal`；
  它起独立进程，Galley 看不到也停不掉，所以只算「真要用时有路」。

## 裁决（JC「按建议推进」）

1. 全删。落选：只撤 GUI、留引擎与 CLI 给 Supervisor（重量几乎没减，契约照背）；不动、等 `use_budget`。
2. 契约升 `schemaVersion: 3`，goal 族在每个版本下 `unknown_command`，照 v2 退役 v1 goal 命令的先例。
3. deferred 的 `use_budget` 改写为回归路径：改 180 常量 → 接上游 `goal_mode` → 最后才自建循环。
4. 不单独发版，随主对话那次 minor（裁决 54 已压着）。
5. 不在内置提示词里拦「用 goal 模式干」：内置 GA 可能照 `goal_mode_sop.md` 自起后台进程，这在今天就可能发生。

实施时主会话改判一条：讨论时写的「新迁移 drop 掉 `goals` 表」改为**不加迁移**，照 10-05 去审批的先例
（旧表留着、不再读写；降级安全；用户状态不可替代；不碰迁移预检与六处手写迁移列表）。

重启信号：一个月内 ≥3 次长任务中途手动发「继续」，或社区有人要回 Goal。

## 做了什么

四张 Opus 票并行（Core+CLI+remote-protocol+iOS / GUI / runner+内置运行时 / 文档），全部在 scratchpad 的 worktree 里做
（JC 的 `tauri dev` 常驻主树），接口契约写死在 PRD；0 返工。集成验收主会话补了三处：叙述 callout 的文档与 GUI 改名
对齐、提示词字节上限下调、stability §7.2 的过时现在时加按语。

- **契约**：`SCHEMA_VERSION = 3`，接受 `{1, 2, 3}`；socket `goal.start / status / active / stop / extend` 与 v1 退役名
  在 1 / 2 / 3 下都回 `unknown_command`、不落库不派发；CLI 无 `goal` 子命令，`galley goal …` 走 clap 失败路径，
  `invalid_args` 信封、exit 2（不是 `schema_mismatch`）。`MessageBrief.goalId` 不再输出；`session.checkpoint` 删
  `goalId` 参数（旧调用方带上也被忽略）。新增四条契约回归测试钉住以上行为。
- **Core**：删 7 个文件（引擎、提示词、DB、API、Tauri 命令、socket 处理、CLI）。连带删掉只服务 Goal 的机制：
  `RunSignal::UserRunStarted`、`RunOutcome` 一族与转发器对 TurnStart / TurnEnd / Error 的记账、`try_reserve_run`、
  `ensure_runner_for_session`（票面误把它当成 `holds_run_gate` 的 socket 调用方；`holds_run_gate` 仍有子任务与
  Core send 两个真调用方，保留）、`send_*_for_goal`、`goal_commission_before`（分页起点因此从循环变成一次查找，
  与原逻辑等价）、goals 那组 10 个 trait 方法、启动时 `pause_open_goals`、无人使用的 `fs2` 依赖。钉通用不变量
  的 Goal 测试改走非 Goal 路径（如 `a_send_survives_the_quiet_restart_of_its_runner`、
  `a_send_on_a_cold_session_gets_its_history_before_the_message`、`internal_user_rows_never_open_a_page`）。
- **提示词**：输入框说明里的 Goal 一句、IM 入口层 CLI 写命令列表里的 `goal` 删掉；按「不留余量」把静态上限
  6855 → 6775、IM 上限 1383 → 1376，条款账记一行。
- **remote-protocol / iOS**（未发版）：删 `goal.updated` 事件、推送 `kind::GOAL`（剩 `reply_done` / `ask_user` /
  `schedule_failed`）、消息的 `goal_id`；golden 重新生成，只少 goal 的 23 行。
- **runner**：删 `turn_end.goalStatus` 的提取与剥离、IM reporter 的剥离。三边 IPC 对齐在 18 个事件、11 条命令。
- **内置运行时**：退役补丁 0022，两本账同改，从干净上游检出重建 payload，只回退 `chatapp_common.py` /
  `fsapp.py` 两处（回到 0019 之后的样子），26 补丁栈。上游 `goal_mode.py` / `goal_mode_sop.md` 不动（Rule 1）。
- **GUI**：删 15 个文件、改 79 个。输入框靶心入口与 Goal 模式、顶栏 Goal 徽标、侧栏 goal 态、委派 / 收口标记、
  暂停尾标、goal 的 live 窗口层、Goal 结束通知与设置开关、快捷键 Esc 行、错误卡 `view_goal` 都去掉。
  `goal-run-groups.ts` 里与 Goal 无关的三个函数并进 `run-groups.ts`。叙述行 variant `goal` 改名 `narration`
  （`session.checkpoint` 与 v1 历史旁白仍走它，形态不变）。i18n 两边各删 62 键、改名 2 键；改写文案两处：图片受限
  toast 去掉「Goal、」，智能体接入的能力清单 4 条变 3 条。
- **遗留清洗**：票面初稿以为 GUI 渲染时剥落库行的标签；票 02 查实 GUI 读 `final_answer`、从不渲染智能体行的
  `content`，本机 4 条带标签的历史行只在 `content` 里，所以历史显示本来就干净。真正的风险是重开旧 goal 会话时
  Core 把带标签的 `content` 回放进模型历史、新回复照抄——GUI `GA_TAG_PATTERNS` 与 Core `derive.rs` 的
  `GA_TAG_BLOCKS` 各留一条完整标签的剥离，注释写明原因，其余剥离全删。
- **截图种子**：删 goal 播种；「筹备读书会」留作普通已完成会话，保住 `projects.png` 的组行数；演示仓库导览页文案
  「六张……团队两张」改「五张……团队一张」。
- **文档**：`goal-commands.md` 退役短页（文件名不改）；stability §7 重排（新 §7.1 = `3`，原 §7.1–7.3 顺延，§7.2 加
  按语）；SOP / reference 的 Goal 节换成短的「Long Tasks」（说清终态、`session wait --until-idle` 盯、提前停就在同一
  会话再发），四份副本与两份 SKILL.md 同步；README 中英撤卖点、长任务条、CLI 示例与 Goal 截图，导览表剩五张；
  PRD §6.4、设计文档相关节改退役短节；`transports.md` 的 schema 示例升 3；宪法两处 schema 文字。
- **数据**：不加迁移。`goals` 表、`messages.goal_id`、pref `notify_on_goal_end` 留在库里，不再读写。

规模：222 个文件，+1529 / −10012（Core −4363、GUI −4093）。

验证：`cargo test --workspace`（`TZ=UTC`）915 通过、0 失败；`pytest` 550、`mypy`、`ruff`；`pnpm typecheck / lint`、
`pnpm test`（`TZ=UTC`）1101 通过；`ios/GalleyRemote/swift-test.sh` 73 通过；`check.yml` 六个门禁脚本、
`git diff --check` 全绿。

## 真机验收清单（JC）

先确认 `tauri dev` 已随合入重编并重启 Core（Core、runner、GUI 都改了；拿不准就整个重启）。

- [ ] 输入框（会话页与空状态）：没有靶心按钮，发送键没有 Goal 变体，底部无 Goal 提示；正常发送不变。
- [ ] 顶栏：没有 Goal 徽标；没有其他状态项时状态簇与分隔线一起消失。
- [ ] 侧栏：会话行四态（等你回复 / 出错 / 运行中 / 未读）不变，没有「Goal · …」副行。
- [ ] 设置 → 通用 → 通知：只剩「回复完成时通知」与「通知提示音」，前者关掉时提示音变灰；快捷键页少 Esc 一行；
      智能体接入的能力清单 3 条。
- [ ] 打开历史 goal 会话 `s-mu3yjxah-wnb0`（三星折叠屏）：目标行是普通用户气泡，整轮按普通 run 折叠，回答末尾没有
      原样标签。
- [ ] 终端：`core/target/debug/galley goal start x y` 输出 `invalid_args`、exit 2；`galley version` 报 `schemaVersion: 3`。
- [ ] README 导览表（GitHub 预览）：最后一行只有「搜索」一格，右半空着——看能不能接受。

## 遗留

- **README 导览表**排成 2 + 2 + 1，最后一格右侧留空；不补图，等 JC 看。截图整体重拍仍在 deferred。
- `docs/design/conversation.md` 的「不给普通消息加 eyebrow / 图标」规则唯一的理由是不稀释 Goal 委派标记，现已落空；
  规则保留并注明，下次有人提议时先重审。
- `session.checkpoint` 写的叙述行仍用靶心图标（原 Goal 的品牌图标）；眼下没有写入方，只影响 v1 历史行，不动。
- 别人的旧 goal 会话若有续跑，中途进展笔记现在按答案样式出现在折叠区（本机续跑为 0，看不到）。
- `cli/src/project.rs` 的 `only_sessions` 参数原是 Goal v1 controller 的作用域，现恒为 `None`，可顺手清理。
- 共享 turn-persistence fixture 的 goal 用例都是最终轮，preamble 路径若两边分叉测不到。
- 几处文档在 09-16 升 2 时就已过时（`CONTEXT.md` 与 `session-commands.md` 的 `schemaVersion: 1` 示例等），本次没碰。
- 发版时 release notes 必须写 `schemaVersion: 3` 与 Goal 移除（removal，所以是 minor）。
