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
| 文件组织 | `docs/screenshots/zh/` + `docs/screenshots/en/`，命名 `01-hero.png` … `05-hero-dark.png`；旧平铺五张删除，两份 README 各自引用对应语言目录 |
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
| 帮我搜一下诺兰新电影《奥德赛》的相关资讯 | **hero 真跑**，拍摄时进行中 | 实时步数 |
| 用户访谈纪要整理与共性归纳（Q3 项目内） | running（种子态） | 思考中…（「第 N 步」是内存态种不出） |
| 帮我查下周去上海的高铁班次 | 等你回复 | **现场真跑制造**（ask_user 是内存态，不可种） |
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
"review"（≥3 条标题含 review）。会话示例：*Weekly movie releases and
reception, as a table*（hero）/ *Sort the installers piling up in
Downloads* / *High-speed rail options to Shanghai next week*（waiting
for you）/ *Q2 expense reports sorted and summarized*（unread）/
*Follow up on PR #1234 review feedback*（supervisor）/ *Book club prep:
venue, reading list, invites*（Goal）。

## 场景清单

| # | 文件 | 画面 | 必须入镜 |
|---|---|---|---|
| 1 | `01-hero.png` | MainView 主对话，hero 任务跑到中段 | 用户消息杏沙锚点；thinking 摘要；≥3 种工具调用（code_run / web_execute_js / web_scan）；行动→结论分隔线 + 一段富 markdown 结论（含表格）；TopBar YOLO 徽标；sidebar 满员多状态 |
| 2 | `02-sessions.png` | Project view 展开的状态板 | 两个项目展开；running 呼吸 rail + 步数、等你回复、未读实心点、已完成同框；supervisor 徽标那条可见 |
| 3 | `03-goal.png` | 读书会会话打开，Goal run 全章节 | 委派标记（Goal eyebrow + 预算参数）→ 降权旁白 → 收口标记（✓ 已完成 · 用时 + 查看结果） |
| 4 | `04-search.png` | ⌘K 命令面板，已输入「整理」（en: "review"） | ≥3 条命中会话；浮层 + 半透明遮罩构图 |
| 5 | `05-hero-dark.png` | 场景 1 同内容，暗色主题 | 同场景 1；README 可用 `<picture prefers-color-scheme>` 给暗色访客自动切换 |

## Hero prompt（真跑）

zh：`帮我搜一下诺兰新电影《奥德赛》的相关资讯，整理成一张表：档期与制式、主演阵容、口碑要点。`
en：`Look up the latest on Nolan's new film The Odyssey and organize a table: release date and formats, cast, and early buzz.`

选它的理由：**具体优于空泛**——一个真的有人想问的问题，而非测试用例
腔；与旧截图的诺兰任务一脉相承（内容品味的延续）；2026-07 上映窗口，
时效自然；非 coding、天然驱动联网检索 + 网页脚本 + code_run 的多工具
序列；产出 markdown 表格（顺带展示表格排印）。跑到第 6–10 步之间、
结论已出首段时截图；若某次运行工具序列不理想（如全程只用一种工具），
换一次重跑——真跑保证真实，多跑几次保证代表性，两者不矛盾。

## 待办与状态

- [x] 种子脚本 `scripts/seed-screenshots.py`（zh/en 双套，离线自检通过：
      goal 匹配启发式、JSON 列、turn 布局、关键词命中全绿）
- [x] 可行性验证（2026-07-03 schema 调查）：Goal 章节框**可纯种**（终态
      goal + objective 与用户消息逐字一致 + system 叙述行）；running 态
      可种且重启存活（Core 启动无状态调和），但 subline 只有「思考中…」
      且不可点开；**ask_user 不可种**（纯内存态），现场真跑制造。
- [ ] zh / en 两套拍摄 + 暗色 hero
- [ ] 替换 `docs/screenshots/`，更新两份 README 引用（含 `<picture>` 暗色切换）
- [ ] 演示 GIF（截图之后的独立资产任务）
