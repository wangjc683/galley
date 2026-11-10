# 10 收尾：评测用例 `w-long`、`run.py` 丢记录、种子清单、失效的暂缓项

Status: ready-for-agent

来源：2026-11-10 全仓审计收尾时列出的五件小事，JC：「1 - 5 都处理一下」。其中「`AGENTS.md` 的 Product Shape 措辞不改」不需要动手，记在本票 Comments。

本票分两部分，共用一个 worktree：**甲**由执行代理做（评测目录），**乙**由主会话自己做（一个 Rust 常量与一处台账）。

先读 `docs/agents/dispatch.md`。

## 甲：评测（执行代理）

先读 `.scratch/main-chat/entry-layer-eval/README.md` 里讲 `w-table`、`w-long` 的几节（票 134 的三轮、票 147）与 `wake/cases.json` 里这条用例。

### 1. 改哪些文件

只在 `.scratch/main-chat/entry-layer-eval/` 里：`run.py`、`wake/cases.json`、`wake/results.md`、`README.md`。原始的 `results.json` 是被忽略的本地文件，照常读写。

### 2. 怎么改

**甲 1：`run.py` 丢记录**

普通的 wake 运行会把 `wake/results.json` 里 `meta` 下票 147 的评测记录（`T147_KEY`）丢掉：`main()` 把别的 meta 键带过去了，没带这一个。把它加进要带过去的清单；`--dry-test` 里补一条断言守住（跑一次普通的 wake 路径后这个键还在）。先确认说法成立。

**甲 2：`w-long` 为什么一直不过**

2026-11-10 重跑 wake 套件时 `w-long` 三遍全不过，记录的原因是撞到套件的 8 次工具调用上限、没回复就停了。README 里它的历史是 0/3、1/3、0/3，并写着「长回答的『给要点、说全文在哪』一遍都没走到」。这条用例要测的是：子任务交回一份很长的成品时，主对话给要点并说全文在哪（主聊天 PRD 裁决 183 第 4 条、198）。

要回答的问题只有一个：**现在的不过，是评测搭得不对，还是主对话真的做得不对？**

- 读三遍的原始转录（`wake/results.json`），逐遍写下每一次工具调用在做什么、8 次用在了哪里。
- 对照真实产品：真机上一轮的上限是 180 步，不是 8；这 8 次是套件自己定的。它在读什么是真机上也会读的（比如按手册去读交回的全文），什么是沙盒造成的空转（读不到的截图、假 CLI 的应答与真 CLI 不一致、固定数据让验收每次都能挑出毛病）。
- 再看判分：字数上限、要出现的词，是不是把「照规则做对了」的回答判成了不过（README 记过一次：只因超过脚本定的字数上限）。

然后二选一，并写清依据：

- **评测搭得不对**：改评测，让这条用例能测到它要测的东西。可以改的只有套件自己的东西：这条用例的调用上限、假 CLI 的应答、固定数据里让验收空转的毛病、判分的阈值。每一处改动写明它对应真机的什么事实。改完把 `w-long` 重跑 3 遍（模型只用 `gpt-6.1-sol`，API key 接的那一条），结果记进 README 与 `results.md`。同套件其余用例不许退步：重跑前后用 `--dry-test`，并说明为什么改动不影响它们（改动只作用于这条用例的话，不必重跑全套）。
- **主对话真的做得不对**（比如它在真机上也会这样把步数耗在读手册上）：**不要改手册与提示词**。把证据（哪一遍、第几次调用、在做什么）和两三个可选的修法写进回报与 README，这条用例标成只记录、不计入通过率，并写明原因。改手册要 JC 裁决。

两种情况都可能各占一部分：分开写。

### 3. 验证

```bash
<评测 README 写明的解释器> run.py --dry-test
node scripts/check-docs-links.mjs
git diff --check main..HEAD
```

评测结果只报通过数与没过的遍数各自的原因；不写服务商名与接口主机；固定数据用虚构内容。

### 4. 别动什么

- `docs/managed-ga-runtime/galley-assistant-manual/`、`core/src/managed_prompt.rs`、任何提示词文件的正文。
- 别的套件、别的用例的判分与固定数据。
- 历史运行的记录（`meta.superseded_runs` 等）：被替换的运行照老办法挪进去，不删。
- `core/`、`docs/devlog/`（主会话在同一个 worktree 里改，别碰）。

### 5. 回报格式

按 `docs/agents/dispatch.md`。「评测搭得不对 / 主对话做得不对」的结论与证据单列一节。

## 乙：主会话自己做

- `core/src/managed_runtime.rs` 的 `CRITICAL_MEMORY_SEED_FILES` 缺 `ultraplan_sop.md`，而 `scripts/managed-ga-payload-rules.mjs` 的同一份清单里有它。补上，并加一条测试让两份清单保持一致。
- `docs/devlog/deferred.md` 里「上游 issue：计划模式撞 100 步上限前没有任何提醒」一节：内置内核自 2026-10-18 的基线起没有计划模式的单独上限，这一节描述的问题已不存在。删掉。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后 dev 重启正常；设置里重置主对话的入口不报种子不完整（只读地核对种子目录里有这个文件） | 无 |

## Comments
