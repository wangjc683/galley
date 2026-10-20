# 用 ChatGPT 订阅登录：不内嵌 CPA，改走官方 Sign in with ChatGPT，删掉借 Codex CLI 的旧登录

日期：2026-10-20
关联：[SIWC PRD](../../.scratch/chatgpt-siwc/PRD.md) 裁决 1–17，票 01–06；暂缓项 [deferred「ChatGPT 套餐的额度显示」](./deferred.md#chatgpt-套餐的额度显示)；运行时文档 [model-configuration](../managed-ga-runtime/model-configuration.md)「ChatGPT（Sign in with ChatGPT）」一节；宪法 Rule 2 的窄例外（`AGENTS.md`）。

## 起因

JC 看到 Codex 负责人 Tibo 的推文，认为 OpenAI 认可个人订阅用户用 CLIProxyAPI（CPA）把订阅额度给自己的 Agent 用，考虑把 CPA 内嵌进 Galley 的模型配置，让用户直接登录、用 ChatGPT 订阅里的 Codex 额度。

## 前提核对：推文认可的是什么

- 两条推文原文（经 fxtwitter 拉取）：07-12 教人装 CPA，把 Claude Code 指向 GPT 5.6 Sol（「If this gets blocked, I owe you a reset.」）；08-21 划线：把订阅转成 API 流量再转供或多人共享会被风控标记，通过 Sign in With ChatGPT 在官方或开源客户端里用自己账号的额度「completely fine」。
- 界线是「一人一号自己用」与「转供 / 共享」，与工具无关。Galley 当时的登录（A：借 Codex CLI 的 OAuth `client_id`，设备码 + 导入 Codex CLI 登录，打 `chatgpt.com/backend-api/codex`）本来就在线内，推文没带来新许可。
- CPA 的经典 Codex 登录用的是和 A 同一个 `client_id`，内嵌它对 Codex 不增加任何能力。
- 真正的新变量是 OpenAI 在 DevDay 2026 推出的开发者版 Sign in with ChatGPT（SIWC）：开源项目与本地运行的应用可以自助接入，以自己的名义注册（`dynamic_agent_client` + `agent_name_hint`），用户在 ChatGPT 设置里看得到、能设每周 10–100% 的上限、能断开；推理走公开的 `api.openai.com/v1/responses`。CPA 自己 10-12 也接了 SIWC。

## 裁决 1：走 C（原生 SIWC），不内嵌 CPA

否掉内嵌 CPA（B）的理由都在架构上，不在合规上：

- 常驻 HTTP 网关违背 Rule 2 的本意，本机任何进程拿到 key 都能花用户的额度（仓库此前的判断就是「loopback 不是安全边界」）；它的默认值也是网关服务器的取向（地址留空绑所有网卡、mDNS 广播、管理面板从 GitHub 自动更新）。
- 凭据要交给 CPA 的文件存储，而 Galley 的 refresh token 只在 Core 加密库。
- 维护面：近 30 天 47 个版本、刚升 v8 大版本；每平台 20–22MB Go 二进制要进签名公证。
- 多一层协议转换；「多家订阅一起接」这个卖点也有缺角（Anthropic 2026-02 已禁止 Pro / Max 的 OAuth 用于第三方产品）。
- 常驻网关是重 harness，与「Less harness. More model.」反着走。

用户自己跑 CPA、用「自定义」服务商指过去（D）今天就能用，不做内置。

## 探针

用 JC 的 Pro 账号在 scratchpad 里跑，脚本与令牌都不进仓库：

- **登录**：首次登录用随机端口即可；OIDC 元数据里没有设备码端点，回环回调是唯一的登录方式，于是 Rule 2 加了窄例外（裁决 2）。
- **令牌**：一小时有效，refresh token 每次轮换；ID token 用 RS256 签名，JWKS 在 `auth.openai.com`；access token 里没有 `chatgpt_account_id`。
- **请求**：GA 现有 Codex 分支的请求体原样可用，端点换成 `api.openai.com/v1` 后两轮带工具调用都跑通；文档说 function tools 必须分组进 namespace，实测平铺也行；唯一硬性要求是 `store: false`。
- **缓存**：带 `prompt_cache_key` 时 6 次命中 5 次。
- **撤销**：RFC 7009 form、空的 200；撤销后刷新返回 `invalid_grant`，具体原因在 `error_reason` 字段；还没过期的 access token 立刻 401 `token_revoked`。
- **额度**：SIWC 这条路读不到 5 小时 / 7 天的用量，`response.metadata` 里只有内容审核结果（合入后用正式登录又查了一次）。

## 推进与走查中的裁决

票 01–06 按「异步幕僚长」的方式在 worktree 里后台做，主会话验收、合入，JC 真机走查。

- **裁决 5、6：删 A，C 就地接管现有服务商**。删 A 的理由：刷新时要写回 `~/.codex/auth.json`（与 Codex CLI 共用一个 refresh token）；冒用 Codex CLI 身份；补丁 0007 是升级上游时最常冲突的一张；没有使用证据。代价是 SIWC 只支持 Plus / Pro，其他套餐的用户以后只能用 API key。C 沿用 `mp_chatgpt_codex` 与 `chatgpt_codex_oauth`，不加新值。原因之一是 providers 表是外键父表，每改一次约束都要冒级联删除的风险重建表（v0.2.9 同类事故）。老用户的旧凭据在 Core 启动时清掉，**不撤销**（可能与 Codex CLI 共用）。
- **裁决 7、8**：对话里的套餐报错按错误码显示中文提示和按钮（管理用量 / 去设置登录）；收到 `token_revoked` 时触发一次连接测试，让设置卡片立刻变成「需要登录」。
- **裁决 9**：默认模型取账号目录里第一个可见的模型。
- **裁决 10**：额度显示暂缓，进 deferred。
- **裁决 11**：用户文案叫「ChatGPT 订阅」，英文沿用 OpenAI 的「ChatGPT plan」。
- **裁决 12、13**：标识放输入框；样式先上 A / B 切换器，JC 选了 B 但嫌像强度，再上三档（标志 / 右端 / 徽标）。JC 真机选第 1 档：模型名前一个 13px 淡色 ChatGPT 标志，推翻「模型名无图标」为窄例外——标志说的是费用从哪里出，不是模型参数。
- **裁决 14**：模型菜单的订阅行同样用标志；列表中间的分组头挪到底部动作栏（分组头按位置插入，订阅模型被拖到中间时会误把下面的行也框进去）；05-28 起就有、却从没写进文档的「同名模型常显服务商」规则补上标志例外。
- **裁决 15、16**：设置页服务商小字改说「怎么接」（ChatGPT 订阅 / 官方 API / X 兼容），不写「OpenAI 官方」（订阅额度不是 API 计费）；「添加」本身就是菜单，三下变两下。
- **裁决 17**：「添加」菜单每项两行，只露出 7 项，「自定义」藏在下面又看不出能滚；改成单行，一屏放下 11 项，上下渐隐兜底。

## 顺带修掉的

- **免密钥服务商从上线起就存不进库**（galley#24，08-31）：014 给 `auth_kind` 加的约束漏了 `none`，08-31 devlog 写的「无需 migration」正是来源。迁移 052 把子表包在父表重建外面，避开事务内关不掉外键的坑。
- `engineering-workflow` I3 要求登记一个早已不存在的 `MIGRATION_SPECS`，已更正。
- 内核原来把 Core 返回的「需要重新登录」错误码吞掉，对话里的「去设置登录」永远触发不了（05a 顺手修）。
- 登录后连接测试失败也会结束引导（走查发现）：现在停在原步骤说明原因。

## 教训

- **代理报告里的「未解决风险」要原样转给 JC**。票 02 的代理列了「断开后重新登录可能卡住」，主会话汇总时漏掉，是旁路代理提醒的。按 OAuth 规范，作废的 `client_id` 不会跳回回调，于是补了「超时或取消就丢掉旧注册」的出口；真机第 5 步验证通过。
- **并行会话会在合入窗口里往 main 提交**：本组合入时两次撞上别的会话的提交，`--ff-only` 失败或 diff 里混进别人的文件。合入前最后一刻再 rebase、看一眼 `git diff main..HEAD --name-only` 是否只含本票文件。

## 没验证到的

- 不符合资格的账号（Free、Business 等）实际的表现；额度用尽等结构化报错的真实格式（只按文档在测试里构造）。
- Windows：凭据通道的命名管道改了名（`galley-credential-*`），本机编译不到这段代码，推送后看 CI 的 Windows job。
