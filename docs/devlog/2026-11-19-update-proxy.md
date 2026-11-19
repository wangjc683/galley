# 更新连得上：跟系统代理 + 加速地址

日期：2026-11-19
关联：GitHub issue #33；`.scratch/update-proxy/`（PRD 与两张票，发版后删）；`core/Cargo.toml`（reqwest 那一行的注释）；`core/src/managed_model_probe.rs`

## 起因

issue #33 请求给应用内更新加 GitHub 反代加速。应用内更新要连两个 GitHub 域名：更新清单在 `raw.githubusercontent.com`，安装包在 `github.com/.../releases/download/`。连不上 GitHub 的用户分两类，各缺一条路：

1. **有代理，但更新器用不上。** 代理软件开「系统代理」模式时，浏览器能上 GitHub，Galley 的「检查更新」仍然连不上；只有 TUN 模式下更新器才通。票 01 修这一类。
2. **没有代理。** 只能靠一个转发 GitHub 的地址。

内置与外置运行时相同，引擎进程零变化；CLI 契约不动，没有新 IPC 命令，没有迁移。

## 票 01：更新器与 Core 的请求跟系统代理

### 根因

更新器的 HTTP 客户端只读环境变量里的代理，不读系统代理设置。特性链（版本取自 `core/Cargo.lock`）：

- `tauri-plugin-updater` 2.10.1 依赖 reqwest 0.13（锁定 0.13.3），关掉默认特性，只开 `json`、`stream` 与 rustls，没有 `system-proxy`。
- reqwest 建客户端时（0.13.3 与 0.12.28 都一样）用 `hyper-util` 的 `Matcher::from_system()`。`hyper-util` 0.1.20 的 `Builder::from_system` 先走 `from_env`，只有开了 `client-proxy-system` 特性，才再读 macOS 的系统设置（`SCDynamicStore` 里的 HTTP / HTTPS 代理）与 Windows 注册表（`Internet Settings` 下的 `ProxyEnable`、`ProxyServer`、`ProxyOverride`）。
- 从 Dock / 开始菜单启动的应用没有 `HTTPS_PROXY`，所以系统代理到不了更新器。

修法：Core 自己的 reqwest 0.12 加 `system-proxy` 特性，它等于 `hyper-util/client-proxy-system`。更新器的 reqwest 0.13 与 Core 的 reqwest 0.12.28 解析到锁文件里同一份 `hyper-util` 0.1.20，Cargo 的特性统一让更新器也拿到这个特性。插件没改，客户端没换。

锁文件新增 4 个包，都是这个特性带来的：`system-configuration` 0.7.0、`system-configuration-sys` 0.6.0、`windows-registry` 0.6.1，以及 `system-configuration` 依赖的 `core-foundation` 0.9.4（与已有的 0.10.1 并存）。没有升级别的包。

### 连带影响

特性开在共用的 `hyper-util` 上，Core 自己用 reqwest 的三处请求也开始跟系统代理：「测试模型」与「读取模型列表」（`managed_model_probe.rs`）、对话图片下载（`conversation_image.rs`）、ChatGPT 登录（`chatgpt_siwc/`）。这是想要的方向：引擎一侧 Python 的 `requests` 默认就读系统代理，两边现在一致。对话图片与 ChatGPT 登录不加绕行。

`hyper-util` 0.1.20 读系统代理有两处缺口（`src/client/proxy/matcher.rs`）：macOS 只读 HTTP / HTTPS 代理的主机与端口，不读例外列表；Windows 读 `ProxyOverride`，但只是去掉 `*.`、把分号换成逗号当作 `NO_PROXY`，`<local>` 与 `127.*` 这类写法匹配不上。两边都没有回环地址的自动绕行。

### 回环地址直连（JC 未裁，不要可撤）

打开特性后，本地模型地址（如 `http://localhost:11434`）的「测试模型」与「读取模型列表」会被送进系统代理。远端代理到不了用户本机，测试会失败；引擎一侧的 `requests` 却按系统例外列表直连，两边结果不一致。

补法：`probe_client` 改为带目标地址，主机是回环（`localhost`，大小写不敏感，带尾点也算；`127.0.0.0/8`；`::1`）时用 `.no_proxy()` 建客户端，其余不变。判断是纯函数 `is_loopback_endpoint`，单测覆盖 `localhost`、`127.*`、`[::1]` 与 `localhost.example.com` 这类形似的主机。只改「测试模型」这一处，对话图片与 ChatGPT 登录不绕行。

这一条 JC 没有裁，单独一个提交，要撤就整条回退。

### 升级时重核

更新器的系统代理是借共用的 `hyper-util` 拿到的，不是插件自己开的。升级 `tauri-plugin-updater` 或任一版 reqwest 之后（比如锁文件里出现两份 `hyper-util`），更新器可能悄悄失去它。重核命令（`core/Cargo.toml` 里 reqwest 那一行上方的注释也写着）：

```bash
cargo tree --manifest-path core/Cargo.toml -e features -i hyper-util --target all | grep client-proxy-system
```

`--target all` 把各目标合成一棵树，只出一行；要逐个看，把 `all` 换成三个发布目标 `aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-pc-windows-msvc`。2026-11-19 三个都有 `client-proxy-system`，锁文件里只有一份 `hyper-util`。

### 没验证到的

正式包上把系统代理指向一个不通的端口（如 `127.0.0.1:9`），「检查更新」应当报连接失败，证明更新器读到了系统代理；改回后恢复。macOS 与 Windows 各一次，随下一版草稿冒烟走。
