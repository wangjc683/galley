# Settings 逐页第二段·聊天软件批：四卡同一套视图、徽标按绑定统一、命令表同表、Telegram token 脱敏

Date: 2026-10-08
Status: 实现完成，门禁全绿（typecheck / lint / vitest 804 / pytest 504 / mypy / ruff / cargo 597 / IPC 漂移 / diff check）；dev 窗口里按真实运行态与 10 个假状态截图对表；JC 真机验收 OK（暂停 / 恢复、重启全部渠道、微信 `/help` `/status` 是否实测未单独回报）
Related: [浏览器控制批](./2026-10-08-settings-browser-control-tab-pass.md)、[运行环境与智能体接入批](./2026-10-08-settings-runtime-agent-tab-pass.md)、
[模型批](./2026-10-08-settings-models-tab-pass.md)、[overlays-and-settings §9 Channels](../design/overlays-and-settings.md)、
[layout-and-chrome Channels Indicator](../design/layout-and-chrome.md)、[copy-language-guidelines](../copy-language-guidelines.md)（`Channels` 一行、聊天软件正文一行）、
[08-13 自动展开判据](./2026-08-13-channels-auto-expand-predicate.md)、[09-30 重启接回上下文](./2026-09-30-im-restart-continuity.md)、
[10-06 IM 入口层](./2026-10-06-im-entry-layer-phone-first.md)

## 做法

同前三批。不同处：这一页的渠道状态存在组件本地（`useImSupervisorStatus`），没法改内存 store 造假状态；`window.__TAURI_INTERNALS__.invoke`
不可写也不可重定义（WKWebView 下是只读、不可配置属性），最后在 `lib/im-supervisor.ts` 外包一层临时 dev 钩子，只换 `get_*` 的返回，钩子挂着时
其他 IM 命令一律拒绝，截完 `git checkout` 还原（实现前后各装一次）。审计派一个 Opus 子代理通看四张卡（不按渠道拆，头号维度是跨渠道一致性，
区分「平台差异」与「文案 / 结构漂移」）：48 条历史裁决、28 维跨渠道对照（15 项判为漂移）、33 条候选、4 条 bug。实现两张 Opus 票并行：票 1 runner 与 Core，
票 2 四张卡、共享组件、顶栏与本页文案——本批只有票 2 碰 locale，中文定稿写死在票面里由它照抄，没有走「主会话先改 locale」（只有一张 GUI 票，
不存在 locale 冲突）。0 返工。

## 第 0 节：Telegram 的 Bot Token 明文

token 被 Telegram 拒绝时，python-telegram-bot 的 `InvalidToken` 原文是「The token `<完整 token>` was rejected by the server.」（`telegram/_bot.py:868`），
内置 `tgapp.py` 把它拼进渠道状态并打印进日志，于是完整 token 出现在设置页错误块、顶栏菜单和 `telegram.log`。修法零补丁：runner 从注入的
配置环境变量里收集飞书 / Telegram / Discord 的密钥（不到 8 个字符的不收），状态行（`_emit`）与日志（`_redirect_logs` 换成包装 writer，`sys.stdout`、
`sys.stderr` 和两个 `__` 版本都指向它）写出前换成「…末 4 位」；微信 token 在读到和扫码成功后收进脱敏表。票 1 查出 Core 的 `read_stderr` 会把子进程
原始 stderr 直接写成 `lastError`、完全绕过 runner（重定向前的报错、解释器致命错误走这里），Core 侧用它自己注入的配置再遮一道。逐条核对过 logging：
四个前端都不加 handler，lark_oapi 的 handler 在重定向之后才建，PTB / httpx 走 `lastResort`（每次现查 `sys.stderr`），仍加了一步把旧 stream 上的 handler
换到 writer 的保险。JC 本机的 `telegram.log` 查过（只数行、不打印）：没有「rejected by the server」，无历史泄露，不用轮换。

## 裁决（JC 全部按推荐）

- **D1 四卡统一「已配置」视图（A）**。Telegram / Discord 的步骤只按「运行中 / 其他」二分，飞书非运行一律是 6 节指南：配好的渠道一出错、暂停、
  重连就整张退回新手引导，错误详情压在安全说明下；暂停后徽标「未启动」、提示「Bot Token 已保存。点击启动服务即可接入。」，恢复按钮叫「启动 X 服务」，
  与菜单「暂停接收」不成对。现在判据是「已绑定使用者」（微信 = 有登录 token）：设置好后非运行的卡是状态提示 → 错误详情 → 一颗主按钮（恢复接收 / 重试 /
  处理中…）→ 一行列表折叠收起表单与教程；暂停是「已暂停 / 已暂停接收{平台}消息。」。判据与视图写成共享纯函数 `im/channel-view.ts`，卡片与顶栏共用。
  被否：B 只挪错误块、改暂停口吻。
- **D2 徽标按绑定统一（A）**。微信「已接入」，另三张「服务已启动」，顶栏四个都「已接入」还自称与卡片同词。飞书的「服务已启动」有平台理由：服务
  起来时开放平台的长连接、事件、发布还没配完，教程第 3 节拿这几个字当路标；Telegram / Discord 一进运行就是真接上了，是照飞书抄的
  （`eefa96f3`、`9b13a1ed`）。现在运行中且已绑定一律「已接入」，飞书未绑定保留「服务已启动」，顶栏同一个函数出词；JC 的三个渠道都变成「已接入」。
  等待扫码的卡片徽标改 warning，与顶栏琥珀一致。被否：B 四卡一律「已接入」（飞书未配完时词义撒谎）、C 只改注释。
- **D3 命令表四卡同表（B）**。飞书 / Telegram / Discord 三个前端真实命令集完全相同（`/help /status /stop /new /restore /continue [n] /btw /review /llm [n]`），
  表却是 10 / 4 / 6 行。核心表 `/new /stop /status /llm /llm n /help`，Telegram 的 `/llm` 写「查看并切换模型」（按钮菜单，平台差异），Discord 前面保留
  「@机器人」「退出频道」。推荐的是 B 而不是「微信保留子集」：JC 两次否过我「按用量 / 验证成本让某渠道先不跟」的推荐，补两条命令只是 runner 里几行。
  微信的 `/help` `/status` 在 runner 的 `_managed_wechat_on_message` 里拦截（与 09-30 补 `/new` 同法，零补丁，放在 resume 判断之前）。`/continue` `/restore`
  不进表：09-30 起重启自动接回上下文，它们的价值下降，`/help` 里能查到。
- **D4 中文统一叫「渠道」（A）**。同一模块四个名字：页头「聊天软件」、按钮「重启 Channels」、横幅「Channels 正在…」、toast 单数「Channel」、通用页「渠道」。
  设置页正文、按钮、确认框、toast、首次关闭弹窗、通用页改「渠道」（「重启全部渠道」），顶栏徽标 / tooltip / 菜单项仍按规范保留 `Channels`（短标签、不与
  「聊天软件」同屏；顶栏菜单项独立出 `topbar.channelsPopover.restart`）。不用「聊天软件」做宾语：「重启聊天软件」读作重启微信本身。被否：B 顶栏也改、C 维持。
- **D5 飞书首次配置不过早折叠（A）**。一点「启动飞书服务」，6 节指南就收进折叠、提示还说「即可使用」，而第 4–6 节正是这时要做的。现在运行中但还没绑定
  时指南保持展开，提示「服务已启动。回到飞书开放平台完成第 4–6 节…」；配对成功本身证明长连接、事件、权限、发布都通了，之后才折叠（06-18「运行中折叠」
  细化成「已绑定后折叠」）。被否：B 只改提示。
- **D6 安全说明一个模板（A）**。三种措辞（飞书带群聊、Telegram 没带——可它同样能进群、Discord 是 Server）收成一句 + 平台插槽，Discord 两条附加声明不动。
  微信不加，显式代价写进设计文档：没有绑定机制，谁能给 iLink 机器人发消息未核实，不写没把握的承诺。被否：B 只给 Telegram 补半句。
- **D7 去掉「凭证」（A）**。照 10-08 模型批：保存按钮只写「保存」，节标题「Galley 设置 · 填入 App ID 和 App Secret」，提示「App Secret 已保存…」；zh 里已无
  「凭证 / 凭据」。被否：B「保存密钥」、C 渠道页例外。
- **D8 错误按原因说人话（A）**。GUI 按原文归类出本地化标题（token 无效、没开 MESSAGE CONTENT INTENT、连不上、二维码过期、内核组件缺失、另一个 Galley 在跑），
  原文等宽放在下面，匹配不上用泛提示；`im/channel-error.ts` 四卡与重启 toast 共用。没像浏览器控制批那样加机器字段：那次的原文出自 Galley 自己的探测脚本，
  这次出自上游前端，加字段要改三个渠道的补丁（宪法第 1 条）；代价是上游改措辞时掉回泛提示（不会显示错）。飞书的匹配规则按 lark-oapi 常量与常见错误码
  推出来，没对过真实返回。被否：B Core 加 `errorKind`。
- **D9 微信完成汇报（A，进 deferred）**。飞书 / Telegram / Discord 有任务完成汇报，微信没有，08-13 只写了「历史遗留，不是范本」。这批不做，台账里写明显式
  代价（微信用户委派的任务做完不会收到消息）与启动信号。被否：B 这批一起做。

## 直接收口

- **三个 bug**：启用中但没在运行的渠道停不下来（正在重连 / 接入 / 等扫码没有 ⋯，出错时 ⋯ 里只有删凭据、清绑定的「解除接入」，开机每次自动重试再报错）——
  「暂停接收」在任何启用态都有（Core 的停止本来不看状态）；报错态下保存新 token 后卡片把状态置空、显示「未启动」，顶栏仍「需处理」，重进设置又回到「异常」——
  保存后重读一次 Core 状态；「解除接入」确认文案不全（飞书说「要再粘贴 App Secret」，实际 App ID、绑定、接回的对话都清掉）——一个模板四卡套用，写全删什么。
- **重启全部渠道逐个进行**（票 1）：此前循环里遇到第一个失败就整体返回，后面的不重启，GUI 只拿到一条英文。现在单渠道失败把该槽位记成「异常」（此前 `start_inner`
  失败不写槽位，旧状态一直留到旧进程退出变成「process exited with signal 9」），继续下一个；只有共用步骤（内核上下文、SOP 副本、Python 路径）失败才整体
  报错。返回类型不变，toast 按结果写全成功 / 部分失败（列平台 + 原因）/ 失败。
- 运行中三步说明：微信、Telegram 的第 1 步与状态提示同义重复，删掉，运行态只留状态 + 命令表（与飞书一致）；Discord 的三步讲激活语义，保留。
- 微信等待扫码时「扫码完成接入」说三遍，去掉重复的状态提示；飞书已绑定时 App ID 框下提示「换应用会解绑当前使用者，需要重新配对」；绑定时间改用 app 的日期格式
  （新 `formatMessageDateTime`，不带秒，此前是系统区域的 `toLocaleString`）；步骤里的 `/newbot`、`MESSAGE CONTENT INTENT` 等用反引号渲染成 code（复用
  `InlineCodeText`，没另造占位语法）。
- 视觉：飞书「查看配置步骤」换成 `SettingsDisclosureList` 行（此前手写折叠，不在 10-07 两种之内）并修掉悬空缩进；「复制全部」换 ghost `Button`（汉字不小于 11.5px）；
  绑定行对勾实心；inline code 样式统一到一个常量；顶栏重启确认图标补 thin、错误行 `leading-snug` 换 token。配对码 `text-[15px]` 保留（没有等值 token，已加注释）。
- 英文小漂移统一；死文案键与随改动废弃的键删除（四份旧命令数组、三平台各一份内容相同的绑定 / 保存 / 安全说明键合并成共享键）；模型 toast 里「外置下渠道
  跑外部 GA」的错误注释改正；Windows 冒烟清单侧栏标签的旧写法改正。

## 两种运行模式与首装

整页只在内置模式；渠道只跑在内置内核上，外置零变化（外置下渠道照常在跑、界面看不到，是 05-29 有意裁决，没动）。推荐方案全部零补丁。首装没有渠道步骤，零影响。
票 1 改了 Rust，tauri dev 在 14:38 自动重编并重启 Core，JC 的三个渠道随之重新拉起（runner 新代码就此生效）。

## 不做与暂缓

- 不做：飞书「打开飞书开放平台」独立按钮改行内链接（飞书第 1 节 4 条，按钮挂节尾合理）；没有可用模型时页内能暂停渠道（要删掉最后一个模型才出现）。
- 维持暂缓：已暂停折叠头「启动」按钮、展开态跨进出记忆、Discord 原生斜杠命令、渠道外壳多语言。
- 进 deferred：微信完成汇报（D9）。Q1（Discord 中文客户端是否把 Server 叫「服务器」）JC 没答，维持「Server」。

## 遗留

- 各渠道的 `/help` 回复仍不一样：微信是 runner 写的六条（全角冒号），飞书 / Telegram / Discord 是上游 `HELP_COMMANDS` 的完整表（半角冒号）。统一要动上游文本
  （改补丁），与 deferred「渠道外壳多语言」的待定项重叠，没碰。
- 微信 `/new` 在重启接回没建立起来（resume 为空）时仍原样转给上游、被当成一条任务；微信 `/stop` 不回执（其他渠道回「⏹️ 正在停止...」）。两条都是既有行为。
- 微信从「接入微信」点到出二维码之间，按判据会短暂显示「处理中…」、步骤消失。
- 顶栏 Channels 菜单的错误行仍显示原文，没走 D8 的原因标题（与浏览器控制批顶栏保留原文同口径）。
- 脱敏没覆盖：子进程直接继承 fd 写日志或 Core 的 stderr 管道时的微信 token（Core 不知道它）、往 `sys.stdout.buffer` 写字节、密钥被拆成两次 write。
- 部分失败 toast 与微信 `/help` `/status` 需要真机：前者要一个渠道真的起不来，后者要扫码。
