# 用 ChatGPT 套餐登录（Sign in with ChatGPT）

Status: shipped-on-main（2026-10-20 票 01–06 全部合入并通过真机，等发版；票 07 在做；发版后按 issue-tracker 的生命周期删除本目录。2026-10-20 裁决 1：走 C，原生接 OpenAI 官方的 Sign in with ChatGPT；裁决 2–17 同日定：删 A、C 就地接管现有服务商、对话报错本地化、默认模型取目录第一个、额度显示暂缓、文案叫「ChatGPT 订阅」、订阅标识定为模型名前的 ChatGPT 标志，菜单行同样用标志，设置页服务商小字与「添加」菜单；裁决 18 同日：标志跟着模型走、不跟服务商走，⌘K 与「我的模型」补标志，⌘K 补同名规则）

来源：2026-10-20 JC 提出，依据 Codex 负责人 Tibo 的推文，考虑以 CLIProxyAPI（CPA）的形式内嵌，让用户用 ChatGPT 订阅里的 Codex 额度跑 Galley。
对比后改走官方的 Sign in with ChatGPT（下称 SIWC）：DevDay 2026 推出，开源项目与本地运行的应用可自助接入，Galley（MIT、本机运行）在范围内。

## 一句话

用户点「Continue with ChatGPT」，以 Galley 的名义授权，用自己 Plus / Pro 套餐的额度跑托管内核；用户在 ChatGPT 设置里看得到 Galley、能限额、能断开。

## 裁决

1. **走 C，不内嵌 CPA**（2026-10-20）。
   - Tibo 两条推文的界线是「一人一号自己用」与「转供 / 共享」，与工具无关（2026-07-12 推荐 CPA 的做法，2026-08-21 划线）；Galley 现有登录本就在线内，推文没有带来新许可。
   - CPA 的经典 Codex 登录与 Galley 现有登录用同一个 `client_id`（CPA `internal/auth/codex/openai_auth.go:27`，Galley `core/src/codex_oauth/mod.rs:54`），对 Codex 不增加任何能力。
   - 否掉 B（内嵌 CPA）的理由：常驻 HTTP 网关，违背 Rule 2 本意；凭据要交给 CPA 的文件存储；近 30 天发了 47 个版本、每平台 20–22MB Go 二进制；多一层协议转换会丢掉 0007 的额度提示；Anthropic 2026-02 已禁止 Pro / Max 的 OAuth 用于第三方产品；常驻网关是重 harness。
   - D（用户自己跑 CPA，用自定义服务商指过去）今天就能用，文档里写一行即可。
   - 现有登录（A：借 Codex CLI 身份，设备码 + 导入 Codex CLI 登录）原定保留作回退，已被裁决 5 取代。

2. **Rule 2 加窄例外**（2026-10-20）：用户发起的、需要回环回调的 OAuth 登录，可以在 `127.0.0.1` 的随机端口开一个一次性 HTTP 监听，只在登录进行中存在，只收一次 `state` 匹配的回调，然后关闭；有超时，不接受命令、不提供任何别的服务。原文见 `AGENTS.md` Rule 2。
3. **先跑探针再立票**（2026-10-20）：JC 用 Pro 账号授权一次；脚本与结果在会话 scratchpad，不进仓库。
4. **票 01 先派**（2026-10-20）：修免密钥服务商存不进库的 bug（galley#24 的约束漏了 `none`），与 SIWC 解耦，见 [票 01](./issues/01-providers-auth-kind-check.md)。

5. **删 A**（2026-10-20，JC 提议）：条件是探针跑通且 C 真机验收通过，任一不过 A 原样保留；与 C 同一版本发，不留过渡版本；单独一张票，C 验收后再派。
   - 理由：A 刷新时要把令牌写回 `~/.codex/auth.json`（`core/src/codex_oauth/secret.rs:130-197`），因为与 Codex CLI 共用一个 refresh token；冒用 Codex CLI 身份（`client_id`、`codex_cli_rs` 的 UA 与 originator）；0007 是升级上游时最常冲突的补丁；JC 本机与仓库 issue 都没有 A 的使用证据；两条登录路径在 v0.2.4 冒烟时就让人困惑过。
   - 代价：SIWC 用户文档只写了 Plus / Pro，其他套餐的用户以后只能用 API key；SIWC 还在预览期，变动时 ChatGPT 这边没有退路（API key 服务商一直在）。不留隐藏回退：没有遥测，就没有信号判断何时能删。
   - 做法：老用户的 ChatGPT 服务商就地变成 C，服务商、模型记录与会话绑定不动，`api_base` 换成 `https://api.openai.com/v1`，删掉 A 的本地令牌，卡片与会话提示「需要用 ChatGPT 重新登录」；**不撤销** A 的令牌（可能与 Codex CLI 共用，撤销会把 Codex CLI 也登出），也不再写 `~/.codex/auth.json`；收到 `subscription_sharing_user_not_eligible` 时提示改用 API key，不重试、不反复拉登录。
   - 一起删：设备码登录、CLI 导入与写回、WHAM 额度查询、`core/src/managed_model_probe.rs` 的 Codex 静态模型列表、补丁 0007、GUI 设备码卡片与导入入口、相关文档；暂缓项「Codex 读取模型列表与预设不同步」随之关闭。凭据 IPC 与刷新闸门保留给 C 用。
6. **C 就地接管现有服务商**（2026-10-20，取代当天早些时候批的「新 auth_kind + 新服务商」）：沿用 `mp_chatgpt_codex` 与 `chatgpt_codex_oauth`，不加新值。原方案的前提是 A 与 C 并存，删 A 后不再成立；而且 providers 表是 `managed_models` 的外键父表，每改一次约束都要冒级联删除的风险重建表（v0.2.9 同类事故，`core/src/migration_backup.rs:422`）。开发期 A 与 C 共用这个值，由 Core 写进模型配置的标记区分路由，删 A 时一起删掉。票 01 因此只补 `none`。

7. **对话里的套餐报错按错误码显示中文提示和按钮**（2026-10-20，走查发现）：
   - 额度用尽：标题「已达到用量上限」，主按钮「管理用量」，指向 `https://chatgpt.com/settings/usage`；
   - 登录失效（`token_revoked` 或 `chatgpt_plan_reauth_required`）：显示「去设置登录」；
   - 不符合资格：建议改用 API key 服务商。

   引擎的英文原文保留在详情里。补进票 04。
8. **对话收到 `token_revoked` 时，界面触发一次连接测试**（2026-10-20）：让 Core 立刻发现授权已撤销，设置卡片马上变成「需要登录」，而不是等最长一小时到下次刷新。补进票 04。
9. **默认模型取账号目录里第一个可见模型**（2026-10-20）：`gpt-5.6-sol` 只在读不到目录或目录为空时兜底；已有的模型记录如果在目录里，就保留用户的选择。补进票 02。

10. **额度显示暂缓，现在只给「管理用量」入口**（2026-10-20）：SIWC 令牌读不到 5 小时 / 7 天用量（探针实测，另见 openai/codex#54219）。借旧登录查 WHAM、自己累计 token 两条路都否掉。暂缓项见 `docs/devlog/deferred.md`「ChatGPT 套餐的额度显示」；票 04 合入后，用正式登录抓一次 `response.metadata` 的内容。

11. **用户文案叫「ChatGPT 订阅」，英文「ChatGPT plan」**（2026-10-20，JC 真机后提出）：用户心里是「用我订阅的额度」，OpenAI 中文帮助中心也把 Plus 叫「付费订阅」；英文沿用 OpenAI 规范的用词。全界面一起改；「套餐」只在引用 OpenAI 原话时用。原来「没有勾选『使用 ChatGPT 套餐』」那句不再照抄授权页（中文原文未知），改成说明性的写法。
12. **标识放输入框（B），样式真机三选一**（2026-10-20）：JC 选了 B，但现在的样式读起来像强度。临时切换器换成三档，按从克制到显眼排：
    - 1 标志：模型名前加 ChatGPT 标志，菜单头保留文字；
    - 2 右端：「标志 + ChatGPT 订阅」放在这一行最右边；
    - 3 徽标：短语后面跟一个杏色浅底的标签。

    09-22 否过这一行的灰底徽标 chip（`docs/design/conversation.md:1047`），但那次是强度参数，这次是费用来源，所以重新比一次。

13. **订阅标识定为第 1 档「标志」**（2026-10-20，JC 真机比过三档：最舒服、最安静）：
    - 当前对话的模型走订阅时，模型名前面加一个 13px 的淡色 ChatGPT 标志；
    - 模型 pill 的提示多一行「使用 ChatGPT 订阅」；
    - 模型菜单里订阅模型的上方保留「ChatGPT 订阅 · 管理用量」一行，OpenAI 要求的文字和「管理用量」链接都在这里。

    这一条推翻 `docs/design/conversation.md` 1013 行「模型名，无箭头、无图标」，作为窄例外：标志说的是费用从哪里出，不是模型参数。2、3 档和临时切换器在票 05b 里拆掉。

14. **模型菜单里也用标志表示订阅**（2026-10-20，JC 真机发现订阅模型行常显「ChatGPT」、其他行悬停才显）：
    - 原因：05-28 的同名规则（`9f56cabd`）。两个模型显示名相同时常显服务商；JC 的「gpt-6.1-sol」同时有 CPA 和 ChatGPT 两份。这条规则从没写进设计文档。
    - 做法：
      - 订阅模型的菜单行，名字前放和输入框同一个 13px ChatGPT 标志；
      - 去掉列表中间按位置插入的分组头（订阅模型被拖到中间时，它下面的行会像归在这个分组里），「ChatGPT 订阅 · 管理用量」挪到菜单底部动作栏，和「配置模型…」同一档，只在有订阅模型时出现；
      - 同名规则补一条：同名的几行里只要标志能把它们区分开，就不常显服务商；仍然无法区分的才常显。
    - 设计文档补上同名规则。随票 05b 做。

15. **服务商小字改说「怎么接」**（2026-10-20，JC 真机走查设置页提出，按推荐）：ChatGPT 写「ChatGPT 订阅」，官方地址写「官方 API」，其余仍写「OpenAI 兼容 / Anthropic 兼容」。不写「OpenAI 官方」：订阅额度不是官方 API 的按量计费，写「官方」容易让人以为是 API 账单。见票 06。
16. **「添加」直接弹出服务商列表**（2026-10-20，按推荐）：原来点「添加」后先出一张空表单、再点下拉、再选，三下；改成两下。没服务商时的状态不变。07-17 的「Settings 端保留紧凑 popover picker」只说了保留，没写理由；平铺卡片会把设置页撑开，所以否掉。见票 06。

17. **「添加」菜单改成单行，11 项一屏放下**（2026-10-20，JC 真机发现菜单只露出 7 项、看不出能滚，按推荐）：
    - 原因：每项两行约 52px，菜单在 JC 的窗口里约 368px 高，SiliconFlow、Xiaomi MiMo、Zhipu GLM 和「自定义」藏在下面。「自定义」是中转、本地服务的唯一入口。macOS 默认不显示滚动条，第 7 项又正好完整收在边缘，看起来就像列表到头了。
    - 做法：每项一行，预设名加淡色说明，说明截断、悬停看全文；窗口再小时用上下渐隐作兜底。「自定义」仍排最后，和引导页一致。没做切换器。
    - 否掉：两列网格（要加宽到约 440px，在设置页里不像菜单）、只加渐隐（还是要人自己去滚）。

18. **订阅标志跟着模型走，不跟服务商走**（2026-10-20，JC 问模型配置页的其他地方要不要统一加 logo；按推荐，两个追问点 JC 都选「做」）：
    - 规则：界面上出现一个会花 ChatGPT 订阅额度的模型，名字前就放标志；服务商身份不放（服务商卡、「添加」菜单、引导页网格）。裁决 13 的「其他服务商不加 logo」不变。
    - 理由：ChatGPT 标志就是 OpenAI 的花形标。给服务商加 logo 时，「OpenAI（官方 API）」也会是同一朵花，标志就从「费用从订阅出」变成两义，和裁决 15 不写「OpenAI 官方」是同一个顾虑。服务商卡上它和卡名、「ChatGPT 订阅」小字重复，整列只有它带 logo，读起来像推广。
    - 补两处：
      - ⌘K「切换模型」的订阅行：现在每行都是 `Cube` 加名字，不显示服务商，JC 那对同名的 gpt-6.1-sol 是两行一模一样的字；
      - 设置 → 我的模型的订阅行：这份列表就是模型菜单的来源（「顺序 = 切换菜单顺序」），同一行在两处应该长得一样。
    - 顺带：⌘K 补上模型菜单的同名规则（`providerLabelAlwaysShown`），同名、标志又分不开的行常显服务商。
    - 否掉：所有服务商都上 logo（一图两义、11 份素材、「自定义」没有 logo）；ChatGPT 服务商卡名前也加（标志兼任服务商身份）。
    - 见 [票 07](./issues/07-plan-mark-follows-the-model.md)。

另：走查发现登录完成后，引导页和设置页不看连接测试结果（`gui/src/lib/provider-setup.ts:491`），测试失败也会结束引导。不符合资格的账号能登录成功、却过不了测试，正好踩中这个坑。按缺陷补进票 04：测试失败时停在原步骤，说明原因。

另：断开后重新登录可能卡住（票 02 代理报告的风险，主会话汇总时漏报，旁路代理提醒）：
- 原因：在 ChatGPT 设置里断开 Galley 后，保存的 `client_id` 可能被作废；按 OAuth 规范，授权页对无效的客户端只显示错误、不跳回，Galley 收不到回调，而每次重试都沿用旧编号，只能等到 10 分钟超时。
- 补救：用已保存注册发起的登录以超时或取消结束时，丢掉保存的 `client_id`，保留 host id，下次重新注册；等待态加一句「浏览器里报错了？点取消再登录一次」。
- 代价：普通的一次取消也会导致重新注册，ChatGPT 设置里可能多一条「Galley」。
- 真机清单第 5 步（断开后重新登录）验证这一点。

## 探针结果（2026-10-20，JC 的 Pro 账号，模型 `gpt-5.6-sol`）

脚本与原始结果在会话 scratchpad，不进仓库；下文不含令牌、邮箱、client_id。

- **登录**：首次登录用随机端口（`127.0.0.1:51960`）即可，不必占 1455。回调参数为 `client_id`、`code`、`scope`、`state`，下发的 `client_id` 以 `oaiapp_` 开头。授权范围含 `chatgpt.tokens.use.direct`。OIDC 元数据里没有设备码端点（`device_authorization_endpoint: null`），所以回环是唯一的登录方式。
- **令牌**：令牌响应的字段是 `access_token`、`refresh_token`、`id_token`、`scope`、`expires_in`（3600）、`token_type`，另有一个文档没写的 `earliest_refresh_at`（约在签发后 54 分钟）。ID token 用 RS256 签名，`iss` 为 `https://auth.openai.com`，`aud` 等于下发的 `client_id`，`nonce` 能对上；JWKS 在 `https://auth.openai.com/.well-known/jwks.json`，撤销端点是 `https://auth.openai.com/api/accounts/oauth/revoke`。access token 里**没有** `chatgpt_account_id`，所以不发 `ChatGPT-Account-ID` 头。
- **刷新**：`grant_type=refresh_token` + `client_id` + `refresh_token` + `resource`，返回 200，refresh token 会轮换，新令牌可直接用。早于 `earliest_refresh_at` 刷新也能成功。
- **模型列表**：`GET /v1/models` 返回 `{"models": [...]}`，每项是 Codex 风格的完整目录（`slug`、`display_name`、`visibility`、`context_window`、`supported_reasoning_levels`、`default_reasoning_level` 等）。可见（`visibility: list`）的有 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`。
- **请求格式**：
  - GA 现在发的平铺 function tools 能用，不需要包 namespace；包了也能用，返回的调用会带 `namespace` 字段。所以文档里的「必须分组」至少对这个模型没有强制，维持平铺。
  - `prompt_cache_key`、`client_metadata`、`include: reasoning.encrypted_content`、`reasoning.effort` 都收。
  - 不发 `store: false` 会返回 400 `Store must be set to false`。
- **GA 原样跑通**：用 GA 自己的 `_openai_stream`（请求加解析整条路径）、现有 Codex 分支的请求格式、端点换成 `https://api.openai.com/v1`，两轮带工具调用都跑通（第一轮调 `code_run`，第二轮回答 `The result is 2.`）。
- **缓存**：约 4000 token 的提示词、带同一个 `prompt_cache_key`，6 次命中 5 次（每次 3840 token）；不带 key 是 3 / 6；`session_id` 头没有影响。最早 3 次全没命中，是缓存还没暖。
- **响应头**：没有额度类的头，只有 `x-codex-safety-buffering-*` 和 `x-codex-turn-state`。开了安全缓冲时，最终文本可能只出现在 `response.output_text.done` 里、没有 delta；GA 的解析器已经能处理。
- **撤销**：按 RFC 7009 的 form（`token`、`token_type_hint=refresh_token`、`client_id`）调用，成功返回空的 200，重复撤销也是 200。撤销后：
  - 刷新返回 400 `{"error": "invalid_grant", "error_reason": "refresh_token_invalidated", ...}`，具体原因在 `error_reason` 里；
  - 尚未过期的 access token 立刻失效，`/v1/responses` 返回 401，`error.code` 为 `token_revoked`。在 ChatGPT 设置里断开应该是同样的表现。
- **补丁后的内核**（票 03 的 `f207502e`）真机验过：UA 为 `Galley (Darwin; x86_64)`，没有 `originator` 和账号头；两轮带工具调用正常；不存在的模型立即返回 400（`... is not supported when using Codex with a ChatGPT account`），不重试。这条报错也印证了套餐用量就是 Codex 的用量。
- **没测到**：额度用尽（`subscription_sharing_usage_limit_exceeded`）与其他结构化报错的实际格式；在 ChatGPT 设置里断开后的实际表现。GA 的解析器会把 `response.failed` 的错误消息显示出来（`managed-ga/code/llmcore.py:382`），但不看 `error.code`；补丁要按错误码给出能读懂的提示和「管理用量」链接，并且不重试不该重试的错误。

## 参考

- OpenAI 文档：注册与登录、模型与推理、预览限制、报错与恢复、令牌参考、账号与会话、UI/UX 规范（developers.openai.com/siwc/…）
- 用户侧说明：learn.chatgpt.com/docs/sign-in-with-chatgpt（额度来自 Codex / ChatGPT work usage，每个应用可设每周 10–100% 的上限）
- CPA 的 SIWC 实现：`router-for-me/CLIProxyAPI` 提交 `7b0319fb`（2026-10-12）
