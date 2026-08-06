# PRD: 下一步建议 Ghost Text（Composer Next-Suggestion）

Status: done（2026-08-06 JC 真机 dogfood 验收通过：默认强制后标签遵从率
与建议质量达标，ghost UI 可达性打磨一并验收）
Date: 2026-08-03（JC 与 agent 设计讨论定案）；2026-08-04 实现完成并勘误（见「实现勘误」一节）；
2026-08-05 定案 2 修订（见「定案变更」一节）
关联: `.scratch/session-auto-title/`（同一轮讨论的姊妹 feature，机制完全解耦，标题先行——
用它先踩实 runner 侧辅助调用通路，本 feature 的大头在 composer ghost UI）

## 背景与动机

真实使用场景（JC，2026-08-03）：模型的最终回复末尾经常自带下一步提议，
形如「如果需要，我可以帮你……」。用户目前的操作是复制粘贴到输入框，再手动
把主语改成「帮我……」。本 feature 把这一步压缩为：回复完成后，composer 里
以 ghost text 显示一条**用户口吻**的建议指令，按 → 填入，回车发送。

机制核心：让 GA 在最终回复的**同一次补全**里顺手输出建议标签。GA 自己最清楚
它刚才提议了什么，由它用用户口吻改写，比任何事后解析都准，且零额外调用、
零额外延迟。

已否决的备选（记录避免回锅）：

- **A1 独立侧调用**（复用 `/btw` 的 raw_ask 通路，回复后带全历史再问一次
  「用户下一步会说什么」）：每轮多一次全上下文调用，token 成本约翻倍，
  延迟 1-3 秒，与「GA budget」精神相悖。为省用户一次打字花一次全上下文
  调用，账算不过来。
- **A3 静态快捷回复**（「继续」「跑测试」等固定 chips）：零成本但与
  「智能建议」不是一个东西，覆盖不了改写主语的核心场景。
- **解析正文里的「我可以帮你……」散文**：脆弱的 NLP 猜测，不可靠。
- **懒生成**（用户聚焦空 composer 时才请求）：是 A1 的延迟缓解方案，A2 下
  问题整体不存在。

## 用户故事

> agent 答完，回复末尾提到「如果需要，我可以帮你把这三处调用一起改掉」。
> 输入框里浅色显示「帮我把这三处调用一起改掉」。我按一下 →，文字填入，
> 回车发送。如果我想说别的，直接打字，ghost 让位；打完又全删了，ghost
> 回来。

## 定案决策

### 1. 生成机制：GA 同次补全内输出 `<next-suggestion>` 标签（managed 独占）

- managed runtime 打 prompt patch，指示 GA 在最终回复末尾输出
  `<next-suggestion>…</next-suggestion>`。与 `<summary>` 同类，是同一次
  补全的一部分，零额外调用。
- 实现时**先查 session 的 `prompt_profile` 字段**（`core/src/api/session.rs:166`）
  是否已是现成注入 seam；是则优先走它，不碰更底层的 patch。patch 须符合
  managed-runtime 规则：最小、隔离、有文档、可重放。
- **attach 模式自然无此功能**：外部 GA 永远不会输出该标签，无标签即无
  ghost，连模式判断代码都不需要。模式分裂是被产品定位认可的
  （managed 是主开发方向，attach 是兼容模式）。宣传文案不得向 attach
  模式承诺此功能。

### 2. 标签合同（2026-08-05 修订：默认强制，见「定案变更」）

- v1 单条建议（匹配 ghost text 形态；多条建议做 chips 是未来的事）。
- 用户口吻祈使句：「帮我把……」，不是「我可以帮你……」。
- 跟随会话主要语言；长度约 ≤80 字符。
- ~~**没有合适建议时不输出标签**——宁缺毋滥，无标签即静默无 ghost。~~
  → 2026-08-05 反转为**默认强制 + 枚举豁免**：每条最终回复必须输出标签，
  唯一豁免是对话明确终结（道别/纯致谢/纯确认）。质量靠 grounding 规则
  （必须点名本次对话的具体事物）兜底，不再靠允许省略兜底。
- 模型不守规矩（缺标签 / 输出垃圾）：静默降级，无 ghost，绝不报错。
  此条不变——强制是 prompt 层合同，GUI 对缺席的容错照旧。

### 3. 传输：`turn_end` 增量字段 + 全链路剥离

- GA 只把 `<summary>` 经 turn-end hook context 递给 runner
  （`runner/workbench_bridge.py:1117`），新标签上游不认识，由 **runner 自己
  从 `responseContent` 正则提取**（标签正则表先例：`workbench_bridge.py:102`）。
- `turn_end` 增加可选 `nextSuggestion` 字段，四处联动（`runner/ipc.py`、
  `core/src/ipc.rs`、`gui/src/types/ipc.ts`、`docs/ipc-protocol.md` §4.7），
  纯增量。
- 新标签加入所有剥离表：runner 侧标签表、GUI `normalizeFinalAnswer`
  （`gui/src/lib/agent-turn.ts:108`），保证正文永不裸露标签。
- 建议随消息行持久化（就在 turn_end payload 里，白送），重开会话时最新
  一轮的建议可恢复。

### 4. Ghost text UI

- 触发谓词：`turn_end` 且 `exitReason != null` 且 `visibility === "visible"`
  （回复完成通知已在用同一谓词，`gui/src/lib/ipc-handlers.ts:285-289`）。
- 原生 HTML `placeholder` 做不了 ghost text（一打字即整体消失），需 overlay
  实现；与现有 composer register 文案模型（`gui/src/lib/composer-register.ts`）
  协调——ghost 出现时替代 `continueConversation` 空闲文案位。
- 接受键：ArrowRight（Composer 键盘处理中未被占用，
  `Composer.tsx:399-413`；全局快捷键亦无冲突）。仅在输入框为空时生效
  （非空时 → 是移动光标，天然约束）。填入走既有
  `ComposerHandle.prefillText`（`Composer.tsx:246-256`），沿用 EmptyState
  的不覆盖已有草稿保护（`EmptyState.tsx:152-160`）。
- 中文输入法：沿用既有 `isImeCompositionKeydown` 保护，组合期间方向键
  不误触。

### 5. 生命周期：派生条件，不是一次性事件

```
显示 ghost = 会话空闲 && composer 为空 && 最新一轮带建议
```

- 每次渲染对谓词求值，不存 dismissed 标志。由此白送的正确行为：打字让位、
  **删光输入自动回来**、按 → 接受后又全删掉也回来、IME 取消组合后回来、
  切会话再切回来还在（建议已持久化）。
- 新 run 开始即不满足「会话空闲」，ghost 消失；该轮结束由新一轮建议接管。
- 与 `ask_user` candidates chips 无冲突：那是运行中暂停态，ghost 是空闲态，
  两者不同时出现。
- v1 不做 Esc 主动关闭：ghost 是 placeholder 级弱视觉存在，不挡打字不抢
  焦点，「一直在」代价近乎零；且 Esc 已被 Goal 模式解除占用。有用户反馈
  再加。

### 6. 模型与配置

不存在模型选择——建议与正文出自同一次补全。不提供开关（v1 零设置项；
有证据再加是增量的）。

### 7. 范围声明

- 不动 Agent API / CLI（Rule 3 不涉及）：建议是纯桌面人类操作员便利，
  CLI / supervisor 不需要。
- IPC 协议纯增量（`turn_end.nextSuggestion` 可选字段）。
- managed-ga prompt patch 一处（或 `prompt_profile` seam）。
- GUI：ghost overlay 是本 feature 最大的新 UI 面。

## 定案变更（2026-08-05）：标签输出从「有才写」反转为「默认强制 + 枚举豁免」

触发：JC 真机 dogfood 首轮即复现核心场景失灵——模型（glm-5.2）末尾明确
写了散文版提议（「想了解更细节的……我可以继续深入讲」），却没输出标签，
ghost 缺席。归因三点：① prompt 从未告诉模型「你自己的结尾提议就是触发
条件」；② 「有才写」给了模型跳过永远不算错的默认；③ 指令位于 runtime
prompt 中段，recency 不利。

裁决理由（JC 提出强制方向，agent 算账后认可）：

- **失败模式不对称**：条件触发的失败 = 该出的 ghost 静默缺席，功能价值
  归零且不可见；强制的失败 = 平庸建议被用户无视，ghost 是 placeholder 级
  弱存在（定案 5 的性质此处成为安全网），代价近零。
- **遵从率结构性提升**：「每次都输出」是格式习惯（填空题），「逐次判断」
  是裁量（判断题）；弱模型维持格式习惯远比执行逐次判断可靠。
- **可观测性变干净**：强制后标签缺席 = 违规，不再与「本就无建议」混淆。
- **Token 账**：≤80 字符 ≈ 几十 output token，仅最终回复，同次补全零额外
  调用，整轮占比 <1%，与被否的 A1（成本翻倍）不同量级。

「枚举豁免」定义：省略不是开放式判断，而是封闭清单匹配——唯一豁免为
对话明确终结（道别/纯致谢/纯确认，无待续事项）。清单外任何理由（含
「想不出好建议」）不构成省略资格。

落地（全部在 `managed_prompt.rs` 一处）：默认义务 + 唯一豁免 + 「结尾
提议即下一步」转换规则 + grounding 质量地板（点名具体事物、禁通用空话）
+ 整节挪至 `RUNTIME_PROMPT_STATIC` 末尾占 recency 位。`prompt_hash()`
翻新，记新 prompt generation，属预期。

同日配套（ghost UI 可达性，2026-08-05 已实现）：「按 → 填入」hint 改为
可点击按钮（鼠标接受通道；`tabIndex=-1`，因父层 aria-hidden）；textarea
挂 `aria-describedby` → sr-only 描述（AT 通道）+ `title`（截断建议 hover
看全文——title 只能挂 textarea，overlay 是 pointer-events-none 接不到
hover）。明确不做：对回复正文的散文提议做风格管制（JC 裁决）、散文解析
兜底（维持原否决）。

## 实现勘误（2026-08-04）

1. **定案 1 的注入落点**：managed 模式的 prompt seam 就是 core 的
   `managed_prompt.rs::RUNTIME_PROMPT_STATIC`（经 `GALLEY_RUNTIME_PROMPT_TEXT`
   env → `install_managed_prompt_profile` → `backend.extra_sys_prompt`），
   Galley 自有代码，**无需任何 managed-ga patch 文件**；session 的
   `prompt_profile` 字段只是 profile ID 标记，不是文本载体。注意
   `prompt_hash()` 随新增段落翻新——预期行为，记作新 prompt generation。
2. **定案 3 的持久化范围**：v1 建议只存 GUI 内存（messages store 的
   `nextSuggestion`），不落 SQLite——`persistTurnEndToMessages` 的列映射不含
   该字段。应用重启后 ghost 不恢复，直到下一条最终回复；会话内切换不受影响。
   接受为 v1 取舍，dogfood 后有需要再加列。
3. **提取时机**：runner 只在 final `turn_end`（`exitReason != null`）上提取
   标签；中间步不看。GUI 侧在 final visible turn_end 无条件写入
   （无标签 → null），保证新回复总是替换或清掉旧建议。

后续候选（多建议 chips、ask_user candidates 补全）与辅助 LLM 功能的三条
准入判据见 `docs/devlog/deferred.md` 与
`docs/devlog/2026-08-04-auto-title-and-next-suggestion.md`；EmptyState ghost
text 等被否候选的理由也沉淀在后者，防回锅。

## 技术风险与验证清单

- [ ] **流式期间标签裸露**：`turn_progress` 的 delta 是 GA-raw、含标签
      （`runner/ipc.py:137`）。确认现有流式渲染对 `<thinking>`/`<summary>`
      的处理方式，新标签走完全相同的路，不能在流式时闪现原文。
- [ ] 标签输出可靠性：prompt patch 后 dogfood 观察遵从率与建议质量
      （口吻、长度、语言），迭代 patch 措辞。
- [ ] `prompt_profile` seam 可用性调研（决定 patch 落点）。
- [ ] 建议持久化落点确认：turn_end payload 入库路径是否天然携带新字段，
      restore 后最新一轮建议可恢复。
- [ ] ghost overlay 的主题适配（亮/暗）与视觉层级（必须弱于正文输入，
      与 placeholder 灰度一致：`placeholder:text-ink-muted/50` 先例）。
- [ ] 草稿交互回归：有 parked draft 时 ghost 不显示、不覆盖；draft
      park/restore 跨会话切换正确。
- [ ] managed patch 可重放性：按 managed-runtime 规则过一遍 patch 清单。

## Issue 拆分

待拆。预计切法：① prompt patch / `prompt_profile` seam 调研 + 标签合同
落地 → ② runner 提取 + IPC 字段四处联动 + 剥离表（含流式路径）→
③ ghost overlay + ArrowRight 接受 + 生命周期谓词 → ④ dogfood 轮
（遵从率与文案质量调优）。
