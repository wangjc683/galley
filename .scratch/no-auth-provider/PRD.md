# 无鉴权 Provider（空 API key）

Status: ready-for-human（2026-08-31 已实现，全部静态验证绿；待 JC 真机
视觉验收。正式叙事见
[devlog](../../docs/devlog/2026-08-31-no-auth-provider-empty-apikey.md)；
清除=转无鉴权、本轮不加 Ollama 预设两问已裁决，下文「待定」节仅存历史）

## 背景

社区 issue [galley#24](https://github.com/wangjc683/galley/issues/24)
（2026-08-29，gally16）：GA 里手改 `mykey.py` 可以把 apikey 设为空，
Galley 里做不到。典型场景是无鉴权本地端点（ollama / 本地代理 / 内网网关）。

关键事实：

- **GA 引擎完全接受空 key**：`managed-ga/code/llmcore.py:804` 只要求字段
  存在；`:981-984`（OpenAI 协议）与 `:901`（Anthropic）无条件发
  `Authorization` 头，空值也发。本地端点忽略该头即可工作。
- 由此推出 **workaround：填任意占位 key（如 `sk-local`）与空 key 功能
  完全等价**——引擎反正无条件带头。用户当下并未被真正卡死。
- GA 自己的桌面 UI 新增时也必填 key（`desktop_bridge.py:416`
  "apikey is required"）；「GA 可留空」指的是手改文件，从未是 UI 入口。
- issue 已回复 workaround（2026-08-31）。

## 现状：空 key 被四层独立闸门拦死

| 层 | 位置 | 行为 |
|---|---|---|
| GUI 保存门 | `gui/src/lib/provider-setup.ts:169` | 新建时空 key → Save 禁用（编辑时留空 = 保留已存 key，`provider-setup.test.ts:72,75-81` 有意测死） |
| GUI 测试/拉模型门 | `gui/src/components/managed-models/use-provider-setup-controller.ts:163-192` | 空 key 禁用连接测试与模型列表按钮 |
| Rust 保存 | `core/src/commands/managed_model.rs:44-57` | 空 key 报错 "managed provider API key is required"；且空 key 永远不能覆盖已存 key（无清除通道，唯一手段是删整个 provider） |
| Rust 探测 | `core/src/managed_model_probe.rs:148-168` | 空 key 报 "API key is required before testing" |
| Rust 会话启动 | `core/src/runner_commands.rs:214-224` | 空 secret 的模型被静默过滤 |
| Runner | `runner/managed_runtime.py:173` | `if not cfg["apikey"]: continue`，全空抛 RuntimeError |

另：`ManagedModelAuthKind` 目前只有 `api_key | chatgpt_codex_oauth`
（`gui/src/types/managed-models.ts`）；预设表无任何本地/ollama 条目。

## 设计定案（2026-08-31 探讨，JC 无异议）

原则：**表面上「留空即可」的直觉，底下是显式的无鉴权状态**。
纯放开空字符串被否，理由两条：

1. 对多数云端用户，非空校验是防错护栏——放开后失误从「表单当场报错」
   退化为「运行时 401」，错误离开有上下文的时刻。
2. 编辑流里「留空」已有语义（= 保留已存 key，密码框不回显的行业惯例），
   空字符串兼职「无鉴权」会造成同一信号两个互斥含义，UI 无法区分。

定案形状：

- **新建时**：key 框可留空，旁注「本地端点（如 Ollama）可留空」。
  留空保存弹一次确认「未填 API key，确认此端点无需鉴权？」——护栏由
  确认弹窗承接；确认动作即显式意图，底层存为无鉴权状态。
- **编辑时**：留空维持「保持不变」；新增显式「清除密钥」动作
  （顺带堵上「已存 key 无法清除」的真缺口）。
- **测试 / 拉模型列表**：对无鉴权 provider 同步放行。
- 底层表示倾向 `ManagedModelAuthKind` 加第三种 `"none"`（避免到处
  special-case 空字符串；`credentialStatus` 无「有意为空」概念），
  实现时可再定，不影响方向。
- Agent API 影响为 additive，不碰 schemaVersion。

## 启动信号

- 第二个用户提出同类需求（空 key / 本地端点 / ollama）；或
- 自己要给预设表加 ollama / 本地端点条目时（届时本项是前置）。

## 待定

- `authKind: "none"` vs 其他底层表示（如 credential store 存空串哨兵）。
- 「清除密钥」入口形态（provider 编辑器内按钮 vs 行级菜单）。
- 确认弹窗文案；en 文案同步。
- 是否顺带加 ollama 预设（本轮未裁决，倾向随本项一起看）。

## 关联

- issue：https://github.com/wangjc683/galley/issues/24
- 近亲：deferred.md「`api_key_header` 的 GUI 入口」——同为
  Settings → Models 鉴权面的暂缓项，启动时可考虑同批。
