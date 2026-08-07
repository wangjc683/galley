# 研读笔记：OpenWorker（andrewyng/openworker）

Status: 参考资料（2026-08-07 两轮精读；Artifacts 部分已转化为本目录 PRD）
源码基线: github.com/andrewyng/openworker @ `01b6f83`（2026-08-01）。
文中 `file:line` 均指该 commit；上游迭代极快（发布两周合并 393 个 PR），
复核时注意漂移。

OpenWorker 是吴恩达 + Rohit Prasad 2026-07-24 发布的开源桌面 AI coworker，
MIT，open beta。形态与 Galley 高度同构，定位错位：

| | OpenWorker | Galley |
|---|---|---|
| 桌面壳 | Tauri 2 + React | Tauri + React |
| 引擎 | Python，构建在自家 aisuite 上 | Python runner 桥接 GenericAgent |
| 权威层 | Python SessionManager 全权 | Rust Core 全权（Rule 5） |
| 本地接口 | localhost HTTP + per-launch token | AF_UNIX socket（Rule 2） |
| 远程接入 | 自建 Slack relay 云服务 | 外部 Supervisor 传输层 |
| 定位 | 一体化「AI 同事」（自带 chat/连接器平台） | 编排台，对话归 supervisor、引擎归 GA |

结论先行：**机制可学，边界不必学。** 以下按借鉴价值分层；「裁决点」小节
记录 2026-08-07 讨论中列出但**尚未裁决**的事项（Artifacts 已裁决，见 PRD）。

## 一、高价值机制（未裁决，候选借鉴）

### 1. Inbox + durable resume：审批是「停靠的、可等待的、幂等的」记录

全库最漂亮的设计。四类交互式提问（审批/问题/目录授权/计划确认）统一以
`(session_id, tool_call_id)` 为幂等键停进 Inbox（`coworker/inbox.py:131`），
提问停靠瞬间会话先落盘。进程重启后重建引擎、重放到未回答的 tool call，
重新提问时发现 Inbox 已有已解决的同键记录，立即返回——**崩溃恢复与正常路径
同一条代码路径，零特判**（`engine.py:270` resume + `manager.py:861`）。
第一响应者获胜，任何 surface（GUI/IM/重启后）都能解决。

对 Galley 的问题：bridge 进程挂掉时挂起审批的命运是什么？若答案是「丢了」，
此模式几乎是现成答案，且权威状态放 Rust Core + SQLite 正合 Rule 5。

### 2. 「Unattended 只改变找人的渠道，不改变自治上限」

无人值守是纯路由开关（提示停进 Inbox 而非内联弹出），自治程度永远由
permission mode 决定（`unattended.py:1-7`）。一句话原则堵死「我离开一下」
被静默理解为「随便跑」。Galley 人经常不在场，值得写进产品原则。

### 3. 目标绑定的常设授权（standing scoped approvals）

- 「永远允许」按 `工具 → 精确目标` 授权（`send_message → slack:T1/C1`），
  不按裸工具名（`permissions.py:62-80,160-171`）。
- exec/破坏性工具**结构性无资格**进常设规则（"shell asks forever"）——资格由
  工具 schema 是否声明 target 参数决定，不靠黑名单。
- UI 卡片声称的 "always allow" 服务端重新校验，不信任前端（`manager.py:2620`）。
- 每次自动放行都在审计日志引用其规则。
- 配套：shell 白名单先拒绝一切 shell 元字符再做 argv 前缀比较（注释记录了
  绕过案例 `git status && rm -rf ~`，`permissions.py:216-238`）。

### 4. 三层保底的上下文压缩（`compaction.py`）

- 触发 `min(0.8×窗口, 250k)`——大窗口模型提前压（质量早于名义上限退化）。
- 保留三层：LLM 摘要（丰富可错）+ 机械提取工作状态（文件/最近 10 条命令及
  退出码，零幻觉）+ **用户原话逐字保留**（"用户的话是意图的 ground truth"）。
- 只作用于发给 provider 的出站视图，canonical 历史永不改写；出站块字节稳定
  以保 prompt cache。
- 失败策略分流：有人值守问用户；无人值守静默裁剪（"永远不要让后台任务停在
  内部簿记上"）。
- 对 Galley：属 managed GA 运行时受益项（patch 提案或上游 feature request）。

## 二、中等优先级（与 Galley 场景直接相关）

- **IM mention → spawn 会话链路**（`manager.py:3012-3101`）：线程 target 字符串
  同时是去重键、发送参数、权限授予对象，三处字节一致故无翻译层 bug；先写
  持久映射再给活体授权，快速二次 @ 不会双开；授权在每次引擎重建时从持久映射
  重推导，重启不丢。Galley supervisor 做「IM 消息 → session」映射时的参考
  实现（存路由映射不存对话，与 Rule 4 兼容）。
- **计划任务的每次 run 是真实可续聊会话**；且 run 内**不注册调度工具**——防止
  agent 读到自己指令里的时间表达再建一个自动化（`manager.py:2731`）。
- **Workspace trust 跟随规范化路径**：未信任 repo 的 MCP 配置根本不读
  （clone ≠ 可定义开机进程）；同名时全局赢（`mcp/config.py:55-116`）。
- **审计日志**：单表 SQLite，stage 流水（proposed→approval_requested→
  approval_resolved→finished），写前脱敏，审计失败绝不影响 turn。
- **诚实降级**为一贯品味：context_window 未验证就隐藏进度条而不编分母；
  归因失败就不加前缀不猜——「宁可少信息，不要错信息」。

## 三、反向证据（印证 Galley 现有选择）

- 他们为 localhost HTTP 付出的整套代价（Origin 正则门、WS 子协议带 token、
  恒定时间比较、per-launch token 文件、SIGKILL 残留）源于其自认的
  「loopback 不是安全边界」——AF_UNIX（Rule 2）天然免疫这整类攻击。
- 79KB `App.tsx` + 49 个 useState 作为唯一状态所有者，恰是 Rule 5 要防的
  GUI 侧单体；发布两周已显债。
- 半成品与空转：`wake_on`/`wake_on_event` 记录的 wake 永不触发；memory 无
  GUI surface；订阅 filter 字段声明了从未读。完成度分布不均（安全模型 >>
  记忆系统），beta 常态。

### 顺手可捡的工程实践

- FakeSlack：一个 env var 重定向 API base，真实 Bolt SDK 全链路跑假 Slack，
  hermetic e2e。对应 Galley 的 fake GA 思路。
- 父进程死亡检测：显式传 `PARENT_PID` 而非 `getppid()`（PyInstaller 下是
  孙进程）；Rust 侧 `ExitRequested` 与 `Exit` 双挂钩。Galley Core 拥有 bridge
  子进程，同类问题域。
- 更新清单守门：URL 钉 tag 不用 latest/；缺 `.sig` 的产物跳过不发布；空清单
  拒绝出厂。
- 注释即决策日志：带日期的 owner 裁决（"owner-hit 2026-07-20"）内联在代码里，
  与 Galley devlog 文化互补的形态。

## 四、Artifacts 深读（已裁决 → 见 PRD.md，此处存机制细节）

设计哲学：artifact = 工作区文件上的透镜，零新增状态。六环节：

1. **scratch 工作区**：无绑定目录的会话自动供给 `~/OpenWorker/<session_id>/`
   （`manager.py:348-436`）；base 可配置。家目录根部选址避开 TCC 保护区。
2. **提示词契约**：system prompt 要求交付物文件以
   `[Title](artifact:relative/path)` 链接收尾（`agents/cowork.py:30-33`）。
3. **chip 渲染**：`artifact:` 过 sanitizer 白名单渲染为 chip；点击必须落在
   可见处（UX-016：面板收起则自动展开，`App.tsx:304`）；预览打开时自动收起
   左导航让位。
4. **发现**：约 26 种交付型扩展名白名单，`os.walk` 原地剪枝（TCC 教训，
   见 I12；回归测试 `test_artifact_walk.py` 用 spy 断言 `~/Library` 未被
   踏入），跳过隐藏/node_modules/target/dist，mtime 倒序截断 80
   （`manager.py:1228-1301`）。
5. **预览**：按 kind 分发——markdown 渲染 / HTML iframe（**有漏洞，见下**）/
   图片、PDF data URL（pdf.js 懒加载）/ csv 表格 / xlsx SheetJS 懒加载带页签 /
   folder 返回可点击列表 / **pptx、docx 不假装能预览**，直接给「用默认应用
   打开」；二进制超 25MB 拒绝预览指向 Reveal（`manager.py:1303-1389`）。
6. **OS 逃生口**：Reveal（Finder/Explorer 定位）/ open（默认应用）/
   Copy path 给绝对路径（tester catch：相对路径等于只复制文件名）。

刷新时机：文件写入类工具成功即刷 + `turn_done` 兜底（`App.tsx:78,713,756`）。
自动化联动：run 的 artifacts = task 工作区自 run 开始后修改的文件
（`manager.py:3166`）。面板按 agent 家族分流：仅 deliverable 型（cowork）有
Artifacts，code 型预留 "Files" 槽未做。

### ⚠️ 已核实漏洞（Galley 红线来源）

`RightRail.tsx:378-383`：`<iframe sandbox="allow-scripts allow-same-origin"
srcDoc={…}>`。srcDoc 继承宿主 origin，两 flag 同开时 sandbox 失效（MDN 明确
警告的组合）→ agent 生成的 HTML 与 App 同源运行 → `window.parent` 可达
Tauri 壳注入的 `__COWORKER_API_TOKEN__` 全局 → 恶意交付物 + 一次预览点击 =
token 外泄 = 本地 API（含 shell 工具）全控。其 token 门禁被从内部击穿。
Galley 对策已定为 PRD 安全红线 1（只给 `allow-scripts`，opaque origin）。

## 裁决点存档（2026-08-07 列出，未裁决）

1. 审批崩溃恢复：Galley bridge 崩溃时挂起审批的命运？是否把「审批 = Rust
   Core 持有的幂等停靠记录」立为目标形状？（agent 评估：四机制中对 Galley
   价值最高。）
2. 「Unattended ≠ 自治升级」是否作为产品原则写进 PRD/设计文档？
3. 未来「always allow」是否采用「目标绑定 + exec 永久无资格 + 服务端复验」
   三件套？
4. Supervisor 链路是否借鉴 mention-session 映射（durable map 先行 + 授权
   重推导）？
5. 压缩三层保底走 managed patch 还是等上游 GA？
6. 低成本项：shell 白名单元字符硬化、审计表形状、「调度运行不给调度工具」。
