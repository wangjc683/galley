# iOS 原生客户端

Status: needs-info（讨论中；待 JC 内部确认 Apple 开发者账号主体）

来源：2026-10-09 与 JC 讨论。起因是 JC 用 Meta Muse（2026-09-08 发布的 iOS agent app）的体验：简洁的 iOS 原生应用 + 动效，手感很好；
而现有 IM 渠道都不是为 agent、为 Galley 做的，达不到原生契合。
上层：[移动端产品定义](../mobile-product/PRD.md)（2026-10-09 第二轮，产品层六问在那里裁；本文只记实现层）。

## 定位

- 手机是人所在的地方，电脑是助理的工作台；桌面 Galley Core 是两端共同的后端，会话和 agent 仍跑在用户电脑上。两端看到的是同一份状态。
  （2026-10-09 第二轮改写，原为「与桌面 GUI 平级的第二个前端」；依据见[移动端产品定义](../mobile-product/PRD.md)「关键场景」。）
- 不走 Agent API / CLI：Agent API 是为 agent 设计的（轮询、Supervisor 身份、写入只有文本、`watch` 无续传、契约冻结），继续只服务 agent。
- v1 以对话为主：首屏就是主聊天（[主聊天 PRD](../main-chat/PRD.md)）；会话列表退到第二层叫「旁聊」，「待你回答」也在第二层。

## 依据

- 架构本来就留了位置：所有命令定义为 `GalleyApi` 方法，各传输方式只是薄包装（`core/src/api.rs:1-8`）；
  PRD 写明前端是 stateless presenter（`docs/PRD.md:141`）；路线图候选里有 mobile thin client 和远程访问层（`docs/PRD.md:581`、`:583`）。
- 事件出口统一是 `Notifier`，约定尽力送达、漏了从数据库重读；10-07 起 turn 行由 Core 自己写（`core/src/notify.rs:15-24`）。
  手机会频繁漏事件，这是它能当前端的前提。
- 「完全同步」还差三处：
  1. GUI 的空闲发送在 TS 里编排：先 `persist_user_message`（`core/src/commands/session.rs:217`，不广播），再拉起 runner、确认回放、
     失败静默重启一次（`gui/src/hooks/useMessageSend.ts:47-94`），spawn 参数也由 GUI 拼（`gui/src/lib/bridge.ts:198-209`）。
     socket 另有一套 Core 版（`core/src/socket_listener/spawn_config.rs`）。先例：运行中排队的发送已完全在 Core 里（`core/src/commands/queue.rs:1-10`）。
  2. 只有非 GUI 发起的写入才广播 `*-external` / `user-message-persisted`（`gui/src/hooks/useExternalCoreEvents.ts`）；GUI 自己的写入只改自己的 store。
  3. `Notifier` 只有 `TauriNotifier` 一个实现。
- IM 证据（`docs/devlog/2026-10-06-im-entry-layer-phone-first.md`）：IM 真实对话是直接干活，委派 0 次。所以 v1 以对话为主，
  推翻 PRD §2「手机上是管理而不是工作」的旧假设（`docs/PRD.md:37`）。
- 来源标记：`Origin.via` 是公开契约的稳定标识集（`docs/agent-api/stability-and-versioning.md:72`）；两张表有 CHECK 约束
  （`core/migrations/006_messages_origin.sql:16-17`、`021_native_session_runtime.sql:34-35`）；`parse_origin_via` 遇到未知值报 Internal 错误
  （`core/src/db/helpers.rs:204-215`），CLI 链接同一份代码并直读数据库（`cli/Cargo.toml:21`）。
- 防睡眠：Galley 目前没有任何防睡眠处理（无 `caffeinate` / `IOPMAssertion` / `SetThreadExecutionState`）。定时任务睡眠期间错过的，
  醒来当天补跑一次（`core/src/scheduler.rs:9-14`），不准点。
- 外置 GA 模式：手机端不服务外置（裁决 18）。远程模块只和 Core 内部打交道，不碰 GA 文件。

## 裁决（JC，2026-10-09）

1. 接受由 Galley 自己负责远程传输，修改宪法 Rule 2。拟议措辞：「Core 永不监听网络；远程访问只经过由桌面向外连接、端到端加密、
   设备配对的远程模块，中转只能看到密文。」落宪法前措辞给 JC 过目。
2. 中转：自建端到端加密 relay，部署在 frankfurt（JC 实测大陆连通正常）。必须有服务器的主因是推送：iOS 后台会断连接，只能走 APNs。
   否决：Tailscale / WireGuard 直连（桌面要开 TCP 监听，撞 Rule 2；推送仍要服务器）；先不做、继续打磨 IM。
3. 客户端：SwiftUI 原生。否决：Tauri 2 mobile 复用 React（手感是网页，原生扩展照样要写 Swift）。
4. v1 以对话为主；首屏就是主聊天（裁决 20）。
5. 从 P0 开始。
6. 远程模块放在 Core 进程内，只向外连接；不做独立 connector 子进程（否则要把 socket 协议扩成完整前端接口，内部接口变半公开契约）。
7. 第 1 步「Core 接管发送 + 所有写入都广播」先单独上线；它本身就是在还 Rule 5 的债，手机端暂停也值得做。
8. 同步范围：
   - 同步 Core 状态：会话列表、消息、运行状态（在跑 / 在问你 / 排队）、标题、置顶、项目、Goal、会话模型、未读。
   - 不同步：当前打开的会话、滚动位置、字号窗口等设备偏好。
   - v1 只在桌面：设置（模型供应商、IM 配置、浏览器控制）。
   - 草稿同步：加分项，P0 不做。
9. 手机来源：`via` 照记 `gui`（含义收窄为「人」），新增可空列 `client`（`desktop` / `ios`，无 CHECK）；桌面默认不显示「从手机发送」。
   P1 配对时再加设备 ID。否决：新增 `via = mobile`（重建表、旧 CLI 读到报错、外部 SOP 可能把手机消息误判为 agent 动作）；
   复用 `gui` 什么都不记（P0 无法统计手机用量）。
10. 防睡眠：
    - 设置 → 通用 →「应用行为」分区加开关「接通电源时保持唤醒」，默认关；屏幕照常熄灭。它同时服务 IM 渠道、定时任务准点和长任务。
    - 配对完成时若未开，提示一次并给「打开」按钮；手机显示「电脑已离线」时顺带说明原因；配对页同时检查「关闭窗口时保持后台运行」。
    - 另加不需要开关的一层：运行中、接着电源时自动不睡。用电池时一律跟随系统；合盖睡眠拦不住，配对页写清楚。
11. 视觉方向：简洁的 iOS 原生应用 + 动效与手感，参照 Muse；**设计风格与 Galley Desktop 统一**，同一个会话在两端之间切换要无缝衔接，
    双向都是。
12. 最低支持 iOS 26。
13. 视觉分层：内容层（对话区）与桌面一致，包括字体（Newsreader / Inter / JetBrains Mono 打进 app，中文苹方）、Phosphor Thin 图标、
    颜色 token、组件与行为、文案；外壳（导航、手势、面板、系统控件）用 iOS 原生，套 Galley 的颜色和图标。依据「content 是纸、chrome 是材质」
    （`docs/design/conversation.md:34`）。JC 附加：内容层要为手机屏幕的体验做优化和调整，不是逐像素照搬。
14. 颜色 token 和文案用脚本从桌面源文件（`gui/src/styles/globals.css`、`gui/src/i18n/locales/zh.ts` / `en.ts`）生成，CI 检查生成结果是否最新；
    iOS 设计规范另开 `docs/design/ios.md`，只写照搬与改动，照搬部分链接回桌面原条。
15. 手机屏幕调整：照搬规则和比例，不照搬像素。正文跟 iOS 动态字体（默认 17pt），其余字号按桌面比例推算；满宽 + iOS 标准边距；
    代码块、表格横向滑动；工具步骤条一行截断、点开看全；提交后贴顶的偏移按导航栏重定；悬停操作改长按；Question Rail v1 不做。
    字号比例、用户气泡是否限宽两项上真机变体比。
16. 对话区渲染：Swift 原生解析与绘制，配一致性语料（桌面工具链产出标准答案，CI 逐条对比 Swift 解析结果）；P0 不做代码高亮。
    否决：对话区嵌 WKWebView 复用桌面组件（手感）；桌面预解析成内容块下发（解析只能在 Core，Rust 里仍是第二个家）。
17. 通知（P0）：
    - 路由：手机永远收；桌面在主窗口开着时照今天的规则收（聚焦弹 toast、不聚焦弹系统通知）；主窗口关掉、隐藏到菜单栏（后台运行模式）
      **且已配对手机**时，桌面不弹。最小化、⌘H 不算后台。不推断「人在不在电脑前」（JC：过于复杂且不准）。
    - Core 判断「需要关注」：四类事件（回复完成、在问你、Goal 结束或需要介入、定时任务失败）；「回复完成」按这一轮由人发起
      （`via = gui`，不论哪端），agent 发起的轮次归 IM 汇报（`runner/im_reporter.py:12-17` 同一规矩）。桌面系统通知改为接收 Core 的判断。
    - 沿用桌面两个通知开关，P0 不加手机专属开关。推送内容 P0 就加密（预共享密钥，通知服务扩展解密）。
    - P0 交互只做「点开进入会话」；打开 app 时清掉已读会话留在通知中心的通知。
    - P1：通知上回复、「在问你」时效性级别、角标、一端读了即撤另一端（不打开 app 也撤）、Live Activity。
    - 人在电脑前一直用时手机照响，但未读与「在问你」都是 Core 状态（`has_unread`，`core/migrations/002_add_has_unread.sql`），
      打开手机 app 不会有待处理的内容；P0 唯一残留是锁屏 / 通知中心里已弹出的通知，打开 app 即清。
    - 例外（随裁决 20）：主聊天里的主动建议卡片和旁聊 / 子会话完成不是人发起的，也要通知（主聊天 PRD 裁决 9、10）。
18. 移动端只服务内置 GA 用户；Galley 后续主力开发也在内置方向。手机只显示内置会话，不随桌面当前运行时切换
    （Core 本来支持跨运行时操作内置会话，`docs/agent-api/session-commands.md:499`）；手机发图不需要图片能力闸门（内置恒支持，补丁 0008）。
19. IM 渠道留给偏好 IM 或有群聊需求的用户；手机上的主力入口引导到原生 App。
20. 主聊天做成 Galley 的一等会话，桌面和手机都有，只在内置内核；先零成本试用一周再定形态。详见 [主聊天 PRD](../main-chat/PRD.md)。
21. Supervisor 分三层处理（本机 `workbench.db` 161 个会话中 CLI / supervisor 建的 42 个，带标签的几乎全是试用和测试；社区 galley#29 / #30 作者在用）：
    - 退：「人在外面 → IM → Supervisor → CLI → Galley」的远程叙事（`docs/PRD.md:41-45`、§4.2），随票 01 改写。
    - 降：设置 Agent 页的「复制 Supervisor SOP」与 SOP 文档改为「让其他 Agent 操作 Galley」，面向高级用户；不急（见 deferred）。
    - 留：CLI 与 Agent API 契约（Rule 3）；IM 汇报、IM 委派、galley-supervisor skill 和社区用户都靠它。
    - SOP 在内部退场的时机：主聊天派活改用内置原生工具（主聊天 PRD 裁决 5），IM 委派随之换过去。
22. 仓库布局（2026-10-10）：iOS App 与 relay 的源码都进 galley 单仓（`ios/`、`relay/`，外加 Core 与 relay 共用的协议 crate），iOS 端随仓以 MIT 开源。
    依据：裁决 14、16 要求 CI 在同一提交里核对桌面源文件生成的 token / 文案与一致性语料；手机协议三方（Core、relay、iOS）要能原子改动，
    照 `scripts/check-ipc-protocol-drift.mjs` 的先例加漂移门禁；端到端加密的承诺要客户端与 relay 都开源才可审计。
    否决：iOS 单独私有仓（token、语料、协议都要跨仓同步）；relay 与 iOS 各自独立仓。
23. relay 的部署（Caddy 站点文件、服务定义、DNS 子域、APNs 密钥在哪取）归 inkstone-ops（私有）；galley 只放 relay 源码并由 CI 出构建产物。
    这是 inkstone-ops「租户部署归租户仓」的例外，理由是 galley 是公开仓，部署细节属于砚石的实例而不是产品；类比网站：内容在站点仓，托管在 inkstone-ops。
24. 远程协议设计稿（2026-10-10，[issues/05](./issues/05-remote-protocol-design.md) 第 12 节）：P0 握手用 `NNpsk0` 一把配对主密钥，P1 再升 `XXpsk3` + `KK`；
    通知显示真实内容（会话标题加回复摘要或「在问你：问题」），推送端到端加密；票 03 与 02e 的「轮次落库广播」并入 05。
    relay 域名不是产品决策：手机从二维码拿地址，桌面编译期注入，用户不接触。手机这头的 Noise 用 CryptoKit 自己写，两侧跑同一套测试向量。

## 待定

- Apple 开发者账号的主体与持有人（JC 内部确认中）。推荐砚石科技组织账号、尽早启动（需邓白氏编码，审核无官方时长）。
  P0 起就要付费账号：推送只对付费会员开放，免费账号装机 7 天过期。账号不卡第 1 步。
- 内容层 Markdown 渲染的依据（裁决见 16）：桌面链：`react-markdown` + `remark-gfm` + `remark-cjk-friendly` + `remark-breaks`
  + Shiki（`gui/src/components/conversation/MarkdownView.tsx:164-169`、`CodeBlock.tsx:48-49`）。实测 `workbench.db` 2147 条不重复的回复文本中，
  635 条含加粗 / 强调，其中 39 条在标准 GFM（不带中文规则）下渲染结果不同，典型为 `**…"…"**一样`：收尾的 `**` 前是标点、后面紧跟汉字。
  脚本：`tools/export-reply-corpus.py` 导出语料（只读；含真实对话，不进 git），`node tools/md-cjk-diff.mjs <语料> gui` 对比。
- P1 安全：Face ID 解锁、桌面确认配对、一键吊销设备、端到端加密配对（P0 只 JC 自用，用预共享密钥）。
- 手机协议的版本握手规则（只加不删，对不上提示升级哪一端）。
- 浏览器任务要人介入：研究已做（[mobile-product/issues/01](../mobile-product/issues/01-browser-intervention.md)），缺口只有「带图的提问」，方案 A / B 待裁；派活后手机上看什么进度仍待定。

## 票（P0）

| # | 内容 | 依赖 | 状态 |
|---|---|---|---|
| 01 | 宪法 Rule 2 修订，同步 `docs/PRD.md` §4.2 与 §6.2 非目标、`docs/architecture.md` Localhost Only 一节；顺带改写 PRD §2 / §4.2 的远程叙事与 IM 定位（裁决 19、21），并把 §2 第 3 条「手机上是管理」换成[移动端产品定义](../mobile-product/PRD.md)的定位与核心价值。[措辞稿](./issues/01-rule2-and-prd-rewrite.md) | — | done（`0d59f9a7`、`18f7fe51`） |
| 02 | Core 接管发送 + 所有写入都广播，拆为 02a–02e（02e 暂缓到 P1），见 [issues/02](./issues/02-core-send-takeover.md) | — | done 2026-10-10（02a–02d；02e 暂缓到 P1） |
| 03 | `client` 列迁移（`messages`、`sessions`；补六处手写迁移列表） | — | done（并入 05c，`01d67d44`） |
| 04 | 保持唤醒开关 | 待定细节 | open |
| 05 | `Notifier` 扇出 + Core 内远程模块（向外 WSS，预共享密钥）；协议设计稿见 [issues/05](./issues/05-remote-protocol-design.md) | 02 | 设计已全部裁定（裁决 24）；拆为 05a–05d，05a、05c 已合入（2026-10-10） |
| 06 | frankfurt 最小 relay + APNs 推送（做完了 / 在问你）；设计同 [issues/05](./issues/05-remote-protocol-design.md) | Apple 账号（只挡推送） | 设计已全部裁定（裁决 24）；拆为 06a–06c，06a 已合入（2026-10-10） |
| 07 | SwiftUI P0：主聊天、旁聊列表、回答提问（约七个方法：列会话、读消息、订阅事件、发送、停止、新建会话、标已读）；回答提问要支持候选项含多选、问题上方一张图（issues/01）；其中 Swift 协议包 07a 没有界面，先做（[issues/05](./issues/05-remote-protocol-design.md) 第 13 节） | 05、06（07a 只依赖 05a） | open |
| 08 | Core 通知判断（「需要关注」事件）+ 桌面系统通知改为接收 + 后台模式且已配对时桌面静默 | 02c | open |
| 09 | 带图的提问（已裁 A 约定式）：提示词条款（登录墙 / 扫码 / 图形验证码时截图 + Markdown 图片引用）+ Core 从问题抽本地图片经远程模块送手机 + 桌面真机验 `AskUserBubble` 显示图；渲染验不过再转 B（[mobile-product/issues/01](../mobile-product/issues/01-browser-intervention.md)） | 05 | open |

## P0 要回答的问题

JC 用原生端是否比用 IM 多。手机端用户轮次按 `client = ios` 从 `workbench.db` 统计；IM 对话不在库里，要看引擎日志 `model_responses`。

## 风险

- 安全：配对后丢手机等于别人能在电脑上远程执行任意代码（审批 10-05 已移除）。
- 运维：relay 是全天候生产服务，JC 是唯一运维；保持无状态、无数据库。
- 构建机：JC 的 Mac 是 Intel，目前只装了 Command Line Tools、没有 Xcode；macOS 15.8.1 可以装 Xcode 26。macOS Tahoe 26 是最后支持 Intel 的版本，
  中期要换 Apple 芯片或用云端 CI。
- 上架中国区要做 App 备案，AI 类 app 是否另有要求未核实。
- 专用机场景（北极星里的 24 小时 Mac mini）下「设置只在桌面」（裁决 8）会别扭，见 deferred「专用机的远程设置」；P0 不解决。

## Comments
