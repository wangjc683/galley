# Galley README 截图 playbook

> README 视觉资产的生产手册：场景清单、种子内容、拍摄规范、环境隔离。
> 目标是**可重复**——UI 改版后重拍 = 跑种子 + 照单拍，不再出现 2026-07
> 发现的「五张全是 v0.1 dev-mock」式资产腐烂（见
> [2026-07-03 devlog](./devlog/2026-07-03-readme-two-layer-value-prop.md)）。

## 原则

- **样板间，不是造假**：内容可以精心布置（行业惯例），但画面里的每个
  任务必须是 Galley 真能跑出来的。展示做不到的事 = 越线。
- **YOLO 是默认姿态**：不拍审批 dock；hero 的 TopBar 上 YOLO 徽标自然
  在场（这就是产品的默认形态，诚实）。透明性叙事由画面主体的工具时间线
  免费承担。
- **内容反映定位**：非 coding 主导的知识工作任务为主体，最多一条 dev
  向会话（supervisor 徽标那条）。「维特根斯坦哲学与 LLM」项目作为致敬
  彩蛋延续自旧截图。

## 环境隔离（mv-swap）

本机 Galley 数据可弃，但拍摄环境必须**全员策展**（画面里每一行都是
设计过的），所以仍然换装：

```bash
# 1. 关闭 Galley（含托盘常驻），换走现有数据
mv "$HOME/Library/Application Support/app.galley"{,.real}

# 2. 冷启动 dev 让 migration 自建全新 schema，走完 onboarding 配一次
#    模型（hero 真跑要用），然后退出
pnpm --dir gui tauri dev

# 3. 注入种子（脚本待建，双语两个产物）
scripts/seed-screenshots.py --lang zh   # 或 --lang en

# 4. 重启 dev → 按下方场景清单拍摄

# 5. 清理
rm -rf "$HOME/Library/Application Support/app.galley"
mv "$HOME/Library/Application Support/app.galley"{.real,}
```

换英文套：Settings 语言切到 English + 换 `--lang en` 种子库，重复拍摄。

## 拍摄规范

| 项 | 值 |
|---|---|
| 窗口尺寸 | 1600 × 1000 逻辑像素（Retina @2x 导出 3200 × 2000） |
| 主题 | 浅色为主；场景 5 为暗色 |
| 阅读宽度 | compact |
| 对话字号 | standard |
| Sidebar 宽度 | 默认 20% |
| 截图方式 | `⌘⇧4 + 空格` 带窗口阴影，或 `xcrun simctl` 等效；全套一致 |
| 文件组织 | `docs/screenshots/zh/` + `docs/screenshots/en/`，命名 `01-hero.png` / `02-projects.png` / `03-search.png` / `04-empty.png` / `05-hero-dark.png`，两份 README 各自引用对应语言目录 |
| 入镜纪律 | 无 dev 调试 chrome、无系统通知、时间状态合理（种子时间戳相对拍摄日生成） |

## 种子内容（--lang zh）

**项目**（Project view 展开态）：

| 项目 | 内含会话 |
|---|---|
| 维特根斯坦哲学与 LLM | 「PI §43 与工具调用的语义整理」（已完成）；「『语言游戏』概念的产品化笔记」（已完成 · 未读） |
| Q3 竞品调研 | 「竞品定价页抓取与对比表」（已完成）；「用户访谈纪要整理与共性归纳」（running · 第 4 步）|

**时间线散置会话**（含状态设计，供状态板一屏尽收）：

| 会话 | 状态 | subline |
|---|---|---|
| 《哲学研究》中译本豆瓣对比（见 Hero prompt 节） | **hero 真跑**，拍摄时进行中 | 实时步数 |
| 用户访谈纪要整理与共性归纳（Q3 项目内） | running（种子态） | 思考中…（「第 N 步」是内存态种不出） |
| 帮我查下周去上海的高铁班次 | 等你回复 | **现场真跑制造**（ask_user 是内存态，不可种）；未入选正式五张，可选 |
| 整理 Downloads 里的安装包和旧截图 | 已完成 | 已按类型归档 38 个文件 |
| 上季度报销单分类汇总 | 已完成 · 未读 | 共 47 笔分 6 类，2 笔待补发票 |
| 跟进 #1234 PR 的 review 反馈 | 已完成，**supervisor 徽标** | @ga-claude-1 创建 |
| 筹备读书会：场地、书单、邀请文案 | 已完成，**含 Goal 章节框（纯种子）** | 委派 + 3 条旁白 + 收口 |
| 面试准备：手写并发限流 + 防抖 | PINNED · 已完成 | 含 4 个常见变体写法 |
| MCP server 选型笔记 | 三天前 · 已完成 | 6 个候选已对比 + 推荐 1 个 |

（种子完整清单以 `scripts/seed-screenshots.py` 为准：2 项目 + 10 会话 +
23 条消息 + 1 条已完成 goal，双语各一套，脚本内含 zh/en 全部文案。）

关键词布点：「整理」出现在 3 条标题（⌘K 场景直接搜「整理」；en 套搜
"review"，同样 3 条命中）。

不种：error / cancelled 状态（README 场景无需）、审批态（YOLO 默认）、
附件与图片消息（seed 复杂度不值）、「等你回复」态（不可种，见上）。

**拍摄纪律**：不要点开 running 种子行（点开会派生回 idle）；不要点开
未读行（会清零未读点）；种子必须在走完 onboarding 配好模型**之后**注入
（`managed_models` 空表会被拦回 onboarding）。

**--lang en 对应集**：同结构、原生英文重写（非直译），关键词布点换
"review"（≥3 条标题含 review）。会话示例：hero 见 Hero prompt 节 /
*Sort the installers piling up in Downloads* / *High-speed rail options
to Shanghai next week*（waiting for you，可选）/ *Q2 expense reports
sorted and summarized*（unread）/ *Follow up on PR #1234 review
feedback*（supervisor）/ *Book club prep: venue, reading list, invites*
（Goal）。

## 场景清单

| # | 文件 | 画面 | 必须入镜 |
|---|---|---|---|
| 1 | `01-hero.png` | MainView 主对话，hero 任务跑到中段（第 5–8 步，结论未出即可） | 用户消息杏沙锚点；步序号 + 单行 thinking 摘要；≥3 次工具调用且 ≥2 种（web_scan / web_execute_js / update_working_checkpoint）；「工作中 + 秒数」徽标；TopBar YOLO 徽标；composer `/btw` 占位文案；sidebar 满员多状态（置顶、running×2、未读实心点、supervisor 徽标、本周分组） |
| 2 | `02-projects.png` | 项目视图：活跃项目展开 + 项目感知输入框 | 「退出项目视图」头部；活跃项目展开（running「思考中」+ 已完成同框）；第二个项目收起在列；输入框占位「在 <项目> 里交代什么？」+ 底部「将创建到 <项目>」提示 |
| 3 | `03-search.png` | ⌘K 命令面板，已输入「整理」（en: "review"） | ≥3 条命中（标题与对话内容两类结果都出现）；浮层 + 半透明遮罩构图 |
| 4 | `04-empty.png` | 新对话空状态：「安静待命的工作区」 | 空主区 + 居中 composer（题词占位文案入镜）；sidebar 满员多状态与场景 1 同源 |
| 5 | `05-hero-dark.png` | 场景 1 同内容，暗色主题 | 同场景 1；README 用 `<picture prefers-color-scheme>` 给暗色访客自动切换；注意右上外观 tooltip 不入镜 |

## Hero prompt（真跑）

正式口径（2026-07-03 实拍所用）：

zh：`《哲学研究》的几个中译本在豆瓣上现在的评分和评论数分别是多少？整理一张对比表，每个译本再摘一条有代表性的短评。`
en：`Compare the current Goodreads ratings and review counts of the main English editions of Philosophical Investigations (Anscombe vs. Hacker & Schulte), as a table with one representative review each`

**准入标准（2026-07-03 实测教训）**：hero prompt 的答案必须依赖**模型
不可能预知的状态**——本机文件，或此时此刻的数据（评分、评论数、排片、
余票）。反例：「搜一下《奥德赛》的相关资讯」实测零工具单 turn 直答，
卡司档期早在训练数据里。实时评分与评论数逐日变化，只能真去翻页面，
多步工具链是物理必然。

其余理由：具体优于空泛、与「维特根斯坦哲学与 LLM」项目彩蛋一脉相承、
非 coding、产出 markdown 表格（顺带展示表格排印）。跑到第 5–8 步、工具
序列已含 ≥2 种网页工具时截图，不必等结论段；序列不理想就重跑一次。

**备选**（同样过准入，时效型——临近热门影片上映时可用）：
`《奥德赛》快上映了，帮我查一下上海哪些影院会放 IMAX 70mm 版本、预售什么时候开，整理成一张表。`
（城市按拍摄者实际所在替换。）**保底方案**（若模型端点自带联网搜索绕过
工具层）：换本机任务——「把桌面这份 PDF 的要点整理成一张表」，文件系统
对模型不可见，工具调用必然发生。

## 二进制资产政策（全 docs 通用）

进 git 的二进制**永远留在历史里**——删除和替换都只会让仓库更大，不会
更小。所以规则设在入口处：

- **只提交被文档引用的资产**。README 截图 = 上方场景清单的 5 张 × 双语，
  重拍**同名覆盖**，不新增编号、不留旧版（旧版在 git 历史里）。
- **提交前压尺寸**：README 截图导出后先缩到 2× 展示宽（README 展示宽
  800px → 图片 1600px 宽即可，无需 3200px 原始 Retina 尺寸），PNG 走一遍
  无损压缩（如 `pngquant` / ImageOptim）。单张目标 ≤ 600KB。
- **审计证据图**：全窗口截图用 JPEG（质量 80 足够作证据）或降采样 PNG；
  只保留报告正文引用的图。落选 / 重试的抓拍不进 repo（放本机
  `~/Documents/galley-refs/` 之类）。2026-06-16 审计的 `rejected/` 目录
  早于本政策，按归档现状保留，不追溯。
- **参考资料（PDF、论文等）不进 repo**：放 `~/Documents/galley-refs/`，
  文档里用纯文本提名（先例见 2026-05-20 repo hygiene devlog）。

## 当前状态与待办

正式五张（zh / en 双套）已于 2026-07-03 实拍并上 README。实拍过程、与
原清单的偏差决策（Goal 专场撤销、空状态收编、「等你回复」未入选）见
[重拍 devlog](./devlog/2026-07-03-screenshot-reshoot-bilingual.md)；本文
各节即偏差采纳后的现行口径。

- [ ] 已知瑕疵：zh 暗色 hero 右上入镜外观 tooltip（「深色 · 当前深色」），
      en 套干净——重拍一帧或接受，owner 定。
- [ ] 演示 GIF（截图之后的独立资产任务）
