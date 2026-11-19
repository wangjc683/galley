# 01 更新器与 Core 的请求跟系统代理

Status: needs-dogfood
日期：2026-11-19
背景：[PRD](../PRD.md)「问题」第 1 类与「已核实的事实」末条

先读 `docs/agents/dispatch.md`（执行代理的常设约束在那里，不在本票重复）。

## 1. 要改的文件

- `core/Cargo.toml`、`core/Cargo.lock`
- `core/src/managed_model_probe.rs`
- `docs/devlog/2026-11-19-update-proxy.md`（新建，票 02 接着往里写）与 `docs/devlog/README.md` 的索引

## 2. 怎么改

### 2.1 打开系统代理特性

`core/Cargo.toml` 里 Core 自己的 reqwest（0.12）加上 `system-proxy` 特性：

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls", "system-proxy"] }
```

reqwest 0.12 的 `system-proxy` 等于 `hyper-util/client-proxy-system`。更新器用的 reqwest 0.13 与它共用
同一个 `hyper-util`（锁文件里只有一份 0.1.x），特性统一后两边都开始读 Windows 注册表与 macOS 系统设置
里的代理。在这一行上方加注释写清这层耦合：**更新器靠共用的 `hyper-util` 拿到这个特性；升级
`tauri-plugin-updater` 或 reqwest 后要重跑下面的 `cargo tree` 核对。**

改完核对（三个目标平台都要看到 `client-proxy-system`）：

```bash
cargo tree --manifest-path core/Cargo.toml -e features -i hyper-util --target all | grep client-proxy-system
```

如果特性统一没有生效（比如锁文件里出现两份 `hyper-util`），停下，写进报告，不要自己换方案。

### 2.2 测试模型对回环地址直连

`hyper-util` 读系统代理时没有回环绕行（PRD「已核实的事实」末条），打开特性后，本地模型地址
（如 `http://localhost:11434`）的「测试模型」请求会被送进系统代理。远端代理到不了用户本机，测试会失败，
而引擎一侧（Python `requests`）会按系统例外列表直连，两边结果不一致。

改法：`probe_client()` 现在不带参数。让它按目标地址决定：主机是回环（`localhost`、`127.0.0.0/8`、
`::1`，大小写不敏感，`localhost.` 带尾点也算）时用 `.no_proxy()` 建客户端，其余不变。判断写成纯函数并
补单测，覆盖：`http://localhost:11434/v1`、`http://127.0.0.1:8000`、`http://127.8.9.1/`、
`http://[::1]:1234/`、`https://api.example.com/v1`（不是回环）、`http://localhost.example.com/`
（不是回环）。先读一遍 `probe_client()` 的每个调用点，确认都能拿到目标地址。

这一条 JC 未裁、不要可撤：单独一个提交，方便整条回退。

### 2.3 devlog

新建 `docs/devlog/2026-11-19-update-proxy.md`，先写本票：现象、根因（上面的特性链，带 crate 版本）、
连带影响（Core 的测试模型、对话图片、ChatGPT 登录三处请求也跟系统代理）、回环补丁及其「JC 未裁」标注、
升级时要重核的 `cargo tree` 命令。照 `docs/devlog/` 里近期条目的写法，并在 `docs/devlog/README.md`
加索引行。中文语境标点一律全角。

## 3. 验证命令

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
cargo tree --manifest-path core/Cargo.toml -e features -i hyper-util --target all | grep client-proxy-system
rustfmt --check --edition 2021 core/src/managed_model_probe.rs
git diff --check
```

`rustfmt --check` 只看自己动过的文件；该文件原本就不干净时，只保证自己的改动不新增差异，并在报告里说明。

## 4. 不要碰

- `core/src/chatgpt_siwc/`、`core/src/conversation_image.rs`：这两处跟系统代理是想要的结果，不加绕行。
- `core/src/app_update.rs`：票 02 的范围。
- `managed-ga/`、`runner/`、`cli/`、`gui/`。
- 不升级任何依赖的版本；锁文件里只应多出系统代理特性带来的条目（`system-configuration`、
  `windows-registry` 等）。多了别的，写进报告。

## 5. 报告格式

按 `docs/agents/dispatch.md` 的四段：改了什么（文件与提交号）、验证命令与输出、未解决的风险 / 没验证到的、
票外发现。另附：`cargo tree` 那一条的完整输出，以及锁文件新增的包名单。

## 6. 真机步骤

| 主会话可代验 | 只有 JC 能验 |
|---|---|
| `cargo tree` 三平台都有 `client-proxy-system`；单测通过 | 正式包上：系统代理指向一个不通的端口（如 `127.0.0.1:9`），「检查更新」应当报连接失败（证明更新器读到了系统代理）；改回后恢复正常。macOS 与 Windows 各一次，随下一版草稿冒烟走 |
| | 同一状态下，本地模型（回环地址）的「测试模型」照常通过 |

## Comments
