# PRD: Artifacts（会话交付物：scratch 工作区 + API + GUI 面板）

Status: 搁置（2026-08-07 JC 裁决暂不推进；核心设计已定案 1–4，重启时从
「UX 走查发现与遗留裁决点」一节接续）
Date: 2026-08-07
关联: 设计参考源为 OpenWorker（andrewyng/openworker @ 01b6f83, 2026-08-01），
两轮研读笔记见 [openworker-reference.md](./openworker-reference.md)；
遍历剪枝纪律已单独记入 engineering-workflow I12。

## 背景与动机

Galley 会话今天只有对话流，没有「这个会话产出了什么」的一等呈现。对人类操作者，
交付物埋在文字里要自己翻；对 supervisor / agent 消费方，session 的结果只有最后
一条消息文本，没有结构化的交付清单——这与 Galley「agent 编排台」的定位直接冲突：
编排的意义在于拿到交付物，不是拿到聊天记录。

OpenWorker（吴恩达团队，2026-07 发布，形态与 Galley 高度同构：Tauri/React 壳 +
本地 Python agent 引擎）以 "finished work, not chat" 为产品核心，其 Artifacts
设计是本 PRD 的参考原型。其核心洞察值得原样继承：

> **Artifacts 不是存储系统，是工作区上的一层透镜。**
> 不建 artifact 数据库、不做版本管理、不做独立存储——artifact 就是工作区里的
> 文件本身；面板只是对工作区的一次带过滤、带剪枝的遍历。整条链零新增状态，
> 文件系统是唯一真相源。后端全部逻辑约 200 行。

## 定案决策（2026-08-07 JC 裁决）

### 1. scratch 工作区机制先行，是本 feature 的根基

- 无绑定目录的会话自动供给 `<scratch_base>/<session_id>/` 作为确定的产物落点。
  没有确定落点，Artifacts 只能扫用户项目目录，信噪比崩坏（代码仓库满地 .md）。
- scratch base 选址借鉴 OpenWorker 的 `~/OpenWorker`：**家目录根部**，用户可见、
  Finder 好找，且不在 macOS TCC 保护区（文稿/桌面/下载才在），零权限弹窗。
  Galley 候选 `~/Galley/`，允许设置里改（终值见「未决问题」）。
- scratch 目录的创建/归属是会话生命周期的一部分，归 Rust Core 管（Rule 5）。

### 2. Agent API 与 GUI 都做

- **API**：`galley session artifacts <id>`（名字待定）返回结构化交付清单
  （path / abs_path / name / kind / size / modified_at）。schemaVersion 1
  纯增量。这是 supervisor 侧的本质需求：session 结束后拿交付清单，闭环
  「交付物导向」的编排。
- **GUI**：会话内的 Artifacts 面板 + 预览查看器 + OS 逃生口（Reveal /
  用默认应用打开 / Copy path 给绝对路径）。

### 3. 仅 managed GA 提供，不考虑 attach 模式

`[Title](artifact:relative/path)` 链接契约需要注入提示词，attach 模式被
Rule 1 禁止注入。JC 裁决：本 feature 整体只面向 managed 用户，不做 attach
降级形态。注入位置（managed patch 栈 vs Galley Persona）见「未决问题」。

### 4. 预览原则：预览 = 分诊，验收 = OS 默认应用

内嵌预览只服务「这是不是我要的文件、大概长什么样」（分诊）；交付质量判断
（验收）交给 ground truth 渲染器——OS 默认应用。伪高保真预览会误导验收，
不做。由此分层：

| 层 | 内容 | 判断 |
|---|---|---|
| 必做 | markdown / text / code / image / csv + HTML（见安全红线） | 便宜可靠，webview 渲染即 ground truth |
| 观望 | pdf（pdf.js）、xlsx（SheetJS 懒加载） | dogfood 后按实际产出分布裁决 |
| 永不内嵌 | docx / pptx | 「用默认应用打开」即正确路径 |

二进制超限（参考值 25MB）拒绝预览、指向 Reveal。文件已被移走时给人话错误。
诚实降级，不假装。

## 安全红线

1. **HTML 预览的 iframe sandbox 禁止 `allow-same-origin`。**
   OpenWorker 在此有真实漏洞（`surfaces/gui/src/components/RightRail.tsx`：
   `srcDoc` + `sandbox="allow-scripts allow-same-origin"`）：srcDoc 继承宿主
   origin，两个 flag 同开时 sandbox 形同虚设，agent 生成的 HTML（可能被提示
   注入污染）与 App 壳同源运行，可经 `window.parent` 摸到注入的 API token →
   完全控制本地 API。MDN 明确警告该组合。Galley 只给 `allow-scripts`：
   opaque origin 下脚本照跑、自包含 HTML 完全不受影响，但摸不到宿主任何状态。
   Tauri webview 上还挂着 IPC 通道，这条纪律比浏览器里更要紧。需要完整外部
   资源的网页预览时，出口是独立窗口或默认浏览器，不是放宽 sandbox。
2. **路径解析强制限定工作区内**：`canonicalize` 后 `starts_with(workspace)`
   校验，逃逸即拒绝（OpenWorker 对应 `_artifact_target` 的 `relative_to` 检查）。
3. **目录遍历必须先剪后走**：见 engineering-workflow **I12**（macOS TCC 教训，
   `rglob` 式先下潜后过滤会走进 `~/Library` 触发系统隐私弹窗；Rust 侧用
   `walkdir::filter_entry`）。

## 机制要点（实现时对照 OpenWorker，细节见参考笔记）

- 发现 = 按交付型扩展名白名单遍历工作区（约 26 种：md/html/csv/xlsx/pptx/docx/
  pdf/图片/常见代码），跳过隐藏目录与 node_modules/target/dist 等，按 mtime
  倒序，截断（参考值 80）。
- 刷新时机：文件写入类工具成功即刷（turn 中途可见），run 结束兜底刷
  （覆盖 shell 创建的文件）。面板收起时给计数徽章。
- `artifact:` 链接在 markdown 渲染层放行 sanitizer，渲染为 chip；点击必须落在
  可见处（面板收起则自动展开）。
- 文件夹也可作为 artifact 链接目标：返回可点击的目录列表，不给死胡同。
- 计划任务 / Goal 联动机会：run 的交付清单 = 工作区内自 run 开始后修改的文件，
  遍历逻辑免费复用（与 `.scratch/scheduled-tasks/` 的联动待那边排期时再议）。

## 未决问题

1. **scratch base 终值**：`~/Galley/` 还是别的？目录内布局（`<session_id>/`
   直平铺 vs 按日期分层）？会话删除/归档时 scratch 目录的命运（保留？随删？）。
2. **哪些会话显示 Artifacts 面板**：OpenWorker 按 agent 家族分流（deliverable
   型才有面板，code 型预留 Files 槽）。Galley 会话没有家族概念——是「仅 scratch
   会话显示」还是「绑定项目目录的会话也显示（接受信噪比）」？
3. **`artifact:` 契约注入位置**：managed patch 栈 vs Galley Persona。倾向
   Persona（不动 GA 代码面），待对照 Persona 现状定。
4. **GUI 呈现形态**：Galley 目前无右栏。面板放哪（右栏新建 / 会话头部抽屉 /
   其他）属纯视觉分叉，按 JC 工作法做真机变体实测裁决。
5. **API 命名与字段形状**：命令名、kind 枚举值域、是否暴露 `truncated` 等。
   拆 issue 时随 agent-api 文档一起定。

## 范围声明

- Rust Core：scratch 供给 + artifacts list/read/reveal 三个命令（I5：trait 单
  一定义，双传输薄包装）。
- CLI：`session artifacts`（additive，schemaVersion 1 不变）。
- GUI：面板 + 查看器 + 逃生口，纯呈现（I6）。
- managed 运行时：提示词契约注入（Persona 或 patch，见未决 3），遵守
  managed-ga-runtime 规则（最小、隔离、可重放）。
- 不动 IPC 协议的现有命令；如 runner 需要新事件另行按 ipc-protocol.md 流程。

## UX 走查发现与遗留裁决点（2026-08-07，搁置前最后状态）

搁置当天做过一轮完整用户旅程走查，两个改变前提的现状发现：

- **发现 A（动机强化）**：Galley 会话无 cwd 字段；managed GA 永远运行在
  `<app_data_dir>/managed-ga-state`（`core/src/managed_runtime.rs:330`），
  project 模式也只是 symlink 进状态根、不改 cwd（`workbench_bridge.py:811`，
  "Project folders never chdir the GA process away from its state root"）。
  即：今天 agent 相对路径写的交付物落在 app 内部目录，用户不可见。
  Artifacts 是对现存缺陷的修复，不是增强。scratch 激活大概率复用
  `workspace_cmd.prepare` 的既有接缝。
- **发现 B（形态约束）**：GUI 无右栏是 2026-05-12 的存档裁决
  （`AppShell.tsx:48-56`：Inspector 各 tab 重复既有信息 + 「专注对话产品而
  非 IDE 克隆」），但留了活口——新功能可以 fresh design。Artifacts 是新
  信息，不触犯退役理由，但常驻右栏仍与产品气质相悖。
- 利好：core 已有工具级事件（`tool_call_start/end` 带 args，落库
  `tool_events`），写文件工具成功即可触发刷新；markdown 渲染有
  `markdownUrlTransform` 现成接缝且无 rehype-raw。

走查新增裁决点（均未裁决）：

1. scratch 目录命名：`<日期>-<短id>`（Finder 可认）vs 纯 session_id；
   auto-title 重命名目录被否（运行中路径不能动）。
2. 相对路径溢出状态根：仅提示词纪律 + 容忍（agent 倾向此）vs 改 chdir
   （需 managed-runtime 层单独论证）。core 可见工具 args，可后补溢出检测。
3. 面板形态：临时右栏（chip/徽章唤出，不常驻；agent 预判胜出，因「预览时
   还想看 agent 在跑什么」）vs overlay dialog（贴合现有模式但遮对话）vs
   内嵌。按真机变体实测裁决。
4. 面板信噪比：`artifact:` 声明的交付物置顶（core 解析消息即可，agent
   倾向此）vs 全列平铺。
5. 删会话时 scratch 命运：对话框勾选「同时删除产物文件夹（N 个文件，
   X MB）」，空文件夹默认删、非空默认留（agent 倾向此方案）。
   归档不动 scratch，无争议。

实现期注意（不需裁决）：Tauri webview CSP 对 iframe sandbox 的行为需
WKWebView/WebView2 双平台验证；空 scratch 目录清扫时机；scratch base 设置
变更只影响新会话；API 清单自带 `--since` 语义（Goal/计划任务要「本次 run
产物」，`mtime > run 开始` 免费实现）。

## Issue 拆分

待拆。预计切法：① scratch 工作区机制（Core + 设置项 + 会话生命周期挂钩）→
② Core artifacts 三命令（含剪枝遍历 + 路径安全）→ ③ CLI additive 暴露 →
④ GUI 面板 + 必做层预览（含 sandbox 红线）→ ⑤ managed 提示词契约 + `artifact:`
chip 渲染 → ⑥ 回归与 dogfood（观望层预览的数据收集从这里出）。
