# 11 手册：读不出的截图不找识字办法、不为它打回

Status: done（2026-11-10 合入；手册的新句子已核对在 dev 的二进制里）

来源：2026-11-10 全仓审计票 [10](./10-loose-ends.md) 对评测用例 `w-long` 的诊断。JC 当天裁：「手册按修法 1 改」。

先读 `docs/agents/dispatch.md`、`docs/README.md` 的 Update Triggers（改助理手册那一行）、`docs/managed-ga-runtime/prompt-composition.md` 讲手册的一节、票 10 的 Comments。

## 背景

子任务交回的证据是截图时，主对话读不出图上的字（打包版的 Python 不带识字要用的组件）。评测里它每一遍都花三到五步去找识字的办法，有几遍还把子任务打回去，要它抄出截图上的字、给官网原文，而派活说明没有要这些。手册 `subtasks.md` 已有「不重做、不去源头重核（不上网、不装工具读文件）」与「只为派活说明要了却没给的打回」两条，模型从缝里钻了过去：它没有「装」工具，是去「找」现成的；它也不觉得让子任务抄字算多要。

## 1. 改哪些文件

- `docs/managed-ga-runtime/galley-assistant-manual/subtasks.md`
- `core/src/assistant_manual.rs`（钉手册措辞的测试）
- `docs/managed-ga-runtime/prompt-composition.md`（只在它引用了这条规则的原文时）
- `.scratch/main-chat/entry-layer-eval/`：`wake/cases.json`、`wake/results.md`、`README.md`，必要时 `run.py`

## 2. 怎么改

**手册**：在「Checking a result and reporting it」一节第二条（以 `That is the whole check.` 开头的那条）末尾接上下面这一句，**逐字照抄**，别处一个字不动：

> A screenshot you cannot read is one of those: the file being there and the subtask saying what it shows is enough, so do not look for a way to read it and do not send the work back to have it written out.

接上以后这一条是：

> - That is the whole check. Do not redo its work or re-check the evidence at its source (no browsing, no installing tools to read a file); tell the user plainly what you could not verify. A screenshot you cannot read is one of those: the file being there and the subtask saying what it shows is enough, so do not look for a way to read it and do not send the work back to have it written out.

按手册现有的折行宽度折行。

**测试**：`core/src/assistant_manual.rs` 里钉 `subtasks.md` 各条规则拼写的测试，加上这一句的关键片段；手册总字节数若有上限的测试，确认仍在限内（超了就停下写进回报，不要动上限）。

**评测**：
- 评测读的手册要是改过的这一版（票 10 的回报说 `w-long` 用的入口层是 11 月 3 日的旧版；手册是不是当前文件，先核实，写进回报）。
- wake 套件整套重跑一遍（规则变了，按 Update Triggers）；`w-long` 跑 3 遍。模型只用 `gpt-6.1-sol`，API key 接的那一条。
- 逐条对照改前的结果，写明哪些变了。别的用例里如果有「该打回而没打回」的新情况（比如子任务没交截图也放过了），那是这句话带来的副作用，单列出来。
- `w-long` 要看的两件事：还有没有去找识字办法的调用；还有没有为抄字、要原文打回。三遍都没有、且照规则给了要点和全文位置，就把这条用例的 `record_only` 去掉，恢复计分；否则保持只记录，写明还剩什么。

## 3. 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
<评测 README 写明的解释器> run.py --dry-test
node scripts/check-docs-links.mjs
git diff --check main..HEAD
```

静态提示词的字节预算测试必须原样通过（手册不在静态提示词里，但入口层点名每一部分，核对一下没有牵连）。

## 4. 别动什么

- 手册其余的字、其余各篇；`core/src/managed_prompt.rs` 的提示词正文。
- 别的用例的固定数据与判分。
- 历史运行记录（被替换的照老办法挪进 `meta.superseded_runs`）。

## 5. 回报格式

按 `docs/agents/dispatch.md`。评测部分：改前改后逐条对照表、`w-long` 三遍各自的工具调用在做什么、有没有副作用。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后 touch `core/src/assistant_manual.rs` 让 dev 重编，核对二进制里有这句话；状态根里的手册在主对话 runner 下次启动时才写 | 以后遇到子任务交回截图当证据时，Galley 不再绕去读图，回复里会说它没有亲眼核对 |

## Comments

**2026-11-10 合入（主会话）**

- 手册只多了票面那一句，按文件自己的行宽折行；`assistant_manual.rs` 新加一条测试钉住它在这一条里、排在「Send it back only…」之前。`prompt-composition.md` 没有引用这条规则的原文，没改。
- 评测读的是当前的手册文件（每一遍都从仓库现拷），冻结的只有入口层。
- wake 套件重跑（`gpt-6.1-sol`）：带截图的用例都不再找识字办法（`w-table` 的工具调用 8 次变 3 次，`done-evidence` 5 次变 2 次，`w-third-back` 4 次变 2 次），仍核对截图文件在不在；`done-no-proof` 照样打回；没有「该打回却放过」。
- `w-long` 保持只记录：三遍都不再找识字办法、不为抄字打回，但第 3 遍把整份内容改写进了回复（没写成文件、没说全文在哪）。这种情况以前没出现过，三遍样本分不清是波动还是改动带来的。
- 判分的一个漏洞已补：关键词按子串匹配，「点开」会命中「景点开放时间」。别的用例的词表没有查。
- 没做、JC 没有回话的：加一条「派活说明要了截图、文件却不在」的用例，测这句话会不会让这种情况被放过。
- 评测对应的是打包版（读不出图）；开发版 runner 的 Python 能调系统的识字框架，dev 里的行为可能不同。
