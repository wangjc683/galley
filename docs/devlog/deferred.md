# 挂起的想法（Deferred）

想清楚了、留了方案、但决定暂不实施的想法都记在这里 —— 一想法一节，等启动信号再开工。

与时间线的分工：[时间线](./README.md) 记「已发生的历史」（不可变）；本台账记「想做但还没做的事」（会增删）。真正开工时，把对应小节从这里拎出来、落成一篇正式 devlog entry，并从本台账删掉。

每节固定字段：**状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联**。

---

## 轮间距层级（answer → 下一问 的留白小于对内间距）

- **状态**：观察中
- **提出**：2026-08-06（折叠 run 垂直节奏讨论的连带观察，见
  [run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)）
- **启动信号**：dogfood 中觉得相邻问答对之间「挤」、边界不清。
- **现状**：轮与轮之间（上一回答 → 下一条用户消息）实际 20px（用户块
  `my-5`），小于对内的「问题 → 折叠头」24px——严格按邻近性层级是倒挂。
  但用户消息的高亮笔触是强视觉锚，边界感不完全靠留白扛，未必构成实感
  问题。
- **方案**：把 `MessageUser` 外层 wrapper 的上边距升到 `mt-7` / `mt-8`
  （保持 `mb-5`），使轮间 ≥ 28px > 24px，恢复「对间 > 对内」排序。
- **待定**：具体档位（28 vs 32px）；`GoalCommissionMarker` 前的间距是否
  同步。
- **关联**：[run-fold header spacing](./2026-08-06-run-fold-header-spacing.md)、
  [user message highlighter](./2026-08-06-user-message-highlighter.md)。

---

## 自动滚动到最终答案开头（scroll-on-completion）

- **状态**：暂存
- **提出**：2026-05-13
- **启动信号**：beta / 公测用户反馈「每次长答案出来都要手动往上滚才能开始读」是高频痛点。
- **方案（E）**：默认 read mode；流式期间不做 stream-follow（用户可手动滚到底 opt-in watch mode）；`run_complete` 时 smooth scroll 把最终答案开头（`[data-role="final-answer"]` wrapper）定位到 viewport top + 32px。这个 scroll 动作本身同时充当「GA 完成了」的视觉信号。
- **实施要点（约 5 处小改）**：
  1. `Conversation.tsx` AgentTurnView：给 final turn 的 MessageAgent 套 `<div data-role="final-answer">`
  2. `useAppStore.ts`：加 `runCompleteTick: number`（初值 0）
  3. `ipc-handlers.ts` 的 `run_complete` case：`runCompleteTick + 1`
  4. `MainView.tsx`：加 useEffect 监听 tick，RAF 后 smooth `scrollBy` 到 final-answer（复用 `userSubmitTick` effect 的位置计算逻辑）
  5. `MainView.tsx` stream-follow effect：删掉提交后 `atBottom` 自动翻 true 的隐含行为
- **待定**：用户主动 scroll 中遇 `run_complete` 是否强制 snap（倾向 snap）；smooth 时长 200-300ms 未实测；anchor 用 MessageAgent wrapper 还是 StrongHr（倾向前者）。
- **关联**：原讨论已并入本节（原 `2026-05-13-scroll-on-completion-deferred` entry 已收编删除）。

---

## 已有对话 cwd live-sync（IPC `set_cwd`）

- **状态**：暂存
- **提出**：2026-05-13
- **背景**：Project 的 rootPath / cwd 绑定已于 2026-05-14 回收（见 [rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)）。DB column 与类型字段保留作 forward-compat —— 将来若重启 cwd 绑定，正解是这条 live-sync，而不是让用户重启 app。
- **启动信号**：beta / 公测有人反馈「改完项目路径要重启 app 才生效」是高频痛点。
- **方案**：bridge 加 IPC 命令 `set_cwd { path }` → 收到后调 `os.chdir(path)`（OS 级 API，真改进程 cwd）→ 之后 GA 的 `file_read` / `code_run` 相对路径解析与 subprocess 继承自动用新路径，无需重 spawn。desktop 端在保存 project rootPath 时，自动给该 project 下所有 alive bridge 派发 `set_cwd`。约 200-300 行。
- **实施要点**：bridge `set_cwd` handler + `ipc.py` dataclass + `ipc-protocol.md` 文档 + bridge 测试 + desktop `updateProject` 里自动派发。
- **待定**：GA 内部工具是否 cache 启动时 cwd（需 audit `ga.py`）；`os.chdir` 失败（路径不存在 / 无权限）的错误回滚链路；派发时机应在 save 按下时而非每次输入。
- **关联**：[Project rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)。原讨论已并入本节（原 `2026-05-13-project-cwd-copy-and-live-sync-deferred` entry 已收编删除）。

---

## workbench_bridge.py 类分解（Bridge god-class 拆分）

- **状态**：暂存
- **提出**：2026-07-23（Rust/GUI 大文件拆分两轮收尾时的排查结论，见 [拆分两轮 devlog](./2026-07-23-rust-and-gui-large-file-split-rounds.md)）
- **启动信号**：下次需要在 bridge 里做实质性新功能（新命令域 / 新遥测 / 新审批流），或它再次成为理解/review 瓶颈。
- **背景**：`runner/workbench_bridge.py` 1828 行，`Bridge` 一个类 50 个方法，混了 GA setup、managed 注入、usage/遥测、workspace 激活、审批 handler、事件发射、turn-end 序列化、命令分发、stdio 循环。是全仓最该拆的文件，但性质与 Rust 那五个不同：类方法共享 `self` 状态，是**类分解**不是自由函数搬家。
- **方案**：按域委托出协作对象（telemetry / approval / command-dispatch / emit），`Bridge` 保留编排。不要一次全拆，按"下次要动哪个域就先拆哪个域"推进。
- **实施要点**：动手前对照 CLAUDE.md Rule 1 —— 该文件正是 attach 模式集成点（`GenericAgentHandler` 子类、`_turn_end_hooks`、history 注入）的实现处，拆分不得改变 GA 边界行为；`tests/test_workbench_bridge.py`（1017 行）是护航基础，先跑通再动。
- **待定**：协作对象之间共享 `SessionState` 的方式（传引用 vs 事件）；`_FenceFilter` 等已独立的类是否先行搬到单独模块作为低风险第一步。
- **关联**：[Rust/GUI 大文件拆分两轮](./2026-07-23-rust-and-gui-large-file-split-rounds.md)。

---

## Dark theme 抬画布（canvas lift，L 19.4 → ~25）

- **状态**：暂存
- **提出**：2026-07-25（[降暖一档](./2026-07-25-dark-theme-dewarm-pass.md) 测量时的副产品，JC 本轮只处理暖度、未碰此项）
- **启动信号**：dogfood 中出现"夜里看久了眼睛累 / 整体太沉太黑"的反馈，或需要在 dark 下新增一层 elevation 却发现没有空间。
- **不是启动信号（2026-07-25 实例）**："字体太亮"**别**当成本条的触发。当天出现过一次，看起来像，真因却是 `-webkit-font-smoothing: auto` 的笔画膨胀（见 [font-smoothing 限定浅色](./2026-07-25-dark-prose-font-smoothing.md)），与画布高度无关。抬画布**一点不降字的绝对亮度**，只抬背景参照——症状定位在"某个区域的字"时，先查渲染再查画布。
- **背景**：Galley dark 的六层表面全挤在 **L 17.5–25.8** 这 8.4 点带宽里，`chrome` 已到 L 17.5、下面几乎没有余量。对照 Ghostty 默认 dark 背景 L **29.3**——它的舒适感来自**画布被抬起**而非低对比（它正文对比 14.0:1，和我们的 14.95:1 几乎相同）。同样的对比比例下，画布越高绝对亮度落差越小，且上下都留出层级空间。
- **方案**：整条表面阶梯上移约 5 个 L 点（`app` 19.3 → ~25），保持相邻步进不变；`chrome` 仍低于 `app`（倒置抬升规则不变）。墨色随之下调以维持 ~14:1 正文对比，或接受降到 ~12:1（Notion dark 是 11.9:1，仍是舒适区）。
- **实施要点**：与降暖一档同样是"只动 L、不动 chroma / 色相"的单旋钮改法，可复用同一套 OKLCH 脚本；改完必须复核对比度（正文 / 次级 / 三级 / 边框四档）与阶梯单调性。**必须整条阶梯一起抬**——`surface` 就在 L 21.6，只把 `app` 从 19.3 抬到 21.3 会直接撞上它。注意 `--color-overlay` 与各 `--shadow-*` 的黑色分量在更亮的画布上会显得更重，可能需要同步减弱。
- **待定**：抬升幅度（+3 / +5 / +8 点）需实看；正文对比是维持 ~15:1 还是顺势降到 12–13:1 是独立的审美判断，不要和抬画布捆绑成一个决定。
- **关联**：[降暖一档](./2026-07-25-dark-theme-dewarm-pass.md) · `docs/design/foundations.md` §2.1。

---

## 架构审查第二轮剩余候选(hive Origin carrier / useComposerGoal / GaSession gate / quick wins)

- **状态**:暂存
- **提出**:2026-07-28(架构审查第二轮收尾,见 [审查 devlog](./2026-07-28-architecture-review-deepening-round.md);四个 Strong 候选已落地,以下为 Worth exploring 档)
- **启动信号**:下次动到对应模块时顺手做,或再跑一轮架构审查时按新鲜度重估。
- **候选 5 · hive Goal controller helpers 收窄**:`cli/src/goal/hive.rs` 的 phase helpers 接口宽(`resume_ready_worker_slots` 11 参,双 `&mut` 集合 + 返回值双向携带状态);`supervisor`/`reason` 裸对出现在 12 个签名、~53 次 clone,而 `core/src/api/origin.rs:49` 已有 `Origin` 概念可复用。先捆 carrier 再收 controller-state struct,最后重看双向 mutate。**已核对与 ADR-0002 不冲突**(这些 helper 全 `Result + ?` 传播,无分歧 failure contract)。
- **候选 6 · useComposerGoal 13 出参收成 goalView**:26 成员 interface 罩 ~90 行逻辑,3 个入参是回调回 caller,10 个返回值原样穿过 Composer 进 ComposerGoalControls。改返回 `goalView` 对象 + 4 action。
- **候选 7 · GaSession seam grep gate**:seam 本身干净(bridge 11 处调用零 reach-in),但"re-audit 面 = 一个文件"的承诺无 CI 强制,且 `managed_im_supervisor.py:346` 的 `_galley_im_prompt_installed` 写入是结构性旁路(该路径无 Bridge)。做法:grep gate(同 `check-supervisor-sop-drift.mjs` 文风)+ docstring 补旁路,或让 supervisor 路径也构造 `GaSession(agent)`。
- **Quick wins**:`hasRunningSessions` 收成 messages store selector(三处重推导:App.tsx / MainHeaderHost / app-update.ts);`lib/ipc/ga-output-cleaning.ts` 补测试(纯函数、流式热路径、零覆盖);`socket_listener/` 的 `use super::*` 互 glob 改具名 re-export(照 `codex_oauth/mod.rs`);`spawn_args_for_session_new` 7 参改 `&SessionBrief`+2;runtime store 补 slice-merge shape 守卫(照 `sessions.shape.test.ts`)。
- **关联**:[架构审查第二轮](./2026-07-28-architecture-review-deepening-round.md) · ADR-0002。

---

## 手动重新生成标题（regenerate title）

- **状态**：暂存（2026-08-04 JC 裁决先不加）
- **提出**：2026-08-04，自动标题（migration 038 / `generate_title`）发运后的讨论。
- **启动信号**：dogfood 中「想重新生成标题」的冲动实际出现——JC 自己留意频次，出现即证据。
- **背景**：自动标题是一次性（CAS 后 `title_source='auto'` 不再有资格）。隐藏出口已存在：**清空标题** 会重置回 seed，下次 `run_complete` 自动重生成（rename 空串路径的副产品，无 UI 提示）。
- **方案**：不是一个按钮，是三个决策——① 上下文取什么（重生成动机多为话题漂移，应取**最近**交换而非首轮，是另一套上下文策略）；② 锁定语义旁路（`user` 态被显式点按时该被绕过，一次性 CAS 要开洞）；③ 入口放哪（会话行右键菜单 / 标题栏悬停）。runner 的 `generate_title` 通路原样复用。
- **待定**：见方案三点。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/session-auto-title/PRD.md`。

---

## 多建议 chips（next-suggestion 升级）

- **状态**：暂存
- **提出**：2026-08-04（ghost text 设计时即预留，准入判据讨论中确认排队）。
- **启动信号**：ghost text dogfood 证明建议**采纳率**可观——它是同一假设的加注，不是新假设，证据先行。
- **方案**：A2 标签频道白送——managed prompt 允许模型输出 2-3 条备选（标签格式扩展或多标签），`turn_end.nextSuggestion` 扩为数组（增量字段），渲染复用 `ask_user` candidates 的 chips 组件；主建议仍走 ghost text + →，备选点击填入。
- **待定**：多条时 ghost 与 chips 的并存形态；标签合同是多标签还是分隔符。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)、`.scratch/composer-next-suggestion/PRD.md`。

---

## ask_user candidates 补全（prompt 调优）

- **状态**：暂存
- **提出**：2026-08-04 准入判据讨论，唯二过筛的候选之一。
- **启动信号**：dogfood 观察到 GA 提问常不带候选、用户要打字回答本可点选的问题。
- **方案**：`RUNTIME_PROMPT_STATIC` 加一条「调用 ask_user 提问时尽量附带 candidates」——零成本纯 prompt 调优，现有 chips 渲染（`AskUserBubble`）立刻变勤快。managed 独占（attach 不碰 GA prompt）。
- **待定**：措辞对不同模型的遵从率；candidates 数量上限建议。
- **关联**：[自动标题 + 下一步建议](./2026-08-04-auto-title-and-next-suggestion.md)。
