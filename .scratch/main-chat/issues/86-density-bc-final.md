# 86 待办面板密度定 B+C：写死、拆切换器

Status: ready-for-agent（由票 85 的代理接着做）

来源：[主聊天 PRD](../PRD.md) 裁决 130 第 5 条「定 B+C」（2026-10-22，JC 真机看过演示档：「我觉得B+C 组名收紧是空间利用率最高，倾向于选这个」，主会话同意）。只改 GUI 与设计文档。依赖票 85（已合入 main）。

## 要做的

1. **写死 B+C**：照 `gui/src/components/todo/todo-variants/todo-variants.ts` 文件头的拆法「BC」一段：`TodoPanelGroups` 只留 `flat` 那一支（你的事一个 `section data-todo-group="yours"`，不挂组名，`yours.today`、`.later`、`.anytime` 首尾相接，不重新排序，行的小字按不在今天组下面写）；`yourParts` 与今天、以后、随时三个组名去掉；`GroupLabel` 的上下内边距写死 `py-[3px]`，去掉 `tight` 与 `LABEL_PAD`。注释改成定稿说法，写依据（裁决 130：对表苹果「提醒事项」，行高一样，空间花在组名上；推翻裁决 98 的一半）。
2. **`inToday`**：`YourRow` 的 `inToday` 不再需要就去掉；`lib/todo-panel.ts` 的 `todoMetaParts` 里 `inToday` 若已没有调用方传 `true`，连同它那几支一起删，写法回到「不在今天组下面」那一种（卡片本来就是这一种）；若还有别处用，留着并在回报里说明。
3. **文案键**：`copy.todo.groupToday`、`groupLater`、`groupAnytime` 没有别处读就从 `zh.ts`、`en.ts`、类型里删掉（先 grep 整个 `gui/src`，含 ⌘K 与测试）。
4. **拆**：照文件头「Always」一段删掉切换器（整个 `todo-variants/` 目录与快照、`App.tsx` 的 pill）与演示档（`useDemoTodo`、`shown`、`TodoDemoInert` provider、换掉的 `go` / `talkAbout`、`TodoCheck` / `YourRow` / `AssistantRow` 里的 `useTodoDemoInert`）。拆完 `grep -rn "main chat 85" gui/src` 应为零。
5. **设计文档** `docs/design/conversation.md`「待办面板」：
   - 「分组」那条：你要办的事是最上面一段、不挂组名，次序逾期、今天（有时刻的按时刻，只有日期的在后）、以后按日子、没定时间的按记下的先后；小字今天的写「今天 18:00」（或「今天」），逾期照旧 warning 色；其后「Galley 在办」「例行」「已完成」各挂组名。组名上下内边距 3px（约 22px 高），组与组之间 12px（裁决 128 第 9 条），第一组不加。
   - 原「今天、以后、随时」那一条改写成上面的一段；「主时间」里「在『今天』下面不写『今天』」改成今天的写「今天」。由来写一句：10-17 裁决 98 定今天、以后、随时作一级组名；10-22 裁决 130 对表苹果后合成一段（JC 对比苹果「提醒事项」觉得空间利用低；量下来行高一样，组名约占一半高度）。
   - 顶栏「今天 N」不变：数的是这一段最前面的今天到期与逾期（`docs/design/layout-and-chrome.md`「待办按钮」那一条若写着「今天组」之类的说法，跟着改成不依赖组名的说法）。
   - 都注「2026-10-22，票 86，裁决 130」。
6. **测试**：切换器测试随目录删掉；`TodoPanel.test.tsx` 改成断言定稿：你的事一段不挂组名、次序 today → later → anytime、今天的小字带「今天」、你的事为空时不画这一段、组名 `py-[3px]`、组间距 12px 照旧、空状态加「例行」照旧。原来断言三个组名的测试改掉，覆盖的情形（逾期在前、空组不画）留着。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- Core 的分组（`list_assistant_todo` 照旧给三组）；`core/`、手册、提示词（它们没有描述面板的分组）。
- 票 80、83 第 5 和第 6 条、84 的定稿；行内几何、宽度。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；删文件用 `git rm` 点名；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过
- `git diff --check`
- 设计文档新增行中文全角标点

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `grep -rn "main chat 85" gui/src` 与三个文案键的 grep 结果原样。
3. `TodoPanelGroups` 与 `GroupLabel` 定稿那几行的 diff 原样。
4. 验证命令与结果原样。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新）切换器那一排不见了；面板最上面是你的事，不挂组名（现在只有 702 一件，写「11月20日 🔔 09:00」）；下面「例行」「已完成」的组名比原来紧。

## Comments
