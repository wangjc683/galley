# Settings 逐页第二段·运行环境与智能体接入批：外部 Python 泄漏、版本卡只认外部、Esc 先让输入框、命令面板删死入口

Date: 2026-10-08
Status: 实现完成，门禁全绿（typecheck / lint / vitest 725 / diff check）；JC 真机验收回 OK。可选的 Health Check 往返（会发一次真实模型请求）、外部 Python 修复的打包版效果（dev 下本来就用外部 Python）、Windows 的 CLI 目录显示未单独回报
Related: [模型批](./2026-10-08-settings-models-tab-pass.md)（第二段第一批）、[10-07 Settings 横切](./2026-10-07-settings-cross-tab-pass.md)、
[overlays-and-settings §8 / §9 Runtime / §9 Agent](../design/overlays-and-settings.md)、
[copy-language-guidelines](../copy-language-guidelines.md)（运行环境副标题、SOP 名字、智能体接入正文三行）、
[07-21 运行环境瘦身](./2026-07-21-runtime-tab-slimdown.md)、[05-27 Supervisor 面向用户的文案](./2026-05-27-supervisor-user-facing-copy.md)、
[06-04 打包 Python 契约](./2026-06-04-bundled-python-runtime-contract.md)

## 做法

与模型批同一套：tauri dev 真机截图（内置模式、中文、浅色；运行环境主页 / 接入外部 GA 展开 / 高级诊断 / 设置向导，
智能体接入主页 / 高级选项），一个 Opus 子代理做代码审计（45 条历史裁决、32 条候选），主会话复读关键行后出本地
对表页：第 0 节一条真 bug、7 个裁决点、15 条直接收口。实现时主会话先改 zh / en 文案契约，再按文件域派两张
Opus 票并行（票 1 运行环境：`SettingsRuntime.tsx`、`runtime/`、共用切换动作、`bridge.ts`、`Settings.tsx` 的 Esc、
命令面板；票 2 智能体接入：`SettingsIntegration.tsx` 与命令安装错误映射），都不碰 locale。0 返工。

## 第 0 节：打包版里「使用外部 Python」泄漏进内置内核

开关放在「接入外部 GA」里，看起来只管外部 GA；但 GUI 起对话时把整份 `gaConfig` 交给 `spawnBridge`，`bridge.ts`
只按 `PROD && !useExternalPython` 决定用不用打包 Python，不看运行模式，Core 的内置准备也不改 python。CLI / socket
路径在内置模式下强制打包 Python（`spawn_config.rs`）。后果：打包版一旦打开这个开关，GUI 起的内置对话改用系统
`python3`，缺依赖起不来，同一个内置内核 GUI 与 CLI 用两个解释器——06-04「内置发布版必须用打包 Python」那条。dev 下
一直用外部 Python，真机看不出；JC 库里开关是关的，没中招。修法：抽出纯函数 `shouldUseBundledPython`，内置模式
无视 `useExternalPython`，与 socket 路径对齐，单测覆盖四种组合。外置模式零变化。

## 裁决（D2 JC 选 B，其余按推荐）

- **D1 版本卡只认外部 GA 的数据（B）**。卡上的「当前版本」来自最近一次对话启动时 runner 报的提交，内置对话也写它，
  首帧还是打包时的内核清单值，所以内置模式下它显示的是内核自己的版本、永远「已对齐」（JC 外部 checkout 恰好也是
  `f308ee7`，看不出错）；刚切到外置、还没起过对话时也还是内核的值。现在 `ready` 只在外部对话里写 `gaCommit`，并带
  `gaCommitRuntimeKind: "external"`，卡片只在这个标记存在时渲染。内核版本在高级诊断里本来就有。被否：A 内置模式下
  换成一行「开始一次外部对话后显示」。关于页的内核行用的是 `managedRuntime.upstreamCommit`，不受影响。
- **D2 命令面板两个死入口删掉（B）**。「跑一次 Health Check」「切换 GA 路径」从 Stage 2 起只打日志，选了面板关掉、
  什么都不发生。推荐的是 A（接上现成动作），JC 选 B：设置页已有入口，面板少两项。`App.tsx` 的两个回调与
  `CommandPalette` 的两个 prop、两条文案一起删。
- **D3 Esc 先让给输入框（A）**。外部 GA 路径框写了「Esc 还原草稿」，但 Radix Dialog 在捕获阶段先处理 Esc，整个设置
  直接关了，那段代码走不到；模型页的输入框同样一按 Esc 就关设置。现在焦点在设置内的可编辑文本框时，第一下 Esc
  只离开输入框（路径框照自己的规则还原草稿），第二下才关设置；输入法组字中的 Esc 不处理。全设置页生效。deferred
  「离开确认」那条的待定项结掉一半，离开确认本身继续暂缓。被否：B 维持现状、删死代码。
- **D4 「外部 GA 已可用」要先验路径（B）**。此前只看路径字符串非空，目录被删或移走仍显示可用、「切换到外部 GA」
  可点；顶栏判据还多要求 Python 非空，两处不一致。现在展开时跑一次现成的只读路径校验：通过前中性的「已设置路径」，
  通过后「外部 GA 已可用」，路径不存在时黄色提示并禁用切换；缺 `agentmain.py` 当中性（留给 Health Check 说）。顶栏
  `isExternalGAConfigured` 去掉 Python 条件，与设置页同口径。被否：A 只把文案改成不承诺的「已设置路径」。
- **D5 Windows 命令行快捷入口（B）**。此前只有一句「Windows 一键安装命令稍后支持」。05-15 计划过写用户级 PATH，
  但从没进台账；社区 #30 正卡在 Windows 的 CLI 版本上。现在进 deferred，同时把承诺换成手动办法：显示「可以把这个
  目录加入 PATH：」+ CLI 所在目录（读 CLI 路径文件里那一行）。SOP 不依赖 PATH（05-21 定），这只是给人用终端的出口。
- **D6 用词四条**。a SOP 名字中文 UI 一律「Supervisor SOP」（节标题、顶栏 tooltip 早已是短名，正文还有四处
  「Galley Supervisor SOP」，设计文档写过「Galley Agent SOP」；05-27「只用一个名字」在中文里落成短名），英文 UI
  保留长名，被复制的文档本身不改名；b 智能体接入正文与例句里的 session / Project / repo 写「对话 / 项目 / 仓库」，
  例句也改（Agent 拿到 SOP 后能对上），`Goal` 保留；c `Discovery file` 写「CLI 路径文件」（说清装的是什么）；d 运行
  环境副标题从与标题同义的「Galley 的运行环境」改为「选择用哪个内核运行，排查运行问题」，仍守 07-03「内置语境不出现
  GA」。
- **D7 复制 SOP 后不显示「接上了没有」（B，进 deferred）**。JC 库里由 Agent 创建的对话 20 个、CLI 22 个，这页都
  看不到；但 05-27 定过这页保持稀疏，也没有人问过「SOP 生效了吗」。被否：A 页内一行「最近 7 天有 N 个对话由 Agent
  创建」。

## 直接收口（不需裁决）

- **设置向导切运行模式走设置页的切换流程**。从向导完成「使用已有 GenericAgent」（内置 → 外置），或外置下走完模型步骤，
  运行模式变了，但侧栏会话列表不按新模式重载、不弹切换 toast、不清待用的模型选择，列表与实际模式不一致到重启为止。
  「切换运行模式」抽成共用动作 `switchRuntimeKind`（写偏好、清待用模型 / 项目筛选 / 当前会话、回空状态、重载、toast），
  设置页与向导共用；首装仍直接写偏好（没有旧会话，不弹 toast）。主会话集成时补了一处：向导完成接入时原来先弹
  「已保存路径配置」再弹「已切换到外部 GA」，`setGAConfig` 加 `toast: false` 选项，向导里切换紧跟保存时只留切换那条。
- **路径框打完直接点按钮用的是旧路径**：与模型批数字框同因（`Button` 按下不夺焦），草稿存在时在字段外按下鼠标先提交
  （「选择」按钮已有的防提交保留）。票 1 实现时自己抓到两处：Esc 原本会先触发 blur 提交、把要还原的草稿存进去
  （`revertingRef`），按下提交后 blur 再提交一次（`committingRef`）。
- **保存 toast 按运行模式分口径**：内置激活时改外部路径或 Python，正文「切换到外部 GA 后生效」（此前「重启 Galley 才能
  让现有对话生效」，可现有对话全是内置的）；Python 开关的标题「已保存 Python 设置」（此前「已保存路径配置」）。模型批
  外置模型 toast 的对称修正。
- 「复制 SOP」后按钮永久「已复制」，改为与例句、「复制详情」一样 1.5 秒复位，右侧「可以发给 Agent 了」保留。
- Health Check 跑完「返回设置」时「接入外部 GA」保持展开（`external-access-intent`，内置模式下手风琴重新挂载时是收起的）。
- 命令安装失败显示 Rust 原始英文（`osascript reported failure…`），找不到 CLI 时叫用户「重启 pnpm tauri dev」——按原因映射
  中文，原文留在「复制详情」，找不到 CLI 分 dev / 打包两句。错误映射抽成 `path-install.ts`（带单测）。
- 高级诊断英文标签（Patch stack / Code / Prompts / Memory / SOP / State / Config file）改中文，值带量词（「27 个补丁」
  「7 个模型」「缺 2 个关键文件」）；说明句「凭据」「API Key」按 10-08 用词规则改「密钥」。
- 「运行时 / 运行模式」「任务 / 对话」混用：两句禁用原因统一为「有对话正在运行，…」。
- 外部 Python 提示指向不存在的「Re-run」，改指真实按钮「跑一次 Health Check」；版本卡「unknown」改「未知」；兼容提示
  「下次启动时会自动检查并报告」没有实现（中英文都搜过），改为不承诺的「…遇到异常先跑一次 Health Check」。
- 智能体接入小文案：`galley` 用 inline code（新 `InlineCodeText`，样式取飞书引导的 inline code）；「等鉴权…」统一为
  「等待系统授权…」；「包括 schemaVersion。」补成整句；例句 aria 分隔符按界面语言；SOP 读取失败单列一句、不再说
  「复制失败」。
- 「查看 Agent API 文档」直接指向 `docs/agent-api/README.md`（此前是 07-04 拆分后留下的 20 行跳转页）。
- 外部 GA 激活时手风琴标题从动作短语「接入外部 GA」换成名词「外部 GA」；缺 `agentmain.py` 的提示改陈述句。
- 视觉：外部 Python 只读路径从带框输入框改 mono 纯文本（「只读展示不带框」）；手风琴四条说明统一字号；「外部 GA 已可用」
  降到与内置卡 detail 同级；版本卡两行等大、中文标签不走等宽；三处 `leading-[…]` 字面量换 token；路径框补输入过渡；
  设置向导禁用时只压暗标题和箭头、原因照常可读。
- 死文案键共删 7 个（含 D2 的两条命令；两张票各报告两个，主会话集成时删）；两份设计文档的过时路径
  （「Settings → Runtime → More」「设置 → 集成」）顺手改。

## 两种运行模式与首装

第 0 节只影响打包版的内置模式（改回打包 Python）；D1、D4 与外部 GA 标题只动外部 GA 区；保存 toast 按模式分口径；其余
两种模式一致。首装：`switchRuntimeKind` 与 Health Check 返回动的是设置向导共用的 `useOnboardingFlow`，首装分支
（`mode === "fresh"`）仍直接写偏好、不弹切换 toast，保存 toast 也保持原样。

## 不做与暂缓

- 不做：「选择」按钮 md 尺寸（与输入框等高，有意）；运行环境页单薄（07-21 瘦身后裁过「接受单薄」）。
- 维持：内置内核自检入口、内核数据目录 Finder 按钮（07-21「做记忆管理时再议」）。
- 进 deferred：Windows 上一键安装 `galley` 命令（D5）、复制 SOP 之后显示「接上了没有」（D7）。

## 遗留

- `onChangeBridgePython` 一串参数在外部 Python 改成只读文本后已无调用方传值，没顺手拆。
- 顶栏「外部 GA 可用」只看路径字符串，没有设置页那样的异步校验（顶栏没有展开时机可挂）。
- 路径框的按下提交是异步的：理论上在保存落盘前点到「跑一次 Health Check」仍可能读到旧值，没复现过。
- `check_path_install_status` 自身失败时仍显示原始英文（只映射了安装 / 移除 / 授权三条）；例句复制失败是静默的。
- 英文 UI 的「CLI 路径文件」仍叫 `Discovery file`（英文术语本身没问题，只是与中文不对称）。
- 首装完成时的「重启 Galley…」toast 是既有措辞，这批没碰。
- Windows 上 CLI 目录显示要等 Windows 冒烟；第一批的 Windows 拖拽也还没回报。
