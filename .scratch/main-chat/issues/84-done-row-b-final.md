# 84 已完成定 B：写死、拆切换器

Status: ready-for-agent（由票 83 的代理接着做）

来源：[主聊天 PRD](../PRD.md) 裁决 129 第 2 条「定 B」（2026-10-22，JC 真机后：「定B」）。只改 GUI 与设计文档。依赖票 82、83（都已合入 main）。

## 要做的

1. **写死 B**：照 `gui/src/components/todo/todo-variants/todo-variants.ts` 文件头的拆法「B」一段：已完成里非待办的行标题 `ink-muted`；`DoneRow` 与 `TodoCard` 给做完（`state === "done"`、没取消）的待办方框传 `checkedTone="quiet"`；`ui/checkbox.tsx` 与 `TodoCheck` 留着 `checkedTone`（去掉临时标记注释，注释改写成定稿的说法：已完成里勾着的方框是中性灰实心、对勾 `ink-soft`，勾下去停留的 1.5 秒里照旧品牌色，依据裁决 129 第 2 条）；`RowShell` 去掉 `rowClass`。
2. **拆**：照文件头「Always」一段删掉切换器（整个 `todo-variants/` 目录与快照、`App.tsx` 的 pill）与演示档（`useDemoDone`、`DoneRow` 的 `inert` 与 `ignore`、`TodoCheck` 的 `onToggle`）；`grep -rn "main chat 83" gui/src` 拆完应当只剩票 83 第 5、6 条（定稿）那几处，或者为零，回报里列出剩下的。
3. **删走不到的分支**：票 82 起已完成里没有例行，`DoneRow` 里画例行（`Repeat` 图标）那一支删掉；类型镜像与注释里若还说已完成有例行，一并改。
4. **旧注释**：`MetaLine` 注释里「the day it was noted」（裁决 97 起小字里没有记下的日子）改成现状。
5. **设计文档** `docs/design/conversation.md`：
   - 「待办面板」的「已完成」一条：待办方框勾着时是中性灰实心（`line-strong` 填色与描边、对勾 `ink-soft`），不是品牌色；子任务、提醒的标题 `ink-muted`，与勾掉的待办同一档。
   - 「勾掉的样子」一条：写上 B 与由来（10-17 C1 只删除线加 `ink-muted`、没选 C2 整行 60%；10-22 切换器比现状 / A / B / C，定 B，没选 C 整行 70% 的理由照裁决 129 第 2 条），勾下去那一下照旧品牌色。
   - 「待办卡片」的「做完」：方框同面板（中性灰实心），删掉「品牌色填」。
   - Markdown 的 `- [x]` 那一行不动（仍是品牌色）。
   - 都注「2026-10-22，票 84，裁决 129」。
6. **测试**：切换器测试随目录删掉；`TodoPanel.test.tsx`、`TodoCards` 的测试改成断言 B 的样子（已完成方框 quiet、非待办标题 `ink-muted`、停留期间品牌色、没做完的方框不变）；`ui/checkbox.tsx` 的默认样子不变。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 票 80 与票 83 第 5、6 条的定稿（备注、空状态、取消按钮、自启提示、组间距）；分组、排序、停留时长。
- `core/`、手册。
- 不加新文案键。`gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。删文件用 `git rm` 点名。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过
- `git diff --check`
- 设计文档新增行中文全角标点

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `grep -rn "main chat 83" gui/src` 的结果原样。
3. 定稿后 `DoneRow`、`TodoCard` 方框那几行的 diff 原样。
4. 验证命令与结果原样。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入后（纯 GUI，热更新）切换器那一排不见了；已完成里勾掉的待办是灰方框，子任务、提醒的标题和勾掉的待办一样淡；勾下去那一下照旧是品牌色。

## Comments
