# PRD：浏览器没连上时自动打开它

Status: needs-dogfood（2026-11-20 JC 裁：开票；默认开、不加开关。票 01、02 已合入，Mac 上 Vivaldi 与 Chrome 都验过，Windows 等下一版草稿）
Date: 2026-11-20
来源：issue #33 回复（2026-11-20）：「浏览器插件……现在在 edge 浏览器上安装了插件，但是必须打开浏览器才能调用，但 edge 我不常用，
对话时经常忘了开」。JC 同日裁：火狐不做（见 deferred「火狐浏览器扩展」），先做这一半的探针。
关联：[deferred「火狐浏览器扩展」](../../docs/devlog/deferred.md) ·
[deferred「Galley 专属浏览器」](../../docs/devlog/deferred.md)（待定项「智能体第一次要用时自动启动，还是只由用户点开」与本条同题） ·
[浏览器控制](../../docs/managed-ga-runtime/browser-control.md) ·
[抢前台 PRD](../browser-focus-steal/PRD.md)

## 问题

浏览器没开时，浏览器工具直接回一句话把事推回给人：「浏览器当前没有连接。若已安装插件，请打开同一个 Chrome / Edge 的网页后重试……」
（`managed-ga/code/ga.py:115`）。用户得自己去开浏览器，再让它重试一次。扩展装在不常用的浏览器里时，这一步几乎每次都要走。

## 想要的样子

内置模式下，浏览器工具发现扩展没连上：Galley 打开扩展所在的那个浏览器，等扩展连上，接着做原来的事。等不到才回现在那句话。

## 探针

### 1. 能不能认出扩展装在哪个浏览器 —— 过（macOS）

- 扩展连上时的握手只有标签页清单，不带浏览器身份（`managed-ga/code/assets/tmwd_cdp_bridge/background.js:409–412`，`ext_ready`）。
  UA 也不行：Vivaldi 的 UA 与 Chrome 相同。
- 但连接本身认得出来：常驻浏览器桥是 18765 上的主进程，扩展那一端是浏览器的一个子进程。2026-11-20 本机 `lsof -nP -iTCP:18765`：
  对端进程是 `/Applications/Vivaldi.app/Contents/Frameworks/…/Vivaldi Helper.app/…`，往上找到 `.app` 就是要打开的那个浏览器。
- 所以做法是：扩展连上时按对端端口反查进程、记下浏览器的程序路径；下次没连上就打开这个路径。这样 Vivaldi、Brave、Arc 也能开，
  不限于 Core 现在会开的 Chrome / Edge（`core/src/browser_control.rs:357–376`）。
- 主进程手里有扩展的连接对象（补丁 `0006` 的 `_register_extension_client`），对端端口从这里拿。
- **Windows 没验**：按端口反查进程要用 `GetExtendedTcpTable` 取所属进程号、再取程序路径（`msedge.exe`）。只是按接口推的。

### 2. 从打开到连上要几秒 —— 过（macOS，一次）

- 代码上是浏览器一启动就连：`chrome.runtime.onStartup` 里直接 `connectWS()`（`background.js:459`），不等 30 秒级的 alarm。
- 2026-11-20 macOS 实测（JC 同意退出 Vivaldi 一分钟）：`osascript` 正常退出 Vivaldi，扩展断开后 `open -a` 打开它；
  0.03 秒进程起来，**1.86 秒**常驻桥报扩展连上，13 个标签页全部恢复。读的是主进程的 `get_status`（`127.0.0.1:18766/link`）。
- 只量到一次：第二轮在刚打开十几秒内发的退出没生效（Vivaldi 没退、状态完好），没再试。
- 不是真冷启动：系统刚开过它，磁盘缓存是热的，开机后第一次打开会更慢。Windows（Edge）没量。
- 现有的等待窗口：`first_init_driver` 等连接 12 秒（`managed-ga/code/ga.py:125–129`）。Mac 上 1.86 秒落在窗口里，不用放宽；
  文档记过 Windows 上扩展唤醒慢（[浏览器控制](../../docs/managed-ga-runtime/browser-control.md)「probes must tolerate Chromium
  MV3 service-worker wake-up」），Windows 的秒数开票后在真机上量。

## 边界

- 只在内置模式：常驻浏览器桥只在内置模式起。外置模式零变化。
- 打开浏览器由 Core 做（宪法第 5 条：子进程归 Rust），runner 只说「要浏览器」、等连接。接缝放哪（runner 经 IPC 请 Core 开，
  还是常驻桥看到会话在等就开）开票时再定。
- 打开会抢前台。这本来就是人要手动做的一步，不另处理。
- 打开时带一个网址（设置页「测试页」用的 `https://example.com`），浏览器开着时也照样打开（2026-11-20 验收时更正，JC 同日裁定保留）。
  原因：扩展只认 `http` / `https` 标签页（`background.js:165`），Chrome / Edge 默认启动只开新标签页，不带网址等于打开了也没有可用网页；
  网页会给扩展发 `wake`（`content.js`），后台休眠的扩展因此醒来重连；Edge 的启动加速会让它没有窗口也在运行。代价：会恢复上次
  标签页的浏览器会多出一个标签页。
- 从没连上过（不知道浏览器在哪）时，照旧回现在那句话，不猜。
- 不花 token，不加工具，不改扩展。

## 裁决（2026-11-20 JC）

1. 开票。
2. 默认开，不加开关：它替用户做的是本来就要手动做的一步，浏览器弹出来本身就看得见，不另外告知。

## 票

| 票 | 内容 |
|---|---|
| [01](./issues/01-open-the-browser-when-needed.md) | 认出浏览器、请求打开、Core 打开、文档 |
| [02](./issues/02-open-a-page-when-there-is-none.md) | 扩展连上了但没有可用网页时也打开（JC 2026-11-20 裁：做） |

## 待定

- 两种都装了扩展（只能有一个连主进程）时以最后连上的为准。
- 与「Galley 专属浏览器」的关系：那条开工后，默认打开的是专属浏览器，本条变成「连我自己的浏览器」这条路的行为。
