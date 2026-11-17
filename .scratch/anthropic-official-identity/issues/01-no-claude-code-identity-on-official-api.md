# 发往 Anthropic 官方地址的请求不再自称 Claude Code

Status: done（2026-11-17 真机通过；规则后来改成只看主机名，剩下的回归并入 `.scratch/model-test-parity/issues/01-…` 的真机）
日期：2026-11-17
来源：JC 把订阅附带的每月 API 额度接进 Galley 时实测发现；方案三选一，JC 裁定「只对官方地址改」。

## 现象

Claude 订阅（Max、Ultra、Team）每月附带一笔 API 额度，领到 Console 的 organization 里之后，用该 organization 的 API key 调官方接口就能花。按官方说明，这笔额度不覆盖交互式 Claude Code。

在 Galley 里用这种 key 配 Anthropic 官方服务商，「测试模型」直接报：

```text
模型测试失败（HTTP 400: … "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." …）
```

余额其实是够的。报错还会把用户引去充值。

## 已核实的原因

2026-11-17 用同一个 key、同一个模型、同一段请求体对 `https://api.anthropic.com/v1/messages` 发了两次，只差三个请求头：

| 请求 | 多带的头 | 结果 |
|---|---|---|
| A | 无 | 200，正常回复 |
| B | `user-agent: claude-cli/2.1.113 (external, cli)`、`x-app: cli`、`anthropic-beta: claude-code-20250219` | 400，上面那句余额不足 |

Galley 现在对所有 Anthropic 协议的服务商无条件带这些标识，两处：

- 「测试模型」与「读取模型列表」：`core/src/managed_model_probe.rs` 的 `apply_auth_headers`。
- 对话：`managed-ga/code/llmcore.py` 的 `NativeClaudeSession.raw_ask`（上游代码，现有补丁没有碰过这一段）。除了上面三个，它还带 `X-Claude-Code-Session-Id`、一组 `X-Stainless-*`，以及 Claude Code 格式的 `metadata.user_id`。

没有核实的：三个头里具体哪一个触发拒绝；`raw_ask` 多带的那几项单独会不会触发；保留项（见下）会不会触发。

## 规则

满足下面两条时，请求不带 Claude Code 身份标识；其余情况发出的请求逐字节不变。

1. `api_base` 的主机名恰好是 `api.anthropic.com`（解析 URL 取主机名、转小写后全等比较；没有协议头、解析不出主机名的按「不是」处理）。
2. 「Claude Code 兼容透传」关着（内核里 `self.fake_cc_system_prompt` 为假；Core 里高级选项的 `fake_cc_system_prompt` 不为 `true`）。

（2026-11-17 JC 改裁：第 2 条撤销，官方地址一律不带标识，不看透传开关。见 Comments 末尾。）

规则不覆盖的情况，全部保持现状：

- 主机名只是包含或以它结尾的地址（`api.anthropic.com.example.net`、`relay.example/api.anthropic.com`）。
- 所有第三方 Anthropic 兼容接口与中转站，不论透传开没开。
- OpenAI 协议的服务商、ChatGPT 登录的服务商。
- 外部 GA（attach 模式）：Galley 不改用户自己的 checkout，那里行为不变。

「身份标识」指下面这些，规则生效时去掉或替换：

| 项 | 位置 | 规则生效时 |
|---|---|---|
| `anthropic-beta` 里的 `claude-code-20250219` | 内核、Core | 从列表里去掉，其余 beta 原样保留、顺序不变 |
| `user-agent: claude-cli/…` | 内核、Core | 改为 `Galley`。内核里只在 UA 仍是 Claude Code 默认值（`native_ua`）时替换，用户配置过的 UA 不动 |
| `x-app: cli` | 内核、Core | 不发 |
| `X-Claude-Code-Session-Id`、`X-Stainless-*` | 内核 | 不发（同一行里的 `Accept: application/json` 保留） |
| 请求体的 `metadata`（Claude Code 格式的 `user_id`） | 内核 | 不发 |

规则生效时仍然保留的：`anthropic-version`、`anthropic-dangerous-direct-browser-access`、其余 beta、URL 上的 `?beta=true`、鉴权头的选择逻辑、思考与推理强度、工具、系统提示词、`cache_control`。

## 要改的文件

1. `core/src/managed_model_probe.rs`
2. `managed-ga/patches/0032-managed-official-anthropic-no-claude-code-identity.patch`（新增）
3. `managed-ga/code/llmcore.py`（只能由重放补丁栈生成，不手改）
4. `managed-ga/manifest.json`、`managed-ga/patches/manifest.md`
5. `runner/tests/test_managed_ga_llmcore.py`
6. `docs/managed-ga-runtime/model-configuration.md`

## 怎么改

先读 `docs/agents/dispatch.md`（执行代理的常设约束）和 `docs/managed-ga-runtime/code-state-and-patches.md` 的「How To Add A Patch」。

### Core

- `apply_auth_headers` 现在只收协议和密钥。让它（或它的调用方）拿到 `api_base` 和高级选项，按上面的规则决定带不带身份标识。`list_models` 和 `test_model` 两个调用点都要走同一个判断。
- 主机名判断写成一个纯函数，方便单测。
- 先确认 `ManagedModelProbeInput.advanced_options` 在「测试模型」时带的是不是生效值（预设 ⊕ 默认 ⊕ 单独覆盖）。如果拿不到 `fake_cc_system_prompt` 的生效值，Core 这边就只按主机名判断，并在报告里写明这个差异。
- 不改 `probe_payload`，不改 URL 规则。

### 内核补丁

- 新补丁只动 `NativeClaudeSession.raw_ask` 里拼 beta 列表、拼请求头、写 `metadata` 的那几行，写成零上下文 unified diff，编号 `0032`，排在栈的最后。
- 判断放在 `raw_ask` 里现算即可，不要改 `__init__` 的签名，不要新增配置项。
- 两个台账都要记：`managed-ga/manifest.json` 的 `patchStack.patches` 追加文件名；`managed-ga/patches/manifest.md` 加一行，写清原因、动到的上游文件、变基风险、移除条件（上游不再对官方地址带 Claude Code 标识，或提供了关掉它的配置时删除），并更新「Last replay verified」。
- 用 `scripts/build-managed-ga.sh <clone>` 从基线重放整个栈生成 `managed-ga/code`。克隆放在 scratchpad，用全新的上游克隆。重放后 `git status` 里 `managed-ga/code` 只应多出 `llmcore.py` 这一处改动。

### 测试

- Rust（`managed_model_probe.rs` 的测试模块）：用 reqwest 的 `RequestBuilder::build()` 取出请求头断言。至少覆盖：官方地址且透传关（没有 `x-app`、UA 是 `Galley`、beta 里没有 `claude-code-20250219` 而其余三个都在）；官方地址且透传开（与现状一致）；一个第三方 Anthropic 兼容地址（与现状一致）；上面列的两个形似主机名（与现状一致）；OpenAI 协议（与现状一致）。
- Python（`runner/tests/test_managed_ga_llmcore.py`，文件里已有 `_FakeNetwork` 可以截请求）：官方地址且透传关时，截到的请求头和请求体符合上表；官方地址且透传开、第三方地址两种情况下，Claude Code 标识都还在；官方地址上用户配置过的 `user_agent` 不被替换。

### 文档

`docs/managed-ga-runtime/model-configuration.md` 加一小段，写明这条规则、两条判断条件，以及它只作用于内置内核。

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

- Python 三条用仓库 README 里说明的环境跑；本机 pytest 需要设 `GA_PATH`。worktree 里没有现成环境、跑不起来的话，把原因写进报告，主会话验收时补跑。
- 探针脚本要 import `managed-ga/code` 时用 `python -B`，别留下 `__pycache__`。
- `rustfmt` 的 edition 以 `core/Cargo.toml` 为准；只检查自己动过的文件。

## 不要碰

- `gui/`：这张票没有界面改动，不加开关、不改文案。
- 其他服务商预设、其他补丁文件（`0032` 排在最后，不应让任何已有补丁需要重新导出；如果重放时发现需要，停下来写进报告）。
- `runner/` 下除测试以外的代码、Agent API、IPC 协议。
- `docs/devlog/`、`docs/project-status.md`：由主会话在真机验收后写。
- 不改余额不足时的报错文案。
- 不 push、不合并。

## 报告格式

按 `docs/agents/dispatch.md` 的四段：改了什么（文件与提交号）；验证命令与输出；未解决的风险与没验证到的；票外发现。

另外单独回答两件事：`advanced_options` 在「测试模型」时是不是生效值；重放后 `managed-ga/code` 的改动是不是只有 `llmcore.py`。

## 真机步骤

| 主会话可代验 | 只有 JC 能验（需要真实 key 与订阅额度） |
|---|---|
| 读 `git diff main...<branch>`，逐个 hunk 对上面的表 | 设置 → 模型 → Anthropic 官方服务商 →「测试模型」通过 |
| 在没有代理在改的 worktree 里跑全部验证命令 | 新开对话问一句，能正常回复 |
| 重放补丁栈后 `git status` 干净 | 回归：任选一个第三方 Anthropic 协议服务商，「测试模型」仍通过 |

如果第一步仍报余额不足，说明保留项里还有触发拒绝的，那时再逐项排查（本票没有做逐项排查）。

## Comments

### 2026-11-17 验收（主会话）

合入 `6571214f`。主会话重跑：`cargo test --workspace` 49 个套件 1431 通过；pytest 771 通过；mypy、ruff、六个门禁脚本、`git diff --check` 都过；把 `0032` 单独打在合入前的 `llmcore.py` 上，结果与提交的载荷逐字节一致。

执行代理回答的两件事：

- 「测试模型」送来的 `advanced_options` 是生效值，所以 Core 两条规则都判。「读取模型列表」不带模型级选项，在官方地址上只看主机名。
- 重放后 `managed-ga/code` 里只有 `llmcore.py` 变了，已有补丁都不用重新导出。

没验证、留给真机的风险：

1. 对话请求比「测试模型」多带 5 个 beta，其中有 `fallback-credit-2026-06-01`。票面规定保留，没有动。「测试模型」通过不代表对话一定通过；对话仍报余额不足时先查这一个。
2. 在官方地址上开着透传的用户，「读取模型列表」不再带 Claude Code 标识。列表接口如果认这个标识，这一步可能失败；对话和「测试模型」不受影响。
3. 两边对透传的判法略有差异：Core 要求 `fake_cc_system_prompt` 严格等于 `true`，内核只看真假并兼认 `claude_compat`。Galley 只写布尔值，目前碰不到。

票外发现，都没有改：

- Sign in with ChatGPT 的 UA 是 `Galley (<os>; <arch>)`，这张票按票面用的是纯 `Galley`，两处不一致。
- 早就存在的漂移：「测试模型」的 UA 版本是 `claude-cli/2.1.113`，内核是 `2.1.280`；beta 也是一边 4 个、一边 9 个。

### 2026-11-17 真机（JC）

第 1 步通过：Anthropic 官方服务商「测试模型」成功，用的是订阅附带的额度。第 2 步（新开对话）和第 3 步（第三方服务商回归）还没有回报。

### 2026-11-17 改裁（JC）：第 2 条撤销

规则只剩第 1 条：主机名恰好是 `api.anthropic.com` 就不带 Claude Code 标识，不看透传开关。改动并进票 `.scratch/model-test-parity/issues/01-model-test-sends-what-the-engine-sends.md` 执行。上面「没验证、留给真机的风险」第 2、3 条随之不再存在。

本票正文原先给第 2 条举过一个用途的例子，那不是 Galley 支持的用法，已删。

### 2026-11-17 收尾（主会话）

真机第 2 步有了记录：库里当天有一次 `claude-opus-5-5` 的对话，两条回复，没有报错（在本票合入之后）。第 1 步在头对齐之后 JC 又测过一次，仍通过。第 3 步（第三方服务商回归）还没有回报，和 OpenAI 那一侧的回归一起记在 `.scratch/model-test-parity/issues/01-…` 里，本票关掉。
