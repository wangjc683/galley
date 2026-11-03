# 139 派活条款收成几句判断；拆掉硬闸；评测改量结果

Status: ready-for-agent（2026-11-03：票 136、137、138 已合入）

来源：[主对话 PRD](../PRD.md) 裁决 186 第 3 条（「少规矩、多手」的收尾）。只在内置运行时的主对话；外置零变化（外置没有主对话）；IM 入口层不动（IM 自己养 agent）。

## 为什么

- 派活条款一个月定了六版（10-06、160、174、183、184、185），每次真机冒出新场景就补一句、换一条线；它们在替「主对话一次只能做一件事、做事时你够不着它」打补丁（裁决 186 第 1 条）。
- 三只手已经到位：插话改道（票 136，你跑着时说的话下一步就送到它面前）、先说一句（票 137，`tell_user`）、子任务带着这段对话出门（票 138，最近 10 轮作只读背景）。条款里替这些补的句子可以删了，判断交给模型。

## 要做到

### 1. 入口层派活一段（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）收成几句判断

现在的原文从「You do not go online in this chat, …」起，到「… which the user cannot see.」止（票 134 第四轮之后）。改成几句判断加两条准则，意思如下，措辞由你定，句子要短，照条款现有的写法：

- **判断**：你可以自己做（包括上网查），也可以交给子任务，几件同时做。用户随时能跟你说话，你下一步就看得到；他说的是别的事、手上的还要很久，就把手上的交出去先回他，或者先给他说一句（`tell_user`）再接着做。
- **准则一**：讲世上的事实（人物、事件、比赛、新闻、数据、价格、某人近况），先查、附出处，自己查或交出去都行；概念、道理、怎么做、看法、凭这段对话已有的，直接答（裁决 185 留下的那一半）。
- **准则二**：改他电脑或账号上的东西，照手册 `authority.md` 的三级授权（[助手 PRD](../../assistant/PRD.md) 裁决 3）。裁决 186 第 3 条写的「先问」是主会话的笼统说法，以三级授权为准，不新加规矩。
- **交出去时**：子任务会带着这段对话最近几轮（票 138），派活说明写目标、要交回什么和凭证就够，不用抄前文；删掉「a separate conversation that cannot see this one, so write everything it needs」和「(a subtask cannot see this conversation)」两处。标签与标题（`<subtask title="…">`）、并行那几句（一件一个标签；要合成一份交回的放一个标签；同一个标签页、同一批文件的不拆）、「告诉用户在路上」、不等也不盯、用这个而不用 `subagent.md`，照留。
- **删掉**：「You do not go online in this chat …」整句及其例外清单（天气、比分、curl）、「writing up what you two discussed」那条例外、「do not explain why it is not done here, cite a rule」那半句。「call this chat the main chat」那一点留下（裁决 173：内部叫法不进给用户的话）。
- **字节预算**（`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`）按新条款重定，照第三、四轮的做法写明分项；`\r` 不计。
- 上方文档注释补一段第五轮：裁决 186、为什么删这些句子、三只手各在哪。

### 2. 拆掉票 135 的硬闸

- `runner/handlers.py`：`_main_chat_refuses`、`MAIN_CHAT_BROWSER_REFUSAL`、`BROWSER_TOOL_PREFIX` 与 `dispatch` 里那一段删掉；测试跟着删改。
- `GALLEY_MAIN_CHAT` 环境变量**留着**：票 137 的 `tell_user` 靠它认主对话。核一下还有谁读它，文档里写明它现在的用处。
- 文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`prompt-composition.md` 里硬闸的条目改成「11-03 拆掉，裁决 186」。

### 3. 手册（`docs/managed-ga-runtime/galley-assistant-manual/`）

- 撤裁决 184 第 9 条的改动：`wake.md` 到点提醒要查东西时，可以自己查，也可以交给子任务（照判断）；巡看看备忘那条同样；`<no-reply/>` 规则里「提醒的查询交给了子任务」那种情况照留（交出去时仍适用）。
- `unasked.md`：「Quick work that needs no web you do this turn; …」改回不按上不上网分，照判断。
- `subtasks.md`：派活说明那几句随第 1 条改（子任务带着这段对话）；成品原样贴回那几句照留（裁决 183 第 4 条）。
- grep 全部手册，凡是「不上网」「交给子任务因为看不见这段对话」一类的句子都对一遍。

### 4. deferred

`docs/devlog/deferred.md`「主对话用代码上网」撤掉（主对话不再禁止上网）；`docs/project-status.md` 的未发版范围由主会话改。

### 5. 评测改量结果（`.scratch/main-chat/entry-layer-eval/`）

加一组 `v5`（新条款，提示词从 Rust 生成、与 `managed_prompt.rs` 一字不差），不带硬闸。判的是结果，不再判「第一个工具是不是浏览器」：

- **事实**（`fact` 那几条：伤病、讲讲、勇士主教练、天气、汇率、笔记软件）：查了（自己开浏览器，或派出去且说明里要出处）算合格；凭记忆直接答、没有出处算不合格。沙盒里浏览器不执行，停在浏览器那一步就算「自己在查」。
- **概念、怎么做、凭这段对话的追问**：直接答、不调工具算合格；`q-followup-quick` 照旧不计分。
- **差事**（整理、改名、写文件、下单类）：自己做或交出去都算合格，记下是哪种；碰到要授权的，看它有没有照 `authority.md`。
- **插话**：沿用票 137 的 `tell-user` 套件（插话写进 `intervene` 的做法），用 v5 重跑：插话后它多久让用户看到回音（`tell_user`、交出去先回、或者闷头做完），分类计数；不插话的短事、长事看有没有滥用 `tell_user`。
- **几件同时做**：`dispatch-parallel` 用 v5 重跑，看拆不拆、标签数。
- 到点提醒（`schedule/`）用 v5 重跑：查东西的提醒自己查或交出去都行，只提醒的照旧到点说。
- 模型写死 `mm_1792576875658`（API key 接入）；解释器用评测 README 写的系统 python3.14。额度够（JC 11-03），把结论跑扎实，用量写进报告。新条款有用例没过时，最多改一轮措辞、只重跑没过的，然后回报。

### 6. 可能追加

票 141 诊断建议在入口层「read the parts it needs, together」后点名写之前要同一步读的东西（查重的 `list`、改待办前的 `show`、相对时间的时钟），待 JC 定；定了我会发消息给你，放进同一轮措辞、同一次评测。评测放在最后跑。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
node scripts/check-docs-links.mjs
git diff --check
```

改到 GUI 就加 `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui exec vitest run`（预计不用改 GUI）。worktree 里跑 runner 测试借主树的 venv，先打印 `runner.__file__` 确认 import 的是 worktree 的代码。`rustfmt --check` 只查自己改过的 Rust 文件。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t139-judgment-not-rules <scratchpad>/wt-139 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：GUI（除非测试要）、CLI、Agent API、迁移、IM 入口层、外置。
- Windows CI 检出是 CRLF：Rust 原始字符串的 contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t139-` 前缀。票面与结果里不写本机用户目录、worktree 路径、服务商名、接口主机；用例里的人名用虚构的（NBA 球员、公开的产品型号可以）。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：条款与手册的最终原文；字节预算旧值、新值、分项；改了哪些文件、哪些断言；评测每组每个用例三遍各自的结果、插话套件的分类计数、真模型调用次数；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。
