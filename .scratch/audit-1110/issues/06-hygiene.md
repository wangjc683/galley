# 06 开源卫生：测试夹具里的家目录、私有仓名、手册里的真实例子

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 D20（JC：「按建议推进」）。git 历史不改写。

先读 `docs/agents/dispatch.md`、`docs/README.md` 的 Update Triggers（改助理手册那一行）、`docs/managed-ga-runtime/prompt-composition.md` 里讲手册的一节。

**本票的票面与回报里不要复述要抹掉的内容**：只写文件与行号、它是哪一类。

## 1. 改哪些文件

- 用维护者的短名拼家目录当假路径的测试：`core/tests/db_test.rs`，以及 `gui/src` 下约九个测试文件
- `.scratch/ios-client/PRD.md`（点了一个私有仓库的名字）
- `docs/managed-ga-runtime/galley-assistant-manual/` 里引用了真实待办内容的例子、`core/src/assistant_manual.rs` 里钉这些拼写的测试、`.scratch/main-chat/` 里把同样内容当「库里读到的底数」引用的 PRD 与票、相关的评测用例

## 2. 怎么改

一组一个提交。

**夹具里的家目录**

`git grep -nE "/Users/[a-z]+" -- core/tests gui/src` 列出全部，把短名是真人的那些换成仓库里已经在用的中性占位（`/Users/me` 一类，看同目录测试的习惯）。断言里依赖路径长度或截断位置的测试（比如显示路径、文件卡片）要保持断言的意图：换占位后重新算预期值，别只是让它变绿。

**私有仓名**

`.scratch/ios-client/PRD.md` 里那两行点名了一个私有运维仓库，改成中性的描述（「公司的运维仓库」一类）。全仓再扫一遍同一个名字（`docs/devlog/` 与 `docs/archive/` 只报告不改）。

**手册里的真实例子**

助理手册的两篇里有例句直接用了维护者自己库里的待办（一处关于某个房间的装修验收，一处关于一份预算与酒店在清单里的先后）。项目自己的规则（2026-11-02，票 119 之后）是：票面与文档只写形状，字用虚构的。
- 换成同形状的虚构例子：句子长度、结构、要示范的那条规则都不变，只换名词。
- `core/src/assistant_manual.rs` 的测试钉着手册里的拼写，同步改。
- `.scratch/main-chat/` 里引用同样内容的 PRD、票与评测用例，换成同一组虚构例子，保持彼此一致。
- 例句变了，按 Update Triggers 重跑对应的评测套件（`.scratch/main-chat/entry-layer-eval/` 的 `wake` 与 `todo`）。模型只用 `gpt-6.1-sol`；评测目录 README 写明用哪个解释器。先 `--dry-test`，再真跑。结果里不要写服务商名与接口主机。跑不了（没有可用的模型配置）就停下写进回报，不要换别的模型。

## 3. 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck && pnpm --dir gui lint && pnpm --dir gui test
TZ=UTC pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check main..HEAD
git grep -nE "/Users/[a-z]+" -- core/tests gui/src | grep -v "/Users/\(me\|you\|x\|alice\|u\|demo\|fixture\)" 
```

最后一条的输出贴进回报并逐条说明为什么留。

## 4. 别动什么

- 手册的规则本身、判断标准、段落结构。只换例句里的名词。
- `docs/devlog/` 条目、`docs/archive/`。
- 评测的判分逻辑与用例的意图。
- 不改写 git 历史。

## 5. 回报格式

按 `docs/agents/dispatch.md`。评测结果只报通过数与没过的用例名。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后 touch `core/src/assistant_manual.rs` 让 dev 重编，核对二进制里是新例句；推送前对推送范围再扫一遍 | 无 |

## Comments
