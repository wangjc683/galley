# Galley PRD v0.3

> 创建时间：2026-05-15 CST
> 状态：Active
> 作者：JC + Hermes
> 替代：v0.2（保留在 git 历史，previous commit hash 可查）
>
> **v0.3 核心变化**：产品定位从「GA 的本地桌面工作台」reframe 为「**本地 agent team orchestrator，dual-native for human and agent**」。新增 Galley CLI 一等公民地位、Supervisor Agent 概念、localhost-only 架构原则、CLI 公开契约面（agent-api）。详细决策叙事见 [2026-05-15 vision pivot devlog](./devlog/2026-05-15-vision-pivot-to-orchestrator.md)。
>
> **2026-07-03 定位更新**：Galley 定性为**独立产品，基于 GenericAgent 二次开发**——不是 GA 的 GUI，身份也不再是「wraps GA 的壳」。patch 过的内置 managed runtime 是产品引擎与开发重心；attach 外部 GA 保留为兼容模式。品牌表面遵循「GA 预算」与「内核 / engine」称谓规则（见 [copy-language-guidelines](./copy-language-guidelines.md)），气质定位见 [temperament](./temperament.md)。决策叙事见 2026-07-03 三篇 devlog。
>
> **本文件与 DESIGN.md 的关系**：DESIGN.md 继续负责 GUI 视觉与交互设计规则。CLI 设计契约见独立的 [docs/agent-api.md](./agent-api.md)（v0.2 ship 时 publish）。

## 1. 一句话定位

**Galley** is a **local agent team orchestrator, native for both human and agent**.

中文：**本地 agent team 编排器，人和 agent 都是一等公民**。

它有两个对等的前端：

- **Galley GUI**——给坐在桌前的 human operator 看进度、写指令、审批
- **Galley CLI**——给 **Supervisor Agent**（外部 agent，可能是另一个 GA、可能是 Claude，可能是用户自己写的）远程操作整个 session team

两个前端共享同一个 **Galley Core**（Rust 端权威层），数据 / 状态 / 命令调度都从这里走。

> *Galley started as a workbench for GenericAgent. The first two letters of our name are a quiet bow to where we came from.*

## 2. 产品摘要

GenericAgent (lsdefine/GenericAgent, MIT, ~10K star) 是个能力强、社区活跃的开源 Agent framework，官方支持 Streamlit / WeChat / Lark / Telegram 等多个前端。但所有这些前端在以下场景上是缺位的：

1. **多 session 并行**：所有 IM 都是单线对话框，几件事必须串在同一个 context 里
2. **手机 ↔ 桌面 session 是隔离的**：外出用 IM 跟 GA 跑的事不在桌面工作台里，回到桌面看不到
3. **手机上用户期待是"管理"而不是"工作"**：更像总监 / 管家，而不是工作台

v0.1 Galley 解决了第 1 个（multi-session 桌面 GUI），第 2 / 3 个是 v0.2 通过 dual-native 架构解决：

- **桌面**：human operator 用 Galley GUI 像 v0.1 一样管 session team
- **远端**：human 通过 IM 跟 Supervisor Agent 对话，Supervisor Agent 通过 localhost CLI 控制 Galley，所有 session 落到同一个 Galley 数据库
- **回桌面**：所有外面派的任务都在 Galley GUI 里一目了然，可以手动接管继续

Galley 自身永远是本地应用，远程传输不是 Galley 的责任——那部分由 Supervisor Agent 的外部传输层（如 GA 自己的 IM frontend）负责。

## 3. 产品定位

不是 IDE，不是 ChatGPT 替代品，不是 IM 客户端，不是 GA 的前端。它是：

- **本地 agent team orchestrator**（macOS + Windows，long-term Linux）
- **dual-native**：GUI 和 CLI 是对等消费端
- **agent-friendly platform**：Supervisor Agent 通过公开 CLI 契约面控制整个 team
- **Local-first**：所有数据在用户机器，远程传输由 Supervisor 在外部完成
- **自有引擎（owns its engine）**：内置 managed runtime（上游 GA + Galley patch stack）是产品引擎与开发重心
- **Non-invasive to attached runtime**：attach 外部 GA 是兼容模式，严格非侵入；架构上（runner/ 目录与宪法）仍允许将来接入其他 runtime——这是架构余量，不是产品身份

> 定位演化：v0.1 是 "GA 的 companion app，删除即恢复"；v0.2 升级为 "agent-runtime-agnostic orchestrator，当前 wraps GA"；2026-07-03 起是「**独立产品，基于 GenericAgent 二次开发**」——引擎是自己的（managed patch stack），不是包着别人的。

## 4. 核心架构原则（项目宪法）

### 4.1 Non-invasive to agent runtime

Galley **绝对不**做：

- 修改 agent runtime 源码（v0.2 = GA：`~/Documents/GenericAgent/` 下任何文件）
- 修改 runtime memory / 配置文件
- 接管 runtime 运行环境（不动 venv、不改 PATH）
- 自动升级 runtime

Galley **可以**做（即「扩展式 attach」）：

- 子类化 runtime 提供的 handler 类、注入 hook
- 启动 runtime 子进程（每个 session 一个独立子进程）
- 通过 IPC 通信
- 读取 runtime 状态做持久化
- 通过 IPC 命令注入 history 实现 session 恢复

**Supervisor SOP 交付**：用户在 Galley Settings 内主动点击 "复制 SOP" 按钮，Galley 只把 SOP 文本放进剪贴板。用户自己决定发给哪个 Agent；Galley 不写 GA `memory/`。

**保证**：用户随时可以删除 Galley，GA 独立运行不受影响。

### 4.2 Localhost only

**Galley Core 永远 only listen on AF_UNIX / named pipe，不开 TCP，不持有 token。**

远程访问通过 Supervisor Agent 在外部传输层（IM frontend / SSH / 其他）完成。这是责任边界，不是 v0.2 简化：

```
┌──────────────────────────────┐
│  手机 / 远端                  │
│  ↓ IM / SSH / 其他           │   ← 远程传输：Supervisor Agent 的责任
└────────────┬─────────────────┘
             ↓
┌────────────┴─────────────────┐
│  桌面（同一台机器）           │
│  Supervisor Agent            │
│  ↓ localhost (unix socket)   │
│  Galley CLI / GUI            │
│  ↓                           │
│  Galley Core                 │   ← 本地编排：Galley 的责任
└──────────────────────────────┘
```

收益：

- 安全模型 = OS user filesystem permission，无 TLS / token / 证书
- 复用 Supervisor 平台已有的远程传输（GA 的 IM frontends、Claude 的 web、SSH 等）
- "Galley 是本地的、数据不离开你的机器" brand 守住

### 4.3 CLI surface 是公开契约

Galley CLI 输出的 JSON schema 是 Galley 对 agent 生态的公开承诺：

- 详细规范见 [docs/agent-api.md](./agent-api.md)（v0.2 ship 时 publish）
- schema_version 内 additive-only（只加字段不删 / 不改语义）
- breaking change = schema_version bump，旧版 SOP 仍可用 `?schema=N` 拿老格式
- exit code 分类稳定，错误码 enum stable

## 5. 目标用户

V1.0 优先服务：

- 现有 GA 重度用户（v0.1 已经在用 Galley 的人，自然过渡）
- 想用 supervisor agent 远程控制 session team 的 power user
- 能接受本地配置、关心工具执行透明度的开发者

不优先服务：

- 完全不懂本地配置的轻度用户
- 需要团队协作的企业用户
- 需要托管服务的用户
- 不写代码 / 不用 IM agent 的用户

## 6. Goals / Non-goals

### 6.1 V1.0 Goals（5 件事）

继承 v0.1 七件事的成果，v0.2 新增 5 件：

1. **Galley Core**：Rust 端权威层。bridge 管理 / SQLite 写 / 命令调度 / event broadcast 都在 Rust 完成。前端（GUI / CLI / 未来 web / mobile）是 stateless presenter
2. **Galley CLI v1**：13+ 个子命令覆盖 inventory / 操作 / 项目 / 配置；agent-first 输出（NDJSON / JSON 默认）；schema versioned；公开 [agent-api.md](./agent-api.md) 契约
3. **Background mode**：menubar daemon 形态。关窗 → 隐藏不退出。Galley Core 没在跑 = CLI 全部命令报错 "Open Galley first"
4. **Supervisor 行动日志 per-session**：每个 session 的 timeline 里穿插显示 human / supervisor 对此 session 的动作 + reason，回桌面一眼看懂"昨晚干了啥"
5. **Galley Supervisor SOP for GA** + **galley-supervisor skill** for Claude：两个 adapter artifact 随 v0.2 发布，让用户能立即在 GA 或 Claude 上把 Galley 当作 tool 使用

继承自 v0.1（v0.2 必须仍然成立）：

- v0.1 七件事的所有 acceptance criteria 仍然必须通过（multi-session / Tool Timeline / Approval / Session 历史 / Session 状态展示 / LLM 切换 / GA Attach）

### 6.2 V1.0 Non-goals

- **远程认证 / token 系统**：永远 localhost only（宪法）
- **Supervisor 注册 / capability 声明 / permission system**：v0.2 不做，留 v0.6++
- **Galley 作 chat platform**：不存 Supervisor ↔ human 对话，只存动作 + reason
- **多 agent runtime 同时支持**：v0.2 仍是 GA only。架构允许将来扩展，但 v0.2 不实施
- **Web / mobile / remote 前端**：不在 v0.2
- **Telemetry / 用量统计**：永远 no telemetry
- **Homebrew tap / 包管理**：v0.2 不做，v0.6+ 候选

### 6.3 继承自 v0.1 的 Non-goals（仍然成立）

- 自动安装 / 升级 / 修复 GA
- 完整 IDE（文件树、编辑器、git diff）
- Context Window 占用展示
- Follow-up Queue
- Artifacts 一等公民
- 完整 tracing / 多人审批 / 复杂 policy / RBAC

### 6.4 Goal 模式定位（2026-07-06 定案）

Goal 是 Galley 的长视界自治模式：给一个目标，Galley 起一个 Master
session + N 个 Worker session，在时间预算内持续推进、验证、改进，把
结果送回发起对话。设计与协议细节见
[RFC-6 Goal / Hive / Morphling](./galley-native/rfc-6-goal-hive-morphling.md)、
契约见 [agent-api §5.19](./agent-api/goal-commands.md)。

**受众与投入水位**：

- **第一受众是 Supervisor agent**（经 CLI / socket 契约驱动 Goal）。
  契约完备性、可恢复性、行为语义的稳定优先于桌面呈现。
- **桌面人类用户是第二受众**。欢迎使用，但桌面侧的目标水位是
  「基础体验到位」：启动可发现、进行中可感知、结果可读、worker
  会话有方向感——不做专门 Goal 屏幕、不做 deliverable 面板、
  不追求日常工具级的打磨密度。超出该水位的桌面增强需重新立项。

**Goal ↔ Project 关系**：

- 主路径是**复用现有项目上下文**：从项目内会话（或带项目筛选的
  空白屏）启动的 Goal 在该项目中运行，worker 也生成在其中。
- **自建项目仅是无上下文启动的 fallback**（空白屏、无项目筛选）。
  机械原因：worker 会话的归属靠 `project_id` 锚定，Goal 没有项目
  就没有 worker 容器。
- 未来方向（未排期）：把 worker 锚定从 project 迁到 goal
  （sessions 挂 goal 关联），project 变为可选；届时 fallback
  自建可移除。

**何时用 Goal**（判断规则，同 Supervisor SOP）：需要长时间自治推进、
多方案比较、持续验证改进的目标才用 Goal；任务只是"有两个明显子步骤"
不构成使用理由，普通 session 即可。

## 7. 术语表

| 概念 | 术语 | 备注 |
|---|---|---|
| 一个会话 | **session** | 继承 v0.1 |
| 一组 session | **session team** | tagline 一致 |
| 外部 agent 通过 CLI 驱动 Galley | **Supervisor Agent** | 大写 S 首字母正式；小写日常 |
| 坐桌前用 GUI 的人 | **human operator** | 跟 Supervisor 配对 |
| Supervisor 远程操作 Galley 这件事 | **agent-driven operation** | 不用 "CEO mode" / "remote control" |
| Rust 端权威层 | **Galley Core** | 专有名词 |
| GUI 前端 | **Galley GUI** | 桌面 React app |
| CLI 前端 | **Galley CLI** | 命令行 binary `galley` |
| 两个前端的合称 | **GUI surface** + **CLI surface** | 同一 core 的不同 facet |
| Python session 容器 | **runner** | 重命名自 v0.1 的 bridge |
| 后台常驻 | **background mode** | 用户文档；开发文档可用 daemon |
| 设计哲学 | **dual-native** | 人和 agent 都 first-class |

## 8. 信息架构（不变，继承 v0.1 + v0.2 + sidebar overhaul）

GUI 信息架构跟 v0.2 PRD §7 + DESIGN.md 一致。本节不重复细节，详见：

- [DESIGN.md](./DESIGN.md) — Sidebar Spec / Top Bar / Conversation / Approval Dock
- [2026-05-13 sidebar overhaul devlog](./devlog/2026-05-13-sidebar-overhaul-and-projects.md) — 信息架构最新形态

v0.2 在 GUI 侧的新增元素（B4 阶段实施）：

- **Background mode menubar icon**：静态 / N active session 时带 badge
- **Session timeline 的 supervisor 行动条目**：穿插显示 human / supervisor 动作 + reason
- **Settings → Agent**：可选 CLI shortcut、Copy Agent SOP、Agent API 文档入口

## 9. 数据模型

继承 v0.2 的 Session / Project / Tool Event / ConversationMessage。v0.2 新增字段：

### 9.1 Session 新增字段

```typescript
type Session = {
  // ...v0.2 字段不变
  createdVia: "manual" | "cli";        // 创建来源
  createdBySupervisor?: string;          // freeform supervisor 标识
  createdOriginNote?: string;            // freeform reason at creation
};
```

### 9.2 Message 新增字段

```typescript
type ConversationMessage = {
  // ...v0.2 字段不变
  createdVia: "manual" | "cli";
  supervisor?: string;                    // freeform supervisor 标识
  originNote?: string;                    // freeform reason for this action
};
```

### 9.3 不新增的字段（明确）

- 没有 `supervisor_registry` 表（permission system 雏形，v0.2 拒）
- 没有 supervisor ↔ human 对话存储表（不做 chat platform）

## 10. Galley Core（Rust 端权威层）

### 10.1 职责

| 职责 | v0.1 在哪 | v0.2 在哪 |
|---|---|---|
| SQLite 读写 | TypeScript (`gui/src/lib/db.ts` 778 行) | Rust (Galley Core)，TypeScript 改为通过 invoke 调用 |
| Bridge 子进程 spawn / 管理 | TypeScript (`gui/src/lib/bridge.ts` 203 行) | Rust (Galley Core) 持有 child handle |
| IPC event 分发 | TypeScript (`gui/src/lib/ipc-handlers.ts` 1011 行) | Rust (Galley Core) emit event 到所有 subscriber |
| 命令调度 | TypeScript (Zustand store actions, 2727 行 store 一部分) | Rust (Galley Core) 暴露 trait |
| 状态管理 (authority) | TypeScript (Zustand store) | Rust (Galley Core) 内部 state，前端订阅 |
| UI state (selected session, modals open, etc.) | TypeScript (Zustand store) | TypeScript (拆 slice 后保留) |

### 10.2 Core API（trait + 多 transport）

**single source of truth**：Rust 用一个 trait 定义 "Galley API surface"：

```rust
trait GalleyApi {
    async fn list_sessions(&self, filter: SessionFilter) -> Result<Vec<SessionBrief>>;
    async fn get_session_brief(&self, id: SessionId) -> Result<SessionBrief>;
    async fn send_message(&self, id: SessionId, msg: String, origin: Origin) -> Result<MessageId>;
    async fn create_session(&self, params: NewSession, origin: Origin) -> Result<SessionId>;
    async fn archive_session(&self, id: SessionId, origin: Origin) -> Result<()>;
    async fn watch_session(&self, id: SessionId, filter: EventFilter) -> EventStream;
    // ... 完整命令表见 §11
}

struct Origin {
    via: "manual" | "cli",
    supervisor: Option<String>,
    reason: Option<String>,
}
```

两个 transport 都调同一个 trait：

- **Tauri command handlers**（GUI invoke）→ thin wrapper 调 trait
- **Unix socket handlers**（CLI 连接）→ thin wrapper 调 trait

**收益**：新增命令 = 改一处。三个 transport（GUI / CLI / 未来扩展）自动同步。schema 不会漂移。

### 10.3 工程实施（B1-B4）

详细 phase 分解见 [vision pivot devlog](./devlog/2026-05-15-vision-pivot-to-orchestrator.md) §D4。要点：

- **B1 (3w)**: 目录重组 + Rust core 骨架 + CLI 只读命令
- **B2 (3w)**: runner ownership 迁 Rust + CLI 写命令 send_message
- **B3 (3-4w)**: useAppStore 拆 slice + 改订阅 Rust event
- **B4 (2-3w)**: CLI feature-complete + background mode + SOP/Skill artifact + agent-api.md

**每阶段不能让 dogfood 体验比上一阶段差**——老路径保留 + 新路径并行 + 验证后切流，dogfood 稳定优先于代码 churn。

## 11. Galley CLI 命令 surface

完整规范见 [docs/agent-api.md](./agent-api.md)（v0.2 ship 时 publish）。本节列 surface。

### 11.1 命令表

```bash
# Inventory (read)
galley sessions list [--project=X] [--status=...] [--json|--pretty]
galley sessions search "<kw>" [--scope=all|active]
galley session brief <id>                # digested 1-2 行
galley session show <id> [--tail=N]      # 完整 message log
galley status                            # 一句话 team 总览
galley health                            # 类似 GUI health check 5 项
galley version                           # Galley + schema 版本

# Operate session (write)
galley session new "<task>" [--project=X] [--llm=...] [--supervisor=...] [--reason=...]
galley session send <id> "<msg>" [--supervisor=...] [--reason=...]
galley session btw <id> "<q>" [--supervisor=...]
galley session stop <id>
galley session archive <id>
galley session restore <id>
galley session move <id> [--to=<project-id>] [--supervisor=...]   # session 是 subject；no --to = 拆出 project
galley session watch <id> [--filter=...] [--until=idle]            # NDJSON stream

# Project
galley project create "<name>" [--description=...] [--supervisor=...]
galley project list
galley project delete <id> [--supervisor=...] [--reason=...]   # v0.2: destructive，sessions 自动拆到 ungrouped；v0.6+ 再 ship 真正的 `project archive` (reversible)

# Config
galley llm list
galley llm set <session> <llm>
```

### 11.2 输出契约（6 条规则）

1. **默认 JSON / NDJSON**：NDJSON 一行一对象 streaming 友好，single-result 用 JSON 对象。`--pretty` flag 触发 human-readable table
2. **错误是 JSON**：`{"error": "<code>", "message": "<human>", ...context}`
3. **Exit code 分类**：0=success / 1=generic / 2=invalid args / 3=not found / 4=backend unavailable / 5=runner error
4. **Schema versioned, additive-only**：v1 内只加不删，break = bump v2
5. **Command grammar**：`galley <noun> <verb>`（`session create` 不是 `create-session`）
6. **`--pretty` 是 derived view**：JSON canonical

### 11.3 Supervisor identity 字段

`--supervisor=<freeform-string>` 由 supervisor 自己定（如 `ga-wechat-bot`、`claude-skill-galley-mgr/v1.2`）。Galley 只记录、不校验、不注册。

### 11.4 不在 v0.2 surface 的命令

- `galley pet attach / detach`（桌宠，supervisor 用不到）
- `galley config get/set`（Settings 是 GUI 的事）
- `galley memory ...`（GA memory 由 GA 自己管，宪法约束）
- `galley supervisors register / list`（permission system 雏形，v0.6+ 候选）

## 12. CLI 发包

### 12.1 默认（agent 用）

CLI binary bundled 进 .app（macOS）/ Program Files（Windows）：

```
macOS:   /Applications/Galley.app/Contents/MacOS/galley
Windows: C:\Program Files\Galley\galley.exe
```

**首启不弹 PATH install 提示**——agent 不用 PATH，认绝对路径。

### 12.2 Discovery file

GUI 首次启动写入一行 CLI 绝对路径：

```
macOS / Linux: ~/.config/galley/cli-path
Windows: %APPDATA%\galley\cli-path
```

Supervisor SOP 第一步读这个文件拿 CLI 路径，跨 OS 统一。

### 12.3 Human escape hatch

Settings → Agent → "安装 galley 命令" 按钮：

- macOS：弹 sudo 创建 `/usr/local/bin/galley` → CLI 绝对路径 symlink
- Windows：写用户级 PATH（不需 admin）

### 12.4 v0.6+ 候选

- Homebrew tap `brew install galley`
- Linux AppImage / .deb / .rpm
- Snap / Flatpak

## 13. Background mode

### 13.1 行为

- 关闭主窗口（红色按钮 / Cmd+W）→ **隐藏**，不退出。app 继续在 menubar 跑
- Cmd+Q 或 menubar "Quit Galley" 才真退
- Galley Core 完全退出 = CLI 全部命令报错 "Open Galley first"

### 13.2 Menubar 图标状态

- 静态：什么都不在跑
- 带数字 badge：N 个 active session
- 不做 approval 红点（v0.1 已经接受自动执行（原 YOLO）默认，supervisor 场景下 approval 不是主线）

### 13.3 Menubar 下拉菜单

- "Open Galley"
- "5 active · 12 idle" 状态行
- "Show pending: #3 #12" 有 session 等待输入时（可选）
- "Launch at login" toggle (default OFF for v0.2)
- "Quit Galley"

### 13.4 首启引导

第一次关窗时弹一次 "Galley 还在 menubar 跑哦，要彻底退按 Cmd+Q" 的引导（写到 `prefs.background_mode_intro_seen`），之后不打扰。

## 14. Adapter artifacts（随 v0.2 发布）

### 14.1 Galley Supervisor SOP for Agents

文件：`docs/integrations/galley-supervisor-sop.md`（仓库内）+ 可投到 fudankw.cn/sophub

内容：

- 读 discovery file 拿 CLI 路径
- 列出可用命令 + 典型使用模式
- 强调："你是 Supervisor，远程帮 human 管理 session team。**重要决策（archive / 切 LLM）问 human 再做**"
- 调用示例（agent 友好的 JSON 输出 + 怎么读）

**交付方式**：Galley Settings 提供"复制 SOP"按钮，把 SOP 文本复制到剪贴板。用户自己决定发给哪个 Supervisor Agent。Galley 不写 GenericAgent `memory/`，避免把 Integration 入口绑定到单一 agent runtime。

### 14.2 galley-supervisor skill for Claude

文件：`.claude/skills/galley-supervisor/`（仓库内 + 可让 JC 发布到 Claude skill marketplace）

类似 SOP 内容，遵循 Claude skill format。

### 14.3 docs/agent-api.md

Galley CLI 的公开契约：

- 命令 surface 完整列表 + 参数 + 输出 schema
- Exit code 表
- Schema versioning 规则
- 稳定性承诺（schemaVersion 1 内 additive-only）
- 错误码 enum + 解释

给 Supervisor adapter / SOP 作者看，不是给最终用户看。

## 15. Onboarding 调整

继承 v0.1 onboarding flow（welcome / attach / health check / new chat），v0.2 新增引导：

1. v0.1 → v0.2 升级用户首次启动：弹"v0.2 新增 Galley CLI"提示，引导到 Settings → Agent
2. 全新用户首次启动后：Settings 一个低调 banner "想让 supervisor agent 远程控制 Galley？看 [docs/agent-api.md]"
3. 不打扰：CLI 是 power user feature，正常使用 GUI 的用户不被 push 必须用 CLI

## 16. 数据迁移（v0.1 → v0.2）

### 16.1 Tauri identifier 不变

`app.galley` 保持不动。v0.1 用户的数据目录 `~/Library/Application Support/app.galley/` 直接被 v0.2 接管，所有 sessions / projects / messages 平滑过渡。

### 16.2 Schema migration

v0.2 启动时自动跑：

- migration 006: 加 `messages.created_via` (default `manual`)
- migration 007: 加 `messages.supervisor` (default NULL)
- migration 008: 加 `messages.origin_note` (default NULL)
- migration 009: 加 `sessions.created_via` / `sessions.created_by_supervisor` / `sessions.created_origin_note` (default `manual` / NULL / NULL)

旧数据全部标 `created_via=manual`，supervisor 字段 NULL。GUI 显示时 NULL 不渲染 "via CLI" badge。

### 16.3 Migration 失败兜底

migration 失败 → app 拒绝启动 + 显示错误页面：

- 用户数据目录路径
- 错误详情
- 建议：备份目录 + 联系方式（GitHub issue 链接 / Email）

不自动 rollback / 不自动删数据。

## 17. 路线图

| 阶段 | 时间窗 / 状态 | 目标 |
|---|---|---|
| v0.1 Mac release | 5月下旬 ✅ | 现有代码出包 (.app + .dmg) |
| v0.1.1 内置 Python | 2026-05-18 ✅ | bundled CPython + GA core deps，零 Python 配置；Mac arm64 + Intel + Win 全 ship |
| Windows parity | 2026-05-31 ✅ | NSIS .exe + Win/Mac 跨平台 |
| Prototype: Rust-owned subprocess | B1 前 2-3 天 ✅ (2026-05-18) | throwaway 验证 (17/17 PASS · GO for B1) |
| B1: Rust core 骨架 + CLI 只读 | 1 session ✅ (2026-05-18) | 目录重组、core/cli/gui/runner 四目录、6 个 read 命令 |
| B2: Runner ownership 迁 Rust | 1 session ✅ (2026-05-19) | Rust 持 child handle，CLI send_message 写命令 |
| B3: useAppStore 拆 slice 改订阅 | 2 day calendar ✅ (2026-05-20, tag `b3-complete`) | GUI 改 presenter，最 risky 阶段；useAppStore.ts 删除 |
| B4: CLI feature-complete + background mode | v0.2 主线已 ship ✅ | 全命令 ✅ M1 + background/tray ✅ + SOP ✅ M4 T4.1 + Skill ✅ M5 + agent-api.md ✅ M6 frozen + supervisor activity GUI ✅ M7 + 数据迁移备份 ✅ M8 |
| **v0.2.0** | 2026-05-31 ✅ | first stable dual-native orchestrator release；GitHub Latest + beta update channel promoted |

详细 phase invariant、dogfood 策略、failure handling 见 [vision pivot devlog](./devlog/2026-05-15-vision-pivot-to-orchestrator.md) §D4 + §D13。

## 18. 风险与权衡

### 18.1 useAppStore 2727 行的 dogfood 教训

**风险**：v0.1 + v0.2 期间 useAppStore 累积了 6 个月的 UX 教训（auto-scroll snap、unread 三态、/btw routing、乐观更新 reconciliation、multi-session N-active 边界）。B3 拆 slice + 改订阅 Rust event 过程中，80% 容易做对，20% 会以 regression 形式被 dogfood 发现。

**缓解**：

- 每阶段 invariant："dogfood 体验不能比上一阶段差"
- 老路径保留 + 新路径并行 + 验证后切流（不一次性删旧代码）
- 阶段性 ship dev build 给自己装
- 全套 e2e 测试覆盖关键 UX 行为

### 18.2 CLI schema versioning

**风险**：v0.2 schema 设错 → v0.6+ 想加字段不 backward compatible → 用户 SOP 全断。

**缓解**：

- additive-only invariant（只加不删 / 不改语义）
- 加字段时 default 值兼容老 schema
- breaking change 强制 schema_version bump
- 公开 [agent-api.md](./agent-api.md) 在 v0.2 ship 时定稿

### 18.3 Galley Core ↔ Tauri WebView lifecycle

**风险**：路径 B 下 Galley Core 是 Rust，权威跟 WebView 解耦。但 Tauri 进程 lifecycle 跟主窗口绑定——"close window 不退出 process" 是否可靠？menubar daemon mode 下 WebView 是否 destroyed？

**缓解**：prototype 阶段 + B4 background mode 实施时专门验证 + dogfood。

### 18.4 v0.1 → v0.2 schema migration

**风险**：用户 dogfood 数据丢失或损坏。

**缓解**：

- migration 失败拒启动 + 显示数据目录 + 不自动删
- v0.2 release 前 JC 自己 dogfood 跑过 migration
- release notes 显式说明 migration 行为

### 18.5 Supervisor 误用 destructive 命令

**风险**：Supervisor agent 听信 user 的"删了它"未经 confirm 就跑 `galley session archive` / `galley project archive`。

**缓解**：

- SOP / Skill artifact 显式强调 destructive 命令前必须问 human
- CLI 本身不加 confirm prompt（不是用户友好性问题，是 SOP 设计责任）

## 19. Open Questions

继承自 v0.2 PRD 的未解决问题（多 session API quota / web_execute_js 审批分类等）仍然 open。v0.2 新增的开放问题见 [vision pivot devlog](./devlog/2026-05-15-vision-pivot-to-orchestrator.md) §Open questions。

## 20. 当前默认决策表（v0.2）

| 项 | 决策 |
|---|---|
| 产品形态 | local agent team orchestrator, dual-native |
| 前端 | Galley GUI + Galley CLI 对等 |
| 权威层 | Galley Core (Rust) |
| Agent runtime | GA only (v0.2)，架构允许将来扩展 |
| 远程支持 | 不直接支持，由 Supervisor 在外部传输层 |
| Auth | filesystem permission only (localhost) |
| Supervisor 身份 | freeform string, 不校验不注册 |
| CLI 输出 | JSON / NDJSON default, --pretty escape hatch |
| Background mode | menubar daemon (default ON 关窗时) |
| Telemetry | no |
| 设计哲学 | dual-native (first-class for both human and agent) |
| 平台 | macOS + Windows (Linux 候选) |

## 21. Future direction (post-v0.2)

继承 v0.2 PRD §22 的 future direction。新增候选：

- Multi-runtime backend (Claude SDK / OpenAI Agents 作为 alternative runner)
- Web view / mobile thin client（直接跟 Galley Core 通信，不需要 Supervisor 中转）
- Supervisor capability registration / permission system
- 远程访问层（如果证据上需要，但仍坚持 localhost only 是默认）
- Homebrew tap / package managers
- Galley Plugin marketplace (扩展 supervisor adapter)
- Persistent Supervisor session（如果 dogfood 信号支持）

## 附录 A：与 GenericAgent 的集成边界

继承 v0.2 PRD 附录 A 全部内容。v0.2 新增条目：

- v0.2.0 GA baseline：见 [GA baseline](./ga-baseline.md)；release 前 dogfood fixes 见 [2026-05-31 devlog](./devlog/2026-05-31-alpha2-dogfood-ux-polish.md)
- runner/ 目录（重命名自 bridge/）继续遵循附录 A.2 的接入点表

## 附录 B：v0.2 ↔ v0.3 diff 摘要

完整决策 provenance：[2026-05-15 vision pivot devlog](./devlog/2026-05-15-vision-pivot-to-orchestrator.md)

| 维度 | v0.2 | v0.3 |
|---|---|---|
| 定位 | "GA 的本地桌面工作台" | "local agent team orchestrator, dual-native" |
| 前端 | GUI only | GUI + CLI 对等 |
| 权威层 | TypeScript (React) | Rust (Galley Core) |
| Bridge ownership | TypeScript | Rust |
| 数据持久 | 同 v0.2 | 同 + supervisor / origin_note / created_via 字段 |
| 远程访问 | non-goal | "由 Supervisor 在外部传输层"（仍 localhost only） |
| Telemetry | 隐含 no | 显式 no |
| 目录结构 | src-tauri/desktop/bridge | core/gui/cli/runner |
| Runtime backend | GA only | GA only (v0.2)，架构允许将来扩展 |
| Stage 范围 | 3.7 收尾 | B1-B4 重构到 v0.2 |
