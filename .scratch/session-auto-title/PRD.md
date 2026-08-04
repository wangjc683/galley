# PRD: 会话自动标题（Session Auto-Title）

Status: ready-for-human（2026-08-04 已实现，全量验证通过，待 JC 真机 dogfood 验收）
Date: 2026-08-03（JC 与 agent 设计讨论定案）；2026-08-04 实现完成并勘误（见「实现勘误」一节）
关联: `.scratch/composer-next-suggestion/`（同一轮讨论的姊妹 feature，机制完全解耦，本 feature 先行）

## 背景与动机

会话的种子标题是字面量「新对话」（`gui/src/stores/sessions/lifecycle-slice.ts:66`），
连首条消息截断都没有。用户不手动重命名，会话列表就是一排「新对话」，规模一大
列表基本失效。痛点真实且高频。

Galley 今天在产品路径上没有任何自动辅助 LLM 调用（无自动标题、无自动摘要），
本 feature 是第一个，因此机制选择要格外克制。

已否决的备选（记录避免回锅）：

- **F1 复用 GA 的 `<summary>` 标签当标题**：零成本，但 summary 是「这轮做了
  什么」而非「这个会话关于什么」，措辞与语言不受控。JC 裁决：要搞就搞质量
  好的（2026-08-03）。
- **F3 首条用户消息截断**：只是把「新对话」换成一句可能很长的原话，价值有限。
- **G2 通用 side-ask 座位**（把 `/btw` 泛化成正式的通用辅助调用设施）：标题
  不需要历史 deepcopy 与加锁（见定案 1），为单一乘客建通用设施违背「不为
  投机需求建抽象」。将来出现第二个确定乘客再议。
- **可配置生成模型 / 自动降级小模型**：每会话一次、上下文几百字符、
  `max_tokens≈30`，成本几厘钱量级，省钱论证不成立；session 当前模型是唯一
  保证密钥有效、配额未爆、连通已证的模型，另配模型引入独立故障源；attach
  模式下模型清单属于用户的 GA，Galley 无从判断哪个「便宜」。设置项加了就
  删不掉，反方向永远是增量的——无证据不开设置面。

## 用户故事

> 我开了个会话问了个问题，agent 答完。我没做任何事，侧栏里这个会话的标题
> 已经从「新对话」变成了「登录超时 bug 排查」。我手动改过名的会话、
> supervisor 建的会话，永远不会被动过。

## 定案决策

### 1. 生成机制：runner 侧直接 `raw_ask`，不依赖 `btw_cmd`

首次 run 结束后 agent 处于空闲态，runner 直接对
`agent.llmclient.backend.raw_ask` 发一个**自行构造的小消息**（专用标题
prompt + 首条用户消息截断约 500 字符 + 最终回复摘要），`max_tokens≈30`，
短超时。不需要 `/btw` 那套历史 deepcopy 与锁（那是为运行中提问设计的），
因此**没有 `btw_cmd` 版本降级问题，attach / managed 两模式行为一致**。

`backend.raw_ask` 是既有耦合点（`core/src/runner_commands/probe.rs:77-104`
连通性探针已用同一路径），只读不写 GA 状态，符合 Rule 1；实现时在耦合点
文档处补记本用途。

标题 prompt 要求：≤15 字概括会话主题、跟随会话主要语言、只输出标题本身。

### 2. 编排：core 侧驱动（Rule 5）

首次 `run_complete` 时由 core 判断：标题仍为种子态（见定案 3）→ 向 runner
发新 IPC 命令（`generate_title`）→ runner 返回结果事件 → core
`rename_session` 落库（SQLite 写入权在 Rust，`core/src/db/session.rs:623`）
→ 广播 session 更新，GUI 只管重渲染。core 侧编排保证 GUI 忙碌 / 窗口失焦
时同样生效，且写入权威不外流。

### 3. 覆盖规则：只有 GUI 种子默认标题有资格被替换

- 新增 `title_source` 标记列（一次 DB migration）。GUI 创建会话时标记
  seed；用户手动重命名将其翻成 user；自动标题写入时标记 auto。
- 自动生成只在 `title_source = seed` 时发生。用户改过的名字永不覆盖。
- CLI / supervisor 按合同必须传非空标题（`core/src/api/session.rs:146`），
  那些是有意义的标题，创建时即标记为非 seed，不参与自动替换。
- 不用「标题字符串 == 新对话」判断种子态：本地化与用户恰好同名输入都会
  让它误判。

### 4. 触发与重试

- 每会话一次，首次 `run_complete` 后自动生成。
- 失败（超时 / 网络 / 模型错误）：本次静默放弃，下次 `run_complete` 再试，
  直到成功或用户改名。每次尝试极便宜，无需退避策略。
- 话题漂移不追、不重新生成。「手动重新生成标题」2026-08-04 JC 裁决先不加
  （清空标题已是隐藏重生成出口；真做需三个决策），条目连方案见
  `docs/devlog/deferred.md`。

### 5. 模型与配置：session 当前模型，零配置

用 session 当前 backend（`raw_ask` 天然如此），不提供模型选择项，不提供
开关。理由见「已否决的备选」末条。将来若 managed 模式引入全局「辅助任务
用小模型」策略（core 已有凭据管理，`managed_model_probe.rs` 先例），届时
作为产品级决策统一改，不由本 feature 预支。

### 6. 范围声明

- IPC 协议：新增 `generate_title` 命令 + 结果事件，纯增量，更新
  `docs/ipc-protocol.md`。
- DB：一次 migration（`title_source` 列）。
- 不动 Agent API v1 语义（标题本来就是数据；若 CLI 查询面要暴露
  `title_source`，做 additive 字段）。
- GUI 无新 UI 形态：标题经现有 session 更新事件刷新即可。

## 实现勘误（2026-08-04）

实现时发现与本 PRD 定案不符、已按实际情况调整的点：

1. **「背景」段有误**：GUI 早已有首条消息截断标题（`maybeDeriveTitle`，
   `lifecycle-slice.ts:741`）——F3 其实已上线。因此 `title_source` 值域扩为
   **seed / derived / auto / user** 四态：derived（GUI 截断）与 seed 同样有
   资格被 LLM 标题升级，user 永不覆盖。`rename_session` Tauri 命令增加可选
   `titleSource` 参数（缺省 user；derive 调用传 derived）；清空标题回落
   「新对话」时重置为 seed。
2. **定案 3 的打标位置**：种子态判定收在 core 插入时（`title ==
   DEFAULT_NEW_SESSION_TITLE` → seed），而非 GUI 传标记——CLI `session new`
   不传标题时落同一常量，一处覆盖两条创建路径，Agent API 零改动。
3. **定案 2 的挂载范围**：v1 watcher 只挂 GUI spawn 路径
   （`runner_commands.rs::spawn_runner`）。socket 层 `HandlerCtx` 的窄
   `RunnerPort` seam 是有意隔离，不为 watcher 拓宽；CLI / Goal 会话按合同
   自带真实标题，本就极少处于可升级态。详见
   `issues/03-core-auto-title-watcher.md`。
4. **GUI 零改动应用**：标题落库后经既有 `session-updated-external` 事件
   广播 brief，GUI 的 `applyExternalSessionUpdated` 原样消化，会话列表侧
   无新代码。
5. **竞态复核实现为 CAS**：`try_apply_auto_title` 单条条件 UPDATE
   （`WHERE title_source IN ('seed','derived')`），无需先查后写。

## 技术风险与验证清单

- [ ] `raw_ask` 调用必须与会话 runner 主状态隔离（独立线程 / 完整
      try-except）：标题失败绝不能影响会话本身。
- [ ] 竞态：标题生成在途时用户立刻发第二条消息 / 改名 / 归档 / 删除会话。
      写入前 core 需复核 `title_source` 仍为 seed 且会话仍存在。
- [ ] attach 模式下不同版本外部 GA 的 `llmclient.backend.raw_ask` 签名
      一致性（probe 已依赖同一接口，回归即可）。
- [ ] 模型输出不守规矩（超长 / 带引号 / 带前缀）：落库前做裁剪清洗。
- [ ] migration 对存量会话的回填：存量「新对话」标题标为 seed（可享受
      自动标题），其余标 user（保守：宁可漏标不可错标）。存量本地化差异
      按当时种子文案清单匹配。
- [ ] 耦合点文档：Rule 1 允许的只读耦合需记录，补 `raw_ask` 用途说明。

## Issue 拆分

待拆。预计切法：① migration + `title_source` 语义（含存量回填）→
② runner `generate_title` 命令实现（prompt + raw_ask + 清洗）→ ③ core
编排（触发判断、重试、竞态复核、落库广播）→ ④ 回归（attach + managed、
CLI 建会话不受影响）。
