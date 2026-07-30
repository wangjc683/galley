# PRD: Composer 文件拖放引用（File Drop → Path Reference）

Status: ready-for-agent
Date: 2026-07-29（同日 JC 裁决全部待定点，issues 已拆分，见 `issues/`）
来源: JC 与 agent 的设计讨论（本文件是讨论结论的沉淀，尚未开始实现）

## 背景与动机

Galley 的 agent 与用户在同一台机器上、自带文件读取工具。现有工作流里用户想让
agent 处理某个本地文件时，需要手动复制粘贴绝对路径。本 feature 把这一步降级为
「从 Finder 拖一下」。

核心语义判断：对本地 agent，非图片文件的正确模型是**引用（路径）而非上传（内容）**
—— 这与 claude.ai 等远程场景的附件模型有本质区别。图片是唯一例外，因为多模态
调用需要真实图片内容，且图片附件管线（拖放/粘贴/📎 → 持久化 → bridge
`put_task(images=...)`）已经完整存在。

已否决的备选（记录避免回锅）：

- **附件 chip（发送时序列化为路径）**：Composer 是普通 `<textarea>`，内联 chip
  需迁移 contenteditable；条式 chip 会与图片附件并排出现两种语义不同的 chip
  （内容 vs 引用），用户无法区分"这个会被发上去吗"。
- **非图片文件做成真附件（内容进消息）**：重复本地 agent 已有能力；要动附件
  schema、Rust MIME 白名单、bridge 按图片命名的 `images=` 参数；大文件 base64
  过 IPC 不可接受；且 bridge→GA 多模态链路本身尚未 e2e 验证
  （`docs/ipc-protocol.md:759`）。
- **`~` 缩写路径**：把显示优化变成语义变化，展开与否取决于 GA 工具的路径处理，
  不值得赌。

## 用户故事

> 我想让 agent 处理某个本地文件。我把它从 Finder 拖进输入框，输入框在光标处
> 出现 `[File #1: report.pdf]` 占位符，我接着打一句"帮我看看这个"，发送。
> 消息里占位符已展开为完整绝对路径，agent 用自己的文件工具去读。

拖入文件**不代表授权读取**：GA 自身的工具审批流程照旧生效，信任模型不变。

## 定案决策

### 1. 分流规则：图片走附件，其余一切走路径占位符

- 图片（PNG/JPEG/WebP，现有白名单）：进现有图片附件条，走多模态。用户视角
  行为不变。
- 其他文件与**文件夹**：光标处插入占位符，提交时展开为绝对路径。文件夹是
  自然加分场景（"帮我整理这个目录"）。
- 混拖（图片 + 其他文件）：各走各的，同时生效。
- 规则刻意简单可预测。"想要图片的路径而非内容"的需求 v1 不做（未来可考虑
  修饰键强制路径）。

### 2. 占位符机制：复用 paste-fold 设施

Composer 已有成熟的「占位符 → 提交时展开」机制（`lib/composer-paste.ts` +
`hooks/usePasteFold.ts`）。文件引用完全沿用其约定：

- 固定英文格式：`[File #N: name.ext]` / `[Folder #N: name]`。与
  `[Pasted text #N +M lines]` 同理，占位符是插入正文的文本，必须
  locale 无关才能在提交时可靠匹配（i18n 切换不能破坏展开）。
- `#N` 计数器解决同名文件（不同目录的 `config.json`）撞名。
- 继承「手动编辑优先于静默展开」规则：用户改动占位符内部文字则不再展开，
  原文保留。
- 占位符 → 完整路径的 registry 与 paste-fold registry 同层管理，随
  composer draft 的 park/restore（`lib/composer-draft.ts`）一起存活，
  跨 session 切换不丢。
- 发送后的消息气泡显示展开后的完整路径（用户事后可查全路径）。

### 3. 展开格式

- 绝对路径；含空白字符时加双引号，否则裸路径（GA 读自然语言，不发明
  `@file` 新语法）。
- 多文件一次拖入：多个占位符以空格分隔插入。
- Windows 路径保持反斜杠原样。

### 4. 技术前提：`dragDropEnabled` 翻转 + 图片拖放迁移

`core/tauri.conf.json:29` 现为 `dragDropEnabled: false`（HTML5 drop 拿内容
不拿路径）。拿真实路径必须翻成 `true` 改用 Tauri 原生 `onDragDropEvent`
—— 这会让现有 HTML5 图片 drop 失效，因此图片拖放**必须同步迁移**：

- 原生事件拿路径 → 图片扩展名的经 `plugin-fs` 读字节 → 喂回现有
  `acceptImageFiles` 管线（`hooks/useImageAttachments.ts`），下游不动。
- 粘贴图片、📎 选图片不经 drop 事件，不受影响。
- 原生事件是窗口级带坐标的，需 hit-test / 视图状态判断，复用
  `ComposerDropOverlay` 做视觉反馈。

### 5. 双入口（拖放为主，picker 为辅）

📎 增加「引用文件…」入口，经 `plugin-dialog` 原生选择器（已在依赖中，
返回真实路径）走同一段占位符插入逻辑。服务不爱拖拽 / 全键盘流用户，
边际成本低。与拖放同期交付（v1）。

### 6. 边界与超限行为

- 图片超限（>4 张或 >10MB）：维持现有 toast 拒绝，**不**静默降级为路径
  插入（降级会让"拖图片"的结果不可预测）。
- 非图片文件无超限概念：全程只是往 textarea 插入纯文本，不经 IPC、不落库。
  一次拖入超多文件只是消息变长，v1 不做特殊处理。
- 接收范围：会话视图内**整窗接受**，overlay 提示落在 composer 上（目标区大、
  好命中）。拖放生效时机与"能否打字"一致：composer 可输入的状态即可拖入。
- Settings 等无 composer 的界面忽略 drop。

### 7. 范围声明

纯 GUI feature。不动 Agent API / CLI（Rule 3 不涉及）、不动 IPC 协议、
不动数据库 schema、不动 Rust 命令面。attach / managed 两种 GA 模式行为
一致（都只是往消息文本里放路径）。

### 8. 已接受的体验损失：文本拖拽（2026-07-29 JC 裁决，源自 issue 01 spike）

`dragDropEnabled: true` 后 Tauri 原生 handler 无条件消费一切外部拖拽
（上游长期限制，tauri#2014/#14373，无配置可两全）。明确接受：

- 从外部应用拖文本/URL 进输入框失效（替代：复制粘贴，粘贴能力不变）。
- 输入框内部拖动选中文字挪位置失效。
- 缓解：收到 `paths: []` 的 Drop 时弹 toast「不支持拖入文本，请复制粘贴」，
  把静默失效变成有解释的失效。
- backlog 备选（不进 v1）：macOS 读 `NSPasteboard(.drag)` 兜回文本。

### 9. 发现性：空稿 footer hint，永不退休（2026-07-29 JC 裁决，issue 06）

拖放能力的三个教学面：拖放 overlay（意图时刻）、📎 菜单（可见入口）、
footer hint（空稿空闲时显示「拖入任意文件或文件夹即可引用其路径」，打字
后交接回 Enter 图例）。hint 按状态交接而非定时轮播（轮播即闪烁噪音）；
与 Enter 提示同语义——"当下为真的能力图例"，永不退休、无持久化状态。
已否决：常驻 placeholder 文案、粘贴路径检测（backlog）、onboarding 蒙层。

## 技术风险与验证清单

- [x] **早期 spike**：`dragDropEnabled: true` 后文本/URL 拖拽会被原生事件
      吞掉（源码级确认，两平台一致）。已裁决接受，见定案 8 与
      `issues/01`。
- [ ] 图片拖放回归：macOS + Windows 都要过（Windows 侧有过 composer focus
      的历史问题，见 `.scratch/win-composer-focus/`，注意交互）。
- [ ] EmptyState（未建 session）的 Composer 同样生效（组件共享，两条发送
      路径 `sendUserMessage` / `submitFromEmpty` 都要过展开）。
- [ ] `/btw` side question 前缀判定在展开后文本上仍正确（前缀判定，预期无碍，
      加用例即可）。
- [ ] draft park/restore 后占位符仍可展开。

## Issue 拆分

见 `issues/`：① spike（dragDropEnabled 翻转 + 文本拖拽验证）→ ② 原生 drop
事件接入 + 图片管线迁移 → ③ 文件占位符插入/展开（纯函数层可与 ② 并行先做
单测）→ ④ picker 入口 → ⑤ Windows smoke 验证轮。

## 待定问题的裁决（2026-07-29，JC）

1. **picker 入口**：与拖放同期进 v1（已并入定案 5）。
2. **拖放接收范围**：会话视图内整窗接受、overlay 落在 composer（已并入定案 6）。
3. **图片超限不降级**：确认维持 toast 拒绝。另确认非图片文件无超限概念
   （纯文本插入，已并入定案 6）。
4. **Windows 验证**：agent 跑 Windows smoke 清单即可；JC 在发新版本时再做
   Windows dogfood 终验。
