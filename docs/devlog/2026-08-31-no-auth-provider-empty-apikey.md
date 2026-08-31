# 无鉴权 Provider：空 API Key 的表达（galley#24）

**日期**：2026-08-31
**上下文**：社区 issue [galley#24](https://github.com/wangjc683/galley/issues/24)（2026-08-29）：「在 generic 里可以编辑 mykey 里 apikey 为空，Galley 里咋弄？」——典型场景是无鉴权本地端点（Ollama / 本地代理 / 内网网关）。

## 现状勘查：四层独立闸门 + 一个关键事实

空 apikey 在改动前被四层独立拦死：GUI 保存门（`provider-setup.ts` 的
`canCommitProviderSetup`）、Rust 保存（`managed_model.rs` "API key is
required"）、会话启动过滤（`runner_commands.rs` 空 secret 静默跳过）、
runner（`managed_runtime.py` `if not cfg["apikey"]: continue`）。

两个决定方案走向的事实：

1. **GA 引擎完全接受空 key**：`llmcore.py` 只要求 `apikey` 字段存在，
   且无条件发 `Authorization` 头（空值也发）。由此推出**占位 key 与空
   key 功能完全等价**——本地端点会忽略该头。issue 已先用这条 workaround
   回复解掉燃眉之急（填 `sk-local` 即可）。
2. **「GA 可留空」从来不是 UI 入口**：GA 自己的桌面 UI 新增时也必填
   key（`desktop_bridge.py` "apikey is required"），用户说的是手改
   `mykey.py`——Galley 有意不暴露的路径。

## 裁决：直觉留在表面，显式沉到底层

JC 提问「允许空字符串直接传入是不是更直觉」。答案拆两半：

**录入面成立**：「不需要钥匙就不填」是正确的心智模型，强迫用户先在
下拉框选 `auth: none` 等于要求先学会我们的分类学。LM Studio /
OpenWebUI 这类本地生态都是「API Key（可选）」一个框。

**纯放开空字符串被否，两条理由**（今后再提「把空 key 校验删掉就行」
从这里开始谈）：

1. **防错护栏**：对多数云端 provider，空 key 就是失误（忘粘 / 粘错框）。
   放开后错误从「表单当场报错、有上下文」推迟到「运行时 401、无上下文」。
2. **信号已被占用**：密钥框不回显明文，编辑已有 provider 时「留空」的
   既有语义是「保持原 key 不变」（`provider-setup.test.ts` 有意测死的
   行业惯例）。空字符串兼职「无鉴权」会让编辑态的空框一号两义，没有
   任何 UI 手段能区分。

**合成方案**（JC 无异议后落地）：

- **新建**：key 可留空 + 旁注「本地端点（如 Ollama）无需鉴权，可留空」；
  留空保存弹一次确认「确认无需鉴权？」——护栏从「按钮死掉」换成
  「一次确认」，只打扰留空的少数人。确认动作即显式意图。
- **编辑**：留空维持「保持不变」不动；新增显式「清除密钥」入口。
- **底层**：`ManagedModelAuthKind` 加第三种 `"none"`，而非到处
  special-case 空字符串。存储与四层校验拿到的是无歧义状态。

### 清除 = 转无鉴权（JC 裁决）

顺带堵上勘查中发现的真缺口：**已存 key 此前无法清除**（留空=保留，
唯一手段是删整个 provider）。清除语义两选一：「变为无鉴权」vs「变为
未配置」。裁决前者——心智模型只有一个（有 key / 没 key），想换 key 的
人直接输新 key 覆盖、不需要先清除；清除作用于**已保存的 provider
记录**而非表单草稿（避免把未保存的 apiBase 编辑一并提交）。带确认弹窗，
重新输入 key 随时恢复 `api_key`。

### 本轮不加 Ollama 预设（JC 裁决）

预设表至今没有本地条目，加了确实一步到位，但预设牵动默认模型列表、
命名等一串新决策，保持 scoped、单独一轮做。届时本项是它的前置。

## 实现要点

- **有效 authKind 推导**（`effectiveProviderAuthKind`，纯函数）：codex
  不动；有 key → `api_key`；空 + 已是 none → `none`；空 + 有已存 key →
  `api_key`（保持不变）；空 + 无已存 key → `none`。保存与所有探测
  （测试连接 / 拉模型列表）统一走它，于是创建流里空 key 的「测试」按钮
  也活了——本地端点直接通，云端端点回真实 401（比死按钮信息量大）。
- **credentialStatus**：none provider 无 secret 行但报 `present`
  （`rows.rs` 集中处理）——所有「需要凭证 / 重新保存密钥」的 GUI 消费点
  （ProviderCard 徽章、连接检查门、SettingsHost）自动保持安静；卡片上
  改挂中性「无鉴权」徽章（非警告色）。
- **Rust 保存**：`auth_kind == None` → 幂等删除已存 secret（清除流即
  普通保存）；探测 `resolve_secret` 对 none 返回空串；会话启动对 none
  模型跳过 secret 门、不进 credential IPC allowlist，`api_key` 直接给
  空串（无 IPC 往返）。
- **runner**：`managed_runtime.py` 的可用性过滤对 `authKind == "none"`
  放行空 apikey；`apibase` / `model` 仍必填。
- **契约面**：DB `auth_kind` 是 TEXT 无需 migration；`managed-models.json`
  与 Tauri 命令入参均为 additive；CLI Agent API 不暴露该面，
  schemaVersion 不动。

## 验证

cargo check/test workspace、gui typecheck/lint、vitest（provider-setup
20 例含新增 6 例）、runner pytest 235 passed（含新增 no-auth 用例）+
mypy + ruff 全绿。onboarding 与 Settings 两条创建流共用 controller，
确认弹窗两处都接了。真机视觉验收待 JC。

## 关联

- [.scratch/no-auth-provider/PRD.md](../../.scratch/no-auth-provider/PRD.md)（勘查全文 + 闸门清单）
- deferred.md「`api_key_header` 的 GUI 入口」——同为 Settings → Models 鉴权面的暂缓项，启动时可与 Ollama 预设同批评估
- 2026-07-17 model-config UX（本表单的上一次大改）
