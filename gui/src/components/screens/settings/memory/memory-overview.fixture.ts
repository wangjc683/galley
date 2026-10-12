import type { MemoryOverview } from "@/lib/memory";

/**
 * A filled-in Settings → Memory, for the page's tests (it also fed the
 * ticket 04b trial's 「演示数据」, removed with 04c). Hand-converted
 * into the 04 interface shape from the ledger eval's output
 * (`galley-ledger-eval-sanafxuv/…/history_insight/activities.md` and
 * `emotional_events.md`): the user is 林晓, a made-up person in a
 * synthetic corpus — not anyone's real data. A selection, trimmed; the
 * eval's 口径 / 证据边界 paragraphs stand in for the parser's `other`.
 *
 * Session ids are the eval's; they exist in no database, so the titles
 * below stand in for the session list.
 */
export const MEMORY_OVERVIEW_FIXTURE: MemoryOverview = {
  ledger: {
    switch: { state: "on", since: "1970-01-01T00:00:00Z", lookBack: true },
    running: false,
    lastRun: {
      startedAt: "2026-10-12T04:00:00+08:00",
      outcome: "succeeded",
      turns: 10,
    },
    nextRunAt: "2026-10-13T04:00:00+08:00",
    activities: {
      kind: "parsed",
      ongoing: [
        {
          id: "A010",
          title: "banner 尺寸修改",
          status: "要改成 750 宽 1000 高，还没确认改好。",
          lastSeen: "2026-09-17",
          sessions: ["s-0917-banner"],
          quotes: [
            {
              session: "s-0917-banner",
              at: "2026-09-17 14:35",
              text: "我说了三遍了，是 750 宽 1000 高！你能不能认真看一下我说的话？",
            },
          ],
          extra: ["频次：1 会话 / 3 消息"],
        },
        {
          id: "A001",
          title: "杭州半程马拉松备赛",
          status: "9 月 27 日长距离 18 公里，比计划快，离半马还有八周。",
          lastSeen: "2026-09-27",
          sessions: [
            "s-0907-run",
            "s-0920-run",
            "im-feishu-2026-09-21",
            "s-0927-run",
          ],
          quotes: [
            {
              session: "s-0927-run",
              at: "2026-09-27 07:00",
              text: "今天长距离 18 公里，配速 6 分 15，比计划快。离半马还有八周。",
            },
            {
              session: "im-feishu-2026-09-21",
              at: "2026-09-21 08:15",
              text: "早上跑了 10 公里轻松跑，膝盖没再酸了。",
            },
            {
              session: "s-0920-run",
              at: "2026-09-20 07:30",
              text: "今天长距离跑了 15 公里，最后两公里膝盖外侧有点酸，是不是跑姿有问题？",
            },
          ],
          extra: ["频次：4 会话 / 5 消息"],
        },
        {
          id: "A004",
          title: "母亲膝关节置换后的陪护与康复",
          status: "首次复查恢复比预期好；下个月想带母亲去做水疗康复。",
          lastSeen: "2026-09-27",
          sessions: [
            "s-0909-mom",
            "im-feishu-2026-09-11",
            "im-feishu-2026-09-17",
            "s-0927-mom",
          ],
          quotes: [
            {
              session: "s-0927-mom",
              at: "2026-09-27 20:00",
              text: "周末又回宁波看我妈了，她现在能自己扶着走到楼下。下个月想带她去做水疗康复。",
            },
            {
              session: "im-feishu-2026-09-17",
              at: "2026-09-17 16:10",
              text: "我妈今天第一次复查，医生说恢复得比预期好，可以开始扶着助行器走了。",
            },
          ],
          extra: [
            "频次：5 会话 / 5 消息",
            "日期冲突：首次复查是周四，和「每周三复查」对不上，周期待核实。",
          ],
        },
        {
          id: "A005",
          title: "日语 N3 备考",
          status: "这周进度落后，下周要补两课；12 月考试。",
          lastSeen: "2026-09-27",
          sessions: [
            "s-0911-japanese",
            "s-0916-japanese",
            "s-0922-japanese",
            "s-0927-japanese",
          ],
          quotes: [
            {
              session: "s-0927-japanese",
              at: "2026-09-27 21:00",
              text: "这周日语进度落后了，下周要补两课。",
            },
            {
              session: "s-0922-japanese",
              at: "2026-09-22 21:30",
              text: "N3 的听力好难，帮我找几个适合通勤时听的日语播客。",
            },
          ],
          extra: ["频次：4 会话 / 4 消息"],
        },
        {
          id: "A011",
          title: "豆包的体重与猫粮管理",
          status: "医生说有点胖，要换低卡猫粮，还没确认换了。",
          lastSeen: "2026-09-20",
          sessions: ["s-0920-cat"],
          quotes: [
            {
              session: "s-0920-cat",
              at: "2026-09-20 15:00",
              text: "带豆包打了第二针猫三联，医生说它有点胖，要换低卡猫粮。",
            },
          ],
          extra: [],
        },
        {
          id: "A009",
          title: "双十一项目的后续安排",
          status: "下个月才开始。",
          lastSeen: "2026-09-16",
          sessions: ["s-0916-page"],
          quotes: [],
          extra: [],
        },
      ],
      ended: [
        {
          id: "A008",
          title: "9 月搬家准备与搬入",
          status: "9 月 26 日搬完，新家的阳台被豆包霸占了。",
          lastSeen: "2026-09-26",
          sessions: ["s-0919-house", "im-wechat-2026-09-24", "s-0926-house"],
          quotes: [
            {
              session: "s-0926-house",
              at: "2026-09-26 22:40",
              text: "搬完了，累瘫。新家的阳台豆包已经霸占了。",
            },
            {
              session: "im-wechat-2026-09-24",
              at: "2026-09-24 20:00",
              text: "周五搬家，提醒我前一天把豆包的猫砂盆和航空箱准备好。",
            },
          ],
          extra: ["频次：3 会话 / 3 消息"],
        },
        {
          id: "A002",
          title: "中秋活动页设计与上线",
          status: "9 月 16 日上线，首日点击率 4.2%。",
          lastSeen: "2026-09-16",
          sessions: ["s-0907-page", "s-0915-page", "s-0916-page"],
          quotes: [
            {
              session: "s-0916-page",
              at: "2026-09-16 10:30",
              text: "中秋活动页上线了，首日点击率 4.2%，还行。这个项目总算结束了。双十一的事下个月才开始。",
            },
          ],
          extra: [],
        },
        {
          id: "A007",
          title: "第三次科目三与驾照",
          status: "第三次通过，驾照拿到了。",
          lastSeen: "2026-09-14",
          sessions: ["s-0912-driving", "s-0914-driving"],
          quotes: [
            {
              session: "s-0914-driving",
              at: "2026-09-14 11:15",
              text: "科目三过了！！！第三次终于过了，考官说我靠边停车特别稳，太开心了！",
            },
          ],
          extra: [],
        },
        {
          id: "A006",
          title: "母亲的膝关节置换手术",
          status: "9 月 10 日手术顺利结束，术后照护见 A004。",
          lastSeen: "2026-09-10",
          sessions: ["s-0909-mom", "s-0910-surgery"],
          quotes: [
            {
              session: "s-0910-surgery",
              at: "2026-09-10 17:05",
              text: "出来了！医生说很顺利，我刚刚哭了一场。",
            },
          ],
          extra: [],
        },
      ],
      other: [
        "## 口径",
        "- 本次增量依据：`galley/batch.md`，9 个会话、10 条用户消息，2026-09-21 08:15—2026-09-27 21:00。",
        "- 频次按「涉及的不同会话数 / 支持该条目的用户消息数」计算。",
        "",
        "## 本批次证据边界",
        "- 排除：`s-0923-test`「我刚才问的第一个问题是什么？」为上下文记忆测试，不建立条目。",
      ].join("\n"),
    },
    emotions: {
      kind: "parsed",
      entries: [
        {
          id: "E001",
          title: "手术等待超预期时的明显焦急",
          at: "2026-09-10 15:40",
          sessions: ["s-0910-surgery"],
          tags: ["焦急", "不安"],
          quotes: [
            {
              text: "手术还没出来，已经三个多小时了，医生说两个半小时就好……我在走廊坐着，手一直在抖。",
            },
          ],
          related: "A006",
          extra: [],
        },
        {
          id: "E002",
          title: "得知手术顺利后的释然",
          at: "2026-09-10 17:05",
          sessions: ["s-0910-surgery"],
          tags: ["释然"],
          quotes: [{ text: "出来了！医生说很顺利，我刚刚哭了一场。" }],
          related: "A006",
          extra: [],
        },
        {
          id: "E003",
          title: "科目三通过、拿到驾照的喜悦",
          at: "2026-09-14 11:15",
          sessions: ["s-0914-driving"],
          tags: ["喜悦"],
          quotes: [
            {
              text: "科目三过了！！！第三次终于过了，考官说我靠边停车特别稳，太开心了！",
            },
          ],
          related: "A007",
          extra: [],
        },
        {
          id: "E004",
          title: "banner 宽高反复纠正后的责备",
          at: "2026-09-17 14:35",
          sessions: ["s-0917-banner"],
          tags: ["责备", "质问"],
          quotes: [
            {
              text: "我说了三遍了，是 750 宽 1000 高！你能不能认真看一下我说的话？",
            },
          ],
          related: "A010",
          extra: [],
        },
      ],
    },
    forgotten: [
      {
        id: "A003",
        kind: "activity",
        title: "与阿杰在西溪湿地附近找房",
        deletedAt: "2026-10-11T21:12:00+08:00",
      },
      {
        id: "E005",
        kind: "emotion",
        title: "房东临签加价引发的愤怒",
        deletedAt: "2026-10-11T21:13:00+08:00",
      },
    ],
    exclusions: [
      {
        target: { kind: "session", id: "s-0923-test" },
        createdAt: "2026-10-10T12:11:00+08:00",
        title: "上下文记忆测试",
      },
      {
        target: { kind: "project", id: "p-weekly" },
        createdAt: "2026-10-11T09:30:00+08:00",
        title: "公司周报",
      },
    ],
  },
  globalMemory: [
    {
      name: "global_mem.txt",
      exists: true,
      content: "# [Global Memory - L2]\n",
      revision: "fixture-global-mem",
    },
    {
      name: "global_mem_insight.txt",
      exists: true,
      content: [
        "# [Global Memory Insight]",
        "需要时read L2 或 ls ../memory/ 查L3",
        "L0(META-SOP): memory_management_sop",
        "L2: 现空",
        "L3: memory_cleanup_sop | ui_detect.py | ocr_utils.py | subagent | web_setup_sop",
        "L4: L4_raw_sessions/ 历史会话",
        "",
      ].join("\n"),
      revision: "fixture-global-mem-insight",
    },
  ],
};

/** Titles for the fixture's session ids (they exist in no database). */
export const MEMORY_FIXTURE_SESSION_TITLES: Readonly<Record<string, string>> = {
  "s-0907-run": "半马训练计划",
  "s-0920-run": "长距离后膝盖酸",
  "s-0927-run": "18 公里长距离",
  "s-0909-mom": "术后第一周准备",
  "s-0927-mom": "周末回宁波",
  "s-0911-japanese": "N3 复习表",
  "s-0916-japanese": "日语进度",
  "s-0922-japanese": "通勤日语播客",
  "s-0927-japanese": "补课计划",
  "s-0917-banner": "banner 改尺寸",
  "s-0920-cat": "豆包打针",
  "s-0916-page": "中秋活动页上线",
  "s-0907-page": "活动页配色",
  "s-0915-page": "交付说明",
  "s-0919-house": "搬家清单",
  "s-0926-house": "搬完了",
  "s-0912-driving": "灯光模拟口诀",
  "s-0914-driving": "科目三过了",
  "s-0910-surgery": "手术等待",
};
