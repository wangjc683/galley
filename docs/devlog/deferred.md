# 挂起的想法（Deferred）

想清楚了、留了方案、但决定暂不实施的想法都记在这里 —— 一想法一节，等启动信号再开工。

与时间线的分工：[时间线](./README.md) 记「已发生的历史」（不可变）；本台账记「想做但还没做的事」（会增删）。真正开工时，把对应小节从这里拎出来、落成一篇正式 devlog entry，并从本台账删掉。

每节固定字段：**状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联**。

---

## 自动滚动到最终答案开头（scroll-on-completion）

- **状态**：暂存
- **提出**：2026-05-13
- **启动信号**：beta / 公测用户反馈「每次长答案出来都要手动往上滚才能开始读」是高频痛点。
- **方案（E）**：默认 read mode；流式期间不做 stream-follow（用户可手动滚到底 opt-in watch mode）；`run_complete` 时 smooth scroll 把最终答案开头（`[data-role="final-answer"]` wrapper）定位到 viewport top + 32px。这个 scroll 动作本身同时充当「GA 完成了」的视觉信号。
- **实施要点（约 5 处小改）**：
  1. `Conversation.tsx` AgentTurnView：给 final turn 的 MessageAgent 套 `<div data-role="final-answer">`
  2. `useAppStore.ts`：加 `runCompleteTick: number`（初值 0）
  3. `ipc-handlers.ts` 的 `run_complete` case：`runCompleteTick + 1`
  4. `MainView.tsx`：加 useEffect 监听 tick，RAF 后 smooth `scrollBy` 到 final-answer（复用 `userSubmitTick` effect 的位置计算逻辑）
  5. `MainView.tsx` stream-follow effect：删掉提交后 `atBottom` 自动翻 true 的隐含行为
- **待定**：用户主动 scroll 中遇 `run_complete` 是否强制 snap（倾向 snap）；smooth 时长 200-300ms 未实测；anchor 用 MessageAgent wrapper 还是 StrongHr（倾向前者）。
- **关联**：原讨论已并入本节（原 `2026-05-13-scroll-on-completion-deferred` entry 已收编删除）。

---

## 已有对话 cwd live-sync（IPC `set_cwd`）

- **状态**：暂存
- **提出**：2026-05-13
- **背景**：Project 的 rootPath / cwd 绑定已于 2026-05-14 回收（见 [rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)）。DB column 与类型字段保留作 forward-compat —— 将来若重启 cwd 绑定，正解是这条 live-sync，而不是让用户重启 app。
- **启动信号**：beta / 公测有人反馈「改完项目路径要重启 app 才生效」是高频痛点。
- **方案**：bridge 加 IPC 命令 `set_cwd { path }` → 收到后调 `os.chdir(path)`（OS 级 API，真改进程 cwd）→ 之后 GA 的 `file_read` / `code_run` 相对路径解析与 subprocess 继承自动用新路径，无需重 spawn。desktop 端在保存 project rootPath 时，自动给该 project 下所有 alive bridge 派发 `set_cwd`。约 200-300 行。
- **实施要点**：bridge `set_cwd` handler + `ipc.py` dataclass + `ipc-protocol.md` 文档 + bridge 测试 + desktop `updateProject` 里自动派发。
- **待定**：GA 内部工具是否 cache 启动时 cwd（需 audit `ga.py`）；`os.chdir` 失败（路径不存在 / 无权限）的错误回滚链路；派发时机应在 save 按下时而非每次输入。
- **关联**：[Project rootPath 回收](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)。原讨论已并入本节（原 `2026-05-13-project-cwd-copy-and-live-sync-deferred` entry 已收编删除）。
