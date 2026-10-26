# 99 删掉的卡片划线；面板的两个页签换成 `SegmentedControl`

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 144（2026-10-26，JC 真机走过备忘三张票后；JC：「按你建议推进，不上切换器，直接做 T1」）。依赖票 97（已合入 main）。只改 GUI 与设计文档；`core/` 不动（需要的字段都已在 IPC 里，见下）。与票 98（Core、手册、评测）同时在跑，不碰同一处。

## 为什么

- JC 真机：删掉的备忘，回复下的卡片看起来没变化，只是不能点了；删掉的待办，卡片只在右边写「已删除」，不够直观。
- 划线读作「不要了」。办完是勾上加划线（JC 10-16：「完成的打了勾加上横线划去」），删掉是划线不勾：方框照旧是 40% 的禁用样子、右边照旧写「已删除」，两样东西把它和「办完」分开。推翻票 88 的「不划线（没做，只是不要了）」。
- 面板 header 的两个页签（票 97）只是两段字，JC：「不够像按钮，设计感也不足」。设计规范里本来就有「小型互斥选项组」的组件 `SegmentedControl`（`docs/design/foundations.md:542`，`gui/src/components/ui/segmented-control.tsx`），面板两页正是这种用途；md 档 28px 高，与右边「+」「×」同高，顺手修掉票 97 回报里「页签比 + 和 × 高一点」的错位。

## 要做的

1. **待办卡片**（`gui/src/components/conversation/TodoCards.tsx`，设计文档 `docs/design/conversation.md`「待办卡片」的「删除」一条，现在写着「不划线」）：被删的（你在面板里删的、Galley 替你删的，含删掉后 5 秒撤销条还在的那段）标题加删除线，颜色照旧 `ink-muted`；方框、「已删除」照旧。勾掉的不变。删除线的粗细与颜色照勾掉那种的写法（同一套 `line-through` 与 decoration 颜色），两种划线看起来一样，靠方框与小字分。
2. **备忘卡片**（`gui/src/components/conversation/MemoCards.tsx`，设计文档「备忘卡片」）：只划正文，「记下了 ·」「改为 ·」「不再记 ·」前缀不划。
   - **备忘不在了**（`MemoEventItem.memoExists` 为 false：你删的或它删的；你在面板里删、撤销条还在的那 5 秒也算）：正文划线、退到 `ink-muted`，右边 12px `ink-muted`「已删除」（同待办卡片右边那一格的位置与样式）。
   - **「不再记」那张**：正文划线、`ink-muted`，右边不加字（前缀已经说了）。
   - **过了期限**（`memoExists` 为 true，但不在 `list_memos` 给的当天还有效的备忘里，即票 95 说的过期后行留着、不显示）：正文 `ink-muted`、不划，右边「已过期」。
   - 还在的照旧，正文是按钮、能打开面板。以上三种都不是按钮（现在已经是）。
3. **提醒卡片**（`gui/src/components/conversation/ReminderCards.tsx`，设计文档「提醒卡片」）：已取消的，时间与那句话加删除线（颜色照旧 `ink-muted`），「已取消」照旧；已提醒、已暂停、待提醒不变。
4. **面板页签换成 `SegmentedControl`**（`gui/src/components/todo/TodoPanel.tsx` 里票 97 的 `PanelTabs`，header 外壳 `ReadingPanelHeader`）：
   - 用 md 档，两项「待办」「备忘」；样子照组件全局的写法（轨道 `bg-hover`、选中的 `bg-elevated` 浮起加 `brand-strong` medium，`docs/design/layout-and-chrome.md:98`），不为面板另做变体。
   - 与右边「+」「×」垂直居中对齐；量一下 header 里三者的上下边，回报里写对齐前后。
   - 保留票 97 的行为：`role="tablist"` 与左右方向键（若 `SegmentedControl` 已有键盘行为与无障碍角色，用它的，回报说明有无差别）、面板无障碍名照旧「待办」、开在哪一页的规则、换页时列表回到顶上。
   - `PanelTabs` 若只剩这一处用，删掉；`SegmentedControl` 本身的样式不改（它在设置页、「显示」浮层里也用）。若 md 档在 header 里放不下（面板最窄 280px，减去「+」「×」），回报里写清楚量到的宽度，用 sm 档并说明。
5. **设计文档**：`docs/design/conversation.md`「待办卡片」的删除一条（改掉「不划线」，写新规则与理由，链裁决 144）、「备忘卡片」、「提醒卡片」的已取消、「待办面板」的「两个页签」一条（改成 `SegmentedControl`，写没选的 T2、T3、T4 与理由，推翻票 97 的「放在 header 里太重」）。
6. **测试**：vitest 覆盖待办卡片被删时标题带划线、勾掉的不受影响；备忘卡片四种（还在、不在了、「不再记」、过期）的划线、颜色、右边小字、能不能点；提醒卡片已取消带划线、已提醒不带；页签换成 `SegmentedControl` 后点击与方向键切页、从备忘卡片打开时在「备忘」。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`、不开 Vite 页面验 Tauri 相关的流程。
- `core/`、`cli/`、手册、评测（票 98 在改）；`SegmentedControl` 组件本身；面板「待办」页与「备忘」页的行、分组、动作；卡片的位置与次序。
- `gui/` 不是 prettier-clean：旧文件只格式化自己改的 hunk，别对整个文件跑 `prettier --write`。React 编译器的 lint 规则：effect 里同步 setState、渲染期读 `Date.now()` 都是 error；工具函数别从组件文件导出。静态渲染测试读不到 store 里塞的值，照现有测试的 mock 写法。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新增行不能有本机路径、会话 id、真实数据。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`。
- `git diff --check`；新增中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 四种卡片状态各一段 className 的 diff 原样。
3. 页签：用的档位、对齐前后的量法与数值、键盘与无障碍跟原来的差别。
4. 设计文档改了哪几节。
5. 验证命令与结果原样。
6. 看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

1. 打开待办面板：顶上是两段的分段控件，与「+」「×」齐平；点和左右方向键都能切。
2. 让它记一件待办再在面板里删掉：回复下那张卡片的标题划线，右边「已删除」。
3. 在备忘页删一条：回复下「记下了 · ……」那张的正文划线，右边「已删除」；让它删一条（「别记我不喝酒了」），「不再记 · ……」那张正文划线。
4. 取消一个它自己的提醒：提醒卡片的时间与那句话划线，右边「已取消」。
