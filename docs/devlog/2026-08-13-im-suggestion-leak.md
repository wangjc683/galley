# next-suggestion 标签裸漏进全部 IM 渠道：mandate 移出 IM 提示词

日期：2026-08-13
关联：`core/src/managed_prompt.rs`、`0019-managed-im-strip-next-suggestion.patch`、
`runner/im_reporter.py`、workbench 幽灵文字功能（`fa6241ac`，2026-08-04）

## 现象与根因

Discord dogfood 首日发现每条回复末尾带裸标签
`<next-suggestion>…</next-suggestion>`；飞书复测同样中招——不是
Discord 的问题，是 8 月 4 日 composer 幽灵文字功能的**共享层错位**：
suggestion mandate（措辞强硬到「想不出建议不构成豁免」）写在
`RUNTIME_PROMPT_STATIC` 共享 runtime 层里，经
`GALLEY_RUNTIME_PROMPT_TEXT`（`runner_commands.rs` 单点注入）装给了
**每一个** managed agent；而消费端只有 GUI 一条路（bridge 提取进
`TurnEndEvent.nextSuggestion` + 剥离显示）。四个 IM 前端的清洗函数只认
上游四标签，Galley 自有标签原文漏出。飞书/Telegram 从 8 月 4 日起就在
漏，只是期间无人 dogfood IM。reporter 完成推送同样受害（报告 prompt
的「只回正文」与 mandate 打架）。

## 裁决（JC，三选一）

- **已否决 A 单独治标**（仅 IM 剥离）：模型每条回复白花 token 想建议
  再被扔掉，reporter 打架无解。
- **已暂缓 B**（IM 端按钮化消费——飞书卡片/TG inline button 基建现成，
  产品上成立）：是 feature 不是修补，进 deferred 挂启动信号；**与 C
  互斥**（做 B 需有条件带回 mandate）。
- **采纳 C + A 兜底**：根修 + 防历史模仿。

## 实施

- **C（根修）**：`RUNTIME_PROMPT_STATIC` 拆出
  `WORKBENCH_SUGGESTION_PROMPT`；`compose_runtime_prompt`（workbench，
  含 mandate）/ `compose_im_runtime_prompt`（IM，不含）双出口；
  `manager.rs` 在 IM spawn 时把共享 context 里的
  `GALLEY_RUNTIME_PROMPT_TEXT` 换成 IM 版。`prompt_hash` 改为对
  workbench 全量静态规则取指纹，拼接按原字节序——**refactor 前后哈希
  不变**，证明纯拆分。测试 `suggestion_mandate_is_workbench_only`。
- **A（兜底，防模型从修复前的历史消息里模仿标签）**：补丁 0019 给
  `chatapp_common.TAG_PATS` 与 `fsapp._TAG_PATS` 各加 `next-suggestion`
  （覆盖四渠道交互回复）；`im_reporter._deliver` 在 render 后统一剥
  （覆盖推送路径——Discord 的 reporter render 不经 `clean_reply`）。
  0019 已过 HEAD 重放逐字节校验。
- 验证：cargo 348 测试 / runner 234 测试 + mypy + ruff 全绿。

## 经验

表面专属功能的提示词 mandate 不要进共享层——共享层的每个字都会被
所有 surface 的模型执行，而消费端未必都在。`workbench_bridge` 的
`_TAG_PATS` 与 GA 上游的 `TAG_PATS` 是两套认知不同步的剥离清单，
Galley 新增自有标签时两边都要过一遍（0019 的存在本身就是这次不同步
的证据）。
