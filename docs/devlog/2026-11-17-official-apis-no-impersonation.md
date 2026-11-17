# 官方地址上不冒充：Anthropic 不自称 Claude Code，OpenAI 不自称 Codex；「测试模型」发内核会发的头

日期：2026-11-17
关联：`.scratch/anthropic-official-identity/`、`.scratch/model-test-parity/`（两张票，发版后删）；补丁 `0032`、`0033`（[补丁台账](../../managed-ga/patches/manifest.md)）；`core/src/managed_model_probe.rs`；`runner/tests/test_managed_ga_probe_parity.py`；[模型配置](../managed-ga-runtime/model-configuration.md)「Official Anthropic API」「Official OpenAI API」两节；[GA 基线](../ga-baseline.md)耦合点 25；[deferred](./deferred.md)「『测试模型』改走内核进程」「Anthropic 协议的输出上限固定是 8192」

## 起因

JC 想把 Claude 订阅附带的每月 API 额度接进 Galley 用 Opus 5.5：在 Console 建好 key，配进 Anthropic 官方服务商，「测试模型」报 `Your credit balance is too low to access the Anthropic API`。余额其实是够的。

只动内置内核，外置 GA 零变化。

## 诊断

一天里连着撞了五关，每一关都是上一关修掉之后才露出来的。

1. **key 没绑 workspace**（`This API key is not scoped to a workspace`）。Console 那一侧的事，重建一个绑了 workspace 的 key 即可，Galley 没改。
2. **Anthropic：带 Claude Code 标识的请求花不了订阅附带的额度。** 同一个 key、同一个模型、同一段请求体发两次，只差 `user-agent: claude-cli/…`、`x-app: cli`、`anthropic-beta: claude-code-20250219` 三个头：不带的 200，带的 400 余额不足。Galley 对所有 Anthropic 协议的服务商无条件带这些标识，两处：Core 的测试请求、内核的对话请求（上游代码）。
3. **OpenAI：新模型不认 `max_tokens`。** 测试请求用一张写死的前缀表（`gpt-5`、`o1`–`o4`）决定参数名，`gpt-6` 系列不在表里。只坏在测试上：内核只在配置了输出上限时才带这个参数，Galley 从不配置。
4. **OpenAI：`gpt-6` 系列在官方接口上不接受「Chat 端点 + 工具」**（`To use function tools, use /v1/responses`）。测试请求固定打 Chat 端点、不看模型的 API 模式；官方预设的默认 API 模式又是 Chat，所以默认配置下测试和对话都会失败。
5. **OpenAI：带 ChatGPT 订阅附带额度的 organization 不能用于 Codex**（`codex_byok_restricted_by_api_credit_promo`）。内核对所有 OpenAI 协议的地址都带 `User-Agent: codex_exec/…` 和 `originator: codex_exec`。和第 2 关是同一类。

顺带查出「测试模型」与内核发的头早就不一样：测试请求的 Claude Code 版本号停在 2026-05-25 的 `2.1.113`、带 4 个 beta，内核是 `2.1.280`、9 个 beta；带 `[1m]` 的模型名测试请求原样发出，内核会去掉后缀并加一个 beta；OpenAI 协议的测试请求只带鉴权头。10-06 的基线记录把它定为「不算基线同步面，只记录」。

## 裁决（JC）

1. **Anthropic 官方地址不带 Claude Code 标识，只对官方地址改。** 判断是主机名恰好等于 `api.anthropic.com`。
   没选：跟着「Claude Code 兼容透传」开关走、不看地址（第三方兼容接口收到的头都会变，里面有没有暗中依赖 `claude-cli` UA 的说不清）；先不做（订阅额度一直用不了，报错还把用户引去充值）。
2. **不看透传开关。** 主会话最初在这条规则上加了一个例外（透传开着就照旧带标识），给例外找的用途是编的，不是 Galley 支持的用法，写进了票、文档和测试注释，向 JC 汇报时又没带上那个例子；旁路代理指出后，JC 裁掉整个例外。例外带出的两处不一致（「读取模型列表」拿不到模型级选项、Core 与内核对开关的判法略有差异）随之消失。透传开关照旧管它原来管的其余部分。
3. **官方地址上的 UA 用 `Galley (<os>; <arch>)`**，和 ChatGPT 登录那条路同一个串，不带版本号（内核不知道 Galley 的版本，带了也没有人用）。
   没选：两条路都改成纯 `Galley`（要动已经跑通的 ChatGPT 登录）；维持两种写法。
4. **测试请求的头对齐成内核的，并用测试锁住，两个协议一起做。** 推翻 10-06「不算同步面」：当天证明了请求头能决定请求成不成功，而「测试模型」的意义就是它过了对话就能用。做法照 URL 规则那条先例（耦合点 18）：Rust 里一组常量，pytest 读内核源码逐项比对，漂了就红并写明该改哪个常量。
   没选：只对齐一次不加测试；维持不动。「测试模型」改走内核进程是最彻底的做法，记进 deferred 等信号。
5. **测试请求跟着模型的 API 模式走**：模式是 Responses 时打 Responses 端点、用 Responses 的请求体。这一项原本列在第 4 条的「不覆盖」里，当天就撞上了。
6. **OpenAI 官方预设的默认 API 模式改成 Responses。** 只影响以后新添加的模型。Responses 模式是上游本来就支持的配置（上游的配置模板以官方地址为例写着这个用法）；主会话一度说「没有证据能通」，JC 指出后更正。
7. **OpenAI 官方地址不带 Codex 标识**，规则与第 1 条对称：主机名恰好等于 `api.openai.com`、且不是 ChatGPT 登录的服务商。去掉 `originator`、换 UA、去掉 Responses 请求体里只含 Codex 标识的 `client_metadata`。JC 看到报错时的话：「估计不能用 Codex 形式」。主会话先把修法并进在途的票再报的。
8. **测试花费的提示改成「模型测试最多 16 个输出 token」**：Responses 端点对输出上限有下限。
9. **Anthropic 预设的预填模型改成 `claude-opus-5-5`。**
10. **Anthropic 协议输出上限固定 8192，先不改**，记进 deferred。当天量过：库里和内核日志里截断标记出现 0 次，单次请求输出最大 2,888。

OpenAI 新模型的参数名（诊断第 3 关）是主会话直接补的，没有单独裁：模型名是 `gpt-<数字>` 且数字不小于 5、或以 `o<数字>` 开头时用 `max_completion_tokens`；猜错时按服务商的报错换成另一个参数名重发一次。单独一个提交，可单独撤。

## 做了什么

- **内核**：补丁 `0032`（`NativeClaudeSession.raw_ask`）、`0033`（`_openai_stream`），都排在栈的最后，没有已有补丁需要重新导出。`0033` 按名字排除 ChatGPT 登录的分支，有测试守着：同一个 ChatGPT 登录会话发往官方地址和另一个主机，除地址外请求完全相同。
- **Core**：`managed_model_probe.rs` 把内核的值收成一组 `ENGINE_*` 常量；Anthropic 协议带标识时连会话头、`X-Stainless-*`、请求体的 `metadata.user_id` 一起对齐；`[1m]` 与内核同样处理；两条官方地址规则共用一个主机名判断；OpenAI 协议按 API 模式选端点和请求体。
- **防漂移**：`runner/tests/test_managed_ga_probe_parity.py`。执行代理演示过，改错一个值对应的测试就红。
- **界面**：两个预设的默认值、一句提示。
- 上游 `68d996a` 仍然无条件带这两组标识；补丁的移除条件是上游不再对官方地址带，或给了关掉它的配置。

## 真机（JC，dev）

- Anthropic 官方：「测试模型」通过（对齐之后带的是与对话相同的 8 个 beta）；库里有一次 `claude-opus-5-5` 的对话，两条回复，没有报错。
- OpenAI 官方配 `gpt-6.1-sol`（Responses 模式）：「测试模型」通过，对话成功；库里那次对话一条回复，没有报错。Responses 测试请求的输出上限取 16，这次通过说明这个值可用。
- 还没回报：ChatGPT 登录的模型发一句仍能回；第三方 Anthropic 协议、OpenAI 协议的服务商各一个，「测试模型」仍通过。

## 认下的代价与没验证的

- 两家具体是哪一项标识触发拒绝，都没有隔离，整组去掉。保留的 beta 与 Responses 请求体字段经真机验证不触发。
- 第三方 Anthropic 协议的服务商现在在测试时收到完整的 Claude Code 头（以前只有 4 个 beta）。拒收这些的服务商，测试会开始失败；对话那边本来就会失败。
- 换参数重发的条件比较宽：只要报错点名的是发出的那个参数就换，包括数值超限这类原因。
- Responses 测试请求不带 `store: false`，每次测试会在用户的 OpenAI 账户里存一条请求；内核的普通对话也不带。
- Responses 测试请求体的形状只有 Rust 单测守着，防漂移测试不覆盖；以后上游在 `_openai_stream` 里加新的 Codex 标识不会被 `0033` 去掉。两条都写进了耦合点 25 与补丁台账，基线升级时人工看。
- 把预填改成 Opus 5.5 之后有一条没验证的风险，单独立了票：`.scratch/opus-5-5-thinking-history-check/`。

## 教训

- 自己加的例外，理由必须是代码里查得到的事实；写进票和文档的理由，汇报时原样带上。
- 讨论时说「内核对 OpenAI 协议发 `claude-cli` 的 UA」是错的，实际是 `codex_exec`（`default_ua` 只是「没配过 UA」的标记值，从不发出去）。JC 是在这个错的说法上裁的「两个协议一起对齐」；执行代理建了真实会话才发现。断言内核发什么之前，建一个会话看。
- 「没有出问题的证据，建议不动」这句话当天说了两次（OpenAI 自称 Codex、Responses 模式能不能通），一次当天被真机推翻，一次被上游的配置模板推翻。同类机制已经在一家出过事时，另一家按「会出事」处理。
