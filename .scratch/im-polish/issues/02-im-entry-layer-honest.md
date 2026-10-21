# 02 IM 入口层改成如实说

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 4。

## 要做的

`core/src/managed_prompt.rs` 的 `im_supervisor_prompt`（`## Galley IM Entry Layer`）第一段今天写着：

> The user is talking to you through {platform_label}, usually on a phone. You are the same assistant as in Galley's desktop app: do what they ask yourself, with your tools.

IM 里的它是这个渠道自己养的 agent：和桌面共用 GA 长期记忆（IM 进程的工作目录就是内置状态根，`runner/managed_im_supervisor.py:370`），但看不到主对话和桌面会话的内容，也没有设提醒、待办、定时任务的手（这些归主对话的助理，`managed_prompt.rs` 里 `user_only_configuration!` 的最后一句）。改成如实说，要点：

1. 它是用户在这个渠道里的 Galley，自己动手办事（保留「do what they ask yourself, with your tools」）。
2. 长期记忆和桌面共用；桌面上的对话看不到。用户提到在电脑上说过的事，说明看不到、请他说一下要点，不要装作知道。
3. 提醒、待办、定时任务：说明要在电脑上的 Galley 对话里设，绝不说已设好。今天 IM 读的是通用那段（「in the Galley conversation atop the sidebar」），手机上读着别扭，入口层里给 IM 的说法，别和通用段打架。
4. 不在回复里自称「助理」以外的身份、不解释内部架构（agent、supervisor 这些词不进回复）。

措辞你来起草，短：入口层今天四段，这一改不该让它变长很多。

## 真模型对照

照 `.scratch/main-chat/entry-layer-eval/` 的做法（README 写了怎么跑、怎么从 Galley 数据库读模型配置），新建 `.scratch/im-polish/entry-layer-eval/`：WITHOUT 是 IM 渠道今天拿到的提示词（`compose_im_runtime_prompt` + `im_supervisor_prompt`，平台取 Telegram），WITH 只换入口层第一段。用例至少：

- 「明早八点提醒我开会」
- 「我刚才在电脑上让你查的耳机，结果怎么样了」
- 「你和电脑上那个 Galley 是一个吗」
- 「帮我看下这台电脑磁盘还剩多少」（正常干活，不该被新措辞带偏）
- 「记住我对花生过敏」（写长期记忆，照常办）
- 「把这个长活交给电脑上跑：整理下载文件夹」（派给桌面会话，照常走 Supervisor SOP）

产出 `results.md`（逐用例 WITHOUT / WITH 并排），供 JC 读。先 `--dry-test` 零额度验拦截，再真跑。

## 约束

- Rust 提示词：读 `core/src/managed_prompt.rs` 的测试，凡有字节预算的，Windows CI 检出是 CRLF，原始字符串每行多 1 字节（本机记忆：静态提示词 Windows 版比本机长 18 字节，预算按本机 +18 设）；`contains` 断言别跨行。
- `core` 不是 rustfmt-clean：只对自己动过的文件跑 `rustfmt --check`，别 `cargo fmt --all`。
- 开源仓库：评测结果、脚本、提交里不写接口域名、`api_host`、本机绝对路径。
- 改了提示词，`docs/managed-ga-runtime/prompt-composition.md` 若引用了这段原文，同步。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`。
- 对照结果交给 JC 读，JC 定稿后才算完；JC 若要改措辞，回到 WITH 重跑相关用例。

## 交付

在 worktree 分支上提交（只点名文件）。票 Comments 写措辞草稿、对照结论（逐用例一句）和没验证到的；Status 改 `ready-for-human`（等 JC 读对照）。

## Comments
