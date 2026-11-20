# 01 浏览器没连上时，Galley 打开扩展所在的浏览器

Status: ready-for-agent
日期：2026-11-20
背景：[PRD](../PRD.md)（问题、两项探针的结果、边界）。JC 裁决：开票；默认开、不加开关。

## 要的行为

内置模式下，`web_scan` / `web_execute_js` 发现没有可用标签页、而且扩展没连上时：

1. 如果 Galley 知道扩展装在哪个浏览器，就打开它，等扩展连上（最多 20 秒），然后照常执行这次调用，模型察觉不到中间这一步。
2. 不知道（从没连上过）、浏览器桥不是主进程（`role` 为 `remote`）、或者 20 秒内没连上：回现在那句话
   （`NO_BROWSER_CONNECTION_MSG`，原文不改）。不知道时立刻回，不空等。
3. 扩展已连上但没有标签页：照旧立刻回 `NO_BROWSER_TABS_MSG`，不打开任何东西。

浏览器已经在运行（只是扩展没连上，例如后台被休眠）时不再打开它：Windows 上再起一次程序会多开一个窗口，macOS 上只会抢前台，
都没用。这时照旧按第 2 条等满再回那句话（扩展自己的 alarm 会在 30 秒级重连）。

## 1. 要改的文件

- `managed-ga/code/ga.py`、`managed-ga/code/TMWebDriver.py`：内置 GA 代码，改完按
  [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的补丁规则落成一个新补丁（下一个编号，现在最大的是 `0034`），
  并登记进 `managed-ga/patches/manifest.md`。
- `runner/managed_browser_bridge.py` 及其测试。
- `core/src/browser_bridge.rs`（及它启动浏览器桥、存取偏好的相关处），打开浏览器的函数放进 `core/src/browser_control.rs` 旁边现有的
  `run_command` / `spawn_command` 一类写法。
- 文档：`docs/managed-ga-runtime/browser-control.md`（「Resident Bridge And Live Status」一节的状态协议与新行为；浏览器桥的
  「What the bridge may do」那段要改，见下）、补丁说明所在的文档。

## 2. 怎么改

### 2.1 认出浏览器（浏览器桥，Python）

- 浏览器桥是主进程时，扩展每次新连上（`extension_connected_at` 变了），取扩展那条连接的对端端口：
  `driver.extension_client.address`（`simple_websocket_server` 的 `WebSocket.address`，补丁 `0006` 存的 `extension_client`）。
- 按端口反查持有这条连接的进程，再得到要打开的程序：
  - macOS：`lsof -nP -iTCP:<端口> -sTCP:ESTABLISHED -Fpn` 一类，取**本地端口**等于它的那个进程（另一头是浏览器桥自己，排除自己的
    进程号）；拿进程的可执行文件路径，往上取**最外层**的 `*.app`。实测对端是
    `…/Vivaldi.app/Contents/Frameworks/…/Vivaldi Helper.app/Contents/MacOS/Vivaldi Helper`，要的是 `…/Vivaldi.app`，
    不是里面的 `Vivaldi Helper.app`。
  - Windows：`ctypes` 调 `GetExtendedTcpTable`（`TCP_TABLE_OWNER_PID_CONNECTIONS`）找本地端口等于它的连接的进程号，再
    `OpenProcess` + `QueryFullProcessImageNameW` 取程序路径（例如 `msedge.exe` 的完整路径）。Edge / Chrome 的网络进程和主程序是同一个
    `exe`，直接用这个路径。
  - 其他平台：不查，当作不知道。
  - 查不到就当作这次没认出，不报错、不影响状态。
- 状态行加字段 `browserApp`（字符串或 `null`，增量）：这次运行里最近一次认出的程序路径。
- 启动参数加 `--known-browser-app <路径>`：Core 存着的上一次认出的路径。这次运行还没认出新的之前，以它为准。

### 2.2 请求打开（GA 代码 + 浏览器桥）

- `TMWebDriver.py` 的 `/link` 加一条命令 `galley_browser_wanted`：主进程上设了钩子 `self._galley_on_browser_wanted` 就调用它，回
  `{"r": {"opening": <布尔>}}`；没设回 `{"r": {"opening": false}}`。别的命令不动。
- 浏览器桥在自己的主进程上设这个钩子。返回 `true` 的条件：角色是主进程、扩展当前没连上、知道浏览器（`--known-browser-app` 或这次
  认出的）。返回 `true` 时把状态字段 `browserWantedAt`（ISO 时刻，增量）更新为当前时刻，状态变了就照常写一行；30 秒内重复请求
  仍回 `true`，但不再更新这个字段，免得反复打开。
- `ga.py`：`web_scan`、`web_execute_js` 里 `len(driver.get_all_sessions()) == 0` 时：
  1. 扩展已连上：照旧回 `NO_BROWSER_TABS_MSG`。
  2. 否则发 `{"cmd": "galley_browser_wanted"}`（远程客户端走 `driver._remote_cmd`；如果这个进程自己就是主进程，直接看钩子，没钩子
     当作 `false`）。回的不是 JSON（外置或上游的主进程对不认识的命令回 `'ok'`）、出错、或 `opening` 不是 `true`：立刻回
     `NO_BROWSER_CONNECTION_MSG`。
  3. `opening` 为 `true`：每 0.5 秒查一次 `get_all_sessions()`，最多 20 秒；有了就继续往下照常执行这次调用，到点没有就回
     `NO_BROWSER_CONNECTION_MSG`。
- `first_init_driver` 现在会先空等 12 秒（`ga.py` 里 `deadline = time.time() + 12`）。浏览器没开时，这 12 秒加上新的 20 秒就是 32 秒。
  改成：建好 driver 后如果马上就有会话或扩展已连上，照旧；否则不在这里空等，交给上面的流程（先请求打开、再等）。改之前确认这
  12 秒原本是为什么等的（扩展刚启动的唤醒、主进程刚起来），别把那种情况弄坏；理由写进补丁说明。

### 2.3 打开（Core，Rust）

- 状态行里 `browserApp` 不为空且与存着的不同：存进偏好（新键，例如 `browser_control_last_browser_app`，按现有偏好的写法）。SQLite 写入
  只在 Core。
- 启动浏览器桥时，偏好里有值就传 `--known-browser-app`。
- 状态行里 `browserWantedAt` 变了、而且 `extensionConnected` 为 `false`：
  - 这个浏览器已经在运行：不打开（理由见上）。macOS 按「有进程的可执行文件在 `<app>/Contents/MacOS/` 下」判断；Windows 按进程的
    映像名（`exe` 文件名）判断即可。
  - 没在运行：macOS `open -a <app>`，Windows 直接起那个 `exe`（不带参数，浏览器按用户自己的设置恢复上次的标签页）。不带网址。
  - 失败只记日志（不带完整路径以外的用户数据），不改状态、不弹任何东西。
- 只在内置模式：浏览器桥本来就只在内置模式起，外置模式零变化。

### 2.4 文档

- `browser-control.md`：状态协议加两个字段；新增一小节写这条行为（条件、20 秒、已在运行不打开、只在内置模式）。「What the bridge may
  do」现在写的是只构造 `TMWebDriver()` 并调 `get_status()`，改成也会读扩展连接的对端端口、在自己的主进程上设
  `_galley_on_browser_wanted` 钩子；仍然不在页面里执行脚本、不写 GA 文件。
- 宪法第 2 条：没有新增监听。`galley_browser_wanted` 走 GA 已有的 `127.0.0.1:18766/link`，带 `Origin` 的请求照旧被上游拒掉。写进文档。

## 3. 验证

```bash
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
git diff --check
```

加上 managed GA 补丁规则要求的重放 / 载荷检查（按 README 找对应脚本，跑给出输出）。探针或测试要 import `managed-ga/code` 时用
`python -B`，不要留下 `__pycache__`。

要有的测试（用假的 driver / 假的进程查询，不碰真实浏览器）：

- 浏览器桥：从可执行文件路径取最外层 `.app`（含 Helper 嵌套的例子）；钩子在四种条件下的返回值；30 秒内重复请求不更新
  `browserWantedAt`；`--known-browser-app` 生效；查不到进程时 `browserApp` 不变。
- `ga.py` 的新流程：`opening` 为 `false` 立刻返回；回 `'ok'` 当作 `false`；等到会话出现后照常执行；超时回原句。
- Core：`browserApp` 入偏好；`browserWantedAt` 变化且未连接时调打开函数，已连接或浏览器已在运行时不调（打开函数与进程检查要能替换成
  假的来测）。

## 4. 不要碰

- 扩展源码（`managed-ga/code/assets/tmwd_cdp_bridge/`）。
- `NO_BROWSER_CONNECTION_MSG`、`NO_BROWSER_TABS_MSG` 的原文。
- GUI、CLI / Agent API、Core ↔ runner 的 IPC 协议（这条路径走浏览器桥的状态行，不走 runner）。
- 外置模式的任何路径。
- 不要在本机真的退出或打开任何浏览器，不要连真实的 18765 / 18766（JC 的浏览器连在上面）。真机打开由主会话验。
- 不要跑 `tauri dev`。

## 5. 报告

按 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints」的四部分。另外写明：

- 新补丁的编号与它改了哪些函数；`first_init_driver` 那 12 秒原本为什么等、改成了什么。
- 一行改后的状态行样例（路径用虚构的）。
- IM 渠道的 GA 进程是不是也作为远程客户端连常驻主进程（也就是 IM 里用浏览器会不会同样触发打开）：查代码给结论，不用实跑。
- Windows 那段 `ctypes` 只能靠读代码核对，写明没在 Windows 上跑过。

## 6. 验收

| 主会话能代验 | 只有 JC 能验 |
|---|---|
| 合入、Core 重启后，状态里 `browserApp` 是 Vivaldi，偏好入库 | Windows：关掉 Edge，让 Galley 做一件要用浏览器的事，Edge 自己打开、任务接着做完；记下等了几秒 |
| 征得 JC 同意后退出 Vivaldi，经 CLI 给主对话发一件要用浏览器的事，Vivaldi 被打开、任务做完；从日志与库里核对时刻 | Windows：Edge 开着时再做一次，不会多开窗口 |
| 浏览器开着时让它用浏览器，日志里没有打开动作 | 对话中途浏览器自己弹出来，感受上能不能接受 |

## Comments

### 2026-11-20 主会话验收：打开时要带网址（更正票面，JC 未裁，可撤）

票面 2.3「不带网址」「已在运行就不打开」两条的前提错了，是主会话写票时的错：

- 扩展只认 `http` / `https` 标签页（`background.js:165`）。Chrome / Edge 默认启动只开新标签页，不带网址打开后，扩展连上了却没有
  可用网页，工具等满 20 秒再报错（代理在报告里列为风险）。
- 每个 `http` / `https` 页面都会给扩展发 `wake`（`content.js`），后台休眠的扩展因此醒来重连（`background.js:20`、`:459`）；
  Chromium 把给正在运行的实例的网址转给它，开成新标签页而不是新窗口；Edge 的启动加速会让它没有窗口也在运行，「已在运行就不打开」
  会正好漏掉这种情况。

改为：Core 总是带 `BROWSER_CONTROL_TEST_PAGE_URL`（`https://example.com`，设置页「测试页」用的同一个）打开，去掉进程检查。
已交同一个代理在分支上补一个提交。代价：会恢复上次标签页的浏览器（如 Vivaldi）每次被打开会多一个标签页。

### 2026-11-20 主会话验收：断开期间只打开一次（JC 未裁，可撤）

去掉进程检查后，代理报出：扩展被禁用或卸掉、或存的浏览器路径已打不开时，每过 30 秒一次浏览器工具调用都会多开一个
`example.com` 标签页，并空等 20 秒。改为：一次断开期间只打开一次，30 秒内没连上就回现在那句话、不再打开，扩展重新连上
或 Galley 重启后恢复。已交同一个代理补一个提交，只动浏览器桥与它的测试、文档。
