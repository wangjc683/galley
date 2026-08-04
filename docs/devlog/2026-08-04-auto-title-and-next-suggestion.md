# 自动标题 + 下一步建议 ghost text：两个辅助 LLM 功能的定案与实现

日期：2026-08-03 设计讨论定案，2026-08-04 实现发运（commit `fa6241ac`）。
工作材料：`.scratch/session-auto-title/`、`.scratch/composer-next-suggestion/`
（PRD + issues，含「实现勘误」节；本 entry 是它们退场后的 decision provenance）。

## 背景

JC 提出：模型答完后自动生成「最可能的下一条用户指令」，以 ghost text 填入
composer，按 → 接受。讨论中场景聚焦为：模型末尾常写「如果需要，我可以帮你
……」，用户复制粘贴后还要把主语改成「帮我……」——功能本质是把模型的提议
转成用户口吻的一键指令。讨论顺带带出第二个功能：会话自动标题（当时判断
「连首条消息截断都没有」，后证有误，见下）。

## 定案与理由

**建议生成走 A2（GA 同次补全内输出 `<next-suggestion>` 标签）**，managed 独占：

- 否 A1（独立侧调用带全历史再问一次）：每轮 token 成本约翻倍 + 1-3 秒延迟，
  与「GA budget」精神相悖；为省一次打字花一次全上下文调用，账算不过来。
- 否 A3（静态快捷回复）：覆盖不了「改写主语」的核心场景。
- 否「解析正文散文」：脆弱 NLP。
- A2 独有优势：GA 自己最清楚刚提议了什么；attach 模式外部 GA 永不输出标签,
  自然静默，连模式判断代码都不需要。模式分裂被产品定位认可。
- 注入落点就是 `core/src/managed_prompt.rs::RUNTIME_PROMPT_STATIC`
  （env → `extra_sys_prompt`），无需 managed-ga patch 文件；`prompt_hash()`
  随之翻新是预期行为。

**标题生成走 F2（runner 侧 `raw_ask` 侧调用，每会话一次）**：

- 否 F1（复用 GA `<summary>` 当标题）：summary 是「这轮做了什么」不是
  「会话关于什么」。JC 裁决：要搞就搞质量好的。
- 否 F3（首条消息截断）：讨论中发现 GUI 的 `maybeDeriveTitle` 早已实现 F3
  ——PRD 的「现状」段勘误。因此 `title_source` 定为 seed / derived / auto /
  user 四态：derived（截断）仍可被 LLM 标题升级，user 永不覆盖，清空标题
  重置回 seed。
- 否 G2（为此建通用 side-ask 设施）：单一乘客不建抽象；`GaSession.side_ask`
  是标题专用的最小实现（单条自构造消息、无历史 deepcopy 无锁，与 `/btw`、
  probe 同一 `raw_ask` 只读耦合契约），attach / managed 通吃。
- 种子态判定收在 core 插入时（`title == "新对话"` → seed）而非 GUI 打标：
  CLI `session new` 缺省也落同一常量，一处覆盖两条创建路径，Agent API 零改动。
- 竞态处理是单条 CAS UPDATE（`WHERE title_source IN ('seed','derived')`），
  用户改名永远赢；失败静默、下次 `run_complete` 重试。
- v1 watcher 只挂 GUI spawn 路径：socket `HandlerCtx` 的窄 `RunnerPort` seam
  是有意隔离，不为 watcher 拓宽；CLI / Goal 会话按合同自带真实标题。
- 标题落库后经既有 `session-updated-external` 镜像，GUI 会话列表零改动。

**模型与配置：零选项。** 建议与正文同次补全，不存在模型选择；标题用 session
当前模型——它是唯一保证密钥有效、配额未爆、连通已证的模型，且成本每会话
几厘钱，配置项的工程与认知成本远超收益。attach 模式下 Galley 无从判断用户
哪个模型「便宜」。无证据不开设置面；加开关永远是增量的。

**Ghost text 生命周期是派生条件，不是一次性事件**：
`显示 = 会话空闲 && composer 空 && 最新轮带建议`。删光输入自动回来、IME
组合期间隐藏、与 `ask_user` chips 天然互斥（运行中暂停态 vs 空闲态）。不做
Esc 关闭（Esc 已归 Goal 解除；ghost 是 placeholder 级弱存在）。v1 建议只存
内存，重启不恢复（下条回复即回来），dogfood 后有需要再落库。

## 后续讨论：辅助 LLM 功能的准入判据（2026-08-04）

「手动重新生成标题」JC 裁决**先不加**——清空标题已是隐藏出口（重置 seed，
下轮自动重生成）；真做需要三个决策（上下文取最近还是最早交换、user 锁定态
的旁路语义、入口 UI），条目连方案记入 deferred.md。

同日讨论「还能加什么 LLM 小功能」，立了三条准入判据（后续同类提案先过筛）：

1. 信息只有 LLM 能生成；
2. 成本结构天然受限（同次补全零成本 / 每会话一次量级），不需要节流阀门；
3. 填产品自己的死角——**用户问 agent 一句话就能得到的东西，不配开旁路调用**
   （Galley 的主通道本来就是全能 agent + 可查历史的 CLI）。

被判据筛掉的（防回锅）：EmptyState ghost text（无上下文可依据；「继续昨天的
事」的正解是回到旧会话的导航入口，用 DB 现成数据即可，零 LLM）；话题漂移
自动改标题（刚裁决过一次性，不自己推翻）；错误的 LLM 解释（会话模型往往
正是出错的那个）；归档摘要 / 项目周报 / 语义搜索（判据 3 不过，周报已是
supervisor SOP 正职）。过筛的两条（chips 多建议、ask_user candidates prompt
补全）记入 deferred.md，启动信号都是 dogfood 证据。

## 交付

migration 038（`title_source` 四态 + 保守回填）、runner `generate_title` 命令
+ `title_generated` 事件、`core/src/auto_title.rs` watcher、
`turn_end.nextSuggestion` 增量字段、全链路标签剥离（含流式未闭合截断）、
Composer ghost overlay + ArrowRight。验证：cargo test 全绿、runner pytest 203
过 + mypy/ruff、gui typecheck/lint/test 263 过。协议文档 §4.7 / §4.17 / §5.13。

待验收：JC 真机 dogfood——标题准确率、建议标签遵从率与口吻质量（prompt
措辞只需迭代 `managed_prompt.rs` 一处）。
