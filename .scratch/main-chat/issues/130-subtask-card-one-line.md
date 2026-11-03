# 130 子任务卡片降成一行回执

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 179。只改 GUI：子任务卡片、它的文案与测试、设计文档；不动 Core、侧栏、待办面板、待办 / 备忘 / 提醒卡片。只影响内置运行时。

## 为什么

JC 真机：子任务在主对话、侧栏、待办面板三处都看得见，卡片「抢戏」，视觉层级应低于主对话的消息。现在的卡片借工具块外框（`gui/src/components/conversation/SubtaskCards.tsx:139-177`）：细线框、左边 3px 状态竖条、在跑时铺浅底，两行（标题 13px 中等字重 `ink`，下面一行 12px 的步数或结果），右边「打开」按钮；一张约 60px。同一条回复下的待办、备忘、提醒卡片都是一行、约 40px、页面底、没有竖条。卡片第二行与侧栏那一行、与 Galley 的交代重复。

裁决 179 定：侧栏管「现在谁在跑、谁在等你」，卡片只管「这条回复派出过什么，点进去看」，待办面板不动。

## 要做到

1. **外框照待办卡片**（`gui/src/components/conversation/TodoCards.tsx:103-105`）：`rounded-md border border-line bg-app`，一行，至少 40px（`min-h-10`），`py-1.5 pl-4 pr-3`，图标列 16px（`h-5 w-4`），间距 `gap-2.5`。去掉左边竖条、在跑 / 在问你 / 失败的浅底（`SubtaskCards.tsx` 约 `:288-294` 的 `frame` 表）。卡片之间 `gap-2`、离气泡 12px、与待办卡片之间 8px 照旧。
2. **一行写什么**：
   - 左边状态图标，**静止**：侧栏那一行已经在转，卡片不再转。
     - 在跑：选一颗静止、`ink-muted` 的图标（比如 Phosphor 的 `CircleDashed`，读作「还没完」，别用不转的 `CircleNotch`，看着像卡住了）。
     - 做完：`CheckCircle`，muted，同现在。
     - 在问你：实心 `PauseCircle`，`warning`，同现在。
     - 失败、没派出去：`XCircle`，同现在的色。
     - 没有跑完：同现在。
     - 选了哪颗、为什么，写进报告。
   - 标题：13px，`text-ink`，常规字重（同待办卡片标题，不再 medium），一行省略，被截断时悬停给全文（照待办卡片的做法）。没有标题时照旧写「子任务」。
   - 右边一个短词，12px，只在这几种时写：
     - 在问你：「等你回复」，`warning`，`font-medium`，同侧栏；
     - 失败：「出错」，`text-error`；悬停给原因全文（现在第二行的「出错：……」「没能启动：……」）；
     - 没有跑完：「没有跑完」，`ink-muted`；
     - 没派出去：「没有开始」，error 色；悬停给原因全文（「没有开始：Galley 没写要做什么」那几句）。
     - 在跑、做完：不写。
   - 不写步数（「第 N 步 · 摘要」）、不写结果摘要、不写「第 N 轮 · 」。
3. **点标题打开**：标题是按钮，照待办卡片点标题的样子（只有字那么宽、悬停下划线、`focus-visible` 圈；`TodoCards.tsx` 约 `:122-150`）。点了做的事同现在的「打开」（在主区打开子任务，面包屑「Galley ›」）。去掉右边的「打开」按钮。没派出去、已删除（`gone`）的不能点，标题就是字。
4. **叫醒没送到时在卡片里答**（裁决 101 的兜底，`askInCard`）：功能照旧。提问气泡与输入框在这一行下面展开（现在 `:223` 附近的那一块），缩进对齐标题（`pl-[42px]` 一类，照待办卡片下面写失败原因那一行 `:163`）。这时卡片的样子：外框照旧，不加竖条；要不要给淡琥珀底，按「这一处要看得见、又不压过气泡」自己定，在报告里说明。
5. **文案**：用不到的键删掉，连同测试（比如 `copy.subtask.roundPrefix`、`open`、只给第二行用的句子）；新加的短词能复用现成的键就复用（侧栏的「等你回复」、`subtask.failedBare`、`didNotFinish`、`couldNotStartBare`、「没有开始」可以从 `notStartedEmpty` 的前半取，或加一个键）。中英两份都改；英文照现有的英文短词。
6. **无障碍**：卡片整体仍有无障碍名（现在 `copy.subtask.label` 一类），标题按钮的名字是标题；右边短词有悬停全文时，读屏也要读到原因（`aria-describedby` 或把原因放进名字，按现有写法）。
7. **设计文档** `docs/design/conversation.md`「子任务卡片」一节（约 `:369` 起）：「形态借工具块」那一条改成借待办卡片（裁决 179，推翻 06a 的工具块外框）；状态表换成「图标 / 右边的词」两列，去掉「竖条 / 底」「那一行」两列；「打开」一条改成点标题；在问你时的兜底那一段的位置描述跟着改。「提醒卡片」「待办卡片」里提到「同子任务卡片」的地方若因此不准，跟着改。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
git diff --check main...HEAD
```

- `gui/` 不是 prettier-clean，只管自己的 hunk。
- React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error。
- 静态渲染测试读不到测试里塞进 zustand 的值；带数据的渲染用 `vi.mock` 包住读 store 的 hook，或把逻辑放 `lib/` 测。
- 中文全角标点：在 scratchpad 写 `cjk-punct-130.py`，扫新增行。

## 别动

- 只在 worktree 里改，绝不碰主工作树；不跑 `tauri dev`、不跑 `galley` 命令、不读写用户的应用数据目录。
- Core、侧栏（`SidebarSubtaskRows`）、待办面板、待办 / 备忘 / 提醒卡片的样子、`lib/subtasks.ts` 的状态判定（`deriveSubtaskCard`、`answeredInCard`、`subtaskQuestionHolder`）不动；只改画法。

## 提交与回报

- 在 worktree 分支上提交，只点名本票文件，禁用 `git add -A` / `git commit -a`；英文说明，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，命令后接 `git log --oneline -1`，提交号只抄输出。
- 报告：①改了哪些文件 ②提交号 ③每条验证命令与结果 ④偏离票面的地方与理由（含选了哪颗静止图标、在卡片里答时的底色）⑤看到没改的 ⑥Open risks。
