# 项目体验打磨：文件夹说清后果、上下文跟随会话、补两个入口

Date: 2026-10-09
Status: 实现完成，typecheck / lint / vitest（902）/ diff check；对话框与空状态提示行用临时渲染页截图对表，侧栏数字对齐在 dev 窗口实测；真机交互（建完项目聚焦输入框、子菜单「新建项目…」）待 JC 看
Related: [layout-and-chrome §Sidebar · Project 组行](../design/layout-and-chrome.md)、
[10-08 项目分区](./2026-10-08-sidebar-project-groups.md)、[10-09 组内最近 5 条](./2026-10-09-sidebar-recent-five-and-new-project-icon.md)、
[05-13 侧栏与项目](./2026-05-13-sidebar-overhaul-and-projects.md)、[05-22 Project Review](./2026-05-22-project-review-sidebar-ux.md)

## 起因

JC：「继续优化和打磨 project UI/UX」。侧栏结构两天里改了三轮（项目分区、组内最近 5 条、书眉新建项目），这一轮盘点侧栏
之外的项目触点：新建 / 编辑 / 删除对话框、项目上下文空状态、会话菜单「加入项目」、⌘K、「更早」对话框。盘点对象：
设计文档「Project 组行」、相关组件与 `App.tsx` 接线、dev 窗口截图。

## 发现与裁决（JC 按推荐，三批全做）

### 第一批：一致性修补

- **项目上下文不跟随会话。** 侧栏点开项目会话会把「新对话」设成「新对话 · 项目名」，定时任务对话框也这样；⌘K 打开会话、
  ⌘K 消息搜索、「更早」对话框打开会话却清空。`git log -L` 查到清空来自 `76377dde`（05-22 Refine Project Review sidebar
  UX）：那时 `activeProjectFilter` 就是 Project Review 模式本身，打开会话要先退出模式，否则时间线是隐藏的。10-08 删了项目
  视图，它只剩「新对话落在哪个项目」一个含义，清空就成了副作用——同一条会话从侧栏打开和从 ⌘K 打开，之后的新对话落点不同。
  改为五个入口都走 `openSession`，跟随会话；当前会话被移进 / 移出项目时同步。⌘N 与 ⌘K「新对话」照旧清空。
- **「项目」分区头的计数偏左 11px**（10-08 起挂着，「JC 看着别扭再改」）。dev 窗口截图上「1」明显比「本周 6」「本月 34」
  靠左。caret 伸进按钮右侧 12px 内边距，三处计数墨迹右缘实测落在同一列（2x 截图 x = 549）。「更早」入口、「其他项目」、
  组内尾行同样处理；组内尾行的计数对齐组内会话行的文字边，比时间桶计数再往里 6px（组的 `mr-1.5` 缩进，几何上本该如此）。
- **路径从右截断**：对话框路径框约 27 个等宽字符，`/Users/inkstone/Documents/genericagent-webui` 显示成
  `/Users/inkstone/Documents/g…`。改为 `~` 缩写 + 从父路径截断。
- **会话已在项目里时菜单项仍叫「加入项目」**，toast 早已分「已加入 / 已移到」；改为「移到项目」。
- **删除确认框的勾选框偏高 1～2px**（10-09 待办）：`items-start` 下 16px 方框顶对齐行框顶。按（字号 × 行高 − 16）/ 2 给
  上边距：删除确认框 12.5 × 1.55 → 1.6875px，「已归档」清空 12.5 × 1.5（`text-ui-secondary` 不设行高，继承 preflight
  的 1.5）→ 1.375px。没用 `lh` 单位（老 macOS 的 WKWebView 不支持）。

### 第二批：文件夹字段说清后果

这一条我认为最该修。字段原来只写「工作区文件夹」、占位「暂无项目工作区」。顺着代码查到的实际行为：

- 内置下，绑定文件夹 = 内核项目模式：`_activate_project_workspace`（`runner/workbench_bridge.py`）→
  `workspace_cmd.prepare(root)` 建 junction 并确保 `project_memory.md` 存在——经 junction 落在**用户选的文件夹里**
  （`managed-ga/code/frontends/workspace_cmd.py` `prepare`）；`plugins/project_mode.py` 每轮往用户消息末尾注入规则，项目私域
  目录（todo、草稿、产物「一律放这里」）就是这个文件夹，收尾把值得记的追加进 `project_memory.md`。
- 外置下，`GALLEY_GA_STATE_ROOT` 只在内置设（`core/src/runner_commands.rs`），`_workspace_activation_allowed()` 为假，项目
  模式被跳过；文件夹只剩让主区「改动」按钮认出仓库（`repositoryHint`，纯 GUI）。

也就是说项目最实在的能力——项目里的对话共享一份项目记忆、产物落进文件夹——对话框一字未提，而选了 git 仓库的人会在
git status 里看到一个陌生文件。不绑文件夹的项目只是侧栏分组。

改法：字段改名「项目文件夹」、占位「未选择」，字段下一行说明三态（内置未选 / 内置已选 / 外置），已选态写出
`project_memory.md`（JC 定：往用户文件夹写文件的副作用要如实说）。顺带两件对齐：标签按 Settings 10-07 规则只在英文界面
uppercase + 字距（项目与定时任务两个对话框共用新的 `DialogField`，JC 定连定时任务一起改）；名称输入框焦点样式改成全应用
文本输入框那套（定时任务对话框早已是）。

05-13 JC 问过「绑了哪个文件夹用户怎么验证」，当时在筛选横幅第二行显示路径；横幅随 Project Review 删掉后，路径只剩编辑
对话框里能看到。项目上下文空状态的提示行「将创建到 X」后面接上 ` · ~/…/文件夹名`，挤压时路径先缩。

### 第三批：补两个入口

- **「加入项目」子菜单底部加「新建项目…」**：建完把这条会话移进新项目（toast 用新项目的名字——hook 闭包里的 `projects`
  还没有它，执行代理处理了这一点），侧栏展开新组，主区不动。零项目时子菜单只有这一项，不再是一句「还没有项目」。理由：
  「先有对话、后想归类」是最自然的发现路径，比书眉那个低频图标好找。
- **建完项目直接进入「新对话 · 项目名」并聚焦输入框**（书眉图标、⌘K 两条路）。05-13 dogfood 撞过「建完不知道怎么在项目里
  开对话」，当时补的是 CTA；05-22 定的「建项目不隐式建对话」不受影响——空状态要等第一句话才建会话。代价：主区正开着别的会话
  时会被带离；那个会话正在运行时 `startProjectConversation` 本来就只设上下文、不切屏。

### 看过、暂缓或不做

- 命令面板列出项目、拖会话到项目行：进 [deferred](./deferred.md)，各带启动信号。
- 主区顶栏「项目名 /」面包屑（claude.ai 项目里的做法）：不做。侧栏已保证选中会话挂在它的组下，信息重复，还给顶栏加元素。
- 顺手补 deferred 漏项：10-09 devlog 与设计文档都写「项目数量上限进 deferred」，台账里没有这一节，本轮补上。

## 实现

纯 GUI，Core / CLI / Agent API 零变化；两种运行时只在文件夹说明行上不同（外置显示「不启用项目记忆」的如实说明），其余改动两边一致。

- 文案契约主会话先改（zh / en：`projects.workspaceFolder` 等三键改值，新增 `folderHintNone` / `folderHintChosen` /
  `folderHintExternal`、`sidebar.moveToProject`、`sidebar.newProjectForSession`），再按文件域派两张 Opus 票并行，同一工作区，
  0 返工：
  - 票 A（对话框与路径）：`components/ui/dialog-field.tsx`、`lib/display-path.ts`（+ 22 个 vitest 用例：整段匹配 home、
    Windows 大小写与混合分隔符、UNC、根目录）、`hooks/useHomeDir.ts`（模块级缓存，非 Tauri 返回 null）、
    `components/ui/folder-path.tsx`；三个对话框换 `DialogField`；`Checkbox` 加 `boxClassName`；`EmptyState` 加
    `projectRootPath`。
  - 票 B（上下文、入口、对齐）：`App.tsx` 的 `openSession` 与新建项目两条路径、`useProjectNavigation` 的待移会话与上下文同步、
    子菜单与一路透传的回调、三处 caret；补 `SidebarSessionMenuItems.test.tsx`、`useProjectNavigation.test.tsx`。
- 集成验收主会话改一处：截断时省略号吞掉末段前的斜杠，读起来像 `/User… genericagent-webui`；分隔符改随末段渲染，截断后
  读作 `~/Docu…/genericagent-webui`。

## 票外发现（未改）

- 中文界面里还有同类标签（uppercase + 字距）：引导流程 `StepAttach.tsx`、`StepModelConfig.tsx`，`PromptManagerDialog.tsx`
  四处；可换 `DialogField` 或同样的语言判断，留到各自那一轮。
- CLI / Supervisor 在外部移动当前会话时项目上下文不跟（`applyExternalSessionUpdated` 只改 `projectId`），已写进设计文档。
- `globals.css` 有 `--leading-notice: 1.5`，说明行用的是 `leading-[1.5]`，数值相同，没换。

## 待办

- 真机看：从书眉 / ⌘K 新建项目后输入框是否真的聚焦（`startProjectConversation` 在对话框关闭之前执行，按批处理推断能聚焦，
  没在真机上确认）；子菜单「新建项目…」整条路径。
- 外置模式下项目会话启动时 runner 会发一条 `project_workspace` warning（项目模式被跳过）——这次只在对话框里如实说明，warning
  本身没动（外置相对内置的差距，按惯例不建 deferred）。
