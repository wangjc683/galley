# 添加模型提供商：明确的「自定义」入口，修 `v1beta` 拼接（galley#32）

日期：2026-10-01
关联：[galley#32](https://github.com/wangjc683/galley/issues/32)、`gui/src/lib/managed-model-presets.ts`（`custom-endpoint`）、
`gui/src/lib/provider-setup.ts`（第一个模型的预设层、`providerHostFallback`）、`ProviderEditor.tsx` / `StepModelConfig.tsx`、
`core/src/managed_model_probe.rs`（`is_version_segment`）、`managed-ga/patches/0027-managed-url-version-qualifier.patch`、
`runner/tests/test_managed_ga_url.py`、[设计：Provider picker](../design/overlays-and-settings.md)、
[设计：Onboarding Step 1](../design/onboarding-and-cards.md)、[GA baseline](../ga-baseline.md) 契约面第 18 条、[deferred](./deferred.md)
（Ollama 预设改写、`auto_make_url` 上游对照）

## 现象

社区请求（v0.5.4，macOS，内置）：预设里没有 xAI Grok、Google Gemini，要用只能先点「OpenAI」或「Anthropic」再把官方地址和模型改掉，
卡名和预填内容都不像「任意兼容端点」；希望加这两家的具名预设，或者至少给一个名字就叫「自定义」的入口。

## 核对

- 预设列表与 issue 一致（10 个）。官方两张卡的副标题是「官方 API 或 OpenAI / Anthropic 兼容接口」，这是 05-26 的有意设计
  （`overlays-and-settings.md:280`：让中转站和兼容接口也走这两个入口），理由是推理，没有实验。
- issue 没提的两处：
  1. **Gemini 的地址会被拼错**：Core 探测的 `has_version_segment` 与内核 `llmcore.auto_make_url` 都只认 `/v` 加纯数字，文档里的
     `…/v1beta/openai/` 被拼成 `…/v1beta/openai/v1/chat/completions`；README「任意 OpenAI 兼容端点可用」对 Gemini 不成立。上游同源。
  2. **拿官方卡接别家端点，第一个模型带上第一方专属参数**：新建 provider 时第一个模型直接用卡片的选项包（`provider-setup.ts:304`），
     OpenAI 卡改了地址也照样写入 `reasoning_effort: high`；之后再加的模型按地址匹配，又不会带。08-07 的裁决写明兼容层可能因此回 400。
- 本机：JC 的 Grok 走中转站 `cpa.subsage.top/v1`，不是直连 `api.x.ai`，所以拿不到直连 xAI 的证据；Gemini 未配过。

## 讨论与裁决（JC，2026-10-01）

我原先推荐修地址 + 加 Grok 预设 + Gemini 预设待实测 key、「自定义」卡暂缓。JC：「我觉得直接增加一个明确自定义的接口就行」。讨论后
按推荐推进：

1. **一张「自定义」卡、卡内选协议**（复用 `SegmentedControl`，「OpenAI 兼容」/「Anthropic 兼容」，默认前者），排在最后。否掉两张卡
   「OpenAI 兼容」「Anthropic 兼容」：网格 12 张，且与「OpenAI」并排容易混。
2. **官方两张卡只代表官方**：副标题改「官方 API」；地址仍可改、不锁（锁住要多一种只读态，走公司代理访问官方 API 的人也得换卡）。
3. **编辑已有 provider**：地址不匹配任何预设就显示「自定义」（只改显示，不动数据），JC 的 CPA 中转之后显示为「自定义」。
4. **自定义卡字段顺序**：协议 → 地址（必填）→ Key（可空，沿用无鉴权确认）→ 模型 → 显示名称；对自定义来说地址才是定义它的字段，
   所以排在 Key 前（其他卡不变）。显示名称留空取地址的主机（含端口），不叫「自定义」。Onboarding 里自定义卡的地址不收进「高级」。
5. **顺带**：修 `v1beta` 拼接（Core + 内置补丁 `0027`）；修第一个模型的预设层（按最终地址判定）；Grok / Gemini 不加具名预设。
6. 推翻 05-26 的写法：理由是 #32 的真实反馈、上面第 2 处潜在 bug、Onboarding 把地址藏在「高级」里对兼容端点用户不顺。

当天另定：默认不向上游提 PR（JC 专门提到才发），`auto_make_url` 的上游草稿只留作删 `0027` 的对照。

## 实施

- **GUI**：新卡 `custom-endpoint`（`apiBase` / `model` 空，无 `apiKeyUrl`，无第一方选项）。执行代理偏离票面一处（采纳）：既然保存时按
  最终 protocol + authKind + apiBase 解析预设层，表单里那份选项包就成了死状态，直接删掉；连接测试与 Settings「测试模型」也走同一套解析，
  否则 Onboarding 里把 OpenAI 卡改指中转站，自动测试仍带 `high`，可能 400、「开始使用」点不了。选中自定义卡时触发器不显示协议徽标；
  协议徽标与 Provider 卡的协议 chip 改用本地化文案（原来写死英文，中文界面同一屏出现「OpenAI-compatible」与「OpenAI 兼容」）。
- **地址**：版本段规则改为 `v` + 数字 + 可选小写字母数字后缀（`v1beta`、`v1beta1`、`v2alpha` 算；`vendor`、`video`、`v1.5`、`V1`、
  主机名 `v1.relay.example` 不算），Core 与内核同一规则。21 条用例写成 Rust 里的一张表，Python 测试从 `.rs` 源码解析这张表、用 AST
  从 payload 取出 `auto_make_url` 逐条跑，两侧不会悄悄漂移。
- **文档**：两份设计文档（picker 规则重写、Onboarding 自定义卡例外，顺带理顺显示名称在 Onboarding 折叠的旧矛盾）、
  `model-configuration.md` 预设表（补上漏掉的 ChatGPT / Codex 与 Custom）、`product-and-onboarding.md`、README 中英两份、
  `ga-baseline.md` 契约面第 18 条（Core 探测与 `auto_make_url` 的耦合）、deferred 的 Ollama 条目（自定义已能接本地端点，具名预设只剩便利）。

## 没跟的

- 外置 GA 仍走上游规则，粘 Gemini 地址照样多插 `/v1/`，只能用 `$` 钉死地址。
- Core 拼 URL 前会先去掉末尾的 `/models`、`/responses`、`/messages`，内核不会：地址写成 `…/v1/models` 时测试连接能过、实际请求是
  `…/v1/models/chat/completions`。已知差异，记在契约面第 18 条。
- Gemini 兼容层是否接受 Galley 请求里的非标准内容（助手历史的 `reasoning_content`、空内容的 `"."` 占位、可能为空的 tool call id）没有
  实测；地址修好后用自定义接 Gemini，若仍失败要从这里查。
- 编辑模式下切换协议会改掉 provider 的协议，已有模型的预设层不跟着变（以前编辑时换卡同样如此）。
- 非自定义卡留空名称时，Onboarding 取 hostname（丢端口），Settings 由 Core 回退成完整 URL，两边不一致；原有行为。

## 验证

- GUI：typecheck、lint（`--max-warnings 0`）绿；vitest 577 passed（新增：自定义卡草稿为空地址 / 空模型 / 协议默认值、协议切换取对应默认、
  不匹配的记录回到自定义卡并带记录的协议、第一个模型的预设层按最终地址判定、主机含端口的名称回退）。
- Rust：`managed_model_probe` 6 passed；把规则临时改回纯数字，4 个测试转红，报错正是 issue 里的错误 URL。
- Python：pytest 501 passed；用改补丁前的 payload 跑共用用例，21 条里 5 条失败（Gemini 三条、`v1beta1`、`v2alpha`）。
- 补丁栈：干净克隆 GA 基线 `1b6442f` + Galley HEAD，构建脚本 26 个补丁全部 clean，`managed-ga/code` 与 `state-seed` 共 375 个文件
  哈希与工作树一致，只有 `llmcore.py` 变化；`check-managed-ga-payload`、`check-ga-baseline-drift` 绿。
- 全量：cargo 554 passed、pytest 501 passed、mypy / ruff 干净，`check.yml` 六个门禁脚本绿。
- 真机：dev 版开给 JC 按清单看（Settings 新增与编辑既有中转、协议 chip 中文宽度、Onboarding 11 张卡与自定义的字段顺序、深色与英文），
  JC 随后裁「收尾，最后 push」，没有逐条反馈清单结果；清单留在本节作日后对照。
