# Galley README 截图 playbook

> README 视觉资产的生产手册：场景清单、种子内容、拍摄规范、环境隔离。
> 目标是**可重复**——UI 改版后重拍 = 跑种子 + 照单拍，不再出现 2026-07
> 发现的「五张全是 v0.1 dev-mock」式资产腐烂。
>
> 现行口径为 **v2**（2026-09-09 从零重设，决策见
> [devlog](./devlog/2026-09-09-screenshot-set-v2-plan.md)）；v1 的实拍偏差
> 见 [2026-07-03 devlog](./devlog/2026-07-03-screenshot-reshoot-bilingual.md)。
> 2026-10-21 起 `hero.png`、`hero-dark.png`、`tools.png` 三张按 **v3** 重拍：
> hero 改拍主对话（助理），tools 改拍从主对话派出去的子任务；其余五张暂留
> v2 画面（票：`.scratch/readme-screenshots-v3/issues/01-seed-main-chat-hero.md`）。

## 原则

- **样板间，不是造假**：内容可以精心布置（行业惯例），但画面里的每个
  任务必须是 Galley 真能跑出来的。展示做不到的事 = 越线。
- **每张图替一个卖点作证**：导览网格里的每张图对应 Highlights 的一张卡，
  读者扫一遍网格等于把功能列表看了一遍。没有卖点对应的画面不拍。
- **透明性叙事由工具时间线承担**（`tools.png` 专门作证：主对话派出去的
  子任务，在工作台里每一步都看得见）。
- **内容反映定位**：「跑在你电脑上的全能助手」——知识工作、生活事务、
  Dev 三分，每类一个项目。「维特根斯坦哲学与 LLM」项目是延续自 v1 的
  致敬彩蛋，v2 起整张 `projects.png` 都是它。v3 的 hero 讲「你只跟一个人
  说话」：主对话里交代事、记待办、派活、听汇报。
- **不拍空画布**：v1 的项目视图和「安静待命」两张 80% 是空白，v2 每张
  主区都有内容。

## 环境隔离（mv-swap）

本机 Galley 数据可弃，但拍摄环境必须**全员策展**（画面里每一行都是
设计过的），所以仍然换装：

```bash
# 1. 关闭 Galley（含托盘常驻），换走现有数据
mv "$HOME/Library/Application Support/app.galley"{,.real}

# 2. 冷启动 dev 让 migration 自建全新 schema，走完 onboarding 配一次
#    模型（hero 真跑要用）。走完后主区应打开主对话、只有一句问候——
#    这是 Core 首启建好的主对话，种子往这一行里写。然后退出
pnpm --dir gui tauri dev

# 3. 注入种子；--demo-repo 同时生成阅读面板用的演示仓库
#    （默认 ~/Documents/galley-refs/galley-site，已存在则先删）
#    最好上午 09:32 以后跑：更早的话「今早 09:12」那段会挪到 20 分钟前
#    （脚本打印 notice）
scripts/seed-screenshots.py --lang zh --demo-repo

# 4. 重启 dev → 按下方场景清单拍摄

# 5. 换英文套：Settings 语言切到 English；数据库重来一遍
rm "$HOME/Library/Application Support/app.galley/workbench.db"*
pnpm --dir gui tauri dev        # 走 onboarding，同样确认主对话已建好
scripts/seed-screenshots.py --lang en     # 演示仓库可复用，不带 --demo-repo

# 6. 清理
rm -rf "$HOME/Library/Application Support/app.galley"
mv "$HOME/Library/Application Support/app.galley"{.real,}
rm -rf ~/Documents/galley-refs/galley-site
```

## 拍摄规范

| 项 | 值 |
|---|---|
| 窗口尺寸 | 1600 × 1000 逻辑像素（Retina @2x 导出 3200 × 2000） |
| 主题 | 浅色为主；`hero-dark` 为暗色 |
| 阅读宽度 | compact |
| 对话字号 | standard |
| Sidebar 宽度 | 默认 20% |
| 截图方式 | `⌘⇧4 + 空格` 带窗口阴影；全套一致 |
| 文件组织 | `docs/screenshots/zh/` + `docs/screenshots/en/`，**按场景命名**：`hero.png` `hero-dark.png` `tools.png` `reading.png` `projects.png` `scheduled.png` `search.png`；两份 README 各自引用对应语言目录 |
| 入镜纪律 | 无 dev 调试 chrome、无系统通知、无 tooltip；时间状态合理（种子时间戳相对拍摄日生成） |
| 提交前 | 缩到 1600px 宽（系统 Python 的 Pillow：LANCZOS + `optimize=True`），单张 ≤ 600KB 上下（见文末资产政策） |

## 种子内容（--lang zh）

脚本 `scripts/seed-screenshots.py` 是唯一事实来源，本节是导读。

**项目**：

| 项目 | 领域 | 内含会话 |
|---|---|---|
| 维特根斯坦哲学与 LLM | 知识 | PI §43 与工具调用的语义整理（已完成，`projects.png` 主区）· 「语言游戏」概念的产品化笔记（未读）· 《哲学研究》中译本豆瓣评分对比（已完成）· 筹备读书会（已完成） |
| 九月搬家 | 生活 | 下周三去杭州的高铁班次（清单）· 旧家具二手挂牌文案（短文）。v3 起「三家搬家公司报价与评价对比」移出项目，改作主对话的子任务（见下） |
| galley-site | Dev | 给 galley-site 加导览页并接进导航（已完成，`reading.png` 主区）· 排查 CI 缓存命中率下降（**running · 思考中**）· 跟进 #1234 PR 的 review 反馈（**supervisor 徽标**） |

**散置会话**：整理 Downloads 里的安装包和旧截图（终端与文件工具）·
把桌面这份 PDF 的要点整理成表（file_read + 表格）· 上季度报销单分类汇总
（**未读**）· 昨日支出汇总（**定时任务创建**）· 面试准备：手写并发限流 +
防抖（**置顶**，代码块）· MCP server 选型笔记（三天前）。

**主对话**（v3，`hero.png` 主区）：时间都相对跑种子的时刻、按本机时区算。

| 时间 | 你说 | 它答 | 落库 |
|---|---|---|---|
| 三天前 20:31 | — | 问候语（Core 的固定文案，按 `--lang` 写） | Core 首启建的那一行，种子把建立时间和问候挪到这里 |
| 三天前 20:40 | 记两件事：21 号要给房东转房租；干洗店那套西装好了，有空去取。（日期取今天） | 记下了：「给房东转 10 月房租」21 号到期，「取干洗的西装」随时。 | 两条待办，卡片挂在这条回复下 |
| 昨晚 21:10 | 下周三要交季度报告的材料，周二晚上我在家。 | 记下了：「交季度报告材料」截止下周三，周二晚上 8 点提醒你过一遍。不用提醒的话说一声。 | 待办一条（截止下周三）＋ 周二 20:00 的一次性提醒（叫醒助理），卡片挂在这条回复下 |
| 今早 09:12 | 帮我比较一下三家搬家公司的报价和评价。 | 好，这个我派出去查：三家的报价按同一口径折算，再对一遍近三个月的评价，查好了告诉你。 | 回复带派活标签 → 子任务卡片（已完成） |
| 今早 09:14 | —（Core 的汇报行，页面不画） | 查好了：三家都能周六上门，报价 1,680 到 2,300。评价最稳的是公兴，价格居中；最便宜的蚂蚁近期有两条丢件差评。要我把公兴的预约电话发你吗？ | 汇报轮：一行隐藏的 `galley-report` 用户行 ＋ 这条回复 |

记待办的两轮各有一步 `code_run`（`"$GALLEY" todo add …`），平时折叠在回复的
「过程」按钮里。三段之间隔了一夜，种子按 Core 的分段规则记了两条分段边界。

**子任务**「三家搬家公司报价与评价对比」（`tools.png` 主区）：挂在主对话下、
没在里面写过字，所以**不在侧栏**，只在今早那条回复下有卡片；首条消息是助理写的
派活说明（来源「主对话派来的」），三步工具（web_scan、web_execute_js ×2）后给
对比表：日式搬家 ¥2,300、公兴 ¥1,960、蚂蚁 ¥1,680，三家月底周六都可约，推荐公兴，
与汇报那句的数字一致。

**待办**（3 条，顶栏「待办」旁的今天计数是 1）：给房东转 N 月房租（今天到期）·
取干洗的西装（随时）· 交季度报告材料（下周三到期，周二 20:00 提醒）。

**定时任务**（4 条；`scheduled.png` 暂留，见场景清单）：每天 08:30 昨日支出
汇总（有上次运行，可打开）· 每周一 09:00 本周展览与讲座（尚未运行）· 每月 1 日
09:30 发票整理（已停用）· 交季度报告材料的一次性提醒（助理建的，挂在待办上）。

**产出形态分布**（工作台会话，含子任务）：表格 ×5、编号或圆点清单 ×3、代码块 ×1、
短文 ×1、一句话结论 ×4。**工具组合**：每条会话的工具序列不重样（web_scan /
web_execute_js / file_read / file_write / file_patch / code_run 各有出场）。
每条 final 都带 telemetry（「N 步 · 用时」页脚）。

**关键词布点**：「整理」出现在 3 条标题（语义整理 / 整理 Downloads / 整理
成表）+ 多条正文；`search.png` 直接搜「整理」。

**--lang en 对应集**：同结构、原生英文重写（非直译）。关键词换 "sort"
（3 条标题：*Sort the installers piling up in Downloads* / *Sort the key
points of the budget PDF into a table* / *Sort last quarter's expense
reports*）。豆瓣一条换成 Goodreads 英译本对比。主对话同构：待办叫
*Pay the landlord October's rent* / *Pick up the suit from the dry
cleaner's* / *Hand in the quarterly report materials*，子任务叫 *Three
moving companies: quotes and reviews*。

**不种**：error / cancelled 状态（README 场景无需）、
附件与图片消息（seed 复杂度不值）、「等你回复」态（ask_user 是内存态不可
种）、Channels（需要真实账号，见 devlog 的否决记录）、hero 现场那一轮（真跑，
见 Hero prompt）、定时任务跑完叫醒主对话的汇报轮（有主对话时 08:30 那条每天
会在主对话里汇报一次；种子没种，主对话里看不到）。

**拍摄纪律**：

- 不要点开 running 种子行（点开会派生回 idle）；不要点开未读行（会清零
  未读点）；种子必须在走完 onboarding 配好模型**之后**注入（`managed_models`
  空表会被拦回 onboarding），也就是 Core 已经建好主对话之后。
- 主对话标题菜单最后一项「重置主对话…」和设置里那个按住 5 秒的按钮都别碰：
  它连同子任务、全部待办一起删掉，种子得重来。
- 子任务只看不写：在里面发一句它就转成普通对话进侧栏（卡片还在，侧栏多一行）。
  点卡片「打开」、顶栏「Galley ›」回主对话都安全。
- 不要勾待办、不要删种好的消息：勾掉的待办进「已完成」，今天计数跟着变；
  带子任务卡片的那条回复本来也删不掉。
- 侧栏助理的脸跟着状态动（派活后在忙）；系统设置「减弱动态效果」开着时脸静止、
  头像角上改成转圈徽标，拍 hero 前先关掉。
- 种子的「今早」固定在 09:12；早于 09:32 跑种子会整段挪到 20 分钟前（脚本打印
  notice）。拍摄日最好上午十点后再跑种子。

## 场景清单

| 文件 | 画面 | 替哪个卖点作证 | 操作 | 必须入镜 |
|---|---|---|---|---|
| `hero.png` | 主对话（v3）：上面是种好的昨晚、今早两段（待办卡片、已完成的子任务卡片、汇报那句），最下面是现场发的 Hero prompt：助理回一句并派出子任务，卡片在跑 | 你只跟一个人说话：交代事、记待办、派活、听汇报 | 启动后主区就是主对话（不是就点侧栏顶部的助理卡片）→ 输入 Hero prompt 发送 → 助理回复、卡片出现「第 N 步 · …」时拍；画面从「昨天 21:10」那条时间线起 | 顶栏「待办」与今天计数 1；昨晚回复下的待办卡片（截止下周三、周二 20:00 提醒）；今早回复下已完成的子任务卡片与汇报那句；现场一轮的气泡、回复与在跑的子任务卡片；侧栏助理卡片（脸在动）与满员多状态的会话列表（置顶、running「思考中」、未读实心点、supervisor 徽标、定时任务标记） |
| `hero-dark.png` | 同上，暗色主题 | 同上 | 现场那轮的子任务一般要跑几分钟：浅色拍完立刻切换外观，等 tooltip 消失再拍，两张卡片都在跑 | 同上；右上外观 tooltip 不入镜 |
| `tools.png` | 从今早回复下的卡片点「打开」进「三家搬家公司报价与评价对比」（v3）：工作台视图，顶栏面包屑「Galley ›」，右侧是助理写的派活说明气泡（标「主对话派来的」），下面三步折叠、结果表 | 工具时间线：派出去的活每一步都看得见 | 主对话 → 今早回复下的子任务卡片 →「打开」→ 滚到「派活说明 + 折叠的三步 + 结果表」同框；只看不写 | 面包屑「Galley ›」；派活说明气泡与来源标记；折叠 run 的步数与用时；结果表；侧栏里没有这条会话（未转成普通对话） |
| `reading.png` | （2026-10 暂留，外壳过时）阅读面板分栏：左边「给 galley-site 加导览页并接进导航」，右边演示仓库的工作区改动 | 阅读面板 | 点开会话 → 顶栏「查看工作区改动」→ 选择仓库 `~/Documents/galley-refs/galley-site` → 文件列表选 `src/styles.css` → 双列显示 | 文件列表 3 改 1 新；diff 双列；「与最新提交比较 · <hash>」头；左侧 final 的文件清单 |
| `projects.png` | （2026-10 暂留，外壳过时）侧栏「项目」分区里展开项目组「维特根斯坦哲学与 LLM」，主区打开「PI §43 与工具调用的语义整理」显示对照表（2026-10-08 起没有项目视图，待重拍） | 项目工作区 + 多会话并行 | 「项目」分区若折叠先点分区头展开 → 点「维特根斯坦哲学与 LLM」组行展开 → 点开 PI §43（已完成行，安全） | 置顶下的「项目 3」分区头；展开的组行（双行汇总）含已完成会话与未读行；另外两个项目的组行折叠在列；时间桶里只有项目以外的会话；主区对照表 |
| `scheduled.png` | （2026-10 暂留，外壳过时；v3 种子多一条待办的提醒）定时任务对话框，背后主区是「昨日支出汇总」 | 定时任务、后台常驻 | 先点开「昨日支出汇总」→ 侧栏「定时」→ 对话框 | 三条任务三种重复方式；一条带「上次 …」可打开；一条「尚未运行」；一条已停用 |
| `search.png` | （2026-10 暂留，外壳过时）⌘K 已输入「整理」（en: sort），标题与正文两类命中，高亮停在一条正文命中 | 持久化 + 搜索 | ⌘K → 输入 → 键盘下移到正文命中 | ≥3 条标题命中 + ≥1 条正文命中；浮层 + 半透明遮罩构图 |

## Hero prompt（真跑）

正式口径（v3，2026-10-21）：在主对话里现场发，不种。

zh：`这周末想带爸妈去看个展，帮我找几个地铁方便的，附开放时间和票价。`
en：`I'd like to take my parents to an exhibition this weekend. Find a few that are easy to reach by metro, with opening hours and ticket prices.`

期望的一轮：助理回一句、派出子任务（回复下出现卡片），子任务去翻这周末的展览
排期，卡片显示「第 N 步 · …」，侧栏助理的脸在忙。拍的是派活这一刻，不等子任务
跑完；它跑完后助理会在主对话里汇报，那是拍完之后的事。助理没派活、自己直接
答了，就把这一轮的两条气泡右键删掉再发一次，或换下面的备选；还不行就重跑
种子。

**准入标准（2026-07-03 实测教训）**：hero prompt 的答案必须依赖**模型
不可能预知的状态**——本机文件，或此时此刻的数据（排期、评分、余票）。
反例：「搜一下《奥德赛》的相关资讯」实测零工具单 turn 直答。本周展览
排期只能真去翻页面，多步工具链是物理必然；在主对话里这还意味着它够长，
助理会派出去办而不是自己当场答。

其余理由：生活服务类，路人能代入；「带爸妈」是只跟一个人说话时才会说的话；
与新定位「个人全能助手」一致。

v2 的口径（工作台新对话里真跑到结束，拍折叠的 run 与结果表）：
`这周末上海有哪些值得去的展览，帮我按地铁可达性排一下，附开放时间和票价，整理成一张表。`
/ `What exhibitions are worth seeing in Shanghai this weekend? Rank them by metro access, with opening hours and ticket prices, as a table.`

**备选**（同样过准入，时效型）：
`《奥德赛》快上映了，帮我查一下上海哪些影院会放 IMAX 70mm 版本、预售什么时候开，整理成一张表。`
**保底方案**（若模型端点自带联网搜索绕过工具层）：换本机任务——「把
桌面这份 PDF 的要点整理成一张表」，文件系统对模型不可见，工具调用必然
发生。

## README 版面（拍完后套用）

hero 保持 `<picture prefers-color-scheme>`；导览网格替换现有 Screenshots
节，顺序和 Highlights 两组一致（先助手，后团队）：

```markdown
## A quick tour

| | |
|---|---|
| ![Tool timeline](docs/screenshots/en/tools.png)<br/><sub>Tool timeline — every call's arguments, result, and timing, inline</sub> | ![Reading panel](docs/screenshots/en/reading.png)<br/><sub>Reading panel — review worktree changes beside the conversation</sub> |
| ![Project view](docs/screenshots/en/projects.png)<br/><sub>Project view — sessions advancing around one project</sub> | ![Scheduled tasks](docs/screenshots/en/scheduled.png)<br/><sub>Scheduled tasks — a prompt that runs itself every morning</sub> |
| ![Search](docs/screenshots/en/search.png)<br/><sub>⌘K — every past conversation, straight to the matching line</sub> | |
```

中文版同构（`docs/screenshots/zh/`，标题「截图」）。旧的 `01-hero` …
`05-hero-dark` 十个文件在新图提交的同一个 commit 里删除。

## 二进制资产政策（全 docs 通用）

进 git 的二进制**永远留在历史里**——删除和替换都只会让仓库更大，不会
更小。所以规则设在入口处：

- **只提交被文档引用的资产**。README 截图 = 上方场景清单的 7 张 × 双语，
  重拍**同名覆盖**，不新增文件、不留旧版（旧版在 git 历史里）。
- **提交前压尺寸**：README 截图导出后先缩到 2× 展示宽（README 展示宽
  800px → 图片 1600px 宽即可，无需 3200px 原始 Retina 尺寸），PNG 走一遍
  无损压缩（如 `pngquant` / ImageOptim）。单张目标 ≤ 600KB。
- **审计证据图**：全窗口截图用 JPEG（质量 80 足够作证据）或降采样 PNG；
  只保留报告正文引用的图。落选 / 重试的抓拍不进 repo（放本机
  `~/Documents/galley-refs/` 之类）。2026-06-16 审计的 `rejected/` 目录
  早于本政策，按归档现状保留，不追溯。
- **参考资料（PDF、论文等）不进 repo**：放 `~/Documents/galley-refs/`，
  文档里用纯文本提名（先例见 2026-05-20 repo hygiene devlog）。

## 与场景清单的偏差（2026-09-09 实拍，均已采纳为现行口径）

1. **Hero 保留「跑到中段」**：owner 看过完成态的方案后决定两套都用进行中
   的画面（zh 第 10 步、en 第 7 步），文字墙换来的是「工作中 + 秒数」的活感。
   en 套的步骤摘要里有中文（glm 写摘要不看界面语言），owner 接受。
2. **`tools.png` 未展开工具调用**：折叠态的 run 头 + 三步 + 结果表已足够，
   展开态不再要求。
3. **`reading.png` 用 `README.md` 而非 `src/styles.css`**：单行新增的 diff 更
   易读；en 套文件列表里多出的 `.DS_Store` owner 接受（演示仓库随后加了
   `.gitignore`，下次不会再出现）。
4. **第九张 `new.png`**：owner 加拍的新对话空状态（题词入镜），放在 README
   「为什么叫 Galley」节下方 640 宽，不进导览网格。（2026-10 暂留，外壳过时）
5. **两处产品修复顺手落地**：Git 审阅面板（状态标签折行、行号列按位数定宽、
   按词折行）和消息表格（从 max-content 横向滚动改为按词折行）——后者是
   `projects.png` 的 Example 列被截断暴露出来的，见 devlog。

## 当前状态与待办

- 2026-09-09：v2 实拍完成，zh / en 各 9 张已上 README，旧编号文件已删。
  实拍偏差见上节；种子脚本在实拍中修了两处（定时任务时间戳、表格文案）。
- 2026-10-21：种子补到迁移 052（主对话、子任务、待办与提醒），本手册的 hero /
  hero-dark / tools 三行改成 v3 场景，待 JC 实拍（zh / en 各一套）；其余五张暂留。
- [ ] 定时任务补跑失败的根因（见 deferred）
- [ ] 演示 GIF（截图之后的独立资产任务）
