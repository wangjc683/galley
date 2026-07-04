# Vision pivot · workbench → local agent team orchestrator (dual-native)

**Date**: 2026-05-15
**Status**: 决策对齐（8 轮 brainstorm）· PRD v0.3 升格为 active · prototype spec 落地 · CLAUDE.md 宪法 + 阶段表同步更新
**Related**:
- [docs/PRD.md](../PRD.md) v0.3 active（本次升级，替代 v0.2，v0.2 保留在 git 历史）
- [desktop/src-tauri/experiments/bridge-owner/README.md](../../desktop/src-tauri/experiments/bridge-owner/README.md) 同时落地的 prototype 验证 spec
- [CLAUDE.md](../../CLAUDE.md) 项目宪法（待新增 localhost-only + CLI 公开契约条款）
- [docs/devlog/2026-05-15-onboarding-empty-state-yolo-button-polish.md](./2026-05-15-onboarding-empty-state-yolo-button-polish.md) 当天上半天的 v0.1 收尾 + Mac-only 决策

## Context

下午开 brainstorm 是为了讨论一个现场观察到的痛点：

GA 已经支持微信 / 飞书 / Telegram 等多个 IM 前端。JC 外出或在家时确实经常通过手机 IM 跟 GA 对话、安排任务。但是：

1. **IM 前端跟 Galley 的 session 是隔离的**——回到桌面打开 Galley，外面跟 GA 干的事不在 Galley 里
2. **IM 是单线对话框**，跑几件事必须串在一个 context 里
3. **手机上用户期待不是"工作"而是"管理"**——更像总监 / 管家，而不是工作台

由此冒出来的 idea：**让 Galley 本身变成 agent-friendly，让另一个 agent（比如 GA）当上层来指挥 Galley 这一堆 multi-session agent team**。

8 轮 brainstorm 把这个 idea 从"是不是有道理"逐步走通到"具体怎么实现 + 架构怎么演进 + 何时做"。最终产物是产品定位的一次重大 reframe：**Galley 从「GA 的本地桌面工作台」升级为「本地 agent team orchestrator，GUI + CLI 双前端，native for both human and agent」**。

这次 reframe 对外的意义：把 Galley 从 GA 前端品类（红海，社区已有数个前端）拔到平台层品类（编排 + 多消费端），具备长期可防守的差异化。对内的意义：项目宪法、PRD、目录结构、路线图都要调整。

## Decisions

### D1. 产品定位 reframe

**v0.1 (current)**: "Galley 是 GenericAgent 的本地桌面工作台"
**v0.5 (new)**: "Galley — a local agent team orchestrator, native for both human and agent"

中文版："**本地 agent team 编排器，人和 agent 都是一等公民**"

**关键性质 (要进 PRD §1 一句话定位)**：

- **local**：所有数据、控制、运行都在用户机器，远程传输不是 Galley 的责任
- **agent team orchestrator**：管 N 个并行 session 是核心，不是附加值
- **dual-native**：GUI 和 CLI 是两个 first-class 消费端，不是主从关系
- **for both human and agent**：human operator 坐桌前用 GUI，supervisor agent 通过 CLI 远程操作

这个 framing 把 v0.1 PRD §3 那条 "GA 的 companion app，删除即恢复" 升级了——非侵入仍然守，但 Galley 自己的 identity 从 companion 变 platform。

### D2. 术语表（写进 PRD + DESIGN + CLAUDE.md 一致使用）

| 概念 | 术语 | 备注 |
|---|---|---|
| Galley 内跑着的会话 | **session** | 保持 v0.1 |
| 一组 session 的集合 | **session team** | 跟 tagline 呼应 |
| 通过 CLI 外部驱动 Galley 的 agent | **Supervisor Agent** | 大写 S 首字母正式，小写 supervisor 日常 |
| 坐在桌前用 GUI 的人 | **human operator** | 跟 Supervisor 配对 |
| 由 Supervisor 远程驱动这件事 | **agent-driven operation** | 不用 "CEO mode" / "remote control" |
| Rust 端权威层 | **Galley Core** | 专有名词，未来 crate `galley-core` |
| 两个消费端 | **Galley GUI** + **Galley CLI** | 对称命名 |
| 两个 transport 的合称 | **GUI surface** + **CLI surface** | "surface" 暗示同一 core 的不同 facet |
| CLI binary | `galley` | 单字 |
| 后台常驻 | **background mode** | 用户文档；开发文档可用 daemon |
| 设计哲学 | **dual-native** / "first-class for both" | DESIGN.md / PRD 都引用 |

被 reject 的命名：

- ~~CEO mode~~（隐喻太重；JC 自己也不喜欢——是我引入的，他押回去）
- ~~controller agent / external agent~~（前者太命令链，后者太拓扑描述）
- ~~manager / boss~~（雇佣关系）
- ~~session swarm / pool / fleet~~（fleet 一度考虑过；最终 team 跟 tagline 一致优先）
- ~~Galley Engine / Backend / Kernel~~（Core 更有辨识度）

### D3. 架构方向 = 路径 B（Galley Core 持权威，前端是 presenter）

**当前架构事实**（brainstorm 中扒了一下确认）：

```
src-tauri/src/lib.rs                  81 行   只注册 plugin，零业务逻辑
desktop/src/lib/bridge.ts            203 行   ← spawn / 管 Python bridge 子进程
desktop/src/lib/db.ts                778 行   ← SQLite 读写
desktop/src/lib/ipc-handlers.ts     1011 行   ← bridge event 分发
desktop/src/stores/useAppStore.ts   2727 行   ← 全局状态 + 全部 action
```

**所有权威（session 生命周期 / bridge spawn / 消息分发 / 状态管理）今天都在 TypeScript / WebView 进程里**。Rust 是 dumb host。

这跟 "CLI 是 first-class 消费端" 严重冲突——CLI 是另一个进程，进不到 React 的 bridge ownership / store / event 流。

**两条路：**

- **路径 A**：Rust 加 control socket，从 CLI 接命令→ emit Tauri event 进 React → React 当成自己产生的命令处理。**hack 但 2-3 周可行**。代价：CLI 依赖 hidden WebView 保活、架构上 Rust 只是中继。
- **路径 B**：把权威迁到 Rust。Rust 持有 bridge registry + DB 写连接 + 命令调度 + event broadcast。前端（React / CLI / 未来 web / mobile）都是 subscriber + invoker。**10-12 周 substantial 重构**。

**JC 选 B**。理由（他自己 push 出来的）：

1. CEO 模式（即 supervisor agent 编排）是 Galley 的核心 USP，不是边缘场景。GA 前端社区已经有好几个人在做，Galley 不靠这个 reframe 拔到平台层就是红海里的另一张皮
2. **B 架构独立于 supervisor 场景也是更好的架构**：multi-frontend / 可测试性 / 开源贡献门槛 / 长期维护——任何长期项目都该走的方向
3. 个人 builder + 开源项目的风险结构跟公司不一样：选错方向损失 2 个月，选稳方向永远长 2727 行 useAppStore 是慢性病

**我承认改主意**。我前面 push 的 "A-first 验证后再 B" 是公司视角的保守做法，跟项目实际情况错位。

**一条 caveat 必须承认**：useAppStore 2727 行不是代码膨胀，是 6 个月 dogfood 教训的编码（auto-scroll snap / unread 三态 / /btw routing / 乐观更新 reconciliation / multi-session N-active 边界）。**B 不是删了它，是换位置重新实现**，过程 80% 容易做对，20% 会以 regression 形式被 dogfood 发现并慢慢补回。把工作量从 6-8 周修正到 **10-12 周**。

### D4. main 上重构，不开长期 branch

最初提议过开 `refactor/galley-core` long-lived branch 跟 main 平行跑（main 出 Windows v0.2 patch + branch 做 B）。**JC push back**：

- v0.1 之后停掉发版，直到 B 重构完才发新版（v0.5）
- 因此 main 不需要保护 "可发布状态"
- branch 的隔离价值消失

**接受。main 上重构。**

但 JC 自己也想保留 Windows release 通道。**最终顺序**：

```
现在 (5月下旬-6月)    : v0.1 Mac release（代码已完成，缺 .app/.dmg 出包）
6月-7月              : v0.2 Windows 跨平台（已有 Y plan + A items 落地）
                       ↓ ship v0.2 后冻结代码层
7月-10月             : Galley Core 重构（B1 → B4）on main
                       ↓ ship 节点 v0.5 = orchestrator + dual-native + CLI
10月以后            : v0.6+ polish + Homebrew tap + 更多 supervisor adapter
```

**B 阶段拆解（每阶段不能让 dogfood 体验比上一阶段差，老路径保留 + 新路径并行 + 切流）**：

- **B1 (3w)**: Rust 核心骨架 + CLI 只读命令 + 目录重组（src-tauri → core/、desktop → gui/、bridge → runner/、新建 cli/）
- **B2 (3w)**: bridge ownership 迁 Rust + CLI 加第一个写命令 send_message
- **B3 (3-4w)**: useAppStore 拆 slice + 改成订阅 Rust event，最 risky 阶段
- **B4 (2-3w)**: CLI feature-complete + background mode (menubar daemon) + SOP/Skill artifact + agent-api.md

**重构期 dogfood 策略**：JC 主机继续装老版 .app（v0.2）作为 daily driver，新代码在 dev mode 跑，等 B1 完成新版有可用度再切。

### D5. CLI 命令 surface (v0.5)

```bash
# Inventory（read-only）
galley sessions list [--project=X] [--status=...] [--json|--pretty]
galley sessions search "<kw>" [--scope=all|active]
galley session brief <id>                  # digested status 1-2 lines
galley session show <id> [--tail=N]        # 完整 message log
galley status                              # 一句话总览
galley health                              # 类似 GUI 的 health check 5 项
galley version                             # Galley + schema 版本

# 操作 session（write）
galley session new "<task>" [--project=X] [--llm=...] [--supervisor=...] [--reason=...]
galley session send <id> "<msg>" [--supervisor=...] [--reason=...]
galley session btw <id> "<q>" [--supervisor=...]   # /btw 通道
galley session stop <id>
galley session archive <id>
galley session restore <id>
galley session watch <id> [--filter=...] [--until=idle]   # NDJSON stream

# 项目
galley project create / list / move / archive

# 配置
galley llm list
galley llm set <session> <llm>
```

**砍掉的候选**：

- ~~`pet attach / detach`~~：桌宠是 v0.1 玩票功能，supervisor 用不到，砍
- ~~`config get/set`~~：Settings 是 GUI 的事，CLI 不暴露
- ~~`memory ...`~~：GA memory 是 GA 自己管的，宪法约束

**保留但 SOP 强调谨慎**：

- `llm set`：切 LLM 是重决策，SOP 建议 supervisor 切前问 human
- `project archive`：destructive，SOP 强调要 confirm
- `session archive / stop`：同上

### D6. Localhost only 升级到架构原则

**新加宪法条款（写进 CLAUDE.md 项目宪法）**：

> **Galley 只走 localhost。** Galley Core 永远 only listen on AF_UNIX / named pipe，不开 TCP，不持有 token。远程访问通过 Supervisor Agent 在外部传输层（IM frontend / SSH / 其他）完成。

**这不是 v0.5 简化，是正确的责任边界**：

```
┌─────────────────────────────────────┐
│  手机 / 远端                         │
│  你在微信里发消息                     │
│  ↓ 微信走 Tencent 服务器到桌面        │   ← 远程传输：GA / IM frontend 的责任
└──────────────┬──────────────────────┘
               ↓
┌──────────────┴──────────────────────┐
│  你的桌面（同一台机器）              │
│  GA (IM frontend, Supervisor)       │
│  ↓ localhost                        │
│  galley CLI                         │
│  ↓ unix socket                      │   ← 本地编排：Galley 的责任
│  Galley Core                        │
└─────────────────────────────────────┘
```

**收益清单**：

- 安全模型 = unix socket + filesystem permission，无 TLS / token / 证书
- 复用 GA 已经做好的 IM frontend，Galley 不重复造轮子
- "Galley 是本地的、数据不离开你的机器" brand 守住
- 将来 PR 提"加 HTTP server"可以直接以宪法理由拒绝

### D7. Supervisor identity = free string

CLI 加 `--supervisor=<freeform-string>` flag。

- 内容由 Supervisor 自己定（`ga-wechat-bot` / `claude-skill-galley-mgr/v1.2` 等）
- Galley **只记录、不校验、不注册**
- 存到 message / session 的 `supervisor` 列
- GUI hover 显示
- **不是 auth 凭证**：filesystem permission 已经够，"Supervisor 谎报" 不构成攻击面（同 OS user 本来就有权限）。这是真诚标识

不做的事：

- ~~Supervisor 注册/manifest 机制~~（permission system 雏形，留给 v0.6++）
- ~~Supervisor capability 声明~~（同上）

### D8. Agent-first output 6 条规则

**核心哲学**：CLI for Agent。输出格式以 agent 怎么读最方便为第一标准，人类阅读是 `--pretty` escape hatch。

| # | 规则 |
|---|---|
| 1 | **默认 JSON / NDJSON**。NDJSON（一行一对象）streaming 友好，single-result 用 JSON 对象 |
| 2 | **错误也是 JSON**：`{"error": "<code>", "message": "<human-readable>", ...context}` |
| 3 | **Exit code 分类**：0 success / 1 generic / 2 invalid args / 3 not found / 4 backend unavailable / 5 bridge error |
| 4 | **Schema versioned, additive-only**：v1 schema 内只加字段不删，break = bumping schema_version |
| 5 | **Command grammar 一致**：`galley <noun> <verb>`（`session create` 不是 `create-session`） |
| 6 | **`--pretty` 是 derived view**：human debug 用，JSON canonical，永远不会出现"只在 --pretty 里有的信息" |

### D9. CLI 发包 = sidecar bundled + 首启不弹 prompt + Settings 选装 PATH

**默认（agent 用）**：CLI binary bundled 进 .app（macOS）/ Program Files（Windows）。**首启不弹 PATH install 提示**——agent 不用 PATH，它认绝对路径。

**Discovery file**：GUI 首次启动写入一行 CLI 绝对路径到 well-known 位置：

- macOS / Linux: `~/.config/galley/cli-path`
- Windows: `%APPDATA%\galley\cli-path`

Supervisor SOP 第一步：读这个文件拿 CLI 路径。**跨 OS 统一 + 对用户安装位置不敏感**。

**人类 escape hatch**：Settings → Integration → "Install `galley` to PATH" 按钮，按了才弹 sudo（macOS）或写用户级 PATH（Windows，不需 admin）。

**v0.6+ 候选**：Homebrew tap `brew install galley`。v0.5 不做。

### D10. 不存 supervisor ↔ human 对话 + `--reason` 元数据 + per-session 行动日志

**不存的**：human ↔ supervisor 在 IM 里聊的对话内容。理由：

- 已存在两个地方（IM scrollback + supervisor agent 自己的 history），Galley 第三处不解决新问题
- Galley 是 orchestrator 不是 chat platform，开了这个口子就开始往 chat 滑（要不要 GUI 回复 supervisor、跨 supervisor 隔离、deletion 语义……）
- 换 supervisor 丢 context 是用户已经接受的事

**存的**：

- 每个 session / message 的 `created_via` 字段：`manual` / `cli`
- CLI 调用时的 `--supervisor=<id>` 写进 `supervisor` 字段
- CLI 调用时的 `--reason="<freeform>"` 写进 `origin_note` 字段
- GUI 在 session 详情侧加 "supervisor 行动日志" timeline：穿插显示 human / supervisor 对此 session 的动作 + reason

**收益**：JC 早上回桌面，看到 session #47 "via CLI · supervisor: ga-feishu · reason: 用户飞书追问 X 公司动态，开 session 调研"——一眼明白来由，不需要翻 IM。

**金句**：Galley 不存对话，只存"为什么这一步"。

### D11. 目录命名重组

```
core/             Galley Core (Rust)，重命名自 src-tauri
gui/              Galley GUI (React)，重命名自 desktop
cli/              Galley CLI (Rust)，新建
runner/           agent session runner (Python)，重命名自 bridge
docs/             不变
```

**`bridge/` → `runner/`** 理由：

- 名字描述函数（run an agent session），不绑定具体 backend
- agent-backend agnostic：未来引入第二个 backend（Claude SDK / OpenAI Agents）自然变成 `runner/ga/` + `runner/claude/`，目录结构提示扩展点
- 短，敲打舒服
- B 重构是改它的最佳时机——反正都要动这一层

被 reject 的候选：

- ~~ga-bridge/~~：把 GA 焊死在目录名里
- ~~agent-runtime/~~：GA 才是 runtime，这层是 host
- ~~session-host/~~：太长

### D12. 路线图明确化

| 阶段 | 时间 | 目标 |
|---|---|---|
| v0.1 Mac release | 5月下旬 | 现有代码出包（.app + .dmg），不增加 feature |
| v0.2 Windows | 6-7月 | NSIS .exe + 已有 A items（NSIS bundle / Python OS-aware / 教程双版本 / mod-key 抽象 / joinPath 替换 / Windows checklist） |
| B1 Rust 核心骨架 + CLI 只读 | 7月下旬-8月 | 目录重组 + Rust core 起步 + CLI 6 个 read 命令 |
| B2 bridge ownership 迁 Rust | 8-9月 | runner/ 由 core 管理 + CLI send_message |
| B3 useAppStore 拆 slice 改订阅 | 9月-10月初 | gui/ 改 presenter，最 risky |
| B4 CLI feature-complete + background mode | 10月 | 全命令 + menubar + SOP + Skill + agent-api.md ship |
| **v0.5** | **10月底-11月初** | **dual-native orchestrator 首次 ship · Galley Core + GUI + CLI** |
| v0.6 / v0.7 / v0.8 / v0.9 | v0.5 之后 | CLI 体验迭代 / Supervisor SOP 改进 / 真实社区反馈驱动 |
| v1.0 | 时机决定，不是日历决定 | 当 Galley 真"我可以推荐给任何用户"时——semver 1.0 = API 稳定 + production-ready |

### D12.1 为什么 v0.5 不是 v1.0（追加于同日，本来叫 v1.0）

最初本 devlog 把 "dual-native orchestrator 首次 ship" 命名为 v1.0。JC 后续 push back，理由更强：

- semver 语义上 v1.0 = "API 稳定 + production-ready"，跟 first ship 的实际成熟度不匹配
- CLI 公开契约（agent-api.md）几乎一定要 iterate，schema 第一版会踩坑
- Supervisor SOP / Skill 要靠真实 scenario 跑出来才知道哪里别扭
- "v1.0" 心智反而让人不敢改 schema / 修 bug，慢性害人
- v0.5 → v1.0 之间留 v0.6/0.7/0.8/0.9 四个版本号给真实 iteration，每次发版都名正言顺

**接受 v0.5**。所有 v1.0 引用 cascade rename 到 v0.5，PRD / CLAUDE.md 阶段表 / refactor/ playbook 全部同步。

### D13. CLI prototype throwaway 验证（先于 B1）

**目标**：2-3 天 throwaway，证明 Rust 持有 Python bridge 子进程的 stdin/stdout 行为跟当前 React 持有时**性能 / 可靠性 / 实时性等价**。

**详细 spec**：[desktop/src-tauri/experiments/bridge-owner/README.md](../../desktop/src-tauri/experiments/bridge-owner/README.md)

**Go/No-go**：所有 checklist pass + 延迟和吞吐数据不差 → Go，B1 启动。任一 fail → 把 fail mode 写到 devlog，回 brainstorm。

### D14. Telemetry: 明确 "no"

v0.1 隐含 no telemetry。v0.5 加 CLI 后理论上可以收"哪个命令调得多"做产品 insight。**继续 no telemetry，写进 PRD 显式条款**。

理由：跟 local-first brand 一致 + 开源项目用户审计代码会看到任何 phone-home 破坏信任成本远大于产品 insight 收益 + JC 自己 dogfood 就有反馈渠道。

### D15. SOP / Skill artifact 命名

- GA 平台：**Galley Supervisor SOP**（文件 `docs/integrations/galley-supervisor-sop.md`，可投到 fudankw.cn/sophub）
- Claude 平台：**galley-supervisor** skill（目录 `.claude/skills/galley-supervisor/`）

**SOP 安装路径走宪法条款 b**：宪法明确写出 "用户显式点击触发的 SOP 安装" 是例外，不属于 "Galley 偷改 GA 状态"。Galley Settings 可以提供 "把 SOP 装到你的 GA" 按钮——读 GA path 配置 + 把 sop.md 写到 `~/Documents/GenericAgent/memory/`。

### D16. v0.1 → v0.5 数据迁移：自动 migration（不抛弃）

v0.5 launch 时自动跑 schema migration 升级 v0.1 数据。Tauri identifier 保持 `app.galley` 不变（v0.1 用过的目录继续用）。

迁移要点（具体写 PRD §"Migration"）：

- 加新 column：`messages.created_via`、`messages.supervisor`、`messages.origin_note`、`sessions.created_via` 等
- 旧数据 `created_via` 默认 `manual`、`supervisor` `NULL`
- migration 号码 v0.1 用到 005，v0.5 起从 006 递增
- migration 失败 → app 拒绝启动 + 提示用户备份目录路径 + 联系方式

## Rejected alternatives

### "CEO mode" 这个名字（我引入的）

JC 直接 push back："其实不好"。理由：metaphor 重、雇佣 / 阶层暗示、不需要类比就能直接描述（"agent-driven operation" 中性准确）。**接受**。所有出现 "CEO mode" 的地方一律改 "agent-driven operation" 或 "supervisor scenario"。

### MCP server 作为主路径

最初提议 Galley 暴露 MCP server 给上层 agent 调。Brainstorm 中扒了 GA 源码后否决：

- GA 没有 MCP client（唯一 mcp 字样在 ACP bridge `mcpCapabilities: {http: false, sse: false}` 明确说"我没有 MCP"）
- 给 GA 加 MCP client = 改 GA = 违反非侵入宪法
- GA 是 shell-native（`do_code_run`），CLI + JSON 输出是它的母语
- CLI 是 universal contract，MCP 可以将来作为 wrapper 加在外面；反过来不成立

**接受 CLI 优先 MCP（可能将来加为 wrapper）**。

### Approval routing 作为 CLI 核心价值

我提议过 "approval routing to phone is the killer use case"。JC push back：他不在乎 approval，GA 官方根本没有 approval 系统，Galley v0.1 默认 YOLO。**这条假设作废**。CEO 模式（agent-driven）才是核心，不是 approval。

### 路径 A（Rust 中继到 React）

我前面 push 过 "A first 验证后再 B"。JC 论据让我改主意（D3 详）。**接受走 B**。

### Long-lived refactor branch

我建议过开 `refactor/galley-core` long-lived 跟 main 并行。JC push back：v0.1 后停发版直到 v0.5，main 不需要保 releasable，branch 隔离价值消失。**接受 main 上重构**。

附带 reject 的工程 trap：

- 双 Galley 安装（main + next 不同 identifier）—— 不需要了
- 周五固定 merge main → branch 仪式 —— 不需要了
- migration 号码 main / branch 分段 —— 不需要了

### 远程 auth in v0.5

讨论过给 CLI 加 token / TLS 支持远程 supervisor。**否决**：远程是 supervisor 在外部传输层的责任（IM frontend / SSH），Galley 永远 localhost。**升级为宪法条款**。

### 存 supervisor ↔ human 对话

讨论过给 Galley 加 "supervisor session" 一等公民（GUI 里能翻看你跟 supervisor 聊的全对话）。否决：

- 数据已存在（IM scrollback + supervisor 自己 history）
- 推 Galley 从 orchestrator 滑到 chat platform
- 一开口子就要解决：GUI 双向回复？跨 supervisor 隔离？deletion 语义？sync？
- 换 supervisor 丢 context 是用户已接受的 trade-off

**只存动作 + reason，per-session 行动日志**（D10）。

### "Galley 不开时 CLI 走 SQLite 直接读"

讨论过让 CLI 在 Galley GUI 完全 quit 时仍能跑只读命令（直接读 DB）。**否决**：

- 用户心智复杂化（什么命令能跑什么不能跑）
- background mode 已经够轻（menubar daemon 是用户能接受的常驻形态）
- 写命令必须有 daemon，读命令也走 daemon 体验一致

**接受**：Galley Core 没在 background 跑 = CLI 全部命令报错 "Open Galley first"。

### 设计规范分类

- ~~给 CLI 加 DESIGN.md 章节~~：DESIGN.md 是 GUI 视觉设计，CLI 不进
- 但 ~~"不写 CLI 设计规范"~~ 也不对：schema 稳定承诺 / 错误模型 / 命令 grammar 都是规范

**最终方案**：起单独的 [docs/agent-api.md](../agent-api.md)，给 Supervisor adapter / SOP 作者看，是 Galley 对 agent 生态的公开契约。

### pet attach / detach 进 CLI

Supervisor 不会用桌宠功能，砍。

### Telemetry 收用量 insight

虽然 v0.5 加 CLI 后可能想知道"哪个命令调得多"，否决——跟 local-first brand 一致。

## Open questions

### O1. Discovery file 具体路径

CLI path discovery file 走 `~/.config/galley/cli-path`（XDG style，Linux 友好）还是 `~/Library/Application Support/app.galley/cli-path`（macOS 原生约定）？倾向 XDG 风格（跨 OS 一致，supervisor SOP 不用做平台分支），但 macOS 原生 reviewer 可能皱眉。B4 决定。

### O2. CLI watch 命令的 filter 语法

`--filter=step_start,step_end,tool_call` 是 enum 列表？还是更灵活的 query DSL？v0.5 起步用 enum 列表（实现简单 + agent 容易用），v0.6+ 看需要再扩。

### O3. `--reason` 长度上限

freeform 字符串 + 写进 SQLite，理论上无限。但 supervisor 可能塞进整段聊天 transcript（context 太满）。设软上限 ~1000 字 + 超过截断？或不限制让 supervisor 自己 SOP 控制？v0.5 不限制，dogfood 收信号。

### O4. background mode 跟 Tauri WebView 生命周期

路径 B 下 Galley Core 是 Rust，WebView 不再持有权威。但 Core 进程跟 Tauri 窗口绑定的 lifecycle 还有待验证——能不能 "close window 不退出 process"？background mode 下 webview 是否 destroyed？这影响 GUI 重开时的 state recovery。Prototype 之后 B1 first task。

### O5. 多 Supervisor 协作

JC 提到将来可能多个 supervisor 协作（一个总督、一个轮值）。v0.5 不支持 (supervisor 只是 freeform 标识)，但如果有信号要做，怎么演进？分支：

- A. 加 `supervisor_registry` 表，supervisor 注册后有 capability declarations
- B. 不做注册，但 CLI 加 `galley supervisors list` 看历史调用过的 supervisor 列表

倾向 B（轻量、跟"不校验"原则一致），但 v0.5 不实施，留观察。

### O6. CLI exit code 5 (bridge error) 跟 4 (backend unavailable) 边界

bridge spawn 失败但 Galley Core 在跑 → 5？还是 4？协议中要明确，B2 实施时定义。

### O7. README screenshots / 营销

v0.5 ship 时 README 要更新 screenshots + 卖点。CLI 没有 screenshot 怎么展示？也许 asciinema 录一段 supervisor session 流程？B4 polish 时做。

### O8. Galley Supervisor SOP 投 sophub 的时机和流程

JC 提过 fudankw.cn/sophub 是 GA 社区 SOP 中心。Galley v0.5 ship 后什么时候投？投了之后维护更新怎么处理？等 v0.5 ship 之后再询问 sophub 维护者。

### O9. GA baseline 是否再升

v0.2 Windows release 跟 B 重构之间会不会再升 GA baseline？理论上不强制——baseline 在 6bb3104，bridge 已经做 feature detection 双向兼容，可以保持稳定。但 GA upstream 如果有重要 fix 会按 [Baseline Upgrade Workflow](../../CLAUDE.md) 评估。**Open**：保持现 baseline 还是 v0.2 前主动升一次？

## Next

**已完成（本 devlog ship 同 commit）**：

- [PRD v0.3](../PRD.md) 升格为 active（替代 v0.2，v0.2 保留在 git 历史）
- CLAUDE.md 增加 localhost-only + CLI 公开契约面两条宪法条款（按 D6 + D8 + D15 SOP 安装例外）
- CLAUDE.md 阶段表加 3.10 vision pivot + 4 v0.2 Windows + 5 prototype + 6-9 B1-B4 + v0.5 节点
- **[docs/archive/refactor/](../archive/refactor/README.md) 重构执行手册落地** —— 跨多 session 重构的中央调度器：[README 索引 + cursor 总指针](../archive/refactor/README.md) / [invariants 跨 phase 硬规则 10 条](../archive/refactor/invariants.md) / [B1 详细 playbook](../archive/refactor/B1-rust-core.md) (~40 sub-tasks，cursor 指向 T1.1) / B2/B3/B4 stub（接近时 dedicated session 升级成完整）

**待做**（后续 session）：

1. **同时启动** [prototype 实验](../../desktop/src-tauri/experiments/bridge-owner/README.md)（2-3 天 throwaway）
2. v0.1 Mac .app / .dmg 出包工作（独立线）
3. v0.2 Windows release（继承 Y plan + A items）

**不在本次 brainstorm 范围、但被勾出来的事**（留作 future devlog）：

- 项目宪法 SOP 安装条款 b 的精确措辞（D15 一句话就够，但宪法语境要严谨）
- v0.2 Windows release 跟现有 Y plan / A items 落地 commit 的接续（[release-ci-menubar-icon-screenshots devlog](./2026-05-15-release-ci-menubar-icon-screenshots.md) + [win-prep-y-plan-custom-chrome devlog](./2026-05-15-win-prep-y-plan-custom-chrome.md) 是本次跳过去的上下文）
- v0.5 release 后的 marketing / 社区投放
- DESIGN.md 是否需要"dual-native 原则"一节，把 GUI ↔ CLI 设计哲学链接起来
