# 98 备忘的收尾：看出来的兴趣记得上；没变化的 update 不再叫醒巡看；样例写法与手册对齐

Status: ready-for-agent

来源：票 [96](./96-memo-manual-and-eval.md) 的实现回报（「没验证到的」第 1 条与「看到但没改的」三条），主会话验收时定下全做（2026-10-26，JC 对这一组的授权：「按你建议推进」）。依赖票 95、96、97（都已合入 main）。只改 Core 的一个判断、手册、几处样例与评测；外置运行时零变化。

## 为什么

1. **看出来的兴趣两遍都没记**：评测 `memo/` 的 `interest-team`（上文三轮都在问同一支球队，这一轮又问）两份措辞各 0/1，模型的注意力都在「上文的赛程靠不靠得住」，没想到这是反复出现的兴趣。JC 定过要记（裁决 140 第 6 条：「了解用户的兴趣习惯也很有帮助」），这是裁决里唯一没做到的一类。
2. **没变化的 `memo update` 也会重新盖 `fresh_at`**（`core/src/db/memo.rs` 的 `update_memo`）：手册写「同一件 `memo update` 那条，不新加」，模型若每问一次 76 人就 update 一次（比如把「这周」改成「这两周」也算变化，但原样再写一遍不算），第二天巡看又会因它醒，正是裁决 143 第 1 条要避开的「每天推比分」。
3. **票 95 的样例写法与手册相反**：`core/src/managed_prompt.rs` 的测试 `memo_lines_read_like_this`、`core/src/subtask_report.rs` 的相应测试、`docs/managed-ga-runtime/prompt-composition.md` 的样例里写「用户叫小林……」「看他这周常问 76 人」，是 `memo.md` 说不该写成的样子；JC 读文档会拿它当范例。
4. **目录不全**：`authority.md`、`cli.md` 里没有备忘命令，权限与命令只在 `memo.md`。
5. **旧套件的期望早于备忘**：`todo/`、`chat/` 套件里公司成立日、航班号、学吉他这几条，现在记了备忘只会被注出来、判法没跟上。

## 要做的

1. **兴趣**：改手册与（必要时）入口层，让「同一样东西反复问」被认出来。方向（你按评测选，回报里写选了哪个、为什么）：
   - 给一个看得见的判据，例如「最近几轮里第三次问到同一样东西（一支球队、一只股票、一部剧、一个地方），记成兴趣」，写进 `memo.md`「What to note」；
   - 入口层那句（`managed_prompt.rs` 主对话入口层「Note what you learn about the user…」）若要再改，字数越少越好，预算照记账写法调；
   - 不在 Core 加计数或后台整理（裁决 140、141：记不记交给模型；段界补记仍在 deferred 等信号）。
   评测：`interest-team` 之外再加两条同类用例（一只股票、一部剧，上文各三轮），三条各跑两遍；`trip-hotel` 再跑两遍（上一轮改后只过了一遍）；`pref-cilantro` 跑一遍看没回退。总共不超过 10 次运行，模型 `--model-id mm_1792576875658`。改了措辞就重新生成 `galley-prompt/`、`--dry-test` 要过。
2. **`fresh_at` 只在真有变化时重盖**：`update_memo` 在正文（去掉首尾空白后）与期限都和原来一样时，不改 `fresh_at`、不改 `updated_at`；事件照写还是不写，你定（倾向不写：卡片上不该出现一张「改为」同样的话），回报说明。加测试：原样 update 不动 `fresh_at` 与 `updated_at`；只改期限、只改正文各算一次变化。`docs/agent-api/memo-commands.md` 若描述了 update 的效果，补一句。
3. **样例改成手册的写法**：上面三处样例的正文改成写给用户看的样子（如「叫你小林，在一家设计公司做产品经理」「看你这周常问 76 人的比赛」），测试断言跟着改；顺手看 `docs/agent-api/memo-commands.md` 与 `.scratch/main-chat/issues/95-memo-core-and-cli.md` 之外的现行文档有没有同样的写法（票 95 的票面与 Comments 是历史，不动）。
4. **目录**：`authority.md` 列「不用问就能做的」那里、`cli.md` 列命令那里，各补一行备忘（照两份现有的写法），`assistant_manual.rs` 的断言与交叉引用数跟着改。
5. **旧套件的期望**：`todo/`、`chat/` 套件里会因记了备忘而被注出来的几条，把期望改成「记成备忘也对（或应当记成备忘）」，只改判卷，不重跑；README 对应几节补一句。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`；备忘的表结构、命令的形状、段首一节的格式、巡看窗口与叫醒说明；其他套件的结果文件（只改判卷与 README）。
- Core 里不加兴趣计数、不加后台整理。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新增行不能有本机路径、会话 id、真实数据、私有接口地址、服务商名、key。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`，再 `TZ=UTC` 一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 评测 `--dry-test` 过（`PYTHONDONTWRITEBYTECODE=1` 与 README 点名的解释器），`managed-ga/`、`runner/` 下没有 `__pycache__`。
- 新增中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 兴趣：选了哪个方向、改动的 diff 原样、预算变化；评测每条两遍的结果表，不过的贴原文；运行次数与模型调用次数。
3. `update_memo` 的 diff 原样，事件写不写的决定。
4. 改了哪些样例与文档。
5. 验证命令与结果原样。
6. 看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

并进票 97 的真机步骤（一组走）：第 1 步之后，连着三轮问同一支球队的事，第三轮回复下应当出现「记下了 · 看你……常问……」的卡片。
