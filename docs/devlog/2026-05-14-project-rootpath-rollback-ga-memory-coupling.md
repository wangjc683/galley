# Project = 纯分组：回收 rootPath / cwd 绑定 (GA memory/ 静默降级修复)

**Date**: 2026-05-14
**Status**: 决策对齐 · 代码层方案 3 已落地
**Related**:
- [bridge/workbench_bridge.py:358-365](../../bridge/workbench_bridge.py#L358) `_setup_ga` 的 `os.chdir` 分支
- [useAppStore.ts:1406](../../desktop/src/stores/useAppStore.ts#L1406) cwd 注入点（本次改动核心）
- [CLAUDE.md "Projects V0.1"](../../CLAUDE.md) Stage 3.5 行
- [cwd live-sync（deferred 台账）](./deferred.md) —— rootPath 时代的设计讨论已并入台账，本 entry 把绑定收掉
- GA `ga.py:514` `memory_management_sop.md` 加载路径（external · GenericAgent repo）

## Context

在讨论「GA 闲时自主行动」要不要复刻到 Galley 时，顺着 `请阅读自动化sop` 这条线追到 GA 用相对路径 `./memory/...` 读自己的 SOP 文件。开始审计 Galley 桥接层 spawn GA 时实际的 CWD 是怎么决定的。

**结论令人不安**：今天 Galley 的 cwd 行为是这样：

| Session 类型 | bridge 传入 `--cwd` | bridge 实际 `getcwd()` | GA `memory/` 可达 |
|---|---|---|---|
| 无 project | undefined | GA 安装目录 | ✅ |
| Project，**无** rootPath | undefined | GA 安装目录 | ✅ |
| Project，**有** rootPath | rootPath | rootPath | ❌ |

即——**「project 设了 rootPath」这一路径会静默打破所有依赖 GA memory/ 的能力**。具体包括：

1. `ga.py:514` 默认 memory_management_sop.md 找不到 → 静默 fallback 到 "Memory Management SOP not found. Do not update memory."，agent 记忆系统失灵但不报错
2. `file_read ./memory/<任何 SOP>` → "not found"
3. `file_read ./memory/<任何 skill / helper>` → 同上
4. 未来想做的「闲时自主」/「读取 SOP 复用任务」全部不可用

**伤害模型**：bug 是静默的、降级不报错、且只在「用户做了对的事——给项目绑定文件夹」时才触发。GA 深度用户—— V0.1 的目标用户—— 最不能输的就是「我的 memory/ 永远在那」这个心智。

## Decisions

### 设计调整：Project V0.1 从「分组 + cwd 绑定」改为「纯分组」

回收 cwd 绑定。Project 仍然是 sidebar 上的归类容器、可右键 Move to project、可 filter，但**不再让 session 跑在 project rootPath 下**。所有 session 一律落到 bridge 默认的 GA 安装目录。

GA 深度用户的常规工作流是：在 GA 里跑工具时用绝对路径（已有习惯），或让 agent 自己 `cd` 到目标目录。这跟「session 默认 cwd = project root」之间的差距，在第一性原理看是**「IDE 范式」vs「GA 范式」的错位**——GA 是个会自己评估、积累记忆、可在任意 cwd 下工作的 agent，不是个绑死在 workspace 里的 LSP 客户端。强行套 IDE 心智反而伤害目标用户。

### 实现方案选择：方案 3（"代码层关闭"）

讨论过三个 rollback 选项：

- 方案 1 "UI 隐藏"：保留 column、代码继续读 `rootPath`、但 UI 不展示入口
- 方案 2 "drop column migration"：写 migration 把 `projects.root_path` 删了
- 方案 3 "代码层关闭"：保留 column、保留类型字段、保留 DB 读写，但**桥接 cwd 注入那一行改成 `cwd: undefined`**，UI 入口全部隐藏

落地方案 3。理由：
- 比方案 1 更明确——cwd injection 那一行字面改了，不是靠"UI 没入口所以没人触发"的依赖关系
- 比方案 2 更可逆——legacy 用户 DB 里残留的 rootPath 字符串作为「曾经的设置」保留下来，未来通过 IPC `set_cwd` 真正实现 live-sync 时（[deferred entry](./deferred.md) 已有讨论）数据是现成的
- 风险最小——零 migration、零 schema 变化、零 DB 写路径变化

### 落地清单（按文件）

**核心**：
- `desktop/src/stores/useAppStore.ts:1406` `cwd: project?.rootPath ?? undefined` → `cwd: undefined`

**死掉的 toast / comment 清理**：
- `assignSessionToProject` 中 `"下次启动该 session 时会用 ${target.name} 的目录"` toast 移除——cwd 不再变，toast 是骗用户
- 多处 docstring 提到「rootPath → cwd injection」的句子更新或移除

**UI 输入**：
- CreateProjectDialog：移除「项目文件夹」字段
- EditProjectDialog：移除「项目文件夹」字段；no-op detection 简化为仅比 name

**UI 显示**：
- Sidebar 项目卡 icon 不再按 rootPath 区分 `Folder/FolderOpen`，统一用 `Folder`
- Sidebar filter banner 移除第二行 mono 路径展示
- Sidebar context menu「Move to project」子菜单项 icon 同样统一 `Folder`
- ProjectsDialog 项目卡移除 mono 路径行，icon 同样统一

**保留不动**：
- `Project.rootPath` 类型字段（types/session.ts）
- `projects.root_path` SQLite column
- `projects.root_path` 的 read/write helpers（lib/db.ts）
- `createProject({ name, rootPath? })` / `updateProject(id, { rootPath? })` 签名

### CLAUDE.md 同步

Stage 3.5 行末追加一个 strikethrough note，标注 rootPath / CWD binding 已 rollback 到本 devlog。

## Rejected alternatives

### 不修，靠用户「不要给 project 绑定文件夹」的口头约定
否决：违反「系统承担复杂性」原则。问题是静默 bug，不能指望用户读 CLAUDE.md 才知道要避免某种用法。

### 在 bridge 一侧做"双 cwd"
让 bridge `os.chdir(project rootPath)`，但用 monkey-patch 把 `./memory/...` 解析改成相对 GA 安装目录。否决：违反项目宪法「不 monkey-patch GA 工具实现」，且每次 GA 升级都得重新审计 patch 是否还生效，**脆**。

### 给 bridge 加 IPC `set_cwd` 然后保持 rootPath 入口
让 bridge 启动时仍然 `os.chdir(ga_path)`，project 第一轮通过 IPC 通知 GA `cd` 进 rootPath。否决：300+ 行工程，需要给 GA agent 注入特殊指令，复杂度远超「干脆不绑」。这条路径是 [2026-05-13 deferred entry](./deferred.md) 里假设的"如果将来真痛"再做的方案——证据上看现在还没"真痛"，但已经"真坏"了，先把"真坏"的部分先关掉再说。

### 保留 cwd 注入 + 教 agent 用绝对路径访问 memory
让 agent 收到 system prompt 注入「memory 在 /abs/path 下」。否决：每次会话开头要塞这段、agent 仍可能忘、且不解决 ga.py 内部硬编码 `./memory/...` 的代码路径。

### 方案 2 drop column migration
否决：legacy 用户 rootPath 字符串作为「曾经的意图」是有价值的数据，不该单方面删。方案 3 等价覆盖了功能上的关闭，但保留了数据可恢复性。

## Open questions

- **将来如果要回来做 cwd 绑定，正确路径是 IPC `set_cwd`**（参见 [2026-05-13 deferred entry](./deferred.md) 里写的方案）。本次 rollback 不挡这条路——DB column 还在、类型字段还在，加 IPC 就能 wire 回来。
- **GA 闲时自主功能**：依赖 GA SOP 文件可达，现在解决了。但 V0.1 还是按上一轮讨论的结论 deferred 到 V0.2（YOLO 已就绪不再是 blocker，但 demand 信号还没强到要做）。
- **CLAUDE.md 项目宪法读取分级章节** 没有再次受影响——这次改的是 Galley 自己的代码，没有触碰 GA。

## Next

代码改完跑 `pnpm typecheck` + `pnpm lint`，0 error / 0 warning 视为完成。dogfood 中观察一周：

- 已建好 rootPath 的 project（你自己 DB 里有的）UI 上看不到 rootPath，但行为正常（session 落到 GA 安装目录）
- 新建 project 没有 rootPath 入口
- GA memory/ 在 project session 里可读（开个 project session，让 agent `file_read ./memory/memory_management_sop.md`，应能读到）
