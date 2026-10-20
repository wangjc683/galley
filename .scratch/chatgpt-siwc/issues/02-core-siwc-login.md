# 02 · Core：Sign in with ChatGPT 登录与令牌生命周期

Status: needs-dogfood

来源：[PRD](../PRD.md) 裁决 1、2、6 与「探针结果」一节。C 就地接管现有的 ChatGPT 服务商；票 05 删 A 之前，A 与 C 在同一个服务商、同一个 auth_kind 下共存，靠凭据里的 `flow` 区分。

## 要做的

新模块 `core/src/chatgpt_siwc/`，结构参照 `core/src/codex_oauth/`（login / refresh / secret / probe / tests 分文件）。`codex_oauth/` 里 A 的代码不改，只在分派点按 `flow` 走两条路。

1. **host id**：每台安装第一次登录前生成 `urn:uuid:<v4>`，持久保存，此后永远复用，登出也不删。
2. **开始登录**（新 Tauri 命令，名字自定，例如 `start_chatgpt_plan_login`）：
   - 在 `127.0.0.1:0` 上绑定监听，生成 PKCE（S256）、`state`、`nonce`，拼授权 URL：
     `https://auth.openai.com/api/accounts/authorize`，参数 `client_id`、`agent_name_hint`、`ext_agent_host_id`、`response_type=code`、`redirect_uri=http://127.0.0.1:<port>/auth/callback`、`resource=https://api.openai.com/v1`、`scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`、`state`、`nonce`、`code_challenge`、`code_challenge_method=S256`。
   - 首次注册：`client_id=dynamic_agent_client`，`agent_name_hint=Galley`。已有注册（保存过下发的 `client_id` 与 `id_token`）时：用保存的 `client_id`，带 `id_token_hint`，**不带** `agent_name_hint`。
   - 返回 `{ loginId, authUrl, expiresAt }`，由 GUI 打开浏览器。同一时间只允许一个进行中的登录，新开会取消旧的。
3. **回调监听**必须严格满足 `AGENTS.md` Rule 2 的窄例外（主树已改、尚未提交，原文如下）：
   > a sign-in the user starts whose OAuth flow requires a loopback redirect may open a one-shot HTTP listener bound to `127.0.0.1` on an ephemeral port. It lives only while that sign-in is pending, accepts exactly one callback whose `state` matches, then closes; it times out, and it never accepts commands or serves anything else.

   具体做法：只认 `GET /auth/callback`，其他路径 404 且不计数；`state` 匹配的那一次回调返回一个简短的静态页（中英双语「可以回到 Galley 了」），然后关闭监听；超时 10 分钟；有取消命令。
4. **完成登录**（例如 `complete_chatgpt_plan_login(loginId)`）：
   - 等回调。回调参数是 `client_id`、`code`、`scope`、`state`（探针实测）。
   - `error=access_denied`：校验 `state` 后返回有类型的错误，不换令牌。
   - 否则用**下发的** `client_id`、`code`、`code_verifier`、同一个 `redirect_uri`、`resource` 向 `https://auth.openai.com/api/accounts/oauth/token` 换令牌（form 编码）。
5. **验 ID token**：
   - RS256，JWKS 取自 `https://auth.openai.com/.well-known/jwks.json`，按 `kid` 选钥；用已有的 `ring` 依赖验签，不加新 crate，除非理由充分。
   - 校验 `iss=https://auth.openai.com`、`aud` 等于下发的 `client_id`、`exp`、`nonce`。
   - 授权范围不含 `chatgpt.tokens.use.direct` 时：保留注册，返回「没有授予套餐用量」的有类型错误，不进入推理。
6. **存凭据**：
   - 存进 Core 加密库，位置是该服务商的 `api_key_ref`。JSON 带 `"flow": "siwc"`，加上 `clientId`、`accessToken`、`refreshToken`、`idToken`、`scopes`、`expiresAt`、`earliestRefreshAt`（令牌响应里文档没写的字段，探针实测存在）、`sub`、`lastRefreshAt`、`lastRefreshError`。
   - A 的旧凭据没有 `flow` 字段，必须仍按 A 解析。
   - 注册信息（`clientId`、`idToken`、`sub`）另存一份，登出时不删。
7. **服务商与模型**：
   - upsert `mp_chatgpt_codex`，auth_kind 仍为 `chatgpt_codex_oauth`，`api_base=https://api.openai.com/v1`，显示名暂不动（文案归票 04）。
   - 模型记录沿用 `mm_chatgpt_codex_gpt_55`：如果它的 slug 不在 `/v1/models` 的可见列表里，就换成 `gpt-5.6-sol`。
   - 写入后跑一次连接测试，返回值形状与现有 `CodexAuthSetupResult` 一致。
8. **刷新**：
   - 照 `codex_oauth/refresh.rs` 的「按 `apiKeyRef` 加锁、锁前锁后各读一次」模式。
   - 到期前 120 秒内刷新：`grant_type=refresh_token`、`client_id`、`refresh_token`、`resource`。access token、轮换后的 refresh token、到期时间、授权范围一起替换。
   - `invalid_grant`、`invalid_refresh_token`、`token_expired`、`refresh_token_expired`、`refresh_token_invalidated`、`refresh_token_reused`：清掉令牌、保留注册，状态变为「需要重新登录」。
   - 网络错误和 5xx：保留凭据，返回临时错误。
   - **不**回退到 Codex CLI 的 `auth.json`（那是 A 专有的）。
9. **凭据 IPC**：现有通道按凭据的 `flow` 分派。`siwc` 走本模块，返回 `accessToken`，`accountId` 为空（access token 里没有 `chatgpt_account_id`）。
10. **给 runner 的模型配置**：`ManagedRuntimeModel`（`core/src/runner_commands.rs:196`）加一个布尔字段，序列化为 `chatgptPlan`。auth_kind 是 `chatgpt_codex_oauth` 且凭据 `flow=siwc` 时为 `true`，其余情况不输出或为 `false`。这是与票 03 的接口约定；如果 runner 协议有文档（`docs/ipc-protocol.md` 等），一并更新。
11. **模型列表**：新命令（或接进现有「读取模型列表」的分派），`GET https://api.openai.com/v1/models`，响应是 `{"models": [...]}`，取 `visibility == "list"` 的项，返回 `slug`、`display_name`、`context_window`、`supported_reasoning_levels`、`default_reasoning_level`。A 的静态列表（`core/src/managed_model_probe.rs`）不动。
12. **连接测试**：`POST https://api.openai.com/v1/responses`，带 `store: false`、`stream: true`、`instructions`、`input`。Core 发往 `api.openai.com` 的请求，UA 统一为 `Galley (<os>; <arch>)`。
13. **登出**：
    - `siwc` 凭据：向 `https://auth.openai.com/api/accounts/oauth/revoke` 撤销 refresh token（RFC 7009 form：`token`、`token_type_hint=refresh_token`、`client_id`），成功是空的 200；网络错误或 5xx 退避重试几次。无论远端是否确认，都清掉本地令牌，并返回 `remoteRevokeConfirmed`。保留注册与 host id。
    - A 的凭据：登出行为不变（只删本地，**不**撤销）。
14. **Tauri 命令**：在 `core/src/lib.rs` 注册，前端绑定在 `gui/src/lib/managed-models.ts`。检查仓库的漂移检查（`scripts/check-ipc-protocol-drift.mjs` 等）是否要求镜像类型，要求就补上。GUI 界面不在本票范围。

## 验收

- 单元测试覆盖：
  - 授权 URL 的参数（首次注册 vs 再次登录）、PKCE、回调解析（`state` 不匹配、`access_denied`、错误路径不计数）、监听超时与关闭；
  - ID token 验签：用测试 RSA 钥生成的固定样例，验错签名、错 `aud`、错 `nonce`、过期；
  - 刷新轮换与错误分类；
  - 凭据 serde 兼容：没有 `flow` 的 A 凭据仍按 A 解析；
  - IPC 分派与 `chatgptPlan` 的取值。
- CI 里不打真网络。
- `cargo test --manifest-path core/Cargo.toml --workspace`、`cargo check` 全绿；`git diff --check` 干净；`pnpm --dir gui typecheck` 通过（若动了 `gui/`）。
- 日志里不出现令牌、授权码、`id_token`，也不出现带 `id_token_hint` 的 URL（要脱敏）。

## 约束

- 只在给定的 worktree 里工作，不碰主工作树，不跑 `tauri dev`。
- `core/` 不是 rustfmt-clean：只格式化自己动过的文件。
- 提交只点名文件；英文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不改 Agent API / CLI 输出。
- 不加迁移（auth_kind 沿用现有值）。

## Comments

### 2026-10-20 追加（交付后，已转给代理）

- 裁决 9：默认模型取 `/v1/models` 里第一个可见模型；`gpt-5.6-sol` 只在读不到目录或目录为空时兜底；已有模型记录在目录里就保留。在集成线上另加一个提交。
- 断开后重新登录可能卡住：用已保存注册的登录以超时或取消结束时丢掉保存的 `client_id`（保留 host id），下次重新注册。已交回代理，在集成线上另加一个提交（见 PRD「另」）。主会话另加 `44a2c227`：新登录或仍叫「ChatGPT / Codex」的服务商改名为「ChatGPT」，用户改过的名字保留。
