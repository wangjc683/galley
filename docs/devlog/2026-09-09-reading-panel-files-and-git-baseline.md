# 2026-09-09 · 阅读面板扩展：可读文件预览 + Git 比较基线

> Status: implemented · Related:
> [本地文件预览](./2026-09-08-local-file-preview.md) ·
> [Git worktree review](./2026-09-08-git-worktree-review.md) ·
> [阅读面板打磨](./2026-09-08-reading-panel-polish.md) ·
> `docs/design/conversation.md`（两节）· `docs/agent-api/transports.md` ·
> [deferred：长工具输出全文阅读](./deferred.md#长工具输出在右侧阅读面板全文阅读)

## Context

右侧阅读面板 09-08 落地（Markdown 预览 + Git 审阅）后，JC 问它还能装什么，
要求「明显提高用户体验、增加有效信息感知」。先对表 deferred 台账和 PRD，
排除已裁过的方向：Artifacts / 产物列表（08-07 搁置，前置 Session Workspace
08-13 暂缓，且本地文件预览那轮明确否了「不全的清单比没有更坏」）、Goal 任务板
进右栏（PRD 明写桌面不做 deliverable 面板）、会话内查找（09-08 暂存）、会话
大纲（rail 问题索引已覆盖）。剩下三个候选按性价比排：

1. **阅读面板通吃「可读文件」**——消息里的路径只有 `.md` 进面板，脚本 / 数据 /
   日志一律「在 Finder 里显示」，而这些恰是 Agent 产出的大头；Core 的读取、
   Git 视图的 `PlainFileLines`、图片读取三块零件都现成。
2. **Git 审阅加基线选择**——只比「工作区 vs HEAD」，Agent 一提交改动就消失，
   而那正是最需要复核的时刻；Core 的 `files(root, base)` 已接受 base。
3. **长工具输出在右栏全文阅读**——过程区折叠 + 尾截断，300 行 `code_run` 输出
   看不全；零后端改动但频率不确定。

JC 裁决：本轮做 1 和 2，3 先挂；文档里过时和不成立的信息一并修。

## Decisions

### D1. 文件类型判定归 Core，GUI 按名镜像只管 affordance

`local_file.access` 的 `kind` 从三值扩成五值（`directory` / `markdown` /
`text` / `image` / `file`，additive）。`text` 由三层判定：扩展名白名单（代码
与数据文件）、约定基名（`Makefile` / `LICENSE` …）与点文件（`.gitignore` /
`.env`），以及**无扩展名**文件的 8 KiB 内容嗅探（无 NUL 的 UTF-8）。**扩展名
未知的文件不嗅探**——扩展名是作者对类型的声明，猜过去会让 `.docx` 这类容器
在两种 kind 间闪烁。GUI 侧 `previewKindByPath` 镜像同一张表，只决定点击前
的 tooltip 和旁边的文件夹图标；点击后走 `inspect`，以 Core 的答案为准
（Core 嗅探把无扩展名文件升为 text 时 GUI 照样进面板）。

### D2. 「用默认应用打开」只给文档，脚本永不

`open` 动作的白名单是 Markdown、图片和一小撮数据文本（`txt csv json yaml
toml xml …`）。`.sh` / `.py` / `.bat` / `.ps1` 可以预览，但**不能**交给默认
应用——部分桌面（Windows 的 `.bat`、装了 launcher 的 `.py`）会直接执行；
symlink 的 canonical 目标按同一规则再验一次。GUI 对不在表里的文件隐藏菜单项
（`isOpenableWithDefaultApp` 镜像），而不是让用户点了再吃「不支持」的 toast。

### D3. 文本预览与 diff 同一寄存器，两个可读性特化

`TextPreview` 用 `PlainFileLines`（等宽、行号、软换行、无高亮——diff 首版
也无高亮，两视图读起来是同一个面）。两个特化直接对着 Agent 的产出形态：
`.csv` / `.tsv` 按 RFC 4180 解析、列数规整才画表（表头粘顶、行号列、1000
行封顶带说明），参差 / 引号未闭合 / 不足两列退回纯文本并说明；单行 JSON 重新
缩进并说明「磁盘上是单行」。图片按原尺寸显示、图下标像素尺寸——复核图表
和截图时最常问的那个数。语法高亮不做（与 diff 一致，另议）。

### D4. Git 基线：只接受十六进制提交 ID，列表懒读，基线是窗口级状态

`git.review` 加 `base?`（list / diff）和新动作 `log`（最近 30 个提交），
结果加 `base` / `commits`（additive）。`base` 必须是 7–40 位十六进制并经
`rev-parse --verify <id>^{commit}` 解析，refspec / 表达式一律
`git_review_invalid_base`——聊天里带出来的值不能夹带 `--flags` 或 `:(...)`
进 Git。选了基线后，list / diff 里所有原本用 HEAD 的位置换成该提交，未跟踪
文件与 HEAD 变化检查照旧。GUI 侧：header 动作组最左加 `GitBaselineMenu`，
提交列表在第一次打开菜单时才读、并记住读取时的 HEAD（HEAD 移动即失效重读）；
切换仓库重置基线；基线与仓库、所选文件、单双列一起存在
`LocalFileWorkspace` 的 review 状态里，跨宽窄宿主和会话切换保留。

「自本会话开始以来」的预设（需在 session 行记录起始 HEAD）是第二步，本轮
不做——提交列表版已覆盖「Agent 提交后还能看」的主要场景。

### D5. 文档纠偏

- `design/conversation.md`：文件预览节从「仅 Markdown」改为五类判定、默认
  应用规则、文本 / 表格 / JSON / 图片呈现；Git 节加基线小节，「比较对象」
  加「默认」二字。
- `agent-api/transports.md`：`kind` 五值与判定、`read` / `open` 的接受范围、
  `base` / `log` / `commits` / `git_review_invalid_base`。
- Artifacts PRD 未决问题 4「Galley 目前无右栏」和 UX 走查发现 B 标记
  **已解**（右栏以按需唤出形态存在，重启时沿用）；deferred 台账同步。
- 三号候选进 deferred，启动信号写清。

## 未做（有意）

- 语法高亮（文本预览与 diff 同批另议）。
- 未知扩展名的内容嗅探（D1 理由）。
- `.md` 之外文件的相对链接解析（文本文件没有文档基准的概念）。
- 基线「自会话开始」预设（D4）。

## 验证

- Core：`local_file` +2 用例（扩展名 / 基名 / 点文件 / 嗅探分类；脚本不可
  open、文档 symlink 到脚本不可 open），`git_review` +2（老提交为基线的
  list / diff、非法 base 全拒；unborn 分支 log 为空）。
- GUI：`local-file-path.test` +3、`LocalFileReference.test` +1（脚本 / 图片 /
  数据引用有文件夹按钮，`.pptx` 没有）、新 `TextPreview.test`（RFC 4180
  解析、参差退回、JSON 重排、表格 / 纯文本渲染）、新 `GitBaselineMenu.test`。
  typecheck / lint（0 warning）/ 全量 371 用例通过。
- 真机验收留给 JC：点 `.py` / `.csv` / `.png` 引用进面板；`.sh` 的更多菜单
  没有「用默认应用打开」；Git 面板选一个老提交后文件列表与副标题变化、
  切换仓库后基线回到 HEAD、宽窄布局切换后基线保留。

## 补（同日）：模型不写完整路径，面板打不开

JC 让模型把一段文字存成 `.md` / `.txt` / `.csv` / `.json` 四种格式到
`~/Downloads`，回复里目录只出现一次、四个文件在表格里是裸文件名，于是没有一个
可点（session `s-mttuo5ip-kkdb`）。不是新功能的 bug：文件引用识别只认完整
路径是 09-08 定的边界（聊天里没有可靠的基准目录，猜相对路径的误判比不识别
更坏），这条不重开。

修法只做提示词：managed 运行时 prompt 加「Files You Create」一节——创建 /
修改 / 交付的文件在回复里用完整路径（绝对或 `~/…`）以行内代码或链接写，
每个文件一次，表格和列表里也要写全路径。attach 模式不注入（宪法 Rule 1），
用户外接 GA 得不到这条改善。被否的 GUI 侧「目录 + 裸文件名」上下文拼接
与 09-08 的否决同理。单测锁住 workbench 与 IM 两种组合都带这一节；
prompt-composition 的 clause ledger 加行、dogfood 清单加第 8 项。
静态规则变了，`prompt_hash` 随之变化——这是诊断指纹，不是 profile id。
