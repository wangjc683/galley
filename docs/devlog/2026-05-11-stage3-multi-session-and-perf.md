# Stage 3 multi-session：N-active 架构 + useShallow 踩坑 + LRU 5 决策

> Date: 2026-05-11
> Status: in progress — Task 2 (Multi-session) 核心架构完成（6 个 commit）；Task 2 polish + Task 2.5 LRU 5 + Task 3 Session Restore 待做
> Related: [PRD §6.1 七件事](../PRD.md) · 上一篇 [2026-05-09 Stage 3 #1 端到端真跑](./2026-05-09-stage3-end-to-end-and-ux-polish.md) · 论文 `GenericAgent2604.17091v1.pdf` · 教程 `hello-generic-agent.pdf`（两份 PDF 于 2026-05-20 仓库清理时移出 repo，现存 `~/Documents/galley-refs/`） · 调研对象 [dhdbv-cbs/genericagent-launcher](https://github.com/dhdbv-cbs/genericagent-launcher)

## Context

Session 开局是用户分享了两份新材料让我读完——GA 官方 arXiv 论文（47 页）和 Datawhale 出的 Hello Generic Agent 教程（106 页）。读完之后基于"理解了 GA 原生设计哲学"重新审视了一遍 Workbench 的设计方向，做了一波产品级 brainstorm（5 个 idea）。

然后从 Stage 3 七件事剩余的 6 件开始推进，按 `tool_events 持久化 → Multi-session → Session 恢复 → Onboarding → Settings → macOS bundle` 顺序。

Multi-session 是 Stage 3 工作量最大、决策最多的一块——架构（N-active vs 1-active）、性能（useShallow 反模式）、资源管理（LRU 5）三条线都在这里。社区已有一个开源 GA launcher（[dhdbv-cbs/genericagent-launcher](https://github.com/dhdbv-cbs/genericagent-launcher)），调研了一下他们的方案做对照。

## Decisions

### 1. Multi-session 走 N-active（多进程并存）

**架构选项**：

- **1-active**：单 bridge 进程，切换 session = 重启 bridge + 通过 `set_state` 命令注入目标 session 的 history。工程量比 N-active 小 30-50%。
- **N-active**：每个 session 一个独立 GA 子进程，切换只切 UI 焦点，所有 session 的 bridge 都在跑。

我最初推 1-active 因为工程简单。**被用户一票否决**：

> "目前 GA 重度用户都是多个 session 多个任务一起跑的，这方面体验一定要好，如果同一时刻只有一个 bridge 进程，后台 session 不能跑？那马上一票否决啊。"

这正好是 CLAUDE.md 项目宪法第一条——**用户体验优先级高于技术偏好**。我自己把它写在 instructions 里却在决策时违反，被用户当场提醒。

转 N-active 之后实际工程量只多 30-50%（侦察发现 bridge 层已经是 per-sessionId 设计，desktop 端只缺 SessionManager 容器）——不是我之前估的"复杂度上一档"。

Commit chain：
- `f9b4cf7` Store per-session 重构（基础）
- `ccb1ce4` createSession + activateSession + Sidebar 接线
- `91f95a7` Sidebar live status + bumpSessionAfterTurn
- `f694ba1` store-side enrichment fix（见 #3）

### 2. tool_events 持久化范围：v0.1 只做审批审计

`tool_events` schema 完整（pending / running / success / failed / waiting_approval / denied / cancelled），但 v0.1 只持久化**审批相关的两条**：

- `tool_call_pending` 到达 → INSERT 一行 `status=waiting_approval`
- 用户做审批决定 → UPDATE `approval_decision` + 终态（`denied` 或 `running`）

不持久化 tool 执行 completion（success/failed/elapsed_ms）。理由：conversation 渲染已经从 turn_end 的 toolCalls/toolResults 重建（持久化在 `messages` 表），独立 timeline 是 v0.2 工作（配合 Memory Inspector）。

Commit `46d62a9`，工作量小，最适合作为 multi-session 大重构前的热身。

### 3. useShallow 反模式 + store-side enrichment 解决

**问题**：Sidebar 需要显示每个 session 的实时状态（running / waiting_approval / connecting 等），数据来自 `_runtimes` map，但 sessions list 本身是另一份数据。

**第一版（错的）**：App.tsx 用 useShallow + selector 派生：

```typescript
const enrichedSessions = useAppStore(
  useShallow((s) =>
    s.sessions.map((session) =>
      enrichSession(session, s._runtimes[session.id]),
    ),
  ),
);
```

这是 zustand 文档 idiomatic 写法。**但 React 19 strict mode 下触发**：

- `The result of getSnapshot should be cached to avoid an infinite loop`
- `Maximum update depth exceeded` setState 死循环
- App 整页空白

**根因**：inline arrow selector 每次 render 是**新 reference**——zustand 内部 `useCallback([api, selector])` 看到 selector identity 变化每次返回新 callback → useSyncExternalStore 看到 getSnapshot 不稳定 → React 拒绝接受这个 snapshot → 无限重新评估。

**第二版（对的）**：派生逻辑放**写入路径（setter）**而非**读取路径（selector）**：

```typescript
function applyRuntimeUpdate(state, sessionId, updater) {
  const newRt = updater(state._runtimes[sessionId] ?? emptyRuntime());
  const out = { _runtimes: { ...state._runtimes, [sessionId]: newRt } };
  if (sessionId === state.activeSessionId) {
    Object.assign(out, projectionFrom(newRt));
  }
  // 关键：同步 sidebar 字段到 sessions row，但仅在真实变化时
  const session = state.sessions.find((s) => s.id === sessionId);
  if (session) {
    const newStatus = deriveSessionStatus(session, newRt);
    const newCount = newRt.pendingApprovals.length;
    if (session.status !== newStatus || session.pendingApprovalCount !== newCount) {
      out.sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: newStatus, pendingApprovalCount: newCount } : s,
      );
    }
  }
  return out;
}
```

这样：
- `sessions` array reference 在 turn_progress 流式更新时**保持不变**（status/count 没变）
- 组件用 plain `useAppStore((s) => s.sessions)` 默认 strict equality 即可
- 不再需要 useShallow
- React 19 strict mode 完全过

**教训**：Zustand 派生数据的最佳实践是放写入路径而非读取路径。zustand 文档的 useShallow + inline selector 在 React 19 strict mode 下不稳定。

Commit `f694ba1`，含完整解释的中文 + 英文注释。

### 4. LRU 5 多 session 资源管理策略（待实现）

修完 useShallow 之后用户跑通 dev 模式测试，提出新问题：

> "如果用户一天内打开了 10 个甚至 20 个新对话，这完全是很正常的使用场景。那这些对话目前是否会同时开启进程？感觉这样很不合理——性能损耗对整台电脑的压力太大了。"

确实——当前每个 session 一个独立 GA 进程（~150-300MB），20 个 session = ~6GB 内存。

**评估的策略**：

| 方案 | 实现 | 资源 | 后台支持 | 用户认知负担 |
|---|---|---|---|---|
| Idle auto-suspend（30 分钟无活动） | timer 检查 | 动态 | ✅ pin 防回收 | 中（要懂 pin） |
| **LRU 5 alive** | 最近 5 个 bridge 保持 | ~750MB-1.5GB 上限 | ✅ 5 个并行 | 低 |
| 用户显式 archive | 主动管理 | 用户决定 | ✅ 不主动 archive 的都 alive | 高（要管理）|

**拍板 LRU 5**：上限明确、资源可预测、UX 行为确定、无需用户思考。最近活跃的 5 个 session 保持 bridge alive，其他自动 suspend。切回 suspended session 时 auto re-spawn + 通过 `set_state` 命令注入历史（依赖 Task 3 Session Restore）。

**还没实现**——等 Task 3 完成后做（Task 2.5）。

### 5. Launcher 调研结论（给 Task 3 留参考）

社区开源 launcher [dhdbv-cbs/genericagent-launcher](https://github.com/dhdbv-cbs/genericagent-launcher) 的设计：

- **1-bridge 模型**：永远只有 `self.bridge_proc` 单个进程
- **多 session 通过 history 注入**：切换 session = 发 `set_state` 命令把目标 session 的 `backend_history + agent_history + llm_idx` 注入到同一个 bridge
- **不支持后台并行**：`_load_session_by_id` L2477 看到 `self._busy` 直接弹窗 `"忙碌中,当前还在生成,请先等待结束或手动中断。"` 拒绝切换

这正好是用户一票否决的 1-active 路线。**launcher 帮我们验证了 1-bridge 路线对"多任务并行"需求是 dead end**。

**但 launcher 的 `set_state` 协议是 Task 3 的现成参考**：

```python
{
    "cmd": "set_state",
    "backend_history": [...],
    "agent_history": [...],
    "llm_idx": int,
}
```

Task 3 Session Restore 可以直接复用这个协议——把 SQLite `messages` 表里的内容转回这个格式注入 bridge。

### 6. 早期产品讨论的设计撤回（沉淀为 Skill chip）

读完论文后做了一波产品级 brainstorm，我提议过一个 idea：检测到 GA 任务完成 → Composer 上方浮临时 chip `"✨ 沉淀为 Skill"`，用户点一下自动发送提示让 GA 沉淀。

用户反问"这个不是应该 GA 自己做吗？"——我自己重新查论文后**撤回了这个提议**：

- 论文 §12.3.1 明确：GA 引导模型在子目标成功 / 故障恢复 / 发现可复用模式时**自主调用** `start_long_term_update`
- 教程 §4.2 那句"GA 有时会忘记更新 L1"是 GA 模型稳定性问题，应该改 GA prompt/SOP 解决
- Workbench 加 chip 是补 GA 的窟窿——在 UI 层强化"用户需要提醒"的 anti-pattern，反而把 GA 的自主性降级
- 违反 non-invasive 原则的精神（虽然不违反字面）

修正版：Memory Inspector 里加温和视图——"最近完成的任务 vs 已沉淀的 Skill"——让用户**能看见**这个 gap 但**不打扰**，不替 GA 做事。

这个撤回值得记一笔，因为以后看代码会奇怪"为什么没做这个明显的好 idea"——答案是有意识地不做。

## Rejected alternatives

### 1-active bridge 架构

详见 Decision #1。用户体验上不可接受。

### PWA 替代 Tauri 桌面（早期讨论）

读完论文后讨论中，我曾推 PWA 路线作为初期选择（跳过 macOS 签名地狱 + 跨平台天然 + 跟 GA 自己 Streamlit 范式一致）。**用户保留 Tauri 桌面**：

> "从长远看，尤其是未来我还在考虑利用 GA 这个 MIT 协议的 Agent 框架开发 To B 端的垂直的行业 Agent，所以现在探索客户端还是有意义的。"

To B 垂直行业 Agent 需要的工程能力（代码签名、自动更新、安装包、跨平台分发、系统集成）在 PWA 路径上学不到。早期 To C 阶段练手，将来 To B 是熟练工。短期 macOS Gatekeeper 警告是真痛，但 GA 重度用户能接受（他们已经在跟 GA 的命令行 / Streamlit 弹窗打交道）。

### useShallow + inline selector

详见 Decision #3。zustand 文档 idiomatic 但在 React 19 strict mode 下 broken。

### Sidebar 主动提示沉淀 Skill chip

详见 Decision #6。违反 GA 原生哲学，撤回。

### Idle 30 分钟 auto-suspend

被 LRU 5 取代。LRU 上限更明确、资源更可预测、UX 更确定。

### 1-active "shutdown 旧 spawn 新"切换模型

跟 launcher 不同的另一种 1-active 实现（不用 `set_state` 而是真的杀进程重 spawn）。比 launcher 慢得多（每次切换 3-8s spawn 延迟），且仍然不支持后台。**两种 1-active 都死**。

## Open questions

### Task 2 polish 残留（小尾巴）

用户跑通测试时发现的 4 个未实现项，都是 v0.1 体验完整性需要但没做的：

1. **Session title 派生**：当前 `createSession` 硬编码 `title: "新对话"`——应该在用户发出第一条消息后用消息前缀（~20 字符）更新 session.title 并 persistSession
2. **Session summary 写入**：`session.summary` 字段（"Turn N · {one-line summary}"）从未被任何代码写入——应该在 `bumpSessionAfterTurn` 时用 GA turn 的 summary 写入
3. **llmDisplayName 同步**：当前 `llmDisplayName` 是 `DEMO_LLM_DISPLAY_NAME` 初始值，不被 `ready` / `llm_changed` IPC 事件同步——应该从 `llms` 中 `isCurrent: true` 派生
4. **切换 LLM 按钮接 IPC**：`SetLLMCommand` bridge 端已定义（[bridge/ipc.py L260-262](../../bridge/ipc.py)），desktop 端切换模型按钮没接

### Task 3 Session Restore 设计要点

参考 launcher `set_state` 协议：

- 数据来源：SQLite `messages` 表（已经持久化每轮的 toolCalls/toolResults/responseContent）+ `tool_events` 表（审批审计）
- 待做：messages 行转回 `backend_history` / `agent_history` 格式——具体格式要查 GA 源码
- 启动新 bridge 时：spawnBridge → 等 `ready` event → 发 `set_state` 命令注入 history
- 复用现有 IPC 命令：`load_history`（已定义在 `bridge/ipc.py`）或新增等价命令

### Task 2.5 LRU 5 实现细节

- LRU 队列管理 `_bridgeClients` Map
- 何时触发回收：每次 `activateSession` 后检查；或定时 ping
- "最近活跃"如何定义：上次 IPC event 收发时间？上次用户输入时间？
- 是否允许用户 pin 一个 session 防被回收？（暂定不做，看 LRU 5 实际效果）

### Memory Inspector（Stage 4 / v0.2）

之前讨论确定：
- 放 Sidebar 底部小图标 / Command Palette 入口
- 展示 L1 索引 / L2 事实 / L3 SOP / L4 归档
- 含温和的"最近 deny 历史" + "最近完成的任务 vs 已沉淀的 Skill" 视图

不是 v0.1 范围，但是 v0.2 一等公民差异化功能。

### 审批 = 教学接口（已对齐到最弱版本）

讨论结果：完全不主动提示，Memory Inspector 里能看到"最近 deny 历史"。用户自己想总结时手动总结。Stage 4 范围。

## Next

按计划顺序：

1. **Task 2 polish 收尾**（4 个小项）：title 派生 / summary 写入 / llmDisplayName 同步 / 切换模型按钮接 IPC——一个 commit 收尾
2. **Task 3 Session Restore**：参考 launcher `set_state` 协议，把 SQLite messages 转 backend/agent_history 注入新 spawn 的 bridge
3. **Task 2.5 LRU 5 实现**：基于 Task 3 之上的 history 注入能力——shutdown idle session + 切回时 auto re-spawn + history 恢复
4. **Task 4 Settings path picker**：让用户配置 GA 路径替换 `DEMO_GA_CONFIG` hard-coded
5. **Task 5 Onboarding real validation**：真跑 GA baseline + smoke test
6. **Task 6 macOS bundle**：出 `.app` / `.dmg` + 未签名分发文档

V0.1 七件事里这次干掉 #1（tool_events 持久化）+ 大部分 #2（multi-session 核心）。剩 #2 polish + #3-#7。
