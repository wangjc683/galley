# 推理强度：默认语义修复、第一方 high、行徽章（Composer 入口被否）

日期：2026-08-07。起因：JC 问 Galley 高级选项里推理强度的默认档是什么
（「是 high 吗？用户会懵」），并提议像很多 Agent 一样在 Composer 放
快捷切换入口。一轮排查 + 多轮辩论后收敛为三件事：把「默认」写清楚、
第一方预设显式 high、Models 行加档位徽章。

## 排查结论：「默认」= 不发送参数

选「默认」时配置里不写 `reasoning_effort`，GA 构造 payload 直接省略
字段（`llmcore.py`），生效的是**服务商自己的默认**：OpenAI 系 API 侧
约 medium，Claude 走 `thinking_type: adaptive`（effort 不参与），
第三方兼容端点行为取决于其实现。唯一显式默认是 Codex 预设的 medium。
「用户懵」的病灶是**面板不可读**，不是档位选错。

## 辩论轨迹（三轮，双向让步）

1. **Composer 快捷入口：否**。三条理由：effort 是 provider 级全局配置，
   Composer 拨动会静默影响其他在跑会话（作用域错位，要做对需
   per-session transport override 整条新管道）；只对第一方端点有意义，
   常驻控件会时灵时不灵；别家放 Composer 是因为一次性 chat，Galley 的
   会话是长跑 agent run，档位是开工前决策。需求由 **effort 变体条目**
   承接：同模型配两个 provider 条目（high / medium），LLM 切换本来就是
   per-session 的。JC 认可搁置（见 deferred.md）。
2. **「去掉默认、全局 high」（JC 提议）→ 分层落地**。agent 反对全局：
   十个预设六个是第三方兼容端点（DeepSeek/Kimi/MiniMax/MiMo 走
   Anthropic 兼容协议，effort 是第一方 API 契约，兼容层可能 400；
   SiliconFlow 模型字段为空、OpenRouter 任意直通），「默认」是这些端点
   唯一安全值，必须保留。agent 同时收回「agent 负载不该 high」的反对
   ——2026 档位谱系里 high 之上还有 xhigh/max，且现代实现是自适应预算，
   质量优先默认是正当产品立场。**定案：仅三个第一方预设（Codex/OpenAI/
   Anthropic）显式写 high；共享的 `managedModelProtocolAdvancedDefaults`
   不动（它同时服务任意自定义端点）**。
3. **存量不迁移、ultra 档不跟进**（JC 裁决）。存量模型记录的运行时
   配置来自创建时快照，改预设只影响新添加的 provider；老记录下次编辑
   保存时按既有「推荐值叠加」语义自然吸收（与当年 `context_win` 上调
   同模式）。GA 枚举无 ultra，不立 issue。

## 落地

- 「默认」→「默认（跟随服务商）」+ info 说明（中英），
  `AdvancedChoiceField` 补 info 能力。
- 三个第一方预设内联 `reasoning_effort: "high"`，代码注释写明
  first-party-only 规则。
- Models 行加档位 chip（语域同 Provider chip）：**仅存量快照显式设置时
  显示，读快照不读推荐值叠加**——老记录运行时不含 effort，读叠加会让
  徽章撒谎。这个徽章是 effort 变体条目在列表里的唯一区分线索，属于
  变体路线的配套前提。Codex `minimal→medium` coercion 在徽章层同步
  镜像。「只给 effort 上徽章」的边界原则：它是唯一改变行为档位的高级
  选项，其余都是传输层参数，永不上行。

相关 commit：`77e5b791`。设计规则同步至
[overlays-and-settings.md](../design/overlays-and-settings.md) Models 节。
