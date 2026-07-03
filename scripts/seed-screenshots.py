#!/usr/bin/env python3
"""Seed a Galley workbench.db with curated content for README screenshots.

Companion to docs/screenshot-playbook.md — run AFTER the mv-swap flow's
onboarding step (the seed needs the schema migrated and at least one
managed model configured, or hydrate diverts to onboarding and the
sidebar never renders).

    scripts/seed-screenshots.py --lang zh          # default DB location
    scripts/seed-screenshots.py --lang en --db /path/to/workbench.db

Schema facts this script relies on (2026-07-03 survey, migrations 001-030):
  - seeded sessions must be ga_runtime_kind='managed' (sidebar filters on it)
  - status is persisted and NOT reconciled at startup; running rows show
    "Thinking..." (lastStepIndex is transient) and must not be clicked
    during the shoot; ask_user cannot be seeded at all (live-run it)
  - conversation replay reads messages (visibility='visible', ordered by
    turn_index, sequence) and requires sessions.turn_count > 0
  - goal chapter markers need a terminal-status goal whose objective ==
    a user message's text (whitespace-normalized), started_at near that
    message's created_at, and system rows after it as narration;
    goals.project_id is NOT NULL (any seeded project id works)
  - messages_fts has no triggers; hydrate backfills it when empty, so a
    fresh seed can ignore FTS entirely

--init-schema is for offline testing only: it applies core/migrations/*.sql
to an empty file so the seed can be validated without launching the app.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "core" / "migrations"
DEFAULT_DB = (
    Path.home() / "Library" / "Application Support" / "app.galley" / "workbench.db"
)

NOW = datetime.now(timezone.utc)


def iso(delta_minutes: float) -> str:
    """Timestamp `delta_minutes` before the seed run, ISO-8601 Zulu."""
    t = NOW - timedelta(minutes=delta_minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def tc(tool_name: str, args: dict, tool_use_id: str) -> dict:
    return {"toolName": tool_name, "args": args, "toolUseId": tool_use_id}


def tr(content: str, tool_use_id: str) -> dict:
    return {"toolUseId": tool_use_id, "content": content}


# ---------------------------------------------------------------------------
# Content — one dict per language. Structure:
#   projects: [(id, name, minutes_ago)]
#   sessions: [dict] — see fields in insert_sessions(); "turns" holds the
#     conversation as a list of row dicts consumed by insert_messages().
#   goal: the completed book-club goal (chapter markers for shot 03).
# ---------------------------------------------------------------------------

def content_zh() -> dict:
    return {
        "projects": [
            ("proj_wittgenstein", "维特根斯坦哲学与 LLM", 26 * 60),
            ("proj_research", "Q3 竞品调研", 40),
        ],
        "sessions": [
            {
                "id": "sess_pi43",
                "project": "proj_wittgenstein",
                "title": "PI §43 与工具调用的语义整理",
                "status": "completed",
                "summary": "语义对照笔记完成，含 12 组例句",
                "ago": 26 * 60,
                "turns": [
                    {
                        "user": "把《哲学研究》§43「意义即用法」和 LLM 工具调用的语义整理成一份对照笔记，配例句。",
                        "thinking": "需要先把 §43 的原文语境理清，再映射到 tool use 的语义。",
                        "final": "整理完成。核心对照：\n\n> Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.\n\n**词的意义在于使用** ↔ **工具的语义在于调用时机与参数**：模型「懂」一个工具，不体现在能复述它的 schema，而体现在恰当的场合用恰当的参数调用它。笔记含 12 组例句，已按「描述 / 误用 / 恰当使用」三栏排布。",
                        "summary": "完成 §43 与工具调用的语义对照笔记",
                        "telemetry": {"elapsedMs": 42180, "inputTokens": 8210, "outputTokens": 1830, "requestCount": 3},
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
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "接着昨天的讨论，把「语言游戏」能落到产品设计上的点归纳一下。",
                        "thinking": "从「意义在用法中」推产品含义：同一控件在不同语境应有不同语义。",
                        "final": "归纳成三条：\n\n1. **同一输入框按语境改变意义**——委派、追问、顺带一提是三种不同的语言游戏；\n2. **不解释，去展示**——功能靠使用场景自明，不靠说明书；\n3. **拒绝行话**——给用户的词必须在他的生活形式里有用法。\n\n全文已写入笔记。",
                        "summary": "归纳语言游戏的三条产品化原则",
                        "telemetry": {"elapsedMs": 30520, "inputTokens": 5100, "outputTokens": 940, "requestCount": 2},
                    }
                ],
            },
            {
                "id": "sess_pricing",
                "project": "proj_research",
                "title": "竞品定价页抓取与对比表",
                "status": "completed",
                "summary": "5 家竞品定价已入表",
                "ago": 5 * 60,
                "turns": [
                    {
                        "user": "把这 5 家竞品的定价页抓下来，整理成一张对比表：档位、价格、按量计费口径。",
                        "thinking": "逐家打开定价页，抽取档位结构，注意年付月付口径差异。",
                        "steps": [
                            {
                                "preamble": "当前阶段：抓取各家定价页原文。",
                                "thinking": "先用网页脚本批量取回 5 个定价页的正文。",
                                "tool_calls": [tc("web_execute_js", {"action": "open_and_extract", "urls_count": 5}, "toolu_seed_01")],
                                "tool_results": [tr("5 个定价页正文已取回，共 18,432 字符", "toolu_seed_01")],
                                "summary": "取回 5 家定价页正文",
                            },
                        ],
                        "final": "对比表完成：\n\n| 竞品 | 入门档 | 团队档 | 按量口径 |\n|---|---|---|---|\n| A | $12/月 | $29/席 | 按 token |\n| B | 免费 | $20/席 | 按请求数 |\n| C | $15/月 | 定制 | 按时长 |\n\n年付均有 8–20% 折扣，口径差异已在备注列标明。",
                        "summary": "完成 5 家竞品定价对比表",
                        "telemetry": {"elapsedMs": 96410, "inputTokens": 22400, "outputTokens": 2100, "requestCount": 6},
                    }
                ],
            },
            {
                "id": "sess_interviews",
                "project": "proj_research",
                "title": "用户访谈纪要整理与共性归纳",
                "status": "running",
                "summary": "已分类 8 条访谈记录",
                "ago": 2,
                "turns": [
                    {
                        "user": "把 interviews 文件夹里的 12 份访谈纪要整理一遍，归纳共性痛点。",
                    }
                ],
            },
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
                                "tool_calls": [tc("code_run", {"language": "python", "purpose": "list Downloads by type"}, "toolu_seed_11")],
                                "tool_results": [tr("dmg×9 zip×6 png×17 pdf×4 其他×2，共 38 个文件", "toolu_seed_11")],
                                "summary": "清点出 38 个待归档文件",
                            },
                        ],
                        "final": "整理完成：38 个文件已归入 `Installers/`、`Screenshots/`、`Docs/` 三个目录，9 个安装包里有 4 个版本已过期，清单在下面，确认后可以删。",
                        "summary": "Downloads 已按类型归档 38 个文件",
                        "telemetry": {"elapsedMs": 51200, "inputTokens": 9400, "outputTokens": 1200, "requestCount": 4},
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
                "ago": 30,
                "turns": [
                    {
                        "user": "把上季度的报销单整理一下，按类目汇总，标出缺发票的。",
                        "thinking": "读表格，按报销类目聚合金额，同时校验发票号列的空值。",
                        "final": "汇总完成：47 笔支出分 6 类，合计 ¥18,642。交通与差旅占 61%；**有 2 笔缺发票**（3/14 打车、4/02 住宿），已在表中标红。",
                        "summary": "报销单汇总完成，2 笔待补发票",
                        "telemetry": {"elapsedMs": 38700, "inputTokens": 12800, "outputTokens": 860, "requestCount": 3},
                    }
                ],
            },
            {
                "id": "sess_pr_review",
                "project": None,
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
                        "telemetry": {"elapsedMs": 187000, "inputTokens": 31000, "outputTokens": 2400, "requestCount": 9},
                    }
                ],
            },
            {
                "id": "sess_bookclub",
                "project": None,
                "title": "筹备读书会：场地、书单、邀请文案",
                "status": "completed",
                "summary": "场地、书单、邀请文案三项产出齐备",
                "ago": 24 * 60,
                "goal_session": True,
                "turns": [],  # built by goal seeding below
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
                        "final": "两题四个变体都写好了，每段代码后面附了「面试官追问点」。核心差异：限流控制**同时在跑的数量**，防抖控制**触发的频率**——先把这句说清再写代码。",
                        "summary": "完成限流与防抖的 4 个变体写法",
                        "telemetry": {"elapsedMs": 66300, "inputTokens": 7200, "outputTokens": 3100, "requestCount": 4},
                    }
                ],
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
                        "telemetry": {"elapsedMs": 142000, "inputTokens": 26500, "outputTokens": 1900, "requestCount": 7},
                    }
                ],
            },
        ],
        "goal": {
            "id": "goal_bookclub",
            "session": "sess_bookclub",
            "project": "proj_wittgenstein",
            "objective": "帮我筹备下个月的读书会：找 3 个候选场地、拟一份书单、写好邀请文案。",
            "budget_seconds": 30 * 60,
            "elapsed_minutes": 26,
            "latest_summary": "三项产出齐备：候选场地 3 处（含报价）、书单 8 本、邀请文案两版。",
            "narrations": [
                "已接收目标，拆解为场地、书单、文案三条线，预算 30 分钟，开始并行推进。",
                "场地线完成：3 处候选已连同容纳人数与报价整理入表；书单线进行中。",
                "全部完成：书单 8 本按难度梯度排序，邀请文案正式版与轻松版各一，产出已汇总。",
            ],
        },
    }


def content_en() -> dict:
    return {
        "projects": [
            ("proj_wittgenstein", "Wittgenstein & LLMs", 26 * 60),
            ("proj_research", "Q3 Competitive Research", 40),
        ],
        "sessions": [
            {
                "id": "sess_pi43",
                "project": "proj_wittgenstein",
                "title": "PI §43 and tool-use semantics, side by side",
                "status": "completed",
                "summary": "Notes done — 12 paired examples",
                "ago": 26 * 60,
                "turns": [
                    {
                        "user": "Put Philosophical Investigations §43 (meaning is use) side by side with LLM tool-calling semantics, with examples.",
                        "thinking": "Pin down the §43 context first, then map it onto tool use.",
                        "final": "Done. The core parallel:\n\n> Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.\n\n**A word's meaning is its use** ↔ **a tool's semantics is when and how it gets called**: a model \"understands\" a tool not by reciting its schema but by calling it at the right moment with the right arguments. 12 paired examples, arranged in three columns: description / misuse / apt use.",
                        "summary": "Finished the §43 ↔ tool-use comparison notes",
                        "telemetry": {"elapsedMs": 42180, "inputTokens": 8210, "outputTokens": 1830, "requestCount": 3},
                    }
                ],
            },
            {
                "id": "sess_lang_game",
                "project": "proj_wittgenstein",
                "title": "Product notes on the language-game idea",
                "status": "completed",
                "unread": True,
                "summary": "Three product principles written up",
                "ago": 3 * 60,
                "turns": [
                    {
                        "user": "Following up on yesterday — write up what the language-game idea actually implies for product design.",
                        "thinking": "From \"meaning is use\": the same control should mean different things in different contexts.",
                        "final": "Three principles:\n\n1. **The same input box changes meaning with context** — delegating, following up, and mentioning in passing are three different games;\n2. **Don't explain, show** — features should be self-evident in use, not in a manual;\n3. **No jargon** — every word shown to users must have a use in their form of life.\n\nFull write-up saved.",
                        "summary": "Wrote up three language-game product principles",
                        "telemetry": {"elapsedMs": 30520, "inputTokens": 5100, "outputTokens": 940, "requestCount": 2},
                    }
                ],
            },
            {
                "id": "sess_pricing",
                "project": "proj_research",
                "title": "Review of pricing pages across five competitors",
                "status": "completed",
                "summary": "All 5 pricing structures tabled",
                "ago": 5 * 60,
                "turns": [
                    {
                        "user": "Pull the pricing pages of these five competitors and organize a table: tiers, prices, usage-based billing terms.",
                        "thinking": "Open each pricing page, extract tier structure, watch for annual vs monthly framing.",
                        "steps": [
                            {
                                "preamble": "Current stage: fetching the raw pricing pages.",
                                "thinking": "Batch-fetch all five pages with a page script first.",
                                "tool_calls": [tc("web_execute_js", {"action": "open_and_extract", "urls_count": 5}, "toolu_seed_01")],
                                "tool_results": [tr("Fetched 5 pricing pages, 18,432 characters total", "toolu_seed_01")],
                                "summary": "Fetched all five pricing pages",
                            },
                        ],
                        "final": "Comparison table done:\n\n| Competitor | Entry | Team | Usage basis |\n|---|---|---|---|\n| A | $12/mo | $29/seat | per token |\n| B | Free | $20/seat | per request |\n| C | $15/mo | Custom | per hour |\n\nAnnual discounts run 8–20%; framing differences are flagged in the notes column.",
                        "summary": "Completed the 5-competitor pricing table",
                        "telemetry": {"elapsedMs": 96410, "inputTokens": 22400, "outputTokens": 2100, "requestCount": 6},
                    }
                ],
            },
            {
                "id": "sess_interviews",
                "project": "proj_research",
                "title": "User interview notes review and synthesis",
                "status": "running",
                "summary": "8 of 12 transcripts categorized",
                "ago": 2,
                "turns": [
                    {
                        "user": "Go through the 12 interview transcripts in the interviews folder and synthesize the common pain points.",
                    }
                ],
            },
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
                        "thinking": "List the directory and count by type first; summarize before moving anything.",
                        "steps": [
                            {
                                "preamble": "Current stage: taking inventory of Downloads.",
                                "thinking": "Count file types before choosing the folder structure.",
                                "tool_calls": [tc("code_run", {"language": "python", "purpose": "list Downloads by type"}, "toolu_seed_11")],
                                "tool_results": [tr("dmg×9 zip×6 png×17 pdf×4 other×2 — 38 files total", "toolu_seed_11")],
                                "summary": "Inventoried 38 files to archive",
                            },
                        ],
                        "final": "Done: 38 files filed into `Installers/`, `Screenshots/`, and `Docs/`. Four of the nine installers are outdated versions — list below, say the word and I'll delete them.",
                        "summary": "Downloads archived — 38 files by type",
                        "telemetry": {"elapsedMs": 51200, "inputTokens": 9400, "outputTokens": 1200, "requestCount": 4},
                    }
                ],
            },
            {
                "id": "sess_expense",
                "project": None,
                "title": "Q2 expense reports sorted and summarized",
                "status": "completed",
                "unread": True,
                "summary": "47 expenses in 6 categories, 2 missing receipts",
                "ago": 30,
                "turns": [
                    {
                        "user": "Sort last quarter's expense reports, summarize by category, and flag anything missing a receipt.",
                        "thinking": "Aggregate amounts by category while checking the receipt-number column for gaps.",
                        "final": "Summary done: 47 expenses across 6 categories, ¥18,642 total. Transport and travel account for 61%; **2 items are missing receipts** (taxi on 3/14, hotel on 4/02), flagged in red.",
                        "summary": "Expenses summarized, 2 receipts missing",
                        "telemetry": {"elapsedMs": 38700, "inputTokens": 12800, "outputTokens": 860, "requestCount": 3},
                    }
                ],
            },
            {
                "id": "sess_pr_review",
                "project": None,
                "title": "Review feedback follow-up on PR #1234",
                "status": "completed",
                "summary": "3 review comments answered, PR updated",
                "ago": 4 * 60,
                "origin": ("supervisor", "ga-claude-1", "follow up on PR review"),
                "turns": [
                    {
                        "user": "Check the review feedback on #1234 — fix what's mechanical, and write up whatever needs a decision.",
                        "thinking": "Pull the review comments and split them into direct-fix vs needs-author-call.",
                        "final": "All 3 handled: 2 fixed and pushed (naming, a missing error branch); 1 is an interface trade-off written up for your call. PR updated.",
                        "summary": "Answered 3 review comments, updated the PR",
                        "telemetry": {"elapsedMs": 187000, "inputTokens": 31000, "outputTokens": 2400, "requestCount": 9},
                    }
                ],
            },
            {
                "id": "sess_bookclub",
                "project": None,
                "title": "Book club prep: venue, reading list, invites",
                "status": "completed",
                "summary": "Venue, list, and invites all delivered",
                "ago": 24 * 60,
                "goal_session": True,
                "turns": [],
            },
            {
                "id": "sess_interview_prep",
                "project": None,
                "title": "Interview prep: rate limiter + debounce by hand",
                "status": "completed",
                "pinned": True,
                "summary": "Covers 4 common variants",
                "ago": 5 * 24 * 60,
                "turns": [
                    {
                        "user": "Write a concurrency rate limiter and a debounce from scratch, covering the variants interviewers ask about.",
                        "thinking": "Limiter from semaphore to sliding window; debounce leading/trailing.",
                        "final": "Both problems, four variants, each followed by likely follow-up questions. The one-liner to lead with: a limiter bounds **how many run at once**, debounce bounds **how often things fire** — say that before writing code.",
                        "summary": "Finished 4 variants of limiter and debounce",
                        "telemetry": {"elapsedMs": 66300, "inputTokens": 7200, "outputTokens": 3100, "requestCount": 4},
                    }
                ],
            },
            {
                "id": "sess_mcp",
                "project": None,
                "title": "MCP server selection notes",
                "status": "completed",
                "summary": "6 candidates compared, 1 recommended",
                "ago": 3 * 24 * 60,
                "turns": [
                    {
                        "user": "Compare these six MCP server implementations on maintenance activity, protocol coverage, and deployment cost.",
                        "thinking": "Check repo activity and release cadence per candidate; coverage against the official spec list.",
                        "final": "Comparison done. Overall pick: **B** — top two on all three axes and the only one covering both resources and prompts. D has the most activity but incomplete coverage; keep it as backup.",
                        "summary": "Compared 6 MCP servers, recommended one",
                        "telemetry": {"elapsedMs": 142000, "inputTokens": 26500, "outputTokens": 1900, "requestCount": 7},
                    }
                ],
            },
        ],
        "goal": {
            "id": "goal_bookclub",
            "session": "sess_bookclub",
            "project": "proj_wittgenstein",
            "objective": "Help me prep next month's book club: shortlist 3 venues, draft a reading list, and write the invite.",
            "budget_seconds": 30 * 60,
            "elapsed_minutes": 26,
            "latest_summary": "All three delivered: 3 venues with quotes, an 8-book list, and two versions of the invite.",
            "narrations": [
                "Goal received. Split into venue, reading list, and invite tracks; 30-minute budget; running them in parallel.",
                "Venue track done: 3 candidates tabled with capacity and quotes; reading-list track in progress.",
                "All done: 8 books ordered by difficulty, invite in a formal and a casual version, outputs consolidated.",
            ],
        },
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
                None, None,
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
                    step.get("summary"), step["preamble"],
                )
            )
            step_index += 1
        if "final" in turn:
            rows.append(
                (
                    f"msg_{session_id}_{step_index}_assistant",
                    session_id, step_index, 1, "assistant",
                    f"<thinking>{turn['thinking']}</thinking>{turn['final']}",
                    "[]", "[]",
                    turn.get("thinking"), turn["final"], user_created,
                    turn.get("summary"), None,
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
                ga_runtime_kind, llm_display_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'managed', ?)""",
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
            summary, preamble, created_via, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gui', 'visible')""",
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
            None, None, None, None, started, None, None,
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
    args = parser.parse_args()

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
        conn.commit()

        n_sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        n_messages = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        n_goals = conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0]
        print(
            f"seeded [{args.lang}] -> {args.db}\n"
            f"  projects: {len(content['projects'])}, sessions: {n_sessions}, "
            f"messages: {n_messages}, goals: {n_goals}\n"
            "reminders: do NOT click the running row during the shoot "
            "(it derives back to idle); ask_user must be produced live; "
            "FTS backfills itself on next launch."
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
