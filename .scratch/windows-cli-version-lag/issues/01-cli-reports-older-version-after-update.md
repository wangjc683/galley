# 01 Windows：应用内更新后，同目录的 CLI 仍报旧版本

Status: needs-triage
Date: 2026-10-01
来源：社区 [galley#29](https://github.com/wangjc683/galley/issues/29) / [#30](https://github.com/wangjc683/galley/issues/30) 的环境栏（同一作者），处理这两条时顺带发现
影响面：Windows；supervisor / IM 渠道调用的 `galley` CLI 若停在旧版本，拿不到新契约（如 `live.askPending`、`wait --until-idle`）

## 现象

两份报告都写「Galley 0.5.3（应用内 Settings → About）；同一个安装目录里自带的 CLI `galley version` 报 0.5.2」。

## 已核实

- 不是版本号漏改：`v0.5.2` / `v0.5.3` / `v0.5.5` 三个 tag 的 `cli/Cargo.toml` 与 `core/Cargo.toml` 版本号一致，CLI 的版本取
  `env!("CARGO_PKG_VERSION")`（`cli/src/system.rs:43`）。

## 待查的方向（未评估）

- 应用内更新时 `galley.exe` 正被占用（supervisor 的 `session wait` / IM 渠道调用），安装器替换失败但没报错。
- 用户 PATH 上另有一份旧 CLI（报告写的是「同一个安装目录」，可能性较低，但要请对方确认 `where galley` 与 About 里的路径）。
- 可在 JC 的 Windows 真机上复现：起一个长 `session wait`，再做一次应用内更新，看 `galley version`。
