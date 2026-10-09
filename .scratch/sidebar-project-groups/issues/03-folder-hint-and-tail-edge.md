# 03 文件夹说明行看 workspaceEnabled；尾部全借位时的「收起」

Status: ready-for-agent

来源：2026-10-09 两轮项目打磨的票外发现（[打磨 devlog](../../../docs/devlog/2026-10-09-project-ux-polish-pass.md)、
[项目组定稿 devlog](../../../docs/devlog/2026-10-09-project-group-show-more-and-one-line-rows.md)「票外 / 待办」）。纯 GUI。

## A. 编辑对话框的文件夹说明行按「有路径」判断，应按 `workspaceEnabled`

- 现状：`EditProjectDialog` 的说明行在内置模式下只看 `rootPath`：有路径就显示 `folderHintChosen`（「会共享这个文件夹里的
  project_memory.md…」）。
- 问题：GUI 选文件夹会一并打开项目模式（`gui/src/stores/sessions/project-slice.ts` 建项目 `workspaceEnabled: !!nextRootPath`、改路径
  `patch.workspaceEnabled = !!trimmed`），但 CLI `galley project create --root-path` 不带 `--enable-workspace` 时 `workspaceEnabled` 为
  false（Core `spawn_config.rs` `workspace_root_for_project` 因此不传工作区）——这类项目在编辑框里说明行说错了。Supervisor 走 CLI
  建项目时会遇到。
- 修法方向：路径未改动时按 `project.workspaceEnabled` 选说明；为 false 时说清「这个文件夹目前只用来识别仓库，项目记忆没开」，
  并想好怎么开（重新选择同一文件夹时 `updateProject` 因路径未变不会写 `workspaceEnabled`，要一并处理）。文案主会话定。
- 外置模式不受影响（外置本来就显示 `folderHintExternal`）。

## B. 尾部会话全部借位时，「收起」点了以后这一行消失

- 现状：`SidebarProjectGroup` 收着时「显示更多 N」的 N 不含借位行，N 为 0（尾部全是等你回复 / 出错 / 选中的）就不渲染这一行。
- 问题：先展开再点「收起」，若尾部全部需要你，这一行直接消失，`SidebarShowMoreRow` 的滚动补偿找不到自己，内容在鼠标下跳。
- 很少见；修不修待 JC 定（可在 N 为 0 时仍保留一行占位，或收起时把补偿锚点交给最后一条借位行）。

## Comments
