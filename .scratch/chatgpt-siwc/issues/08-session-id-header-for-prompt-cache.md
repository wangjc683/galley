# 08 · 订阅后端的请求带上 `session_id` 头，让提示词缓存命中

Status: needs-dogfood（2026-10-26 合入 `1ead009c`；主会话机器验收：worktree 里复跑 pytest 628 通过、mypy、ruff、`git diff --check`、两个补丁载荷检查都过；合入后对真后端复测通过，见 Comments 末条）

来源：2026-10-26 主对话上下文管理讨论的 T1（JC：「先做 T1」）。只改补丁 `0007` 与它的测试；外置运行时零变化，非订阅后端零变化。

## 现象

- 主对话换到 ChatGPT 订阅后端之后，缓存命中率按天是 14%、5.8%、11%、0.9%（10-21、22、23、26，全库）；换之前 61%–81%（10-16、10-20 全库 61%、74%，10-17 到 10-19 主对话 81%，见 `docs/devlog/2026-10-19-prompt-layers-what-to-fetch-on-demand.md`）。
- 10-26 主对话一次 8 步的浏览器运行：输入 12.8 万 tokens，命中 0。同一次运行里相邻请求只隔几秒、前缀几乎不变。
- 命中率 = cacheRead ÷（input + cacheRead）：追踪器里的 `inputTokens` 是未命中的部分（`managed-ga/code/frontends/cost_tracker.py:343` 同一口径）。

## 诊断（主会话探针，直接驱动 GA 自己的 `NativeOAISession` / `NativeToolClient`，脚本在主会话 scratchpad，不进仓库）

1. **不是 GA 改了前缀**：相邻请求的 `instructions`、`tools`、`prompt_cache_key`、`client_metadata`、`include`、`reasoning` 全部相同，`input` 是上一条的严格延长（逐项比对）。
2. **原样连发同一个请求也不命中**：约 3.4k tokens，连发 5 次 0 命中；每次隔 30 秒发 4 次，也是 0 命中。
3. **偶尔命中，像是随机落到了持有缓存的那台机器**：带工具定义时，每 6 次约命中 1 次。换 `gpt-6-astra` 一样（0/6），不是模型的问题。
4. **逐个变量排除**（每组 6 次，同一请求原样连发）：
   - 回传响应头 `x-codex-turn-state`：0/6
   - 保留 `Set-Cookie`：1/6（那 1 次是跨进程共有的前缀）
   - turn-state 加 cookie：1/6
   - 请求头带 `x-codex-window-id`：1/6
   - **请求头带 `session_id`（值同 `prompt_cache_key`）：6/6**
5. **真实形态复核**：用 GA 的工具定义、真实系统提示词与 Galley 运行时层，跑会增长的 6 步对话。带 `session_id` 时后 5 步全部命中（97%–98%）；不带时 5 步只中 1 步。
6. **延迟没有变差**：带与不带交替各跑 3 组、每组 4 次。带 12 次命中 8 次，中位 3.95 秒；不带 12 次命中 2 次，中位 4.2 秒。新会话的头一两次请求可能还没热起来。
7. 官方 Codex CLI 0.164 的二进制里有 `session_id`、`x-codex-turn-state`、`x-codex-routing-hint` 等请求头名；本机 Codex CLI 的登录已过期（刷新令牌已被用过），所以没做官方客户端对照。
8. 修正：SIWC 探针当时记「`session_id` 头没有影响」（`../PRD.md` 探针结果「缓存」一条），是在命中率本来就高的那天测的；今天的后端上，它是唯一起决定作用的变量。

## 根因

订阅后端靠请求头 `session_id` 把同一会话的请求落到同一处，缓存才用得上；`prompt_cache_key`（请求体）、`client_metadata` 里的 window id、turn-state、cookie 都替代不了。补丁 `0007` 发的请求没有这个头。

## 要做的

1. **补丁 `0007`**：`managed-ga/code/llmcore.py` 里订阅后端设请求头的那一行（`_openai_stream` 里 `if getattr(sess, 'codex_backend', False):` 下面一行），在行尾追加 `headers["session_id"] = _RESP_CACHE_KEY`，与请求体的 `prompt_cache_key` 同值。写在同一行，文件行数不变，后面改 `llmcore.py` 的补丁不受影响（仍要按下面第 3 条逐字节核对）。只在 `codex_backend`；`originator` 照旧不发（SIWC「以 Galley 自己的身份发」）。
2. **按 `docs/managed-ga-runtime/code-state-and-patches.md`「How To Modify An Existing Patch」改**：改 `.patch` 文件本身（零上下文 diff），不直接改 `code/`；`managed-ga/patches/manifest.md` 里 `0007` 那一行补上「`session_id` 头：缓存命中」与本票链接。
3. **重放**：用 `managed-ga/manifest.json` 里 `upstream.commit` 的干净上游克隆跑 `scripts/build-managed-ga.sh`，重放后 `git status` 干净，`code/` 与提交的版本逐字节一致。
4. **测试**（`runner/tests/test_managed_ga_llmcore.py`）：
   - `test_chatgpt_plan_sends_galley_headers_and_codex_body`（`:649`）加断言：`headers["session_id"] == payload["prompt_cache_key"]`。
   - `test_without_the_codex_backend_ga_headers_are_unchanged`（`:773`）加 `"session_id" not in headers`。
5. **文档**：查 `docs/managed-ga-runtime/` 与 `docs/ipc-protocol.md` 里描述订阅后端请求头的现行说法，有就补一句；PRD 探针结果那条与 devlog 的历史记录不动。

## 别动

- `x-codex-turn-state`、cookie、`x-codex-window-id` 头：测过，没有效果，不加。
- 非订阅后端（API key 的 OpenAI 兼容、Claude 协议）的请求头。
- `prompt_cache_key` 的生成方式（每个进程一个，主对话每段一个新 runner）。
- `gui/`、`core/`、`cli/`。

## 验证

- `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`
- `scripts/build-managed-ga.sh` 重放干净
- `git diff --check`；中文全角标点

## 合入后

- 主会话用 scratchpad 里的探针对真后端复测一次：同一请求连发 6 次、增长对话 6 步，后续请求都应命中。
- 已经开着的 runner 用的还是旧代码。主对话下一段（或重启 runner）起生效；IM 渠道重启后生效。
- 按天看 `messages.telemetry_json` 的命中率，用订阅后端的会话应回到七八成以上。

## 给 JC 的真机步骤

1. 合入后在设置里重启 Channels；主对话等到下一段，或让主会话代为重启 runner。
2. 主对话里问一件要查几步的事。
3. 主会话查这一轮的 `cacheReadTokens`：应占输入的大半，不再是 0。

## Comments

### 2026-10-26 实现（worktree 子代理）

- **补丁**：只改 `managed-ga/patches/0007-managed-codex-backend.patch` 里订阅后端设请求头那一条 `+` 行，行尾追加 `; headers["session_id"] = _RESP_CACHE_KEY`。没加行，hunk 头不动，`llmcore.py` 仍是 1503 行，`0008`、`0021` 不用重导。`originator` 照旧不发；`x-codex-turn-state`、cookie、`x-codex-window-id` 头都没加。
- **重放**：干净克隆上游 `a9a36b4b219593369de01c3e5973e56ac02e568b` 跑 `scripts/build-managed-ga.sh`，27 个补丁全部应用，`py_compile` 扫描通过。重放后 `managed-ga/code/` 里只有 `llmcore.py` 第 722 行与主工作树不同（`diff` 只报这一行），`state-seed/` 无变化，没有 `__pycache__`。`check-managed-ga-payload.mjs`、`check-ga-baseline-drift.mjs` 通过。克隆已删。
- **测试**：`test_chatgpt_plan_sends_galley_headers_and_codex_body` 加 `headers["session_id"] == payload["prompt_cache_key"]`（同函数里已有 `prompt_cache_key` 非空断言）；`test_without_the_codex_backend_ga_headers_are_unchanged` 加 `"session_id" not in headers`。先写断言，对旧载荷跑出 `KeyError: 'session_id'`（红），重放后通过。全量 pytest 628 通过，mypy、ruff 无问题。
- **账本与文档**：`managed-ga/patches/manifest.md` 的 `0007` 行补上 `session_id` 头的用途并链到本票，顶部新增一条 2026-10-26 重放记录（原记录改为 Previous replay）。`docs/managed-ga-runtime/model-configuration.md`「Engine side (patch `0007`)」一段补一句。`docs/ipc-protocol.md` 没有描述订阅后端请求头的现行说法，未改。
- **没验证到的**：没打真后端（按派单要求），命中率复测留给主会话的探针。Core 发的请求（连接测试 `POST /v1/responses`）不带 `session_id`，本票不涉及 `core/`，没动。

### 2026-10-26 合入后复测（主会话）

用合入后的 `managed-ga/code` 原样发请求，不再在探针里手动加头：

- 同一请求原样连发 6 次：后 5 次中 4 次（每次 4,096）；不带这个头的对照是 6 次约中 1 次。
- 会增长的 6 步对话（GA 的工具定义、真实系统提示词与 Galley 运行时层）：后 5 步全部命中，命中 95%–97%。
- 代理报的 Core 连接测试不带 `session_id`：那是单次请求，不涉及缓存，不改。
- 已经开着的 runner 还在用旧代码：主对话下一段起生效，IM 渠道要重启 Channels。
