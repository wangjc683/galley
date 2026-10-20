# 05 · 删掉借 Codex CLI 身份的旧登录（A）

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 5、6。2026-10-20 JC 真机确认新登录可行（登录、对话都过了），条件满足，A 整体删除。分两段：05a（Core、runner、内核、文档）现在做；05b（GUI）等 04b 交付后接着做。两段合在一起合入。

## 保留不动的东西

- **数据里的 ID 和取值**：`auth_kind` 的值 `chatgpt_codex_oauth`、服务商 ID `mp_chatgpt_codex`、模型 ID `mm_chatgpt_codex_gpt_55`。C 在用，改名要动库，不改。代码里的常量名可以改。
- **凭据 IPC 通道**：API key 服务商也在用，wire 格式（请求 `{token, apiKeyRef}`，响应 `accessToken` 等）不变。它现在住在 `core/src/codex_oauth/ipc.rs`；删 A 后如果 `codex_oauth` 只剩它，就把它挪到独立模块（例如 `core/src/credential_ipc/`），类型名去掉 Codex 字样。
- **外置 GA（attach 模式）**：零变化。

## 05a：Core、runner、内核、文档

1. **删 A 的代码**：
   - 设备码登录、导入 Codex CLI 登录；
   - 刷新时写回 `~/.codex/auth.json`，以及失败后从 `auth.json` 恢复；
   - WHAM 额度查询（`codex_oauth/usage.rs`）、A 的连接测试；
   - `core/src/managed_model_probe.rs` 里写死的 Codex 模型列表；
   - Tauri 命令 `start_chatgpt_codex_login`、`complete_chatgpt_codex_login`、`import_chatgpt_codex_cli_login`、`logout_chatgpt_codex_provider`；
   - 各处按 `flow` 区分 A / C 的分派，只留 C 的路。
2. **老用户的旧凭据**：ChatGPT 服务商存的凭据如果不是 `"flow": "siwc"`，就当作没有凭据，在 Core 启动时一次性处理（可重入）：
   - 从加密库删掉这份凭据，**不撤销**（可能与 Codex CLI 共用，撤销会把用户的 Codex CLI 一起登出），**不写** `~/.codex/auth.json`；
   - 服务商的 `api_base` 改为 `https://api.openai.com/v1`；服务商和模型记录、会话绑定一律保留。

   之后界面看到的就是「需要登录」，用户点「用 ChatGPT 登录」即完成迁移（C 的登录会就地接管、修正模型）。
3. **内核补丁 0007**：
   - 删掉 A 专有的部分：`codex_cli_rs` 的 UA 与 originator、`ChatGPT-Account-ID` 与从 JWT 取账号 ID、WHAM 额度提示；
   - 套餐路由成为 `codex_backend` 唯一的行为，`chatgpt_plan` 标记要不要保留由你定，在实现说明里写清；
   - 补丁文件名改不改也由你定（改名要同步 `managed-ga/manifest.json` 与 `managed-ga/patches/manifest.md`）；
   - 按 `docs/managed-ga-runtime/code-state-and-patches.md` 的流程重放、重新导出后续补丁、重建 `managed-ga/code`。
4. **runner**：`runner/managed_runtime.py` 的 `chatgpt_codex_oauth` 分支随之简化，测试跟着改。
5. **文档**：
   - `docs/managed-ga-runtime/model-configuration.md` 的「ChatGPT / Codex OAuth」一节删掉，SIWC 一节改为唯一的「ChatGPT（Sign in with ChatGPT）」；
   - `docs/devlog/deferred.md` 删掉「Codex「读取模型列表」与预设不同步」一节；
   - grep `codex_oauth`、`Codex CLI`、`auth.json`、`WHAM`，清掉 `docs/` 里描述现状的过期说法；devlog 是历史，不改。
6. **测试**：删 A 的测试；为第 2 条加测试——旧凭据被清掉且没有撤销请求、`api_base` 被改写、记录保留、重复启动是空操作、`flow=siwc` 的凭据不受影响。

## 05b：GUI（04b 交付后）

- 删设备码卡片（`CodexDeviceCodeCard.tsx`）、导入 Codex CLI 登录、「其他登录方式」折叠区、`runCodexComplete` 与控制器里 A 的分支、`gui/src/lib/managed-models.ts` 里 A 的绑定、A 专用文案（`chatgptCodex*`、`codexCli*` 等）。
- 预设 `chatgpt-codex` 的 `apiBase` 改为 `https://api.openai.com/v1`，并清掉只对 A 有意义的字段。
- 设计文档两处过期的说法一起改：`docs/design/onboarding-and-cards.md:38`（设备码登录）、`docs/design/overlays-and-settings.md:414`（「Codex 跳过」自动读取）。
- 文案规范里「凭证」一行提到「ChatGPT / Codex 登录」，改成现在的说法。

## 验收

- **Rust**：`cargo test --manifest-path core/Cargo.toml --workspace`、`cargo check` 全绿。
- **runner**：pytest、mypy、ruff 全绿。
- **检查脚本**：`check-managed-ga-payload`、`check-ga-baseline-drift`、`check-docs-links`、`check-ipc-protocol-drift` 通过；`git diff --check` 干净。
- **GUI（05b）**：typecheck、lint、test 全绿。
- **删干净**：`grep -rn "auth.json\|wham\|codex_cli_rs\|device.*login\|import_chatgpt_codex" core/src runner managed-ga/code gui/src` 只剩有意保留的地方，并在实现说明里列出。

## 约束

- 只在给定的 worktree 里工作，不碰主工作树，不跑 `tauri dev`。
- `core/` 不是 rustfmt-clean，只格式化自己动过的文件；gui 不是 prettier-clean，只格式化自己的 hunk。
- 不加 SQL 迁移（取值不变）；第 2 条在 Rust 里做。
- 提交只点名文件；英文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Comments
