# PRD: Session Workspace（会话产出的落点与可达性）

Status: 暂缓实现（2026-08-13 JC 裁决：设计定案，先不动手）
Date: 2026-08-13
关联:
- 参考实现读码来源 deepseek-ai/deepseek-harness @ `47f9438` 的
  `packages/client/ui-deliverables`（读码笔记见本文末节）
- 前置关系见「与 `.scratch/artifacts/` 的关系」一节
- 形状先例：Goal 工作区（`core/src/app_paths.rs:41`、
  `GoalIndicator.tsx:188`、`GoalRunMarkers.tsx:123`）

## 背景：问题是实测出来的，不是推演出来的

JC 报告：使用 Galley 时**多次出现「找不到刚才 AI 生成的那份东西，只好再问一次
AI 文件在哪」**。围绕这句话做了三轮测量：

1. **产出落在哪** —— `~/Library/Application Support/app.galley/managed-ga-state/temp/`
   下有 **62 个文件 + 1 个目录**（44 `.md` / 10 `.txt` / 6 `.json` / 1 `.mp3`，
   外加 `plan_hangzhou_trip/`），跨度 2026-06 至 08。名字全是交付物：
   `nba_finals_stars_report.md`、`hermes_desktop_review.md`、
   `bypms_20260301_20260531_summary.json`、`birthday_greeting.mp3`。
   这个目录 Finder 默认隐藏，且与 234 个 `model_responses` 引擎日志同级。

2. **产出走哪条工具路径** —— 全库 116 会话 / 862 个带工具调用的轮次里，
   `file_write` + `file_patch` 只有 **16 次**。62 ≫ 16 说明**绝大多数产出是
   `code_run` 脚本写的**。这一条直接判了「按写文件工具的 location 列产物」
   这类方案的死刑（见「已否」）。

3. **路径形状** —— 那 16 条路径：绝对 8（50%）、`../` 5（31%）、`./` 3（19%）。
   `deferred.md` 里为最小切片定的判据（「绝对占多数则单做打开按钮，相对占多数
   则回主 PRD」）**8:8 平手、判不出**。真正判得出的是另外两个维度：频率与落点。
   其中 5 条 `../memory/*` 根本不是交付物，是 GA 在写自己的记忆。

**结论重定义**：核心缺陷不是「转录没说产出了什么」（那是 dsh 的问题陈述），
而是**所有非项目会话共用一个平面目录，且那个目录在用户看不见的地方**。
「在 Library 里」只是让用户无法自救；「共用一个平面夹」才是「找不到那一份」
的根因——62 个文件平铺 4 个月，一次性中间产物（`article_1..9.txt`）与真交付物
混在一起。

Goal 那条线**已经把正确形状做对了**（每个 goal 一个目录 + has-files 门禁 +
「打开产出文件夹」按钮），session 只是没跟上。本 PRD 就是让 session 跟上。

## 与 `.scratch/artifacts/` 的关系

两个 PRD 不重叠，且有明确先后：

| | 本 PRD（session-workspace） | artifacts PRD |
|---|---|---|
| 管什么 | 产出的**落点**与**可达性** | 产出的**索引**、预览、Agent API |
| 产物 | 一个用户可见的 per-session 目录 + 打开入口 | Artifacts 面板 + `session artifacts` 命令 |
| 依赖 | 无 | **依赖本 PRD** |

`.scratch/artifacts/PRD.md` 的定案第 1 条原文是「scratch 工作区机制先行，是本
feature 的根基……没有确定落点，Artifacts 只能扫用户项目目录，信噪比崩坏」。
**本 PRD 就是它点名的那个前置**。本 PRD 落地即满足 artifacts PRD 第 1 条。

## 定案决策

### 1. 每个 session 一个目录，命名 `YYYY-MM-DD-<短ID>`

例：`2026-08-13-a3f9`。四条理由，后三条来自 Windows：

- **时机**：目录必须在 session 开始时命名，而**标题那时还不存在**——AI 自动
  命名发生在首轮之后。用标题就得事后改名，而改名会让已经交付给用户的路径失效。
  这条单独就足以判定。
- **Windows 非法字符**：`< > : " / \ | ? *` 全禁。库里真实标题形如
  「请打开百度，搜索今天的天气，并告诉我结果。」「今天几号？」——问号直接撞。
- **Windows 路径长度**：`<Documents>\Galley\<目录>\<文件>` 叠上 OneDrive
  重定向前缀，MAX_PATH 260 并非完全无风险。短目录名是免费保险。
- **Windows 保留名**：`CON` / `PRN` / `AUX` / `NUL` 等，标题命名法要专门防，
  日期 + 短 ID 天然规避。

认路的责任在 Galley 不在文件名：会话内给「打开工作区文件夹」，会话列表给映射。
这与 GA 自己的做法同族——`workspace_cmd._ws_name()` 就是
`basename-blake2b前8位`。

### 2. 机制走「软链 + handler.cwd」，**不动进程 cwd**

读码确认的三个事实决定了方案：

- `ga.py:318` `_get_abs_path = abspath(join(self.cwd, path))`，
  `ga.py:333` `do_code_run` 的 cwd 同样派生自 `self.cwd`。
  **文件工具与 `code_run` 都跟随 `handler.cwd`** ——一个开关能管住那 62 个文件。
- `ga.py:631` `get_global_memory()` 往系统提示词写死两句：
  `cwd = <state>/temp (./)` 与 `[Memory] (../memory)`。
  **GA 把工作目录绝对路径和 memory 相对路径直接告诉了模型。**
- `workspace_cmd.prepare()`（`workspace_cmd.py:324`）的做法是在
  `<state>/temp/projects/<name>-<hash8>` 建 junction / 软链指向真实目录，
  **cwd 完全不动**，所以 `../memory` 与提示词都还是真的。

三个候选方案：

| | 机制 | 落点可靠性 | 风险 |
|---|---|---|---|
| 甲 | 只建软链 + 提示词引导「写到 `./sessions/<id>/`」 | 靠模型自觉 | 零，退化即现状 |
| 乙 | 改进程 cwd | 可靠 | 大，`../memory` 与提示词全要跟改 |
| **丙** | `handler.cwd` 指向 `./temp/sessions/<id>`（该路径是指向用户可见目录的软链） | 可靠 | 一个 patch：改 `get_global_memory()` 那两句 |

**采纳丙。** 它是唯一能让「打开工作区」可靠回答「刚才那份在这儿」的方案；甲会
给出一个装了 2/3 文件的目录。代价精确可控：一个 managed patch，改两句提示词
（cwd 那句从 `handler.cwd` 派生、memory 那句改成绝对路径），符合 patch stack 的
minimal / isolated / documented / replayable，退役条件明确（上游哪天让 cwd 与
memory 路径可配置就撤）。

**attach 模式降级为甲**：Rule 1 禁止改外部 GA 提示词，所以软链照建、按钮照给、
落点靠自觉。这个降级要写进文档，不能让人以为两种模式等价。

关于 2026-05-14 那个疤（「os.chdir 让 GA 读不到 memory/ 静默降级」）：**只适用
一半**。managed GA 代码层读 memory 走 `state_path('memory', ...)` 绝对路径
（`ga.py:14`），不受 cwd 影响；会坏的是**模型层**——它被提示词告知 `../memory`。
方案丙的 patch 恰好修的就是这一处，不是重蹈覆辙。

### 3. 项目 session 不叠 session 工作区

项目 session 已由 `workspace_cmd.prepare` + `set_project_mode` 获得工作区，
两者**互斥**：有项目工作区就不再供给 session 工作区。

### 4. `workspace_path` 存 `sessions` 表，首次定死

照抄 Goal 的做法（`goals.workspace_path` 是一列，建 goal 时算好存下，
`core/src/db/goal.rs:291`）。因此：

- 用户改了 Settings 里的工作区根，**只影响新 session**；已有 session 续聊时读
  自己那列，产出不会分裂在两个根。
- 存量 session（无此列）保持现状走 GA temp，**不追溯、不迁移**。

### 5. 空目录当场回收

绝大多数 session 不产出文件（116 个 session 对 62 个产物）。session 结束时目录
仍为空则删除——bridge 拥有进程生命周期，顺手可做；崩溃留下的孤儿由 Core 启动时
扫一遍。**可观察结果就是「没产出就没有子目录」**。

不写任何 `.galley-session` 之类的标记文件：它会让目录永远非空，直接废掉回收，
也污染用户目录。索引的责任在 Galley 的库，不在文件系统。

### 6. 工具调用的绝对路径进 `messages.tool_calls`，不复活 `tool_events`

解析**在 bridge 的调用现场做**，不在 Core 事后推导：

- Core 传的是 `cwd: None`（`runner_commands.rs:351`），bridge 落到
  `chdir(managed_state_root)` 或 `chdir(ga_path)`（`workbench_bridge.py:683`），
  GA handler 再叠 `cwd="./temp"`。但**项目模式**会把基准换成 GA 决定的 target，
  **`code_run` 里 agent 自己 chdir** 更是不可知。事后推导会猜错，而**错的绝对
  路径比相对路径更坏**——它看起来权威，点开是空气或别的文件。
- bridge 就在那个进程里，`abspath(join(handler.cwd, path))` 是当时的事实，
  且它就是 GA 自己 `_get_abs_path` 的那一行，不是我们的猜测。

**不复活 `tool_events`**：那张表不是废表，是**审批审计表**——只有走审批的调用才
写（`gui/src/lib/ipc-handlers.ts:370`，注释写明「audit only, no completion rows」），
线上库 0 行是因为日常跑 YOLO。改用它意味着三件事：语义从审批审计扩成全部工具
调用、写入从 GUI 触发挪到 Core 事件驱动、每次调用一行的写放大。为一个「显示
路径」的功能付这个价比例不对。

选 `messages.tool_calls` 的正面理由：绝对路径不是独立实体，是**某一次调用的属性**，
而那次调用只有一个家——会话渲染就是从这个 JSON 画出来的；拆两处存是自找漂移。
字段可选，**缺失 = 未知 = 不给打开按钮**，历史行天然优雅降级、不用迁移、不会骗人。

配套要求：`tool_calls` 的 item 现在是无 schema 自由结构（只有 `toolName` /
`args`，连 callId 都没有）。加字段的同时把 item 形状写进
[`docs/ipc-protocol.md`](../../docs/ipc-protocol.md)——它事实上已经是
bridge → Core → GUI 的线上契约，只是没被承认。

### 7. 打开动作只有两个，权限对齐 `fs:scope`

- 「用系统默认应用打开」与「在 Finder / 资源管理器中显示」。**不做应用选择器**
  （沿用 artifacts PRD 已否项：Finder 右键「打开方式」更好）。
- 抄 dsh 一个细节：`.html` / `.htm` / `.svg` 这类**浏览器能渲染的文档优先解析
  默认浏览器而非该扩展名的默认应用**——开发者常把 `.html` 绑给编辑器，点开产物
  却看到源码。
- `core/capabilities/default.json:27` 现在把 `opener:allow-open-path` 限死在
  `$APPDATA/browser-control/**`，需放宽。**对齐已有 `fs:scope`**
  （`$HOME/**` + Documents / Desktop / Downloads），不全盘放开，保持「Galley 能
  打开的和 Galley 能读的是同一个范围」这条可解释边界。

### 8. 与 Goal 工作区：形状统一，根不统一

Goal 那套已经做对了：`goal_workspace_dir()` 只算路径（注释明写
「created lazily by the agents on first write; this only computes the path」）、
`goalWorkspaceHasFiles` 做门禁、`revealItemInDir` 打开、copy 叫「打开产出文件夹」，
连「别给一个打开空文件夹的按钮」的判断都已写在 `GoalRunMarkers.tsx:123`。

- **统一**：路径 helper、has-files 门禁、打开按钮、copy 语域全部共用。
- **不统一**：根。goal 工作区在 app data dir，**v1 不动它**——存量用户状态不可动。
- **记 deferred**：session 工作区在用户可见根落地并被验证之后，goal 工作区可在
  某个版本跟进（只影响新 goal）。现在就合并是拿一个未验证的默认去动已发运的东西。

## Windows

- **路径解析**：`directories::BaseDirs`（`core/src/app_paths.rs:10` 已在用）走
  系统 known folder API，Windows 上拿到的是 `FOLDERID_Documents`，**会跟随用户的
  重定向**，不会写错地方。
- **OneDrive**：Windows 上 Documents 常被 OneDrive 接管
  （`C:\Users\<u>\OneDrive\Documents`），意味着 agent 产出自动上云。
  裁决：**接受**——用户把自己的「文档」交给 OneDrive 是他自己的既有决定，绕开它
  去写 `%USERPROFILE%\Galley` 等于替用户改主意；且交付物放进「文档」语义正确。
  Rule 2 管的是 Galley 不开网络监听，与用户自己的云盘同步无关。
  出口是第 9 条的可配置根。
- **文件名与长度**：见定案 1 的三条 Windows 理由。
- **软链**：Windows 用 junction（`workspace_cmd.py` 已封装跨平台
  junction / symlink，且注释标了 reparse 安全），本 PRD 复用，不自己造。

### 9. 工作区根可配置

Settings 里一项路径设置，默认为平台的 Documents 下的 `Galley`。复用项目工作区
已有的文件夹选择器（`copy.projects.chooseFolder`）。**默认值本身仍是未决问题，
见下**。

## 已否（防重提案）

### B. 轮尾「本轮产物」清单行（dsh `ui-deliverables` 形态）

dsh 在收尾 assistant 消息与页脚之间插一行「产物」，数据来自写文件工具自己的
`locations`。**否决，理由不是成本是正确性**：

我们的 `file_write` / `file_patch` 只占实际产出的极小部分（16 次 vs 62 个文件），
绝大多数产出由 `code_run` 脚本完成。dsh 自己也承认「终端命令间接创建的文件不在
匹配词汇内」——**对他们是边角，对我们是主流**。一份看起来完整、实际漏掉大半的
清单，比没有清单更坏：它会让用户以为「就这些」。

替代方案就是本 PRD：不靠清单认产物，靠「每个 session 有一个确定的、点一下就打开
的文件夹」。

### 正文里的路径提及做成可点链接（dsh 第二层）

dsh 让模型用行内代码写出产物路径，渲染时只认「精确路径」或「唯一 basename」，
撞名与未产出的 token 保持惰性。**本期不做**：它要往 Persona 加一段提示词（GA
budget 纪律），而 dsh 那套之所以成立是因为提示词与渲染器同属一个包、一起装一起
卸；我们没有这种结构，加了就是长期耦合。可在落点问题解决后重新评估。

### 检测 `code_run` 里 agent 自己 `chdir` 之后的产出

**不管，且不要检测。** 与否决 B 同一条理由：检测不全的检测会给出「这就是全部
产出」的错觉，比不检测更坏。写进「已知限制」。

### 模型写绝对路径时把它拽回工作区

不做，而且这是对的。库里那 8 条绝对路径全部是 JC 自己指定的落点
（Obsidian Vault、Downloads）。用户指定的落点优先于默认落点。

## 未决问题

1. **★ 工作区根的选址与既有 PRD 冲突（必须先解决）。**
   JC 在讨论中定的是 `~/Documents/Galley`。但
   [`.scratch/artifacts/PRD.md`](../artifacts/PRD.md) 的定案第 1 条已经为
   scratch base 选了**家目录根部 `~/Galley/`**，理由是「不在 macOS TCC 保护区
   （文稿 / 桌面 / 下载才在），零权限弹窗」。两者不能并存，且这条 TCC 理由在
   本轮讨论中没有被提出来过。
   需要 JC 复裁：`~/Galley`（无 TCC 弹窗、与 artifacts PRD 一致）
   vs `~/Documents/Galley`（Finder 侧栏常驻、语义上「文档」更对，代价是首次写入
   会触发系统授权弹窗，被拒则写入失败）。**默认倾向改回 `~/Galley`**，理由是
   TCC 是硬技术约束，而「Finder 侧栏」是可以靠「在 Finder 中显示」按钮补偿的。
2. 短 ID 的取值来源（session id 前 4 位 vs 独立随机）与碰撞处理。
3. 空目录回收的触发点：bridge 正常退出、Core 启动扫描，二者是否够——长期不关的
   Galley 会不会积累孤儿。
4. `sessions.workspace_path` 是建 session 时算，还是首次真正开跑时算（后者能少建
   一批从未运行的 session 目录）。
5. IM 渠道创建的 session（feishu / telegram / discord / wechat）是否同样供给工作区。
   倾向是，但那些 session 的「打开文件夹」入口在哪不明显。
6. managed patch 的编号与具体 diff 形状（改 `get_global_memory()` 两句），需要在
   实施时按 [managed GA runtime](../../docs/managed-ga-runtime/README.md) 的规矩
   补齐条目、理由、覆盖测试、退役条件。

## 参考实现读码笔记：dsh `ui-deliverables`

deepseek-ai/deepseek-harness @ `47f9438`，包
`packages/client/ui-deliverables`，中文 UI 里标签就叫「产物」。

- **数据来源是工具调用自己的 `locations`，不是模型的话。** turn 级累加器：
  `turn/start` 开桶、`tool/call` 记 callView、`tool/result` 成功时收路径。
  失败 / 读 / 删不贡献；同一路径一轮一次，首次出现排序。
- **「算不算一次写」按渲染意图判定，不按工具名**：`card === 'diff'`，或
  `card === 'generic' && kind === 'edit'`。注释原文：新的写文件工具靠「声明自己
  干什么」加入，而不是靠被加进一张名单。
- **单行不换行不横滚**：隐藏测量层量出每个 chip 实际宽度，并为本地化的
  「+ N 个文件」精确预留宽度，取塞得下的最大前缀（上限 6），ResizeObserver 跟随
  重算。**我们用不上**——15 个写文件轮次里 14 个只写 1 个文件。
- **打开交给宿主机 `openPath`**，`.html` 类优先解析默认浏览器（见定案 7）。
- **第二层是正文行内代码可点**，静态提示词（order 190，静态所以留在可缓存前缀）
  + 只认精确路径或唯一 basename（见「已否」）。
- **他们明确否决过**：让模型在正文列产物并据此渲染（渲染不能依赖模型把路径拼对）、
  正则扫全文识别路径（假阳性 = 点开空气）、加一个 turn 后的模型步骤总结产物
  （加延迟加一次生成）、chip 横向滚动（隐藏的尾巴不可发现）、用 HTTP 把工作区
  服出来（同源页面实测能读到 `/api`，`session.list` 吐出 35KB 全部会话转录；
  加 `CSP: sandbox` 又会把页面自己的 JS 打死，且坏得隐形）。

## 启动信号

本 PRD 已设计定案、暂缓实现。重启条件（任一）：

- JC 再次遇到「找不到刚才生成的那份东西」并认为该动手；
- artifacts PRD 重启——本 PRD 是它点名的前置，必须先落；
- `managed-ga-state/temp` 的文件数继续增长到让「打开工作区」也无法自救的程度
  （当前 62，可作基线复测）。

重启时第一件事是解决「未决问题 1」的选址冲突，那条会影响其余全部路径决策。
