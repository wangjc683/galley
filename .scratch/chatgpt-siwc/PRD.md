# 用 ChatGPT 套餐登录（Sign in with ChatGPT）

Status: active（2026-10-20 裁决 1：走 C，原生接 OpenAI 官方的 Sign in with ChatGPT；裁决 2–6 同日定：删 A、C 就地接管现有服务商）

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
- **没测到**：额度用尽（`subscription_sharing_usage_limit_exceeded`）与其他报错格式；在 ChatGPT 设置里断开后的表现；撤销端点。GA 的解析器会把 `response.failed` 的错误消息显示出来（`managed-ga/code/llmcore.py:382`），但不看 `error.code`；补丁要按错误码给出能读懂的提示和「管理用量」链接，并且不重试不该重试的错误。

## 参考

- OpenAI 文档：注册与登录、模型与推理、预览限制、报错与恢复、令牌参考、账号与会话、UI/UX 规范（developers.openai.com/siwc/…）
- 用户侧说明：learn.chatgpt.com/docs/sign-in-with-chatgpt（额度来自 Codex / ChatGPT work usage，每个应用可设每周 10–100% 的上限）
- CPA 的 SIWC 实现：`router-for-me/CLIProxyAPI` 提交 `7b0319fb`（2026-10-12）
