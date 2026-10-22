# 83 已完成的样子：临时切换器（现状 / A / B / C，带演示档）

Status: ready-for-agent（排在票 80 合入之后：同改 `gui/src/components/todo/TodoPanel.tsx`，由票 80 的代理接着做，先 rebase 到 main）

来源：[主聊天 PRD](../PRD.md) 裁决 129 第 2 条（2026-10-22；JC：「按你的推荐推进」）。只改 GUI，做一个临时切换器给 JC 真机比；定档与拆切换器另开一张票，这张不改设计文档。

## 为什么

- 已完成里勾掉的待办是品牌色实心方框（`ui/checkbox.tsx` 勾着时 `border-brand bg-brand text-ink`），是面板里最饱和的东西；没做完的方框是空灰框。一展开已完成就多出 N 个杏色方块，做完的越多越吵。按顶栏的颜色规则，`brand` 是「Galley 在为你做事，或邀请你开始」（`docs/design/layout-and-chrome.md:92`）。
- 字已经在最浅那档：勾掉的待办标题是 `ink-muted` 加删除线（C1，裁决 93），墨色只有 `ink` / `ink-soft` / `ink-muted` 三档。10-17 比过整行降到 60%（C2），JC 没选。
- 已完成里的子任务、提醒，标题是 `ink-soft`，反比勾掉的待办深一档（`TodoPanel.tsx` 的 `DoneRow`）。

## 要做的

1. **四档**（只作用在面板「已完成」组里的行，与回复下做完的待办卡片 `TodoCards`）：
   - **现状**：一字不改。默认档。
   - **A 档位拉齐**：已完成里非待办的行（子任务、提醒）标题从 `ink-soft` 降到 `ink-muted`，与勾掉的待办同一档。图标、小字不变。
   - **B 方框退色**：A，加上已完成里勾着的方框改成中性灰实心：填色与描边用 `line-strong`（浅深色各自的 token 值），对勾 `ink-soft`；形状、尺寸、对勾图标不变，仍能点（取消勾照旧）。勾下去那一下（今天、以后、随时组里，停留 1.5 秒那段）照旧填品牌色，落进已完成以后才是灰的。卡片上做完的待办同样是灰的。Markdown 的 `- [x]` 不动。实现上给 `ui/checkbox.tsx` 加一个只在这里用的勾着样式（prop 名你定，如 `checkedTone="quiet"`），不改它的默认样子。
   - **C 再整行 70%**：B，再把已完成里每一行（方框、图标、标题、小字一起）降到 70% 不透明度；悬停与键盘聚焦时回到 100%。卡片同样。
2. **演示档**：JC 库里现在没有勾掉的待办，已完成只有两次提醒和一个子任务，看不出方框。切换器加一个「真实 / 演示」开关：演示时面板「已完成」组的内容换成一组写死的样例（只换显示，不写 Core）：勾掉的待办 4 件（有时刻的、只有日期的、没定时间的、昨天勾的各一，标题用中文常见事务、别用真实人名）、交回来的子任务 1 个、送到的提醒 1 个；组照旧默认收起。演示行的方框点了不调 Core（无反应即可），「说说这件」与点标题也不调 Core、不跳转。演示时卡片不变。
3. **切换器的壳**：照票 42 的做法（`git show 2228971d -- gui/src/components/todo/todo-variants/`，票 45 拆掉的 `todo-variants.ts`、`TodoVariantsPill.tsx`），常驻可点击的 pill，只在 dev 构建出现（`import.meta.env.DEV`）；pill 若在 Radix 浮层里要 portal 并 `pointer-events: auto`。档名写「现状 / A 档位拉齐 / B 方框退色 / C 再整行 70%」与「真实 / 演示」。选中的档记在内存里就行（重载回到现状）。拆法写在 `todo-variants.ts` 文件头（删哪些文件、哪些接入点、定档后保留哪一档的哪几行）。
4. **测试**：默认是现状且与改前一字不差（快照或类名断言）；A、B、C 各自的类名；B 下勾的停留期间仍是品牌色、落进已完成后是灰的；演示档不调 Core（`vi.mock` 的 invoke 没被调用）；pill 只在 DEV。照 `TodoPanel.test.tsx` 现有写法。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 没做完的行、组名、分组、排序、停留时长、开机自启提示；票 80 刚加的备注行、空状态、取消按钮。
- 设计文档（定档票改）；`core/`、手册。
- 不加新文案键（切换器的档名是 dev 专用的写死字样，不进 locale）。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化你改的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. checkbox 新样式与四档接入点的 diff 原样。
3. 切换器 pill 在哪、怎么打开演示档。
4. 拆法（文件头那段原样）。
5. 验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方（WebKit、深色）。

## 给 JC 的真机步骤

1. 合入后（纯 GUI，热更新）打开待办面板，切换器选「演示」，展开「已完成」。
2. 依次看现状 / A / B / C，浅色和深色各看一遍（「显示」里切主题）；重点看 B 下灰方框和上面没做完的空框扫一眼分不分得清。
3. 定一档告诉我；定档票按那一档写死、拆切换器、改设计文档。

## Comments
