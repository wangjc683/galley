# Settings 逐页第二段·通用 / 快捷键 / 报告问题 / 关于批：安装挪到重启时、更新控件带版本号、键帽字形、快捷键表对齐实际

Date: 2026-10-08
Status: 实现完成，门禁全绿（typecheck / lint / vitest 845 / cargo test --workspace / diff check / 六个本地门禁）；dev 窗口里截图对表（更新控件 11 态是只改内存 store 拍的），harness 实点了 Ctrl+K / ⌘K / `⌘ + ,` / Help 菜单「Report an Issue…」；JC 真机验收 OK。更新流程本身要等 v0.6.2 发版时用旧版走一遍（dev 构建没有更新通道），Windows 要真机冒烟
Related: [聊天软件批](./2026-10-08-settings-channels-tab-pass.md)、[浏览器控制批](./2026-10-08-settings-browser-control-tab-pass.md)、
[overlays-and-settings §9 General / About / Shortcuts、§10](../design/overlays-and-settings.md)、[copy-language-guidelines](../copy-language-guidelines.md)（快捷键与更新状态三行）、
[release-update-sop §10](../release-update-sop.md)、[windows-build-checklist](../windows-build-checklist.md)（App update 一节）、
[06-03 Windows 更新文件锁](./2026-06-03-windows-updater-file-lock.md)、[07-15 顶栏更新指示器](./2026-07-15-topbar-update-indicator-and-toast-severity.md)、
[08-10 报告问题入口](./2026-08-10-community-issues-triage-and-settings-polish.md)

## 做法

同前四批：tauri dev 真机截图（中英文、深色、更新控件 11 态、通知权限提示），Opus 子代理审计（45 条历史裁决、44 条候选），主会话复读
关键行出对表页：7 个裁决点、17 条直接收口。键帽字形在 dev 窗口里注入 DOM 变体拍对照（WKWebView 渲染，与真机一致）。JC 回「按推荐」。
实现：主会话先改 zh / en 文案契约（新键与改写，旧键留到集成时统一删），三张 Opus 票按文件域并行——T1 Core（`app_update.rs` 拆两步、托盘 /
菜单路由）、T2 GUI 更新（store、关于页版本行、顶栏）、T3 GUI 其余（四页、全局快捷键、键帽字形三处）；命令名、`no_prepared_update`、
`menu:report_issue` 写死在票里；0 返工。

## 裁决（JC 全部按推荐）

- **D1 安装挪到点「重启并更新」那一刻（A）**。此前后台下载完、签名校验通过后立刻停渠道、浏览器桥和全部 runner 再安装
  （`app_update.rs`），界面停在「重启并更新」。macOS 就地替换 .app、应用照跑，但被杀的渠道不自己恢复（`wait_child` 记成「异常」），浏览器
  桥也停着，直到用户重启——自动下载默认开，开着后台运行的人可能几天手机渠道不通；装完到重启前新开的对话还是新包 runner 配旧 Core。
  Windows 上插件的 `install` 拉起安装器后直接 `exit(0)`（tauri-plugin-updater 2.10.1 `updater.rs:865`），应用在后台自己关掉重装，SOP 写的
  「准备好后点重启」不成立（读源码推出，未在 Windows 真机见过）。06-03 的「先停子进程」为 Windows 文件锁，本身对，错在时机。现在
  `download_app_update` 只下载 + 校验并把包放在 Core 内存里（mac 约 99 MB、Windows 约 61 MB），`install_app_update` 在点击时先发 installing、
  停子进程、安装，GUI 再 relaunch；安装失败把包放回去。下载不碰子进程，所以**不再等任务结束**（删掉「任务结束后自动准备」的看门狗），只有
  重启要等。代价：不点重启就退出，下次启动重新下载。被否：B 只在 Windows 停子进程（Windows 自关不变、Mac 新包旧 Core 的空档还在）、
  C 装完自动拉起渠道（新包代码配旧 Core）。
- **D2 版本行「按钮或徽标 + 一行说明」，说明带版本号（A）**。自动下载关时发现新版本，关于页和顶栏都转圈写「正在下载更新」，其实什么都没下，
  「检查更新」按钮也被徽标替掉，唯一的下载入口是 macOS 菜单——设计文档却写「手动下载永不受此开关限制」。设置页还从不显示目标版本号，
  就绪态只有一颗按钮。现在：有新版本 → 按钮「下载更新」+「发现新版本 vX」；下载中 → 中性徽标 + 「新版本 vX」；就绪 → 「重启并更新」+
  实心勾「vX 已下载，重启 Galley 后生效」（有任务在跑时按钮禁用、琥珀字）；安装中 → 中性徽标；顶栏弹层有新版本时也有「下载更新」。
  「发现新版本，当前任务结束后自动准备更新」随 D1 消失（它在设置页是琥珀、整句塞进徽标，与顶栏灰字也不一致）。被否：B 只改文案。
- **D3 键帽修饰键用系统字体（A）+ 备注去斜体**。⌘ ⌥ 偏小的原因：键帽 `font-mono`，JetBrains Mono 子集没有这些字形，「SF Mono」在
  webview 里按这个名字解析不到，回落 Menlo，⌘ 只有字母高的约 69%。只含一个此类字形的那一格改用系统字体（`.shortcut-glyph`，规则在
  `lib/shortcuts.ts`），设置页键帽、侧栏行尾 ⌘N、命令面板标签三处同一规则；Windows 是 `Ctrl` / `Alt` 字样不受影响。⌥↑ 那行备注从 11px
  中文伪斜体改为 11.5px 直立灰字（09-23 思考区「斜体没问题」是长段落语域，这里是一行小号注脚）。被否：B Phosphor 图标。
- **D4 快捷键表对齐实际（A）**。删「Tab：在命令面板中进入二级菜单」（命令面板没有 Tab 处理，git 历史里也没实现过；要做撞 07-05「鼠标
  优先」）；补「→ 填入下一步建议（输入框为空时）」「Esc 取消 Goal 模式」「⌘ + Enter 在项目对话框中提交」；「新建对话」→「新对话」、
  「打开命令面板」→「搜索 / 命令面板」与全局同名；副标题「键盘快捷键」与标题同义，改「目前只能查看，暂不支持自定义」（规范表同改）。
  被否：B 只删 Tab 行、改两个名字。
- **D5 Mac 只认 ⌘（A）**。全局快捷键原先「⌘ 或 Ctrl」不分平台，Mac 输入框里 Ctrl+K（删到行尾）、Ctrl+N（下一行）被抢去开命令面板、新建
  对话，字号三键同理。现在 Mac 只认 `metaKey`、其他平台只认 `ctrlKey`。这是有意改 Mac 行为（碰「Mac 路径逐字不变」），JC 点头。被否：B 只在
  输入框放行 Ctrl、C 不改。
- **D6 菜单 / 托盘「Report an Issue…」打开设置 → 报告问题（A）**。此前直达 GitHub 模板选择页、不带任何环境信息；Windows 上托盘是唯一的
  系统级入口。Rust 发 `menu:report_issue`，GUI 落「报告问题」页（照「Check for Updates…」的路由）。08-10 的多入口原则不变，只改去向。
  被否：B 维持。
- **D7 环境信息去掉 `deferred_b4`、外置补 GA commit（A）**。`health:` 一行 5 项里典型内置用户有 3 项 `deferred_b4`（「这条命令目前不探测」，
  重构期留下的名字），外置模式反而没有 GA 版本。GUI 拼载荷时过滤这些项（CLI `galley health` 与 Agent API 不变；预览、复制、预填同源，
  「所见即所发」不变），外置且有外置会话 ready 过时加 `ga_commit: <7 位>`（只读已有值）。被否：B 换成模型数 / 渠道状态等、C 不改。

## 直接收口

- **`⌘ + ,` 落「通用」**：键盘分支只开设置，打开的是上次停留的 tab；齿轮、菜单、命令面板都先切「通用」。08-06 已定泛用入口一律落「通用」（[devlog](./2026-08-06-settings-default-tab.md)），键盘分支漏了这一句。
- **报告问题页环境信息换行**：`<pre>` 原先 `overflow-x-auto`，典型用户的 health 行约 835px、框内约 760px，会被裁；改为纯显示换行。
- **更新出错态**：原先按钮行 + 文案 + 手动下载 + 截断的诊断 chip 挤成三行。改为版本行下方独立错误块（标题 = 原因 +「手动下载」，下面是可
  选中、自动换行的等宽原文），形状照 `ChannelErrorBlock`，色调琥珀。对表页这一条写成「改成统一的『复制详情』」，是审计的说法，集成前
  核对代码后更正——前几批统一的是这个错误块形状。
- 顶栏徽标安装阶段写「新版本 · 安装中」（此前一直「下载中」）；后台下载失败不弹提示（下次启动会重新检查），07-15「错误交给 toast」的
  前提从没兑现，改注释与文档承认现状。
- 通用页：开机自启读不到状态时卡内中性提示（此前与「加载中」一样只是灰开关）；通知权限提示在窗口重新聚焦时重查；「回复完成时通知」说明补
  「或等你回答时」（同一开关管 ask_user）；开机自启说明改写避开「），」的空洞；说明行最大宽 460 → 600px。
- 文案：en「Datebase」拼错；「Light now」→「Currently light」；「Conversation font size」→「text size」（菜单名不动）；en 语言选项写自称
  「简体中文」；「Dev 构建」→「开发版」、en 去句号；死键删掉（`updates.checkingShort` 等 7 个、`shortcuts.enterSubmenu`）。
- 关于页：题词中文出处行用无衬线（Newsreader 的破折号不满格，两段「——」中间断开）；两处任意像素换 token；注释漂移。
- `bug-report.yml` 指引改「设置 → 报告问题」一键带环境信息（下拉选项字符串不动）；托盘 / 菜单 / SOP / Windows 清单 / 设计文档同步。
- 菜单栏与托盘本地化补进 deferred（07-15 列为 Open 一直没进台账）。

## 集成时主会话补的

- `check()` 在已就绪时不再重置：从菜单再点「检查更新」会把下好的包作废、重下一遍（改动前就有）。
- 「重启并更新」按钮图标由细线勾换成旋转箭头：说明行已带实心勾，两个勾挨着重复。
- 键帽字形规则补上 ← → ↵：T3 报告 → 也回落 Menlo（JetBrains Mono 子集只有 ↑ ↓）；真机注入两种变体对照，只给 ← → ↵ 换字体与同页的 ↑
  观感一致，四个箭头都换反而 ↑ ↓ 变细。helper 随之改名 `isSymbolGlyph` / `splitSymbolGlyphs`（不再只是修饰键）。
- 注释里的票号字样去掉；`hydrate.ts`、`app_menu.rs` 两处过时注释改正。

## 两种运行模式与宪法

更新与运行模式无关，内置 / 外置零差异；停的是 Galley 自己起的子进程。报告问题页外置模式只多一行 `ga_commit`，读的是 runner 就绪时已有
的值，不新增对外置 GA 的读取（规则 1）。CLI / Agent API 不变（`deferred_b4` 仍是稳定值，只是 GUI 不显示）。T1 改了 Rust，tauri dev 自动
重编并重启了 Core。

## 不做与暂缓

- 不做：外置模式下关于页仍显示内置内核 commit（关于页说 Galley 自带什么，GA 预算不加次数）；⌥↑ 在输入框里有意让给原生编辑；提示音开关
  禁用条件、德文副行对比度、外链箭头离文字远、权限提示框中框（边角或气质票）；英文 tab「Feedback」对页头「Report an Issue」（10-07 有意）；
  版式一句不提 Inter；dev 构建显示发布日期是对的（取 tag `v0.6.1` 的日期，只修了不严谨的注释）。
- 进 deferred：菜单栏与托盘本地化。继续挂着：会话内查找、Composer `/` 快路（落地后快捷键页各加一行）、思考区中文伪斜体。

## 遗留

- 更新流程（后台只下载、渠道照跑、点重启才安装）dev 里走不到，要在 v0.6.2 发版时用旧版各走一遍；Windows 上「下载完不再自己关掉」「点重启后
  安装器接管、没有文件锁弹框」进了冒烟清单。注意：v0.6.1 及更早的安装版自己的更新逻辑还是旧的——从 v0.6.1 升到 v0.6.2 那一次仍按旧流程走，
  新流程从 v0.6.2 升下一版起才生效。
- 通知权限提示在桌面端其实出不来：tauri-plugin-notification 2.3.3 桌面实现把权限写死成 Granted（T3 报告，`desktop.rs:62-67`），对表截图里
  的提示是造假状态；这次加的聚焦重查是防御性的。
- 安装失败时子进程已停，渠道和浏览器桥要等重启才恢复；出错态的「重试」走检查 + 下载，用不上 Core 放回去的那份包。都只在点了重启、安装又失败
  时出现。
- 「有任务在跑」只看 GUI 的消息 store，渠道里发起的运行不算，点「重启并更新」会打断它们（既有行为）。
- 外置 `ga_commit` 要等本次启动后有外置会话 ready 过才有。齿轮按钮 tooltip 里的 ⌘ 不在字形规则里（sans 字体，不受 Menlo 回落影响）。
