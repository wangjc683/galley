# 主对话区审计与三层打磨：数据丢失级缺陷 / 体验 / 一致性

- **Date**: 2026-07-05
- **Status**: 已落地（commits `a1fc6e1` / `bc1fd0e` / `3e43d4e` / `f24817e` + 本次文档 commit）
- **Related**: [conversation.md](../design/conversation.md)、[tools-and-approvals.md](../design/tools-and-approvals.md)、[foundations.md](../design/foundations.md) 均已回写；`docs/ipc-protocol.md` §4.7（只读参照，未改）

## Context

Topbar 打磨收尾后，JC 提出对最高停留面（主对话区）做系统性 UI/UX 打磨。方法：三个并行审计 agent 分读消息渲染层 / Composer 输入层 / 容器与工具调用层（约 7000 行组件 + 两份设计文档），主线程交叉核实最重发现后分级：T0 正确性缺陷 → T1 高频体验 → T2 一致性 → T3 文档回写。审计的元发现：**这个面的视觉层经多轮 dogfood 已扎实，真正的问题是伪装成"打磨"的功能缺陷、实现相对规范的漂移、以及规范相对实现的过时**。

## Decisions

1. **IME 守卫是硬约束**（`lib/ime.ts`）：所有 Enter/Escape 提交型 keydown 必须过 `isImeCompositionKeydown`（Chromium `isComposing` + WebKit compositionend 后补发 keyCode 229 的怪癖）。中文优先产品里"选词回车把半截拼音发出去"是最高优先级缺陷。已覆盖 Composer、两处重命名、Settings 路径输入。
2. **草稿按 surface 驻留内存**（`lib/composer-draft.ts`）：write-through 保存（卸载时保存会与图片 hook 的 URL 簿记竞态）；文字按展开后全文存（fold registry 随组件死，存占位符会把字面量发出去）；图片 previewUrl 由停车场接管所有权（hook 卸载扫除跳过）；提交时同步 drop（防 EmptyState→MainView 切换让已发送文本复活）。刻意**不持久化**——草稿随 app 生命周期，与所有聊天客户端一致。
3. **denied 从 Galley 自有载荷识别**（`lib/tool-outcome.ts`）：`WorkbenchHandler` 的拒绝返回值 `{"status": "denied"}` 原样进 `turn_end.toolResults[].content`，GUI 解析自家线格式，不碰 GA 内部。**不做通用 failed 内容嗅探**——GA 无结构化失败信号（`[Error]` 前缀全 ga.py 仅 2 处，非约定），误标比不标更伤信任。
4. **禁用控件的解释 tooltip 必须可达**：真 `disabled` 吞指针事件 → Radix tooltip 永不弹出。规则化为 `aria-disabled` + 点击 no-op（Stop 按钮先例推广到 Goal / 附件 / 发送 / LLM pill / 审批全局白名单按钮）；原生 `title` 全部清除。
5. **阅读面尺寸一律走 `--conversation-*` 变量**：新增 `-code-size`（块代码曾硬编码 13px 不随三档缩放——变量系统本要防的漂移类）与 `-echo-size`（已答复 ask_user 回显）。conversation.md 的 px 表加注"这是 standard 档"防止下一个编辑者再硬编码。
6. **流式代码块保留上一帧高亮**直到新高亮完成：每 chunk 闪"无色→上色"换成滞后一次高亮周期（Shiki 热后数毫秒），换主题同理。
7. **结算态 file_patch 复用 PatchView**：审批时有 diff、批完变 JSON 汤是同一对象两副面孔；args/result 加 200px 滚动窗（文档本有此规格，实现漏了）；500 字符截断加可见 `…`；路径 pill 截断保尾部文件名；denied 不回显内部载荷。
8. **中间轮旁白渲染在该轮工具之前**：LLM 说"我先看一下 X"在 dispatch 之前，旧渲染序读作"工具跑完才宣布计划"，回读叙事倒置。
9. **运行态 footer hint 教 `/btw`**（新 copy `runningHint`）：运行中「Enter 发送」是谎言；纠错文案 `byTheWayPrefixHint` 保留给失败尝试后的瞬时提示。
10. T2 批量：省略号全量「…」、对话层动效统一 120ms、`rounded-[4px]`→阶梯、三种输入框 focus 统一杏沙、prompt 卡片标题常驻右侧预留（hover 不再重排）、保存文件名 `ga-`→`galley-`（产品名规则）、ActionChip tooltip 随状态、审批渲染硬编码英文全部进 copy 层。

## Rejected alternatives

- **1b 审批卡决策后保留"已决定"锁定态**（JC 明确只做 1a）：改动审批流状态机、有可见行为变化，留档待议。当前决策后卡片仍即时消失，`turn_end` 折回时以正确的 denied/success 态出现——留痕问题已由 1a 解决一半。
- **通用 failed 内容嗅探**：见 Decisions 3。
- **unmount 时保存草稿**（对比 write-through）：与图片 hook 的卸载 URL 扫除存在效果顺序竞态；write-through 让卸载路径零职责。
- **草稿持久化到 prefs/DB**：跨重启草稿不是用户预期（无主流先例），成本换不来价值。
- **段级 tooltip 保留在字号分段上**：Popover autofocus 落第一段必弹「小字号」误导；段标签自明，删除即根治（上一轮已记，此轮 LLM pill 的 provider `title` 同因删除）。

## Open questions

- **Phase 2 协议扩展**：工具级 running / success-current / failed 需要 bridge 事件与（managed GA 可打补丁的）结构化 outcome；等本轮 dogfood 后评估值不值。tools-and-approvals.md §4.5 已写明数据流现实。
- **对话区键盘故事**：几乎所有操作 `tabIndex=-1` pointer-first（复制/展开/图片/Stop 均无键盘路径），看似刻意但从未成文。需要 JC 单独定方向：接受 pointer-first 成文，还是补键盘层。
- **审批表单 / Dock / GoalRunMarkers 的固定 px**：未纳入字号变量（chrome 邻接，逐档视觉需 JC 过目），刻意缓办。
- **Goal 启动配置每次重置**（时长/人数不记忆上次选择）：UNCERTAIN 是否刻意，dogfood 观察。
- **用户消息复制 chip 1.8s 延迟消失**：可能是 dogfood 调优值，未动。
- **工程环境**：仓库缺 CLAUDE.md 所指的 `.venv`，系统 Python 无 pytest——下次真改 runner 代码前需重建。

## Next

- JC 真机验收本轮四个 commit（重点：中文输入法回车、切会话草稿、denied 块、大字号下代码块、流式代码块稳定性、运行态 hint）。
- 键盘故事与 Phase 2 择期各开一轮讨论。
