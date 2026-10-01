# 01 Windows：应用内更新后，同目录的 CLI 仍报旧版本

Status: needs-info
Date: 2026-10-01
来源：社区 [galley#29](https://github.com/wangjc683/galley/issues/29) / [#30](https://github.com/wangjc683/galley/issues/30) 的环境栏（同一作者），处理这两条时顺带发现
影响面：Windows；supervisor / IM 渠道调用的 `galley` CLI 若停在旧版本，拿不到新契约（如 `live.askPending`、`wait --until-idle`）

## 现象

两份报告都写「Galley 0.5.3（应用内 Settings → About）；同一个安装目录里自带的 CLI `galley version` 报 0.5.2」。

## 已核实

- 不是版本号漏改：`v0.5.2` / `v0.5.3` / `v0.5.5` 三个 tag 的 `cli/Cargo.toml` 与 `core/Cargo.toml` 版本号一致，CLI 的版本取
  `env!("CARGO_PKG_VERSION")`（`cli/src/system.rs:43`）。

## JC 的 Windows 真机（2026-10-01，v0.5.5 → v0.5.6 应用内更新）

- 更新时没有挂 `session wait`，走的是普通路径。更新后 `%APPDATA%\galley\cli-path` 第一行是
  `C:\Users\JCONE\AppData\Local\Galley\galley.exe`，用它跑 `version` 得到 `{"galleyVersion":"0.5.6","schemaVersion":2}`：
  **普通的应用内更新会替换 CLI**。
- `where.exe galley` 找不到：Windows 上 Galley 不把 CLI 加进 PATH（`core/src/path_install.rs` 只在 macOS 建
  `/usr/local/bin/galley` 链接）。
- 安装目录里是 `galley-core.exe`（主程序）、`galley.exe`（CLI）、`uninstall.exe`。exe 的修改时间是构建机上的时间（CLI 19:54、
  主程序 20:06，本地时间，对得上 release run 的 Windows 构建），NSIS 保留了源文件时间，所以不能拿它判断有没有替换，只有
  `uninstall.exe`（20:23）是安装时间。

## 安装钩子的错位（顺带发现，未修）

`core/installer/nsis-hooks.nsh` 的 `NSIS_HOOK_PREINSTALL` 按 `$_.Name -eq 'Galley.exe'` 结束安装目录下的进程。
[06-03 devlog](../../../docs/devlog/2026-06-03-windows-updater-file-lock.md) 写明本意是结束「old background Galley process」，
即主程序；但主程序实际叫 `galley-core.exe`，而 PowerShell 的 `-eq` 不分大小写，于是这一条实际匹配到的是 CLI 的 `galley.exe`：

- 主程序不靠这条：Tauri 自己的 NSIS 模板会检查正在运行的主程序（未在本仓库里核对模板细节）。
- 副作用：更新或手动覆盖安装时，安装目录下正在跑的 CLI（比如 supervisor 挂着的 `session wait`）会被强制结束。
- 对本票的意义：「更新时 CLI 被占用、替换失败」这个方向基本不成立，因为安装前 CLI 进程会先被结束。

## 现在的判断

- 主方向：Windows 上 CLI 默认不在 PATH，报告人能直接敲 `galley version`，说明自己加了 PATH 或拷过一份 CLI；拷出去的那份不会跟着
  更新，正好对得上「0.5.2 落后于 0.5.3」。
- 等报告人回：#30 的回帖请对方贴 `where.exe galley`、`galley version` 和 `%APPDATA%\galley\cli-path` 第一行。
- 钩子那条是否改（改成按主程序名匹配，或明确保留「结束 CLI」并写进注释），等本票有结论后一起定。
