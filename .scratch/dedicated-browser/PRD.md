# PRD：Galley 专属浏览器

Status: needs-triage（暂缓，2026-10-22 JC：「我也倾向于你的方案，不过现在也不开始做，只记录落文档吧」）
Date: 2026-10-22
来源：JC 提出浏览器控制的三个痛点（真实浏览器被抢占、用户的安全担忧、装扩展要开发者模式且没上架商店），设想给 Galley
一个属于它自己的浏览器：预装浏览器控制扩展、可以为 Galley 量身打造，用户也能像用普通 Chrome 一样完整使用、登录、手动打开网页给 Galley 看
关联：[deferred「Galley 专属浏览器」](../../docs/devlog/deferred.md) ·
[浏览器控制](../../docs/managed-ga-runtime/browser-control.md) ·
[抢前台 PRD](../browser-focus-steal/PRD.md) ·
[浏览器控制 UX 一轮](../browser-control-ux/PRD.md)

## 问题

1. **抢占分两层。**
   - 焦点抢占：智能体一用浏览器，浏览器就跳到前台盖住 Galley。10-07 实测来源在浏览器自身：Chrome 155 新开标签页不抢，
     Vivaldi 8.2 只要新建标签页或窗口就抢（[抢前台 PRD](../browser-focus-steal/PRD.md) 实测表），暂缓在 deferred。
   - 使用权抢占：智能体和用户共用同一个浏览器。它在用户的窗口里开标签页，用户也可能顺手关掉它正在用的页；每次 `web_scan`
     都把所有标签页的标题和网址交给模型（[浏览器控制](../../docs/managed-ga-runtime/browser-control.md) 末段）。
     这一层在现有架构里无解，只有把浏览器分开才能解。
2. **安全担忧。** 扩展带 `debugger`、`cookies`、`management`、`<all_urls>` 权限
   （`managed-ga/code/assets/tmwd_cdp_bridge/manifest.json`），装在用户的主力浏览器里，网银、邮箱等全部登录态都在智能体
   够得着的范围内。
3. **安装摩擦。** 开发者模式加拖入未打包文件夹，是 Chrome 对未上架扩展的硬限制，UI 层已压到底（10-04 结论）。Chrome 137 起
   正式版删掉了 `--load-extension` 启动参数，只在 Chromium 和 Chrome for Testing 里保留
   （[Chromium 扩展组公告](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ)）。
   上架商店暂缓中，权限这么重，审核大概率卡（deferred「浏览器插件上架」）。

## 三种做法对表

| | A. Galley 窗口里嵌网页视图 | B. 自带 Chromium | C. 借用户已装的 Chrome / Edge 起专属配置 |
|---|---|---|---|
| 怎么做 | Tauri 的 WKWebView / WebView2 | 打包或按需下载 Chromium，`--load-extension` 预装扩展 | Core 以独立的 `--user-data-dir`（在 `app.galley` 数据目录下）启动用户已装的 Chrome / Edge，经 CDP `Extensions.loadUnpacked` 自动装扩展 |
| GA 浏览器工具 | 不能用：macOS 的 WKWebView 不支持 Chrome 扩展，`web_scan` / `web_execute_js` 全靠扩展，要重写传输层 | 能用 | 能用：10-07 探针在 Chrome 155 的临时配置里走这条路加载过同一份扩展（[抢前台 PRD](../browser-focus-steal/PRD.md)「探针做法」） |
| 像普通浏览器一样登录 | 不行：Google 自 2021 年起封锁内嵌网页视图里的账号登录 | 大体行；开源 Chromium 默认不带 H.264 / AAC 解码和 Widevine，部分视频站会坏 | 行，就是正版 Chrome / Edge |
| 体积 | 0 | Chrome 156 的 macOS 安装包约 730 MB（双架构），Galley.app 约 257 MB | 0 |
| 安全更新 | — | **Galley 自己追 Chromium 的安全补丁**；Chrome for Testing 不自动更新 | Google / 微软自动更新 |
| 量身打造 | — | 实际能做的只有扩展加启动参数，改 Chromium 源码等于分叉出一个浏览器 | 同 B：扩展加启动参数 |

B 会把痛点 2 换成更糟的形式：一个装着用户全部登录态、却落后安全补丁的浏览器，由一个人维护；它还和「轻量」正面冲突。

## 推荐：C（JC 倾向，2026-10-22）

用户看到的：顶栏「打开 Galley 浏览器」，弹出一个独立窗口，和普通 Chrome 一样用、一样登录，登录态存在 Galley 的数据目录里。
Galley 只在这个窗口里干活，用户自己的浏览器照常用，互不打扰。

三个痛点各自怎么解：

- 抢占：使用权层天然分开；焦点层上，Chrome 新开标签页本来不抢（Vivaldi 用户的专属浏览器也是 Chrome / Edge）。
- 安全：边界变成物理的，「Galley 只看得到 Galley 浏览器里的东西」，用户一听就懂。这是这条路最强的论据。
- 安装：扩展由 Galley 启动时自动装，没有开发者模式、没有拖文件夹。

覆盖面：Windows 自带 Edge；Mac 上只用 Safari 的用户要先装 Chrome。这部分人今天本来就用不了浏览器控制，C 不比现状差；B 只在
这部分人多到值得时作兜底。

## 代价（要 JC 认的）

1. **卖点换一句话**：从「用你已登录的浏览器」（今天的邀请横幅文案）变成「Galley 自己的浏览器，你登录一次它一直记得」。每个站点
   要在 Galley 浏览器里重新登录一次，JC 自己 Vivaldi 里的登录态也得搬一遍。讨论时的判断：值，安全叙事干净得多，登录是一次性成本。
2. **两个浏览器不能同时连**：两个扩展连同一个 TMWebDriver master，命令会被串到「最新活动的会话」
   （[抢前台 PRD](../browser-focus-steal/PRD.md)「探针做法」第 3 条）。「专属浏览器」和「连我自己的浏览器」必须二选一。
3. **「手动打开网页给 Galley 看」不用新做**：今天 `web_scan` 看得到全部标签页是隐私负担；在专属浏览器里，所有标签页本来就是
   给 Galley 的，用户打开一页说「看我刚打开的」，现有工具就够。
4. **没解决的**：网页里的提示注入照旧。专属浏览器缩小的是爆炸半径，不是消除风险：用户在里面登录了什么，智能体就能动什么。

## 未知：开工第一步先探针

都在临时配置目录里测，不碰用户的浏览器数据；会弹出浏览器窗口，约半小时。

1. **Google 账号在这种启动方式下能否手动登录**，顺带测一个国内站（淘宝或飞书）。Google 的安全浏览器要求写明「浏览器不得提供
   自动化功能」（[Google 2020 指引](https://developers.googleblog.com/2020/08/guidance-for-our-effort-to-block-less-secure-browser-and-apps.html)），
   以调试管道启动可能被识别。这条不过，C 的价值打大折扣，第一优先。
2. **`Extensions.loadUnpacked` 装的扩展重启后还在不在。** 协议里 `uninstall` 的注释是「从配置中卸载」，暗示持久，未验
   （[CDP Extensions 域定义](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Extensions.pdl)）。
   持久的话之后可以不带管道正常启动，第 1 条的风险也随之变小；不持久就每次启动都走管道。
3. **有没有提示条**：「不支持的命令行参数」（`--enable-unsafe-extension-debugging`）或「正受到自动测试软件控制」之类。
4. **生命周期与辨识**：Galley 退出、管道断开后浏览器跟着关还是留着；Dock 里出现第二个一模一样的 Chrome 图标时怎么区分
   （印象中会出现，未验）；能否像 `open -g` 那样后台启动、不抢前台。

Windows 上 Edge 走同一条路是否可行，留给 Windows 真机冒烟。

## 规则核对

- 宪法第 2 条：CDP 走管道不开端口，扩展仍连 GA 自己的 18765，Core 不新开监听。
- 内置模式：主场。常驻桥不变，扩展照旧连它。
- 外置模式：默认零变化，照旧「连我自己的浏览器」。启动一个浏览器不碰外置 GA 的文件，以后可扩到外置，暂不做。
- 定位重量：不花 token；上游 GA 没有启动浏览器的代码（`managed-ga/code` 下 grep `user-data-dir` / `load-extension` /
  `remote-debugging` 无命中），不算平行重做 GA 已有能力；Core 多一个子进程加一次 CDP 调用，GUI 多一个入口。

## 和其他暂缓项的关系

- deferred「浏览器操作抢走前台」：默认路径改走专属浏览器后，方案 B「抢了再还」只剩选「连我自己的浏览器」的 Vivaldi 用户需要。
- deferred「浏览器插件上架」：默认路径不再需要开发者模式，上架只剩「连我自己的浏览器」这条高级路径受益。
- [移动端 issues/01](../mobile-product/issues/01-browser-intervention.md)：专属浏览器里没有用户的私人标签页，将来给手机看浏览器进度的隐私顾虑更小。

## 待定（开工前要裁）

1. 形态：C（JC 已倾向）；探针第 1 条不过时，是转 B 还是整条放弃。
2. 和现有方式的关系：专属浏览器作默认、「连我自己的浏览器」降为设置里的高级选项、二选一（讨论时的推荐）；还是完全替换。
3. 卖点与文案：邀请横幅、设置页范围说明（「沿用你的登录态」「它能看到你打开的所有标签页」）都要改写，JC 是否认「Galley 自己的浏览器」这个说法。
4. 浏览器选择：用户同时装了 Chrome 和 Edge 时用哪个；什么都没装时提示装哪个。
5. 什么时候启动专属浏览器：智能体第一次要用时自动启动，还是只由用户点开（未启动时智能体如何提示）。

## 启动信号

任一即可：

1. 社区或 dogfood 里出现「装插件卡住 / 放弃」，或「不敢装、怕它看到我所有网站」的反馈；
2. Chrome 进一步限制开发者模式扩展（例如启动时弹停用提示）；
3. JC 在 Vivaldi 里被抢前台、抢标签页烦到要动手（同 deferred「浏览器操作抢走前台」信号 ①），这时优先走本条而不是方案 B；
4. 准备面向非技术用户推广，浏览器控制的新手开通率成为瓶颈。

## Comments

- 2026-10-22：讨论记录。JC 原设想是「内置一个轻量级的浏览器」；讨论中把「内置」拆成 A / B / C 三种做法，推荐 C（不自带内核，
  借已装的 Chrome / Edge 起专属配置），JC 同意倾向 C，决定现在不做、只落文档。待定第 2、3 条讨论时给了推荐，JC 未单独裁。
