# 04 · GUI：用 ChatGPT 登录

Status: needs-dogfood

来源：[PRD](../PRD.md) 裁决 1、5、6；Core 接口来自票 02（`core/src/chatgpt_siwc/`，前端绑定已在 `gui/src/lib/managed-models.ts`）。OpenAI 的界面要求见 <https://developers.openai.com/siwc/ui-ux-guidelines>。

## Core 接口（票 02 已实现）

所有命令都按现有约定传 `{ input: {...} }`：

| 命令 | 入参 | 返回 |
|---|---|---|
| `start_chatgpt_plan_login` | 无 | `{ loginId, authUrl, expiresAt }`（10 分钟） |
| `complete_chatgpt_plan_login` | `{ loginId }` | 与现有 `CodexAuthSetupResult` 同形：`{ provider, model, status }` |
| `cancel_chatgpt_plan_login` | `{ loginId? }` | `null` |
| `list_chatgpt_plan_models` | `{ providerId? }` | `{ models: [{ slug, displayName, contextWindow, supportedReasoningLevels, defaultReasoningLevel }], endpoint }` |
| `get_chatgpt_plan_status` | `{ providerId? }` | `{ flow: "siwc" \| "codex" \| null, signedIn, needsReauth, registered, scopes, expiresAt, lastRefreshAt, lastRefreshError }` |
| `logout_chatgpt_plan` | `{ providerId? }` | `{ remoteRevokeConfirmed }` |

补充约定：

- **错误格式**：JSON 字符串 `{"error": "chatgpt_plan_<code>", "message"}`，code 有 `access_denied`、`usage_not_granted`、`login_cancelled`、`login_timed_out`、`login_not_found`、`reauth_required`、`temporary`、`failed`；用 `chatGptPlanErrorCode(err)` 取。
- **按 flow 分派的旧命令**：`test_managed_model_connection` 与 `list_managed_model_options` 也会按凭据的 `flow` 分派。
- **`complete` 只能调一次**：每个 `loginId` 只调一次，StrictMode 下 effect 跑两遍要防。
- **`authUrl` 不能写日志**：它可能带 `id_token_hint`。
- **「需要重新登录」时凭据行还在**：令牌已清空，`credentialStatus` 仍是 `present`，所以登录状态以 `get_chatgpt_plan_status` 为准。

## 要做的

1. **ChatGPT 服务商的主路径换成 SIWC**（Onboarding 的 `StepModelConfig` 与 Settings 的新建 / 编辑服务商，两处都在 `use-provider-setup-controller.ts` 里汇合）：
   - 主按钮用 OpenAI 规定的「Continue with ChatGPT」加 ChatGPT 标志。标志从 OpenAI 官方资源取（`/siwc/website` 页列出的按钮素材，例如 `/assets/siwc/sign-in-buttons/chatgpt-logo-white.svg`），深浅两色都要；中文按钮文案推荐「用 ChatGPT 登录」。
   - 点击：`start` → `openUrl(authUrl)` → 显示等待态（「在浏览器里完成登录…」、取消按钮）并调用 `complete` → 成功后与现有 Codex 登录成功走同一条后续路径（`onCodexComplete` 那一套）。
   - 报错按 code 给人话：
     - `access_denied`：你在浏览器里取消了授权；
     - `usage_not_granted`：没有勾选「使用 ChatGPT 套餐」，再试一次时记得勾上；
     - `login_timed_out`、`login_cancelled`：回到初始态；
     - `temporary`：稍后重试；
     - `failed`：显示消息。
2. **现有的设备码登录与导入 Codex CLI 登录（A）** 收进一个默认折叠的「其他登录方式」区，功能不变。票 05 会整块删掉，所以不要为它新做样式。
3. **服务商卡片**（`ProviderCard.tsx` 等）对 SIWC 凭据：
   - 登录状态读 `get_chatgpt_plan_status`；`needsReauth` 时沿用现有的「需要登录」徽标和「需要重新登录 ChatGPT。」提示，并给出「用 ChatGPT 登录」。
   - 加一个「管理用量」链接，指向 `https://chatgpt.com/settings/usage`。
   - 退出登录调用 `logout_chatgpt_plan`；`remoteRevokeConfirmed: false` 时 toast 提示「已退出登录；远端撤销未确认，可在 ChatGPT 设置里断开 Galley」。
   - SIWC 服务商展开时**会**自动读取模型列表（现在 Codex 被跳过，见 `docs/design/overlays-and-settings.md:414`），手动「读取模型列表」也可用。
4. **首次登录说明**：只在这台机器第一次用 SIWC 登录成功后弹一次（OpenAI 要求），用现有对话框样式。
   - 英文：标题「You're using your ChatGPT plan.」，正文「Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.」，按钮「Got it」；
   - 中文：标题「你正在使用 ChatGPT 套餐」，正文「Galley 里符合条件的用量会计入你的 ChatGPT 套餐，可以在 ChatGPT 设置里管理用量。」，按钮「知道了」。

   「已弹过」存在前端偏好里，读写要 try/catch，存储不可用时不弹也不报错。
5. **「正在使用 ChatGPT 套餐」标识**（OpenAI 要求放在输入框或模型选择器附近）：做两个变体，加一个临时切换器让 JC 在 tauri dev 里真机挑：
   - A 案：只在模型菜单（`LLMPill` 的下拉）里，ChatGPT 套餐的模型旁边或分组头写「ChatGPT 套餐 · 管理用量」；
   - B 案：当前会话用的是 SIWC 模型时，输入框模型短语后面跟一个淡色小字「ChatGPT 套餐」。

   切换器常驻、可点，用 portal 加 `pointer-events: auto`。JC 定了以后拆掉切换器和落选的变体。
6. **文案**：中英双语，预设的名称与描述改为不再强调 Codex，例如「ChatGPT」与「用 ChatGPT 套餐（Plus / Pro）的额度」。改之前读 `docs/copy-language-guidelines.md`，中文用全角标点。

## 验收

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`（如有相关测试）全绿；`git diff --check` 干净。
- 为错误码到文案的映射，以及「`complete` 只调一次」写单元测试。
- 不用纯 Vite 页面验证 Tauri 流程；真机走查由 JC 在 `tauri dev` 里做。实现说明里附一份真机步骤清单：
  - 新登录；
  - 取消授权；
  - 不勾套餐用量；
  - 已有 A 服务商时改走 SIWC；
  - 需要重新登录；
  - 退出登录；
  - 两个标识变体。

## 约束

- 动手前查设计文档里对涉及组件的禁令：`grep -n "不要\|有意\|分叉" docs/design/*.md`，重点看 onboarding、settings 服务商卡片、`LLMPill` 三节。冲突时停下来写进实现说明，不要自己裁。
- gui 不是 prettier-clean：只格式化自己的 hunk，新文件可以整篇格式化。
- React 编译器 lint：effect 里不能同步 setState，渲染期不能调 `Date.now`。
- 只在给定的 worktree 里工作，不碰主工作树，不跑 `tauri dev`。
- 提交只点名文件；英文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Comments

### 2026-10-20 追加（派出后补充，已转给代理）

- 缺陷：登录后连接测试失败时，不结束引导、不关闭编辑器，说明原因；不符合资格时建议改用 API key 服务商（PRD「另」一段）。
- 裁决 7：对话里的套餐报错按错误码显示中文提示和按钮（管理用量 / 去设置登录 / 去设置），引擎原文留在详情里。
- 裁决 8：对话出现 `token_revoked` 时触发一次连接测试，每次报错只触发一次，然后刷新登录状态。

### 2026-10-20 交付与合入

- 代理交付后主会话补了一处文案：「API key 服务商」改为「用密钥的服务商」，依据文案规范。01–04 已快进合入 main（`00c4569a`）。
- 门禁：pytest 591、mypy、ruff、gui typecheck / lint / test（181 个文件、1979 条）、四项检查脚本全部通过；Rust 全量在 `445975f2` 跑过（1196 条）。
- 代理按规范做的取舍，待 JC 真机看：
  - B 案标识沿用 12.5px 淡色，没有缩小（规范要求一行一个字号）；
  - 「管理用量」用杏色描边按钮（Error Card 规范）；
  - 「其他登录方式」展开时出现两个主按钮（临时，票 05 删）。
- 过期的设计文档两处（`overlays-and-settings.md:414`、`onboarding-and-cards.md:38`）等真机裁决后一起改。

### 2026-10-20 真机第一轮与 04b

- 真机：JC 用 ChatGPT 登录成功，工作台对话正常（清单第 1、2 步过）。标识选 B，但嫌样式像强度。
- 04b（已转给代理，接在 `siwc-04-gui` 上）：
  - 中文文案「ChatGPT 套餐」全部改为「ChatGPT 订阅」，英文仍是「ChatGPT plan」，文案规范补一行；
  - `usageNotGranted` 改为说明性写法；
  - 切换器换成三档：1 标志、2 右端、3 徽标（PRD 裁决 11、12）。
- 待合入：`f3d73325`（Core：丢掉作废的旧注册）、`688d677c`（等待态提示），加上 04b，三者一起合，Core 只重启一次。
- 第一批合入 main（头 `14a6f0d2`）：`5960ba28`（Core：丢掉作废的旧注册）、`22e4bb4e`（等待态提示）、`848059ec`（订阅文案）、`14a6f0d2`（三档切换器）。GUI 测试 182 个文件、1986 条全过；Core 的代码与 `e0aaaaa8` 一致（`cargo test` 1202 条全过）。
- 三档各违反了哪条设计规则（代理报告，供真机比较时参考，`docs/design/conversation.md`）：
  - 1 标志：违反 1013 行「模型名，无箭头、无图标」，等于撤销 992 行删掉 Cube 图标的决定；
  - 2 右端：违反 887–889 行「左边放进什么、谁来回答，右边只剩怎么发」；
  - 3 徽标：避开了 1047 行否掉的灰底等宽大写，但这一行里仍然多了一个框。
- 2026-10-20 真机：第 5 步「断开后重新登录」通过（JC）。三档标识定为第 1 档（裁决 13），菜单改法见裁决 14，由 05b 收尾。还差：取消授权、退出登录两步，和 05b 合入后的菜单 / 标志复看。
