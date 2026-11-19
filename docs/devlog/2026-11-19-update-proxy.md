# 更新连得上：跟系统代理 + 加速地址

日期：2026-11-19
关联：GitHub issue #33；`.scratch/update-proxy/`（PRD 与两张票，发版后删）；`core/Cargo.toml`（reqwest 那一行的注释）；`core/src/managed_model_probe.rs`；`core/src/app_update.rs`（模块注释）；`gui/src/lib/update-proxy-prefix.ts`；[设置页设计](../design/overlays-and-settings.md)「应用行为」与 About「更新控件」

## 起因

issue #33 请求给应用内更新加 GitHub 反代加速。应用内更新要连两个 GitHub 域名：更新清单在 `raw.githubusercontent.com`，安装包在 `github.com/.../releases/download/`。连不上 GitHub 的用户分两类，各缺一条路：

1. **有代理，但更新器用不上。** 代理软件开「系统代理」模式时，浏览器能上 GitHub，Galley 的「检查更新」仍然连不上；只有 TUN 模式下更新器才通。票 01 修这一类。
2. **没有代理。** 只能靠一个转发 GitHub 的地址。票 02 给这一类加「更新加速地址」设置。

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

## 票 02：「更新加速地址」设置

### 裁决（JC，2026-11-19）

1. **两类都做**：票 01 让更新器跟系统代理，票 02 加「更新加速地址」。
2. **用户自己填，不带预设，默认留空即关闭。** 没选：带一两个公共反代做预设。公共反代域名常换，预设会烂在已发出的版本里，也等于替第三方设施背书。
3. **放「通用 → 应用行为」，在 `自动下载更新` 下面，存 pref。** 没选：放在「关于」页（关于页是版权页，不放输入框）。折中：「关于」页更新出错时，错误块在「手动下载」后面加一个「设置加速地址」链接，跳到通用页。
4. **一个输入框，留空即关闭。** 没选：开关加输入框。填的是前缀，Galley 把它拼在原地址前面，清单与安装包两处都拼；只收 `https://`。
5. **检查先走加速地址，失败再直连；下载只走加速地址**，失败就报错并写明地址。没选：下载失败也回退直连（连不上 GitHub 的用户要多等一轮超时才看到错误）。**当日改**：下载也回退直连，见下文「下载也回退直连」。
6. **自建镜像（第二个更新端点）不做。** 启动信号：有用户在系统代理确实生效、或填了加速地址之后，更新仍然失败。

### 接口约定

- pref 键 `update_proxy_prefix`，值是 JSON 字符串。缺失、空串、只有空白，都表示关闭（直连）。
- 合法值：去掉首尾空白后能解析成 URL，scheme 是 `https`，有主机名，且不带 query、不带 fragment（原文里出现 `?` 或 `#` 就算带，单独一个结尾的 `?` / `#` 也算，否则原地址会落进 query 或 fragment 里；验收时补）；其余一律不合法。
- 规范化：合法值去掉末尾所有 `/` 再补一个 `/`。
- 拼接：`<规范化前缀><原地址全文>`，原地址不做任何转义。例：前缀 `https://example.com`，原地址 `https://github.com/o/r/releases/download/v1/a.exe`，结果 `https://example.com/https://github.com/o/r/releases/download/v1/a.exe`。
- GUI 只把合法值或空串写进 pref；Core 读到不合法的值按关闭处理，不报错。校验两边各一份（`gui/src/lib/update-proxy-prefix.ts` 与 `core/src/app_update.rs` 的 `normalize_proxy_prefix`），单测用同一组用例。

### 做了什么

- **Core**（`app_update.rs`）：每次检查读一次 pref。开启时做两次检查：先用拼接后的清单地址，失败再用原地址；两次都失败，返回第一次的错误（`endpoint=` 是拼接后的地址）。没有把两个地址塞进同一个 `endpoints` 列表：插件遇到「返回 200 但不是 JSON」会直接报错、不试下一个。检查拿到的 `Update` 在返回前把公开字段 `download_url` 换成拼接后的地址（原地址另存一份），所以不管清单从哪条路拿到，下载都先走加速地址，失败再用原地址下一次（当日改，见下）；两次都失败时，错误多一个字段：`update_error: phase=download; url=<拼接后的地址>; detail=…`。关闭时与改动前相同（检查超时除外，见下），单测 `error_strings_without_the_prefix_are_what_they_were` 锁住三种错误串的原样；检查与下载共用一个回退函数 `proxied_then_direct`，两种用法各有单测。
- **GUI**：pref 与校验纯函数；通用页一行（输入框沿用运行环境页 GA 路径框的样式，失焦或 Enter 提交，不合法时描述行换成琥珀字提示）；「关于」页错误块的第二个链接，只在三种网络类原因（更新通道暂时不可用、暂时无法连接更新通道、下载更新失败）时出现，`readableUpdateError` 的返回值与错误状态多一个 `suggestProxyPrefix`。TopBar 更新弹层从 2026-07-15 起不展示错误，本票不动。
- 错误分类是对整串做子串匹配，开启时错误串里带着用户填的地址。补了单测：地址为 `https://example.com/` 的检查错误与下载错误，分类结果与不带地址时相同。

### 下载也回退直连（当日改，JC 未裁，不要可撤）

裁决 5 原本是「下载只走加速地址，失败不回退直连」，理由是连不上 GitHub 的用户不必多等一轮超时。验收时发现它会造成一种看不见、也不会自己好的卡住：

- 启动时的检查是静默的，发现新版本就自动下载；下载失败，状态停在 `error`；而 TopBar 更新指示器在 `error` 时隐藏（`updateIndicatorVisible`）。
- 加速地址失效、GitHub 却连得上时，检查经直连回退成功，加速地址的下载每次启动都失败，用户永远不知道有新版本。
- 在有这项设置之前，这个用户本来能正常更新，所以这条规则新引入了一种静默的永久停滞。

改后两步同一条规则：开启时先走加速地址；无论因为什么失败（请求出错、状态码不对、经加速地址拿到的包验签不过），再用原地址试一次；两次都失败，返回加速地址那一次的错误（下载的错误带 `url=<拼接后的地址>`，与原来一样）。重试下载时进度从 0 重新开始。停在 `PreparedAppUpdate` 里的是成功的那一次。关闭时不变：只下一次，错误串与改动前相同。

代价：加速地址能取到清单、却下不了包，而 GitHub 又连不上时，下载要多等一次直连的失败才报错；下载不设超时，等多久取决于系统的连接超时。原来担心的「多等一轮」只剩这一种情况：加速地址与 GitHub 都连不上时，检查就过不去，到不了下载。

### 对直连用户的一处行为变化

检查现在有 20 秒超时（`UpdaterBuilder::timeout`），加速地址关闭时也一样。此前检查没有超时，网络挂住时「正在检查」会一直转；现在 20 秒后报错。加这个超时是因为加速地址挂住时，没有超时就永远等不到回退。超时只作用于检查：插件构造 `Update` 时把 `timeout` 置空（`tauri-plugin-updater` 2.10.1 `Updater::check`），下载仍然不限时。

### 安全

验签不变：安装包仍用编译进应用的 minisign 公钥验签（`Update::download` 里）。反代能看到用户的 IP 与正在检查的版本号，能不给更新（报错，或给一份旧清单），不能换包。

### 检查连不上归为网络类（JC 未裁，不要可撤）

检查连不上时（拒绝连接、被重置、超时），插件的错误原样是 reqwest 的 `error sending request for url (…)`（插件的 `Error::Reqwest` 是 transparent）。`readableUpdateError` 原来的关键词都不认它，落到「更新检查失败。」，不在三种网络类原因里，「设置加速地址」链接就不出现，而这正是连不上 GitHub 的用户最常见的一种失败。现在把 `error sending request` 加进网络类关键词组：检查阶段归「暂时无法连接更新通道」，下载阶段归「下载更新失败」（下载阶段原来就落到这里）。

用户看得见的变化：更新通道连不上时，「关于」页的原因从「更新检查失败。」变成「暂时无法连接更新通道，请稍后重试。」，旁边多出「设置加速地址」链接。单测覆盖带与不带加速前缀的同一条错误。

### 没验证到的

- 真实走一遍「填了加速地址 → 检查 → 下载 → 验签」没法在合入前做：开发版不连更新通道，已发出的版本又没有这项设置，第一次真实验证要等带这项设置的版本升级到它的下一版。合入前的依据：拼接格式已用 issue 点名的两家公共反代实测（清单经反代取回与直连逐字节相同；Windows 安装包经其中一家整包下载，大小与 SHA-256 和直连一致）；拼接与回退逻辑有单测。
- 通用页这一行的样子（输入框宽度、不合法时描述换色）与「关于」页错误块两个链接并排的样子，等 JC 真窗口看。

### 已知缺口

- 加速地址与 GitHub 都连不上时，静默的启动检查失败，除了手动检查后的 设置 → 关于 之外，哪里都看不到任何提示。被墙的用户今天本来就是这样，不是这次新引入的。

## 发出之后（2026-11-19）

- 随 `v0.7.10` 当天发出（[发版记录](./2026-11-19-v0.7.10-release.md)）。JC 看过通用页与关于页错误块的真窗口截图，也看过上面几处「JC 未裁，不要可撤」的清单（回环直连、检查 20 秒超时、下载回退、检查连不上归为网络类、带 `?` 或 `#` 的前缀不合法），回的是「推送，然后发版」，没有逐条表态。这几处照旧标「未裁」，要撤仍是各自一个提交。
- 装好的草稿上验到的：通用页那一行在，值规范化后入库；经一个真实可用的前缀检查更新，应用只连了前缀的主机；经一个不通的前缀检查，日志里有回退那一行，随后连的是 GitHub。
- 仍然没验到的：打包版读系统代理（macOS、Windows 都没有，JC 定的不动本机网络环境）；经前缀下载与下载的回退（要等 v0.7.10 升到下一版）；回环地址的「测试模型」。Windows 的两步写进了 [Windows 清单](../windows-build-checklist.md)「App update」。
- issue #33 已回帖，保持 open：请对方在 Windows 的「系统代理」模式下试一次检查更新，并贴出覆盖安装时「先卸载旧版」那一页。
