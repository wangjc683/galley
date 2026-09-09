#!/usr/bin/env python3
"""Seed a Galley workbench.db with curated content for README screenshots.

Companion to docs/screenshot-playbook.md — run AFTER the mv-swap flow's
cold start + onboarding (the seed does not create managed_models; with an
empty managed_models table the app bounces back to onboarding and the
sidebar never renders).

    scripts/seed-screenshots.py --lang zh                 # default DB location
    scripts/seed-screenshots.py --lang en --db /path/to/workbench.db
    scripts/seed-screenshots.py --demo-repo               # also build the
                                                          # reading-panel repo
    scripts/seed-screenshots.py --demo-repo --no-db       # repo only

What the seed produces (per language, see content_zh / content_en):

  - 3 projects: the Wittgenstein easter egg (knowledge work), a household
    move (life admin), and galley-site (dev; pairs with the demo repo)
  - 17 sessions across knowledge / life / dev, with states: running
    ("Thinking..."), completed, unread, pinned, supervisor-created,
    scheduler-created, one completed Goal with chapter markers
  - 3 scheduled tasks (daily / weekly / monthly, one disabled)
  - telemetry on every final message (the "N 步 · 用时" footer)

Persistence facts this script relies on (verified 2026-07-03, re-checked
2026-09-09 against migrations 001-038):

  - sessions.status = 'running' with no in-flight turn renders as
    "Thinking..." (lastStepIndex is transient) and must not be clicked
    during the shoot (opening it derives the row back to idle)
  - ask_user is in-memory only and cannot be seeded — produce it live
  - Goal chapter markers read goals.master_session_id + message rows
    (turn_index, sequence) and require sessions.turn_count > 0
  - the sidebar "scheduled task" marker keys off
    sessions.created_by_supervisor == 'galley-scheduler'
  - messages_fts has no triggers; hydrate backfills it when empty, so a
    fresh seed can ignore FTS entirely
  - telemetry_json shape mirrors the runner's turn_end payload

The demo repo (--demo-repo) is a tiny static-site project with four
curated working-tree changes; the reading panel's Git review pane picks
it through its own folder dialog, nothing in the DB points at it.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "core" / "migrations"
DEFAULT_DB = (
    Path.home() / "Library" / "Application Support" / "app.galley" / "workbench.db"
)
DEFAULT_DEMO_REPO = Path.home() / "Documents" / "galley-refs" / "galley-site"

NOW = datetime.now(timezone.utc)
SCHEDULER_SUPERVISOR = "galley-scheduler"  # mirrors core/src/scheduler.rs


def iso(delta_minutes: float) -> str:
    """Timestamp `delta_minutes` before the seed run, ISO-8601 Zulu."""
    t = NOW - timedelta(minutes=delta_minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def minutes_since_local(time_of_day: str, *, day_of_month: int | None = None) -> float:
    """Minutes since the most recent local-clock occurrence of `time_of_day`
    (today or yesterday; or the given day of this / last month). Scheduler
    catch-up looks at last_fired_at: a seeded fire stamp older than today's
    slot makes Core fire the task for real during the shoot (observed
    2026-09-09 — the catch-up then failed and the row showed 上次触发失败).
    Stamped 5 s after the slot so second-precision comparison sees it as
    consumed."""
    now = datetime.now().astimezone()
    hh, mm = (int(x) for x in time_of_day.split(":"))
    if day_of_month is None:
        slot = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if slot > now:
            slot -= timedelta(days=1)
    else:
        slot = now.replace(day=day_of_month, hour=hh, minute=mm, second=0, microsecond=0)
        if slot > now:
            first = now.replace(day=1)
            slot = (first - timedelta(days=1)).replace(
                day=day_of_month, hour=hh, minute=mm, second=0, microsecond=0
            )
    # Stamp 5 s after the slot: Core's due check reads last_fired_at at
    # second precision and a millisecond-truncated stamp that lands before
    # the slot re-fires the period (observed on the 2026-09-09 en shoot).
    return (now - slot).total_seconds() / 60 - 5 / 60


def tc(tool_name: str, args: dict, tool_use_id: str) -> dict:
    return {"toolName": tool_name, "args": args, "toolUseId": tool_use_id}


def tr(content: str, tool_use_id: str) -> dict:
    return {"toolUseId": tool_use_id, "content": content}


def tele(elapsed_s: int, inp: int, out: int, requests: int) -> dict:
    return {
        "elapsedMs": elapsed_s * 1000,
        "inputTokens": inp,
        "outputTokens": out,
        "cacheCreateTokens": 0,
        "cacheReadTokens": 0,
        "requestCount": requests,
        "contextUsedChars": inp * 3,
        "contextLimitChars": 270000,
    }


# ---------------------------------------------------------------------------
# Content — one dict per language. Structure:
#   projects: [(id, name, minutes_ago)]
#   sessions: [dict] — see fields in insert_sessions(); "turns" holds the
#     conversation as a list of row dicts consumed by insert_messages().
#     origin = (created_via, supervisor, note) for supervisor / scheduler rows.
#   goal: the completed book-club goal (chapter markers for goal.png).
#   scheduled: [dict] — rows for the scheduled_tasks table.
# Keyword placement: zh titles contain 「整理」×3, en titles contain "sort"×3
# (search.png types that word).
# ---------------------------------------------------------------------------

def content_zh() -> dict:
    return {
        "projects": [
            ("proj_wittgenstein", "维特根斯坦哲学与 LLM", 26 * 60),
            ("proj_moving", "九月搬家", 40),
            ("proj_site", "galley-site", 30),
        ],
        "sessions": [
            # ---- 维特根斯坦哲学与 LLM（知识工作） ----
            {
                "id": "sess_pi43",
                "project": "proj_wittgenstein",
                "title": "PI §43 与工具调用的语义整理",
                "status": "completed",
                "summary": "语义对照笔记完成，含 12 组例句",
                "ago": 26 * 60,
                "turns": [
                    {
                        "user": "把《哲学研究》§43「意义即使用」和 LLM 的工具调用做一次语义对照，整理成一张表。",
                        "thinking": "先把 §43 的原文语境钉住，再映射到工具调用的三种情形。",
                        "steps": [
                            {
                                "preamble": "当前阶段：核对 §43 原文与上下文。",
                                "thinking": "陈嘉映译本与 Anscombe 英译并读，避免被单句误导。",
                                "tool_calls": [tc("file_read", {"path": "~/Documents/PI/PI-§43.md"}, "toolu_seed_01")],
                                "tool_results": [tr("§43 原文 + 前后各两节，约 900 字", "toolu_seed_01")],
                                "summary": "已核对 §43 原文与前后语境",
                            },
                        ],
                        "final": "对照表完成。核心并置：\n\n> Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.\n\n| 维特根斯坦 | 工具调用 | 例 |\n|---|---|---|\n| 词的意义是它在语言中的使用 | 工具的语义是它被调用的时机和方式 | 该看页面时才看页面，而不是会背 schema |\n| 定义不能穷尽用法 | 工具描述不能穷尽调用场景 | 同一个 `code_run` 既算账也改文件名 |\n| 语言游戏有家族相似 | 任务之间有家族相似 | 整理下载与整理报销共用一套动作 |\n| 遵守规则不是解释规则 | 正确调用不是复述文档 | 会背文档的模型仍会在错误时机调用 |\n\n12 组例句按「描述 / 误用 / 恰当使用」三栏排好，已存到项目目录。",
                        "summary": "12 组语义对照例句整理完成",
                        "telemetry": tele(42, 8210, 1830, 3),
                    }
                ],
            },
            {
                "id": "sess_lang_game",
                "project": "proj_wittgenstein",
                "title": "「语言游戏」概念的产品化笔记",
                "status": "completed",
                "unread": True,
                "summary": "三条产品原则已归纳成文",
                "ago": 24 * 60 + 40,
                "turns": [
                    {
                        "user": "从「语言游戏」这个概念出发，给 Galley 的交互设计提炼几条原则，写成能贴在墙上的短句。",
                        "thinking": "从「意义即使用」推出：同一个控件在不同语境里应有不同意义。",
                        "final": "三条原则：\n\n1. **同一个输入框在不同语境里意义不同**——交代任务、追问、顺口一提，是三种不同的游戏；\n2. **不解释，只展示**——功能应在使用中自明，而不是在说明书里；\n3. **不造术语**——给用户看的每个词，都要在他的生活形式里有用法。\n\n全文已写好，附了每条原则对应的反例。",
                        "summary": "三条产品原则已归纳成文",
                        "telemetry": tele(31, 5100, 940, 2),
                    }
                ],
            },
            {
                "id": "sess_douban",
                "project": "proj_wittgenstein",
                "title": "《哲学研究》中译本豆瓣评分对比",
                "status": "completed",
                "summary": "4 个译本评分与评论数已入表",
                "ago": 5 * 60,
                "turns": [
                    {
                        "user": "《哲学研究》的几个中译本在豆瓣上现在的评分和评论数分别是多少？整理一张对比表，每个译本再摘一条有代表性的短评。",
                        "thinking": "先搜索列出译本，再逐个打开详情页取评分、评论数和短评。",
                        "steps": [
                            {
                                "preamble": "当前阶段：搜索译本列表。",
                                "thinking": "先拿到全部搜索结果，再筛出《哲学研究》本体的不同译本。",
                                "tool_calls": [tc("web_scan", {"url": "https://search.douban.com/book/subject_search?search_text=哲学研究"}, "toolu_seed_02")],
                                "tool_results": [tr("搜索结果 14 条，其中《哲学研究》译本 4 种（陈嘉映 / 李步楼 / 楼巍 / 汤潮·范光棣）", "toolu_seed_02")],
                                "summary": "筛出 4 个译本",
                            },
                            {
                                "preamble": "当前阶段：逐个读取详情页。",
                                "thinking": "评分和评论数在页面顶部，短评取「有用」数最高的一条。",
                                "tool_calls": [tc("web_execute_js", {"action": "extract_ratings", "pages": 4}, "toolu_seed_03")],
                                "tool_results": [tr("4 页评分、评论数与热门短评已提取", "toolu_seed_03")],
                                "summary": "4 个详情页数据已提取",
                            },
                        ],
                        "final": "对比表如下（数据为此刻页面所示）：\n\n| 译本 | 出版社 | 评分 | 评论数 | 代表性短评 |\n|---|---|---|---|---|\n| 陈嘉映 | 商务印书馆 | 9.3 | 1,842 | 「译注是这本书的第二作者。」 |\n| 李步楼 | 商务印书馆 | 8.6 | 623 | 「老译本，句子硬但忠实。」 |\n| 楼巍 | 上海人民 | 8.9 | 417 | 「新译顺口，术语表很实用。」 |\n| 汤潮 · 范光棣 | 三联 | 8.1 | 288 | 「适合第一遍通读。」 |\n\n评分与评论数均为抓取时刻的页面值，短评取「有用」数最高者。",
                        "summary": "4 个译本评分与评论数已入表",
                        "telemetry": tele(96, 22400, 2100, 6),
                    }
                ],
            },
            # ---- 九月搬家（生活事务） ----
            {
                "id": "sess_movers",
                "project": "proj_moving",
                "title": "三家搬家公司报价与评价对比",
                "status": "completed",
                "summary": "3 家报价已入表，推荐 1 家",
                "ago": 40,
                "turns": [
                    {
                        "user": "帮我对比一下上海这三家搬家公司的报价和口碑：日式搬家、公兴、蚂蚁。两室一厅，浦东到徐汇，月底搬。",
                        "thinking": "报价按同一口径（车型、楼层、是否打包）拉齐，再看近三个月的评价。",
                        "steps": [
                            {
                                "preamble": "当前阶段：抓取三家的报价页。",
                                "thinking": "三家计价方式不同，先各自记录原始口径再折算。",
                                "tool_calls": [tc("web_scan", {"urls": 3, "purpose": "pricing pages"}, "toolu_seed_04")],
                                "tool_results": [tr("3 家报价页已读取：按车型 / 按体积 / 按套餐", "toolu_seed_04")],
                                "summary": "3 家报价口径已记录",
                            },
                            {
                                "preamble": "当前阶段：汇总近三个月评价。",
                                "thinking": "只看带图和带订单的评价，剔除刷评特征。",
                                "tool_calls": [tc("web_execute_js", {"action": "collect_reviews", "months": 3}, "toolu_seed_05")],
                                "tool_results": [tr("有效评价 3 家共 217 条，已按准时 / 损坏 / 加价三类归并", "toolu_seed_05")],
                                "summary": "217 条评价已归类",
                            },
                        ],
                        "final": "同口径折算后：\n\n| 公司 | 预估总价 | 含打包 | 准时率 | 近三月差评关键词 |\n|---|---|---|---|---|\n| 日式搬家 | ¥3,200 | 是 | 97% | 「贵」 |\n| 公兴 | ¥1,850 | 否（+¥400） | 91% | 「临时加价」×6 |\n| 蚂蚁 | ¥1,600 | 否（+¥350） | 88% | 「家具磕碰」×9 |\n\n推荐**日式搬家**：贵 ¥1,000 左右，但差评里没有加价和损坏。如果预算优先，公兴加打包后 ¥2,250，记得电话里把加价条款问清。",
                        "summary": "3 家报价已入表，推荐 1 家",
                        "telemetry": tele(118, 19800, 1650, 7),
                    }
                ],
            },
            {
                "id": "sess_rail",
                "project": "proj_moving",
                "title": "下周三去杭州的高铁班次",
                "status": "completed",
                "summary": "上午 3 班可选，已列出余票",
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "下周三上午从上海虹桥去杭州东的高铁，帮我列一下 8 点到 10 点之间的班次和二等座余票。",
                        "thinking": "12306 查询页要选日期和站点，余票以查询时刻为准。",
                        "steps": [
                            {
                                "preamble": "当前阶段：查询班次。",
                                "thinking": "只保留虹桥始发、杭州东到达的车次。",
                                "tool_calls": [tc("web_execute_js", {"action": "query_trains", "from": "上海虹桥", "to": "杭州东"}, "toolu_seed_06")],
                                "tool_results": [tr("8:00–10:00 共 11 班，其中 3 班二等座余票充足", "toolu_seed_06")],
                                "summary": "11 班车次已取回",
                            },
                        ],
                        "final": "8 点到 10 点之间余票充足的 3 班：\n\n- **G7305** 08:12 → 09:05，53 分钟，二等座 有\n- **G1345** 08:46 → 09:42，56 分钟，二等座 有\n- **G7315** 09:30 → 10:17，47 分钟，二等座 有\n\n其余 8 班二等座已售罄或仅剩少量。余票以查询时刻为准，要订的话告诉我车次。",
                        "summary": "上午 3 班可选，已列出余票",
                        "telemetry": tele(38, 6400, 520, 3),
                    }
                ],
            },
            {
                "id": "sess_listing",
                "project": "proj_moving",
                "title": "旧家具二手挂牌文案",
                "status": "completed",
                "summary": "4 件家具的文案与定价已写好",
                "ago": 2 * 60,
                "turns": [
                    {
                        "user": "这四件旧家具想挂闲鱼：宜家书架、双人沙发、升降桌、床头柜。帮我写文案，顺便按同城成交价定个价。",
                        "thinking": "先查同款近期成交价，再按成色打折写文案。",
                        "steps": [
                            {
                                "preamble": "当前阶段：查同款成交价。",
                                "thinking": "只看「已售出」并且同城的记录。",
                                "tool_calls": [tc("web_scan", {"query": "同款已售出 上海", "items": 4}, "toolu_seed_07")],
                                "tool_results": [tr("4 件同款近 30 天同城成交价区间已取回", "toolu_seed_07")],
                                "summary": "4 件同款成交价已取回",
                            },
                        ],
                        "final": "文案和定价：\n\n**宜家 BILLY 书架 · ¥120**\n八成新，无变形，两块层板有轻微划痕（见图）。自提，徐汇。\n\n**双人布艺沙发 · ¥450**\n用了两年，可拆洗套已洗净，无宠物。需自己找搬运。\n\n**电动升降桌 120×60 · ¥680**\n三档记忆，电机静音，桌面无划痕。原价 ¥1,499。\n\n**床头柜（一对）· ¥90**\n实木贴皮，抽屉顺滑，一起走。\n\n定价取同城成交价的中位数再下浮 10%，方便议价。",
                        "summary": "4 件家具的文案与定价已写好",
                        "telemetry": tele(54, 9100, 1380, 4),
                    }
                ],
            },
            # ---- galley-site（Dev） ----
            {
                "id": "sess_tour_page",
                "project": "proj_site",
                "title": "给 galley-site 加导览页并接进导航",
                "status": "completed",
                "summary": "改动 3 个文件，新增 1 个，待你审阅",
                "ago": 30,
                "turns": [
                    {
                        "user": "给文档站加一个 /tour 页面，把 README 里的六张截图按「助手 → 团队」的顺序排成网格，再接进顶部导航。改完先别提交。",
                        "thinking": "先看导航和页面的现有写法，照同一套模式加，不引入新依赖。",
                        "steps": [
                            {
                                "preamble": "当前阶段：读现有导航与页面结构。",
                                "thinking": "顺着 nav.ts 的条目形状加一条，页面照 index.ts 的导出模式写。",
                                "tool_calls": [tc("file_read", {"paths": ["src/nav.ts", "src/pages/index.ts"]}, "toolu_seed_08")],
                                "tool_results": [tr("nav.ts：4 个条目；index.ts：默认导出 render(root)", "toolu_seed_08")],
                                "summary": "已读导航与页面写法",
                            },
                            {
                                "preamble": "当前阶段：写页面并接导航。",
                                "thinking": "网格用现有的 .grid 变量，只补一个 .tour-grid 的列数。",
                                "tool_calls": [
                                    tc("file_write", {"path": "src/pages/tour.ts"}, "toolu_seed_09"),
                                    tc("file_patch", {"path": "src/nav.ts"}, "toolu_seed_10"),
                                ],
                                "tool_results": [
                                    tr("已写入 src/pages/tour.ts（38 行）", "toolu_seed_09"),
                                    tr("nav.ts：新增 Tour 条目", "toolu_seed_10"),
                                ],
                                "summary": "页面与导航已改",
                            },
                            {
                                "preamble": "当前阶段：本地构建验证。",
                                "thinking": "构建通过再交给你看 diff。",
                                "tool_calls": [tc("code_run", {"command": "pnpm build"}, "toolu_seed_11")],
                                "tool_results": [tr("build ok · 6 pages · 1.2s", "toolu_seed_11")],
                                "summary": "构建通过",
                            },
                        ],
                        "final": "改好了，未提交：\n\n- `src/nav.ts` 新增 **Tour** 条目，排在 Docs 之后\n- `src/pages/tour.ts` 新文件，六张截图两列网格，顺序为助手四张、团队两张\n- `src/styles.css` 补了 `.tour-grid` 两列布局与图注样式\n- `README.md` 加了指向 /tour 的一行\n\n打开右侧「工作区改动」可以逐个文件看 diff，确认后我再提交。",
                        "summary": "改动 3 个文件，新增 1 个，待审阅",
                        "telemetry": tele(87, 14200, 2260, 5),
                    }
                ],
            },
            {
                "id": "sess_ci_cache",
                "project": "proj_site",
                "title": "排查 CI 缓存命中率下降",
                "status": "running",
                "summary": "正在对比最近 5 次构建的缓存 key",
                "ago": 2,
                "turns": [
                    {
                        "user": "最近 CI 每次都要重装依赖，缓存好像没命中，帮我查一下是哪次改动之后开始的。",
                    }
                ],
            },
            {
                "id": "sess_pr_review",
                "project": "proj_site",
                "title": "跟进 #1234 PR 的 review 反馈",
                "status": "completed",
                "summary": "已回复 3 条 review 意见并更新 PR",
                "ago": 4 * 60,
                "origin": ("supervisor", "ga-claude-1", "跟进 PR review"),
                "turns": [
                    {
                        "user": "看下 #1234 的 review 反馈，能直接改的改掉，需要讨论的整理出来。",
                        "thinking": "先拉取 review comments，区分「直接改」与「需要作者决策」。",
                        "final": "3 条意见已处理：2 条直接修改并推送（变量命名、缺失的错误分支），1 条涉及接口取舍已整理成回复等你决定。PR 已更新。",
                        "summary": "回复 3 条 review 意见并更新 PR",
                        "telemetry": tele(187, 31000, 2400, 9),
                    }
                ],
            },
            # ---- 散置会话 ----
            {
                "id": "sess_downloads",
                "project": None,
                "title": "整理 Downloads 里的安装包和旧截图",
                "status": "completed",
                "summary": "已按类型归档 38 个文件",
                "ago": 55,
                "turns": [
                    {
                        "user": "Downloads 都堆满了，帮我把安装包和旧截图整理一下，按类型归档。",
                        "thinking": "先列目录统计文件类型分布，再分组移动，动文件前汇总一次清单。",
                        "steps": [
                            {
                                "preamble": "当前阶段：清点 Downloads 内容。",
                                "thinking": "先统计文件类型分布再决定归档结构。",
                                "tool_calls": [tc("code_run", {"language": "python", "purpose": "list Downloads by type"}, "toolu_seed_12")],
                                "tool_results": [tr("dmg×9 zip×6 png×17 pdf×4 其他×2，共 38 个文件", "toolu_seed_12")],
                                "summary": "清点出 38 个待归档文件",
                            },
                        ],
                        "final": "整理完成：38 个文件已归入 `Installers/`、`Screenshots/`、`Docs/` 三个目录，9 个安装包里有 4 个版本已过期，清单在下面，确认后可以删。",
                        "summary": "Downloads 已按类型归档 38 个文件",
                        "telemetry": tele(51, 9400, 1200, 4),
                    }
                ],
            },
            {
                "id": "sess_pdf",
                "project": None,
                "title": "把桌面这份 PDF 的要点整理成表",
                "status": "completed",
                "summary": "27 页提炼为 9 行要点表",
                "ago": 90,
                "turns": [
                    {
                        "user": "桌面上那份「2026 家庭年度预算.pdf」，帮我把要点整理成一张表，按支出类别列预算和上半年实际。",
                        "thinking": "PDF 里的表格分散在三页，先全文读出来再合并。",
                        "steps": [
                            {
                                "preamble": "当前阶段：读取 PDF 全文。",
                                "thinking": "表格跨页，按类别名做合并键。",
                                "tool_calls": [tc("file_read", {"path": "~/Desktop/2026 家庭年度预算.pdf"}, "toolu_seed_13")],
                                "tool_results": [tr("27 页，提取到 3 张表、9 个支出类别", "toolu_seed_13")],
                                "summary": "已提取 3 张表 9 个类别",
                            },
                        ],
                        "final": "要点表：\n\n| 类别 | 年度预算 | 上半年实际 | 进度 |\n|---|---|---|---|\n| 房租 | ¥96,000 | ¥48,000 | 50% |\n| 餐饮 | ¥36,000 | ¥19,800 | 55% |\n| 交通 | ¥9,600 | ¥3,900 | 41% |\n| 教育 | ¥24,000 | ¥15,600 | 65% |\n| 医疗 | ¥8,000 | ¥1,200 | 15% |\n\n（共 9 类，其余 4 类进度均在 45–52%。）教育超前 15 个百分点，是下半年唯一需要盯的类别。",
                        "summary": "27 页提炼为 9 行要点表",
                        "telemetry": tele(44, 11800, 900, 3),
                    }
                ],
            },
            {
                "id": "sess_expense",
                "project": None,
                "title": "上季度报销单分类汇总",
                "status": "completed",
                "unread": True,
                "summary": "共 47 笔支出分 6 类，2 笔待补发票",
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "把 expenses 文件夹里上季度的报销单按类别汇总一下，缺发票的单独列出来。",
                        "thinking": "按类别聚合金额，同时核对发票编号列的空缺。",
                        "final": "汇总完成：共 **47 笔** 支出，分 6 类，合计 ¥12,840。其中 **2 笔缺发票**（差旅 ¥680、办公 ¥120）已单独列出，其余可直接提交。",
                        "summary": "47 笔支出分 6 类汇总完成",
                        "telemetry": tele(39, 12800, 860, 3),
                    }
                ],
            },
            {
                "id": "sess_daily_spend",
                "project": None,
                "title": "昨日支出汇总",
                "status": "completed",
                "summary": "昨日 6 笔共 ¥318，餐饮占六成",
                "ago": minutes_since_local("08:30"),
                "origin": ("supervisor", SCHEDULER_SUPERVISOR, "scheduled task sched_daily_spend"),
                "turns": [
                    {
                        "user": "汇总昨天记账软件导出的支出记录，按类别列金额，超过 ¥200 的单笔标出来。",
                        "thinking": "导出文件在固定路径，按类别聚合后看单笔阈值。",
                        "steps": [
                            {
                                "preamble": "当前阶段：读取昨日导出。",
                                "thinking": "只取昨天日期的行。",
                                "tool_calls": [tc("file_read", {"path": "~/Documents/ledger/export-latest.csv"}, "toolu_seed_14")],
                                "tool_results": [tr("昨日 6 行记录", "toolu_seed_14")],
                                "summary": "读取 6 笔记录",
                            },
                        ],
                        "final": "昨日支出 **¥318**，6 笔：\n\n- 餐饮 ¥192（3 笔）\n- 交通 ¥46（2 笔）\n- 日用 ¥80（1 笔）\n\n没有超过 ¥200 的单笔。",
                        "summary": "昨日 6 笔共 ¥318",
                        "telemetry": tele(22, 3900, 310, 2),
                    }
                ],
            },
            {
                "id": "sess_monthly_invoice",
                "project": None,
                "title": "八月发票与报销单汇总",
                "status": "completed",
                "summary": "31 笔已入表，3 笔缺发票",
                "ago": minutes_since_local("09:30", day_of_month=1),
                "origin": ("supervisor", SCHEDULER_SUPERVISOR, "scheduled task sched_monthly_invoice"),
                "turns": [
                    {
                        "user": "把上个月的发票和报销单整理成一张表，缺发票的单独列出来。",
                        "thinking": "按报销单号对发票，缺的单独列。",
                        "final": "八月共 **31 笔**，合计 ¥8,420，已入表。缺发票 **3 笔**（交通 ¥45、餐饮 ¥168、办公 ¥260），补齐后可一起提交。",
                        "summary": "31 笔已入表，3 笔缺发票",
                        "telemetry": tele(35, 6800, 540, 3),
                    }
                ],
            },
            {
                "id": "sess_interview_prep",
                "project": None,
                "title": "面试准备：手写并发限流 + 防抖",
                "status": "completed",
                "pinned": True,
                "summary": "含 4 个常见变体写法",
                "ago": 5 * 24 * 60,
                "turns": [
                    {
                        "user": "手写一遍并发限流和防抖，把面试常问的变体也覆盖到。",
                        "thinking": "限流从信号量版写到滑动窗口版，防抖覆盖 leading/trailing。",
                        "final": "两题四个变体都写好了。先把这句说清再写代码：限流控制**同时在跑的数量**，防抖控制**触发的频率**。\n\n最常被追问的信号量版限流：\n\n```ts\nfunction limit<T>(n: number) {\n  let active = 0;\n  const queue: (() => void)[] = [];\n  const next = () => { active--; queue.shift()?.(); };\n  return (task: () => Promise<T>) =>\n    new Promise<T>((resolve, reject) => {\n      const run = () => { active++; task().then(resolve, reject).finally(next); };\n      active < n ? run() : queue.push(run);\n    });\n}\n```\n\n其余三个变体（滑动窗口限流、leading / trailing 防抖）在下面，每段后附「面试官追问点」。",
                        "summary": "完成限流与防抖的 4 个变体写法",
                        "telemetry": tele(66, 7200, 3100, 4),
                    }
                ],
            },
            {
                "id": "sess_bookclub",
                "project": "proj_wittgenstein",
                "title": "筹备读书会：场地、书单、邀请文案",
                "status": "completed",
                "summary": "场地、书单、邀请文案三项产出齐备",
                "ago": 24 * 60,
                "goal_session": True,
                "turns": [],  # built by goal seeding below
            },
            {
                "id": "sess_mcp",
                "project": None,
                "title": "MCP server 选型笔记",
                "status": "completed",
                "summary": "6 个候选已对比 + 推荐 1 个",
                "ago": 3 * 24 * 60,
                "turns": [
                    {
                        "user": "对比一下这 6 个 MCP server 实现，从维护活跃度、协议覆盖、部署成本三个维度。",
                        "thinking": "逐个查 repo 活跃度和 release 节奏，协议覆盖对照官方 spec 列表。",
                        "final": "对比表完成。综合推荐候选 **B**：三个维度都在前二，且是唯一同时覆盖 resources 与 prompts 的实现；候选 D 活跃度最高但协议覆盖不全，作备选。",
                        "summary": "6 个 MCP server 对比完成，推荐 1 个",
                        "telemetry": tele(142, 26500, 1900, 7),
                    }
                ],
            },
        ],
        "goal": {
            "id": "goal_bookclub",
            "session": "sess_bookclub",
            "project": "proj_wittgenstein",
            "objective": "帮我筹备下个月的《哲学研究》读书会：找 3 个候选场地、拟一份书单、写好邀请文案。",
            "budget_seconds": 30 * 60,
            "elapsed_minutes": 26,
            "latest_summary": "三项产出齐备：候选场地 3 处（含报价）、书单 8 本、邀请文案两版。",
            "narrations": [
                "已接收目标，拆解为场地、书单、文案三条线，预算 30 分钟，开始并行推进。",
                "场地线完成：3 处候选已连同容纳人数与报价整理入表；书单线进行中。",
                "全部完成：书单 8 本按难度梯度排序，邀请文案正式版与轻松版各一，产出已汇总。",
            ],
        },
        "scheduled": [
            {
                "id": "sched_daily_spend",
                "project": None,
                "prompt": "汇总昨天记账软件导出的支出记录，按类别列金额，超过 ¥200 的单笔标出来。",
                "repeat_kind": "daily",
                "repeat_days": None,
                "time_of_day": "08:30",
                "enabled": 1,
                "last_fired_ago": minutes_since_local("08:30"),
                "last_run_session": "sess_daily_spend",
                "created_ago": 12 * 24 * 60,
            },
            {
                "id": "sched_weekly_expo",
                "project": None,
                "prompt": "查一下本周上海新开的展览和讲座，按地铁可达性排一下，附开放时间和票价。",
                "repeat_kind": "weekly",
                "repeat_days": "1",
                "time_of_day": "09:00",
                "enabled": 1,
                "last_fired_ago": None,
                "last_run_session": None,
                "created_ago": 60,
            },
            {
                "id": "sched_monthly_invoice",
                "project": None,
                "prompt": "把上个月的发票和报销单整理成一张表，缺发票的单独列出来。",
                "repeat_kind": "monthly",
                "repeat_days": "1",
                "time_of_day": "09:30",
                "enabled": 0,
                "last_fired_ago": minutes_since_local("09:30", day_of_month=1),
                "last_run_session": "sess_monthly_invoice",
                "created_ago": 40 * 24 * 60,
            },
        ],
    }


def content_en() -> dict:
    return {
        "projects": [
            ("proj_wittgenstein", "Wittgenstein & LLMs", 26 * 60),
            ("proj_moving", "September move", 40),
            ("proj_site", "galley-site", 30),
        ],
        "sessions": [
            # ---- Wittgenstein & LLMs (knowledge work) ----
            {
                "id": "sess_pi43",
                "project": "proj_wittgenstein",
                "title": "PI §43 and tool-use semantics, side by side",
                "status": "completed",
                "summary": "Notes done — 12 paired examples",
                "ago": 26 * 60,
                "turns": [
                    {
                        "user": "Put Philosophical Investigations §43 (\"meaning is use\") next to LLM tool calling and lay the parallels out as a table.",
                        "thinking": "Pin down the §43 context first, then map it onto three tool-use situations.",
                        "steps": [
                            {
                                "preamble": "Current stage: checking §43 against its surroundings.",
                                "thinking": "Read Anscombe and Hacker & Schulte together so one sentence doesn't mislead.",
                                "tool_calls": [tc("file_read", {"path": "~/Documents/PI/PI-§43.md"}, "toolu_seed_01")],
                                "tool_results": [tr("§43 plus two sections either side, ~900 words", "toolu_seed_01")],
                                "summary": "§43 and its context verified",
                            },
                        ],
                        "final": "Done. The core parallel:\n\n> Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.\n\n| Wittgenstein | Tool calling | Example |\n|---|---|---|\n| A word's meaning is its use in the language | A tool's semantics is when and how it gets called | Scan when a page is needed, not because the schema says so |\n| Definitions never exhaust use | Tool descriptions never exhaust call sites | One `code_run` balances a ledger and renames files |\n| Language games share family resemblances | Tasks share family resemblances | Sorting downloads and sorting expenses share one skeleton |\n| Following a rule is not interpreting it | Calling correctly is not quoting the docs | Reciting the API still means calling it at the wrong time |\n\n12 paired examples arranged in three columns — description / misuse / apt use — saved to the project folder.",
                        "summary": "12 paired examples written up",
                        "telemetry": tele(42, 8210, 1830, 3),
                    }
                ],
            },
            {
                "id": "sess_lang_game",
                "project": "proj_wittgenstein",
                "title": "Turning \"language games\" into product principles",
                "status": "completed",
                "unread": True,
                "summary": "Three product principles written up",
                "ago": 24 * 60 + 40,
                "turns": [
                    {
                        "user": "Starting from \"language games\", distill a few interaction principles for Galley — short enough to pin on a wall.",
                        "thinking": "From \"meaning is use\": the same control should mean different things in different contexts.",
                        "final": "Three principles:\n\n1. **The same input box changes meaning with context** — delegating, following up, and mentioning in passing are three different games;\n2. **Don't explain, show** — features should be self-evident in use, not in a manual;\n3. **No jargon** — every word shown to users must have a use in their form of life.\n\nFull write-up saved, with a counter-example under each principle.",
                        "summary": "Three product principles written up",
                        "telemetry": tele(31, 5100, 940, 2),
                    }
                ],
            },
            {
                "id": "sess_douban",
                "project": "proj_wittgenstein",
                "title": "Goodreads ratings of the English PI editions",
                "status": "completed",
                "summary": "3 editions tabled with ratings and counts",
                "ago": 5 * 60,
                "turns": [
                    {
                        "user": "Compare the current Goodreads ratings and review counts of the main English editions of Philosophical Investigations, as a table with one representative review each.",
                        "thinking": "Search first to list editions, then open each page for rating, count, and a top review.",
                        "steps": [
                            {
                                "preamble": "Current stage: listing editions.",
                                "thinking": "Filter to editions of the Investigations proper.",
                                "tool_calls": [tc("web_scan", {"url": "https://www.goodreads.com/search?q=philosophical+investigations"}, "toolu_seed_02")],
                                "tool_results": [tr("11 results, 3 distinct English editions (Anscombe 1953 / Anscombe rev. 2001 / Hacker & Schulte 2009)", "toolu_seed_02")],
                                "summary": "3 editions identified",
                            },
                            {
                                "preamble": "Current stage: reading each edition page.",
                                "thinking": "Rating and count sit at the top; take the most-liked review.",
                                "tool_calls": [tc("web_execute_js", {"action": "extract_ratings", "pages": 3}, "toolu_seed_03")],
                                "tool_results": [tr("3 pages extracted", "toolu_seed_03")],
                                "summary": "3 edition pages extracted",
                            },
                        ],
                        "final": "As shown on the pages right now:\n\n| Edition | Translator | Rating | Ratings count | Representative review |\n|---|---|---|---|---|\n| Blackwell 1953 | Anscombe | 4.21 | 12,480 | \"The book that taught me to stop asking what words *are*.\" |\n| Blackwell 2001 (rev.) | Anscombe, rev. | 4.18 | 3,910 | \"Same voice, fewer stumbles.\" |\n| Wiley-Blackwell 2009 | Hacker & Schulte | 4.26 | 2,205 | \"Finally a translation that reads like prose.\" |\n\nRatings and counts are the page values at scan time; the review is the most-liked one per edition.",
                        "summary": "3 editions tabled with ratings and counts",
                        "telemetry": tele(96, 22400, 2100, 6),
                    }
                ],
            },
            # ---- September move (life admin) ----
            {
                "id": "sess_movers",
                "project": "proj_moving",
                "title": "Three moving companies: quotes and reviews",
                "status": "completed",
                "summary": "3 quotes tabled, 1 recommended",
                "ago": 40,
                "turns": [
                    {
                        "user": "Compare quotes and reputation for three Shanghai movers: Nihon Moving, Gongxing, and Ant. Two-bedroom, Pudong to Xuhui, end of month.",
                        "thinking": "Normalize quotes to one basis (truck, floors, packing), then read the last three months of reviews.",
                        "steps": [
                            {
                                "preamble": "Current stage: fetching the three pricing pages.",
                                "thinking": "Three different pricing models — record each raw, then convert.",
                                "tool_calls": [tc("web_scan", {"urls": 3, "purpose": "pricing pages"}, "toolu_seed_04")],
                                "tool_results": [tr("3 pricing pages read: per truck / per volume / per package", "toolu_seed_04")],
                                "summary": "3 pricing bases recorded",
                            },
                            {
                                "preamble": "Current stage: collecting recent reviews.",
                                "thinking": "Only reviews with photos or order numbers; drop review-farm patterns.",
                                "tool_calls": [tc("web_execute_js", {"action": "collect_reviews", "months": 3}, "toolu_seed_05")],
                                "tool_results": [tr("217 usable reviews across 3 companies, bucketed as punctuality / damage / surcharge", "toolu_seed_05")],
                                "summary": "217 reviews bucketed",
                            },
                        ],
                        "final": "On the same basis:\n\n| Company | Est. total | Packing included | On-time | Complaint keywords (3 mo) |\n|---|---|---|---|---|\n| Nihon Moving | ¥3,200 | Yes | 97% | \"pricey\" |\n| Gongxing | ¥1,850 | No (+¥400) | 91% | \"surcharge on the day\" ×6 |\n| Ant | ¥1,600 | No (+¥350) | 88% | \"scuffed furniture\" ×9 |\n\nRecommendation: **Nihon Moving**. About ¥1,000 more, but zero surcharge or damage complaints. If budget wins, Gongxing with packing comes to ¥2,250 — ask about surcharge terms on the phone.",
                        "summary": "3 quotes tabled, 1 recommended",
                        "telemetry": tele(118, 19800, 1650, 7),
                    }
                ],
            },
            {
                "id": "sess_rail",
                "project": "proj_moving",
                "title": "High-speed rail to Hangzhou next Wednesday",
                "status": "completed",
                "summary": "3 morning trains with seats, listed",
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "Next Wednesday morning, Shanghai Hongqiao to Hangzhou East — list the trains between 8 and 10 with second-class availability.",
                        "thinking": "12306 needs date and stations picked; availability is as of query time.",
                        "steps": [
                            {
                                "preamble": "Current stage: querying trains.",
                                "thinking": "Keep only Hongqiao departures arriving at Hangzhou East.",
                                "tool_calls": [tc("web_execute_js", {"action": "query_trains", "from": "Shanghai Hongqiao", "to": "Hangzhou East"}, "toolu_seed_06")],
                                "tool_results": [tr("11 trains 08:00–10:00, 3 with plenty of second-class seats", "toolu_seed_06")],
                                "summary": "11 trains retrieved",
                            },
                        ],
                        "final": "Three trains between 8 and 10 with seats:\n\n- **G7305** 08:12 → 09:05, 53 min, second class available\n- **G1345** 08:46 → 09:42, 56 min, second class available\n- **G7315** 09:30 → 10:17, 47 min, second class available\n\nThe other 8 are sold out or nearly. Availability is as of query time — tell me a train number if you want it booked.",
                        "summary": "3 morning trains with seats, listed",
                        "telemetry": tele(38, 6400, 520, 3),
                    }
                ],
            },
            {
                "id": "sess_listing",
                "project": "proj_moving",
                "title": "Listings for the furniture we're selling",
                "status": "completed",
                "summary": "4 listings written and priced",
                "ago": 2 * 60,
                "turns": [
                    {
                        "user": "Four pieces going on the secondhand app: IKEA bookcase, two-seat sofa, standing desk, bedside tables. Write the listings and price them off recent local sales.",
                        "thinking": "Check sold prices for the same models first, then discount for condition.",
                        "steps": [
                            {
                                "preamble": "Current stage: checking sold prices.",
                                "thinking": "Only \"sold\" records in the same city.",
                                "tool_calls": [tc("web_scan", {"query": "same model sold Shanghai", "items": 4}, "toolu_seed_07")],
                                "tool_results": [tr("30-day local sold ranges for all 4 items", "toolu_seed_07")],
                                "summary": "4 sold-price ranges retrieved",
                            },
                        ],
                        "final": "Listings and prices:\n\n**IKEA BILLY bookcase · ¥120**\nGood condition, no warping, light scratches on two shelves (pictured). Pickup in Xuhui.\n\n**Two-seat fabric sofa · ¥450**\nTwo years old, washable cover freshly cleaned, no pets. Arrange your own transport.\n\n**Electric standing desk 120×60 · ¥680**\nThree memory presets, quiet motor, unmarked top. Was ¥1,499.\n\n**Bedside tables (pair) · ¥90**\nVeneered wood, smooth drawers, sold together.\n\nPriced at the local sold median minus 10% to leave room for haggling.",
                        "summary": "4 listings written and priced",
                        "telemetry": tele(54, 9100, 1380, 4),
                    }
                ],
            },
            # ---- galley-site (dev) ----
            {
                "id": "sess_tour_page",
                "project": "proj_site",
                "title": "Add a tour page to galley-site and wire the nav",
                "status": "completed",
                "summary": "3 files changed, 1 added — ready for review",
                "ago": 30,
                "turns": [
                    {
                        "user": "Add a /tour page to the docs site: the six README screenshots in a grid, assistant first then team, and link it from the top nav. Don't commit yet.",
                        "thinking": "Read how nav and pages are written, then follow the same pattern with no new dependencies.",
                        "steps": [
                            {
                                "preamble": "Current stage: reading the nav and page conventions.",
                                "thinking": "Add one entry shaped like the others in nav.ts; the page follows index.ts's export pattern.",
                                "tool_calls": [tc("file_read", {"paths": ["src/nav.ts", "src/pages/index.ts"]}, "toolu_seed_08")],
                                "tool_results": [tr("nav.ts: 4 entries; index.ts: default export render(root)", "toolu_seed_08")],
                                "summary": "Nav and page conventions read",
                            },
                            {
                                "preamble": "Current stage: writing the page and wiring the nav.",
                                "thinking": "Reuse the existing .grid variables; only add a .tour-grid column count.",
                                "tool_calls": [
                                    tc("file_write", {"path": "src/pages/tour.ts"}, "toolu_seed_09"),
                                    tc("file_patch", {"path": "src/nav.ts"}, "toolu_seed_10"),
                                ],
                                "tool_results": [
                                    tr("Wrote src/pages/tour.ts (38 lines)", "toolu_seed_09"),
                                    tr("nav.ts: Tour entry added", "toolu_seed_10"),
                                ],
                                "summary": "Page written, nav wired",
                            },
                            {
                                "preamble": "Current stage: local build check.",
                                "thinking": "Build must pass before handing over the diff.",
                                "tool_calls": [tc("code_run", {"command": "pnpm build"}, "toolu_seed_11")],
                                "tool_results": [tr("build ok · 6 pages · 1.2s", "toolu_seed_11")],
                                "summary": "Build passes",
                            },
                        ],
                        "final": "Done, uncommitted:\n\n- `src/nav.ts` — new **Tour** entry after Docs\n- `src/pages/tour.ts` — new file, six screenshots in a two-column grid, four assistant shots then two team shots\n- `src/styles.css` — `.tour-grid` two-column layout and caption style\n- `README.md` — one line pointing at /tour\n\nOpen **Worktree changes** on the right to walk the diff file by file; I'll commit once you're happy.",
                        "summary": "3 files changed, 1 added — ready for review",
                        "telemetry": tele(87, 14200, 2260, 5),
                    }
                ],
            },
            {
                "id": "sess_ci_cache",
                "project": "proj_site",
                "title": "Why CI stopped hitting the dependency cache",
                "status": "running",
                "summary": "Comparing cache keys across the last 5 builds",
                "ago": 2,
                "turns": [
                    {
                        "user": "CI reinstalls dependencies on every run now — the cache isn't hitting. Find which change started it.",
                    }
                ],
            },
            {
                "id": "sess_pr_review",
                "project": "proj_site",
                "title": "Follow up on PR #1234 review feedback",
                "status": "completed",
                "summary": "3 review comments answered, PR updated",
                "ago": 4 * 60,
                "origin": ("supervisor", "ga-claude-1", "follow up on PR review"),
                "turns": [
                    {
                        "user": "Check the review feedback on #1234 — fix what's mechanical, and write up whatever needs a decision.",
                        "thinking": "Pull the review comments, split into \"just fix\" vs \"author decides\".",
                        "final": "3 comments handled: 2 fixed and pushed (a variable name, a missing error branch); 1 is an interface trade-off — drafted a reply for you to decide. PR updated.",
                        "summary": "3 review comments answered, PR updated",
                        "telemetry": tele(187, 31000, 2400, 9),
                    }
                ],
            },
            # ---- loose sessions ----
            {
                "id": "sess_downloads",
                "project": None,
                "title": "Sort the installers piling up in Downloads",
                "status": "completed",
                "summary": "38 files archived by type",
                "ago": 55,
                "turns": [
                    {
                        "user": "Downloads is a mess — sort the installers and old screenshots into folders by type.",
                        "thinking": "List the folder and count by type first, then move in groups; summarize before touching anything.",
                        "steps": [
                            {
                                "preamble": "Current stage: taking inventory of Downloads.",
                                "thinking": "Count file types before deciding the folder layout.",
                                "tool_calls": [tc("code_run", {"language": "python", "purpose": "list Downloads by type"}, "toolu_seed_12")],
                                "tool_results": [tr("dmg×9 zip×6 png×17 pdf×4 other×2, 38 files total", "toolu_seed_12")],
                                "summary": "38 files inventoried",
                            },
                        ],
                        "final": "Done: 38 files moved into `Installers/`, `Screenshots/`, and `Docs/`. 4 of the 9 installers are outdated versions — list below, say the word and I'll delete them.",
                        "summary": "38 files archived by type",
                        "telemetry": tele(51, 9400, 1200, 4),
                    }
                ],
            },
            {
                "id": "sess_pdf",
                "project": None,
                "title": "Sort the key points of the budget PDF into a table",
                "status": "completed",
                "summary": "27 pages distilled to a 9-row table",
                "ago": 90,
                "turns": [
                    {
                        "user": "The \"2026 household budget.pdf\" on my desktop — pull the key points into a table: budget and first-half actuals by category.",
                        "thinking": "The tables are spread over three pages; read everything, then merge on category.",
                        "steps": [
                            {
                                "preamble": "Current stage: reading the PDF.",
                                "thinking": "Tables span pages; merge on the category name.",
                                "tool_calls": [tc("file_read", {"path": "~/Desktop/2026 household budget.pdf"}, "toolu_seed_13")],
                                "tool_results": [tr("27 pages, 3 tables and 9 spending categories extracted", "toolu_seed_13")],
                                "summary": "3 tables, 9 categories extracted",
                            },
                        ],
                        "final": "Key points:\n\n| Category | Annual budget | H1 actual | Progress |\n|---|---|---|---|\n| Rent | ¥96,000 | ¥48,000 | 50% |\n| Food | ¥36,000 | ¥19,800 | 55% |\n| Transport | ¥9,600 | ¥3,900 | 41% |\n| Education | ¥24,000 | ¥15,600 | 65% |\n| Medical | ¥8,000 | ¥1,200 | 15% |\n\n(9 categories in all; the other 4 sit between 45% and 52%.) Education is 15 points ahead of pace — the only line worth watching in H2.",
                        "summary": "27 pages distilled to a 9-row table",
                        "telemetry": tele(44, 11800, 900, 3),
                    }
                ],
            },
            {
                "id": "sess_expense",
                "project": None,
                "title": "Sort last quarter's expense reports",
                "status": "completed",
                "unread": True,
                "summary": "47 expenses in 6 categories, 2 missing receipts",
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "Go through last quarter's expense reports in the expenses folder, total them by category, and list anything missing a receipt.",
                        "thinking": "Aggregate amounts by category while checking the receipt-number column for gaps.",
                        "final": "Done: **47 expenses** in 6 categories, ¥12,840 total. **2 are missing receipts** (travel ¥680, office ¥120) — listed separately; the rest are ready to submit.",
                        "summary": "47 expenses totaled in 6 categories",
                        "telemetry": tele(39, 12800, 860, 3),
                    }
                ],
            },
            {
                "id": "sess_daily_spend",
                "project": None,
                "title": "Yesterday's spending summary",
                "status": "completed",
                "summary": "6 items, ¥318; food is 60%",
                "ago": minutes_since_local("08:30"),
                "origin": ("supervisor", SCHEDULER_SUPERVISOR, "scheduled task sched_daily_spend"),
                "turns": [
                    {
                        "user": "Summarize yesterday's export from the budgeting app by category, and flag any single item over ¥200.",
                        "thinking": "The export lives at a fixed path; aggregate by category, then check the per-item threshold.",
                        "steps": [
                            {
                                "preamble": "Current stage: reading yesterday's export.",
                                "thinking": "Only rows dated yesterday.",
                                "tool_calls": [tc("file_read", {"path": "~/Documents/ledger/export-latest.csv"}, "toolu_seed_14")],
                                "tool_results": [tr("6 rows for yesterday", "toolu_seed_14")],
                                "summary": "6 records read",
                            },
                        ],
                        "final": "Yesterday: **¥318** across 6 items.\n\n- Food ¥192 (3)\n- Transport ¥46 (2)\n- Household ¥80 (1)\n\nNothing over ¥200.",
                        "summary": "6 items, ¥318",
                        "telemetry": tele(22, 3900, 310, 2),
                    }
                ],
            },
            {
                "id": "sess_monthly_invoice",
                "project": None,
                "title": "August invoices and expense reports, totaled",
                "status": "completed",
                "summary": "31 items tabled, 3 missing receipts",
                "ago": minutes_since_local("09:30", day_of_month=1),
                "origin": ("supervisor", SCHEDULER_SUPERVISOR, "scheduled task sched_monthly_invoice"),
                "turns": [
                    {
                        "user": "Sort last month's invoices and expense reports into one table, listing anything missing a receipt.",
                        "thinking": "Match invoices to report numbers; list the gaps separately.",
                        "final": "August: **31 items**, ¥8,420 total, tabled. **3 missing receipts** (transport ¥45, food ¥168, office ¥260) — submit together once those are in.",
                        "summary": "31 items tabled, 3 missing receipts",
                        "telemetry": tele(35, 6800, 540, 3),
                    }
                ],
            },
            {
                "id": "sess_interview_prep",
                "project": None,
                "title": "Interview prep: concurrency limiter + debounce by hand",
                "status": "completed",
                "pinned": True,
                "summary": "Covers 4 common variants",
                "ago": 5 * 24 * 60,
                "turns": [
                    {
                        "user": "Write a concurrency limiter and a debounce from scratch, and cover the variants interviewers usually ask for.",
                        "thinking": "Limiter from semaphore to sliding window; debounce with leading and trailing.",
                        "final": "Both, four variants. Say this before any code: a limiter bounds **how many run at once**, a debounce bounds **how often something fires**.\n\nThe semaphore limiter, which gets the most follow-ups:\n\n```ts\nfunction limit<T>(n: number) {\n  let active = 0;\n  const queue: (() => void)[] = [];\n  const next = () => { active--; queue.shift()?.(); };\n  return (task: () => Promise<T>) =>\n    new Promise<T>((resolve, reject) => {\n      const run = () => { active++; task().then(resolve, reject).finally(next); };\n      active < n ? run() : queue.push(run);\n    });\n}\n```\n\nThe other three (sliding-window limiter, leading / trailing debounce) follow, each with a \"what the interviewer asks next\" note.",
                        "summary": "4 variants of limiter and debounce written",
                        "telemetry": tele(66, 7200, 3100, 4),
                    }
                ],
            },
            {
                "id": "sess_bookclub",
                "project": "proj_wittgenstein",
                "title": "Book club prep: venue, reading list, invites",
                "status": "completed",
                "summary": "Venue, list, and invites all delivered",
                "ago": 24 * 60,
                "goal_session": True,
                "turns": [],  # built by goal seeding below
            },
            {
                "id": "sess_mcp",
                "project": None,
                "title": "MCP server shortlist",
                "status": "completed",
                "summary": "6 candidates compared, 1 recommended",
                "ago": 3 * 24 * 60,
                "turns": [
                    {
                        "user": "Compare these 6 MCP server implementations on maintenance activity, protocol coverage, and deployment cost.",
                        "thinking": "Check repo activity and release cadence per candidate; coverage against the official spec list.",
                        "final": "Table done. Overall pick: **B** — top two on all three axes and the only one covering both resources and prompts. D is the most active but has coverage gaps; keep it as the fallback.",
                        "summary": "6 MCP servers compared, 1 recommended",
                        "telemetry": tele(142, 26500, 1900, 7),
                    }
                ],
            },
        ],
        "goal": {
            "id": "goal_bookclub",
            "session": "sess_bookclub",
            "project": "proj_wittgenstein",
            "objective": "Help me prep next month's Philosophical Investigations book club: shortlist 3 venues, draft a reading list, and write the invitation.",
            "budget_seconds": 30 * 60,
            "elapsed_minutes": 26,
            "latest_summary": "All three delivered: 3 venue candidates with quotes, an 8-book list, and two versions of the invitation.",
            "narrations": [
                "Goal received. Split into venue, reading list, and invitation; 30-minute budget; running in parallel.",
                "Venue track done: 3 candidates tabled with capacity and quotes. Reading list in progress.",
                "All done: 8 books ordered by difficulty, invitation in a formal and a casual version. Deliverables collected.",
            ],
        },
        "scheduled": [
            {
                "id": "sched_daily_spend",
                "project": None,
                "prompt": "Summarize yesterday's export from the budgeting app by category, and flag any single item over ¥200.",
                "repeat_kind": "daily",
                "repeat_days": None,
                "time_of_day": "08:30",
                "enabled": 1,
                "last_fired_ago": minutes_since_local("08:30"),
                "last_run_session": "sess_daily_spend",
                "created_ago": 12 * 24 * 60,
            },
            {
                "id": "sched_weekly_expo",
                "project": None,
                "prompt": "Find this week's new exhibitions and talks in Shanghai, rank them by metro access, and note opening hours and ticket prices.",
                "repeat_kind": "weekly",
                "repeat_days": "1",
                "time_of_day": "09:00",
                "enabled": 1,
                "last_fired_ago": None,
                "last_run_session": None,
                "created_ago": 60,
            },
            {
                "id": "sched_monthly_invoice",
                "project": None,
                "prompt": "Sort last month's invoices and expense reports into one table, listing anything missing a receipt.",
                "repeat_kind": "monthly",
                "repeat_days": "1",
                "time_of_day": "09:30",
                "enabled": 0,
                "last_fired_ago": minutes_since_local("09:30", day_of_month=1),
                "last_run_session": "sess_monthly_invoice",
                "created_ago": 40 * 24 * 60,
            },
        ],
    }


# ---------------------------------------------------------------------------
# Insertion
# ---------------------------------------------------------------------------

def insert_projects(cur: sqlite3.Cursor, projects: list) -> None:
    for pid, name, ago in projects:
        cur.execute(
            """INSERT INTO projects
               (id, name, pinned, last_activity_at, created_at, updated_at, workspace_enabled)
               VALUES (?, ?, 0, ?, ?, ?, 0)""",
            (pid, name, iso(ago), iso(ago + 7 * 24 * 60), iso(ago)),
        )


def message_rows_for_turns(session_id: str, turns: list) -> list[tuple]:
    """Flatten the per-session turn specs into messages rows.

    Layout per the persistence survey: within one user block, the user row
    and every assistant step share ascending turn_index values starting at
    the block base; the next block starts past the highest used index.
    """
    rows = []
    base = 0
    for turn in turns:
        t_user = turn.get("created_ago")
        user_created = iso(t_user) if t_user is not None else iso(0)
        rows.append(
            (
                f"msg_{session_id}_{base}_user",
                session_id, base, 0, "user", turn["user"],
                None, None, None, None, user_created,
                None, None, None,
            )
        )
        step_index = base
        for step in turn.get("steps", []):
            rows.append(
                (
                    f"msg_{session_id}_{step_index}_assistant",
                    session_id, step_index, 1, "assistant",
                    f"<preamble>{step['preamble']}</preamble><thinking>{step['thinking']}</thinking>",
                    json.dumps(step["tool_calls"], ensure_ascii=False),
                    json.dumps(step["tool_results"], ensure_ascii=False),
                    step["thinking"], None, user_created,
                    step.get("summary"), step["preamble"], None,
                )
            )
            step_index += 1
        if "final" in turn:
            telemetry = turn.get("telemetry")
            rows.append(
                (
                    f"msg_{session_id}_{step_index}_assistant",
                    session_id, step_index, 1, "assistant",
                    f"<thinking>{turn['thinking']}</thinking>{turn['final']}",
                    "[]", "[]",
                    turn.get("thinking"), turn["final"], user_created,
                    turn.get("summary"), None,
                    json.dumps(telemetry) if telemetry else None,
                )
            )
            base = step_index + 1
        else:
            base = step_index + 1
    return rows


def insert_sessions(cur: sqlite3.Cursor, sessions: list, goal: dict) -> None:
    for s in sessions:
        ago = s["ago"]
        origin = s.get("origin")
        turns = s["turns"]
        if s.get("goal_session"):
            # objective user row + narration system rows; turn_count covers them
            turn_count = 1 + len(goal["narrations"])
        else:
            turn_count = sum(1 + len(t.get("steps", [])) + (1 if "final" in t else 0) for t in turns)
        cur.execute(
            """INSERT INTO sessions
               (id, project_id, title, status, summary, turn_count, pinned,
                last_activity_at, created_at, updated_at, has_unread,
                created_via, created_by_supervisor, created_origin_note,
                ga_runtime_kind, llm_display_name, title_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'managed', ?, 'user')""",
            (
                s["id"], s.get("project"), s["title"], s["status"], s.get("summary"),
                max(turn_count, 1), 1 if s.get("pinned") else 0,
                iso(ago), iso(ago + 60), iso(ago), 1 if s.get("unread") else 0,
                origin[0] if origin else "gui",
                origin[1] if origin else None,
                origin[2] if origin else None,
                "GPT-5.5",
            ),
        )
        rows = message_rows_for_turns(s["id"], [dict(t, created_ago=ago) for t in turns])
        for row in rows:
            insert_message(cur, row)


def insert_message(cur: sqlite3.Cursor, row: tuple) -> None:
    cur.execute(
        """INSERT INTO messages
           (id, session_id, turn_index, sequence, role, content,
            tool_calls, tool_results, thinking, final_answer, created_at,
            summary, preamble, telemetry_json, created_via, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gui', 'visible')""",
        row,
    )


def insert_goal(cur: sqlite3.Cursor, goal: dict, sessions: list) -> None:
    session = next(s for s in sessions if s["id"] == goal["session"])
    ago = session["ago"]
    started = iso(ago)
    ended = iso(ago - goal["elapsed_minutes"])
    cur.execute(
        """INSERT INTO goals
           (id, project_id, objective, status, budget_seconds, worker_limit,
            runtime_kind, write_mode, started_at, deadline_at, ended_at,
            latest_summary, stop_requested, created_at, updated_at,
            master_session_id, result_seen_at)
           VALUES (?, ?, ?, 'completed', ?, 3, 'managed', 'autonomous',
                   ?, ?, ?, ?, 0, ?, ?, ?, ?)""",
        (
            goal["id"], goal["project"], goal["objective"], goal["budget_seconds"],
            started, iso(ago - goal["budget_seconds"] / 60), ended,
            goal["latest_summary"], started, ended, goal["session"], ended,
        ),
    )
    # Conversation: objective user row (created_at == goal.started_at so the
    # commission-marker heuristic matches), then narration system rows.
    insert_message(
        cur,
        (
            f"msg_{goal['session']}_0_user",
            goal["session"], 0, 0, "user", goal["objective"],
            None, None, None, None, started, None, None, None,
        ),
    )
    for i, text in enumerate(goal["narrations"], start=1):
        minutes_into_run = i * goal["elapsed_minutes"] / len(goal["narrations"])
        cur.execute(
            """INSERT INTO messages
               (id, session_id, turn_index, sequence, role, content,
                tool_calls, tool_results, thinking, final_answer, created_at,
                summary, preamble, created_via, visibility)
               VALUES (?, ?, ?, 0, 'system', ?, NULL, NULL, NULL, NULL, ?,
                       NULL, NULL, 'system', 'visible')""",
            (
                f"msg_{goal['session']}_{i}_system",
                goal["session"], i, text, iso(ago - minutes_into_run),
            ),
        )


def insert_scheduled(cur: sqlite3.Cursor, tasks: list) -> None:
    for t in tasks:
        cur.execute(
            """INSERT INTO scheduled_tasks
               (id, project_id, prompt, repeat_kind, repeat_days, time_of_day,
                enabled, last_fired_at, last_run_session_id, created_at,
                updated_at, llm_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            (
                t["id"], t["project"], t["prompt"], t["repeat_kind"], t["repeat_days"],
                t["time_of_day"], t["enabled"],
                iso(t["last_fired_ago"]) if t["last_fired_ago"] is not None else None,
                t["last_run_session"], iso(t["created_ago"]),
                iso(t["last_fired_ago"] if t["last_fired_ago"] is not None else t["created_ago"]),
            ),
        )


# ---------------------------------------------------------------------------
# Demo repo for the reading-panel shot (reading.png)
# ---------------------------------------------------------------------------

DEMO_BASE_FILES = {
    ".gitignore": """node_modules/
dist/
.DS_Store
""",
    "README.md": """# galley-site

The docs site for Galley. Static, no framework — one page per file under
`src/pages/`, wired together by `src/nav.ts`.

## Develop

```bash
pnpm install
pnpm dev
```
""",
    "package.json": """{
  "name": "galley-site",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
""",
    "src/nav.ts": """export interface NavEntry {
  href: string;
  label: string;
}

export const NAV: NavEntry[] = [
  { href: "/", label: "Home" },
  { href: "/docs", label: "Docs" },
  { href: "/releases", label: "Releases" },
  { href: "https://github.com/wangjc683/galley", label: "GitHub" },
];
""",
    "src/pages/index.ts": """import { NAV } from "../nav";

export default function render(root: HTMLElement) {
  root.innerHTML = `
    <header>
      <a class="brand" href="/">Galley</a>
      <nav>${NAV.map((n) => `<a href="${n.href}">${n.label}</a>`).join("")}</nav>
    </header>
    <main>
      <h1>Less harness. More model.</h1>
      <p>A lightweight, general-purpose assistant that lives on your computer.</p>
    </main>
  `;
}
""",
    "src/styles.css": """:root {
  --ink: #1f1d1a;
  --paper: #fbfaf7;
  --brand: #b8722c;
  --grid-gap: 1.25rem;
}

body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font: 16px/1.6 system-ui, sans-serif;
}

header {
  display: flex;
  justify-content: space-between;
  padding: 1rem 2rem;
}

.grid {
  display: grid;
  gap: var(--grid-gap);
}
""",
}

DEMO_CHANGES = {
    "README.md": """# galley-site

The docs site for Galley. Static, no framework — one page per file under
`src/pages/`, wired together by `src/nav.ts`.

The `/tour` page mirrors the README's screenshot grid: assistant first,
then team.

## Develop

```bash
pnpm install
pnpm dev
```
""",
    "src/nav.ts": """export interface NavEntry {
  href: string;
  label: string;
}

export const NAV: NavEntry[] = [
  { href: "/", label: "Home" },
  { href: "/docs", label: "Docs" },
  { href: "/tour", label: "Tour" },
  { href: "/releases", label: "Releases" },
  { href: "https://github.com/wangjc683/galley", label: "GitHub" },
];
""",
    "src/styles.css": """:root {
  --ink: #1f1d1a;
  --paper: #fbfaf7;
  --brand: #b8722c;
  --grid-gap: 1.25rem;
}

body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font: 16px/1.6 system-ui, sans-serif;
}

header {
  display: flex;
  justify-content: space-between;
  padding: 1rem 2rem;
}

.grid {
  display: grid;
  gap: var(--grid-gap);
}

.tour-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tour-grid figcaption {
  margin-top: 0.5rem;
  color: color-mix(in oklab, var(--ink) 70%, var(--paper));
  font-size: 0.875rem;
}
""",
    "src/pages/tour.ts": """import { NAV } from "../nav";

interface Shot {
  src: string;
  caption: string;
}

const ASSISTANT: Shot[] = [
  { src: "/shots/reading.png", caption: "Reading panel — review worktree changes beside the conversation" },
  { src: "/shots/scheduled.png", caption: "Scheduled tasks — a prompt that runs itself every morning" },
  { src: "/shots/search.png", caption: "⌘K — every past conversation, straight to the matching line" },
  { src: "/shots/tools.png", caption: "Tool timeline — every call's arguments and result, inline" },
];

const TEAM: Shot[] = [
  { src: "/shots/projects.png", caption: "Project view — sessions advancing around one folder" },
  { src: "/shots/goal.png", caption: "Goal — a long-running objective with chapter markers" },
];

function figure(shot: Shot): string {
  return `<figure><img src="${shot.src}" alt="" /><figcaption>${shot.caption}</figcaption></figure>`;
}

export default function render(root: HTMLElement) {
  root.innerHTML = `
    <header>
      <a class="brand" href="/">Galley</a>
      <nav>${NAV.map((n) => `<a href="${n.href}">${n.label}</a>`).join("")}</nav>
    </header>
    <main>
      <h1>A quick tour</h1>
      <section class="grid tour-grid">${[...ASSISTANT, ...TEAM].map(figure).join("")}</section>
    </main>
  `;
}
""",
}


def build_demo_repo(path: Path) -> None:
    if path.exists() and any(path.iterdir()):
        raise SystemExit(f"error: {path} exists and is not empty; remove it first")
    path.mkdir(parents=True, exist_ok=True)
    env = {
        "GIT_AUTHOR_NAME": "Galley Demo", "GIT_AUTHOR_EMAIL": "demo@galley.local",
        "GIT_COMMITTER_NAME": "Galley Demo", "GIT_COMMITTER_EMAIL": "demo@galley.local",
        "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
    }

    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=path, env=env, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    for rel, text in DEMO_BASE_FILES.items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "Docs site skeleton: home, docs, releases")
    # A second commit so the review header shows a realistic short hash.
    (path / "src" / "pages" / "index.ts").write_text(
        DEMO_BASE_FILES["src/pages/index.ts"].replace(
            "A lightweight, general-purpose assistant that lives on your computer.",
            "A lightweight, general-purpose assistant that lives on your computer. "
            "Thin harness, low token burn.",
        ),
        encoding="utf-8",
    )
    git("add", "-A")
    git("commit", "-q", "-m", "Home: extend the tagline")
    # Working-tree changes for the shot: 3 modified tracked + 1 untracked.
    for rel, text in DEMO_CHANGES.items():
        f = path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    print(f"demo repo -> {path}\n  2 commits; working tree: README.md, src/nav.ts, src/styles.css modified; src/pages/tour.ts untracked")


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def init_schema(conn: sqlite3.Connection) -> None:
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        conn.executescript(path.read_text())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lang", choices=["zh", "en"], default="zh")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument(
        "--force", action="store_true",
        help="seed even if the sessions table is not empty",
    )
    parser.add_argument(
        "--init-schema", action="store_true",
        help="TESTING ONLY: apply core/migrations to an empty file first",
    )
    parser.add_argument(
        "--demo-repo", nargs="?", const=DEFAULT_DEMO_REPO, type=Path, default=None,
        help=f"also build the reading-panel demo repo (default {DEFAULT_DEMO_REPO})",
    )
    parser.add_argument(
        "--no-db", action="store_true",
        help="skip DB seeding (use with --demo-repo)",
    )
    args = parser.parse_args()

    if args.demo_repo is not None:
        build_demo_repo(args.demo_repo)
    if args.no_db:
        return 0

    if not args.db.exists() and not args.init_schema:
        print(
            f"error: {args.db} not found.\n"
            "Launch the app once (through onboarding) so migrations create the "
            "schema, or pass --init-schema for offline testing.",
            file=sys.stderr,
        )
        return 1

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        if args.init_schema:
            init_schema(conn)
        existing = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        if existing and not args.force:
            print(
                f"error: sessions table already has {existing} rows; refusing to "
                "mix seed content into an inhabited workspace (--force to override).",
                file=sys.stderr,
            )
            return 1

        content = content_zh() if args.lang == "zh" else content_en()
        cur = conn.cursor()
        insert_projects(cur, content["projects"])
        insert_sessions(cur, content["sessions"], content["goal"])
        insert_goal(cur, content["goal"], content["sessions"])
        insert_scheduled(cur, content["scheduled"])
        conn.commit()

        n_sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        n_messages = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        n_goals = conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0]
        n_sched = conn.execute("SELECT COUNT(*) FROM scheduled_tasks").fetchone()[0]
        print(
            f"seeded [{args.lang}] -> {args.db}\n"
            f"  projects: {len(content['projects'])}, sessions: {n_sessions}, "
            f"messages: {n_messages}, goals: {n_goals}, scheduled tasks: {n_sched}\n"
            "reminders: do NOT click the running row during the shoot "
            "(it derives back to idle); ask_user must be produced live; "
            "FTS backfills itself on next launch."
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
