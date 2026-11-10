# 09 开源卫生补扫：同两处真实待办在别处的引用

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 D20。票 [06](./06-hygiene.md) 把助理手册与 `.scratch/main-chat/` 里的两处真实待办换成了虚构例子（一个门牌号、一个客户项目的品牌名），回报里列出同样的内容还留在测试、文档与提示词夹具里。D20 的原话包括「测试」，本票把剩下的补完，接在票 06 的分支上做。

先读 `docs/agents/dispatch.md` 与票 06。**票面、提交说明与回报里不要复述被换掉的内容**：只写文件、行号与它是哪一类。

## 1. 改哪些文件

票 06 回报「票外发现」里列的那些，以 grep 为准重新找一遍：

- Rust：`core/src/managed_prompt.rs`（一处文档注释与测试夹具）、`core/src/assistant_todo.rs` 的测试、`core/tests/` 与 `cli/tests/` 里用到它们的测试
- GUI 测试：`gui/src` 下待办面板、备注、巡看相关的测试文件
- 活文档：`docs/managed-ga-runtime/prompt-composition.md`、`docs/design/conversation/reply-cards.md`、`docs/design/layout-and-chrome.md`、`docs/project-status.md`、`.scratch/assistant/PRD.md`
- `.scratch/main-chat/issues/` 里某张票的 `Status:` 行带着维护者的家目录路径：换成中性描述
- `.scratch/main-chat/entry-layer-eval/schedule/rust-samples.json` 与 `managed_prompt.rs` 的夹具重新对齐

## 2. 怎么改

- 用票 06 定下的同一组虚构名词，全仓一致。它们与原词等长，截断位置与字数上限不受影响；仍然逐个核对断言里依赖长度的地方。
- `core/src/managed_prompt.rs`：**只动文档注释与 `#[cfg(test)]` 里的夹具**，不动任何发给模型的提示词正文。静态提示词有字节预算的测试，改完它必须原样通过。
- `schedule/rust-samples.json` 是从 Rust 测试夹具生成的：按评测目录 README 的办法重新生成，使两边一致；跑 `--dry-test`。提示词与手册的规则没有变，不重跑真模型评测。
- `docs/reply-cards.md` 里引用手册旧例句的那一行，跟着手册的新写法改。
- `docs/devlog/` 的条目与 `docs/archive/` 不改，只在回报里列出文件与行号。

## 3. 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck && pnpm --dir gui lint && pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check main..HEAD
```

外加评测的 `--dry-test`，以及一条全仓扫描：两处原词在已跟踪文件里（除 `docs/devlog/`、`docs/archive/`）不再出现，命令与结果的行数写进回报（不贴匹配到的内容）。

## 4. 别动什么

- 发给模型的提示词正文、手册的规则。
- 测试的意图：只换名词。
- `docs/devlog/` 条目、`docs/archive/`。
- 不改写 git 历史。

## 5. 回报格式

按 `docs/agents/dispatch.md`。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 推送前对推送范围再扫一遍 | 无 |

## Comments
