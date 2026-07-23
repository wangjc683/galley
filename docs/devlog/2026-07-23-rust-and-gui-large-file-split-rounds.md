# Rust 大文件拆分五连 + GUI 拆分第四轮

**日期**:2026-07-22 ~ 2026-07-23
**范围**:`core/` `cli/` `gui/` 的大文件结构化拆分,零行为变化
**commits**:`dfbc694..0d1e86e`(8 个,已推送)

## 背景

GUI 侧已连续三轮拆大组件(Composer、sessions store、provider 表单),
Rust 侧从未做过同类排查。本轮先对 Rust 侧做全量行数排查,按"超长函数 >
多领域混居 > 冷代码"排序拆了 5 个目标;随后把同方法延伸到 GUI 侧剩余的
3 个目标(第四轮)。

## Rust 侧(5 个目标,5 commits)

| 目标 | 前 → 后 | 拆法 |
|---|---|---|
| `core/src/lib.rs` `run()` ~1085 行 | 1171 → 200 | setup 步骤 → `app_setup.rs`;迁移清单 → `db_migrations.rs`;macOS 菜单 → `app_menu.rs`;托盘/关闭/菜单事件 → 并入 `tray.rs`(其模块注释本就是这个定位) |
| `socket_listener/session_cmds.rs` | 1480 → 618 + 3 个新模块 | 按职责拆平级模块:`session_new_cmds` / `session_goal_cmds` / `spawn_config`,沿用 `llm_cmds` 的既有平铺模式 |
| `cli/src/goal/hive.rs` `run_hive_goal_loop` ~600 行 | 函数 → 257 行 | 按阶段抽 helper;两处 stop wrap-up / 两处 fail / 两处 wrap / 两份信号计算全部合并;WaitForSignal 与 Continue 两个 match 分支只差 phase 字符串,合并为一 |
| `core/src/codex_oauth.rs` | 2115 → `codex_oauth/` 8 文件 | 按领域:login / secret / refresh / probe / usage / ipc + tests.rs(注意 `include_str!` 相对路径要跟着改) |
| `core/src/im_supervisor.rs` | 1415 → `im_supervisor/` 3 文件 | manager(进程槽位生命周期)与 platform_config(飞书/TG 凭据 + owner 配对)分层 |

工程要点:

- **子模块访问父模块私有项是合法的**(Rust 可见性规则),所以目录化拆分
  可以把常量和共享工具留在 mod.rs 私有,子模块 `use super::` 即可,
  不必到处 `pub(crate)`。
- 老 `lib.rs` 的 `use tray::*` glob 曾把 `show_main_window` 提升到 crate
  root,`socket_listener` 隐性依赖了这个路径 —— 拆分暴露了这类 glob 耦合,
  已改为显式 `crate::tray::` 路径。
- 每个拆分独立 commit,commit 1 的树单独跑过 `cargo check` 验证可编译
  (对 bisect 友好)。

### 决定:`migration_backup.rs`(2119 行)不拆

排查时列为候选 6,评估后决定**默认不动**:① 冷代码,只在加迁移和修恢复
逻辑时被动到,拆分收益无处兑现;② 数据安全关键路径(启动前备份 / 安全
重建 / 级联恢复),2000 行 move diff 本身就是 review 风险;③ 2119 行里
一半是测试,正文三段结构本就清晰,测试与实现同文件对安全代码是优点。
启动信号:哪天要在里面做实质性新功能,动手前先顺手拆成
`migration_backup/{backup,rebuild,recovery}.rs`。

### 一个排查方法教训

初判 `dispatch_session_send` 有 425 行是 grep 模式漏了文件中段缩进的
函数定义 —— 实际只有 75 行,该文件真正的问题是四类职责混居而非巨型函数。
排查结论落地前要用 Read 验证,别只信一轮 grep 的行号差。

## GUI 侧第四轮(3 个目标,3 commits)

| 目标 | 前 → 后 | 拆法 |
|---|---|---|
| `App.tsx` | 1226 → 846 | **自订阅 host 组件**:`SettingsHost` / `MainHeaderHost` 自己 select store,App 只传单实例数据;域 hook:`useChannelsStatus`(注释标明必须单实例挂载,重复挂载会双倍轮询)/ `useLLMDisplay` / `useImageBlockedToast` |
| `stores/runtime.ts` | 1055 → 52 组合 + 3 切片 | 照搬 sessions store 切片模式:llm / bridge / info 三个 StateCreator 共享一个 `create()`;对外导入面不变 |
| `MarkdownView.tsx` | 1099 → 281 | `CodeBlock.tsx`(Shiki + 高亮缓存)、`MarkdownImage.tsx`(预览/保存)、`lib/markdown-image-src.ts`(纯路径解析)、`lib/remark-cjk-strong.ts` |

工程要点:

- host 组件模式的边界:**单实例资源必须留在 App 传下去**(useThemeEffects
  的 resolvedTheme、useGoalEffects 的 goal 状态、useChannelsStatus 的轮询),
  纯 store 订阅才能下放。
- 一处险些引入的行为偏差:MainHeader 齿轮入口打开 Settings 时不改 tab
  (保留上次页签),与带 tab 的 `openSettings(tab)` 是两个语义,host 里
  保留了独立的 `onOpenSettings` prop。
- react-refresh 的 only-export-components 告警用"纯函数挪去 lib 文件"解,
  优先于文件级 eslint-disable(仓库里两种先例都有,前者更干净)。

## 收尾状态

- 验证:`cargo check/test --workspace`(415 过)、`pnpm --dir gui
  typecheck / lint / test`(186 过)、clippy 告警数与基线持平(顺手修掉
  一条 needless_borrow)、`git diff --check` 干净。
- 拆完后 src 侧最大文件:Rust 为 `im_supervisor/manager.rs`(742),
  GUI 为 `sessions/lifecycle-slice.ts`(867,上轮切片产物)与两个纯文案
  字典(不拆)。
- `runner/workbench_bridge.py`(1828 行 god-class)评估后**缓做**,
  记入 [deferred.md](./deferred.md)。
