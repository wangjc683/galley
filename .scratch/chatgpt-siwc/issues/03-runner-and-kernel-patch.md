# 03 · runner 与内核补丁：ChatGPT 套餐路由

Status: needs-dogfood

来源：[PRD](../PRD.md) 裁决 1、5、6 与「探针结果」一节。探针已证明：GA 现有的 Codex 分支请求格式，端点换成 `https://api.openai.com/v1` 后，两轮带工具调用都能跑通。所以本票只做路由标记、请求头和错误处理，不动请求体。

## 与票 02 的接口约定

Core 给 runner 的模型 JSON（`core/src/runner_commands.rs:196` 的 `ManagedRuntimeModel`）会多一个布尔字段 `chatgptPlan`。它为 `true` 时，`authKind` 一定是 `chatgpt_codex_oauth`，`apiBase` 是 `https://api.openai.com/v1`，凭据仍走现有的凭据 IPC（返回 `accessToken`，`accountId` 为空）。本票按这个约定实现，不依赖票 02 的代码先合入；测试里直接构造这个字段。

## 要做的

1. **`runner/managed_runtime.py`**（约 159 行的 `chatgpt_codex_oauth` 分支）：
   - `model.get("chatgptPlan")` 为真时，在现有设置（`codex_backend`、`api_mode=responses`、`stream`、`galley_api_key_ref`、`galley_credential_ipc`、`minimal→medium`）之外加 `cfg["chatgpt_plan"] = True`；
   - 字段不存在时行为与现在逐字节一致。
2. **补丁 0007**（`managed-ga/patches/0007-managed-codex-backend.patch`）。按 `docs/managed-ga-runtime/code-state-and-patches.md` 的「How To Modify An Existing Patch」改，重新导出补丁，更新 `managed-ga/patches/manifest.md` 对应行，`managed-ga/code/` 与补丁保持一致。
   - **请求头**：`chatgpt_plan` 为真时 UA 用 `Galley (<platform.system()>; <platform.machine()>)`，不发 `originator`，不发 `ChatGPT-Account-ID`。
   - **请求体**：与现有 Codex 分支一致（`store: false`、不发 `max_output_tokens`、`prompt_cache_key` 等保留），探针已验证。
   - **额度提示**：`chatgpt_plan` 为真时不查 WHAM（那是 `chatgpt.com` 后端的接口）。
   - **结构化错误**：按 `error.code` 处理。它可能出现在流开始前的 HTTP 错误体里（`{"error": {"code": ..., "param": ..., "message": ...}}`，也可能只有 `{"detail": "..."}`），也可能在流中的 `response.failed` 事件里（GA 解析器在 `managed-ga/code/llmcore.py:382` 已经显示消息，但不看 code）：

     | error.code | 处理 |
     |---|---|
     | `subscription_sharing_usage_limit_exceeded`（429） | **不重试**；消息说明是套餐上限或用户给 Galley 设的上限，附 `https://chatgpt.com/settings/usage`；不推断重置时间 |
     | `subscription_sharing_user_not_eligible`（403） | 不重试；说明这个账号不能在 Galley 里用套餐，建议改用 API key 服务商 |
     | `subscription_sharing_unsupported_capability`（400） | 不重试；消息带上 `error.param` |
     | `subscription_sharing_route_not_supported`、`subscription_sharing_invalid_user`、`chatpass_v2_scope_not_authorized`、`chatpass_v2_invalid_authorization_context` | 不重试；原样带出 code 与消息 |
     | `subscription_sharing_usage_unavailable`、`subscription_sharing_user_unavailable`（503） | 有上限的退避重试（沿用 GA 现有重试） |

     消息语言与现有 0007 的报错一致（英文），并包含 error code，方便 GUI 以后做本地化映射。GA 的 `_stream_with_retry` 默认把 429 当作可重试，要在 `chatgpt_plan` 下对上表的不重试项短路。
   - 以上改动都限定在 `chatgpt_plan` 为真时；A（`codex_backend` 但没有 `chatgpt_plan`）和所有其他服务商的行为不变。
3. **外置 GA（attach 模式）零变化**：本票只动托管内核与 runner 的托管分支。

## 验收

- `runner/tests/test_managed_ga_llmcore.py`（或相邻测试文件）覆盖：
  - `chatgpt_plan` 下的请求头；
  - A 分支请求头不变；
  - 上表每一行的分类（流开始前与 `response.failed` 两种来源）；
  - 429 额度用尽不重试、503 会重试；
  - 不查 WHAM。
- `runner/tests` 覆盖 `managed_runtime.py` 有无 `chatgptPlan` 两种情况。
- 门禁：
  - `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner` 全绿。worktree 里没有 venv 就用主树的：在 worktree 根目录跑 `<主树>/.venv/bin/python -m pytest`，先打印 `runner.__file__` 确认导入的是 worktree 的代码。
  - `node scripts/check-managed-ga-payload.mjs` 与补丁漂移检查通过；`git diff --check` 干净。

## 约束

- 只在给定的 worktree 里工作，不碰主工作树。
- 补丁保持最小、可在上游新基线上重放；不改上游 GA 的非托管路径。
- 不记录令牌；测试里不打真网络。
- 提交只点名文件；英文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Comments
### 2026-10-20 实现说明（代理交付，主会话验收）

- 分支 `siwc-03-runner-patch`（已 rebase 到 `ac6a4d43`）：`02641f7c` 主体，`7b28ce70` 补 `token_revoked`。待合入，和 SIWC 其他票一起合。
- 路由：runner 只在 Core 给出 `chatgptPlan: true` 时设 `chatgpt_plan`，用户在高级选项里写的同名键会被丢掉；内核只在 `codex_backend` 与 `chatgpt_plan` 同时为真时走新路由。请求体不变，只换请求头，并且不查 WHAM。
- 错误处理：按 `error.code` 分类，流开始前的 HTTP 错误体和流中的 `response.failed` / `error` 事件都覆盖。终止类错误跳过 GA 对 429 的重试和流内的过载判断；两个 `*_unavailable` 走 GA 原有的退避；Galley 不认识的错误码保持 GA 原样。后加的 `token_revoked` 也归为终止类，提示用户回设置里重新登录。
- 补丁：0007 在同一基线上重放后修改，0008 与 0021 重新导出（只有行号变化）；`build-managed-ga.sh` 重建后只有 `llmcore.py` 变化，且与重放结果逐字节一致。
- 验证：
  - pytest 591 条通过（新增 38 条）；mypy、ruff、`check-managed-ga-payload`、`check-ga-baseline-drift`、`check-docs-links` 全过。
  - 主会话用探针令牌真机跑过补丁后的内核：UA 为 `Galley (Darwin; x86_64)`，没有 `originator` 和账号头；两轮带工具调用正常；不存在的模型立即返回 400、不重试。
- 没验到：额度用尽等结构化报错的真实格式（只按文档在测试里构造）、在 ChatGPT 设置里断开后的真实报错、Windows 上 `platform.machine()` 的取值、与票 02 的端到端联调。
- 合入提示：本票和票 02 都可能改 `docs/managed-ga-runtime/model-configuration.md`，合入时留意冲突。
