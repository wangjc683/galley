# 写过的文件按名可点，写入步骤自带入口：bridge 明知绝对路径却没记下来

日期：2026-09-17
状态：已落地（runner + core + GUI）。`turn_end.toolCalls[].resolvedPath` 增量字段；
settled 写入 pill 的打开按钮与展开体路径引用；回复正文相对路径 / 裸文件名对本会话
已写文件的严格匹配；Goal 三份模板加「交付物写绝对路径」。
相关：[本地文件预览](./2026-09-08-local-file-preview.md) 定的「不猜基准目录」边界
不动；[阅读面板扩展](./2026-09-09-reading-panel-files-and-git-baseline.md) 补节的
提示词条款仍在；deferred「Session Workspace」的一条实施要点提前落地。

## 起因

JC：汕尾旅游那个 Goal session（`s-mu3wxz86-pj1q`，managed，glm-5.3-flash）收尾时
交付物写的是 `./汕尾旅游指南.md`，在 Galley 里点不开；追问「md 文档在哪个具体
位置」后模型给出完整路径，才能在右侧阅读面板预览。「这个体验并不好。」

## 诊断：三段机制，病根在中间那段

1. **提示词侧已经管过一次。** 09-09 为同类问题（模型写裸文件名）在 managed 提示
   词加了「Files You Create」条款。这次 session 条款在场，模型在 52k 上下文的
   Goal 收尾仍写了相对路径。软约束在弱模型 + 长任务收尾会丢，可预期。
2. **GUI 侧故意不猜。** 文件引用只认绝对路径、`~/`、`file://`。09-08 的理由
   「聊天里没有可靠的基准目录，猜错比不识别更坏」成立，边界不该动。
3. **基准其实是确定的，只是没人记。** GA `file_write` / `file_patch` 用
   `abspath(join(handler.cwd, path))` 落盘，`handler.cwd` 是 `state_path('temp')`，
   bridge 在工具调用现场精确知道文件去了哪，却只回传
   `{"status":"success","writed_bytes":4389}`。ReadyEvent 的 `cwd` 是进程目录
   （state root）不是文件基准（state root/temp），`sessions.cwd` 列为空。

数据说不了太多：workbench.db 里 `file_write` / `file_patch` 共 18 次、10 个不同
交付物，09-09 之后只有 2 个（一个用户指定了 Downloads 目录，路径天然完整；另一个
就是汕尾）。且 `file_write` 是代理指标，temp 目录 77 个文件大多经 `code_run`
产生。所以按机制推，不按统计推。

## 三条路，按层次

- **A. 提示词加压**：Goal 模板再说一次。最便宜，但已证明软；只当保险。
- **B. bridge 现场解析进档案**：`resolvedPath` 写进 tool_calls，Core 原样持久化。
  GUI 两处消费——过程区写入步骤直接可开（不依赖模型写对路径）；正文里与本会话
  已写文件精确匹配的相对路径 / 裸文件名解析到该绝对路径。**查表不是猜基准**，
  09-08 边界不破。缺口：`code_run` 产物不覆盖。这正是 deferred「Session
  Workspace」8 月定的实施要点之一，当时整个 feature 暂缓。
- **C. Goal 收口标记下列交付物**：从 B 的记录取本 run 写过的文件。deferred 否过
  「轮尾产物清单」——`file_write` 只占产出少数，漏掉大半的清单比没有更坏；对
  Goal 场景仍成立，除非做文件系统快照 diff，那是 Session Workspace 整个 feature。

推荐 B 带 A，C 等 Session Workspace。JC：「按 B 推进，四点都按你的倾向」——
覆盖只到 `file_write` / `file_patch`；匹配严格；过程区步骤做入口；顺手加 A。

## 落地

**runner**：`_on_turn_end` 从 GA 传入的 loop locals 取 `ctx["self"]`（那是活的
`GenericAgentHandler`），把 `handler.cwd` 交给 `_serialize_tool_call`；模块级
`_resolved_file_path` 镜像 GA `_get_abs_path`，只对两个写文件工具、只在有
handler cwd 时产出。没有 handler（测试构造）记录不变。单测覆盖相对 / `./` /
绝对输入、非写工具、无 cwd 四种。

**core**：`tool_calls: Vec<Value>` 透传，零改动。`goal_prompts.rs` 的
`SHARED_RULES`（objective + continuation 共用）与 `budget_limit_prompt` 各加一句
「交付文件以行内代码写完整绝对路径」，测试断言三份模板都带。

**GUI**：
- `ConversationToolEvent.resolvedPath`，`toolEventsFromRaw` 只在字符串非空时带上，
  live 与 restore 同一套。
- `lib/written-files.ts`：`buildWrittenFileResolver(turns)` 索引 key = 归一化的
  `args.path`（去 `./`、反斜杠转正）和 basename，值 = `resolvedPath`；同一 key 指向
  两个不同文件即标 ambiguous、永不解析。`WrittenFilesContext` 由 `Conversation`
  根节点提供（`useMemo` 随 turns 重建）。
- `FileInlineCode` / `FileAnchor`：绝对路径优先，其次问 written resolver；文档内
  预览（`documentPath` 存在）的相对链接仍走文档相对解析，不问会话。
- `InlineToolPill`：settled 写入步骤行尾一颗 `IconButton`（可预览→`FileText` 进
  阅读面板，否则 `FolderOpen` 定位），点击直接 `activate(resolvedPath)`；展开体
  首行 `LocalFileReference` 列完整路径。button 不能嵌套，按钮是 toggle 行的兄弟；
  有按钮时行不再 `flex-1`，让按钮贴 caret（09-16 孤立控件教训）。

**文档**：IPC §4.7 字段说明、conversation.md「本地文件引用」两条、deferred
Session Workspace 补「部分落地」、project-status 未发布段。

## 边界与已知缺口

- `code_run` 写出的文件没有 `resolvedPath`，回复里若只写相对路径仍是文本。这是
  Session Workspace 的问题域，不在本轮扩。
- 匹配只认相对写法和 basename 的完全相等，`temp/汕尾旅游指南.md` 这种带了一段
  真实目录但不是模型原写法的引用不解析——宁可漏。
- 老 session 的 tool_calls 没有该字段，行为与之前一致。
- attach 模式的 bridge 同样走这条路（是读 handler 状态不是写 GA 文件，宪法
  Rule 1 允许的只读耦合点）；提示词条款仍只在 managed。

## 方法

- **「模型没写对」不等于「只能靠模型」**：先问系统里谁已经知道正确答案。这次
  bridge 早就知道，缺的是一条记录。
- **旧边界要拆开看它挡的是什么**：09-08 挡的是「猜基准」，查表不是猜，所以能做。
- deferred 里的大 feature 有时可以只拎一条实施要点先落地；把这一条标回台账，
  别让下次重做。
