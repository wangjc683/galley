# 闭环：子任务叫醒助手

日期：2026-10-16
关联：[助手 PRD](../../.scratch/assistant/PRD.md) 裁决 2、8，[主对话 PRD](../../.scratch/main-chat/PRD.md) 裁决 80、82，
票 [29](../../.scratch/main-chat/issues/29-subtask-wake-core.md)、[30](../../.scratch/main-chat/issues/30-assistant-manual-and-entry-layer.md)、[31](../../.scratch/main-chat/issues/31-subtask-wake-gui.md)，
前情 [助手带团队](./2026-10-15-assistant-runs-the-team.md)、[ADR-0003](../adr/0003-gui-and-phone-send-through-core.md)。

## 缘起

10-15 地基的第一步：助手派出去的活由它负责到底。今天以前，子任务的结果只显示在卡片上，助手「用户问起再查」，盯卡片、判断靠不靠谱的是用户。
JC 同日定了三处细节（裁决 8）：打回最多两次；打回与替你答题时不出声，返工的信号挪到卡片的「第 N 轮 · 」；叫醒在对话里不留痕迹。

## 做了什么

- **Core 叫醒**（票 29）：未升级的子任务一次运行结束（完成、提问、出错、停在步数上限、没派出去；被停掉的不算）就生成一件待报。
  主对话空闲立刻送，在跑就等这一轮且用户排队的先走，在等用户回答时不送（这时任何消息都会被当成回答）。送前重读现状、几件合一，写成主对话里一条隐藏的用户行（`created_via='system'`、`supervisor='galley-report'`，同问候与子任务的先例，不加迁移），回放时压成一行。
  打回次数从库里数（助手发进子任务、前一条回复不是提问的消息）；`<no-reply/>` 与 `<subtask>` 同样在回合推导里剥掉；界面搜索排除叫醒行；送不出去就广播 `subtask-report-undelivered`，界面退回子任务自己的通知。
- **`session send --ensure-runner`**（票 29 追加）：子任务的 runner 不在时（Galley 重启过、被挤掉），助手的打回或代答只会落库。ADR-0003 当初就留了这条路，socket `session send` 加可选的 `ensureRunner`，默认关，与今天一字不差；开着就先在共享路径上拉起 runner、回放历史再发。Agent API 在 `schemaVersion: 3` 里只加不改。
- **入口层与助手手册**（票 30）：派活条款加上「交回什么证据」「Galley 会叫醒你」「写命令前先读手册」，删掉「问起再查」；入口层 1446 → 1699 字节。
  手册内嵌在 Core，主对话启动时写进 `<state_root>/assistant/reference/`，写三级授权、带 `--supervisor=galley-assistant` 的写命令、不用 `session wait`、打回与代答规则、验收与交代的写法。
- **真模型评测**（票 30，`.scratch/main-chat/entry-layer-eval/wake/`）：JC 主对话的模型，九个用例各两遍，保留的 20 次里 19 次过（唯一不过的是一条交代 177 字超过自定的 160 字上限）。
  评测里改过两次手册的验收一节：证据齐全时模型会回源头重查（开浏览器、想 OCR 截图），按「核对证据在不在，核不了就直说」改写后不再这样。步数上限一件补了最后一段文字与完整的续跑命令，模型调用从 4–5 次降到 3 次。
- **界面**（票 31）：叫醒行与不出声的回复不画、不当卡片的最后一句、不通知、不置未读；未升级子任务不再自己通知，只在送不出去时补发；子任务卡片第二轮起写「第 N 轮 · 」。

## 集成时改的

- 叫醒里「对照派活说明」原指 `--tail=40`，子任务超过 39 步时说明就不在里面；改为写明第一条消息 `session show {id} --around=msg_{id}_0_user`。没把说明整段塞进叫醒：同一段里助手本来就有它，只有冷启动后才缺。
- 「不出声」只认剥完为空，两端一致。界面原先带了标签就藏，模型若把交代写完又误加标签，交代会被吞掉；多一句「已打回。」代价小得多。
- IM 入口层要求 `llm set` 带 `--supervisor`，可它不收、带了就报错，顺手删掉。

## 记下没做的

- 改名没有 CLI 命令，归助手 PRD 次序第 3 步（授权补全）。
- 手机端要按来源藏起叫醒行与 `<no-reply/>`，手机开工时做。
- 派活本身失败、叫醒又送不出去时没有通知；打回后新一轮第一步落定前卡片还写上一轮的步数摘要（旧行为）。真机若碰到再修。

## 验证

`cargo test --workspace` 35 组 974 条（本机时区与 `TZ=UTC` 各一遍）、`cargo check`；`pnpm --dir gui typecheck`、`lint`、vitest 1351 条（两个时区）；文档链接、Supervisor SOP 漂移、IPC 漂移、`git diff --check`。
未做：真机验收（JC），以及一周试用看派活、打回、代答、提问的次数和「说好了其实没好」。
