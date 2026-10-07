# PRD：浏览器操作抢走前台

Status: 暂缓（2026-10-07 JC 裁决：Chrome 用户基本不受影响，保持现状）
Date: 2026-10-07
来源：JC 提议「锁定前台显示」按钮——Galley 每次调用浏览器，浏览器就跳到前台把 Galley 挡住，刚切回去又被挡
关联：[deferred「浏览器操作抢走前台」](../../docs/devlog/deferred.md) ·
[浏览器控制](../../docs/managed-ga-runtime/browser-control.md) ·
[头号能力的用量数据](../../docs/devlog/2026-10-04-browser-control-ux-round.md)

## 问题

智能体用浏览器时，浏览器窗口跳到前台盖住 Galley，键盘焦点也随之被抢走，看不到运行进展和最终回复。一次运行里常连开
多个标签页（09-28 一次运行 4 分钟内 6～7 个），用户切回 Galley 后很快又被盖住。

## 实测结论

JC 在这台 Mac 上的主力浏览器是 **Vivaldi 8.2**，Galley 浏览器扩展只装在 Vivaldi 里（Chrome 的配置里没有）。对照组用
Chrome 155 的临时配置目录，通过调试管道加载同一份扩展。判据：动作前把访达置为前台，动作后 3 秒内采样
`NSWorkspace.frontmostApplication`；AppleScript `activate` 作对照组，证明探针能测出激活。

| 桥接动作 | Chrome 155 | Vivaldi 8.2 |
|---|---|---|
| 页内执行 JS、CDP `Runtime.evaluate`、`location.href` 原地跳转 | 不抢 | 不抢 |
| `tabs.create`，`active:true` 或 `active:false` | **不抢** | **抢** |
| `tabs.duplicate`、`windows.create({focused:false})`、`tabs.create` 进不聚焦的窗口 | 未测 | 抢（Vivaldi 无视 `focused:false`，新窗口直接成为聚焦窗口） |
| `tabs.update` 跳转网址 / 设为当前页 | 未测 | 不抢 |
| `tabs switch`（扩展里调 `windows.update({focused:true})`） | 抢 | 抢 |
| CDP `Page.bringToFront` | 抢 | 抢 |

- Chrome 的结果和源码一致：已有窗口时 `tabs.create` 走 `kNoAction`，不显示也不激活窗口（Chromium
  `chrome/browser/ui/navigator/browser_navigator.cc` 884–895 行；`open_tab_helper.cc` 只对新页面调
  `SetInitialFocus`）。`tabs.update(active)` 只在标签栏里切换（`tabs_api.cc` `UpdateActiveTab`）。
- Vivaldi 是有意为之：在 Vivaldi 里只要新建标签页或窗口就激活整个应用，扩展层面没有不抢前台的建法。论坛有人报过
  （2022，Windows，扩展自动开标签页时抢前台），志愿者关联到 VB-111875「Vivaldi window always steals focus」，
  没有官方答复，也没有可关的设置：<https://forum.vivaldi.net/topic/81026>。
- 真实用量（workbench.db，2026-10-07）：模型主动新开标签页 152 次 / 44 个会话，其中 `active:true` 114 次，10 月的
  5 次全是；原地跳转 138 次；`switch`、`bringToFront`、shell `open` 都是 0 次。10 月几次运行的固定模式是第一步
  `tabs.create(active:true)`，其后只在该页执行 JS。
- 已排除的来源：扩展的 `content.js` / `disable_dialogs.js`、`simphtml`、Galley Core 和 GUI 在运行时都不碰浏览器焦点；
  上游的 `webbrowser.open` 兜底已被补丁 0006 删掉。

## 被否的方案

- **置顶 / 锁定前台按钮**（JC 原提议，JC 自己也觉得不理想）：治标。浏览器仍是活动应用，键盘焦点照样被抢走；置顶窗口
  盖住一切，还是个要记得开关的模式。
- **A：改扩展，让新开标签页先后台创建、再在窗口内切过去，并去掉 `switch` 的窗口聚焦**：对 Chrome 不需要
  （`tabs.create` 本来就不抢），对 Vivaldi 无效（后台创建也抢）。
- **改用 Chrome 当智能体浏览器**：拿不到 Vivaldi 里的登录态，而沿用登录态正是这个功能的卖点。
- **让模型少开新标签页**（SOP 引导复用一个标签页）：只能减少次数，每次运行第一下仍然会抢，还改变了模型行为。

## 方案 B：抢了再还（暂缓中的首选）

在常驻浏览器桥 `runner/managed_browser_bridge.py`（Galley 自己的代码）里包一层 master 的 `execute_js`：每条转发
的命令发出前记下当前前台应用，命令执行中和返回后约 0.8 秒内，如果桥接浏览器变成前台而原先不是，就按 pid 把前台还给
原先的应用。不改 GA，不改扩展，不需要新补丁。

原型实测（Vivaldi，3 次）：Vivaldi 在命令发出后 26～113 ms 就抢到前台，早于命令返回（约 205 ms）；用 JXA 按 pid
`NSRunningApplication.activateWithOptions` 还回去，Vivaldi 在前台停留 **257 / 334 / 302 ms**，之后没再被抢。其中
约 150 ms 是 osascript 启动开销。

实施要点：

- 读前台：`lsappinfo front` + `lsappinfo info -only pid -only bundleid <ASN>`，每次约 8 ms。长驻进程里别用
  `NSWorkspace.frontmostApplication`，没有 run loop 时它不会更新。
- 还前台：按 pid 激活（JXA 或进程内 ctypes 调 objc），**不要按 bundle id**。dev 构建也叫 `app.galley`，按 bundle id
  激活可能把已安装的 Galley.app 拉起来，变成两个 Core。
- 压闪烁：命令发出时就并行盯，不等返回；进程内激活省掉 osascript。目标是 100 ms 以内，未验证。
- 护栏：命令开始后有键鼠输入就不还（`CGEventSourceSecondsSinceLastEventType(1, 0xFFFFFFFF)`，可用 ctypes 调），
  用户可能是自己切过去的；`Page.bringToFront` 不还，SOP 里自动登录要页面在前台。
- 适用范围：只在 macOS、内置模式、桥是 master 时生效；外置模式没有变化（宪法第 1 条）。桥是 remote 角色时
  不处理。
- 测试：前台读取和激活做成可注入函数，加进 `runner/tests/test_managed_browser_bridge.py`；在
  `browser-control.md` 里补一条耦合点。
- 代价：能看到一次短暂闪烁；闪烁瞬间敲的字仍可能落进浏览器；每条桥接命令多约 16 ms。Windows 不覆盖（论坛说
  Vivaldi 在 Windows 上也抢，Windows 的前台锁规则另议）。

## 待定

- 前台还给谁：之前在前台的任何应用（推荐），还是只还给 Galley。
- 闪烁能不能接受：要真机看，可先做出来在 `tauri dev` 里试。
- Edge（Galley 官方支持的另一个浏览器）、Brave、Arc 以及 Windows 都没测；这台 Mac 没装 Edge。

## 探针做法（重测时照抄）

- 状态采样用 JXA：`NSWorkspace.sharedWorkspace.frontmostApplication`，加
  `CGWindowListCopyWindowInfo(1|16, 0)` 取 layer-0 窗口的前后顺序，再加 `CGSessionCopyCurrentDictionary`
  的 `CGSSessionScreenIsLocked`。锁屏时前台是 loginwindow，测出来没有意义。
- 参照应用必须有可见窗口，否则「窗口有没有盖住它」无从比较。用 AppleScript 新建访达窗口需要自动化授权，静默失败过。
- **两个浏览器的扩展别连同一个 TMWebDriver master**：任一扩展发来 `tabs_update` 都会把另一个浏览器的标签页标成
  断开，命令随即被自动转到另一个浏览器的标签页（日志里是「会话 X 未连接，自动切换到最新活动会话」）。测 Chrome 时
  把扩展副本的 `WS_URL` 改成 18865，master 也开在 18865。
- Chrome 137+ 品牌版忽略 `--load-extension`。改用 `--remote-debugging-pipe --enable-unsafe-extension-debugging`
  启动，从 fd 3 发 CDP `Extensions.loadUnpacked {path}`，响应从 fd 4 读，消息以 `\0` 结尾。配合
  `--user-data-dir=<临时目录>` 使用，不碰用户配置。
- 测扩展变体时：临时替换 `~/Library/Application Support/app.galley/browser-control/tmwd_cdp_bridge/background.js`，
  发 `{"cmd":"management","method":"reload"}` 让扩展重新加载，测完换回原文件再加载一次。下次 Galley 启动也会
  重新同步这份目录。
- 收尾时按网址关掉所有 `galley-focus-probe` 标签页：用扩展新开的标签页历史只有一条，可以 `window.close()`；
  CDP `Page.close` 失败过一次。
