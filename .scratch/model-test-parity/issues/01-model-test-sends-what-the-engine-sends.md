# 「测试模型」发的请求头与内核一致，并修掉 OpenAI 新模型测试必败

Status: needs-dogfood（2026-11-17 合入 `150b0d62`、`6193e555`，门禁全过；等 JC 用真实 key 验）
日期：2026-11-17
来源：票 `.scratch/anthropic-official-identity/issues/01-…` 的两条票外发现，加上 JC 当天实测到的一个 bug。前两部分 JC 已裁（见各节）；第三部分是 bug 修法，JC 未裁，不要可撤。

## 背景

「测试模型」存在的意义是：它过了，对话就能用。Core 的测试请求（`core/src/managed_model_probe.rs`）自己手写请求头，内核的对话请求（`managed-ga/code/llmcore.py`）用另一套，两边已经不一样：

| | Core 的测试请求 | 内核的对话请求 |
|---|---|---|
| Anthropic 协议的 UA | `claude-cli/2.1.113 (external, cli)`，2026-05-25 起没动 | `NativeClaudeSession.native_ua`，随基线升级变过三次 |
| Anthropic 协议的 beta | 4 个 | `raw_ask` 里的 `beta_parts`，9 个 |
| Anthropic 协议的其他头 | 无 | `Accept`、`X-Claude-Code-Session-Id`、一组 `X-Stainless-*` |
| Anthropic 协议请求体的 `metadata` | 无 | Claude Code 格式的 `user_id` |
| 模型名带 `[1m]` | 待确认（见「怎么改」） | 去掉后缀，beta 列表第二位插入 `context-1m-2025-08-07` |
| OpenAI 协议 | 只有鉴权头 | 另带 `User-Agent`（`NativeOAISession.native_ua`，即 `codex_exec/…`）和 `originator: codex_exec` |

2026-11-17 已经证明请求头能决定请求成不成功（带 Claude Code 标识的请求花不了订阅附带的额度）。`docs/ga-baseline.md` 里 2026-10-06 那条「不算基线同步面，只记录」的结论因此作废。

## 第一部分：官方 Anthropic 的 UA 与 ChatGPT 登录统一

JC 裁定：用 `Galley (<os>; <arch>)`，不带版本号。

- Core：规则生效（官方地址）时，UA 取 `chatgpt_siwc::galley_user_agent()`，不再写死 `Galley`。
- 内核：原地改补丁 `0032`，把 `"Galley"` 换成调用同文件里已有的 `_chatgpt_plan_user_agent()`（补丁 `0007` 加的）。行数不变，别的补丁不用重新导出。台账里给 `0032` 记上「依赖 `0007`」。
- 不改 `chatgpt_siwc` 的行为，不改函数名，不搬函数。

## 第二部分：测试请求的头对齐成内核的，并用测试锁住

JC 裁定：两个协议一起做；只对齐请求头（外加 `metadata` 一项），不把「测试模型」改成走内核进程。

规则：对同一个服务商、同一个模型，「测试模型」发的请求头就是内核会发的请求头。

Anthropic 协议，带 Claude Code 标识时（第三方地址）：

- `user-agent`、`anthropic-beta`（顺序一致）、`x-app`、`anthropic-version`、`anthropic-dangerous-direct-browser-access`、`Accept`、`X-Stainless-*` 的值与内核逐项相同。
- `X-Claude-Code-Session-Id` 每次测试新生成一个 UUID。
- 请求体加 `metadata.user_id`，格式与内核相同（`device_id` 随机生成、`account_uuid` 为空串、`session_id` 与上面的头同值）。
- 模型名带 `[1m]` 时与内核同样处理。

Anthropic 协议，不带标识时（官方地址，不看透传开关）：与补丁 `0032` 之后的内核一致，即 beta 列表去掉 `claude-code-20250219`，UA 按第一部分，不发 `x-app`、会话头、`X-Stainless-*`、`metadata`，`Accept` 保留。

OpenAI 协议（不含 ChatGPT 登录的服务商，那条路走 `chatgpt_siwc`，不动）：加上 `User-Agent`（内核实际发的 `NativeOAISession.native_ua`）和 `originator`，值与内核相同。

「读取模型列表」沿用与「测试模型」相同的请求头（内核没有对应请求，没有可对齐的对象）。

规则不覆盖、保持现状的：

- `Accept: text/event-stream`（OpenAI 协议）：内核流式、测试请求非流式，不对齐。
- 请求体的其他差异：系统提示词、思考与推理强度、`cache_control`、透传时的 Claude Code 系统提示词。
- OpenAI 协议的端点：测试请求固定打 `chat/completions`，内核在 `api_mode` 为 `responses` 时打 `responses`。不在本票。
- URL 规则、鉴权头的选择、`probe_payload` 里的工具定义。

防漂移：

- Rust 里把这些值收成一处常量（UA 两个、beta 列表、`X-Stainless-*` 表、`originator`）。
- 新增 `runner/tests/test_managed_ga_probe_parity.py`，写法照 `runner/tests/test_managed_ga_url.py`：不 import `llmcore`，用 `ast` 从 `managed-ga/code/llmcore.py` 取出 `default_ua`、`native_ua`、`beta_parts`、请求头字面量里的静态值、`originator`；用正则从 `managed_model_probe.rs` 取出常量；逐项比对。失败信息要写明该改哪个常量。
- 以后基线升级改了这些值，这条测试会红，升级的人改 Rust 常量即可。

## 第三部分：OpenAI 新模型「测试模型」必败（JC 未裁，不要可撤）

现象：OpenAI 官方地址，模型名不以 `gpt-5`、`o1`–`o4` 开头时（例如 `gpt-6` 系列），测试请求带的是 `max_tokens`，官方返回：

```text
HTTP 400 … "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." … "param": "max_tokens", "code": "unsupported_parameter"
```

原因：`probe_payload` 用一张写死的前缀表决定参数名，新一代模型不在表里。

修法，两层：

1. 第一次猜：模型名（转小写）匹配 `gpt-<数字>` 且数字不小于 5，或匹配 `o<数字>` 开头时，用 `max_completion_tokens`；其余用 `max_tokens`。现有前缀表是它的特例。带厂商前缀的名字（如 `openai/gpt-…`）照旧用 `max_tokens`。
2. 猜错就换：响应是 400，且报错指明我们发的那个参数不被支持（`error.param` 等于发出的参数名；或 `error.code` 为 `unsupported_parameter` 且报错文字里出现另一个参数名）时，换成另一个参数名重发一次，以第二次的结果为准。两个方向都要支持，最多重发一次。

判断写成纯函数，用上面的报错原文做单测。内核自己的同名规则（`_openai_stream` 里只在配置了 `max_tokens` 时生效，Galley 从不配置）不动。

## 要改的文件

1. `core/src/managed_model_probe.rs`
2. `managed-ga/patches/0032-managed-official-anthropic-no-claude-code-identity.patch`（原地改）
3. `managed-ga/code/llmcore.py`（只能由重放补丁栈生成）
4. `managed-ga/patches/manifest.md`
5. `runner/tests/test_managed_ga_probe_parity.py`（新增）、`runner/tests/test_managed_ga_llmcore.py`（改 `0032` 相关断言）
6. `docs/managed-ga-runtime/model-configuration.md`、`docs/ga-baseline.md`

## 怎么改

先读 `docs/agents/dispatch.md`（执行代理的常设约束）和 `docs/managed-ga-runtime/code-state-and-patches.md` 的「How To Modify An Existing Patch」。

- 先确认测试请求现在怎么处理带 `[1m]` 的模型名，写进报告；与内核不一致就按内核改。
- `0032` 原地改之后，用 `scripts/build-managed-ga.sh <clone>` 从全新的上游克隆重放整个栈；重放后 `managed-ga/code` 只应有 `llmcore.py` 一处变化，`git status` 干净。
- `managed_model_probe.rs` 里上一张票加的测试，凡是写着「与改动前逐字节相同」的，改成「与内核常量一致」。
- `docs/ga-baseline.md`：在耦合点清单末尾加一条（接着第 18 条编号），写明测试请求的头镜像内核、常量在哪、哪条测试守着、升级时怎么处理、上面列的不覆盖项。2026-10-06 那条历史记录不改写，只在句末补一句「2026-11-17 起由耦合点 N 取代」。
- `docs/managed-ga-runtime/model-configuration.md`：改 UA 那一句，补一句头对齐的规则。

## 验证命令

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
rustfmt --check --edition 2021 core/src/managed_model_probe.rs
python -m pytest
python -m mypy runner
python -m ruff check runner
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

另外证明新测试真的能抓漂移：临时把一个 Rust 常量改错，确认 `test_managed_ga_probe_parity.py` 变红，再改回来；把过程写进报告。

## 不要碰

- `gui/`、其他补丁文件、`chatgpt_siwc` 的行为、URL 规则、报错文案。
- `docs/devlog/`（含 `deferred.md`）、`docs/project-status.md`：主会话写。
- `runner/` 下除测试以外的代码、Agent API、IPC 协议。
- 不 push、不合并。

## 报告格式

按 `docs/agents/dispatch.md` 的四段。另外单独回答：`[1m]` 原来怎么处理、现在怎么处理；重放后 `managed-ga/code` 是否只有 `llmcore.py` 变了；新测试抓漂移的演示结果。

## 真机步骤

| 主会话可代验 | 只有 JC 能验（需要真实 key） |
|---|---|
| 读 `git diff main...<branch>`，逐个 hunk 对上面的规则 | Anthropic 官方服务商：「测试模型」通过，新开对话能回 |
| 在没有代理在改的 worktree 里跑全部验证命令 | OpenAI 官方服务商配 `gpt-6` 系列的模型：「测试模型」通过 |
| 把 `0032` 单独打在合入前的载荷上，与提交的载荷逐字节比对 | 回归：第三方 Anthropic 协议服务商一个、第三方 OpenAI 协议服务商一个，「测试模型」仍通过 |

## Comments

### 2026-11-17 改裁（JC）：去掉「透传开着就照旧」的例外

上一张票的规则有两个条件（官方地址、透传关）。JC 裁定去掉第二个：官方地址一律不带 Claude Code 标识，不看透传开关。透传开关照旧管它原来管的其余部分（Claude Code 系统提示词、它补的默认思考与推理强度）。

理由：说不出这个例外的正当用途；它还带出两处不一致（「读取模型列表」拿不到模型级选项只能看地址、Core 与内核对开关的判法略有差异），去掉例外后两处都不存在了。

这条改裁并进本票执行：`0032` 与 Core 的判断都只看主机名，相关测试与文档同步改。本票正文里涉及这条规则的三处措辞已改。

### 2026-11-17 真机（JC）

JC 确认：OpenAI 官方地址「测试模型」报 `max_tokens` 不被支持时，填的是 `gpt-6` 系列的模型。

### 2026-11-17 验收（主会话）

合入 `150b0d62`（第一、二部分与改裁）、`6193e555`（第三部分，单独可撤）。主会话重跑：`cargo test --workspace` 49 个套件 1437 通过；pytest 796 通过；mypy、ruff、六个门禁脚本、`git diff --check` 都过；把改过的 `0032` 单独打在 `0032` 之前的 `llmcore.py` 上，结果与提交的载荷逐字节一致。

票面有一处事实写错，已在正文改正：OpenAI 协议下内核发的 UA 不是 `default_ua`（`claude-cli/…`），而是 `NativeOAISession.native_ua`（`codex_exec/…`）。`default_ua` 只是「没配过 UA」的标记值，从不发出去。执行代理按「值与内核相同」用了实际值。JC 裁「两个协议一起对齐」时听到的是错的那个说法，所以这一点要 JC 重新过目：测试请求现在对所有 OpenAI 协议的服务商自称 Codex，对话一直是这样发的。

执行代理回答的三件事：

- `[1m]`：原来测试请求把带 `[1m]` 的模型名原样发出、也不带 `context-1m-2025-08-07`；现在与内核一致。
- 重放后 `managed-ga/code` 里只有 `llmcore.py` 变了，行数不变，别的补丁不用重新导出。
- 抓漂移演示：改错一个 `X-Stainless-*` 的值、把 UA 改回旧值，对应的测试各红一条，报错写明该改哪个常量；改回后全过。

没验证、留给真机的风险：

1. 官方 Anthropic 地址上，「测试模型」现在发 8 个 beta（以前 3 个），其中有 `fallback-credit-2026-06-01`。JC 上次第 1 步通过时用的是 3 个。如果其中某个会触发余额不足，测试会和对话一起失败，这正是对齐的本意，但第 1 步要重测。
2. 第三方 Anthropic 协议的服务商现在收到完整的 Claude Code 头（9 个 beta、会话头、`X-Stainless-*`、请求体的 `metadata`），「读取模型列表」也带。以前只收到 4 个 beta 的服务商如果拒收这些，测试会开始失败；对话那边本来就会失败。
3. 重发规则比较宽：只要 `error.param` 等于发出的参数名就换参数重发，包括数值超限这类原因，这时用户看到的是第二次的报错。
4. 没有对齐的细节：请求头的顺序和大小写（HTTP 不区分）；模型配置里自定的 `user_agent`（设置界面设不了）。

票外发现：内置运行时从不发出 `default_ua`。
