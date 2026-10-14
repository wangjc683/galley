import type { ResolvedLanguage } from "@/lib/language";
import type { SubtaskCardState } from "@/lib/subtasks";
import type {
  AgentTurn,
  ConversationToolEvent,
  MessageAttachment,
  PendingAskUser,
  Turn,
  UserTurn,
} from "@/types/conversation";

import type { ImDemo } from "./im-trial";

/**
 * TEMPORARY — the 「演示」 conversation of the IM rendering trial (ticket
 * 19; see im-trial.ts). JC's main chat was reset this morning and holds
 * four questions, too little to judge a long conversation by. This is a
 * fixed one, all synthetic (no real conversation in it), in Chinese and
 * English by the UI language. Display only: MainView swaps it in for the
 * real turns, nothing is written and nothing reaches the model.
 *
 * What it carries, per the ticket: the greeting first; three days (the
 * day before yesterday, yesterday, today) with a day change and a gap
 * of more than an hour; a short question and a short answer; a reply of
 * about 280 characters with a list, one of about 400 with a 5-column
 * table, one with a code block; a 9-step reply (one first-person
 * narration per step) and one-step replies; a round where it asks with
 * three candidates, the user picks one and it answers; a reply that
 * dispatched two subtasks (one running, one done); an image the user
 * sent; two short messages sent right after another. Its end: 「静止」
 * closes on a short thanks, 「在跑」 runs a round whose narration moves
 * every few seconds (`imDemoRunning`), 「在问你」 waits on a question.
 */

export interface ImDemoCard {
  key: string;
  title: string;
  state: SubtaskCardState;
}

export interface ImDemoView {
  turns: Turn[];
  running: boolean;
  pendingAskUser: PendingAskUser | null;
  /** The in-flight step for the current-mode thinking row (GA's
   * per-loop step, 1-based). */
  currentTurnIndex: number | null;
  runStartedAtMs: number | null;
  /** The streaming buffer (MainView's `inFlightContent`). */
  inFlight: string;
  /** The greeting's time, for the centred time's line above it. */
  greetingAt: string;
  /** Subtask cards by the dispatching reply's message id. */
  cards: Map<string, ImDemoCard[]>;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface DemoCopy {
  /** The composer while the demo shows: its placeholder and the hint
   * under it. */
  composerPlaceholder: string;
  composerHint: string;
  greeting: string;
  weatherAsk: string;
  weatherReply: string;
  tripAsk: string;
  tripSteps: string[];
  tripReply: string;
  dinnerAsk: string;
  dinnerStep1: string;
  dinnerQuestion: string;
  dinnerCandidates: string[];
  dinnerRecap: string;
  dinnerStep3: string;
  dinnerReply: string;
  receiptAsk: string;
  taxi: string;
  lunch: string;
  receiptReply: string;
  monthAsk: string;
  monthSteps: string[];
  monthReply: string;
  scriptAsk: string;
  scriptStep: string;
  scriptReply: string;
  tripAsk2: string;
  tripReply2: string;
  trainTitle: string;
  trainSummary: string;
  weatherTitle: string;
  weatherLine: string;
  thanks: string;
  thanksReply: string;
  hotelAsk: string;
  hotelSteps: string[];
  bookAsk: string;
  bookStep: string;
  bookQuestion: string;
  bookCandidates: string[];
  bookRecap: string;
}

const ZH: DemoCopy = {
  composerPlaceholder: "演示中，关掉演示才能发消息",
  composerHint: "演示只换显示：不写进对话，也不发给模型",
  greeting:
    "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
  weatherAsk: "早，今天厦门天气怎么样？",
  weatherReply: "多云转阵雨，22 到 27 度，出门带把伞。",
  tripAsk: "周六想带爸妈去鼓浪屿玩一天，帮我排个行程",
  tripSteps: [
    "我先查一下周六去鼓浪屿的船票还剩多少。",
    "我看一下周六鼓浪屿的天气和气温。",
    "我找几个适合老人、不用爬太多坡的景点。",
    "我查一下这几个景点周六的开放时间。",
    "我算一下景点之间步行要多久。",
    "我挑一家午饭的店，要清淡一点。",
    "我看一下下午返程的船班。",
    "我把行程整理成一张时间表。",
  ],
  tripReply: [
    "排好了，按爸妈的脚程留足了休息的时间：",
    "",
    "- **8:30** 东渡码头上船，9:00 前到三丘田码头，早上人少",
    "- **9:15–11:00** 菽庄花园，海边平路多，可以慢慢走",
    "- **11:30** 午饭在龙头路的「林记」，清淡的闽南菜，人均 60 左右，可以点一份沙茶面",
    "- **13:30–15:00** 风琴博物馆和八卦楼，室内为主，避开午后的太阳",
    "- **15:30** 内厝澳码头坐船回厦门，16:00 前到",
    "",
    "周六多云，最高 26 度，下午三点后有零星小雨，记得带伞。船票我看了一下，上午的班次还很充足，前一天晚上订就行。爸妈走累了，菽庄花园门口可以坐观光车，单程 15 元。时间表也存了一份在文稿文件夹里，到时候打开就能看。",
  ].join("\n"),
  dinnerAsk: "行程里再加一顿晚饭，人均 150 以内",
  dinnerStep1: "我先看看鼓浪屿上评分高、人均 150 以内的晚饭。",
  dinnerQuestion: "晚饭想吃哪一类？",
  dinnerCandidates: ["闽南菜", "海鲜大排档", "西餐"],
  dinnerRecap: "问用户晚饭想吃哪一类",
  dinnerStep3: "我挑几家离内厝澳码头近的闽南菜馆。",
  dinnerReply:
    "那就订**鼓浪屿老别墅餐厅**：一栋二十年代的老别墅，做家常闽南菜，人均 120 左右，走到内厝澳码头五分钟。海蛎煎和姜母鸭是招牌。吃晚饭的话，回程改坐 18:40 的船，时间表我已经改好了。",
  receiptAsk: "这张小票帮我记一下账",
  taxi: "还有昨天打车 46",
  lunch: "午饭 32",
  receiptReply: [
    "记好了，三笔都记进十月的账本：",
    "",
    "- 超市 128.5（小票）",
    "- 打车 46",
    "- 午饭 32",
  ].join("\n"),
  monthAsk: "把这个月的开销按类别汇总一下，做成表",
  monthSteps: [
    "我把这个月记过的账都读出来。",
    "我按类别汇总，再跟九月同期比一下。",
  ],
  monthReply: [
    "十月到今天一共 **2,846 元**，比九月同期少了 12%。按类别汇总如下：",
    "",
    "| 类别 | 笔数 | 金额（元） | 占比 | 比九月同期 |",
    "|---|---|---|---|---|",
    "| 餐饮 | 23 | 1,126.0 | 39.6% | −8% |",
    "| 交通 | 14 | 468.5 | 16.5% | +5% |",
    "| 日用 | 9 | 612.3 | 21.5% | −21% |",
    "| 娱乐 | 4 | 389.0 | 13.7% | +32% |",
    "| 其他 | 6 | 250.2 | 8.8% | −40% |",
    "",
    "几个值得留意的地方：餐饮还是大头，但外卖少了 6 单；娱乐涨得多，主要是 10 月 3 日那张演唱会票；日用下降是因为九月囤过一次纸巾和洗衣液；其他里有一笔 120 元的快递费，是寄回老家的那箱特产。",
    "",
    "细看餐饮这一项：工作日的午饭平均 31 元，两次周末聚餐占了 386 元。交通里打车 9 次、地铁 5 次，打车多在下雨那几天。照现在的节奏，十月底大概在 3,900 元左右，比你定的 4,000 元预算略低。日用下个月初大概又要补一次纸巾，可以等月底的满减。要不要我每周日晚上给你发一次这样的小结？也可以只在快超预算时提醒你。",
  ].join("\n"),
  scriptAsk: "帮我写个脚本，把下载文件夹里的截图按月份归档",
  scriptStep: "我先看一下下载文件夹里截图的命名方式。",
  scriptReply: [
    "写好了。截图按修改时间放进 `~/Pictures/截图/2026-10` 这样的文件夹，文件名不变：",
    "",
    "```python",
    "from pathlib import Path",
    "from datetime import datetime",
    "import shutil",
    "",
    'downloads = Path.home() / "Downloads"',
    'target = Path.home() / "Pictures" / "截图"',
    "",
    'for shot in downloads.glob("截屏*.png"):',
    '    month = datetime.fromtimestamp(shot.stat().st_mtime).strftime("%Y-%m")',
    "    folder = target / month",
    "    folder.mkdir(parents=True, exist_ok=True)",
    "    shutil.move(str(shot), folder / shot.name)",
    "```",
    "",
    "存成 `archive_screenshots.py`，在终端里运行 `python3 archive_screenshots.py` 就行。想每周自动跑一次的话，我可以帮你加个定时任务。",
  ].join("\n"),
  tripAsk2: "下周三去上海出差，帮我订高铁票，顺便查一下那边的天气",
  tripReply2:
    "好，我开了两个子任务分头去办：一个订票，一个查天气。有结果我马上告诉你。",
  trainTitle: "订下周三去上海的高铁票",
  trainSummary: "比较两班车的到达时间",
  weatherTitle: "查上海下周三的天气",
  weatherLine: "多云，18–24 度，傍晚有小雨",
  thanks: "谢谢",
  thanksReply: "不客气，票订好了我第一时间告诉你。",
  hotelAsk: "顺便看看外滩附近周三晚上还有没有房",
  hotelSteps: [
    "我先看看外滩附近周三晚上还有房的酒店。",
    "我比较一下这几家离会场的距离。",
    "我看一下这几家最近的评价。",
    "我查一下能不能免费取消。",
    "我把价格和距离整理成一张表。",
  ],
  bookAsk: "顺便订一下外滩附近周三晚上的酒店",
  bookStep: "我看了外滩附近周三还有房的几家酒店。",
  bookQuestion: "这三家都还有房，订哪一家？",
  bookCandidates: [
    "和平饭店，离会场最近",
    "全季外滩店，便宜一些",
    "先不订，我再想想",
  ],
  bookRecap: "问用户订哪一家酒店",
};

const EN: DemoCopy = {
  composerPlaceholder: "Demo on. Turn it off to send a message.",
  composerHint:
    "The demo only changes the display: nothing is saved or sent to the model.",
  greeting:
    "Hi. From now on, whatever comes up, just tell me here. No need to decide whether to start a new conversation or pick up an old one.",
  weatherAsk: "Morning. What's the weather in Xiamen today?",
  weatherReply: "Cloudy, then showers, 22–27°C. Take an umbrella.",
  tripAsk:
    "We're taking my parents to Gulangyu on Saturday. Can you plan the day?",
  tripSteps: [
    "Let me check how many Saturday ferry tickets are left.",
    "I'll look up Saturday's weather on the island.",
    "I'm finding sights that don't need much climbing.",
    "Let me check their Saturday opening hours.",
    "I'll work out the walking times between them.",
    "I'm picking a lunch place with lighter food.",
    "Let me look at the afternoon ferries back.",
    "I'm putting it all into a timetable.",
  ],
  tripReply: [
    "Done, with plenty of breaks at your parents' pace:",
    "",
    "- **8:30** Ferry from Dongdu, at Sanqiutian pier before 9:00 while it's quiet",
    "- **9:15–11:00** Shuzhuang Garden, mostly flat paths by the sea",
    "- **11:30** Lunch at Lin's on Longtou Road, light Minnan dishes, about ¥60 each; try the satay noodles",
    "- **13:30–15:00** The Organ Museum and the Bagua Building, mostly indoors, out of the afternoon sun",
    "- **15:30** Ferry back from Neicuo'ao pier, in Xiamen by 16:00",
    "",
    "Saturday is cloudy with a high of 26°C and some light rain after 3 pm, so bring an umbrella. Morning ferries still have plenty of seats; booking the night before is fine. If your parents get tired, there's a shuttle cart at the Shuzhuang Garden gate, ¥15 one way. I saved the timetable in your Documents folder too.",
  ].join("\n"),
  dinnerAsk: "Add a dinner to the plan, under ¥150 a head.",
  dinnerStep1:
    "Let me look for well-rated dinners on the island under ¥150 a head.",
  dinnerQuestion: "What kind of food for dinner?",
  dinnerCandidates: ["Minnan", "Seafood stalls", "Western"],
  dinnerRecap: "Asked what kind of dinner the user wants",
  dinnerStep3: "I'll pick a few Minnan places near Neicuo'ao pier.",
  dinnerReply:
    "Then book the **Old Villa Restaurant**: home-style Minnan cooking in a 1920s villa, about ¥120 a head, five minutes' walk from Neicuo'ao pier. The oyster omelette and ginger duck are what it's known for. With dinner, take the 18:40 ferry back instead; I've updated the timetable.",
  receiptAsk: "Log this receipt for me",
  taxi: "Plus a taxi yesterday, 46",
  lunch: "Lunch 32",
  receiptReply: [
    "Logged all three in October's book:",
    "",
    "- Supermarket 128.50 (receipt)",
    "- Taxi 46",
    "- Lunch 32",
  ].join("\n"),
  monthAsk: "Sum up this month's spending by category, as a table.",
  monthSteps: [
    "Let me read everything logged this month.",
    "I'll group it by category and compare it with September.",
  ],
  monthReply: [
    "October so far: **¥2,846**, 12% less than this point in September. By category:",
    "",
    "| Category | Entries | Amount (¥) | Share | vs. September |",
    "|---|---|---|---|---|",
    "| Food | 23 | 1,126.0 | 39.6% | −8% |",
    "| Transport | 14 | 468.5 | 16.5% | +5% |",
    "| Household | 9 | 612.3 | 21.5% | −21% |",
    "| Fun | 4 | 389.0 | 13.7% | +32% |",
    "| Other | 6 | 250.2 | 8.8% | −40% |",
    "",
    "A few things stand out: food is still the biggest share, but you ordered six fewer deliveries; fun is up, mostly because of the concert ticket on October 3; household is down because you stocked up on tissues and detergent in September; other includes ¥120 of shipping for the box of local food you sent home.",
    "",
    "On food: weekday lunches average ¥31, and two weekend dinners with friends came to ¥386. You took a taxi 9 times and the metro 5 times, the taxis mostly on rainy days. At this pace October should end around ¥3,900, a little under your ¥4,000 budget. You'll probably need tissues again early next month; the end-of-month discounts are worth waiting for. Want a summary like this every Sunday evening? Or I can just warn you when you get close to the budget.",
  ].join("\n"),
  scriptAsk:
    "Write me a script that sorts the screenshots in Downloads into folders by month.",
  scriptStep: "Let me see how the screenshots in Downloads are named.",
  scriptReply: [
    "Here it is. Screenshots move into folders like `~/Pictures/Screenshots/2026-10` by their modified time, names unchanged:",
    "",
    "```python",
    "from pathlib import Path",
    "from datetime import datetime",
    "import shutil",
    "",
    'downloads = Path.home() / "Downloads"',
    'target = Path.home() / "Pictures" / "Screenshots"',
    "",
    'for shot in downloads.glob("Screenshot*.png"):',
    '    month = datetime.fromtimestamp(shot.stat().st_mtime).strftime("%Y-%m")',
    "    folder = target / month",
    "    folder.mkdir(parents=True, exist_ok=True)",
    "    shutil.move(str(shot), folder / shot.name)",
    "```",
    "",
    "Save it as `archive_screenshots.py` and run `python3 archive_screenshots.py` in Terminal. If you want it to run every week, I can set up a scheduled task.",
  ].join("\n"),
  tripAsk2:
    "I'm in Shanghai next Wednesday for work. Book the train, and check the weather there.",
  tripReply2:
    "Sure. I've started two subtasks: one books the train, one checks the weather. I'll tell you as soon as they're done.",
  trainTitle: "Book next Wednesday's train to Shanghai",
  trainSummary: "Comparing two trains' arrival times",
  weatherTitle: "Check Shanghai's weather next Wednesday",
  weatherLine: "Cloudy, 18–24°C, light rain in the evening",
  thanks: "Thanks",
  thanksReply: "You're welcome. I'll tell you the moment the ticket is booked.",
  hotelAsk: "Also see if there's a room near the Bund on Wednesday night",
  hotelSteps: [
    "Let me see which hotels near the Bund have rooms on Wednesday.",
    "I'm comparing how far each one is from the venue.",
    "Let me read their recent reviews.",
    "I'll check whether they allow free cancellation.",
    "I'm putting prices and distances into a table.",
  ],
  bookAsk: "Also book a hotel near the Bund for Wednesday night",
  bookStep: "I checked the hotels near the Bund with rooms on Wednesday.",
  bookQuestion: "All three have rooms. Which one should I book?",
  bookCandidates: [
    "Peace Hotel, closest to the venue",
    "Ji Hotel Bund, cheaper",
    "Not yet, let me think",
  ],
  bookRecap: "Asked which hotel to book",
};

/** A drawn receipt for the user's image (an SVG data URL: MessageUser
 * shows `data:` paths as they are). Nothing real in it. */
const RECEIPT_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  [
    "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='320' viewBox='0 0 240 320'>",
    "<rect width='240' height='320' fill='#e9e4dc'/>",
    "<rect x='40' y='18' width='160' height='290' rx='4' fill='#fffdf8'/>",
    "<rect x='70' y='40' width='100' height='10' rx='3' fill='#8a847b'/>",
    ...[78, 98, 118, 138, 158, 178].map(
      (y, i) =>
        `<rect x='56' y='${y}' width='${70 + ((i * 17) % 40)}' height='6' rx='3' fill='#c9c3ba'/><rect x='160' y='${y}' width='24' height='6' rx='3' fill='#c9c3ba'/>`,
    ),
    "<rect x='56' y='206' width='128' height='2' fill='#d8d2c9'/>",
    "<rect x='56' y='222' width='50' height='9' rx='3' fill='#57534c'/>",
    "<rect x='146' y='222' width='38' height='9' rx='3' fill='#57534c'/>",
    "<rect x='92' y='262' width='56' height='22' rx='2' fill='#d8d2c9'/>",
    "</svg>",
  ].join(""),
)}`;

/** A settled tool call; `id` is its step's id (one tool per step). */
function tool(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ConversationToolEvent {
  return { id: `demo-tool-${id}`, name, status: "success-historical", args };
}

function user(
  id: string,
  content: string,
  at: number,
  extra: Partial<UserTurn> = {},
): UserTurn {
  return {
    role: "user",
    content,
    messageId: `demo-${id}`,
    createdAt: iso(at),
    ...extra,
  };
}

/** A step with a first-person narration and one tool. GA's summary
 * echoes the narration (the common case since 2026-09), so its marker
 * line is the narration. */
function step(
  id: string,
  index: number,
  narration: string,
  stepTool: ConversationToolEvent,
): AgentTurn {
  return {
    role: "agent",
    messageId: `demo-${id}`,
    turnIndex: index,
    finalAnswer: narration,
    summary: narration,
    tools: [stepTool],
  };
}

/** A step that asks the user (the closer of its GA loop, so it carries
 * that loop's time); `recap` is GA's third-person summary of it. */
function ask(
  id: string,
  index: number,
  question: string,
  candidates: string[],
  recap: string,
  elapsedMs: number,
): AgentTurn {
  return {
    role: "agent",
    messageId: `demo-${id}`,
    turnIndex: index,
    finalAnswer: null,
    summary: recap,
    tools: [tool(id, "ask_user", { question, candidates })],
    telemetry: { elapsedMs },
  };
}

function answer(
  id: string,
  index: number,
  text: string,
  elapsedMs: number,
  tokens: [number, number],
): AgentTurn {
  return {
    role: "agent",
    messageId: `demo-${id}`,
    turnIndex: index,
    finalAnswer: text,
    // GA's fallback summary (the whole reply), as when the model writes
    // no <summary>: the step's marker reads 「直接回答」.
    summary: text,
    tools: [tool(id, "no_tool", {})],
    telemetry: {
      elapsedMs,
      inputTokens: tokens[0],
      outputTokens: tokens[1],
    },
  };
}

/** The tool of the step at `i` (id `id`): browsing, with a script every
 * third step. */
function browseOrScript(id: string, i: number): ConversationToolEvent {
  return i % 3 === 1
    ? tool(id, "code_run", { script: `python3 plan.py --step ${i + 1}` })
    : tool(id, "web_scan", {});
}

/** The history every variant shares: three days, ending on today's
 * subtask reply. `now` places today's messages; earlier days use fixed
 * clock times. */
/** The parts of the demo that do not move: the shared history, its
 * subtask cards, the greeting's time, and where today's last messages
 * go. Built once per demo opening (`now` places today's messages). */
export interface ImDemoBase {
  copy: DemoCopy;
  zh: boolean;
  turns: Turn[];
  cards: Map<string, ImDemoCard[]>;
  greetingAt: string;
  todayAt: (minutesAgo: number, floorMinutes: number) => number;
}

/** The shared history: three days, ending on today's subtask reply.
 * Earlier days use fixed clock times. */
export function imDemoBase(
  language: ResolvedLanguage,
  now: number,
): ImDemoBase {
  const zh = language !== "en-US";
  const copy = zh ? ZH : EN;
  const today = dayStart(now);
  const d2 = today - 2 * DAY;
  const d1 = today - DAY;
  // Today's times trail now but stay today, in order (a check just
  // after midnight squeezes them together instead of crossing the day).
  const todayAt = (minutesAgo: number, floorMinutes: number) =>
    Math.max(now - minutesAgo * MINUTE, today + floorMinutes * MINUTE);
  const at = (day: number, hour: number, minute: number) =>
    day + (hour * 60 + minute) * MINUTE;

  const turns: Turn[] = [
    {
      role: "agent",
      messageId: "demo-greeting",
      turnIndex: -1,
      finalAnswer: copy.greeting,
      tools: [],
      greeting: true,
    },
    // The day before yesterday: a short question, a short answer.
    user("u1", copy.weatherAsk, at(d2, 9, 12)),
    answer("a1", 1, copy.weatherReply, 4_000, [3_200, 60]),
    // A 9-step reply with a list.
    user("u2", copy.tripAsk, at(d2, 9, 20)),
    ...copy.tripSteps.map((line, i) =>
      step(
        `t${i}`,
        i + 1,
        line,
        i === copy.tripSteps.length - 1
          ? tool(`t${i}`, "file_write", {
              path: zh
                ? "~/Documents/鼓浪屿一日游.md"
                : "~/Documents/Gulangyu day trip.md",
            })
          : browseOrScript(`t${i}`, i),
      ),
    ),
    answer("a2", 9, copy.tripReply, 81_000, [48_200, 1_340]),
    // More than an hour later, the same evening: it asks, the user
    // picks a candidate, it answers.
    user("u3", copy.dinnerAsk, at(d2, 21, 40)),
    step("d1", 1, copy.dinnerStep1, tool("d1", "web_scan", {})),
    ask(
      "d2",
      2,
      copy.dinnerQuestion,
      copy.dinnerCandidates,
      copy.dinnerRecap,
      19_000,
    ),
    user("u4", copy.dinnerCandidates[0], at(d2, 21, 42)),
    step("d3", 3, copy.dinnerStep3, tool("d3", "web_scan", {})),
    answer("a3", 4, copy.dinnerReply, 26_000, [21_400, 420]),
    // Yesterday (a day change): an image, two short messages right
    // after it, one answer.
    user("u5", copy.receiptAsk, at(d1, 8, 15), {
      attachments: [
        {
          id: "demo-receipt",
          messageId: "demo-u5",
          sessionId: "demo",
          kind: "image",
          path: RECEIPT_IMAGE,
          mimeType: "image/svg+xml",
          byteSize: 1_024,
          width: 240,
          height: 320,
          createdAt: iso(at(d1, 8, 15)),
        } satisfies MessageAttachment,
      ],
    }),
    user("u6", copy.taxi, at(d1, 8, 15) + 20_000),
    user("u7", copy.lunch, at(d1, 8, 16)),
    answer("a4", 1, copy.receiptReply, 6_000, [5_100, 90]),
    // A table reply.
    user("u8", copy.monthAsk, at(d1, 14, 30)),
    step(
      "m1",
      1,
      copy.monthSteps[0],
      tool("m1", "file_read", { path: "~/Documents/ledger/2026-10.csv" }),
    ),
    step(
      "m2",
      2,
      copy.monthSteps[1],
      tool("m2", "code_run", { script: "python3 summarize.py 2026-10.csv" }),
    ),
    answer("a5", 3, copy.monthReply, 38_000, [26_800, 760]),
    // Today: a code reply.
    user("u9", copy.scriptAsk, todayAt(180, 5)),
    step(
      "s1",
      1,
      copy.scriptStep,
      tool("s1", "code_run", { script: "ls ~/Downloads | head -20" }),
    ),
    answer("a6", 2, copy.scriptReply, 24_000, [15_300, 520]),
    // More than an hour later: a reply that dispatched two subtasks.
    user("u10", copy.tripAsk2, todayAt(80, 10)),
    answer("a7", 1, copy.tripReply2, 9_000, [8_900, 110]),
  ];
  const cards = new Map<string, ImDemoCard[]>([
    [
      "demo-a7",
      [
        {
          key: "train",
          title: copy.trainTitle,
          state: { kind: "running", step: 3, summary: copy.trainSummary },
        },
        {
          key: "weather",
          title: copy.weatherTitle,
          state: { kind: "done", line: copy.weatherLine },
        },
      ],
    ],
  ]);
  return {
    copy,
    zh,
    turns,
    cards,
    greetingAt: iso(at(d2, 8, 40)),
    todayAt,
  };
}

/** One step of the 「在跑」 round lands every this many ms. */
export const IM_DEMO_STEP_MS = 4_000;
/** Within a step: nothing streams for this long (「思考中」, or the last
 * narration), then the next narration streams in until `STREAM_END`. */
const STREAM_START_MS = 1_200;
const STREAM_END_MS = 3_200;
/** The round stops adding steps here (its clock keeps going). */
const MAX_DEMO_STEPS = 40;

/** How many of the 「在跑」 round's steps have landed `elapsed` ms in. */
export function imDemoLanded(elapsed: number): number {
  return Math.min(
    MAX_DEMO_STEPS,
    Math.floor(Math.max(0, elapsed) / IM_DEMO_STEP_MS),
  );
}

/**
 * The demo's turns: the history plus its end. 「静止」 closes on a short
 * thanks two minutes after the subtask reply (no time break); 「在问你」
 * ends on a question with three candidates; 「在跑」 on the user's new
 * message at `runStartedAtMs` and the `landed` steps after it. Only
 * these inputs make new turns, so the turns stay the same objects while
 * only the streaming text moves.
 */
export function imDemoTurns(
  variant: Exclude<ImDemo, "off">,
  base: ImDemoBase,
  landed: number,
  runStartedAtMs: number,
): Turn[] {
  const { copy } = base;
  if (variant === "still") {
    return [
      ...base.turns,
      user("u11", copy.thanks, base.todayAt(78, 15)),
      answer("a8", 1, copy.thanksReply, 3_000, [9_100, 40]),
    ];
  }
  if (variant === "asking") {
    return [
      ...base.turns,
      user("u11", copy.bookAsk, base.todayAt(77, 15)),
      step("b1", 1, copy.bookStep, tool("b1", "web_scan", {})),
      ask(
        "b2",
        2,
        copy.bookQuestion,
        copy.bookCandidates,
        copy.bookRecap,
        22_000,
      ),
    ];
  }
  const steps = Array.from({ length: landed }, (_, i) =>
    step(`r${i}`, i + 1, hotelStep(copy, i), browseOrScript(`r${i}`, i)),
  );
  return [...base.turns, user("u11", copy.hotelAsk, runStartedAtMs), ...steps];
}

function hotelStep(copy: DemoCopy, i: number): string {
  return copy.hotelSteps[i % copy.hotelSteps.length];
}

/** The narration streaming `elapsed` ms into the 「在跑」 round: within
 * each 4s step nothing for 1.2s, then the next step's narration
 * streams in until 3.2s; the step lands at 4s. */
export function imDemoStreaming(base: ImDemoBase, elapsed: number): string {
  const landed = imDemoLanded(elapsed);
  if (landed >= MAX_DEMO_STEPS) return "";
  const within = Math.max(0, elapsed) - landed * IM_DEMO_STEP_MS;
  if (within < STREAM_START_MS) return "";
  const chars = Array.from(hotelStep(base.copy, landed));
  const share = Math.min(
    1,
    (within - STREAM_START_MS) / (STREAM_END_MS - STREAM_START_MS),
  );
  return chars.slice(0, Math.ceil(share * chars.length)).join("");
}

/** The pending question of 「在问你」. */
export function imDemoQuestion(base: ImDemoBase): PendingAskUser {
  return {
    question: base.copy.bookQuestion,
    candidates: base.copy.bookCandidates,
  };
}

/**
 * The whole demo view at `now` (`variant` not "off") — the composition
 * useImDemo memoizes piece by piece. For 「在跑」, `runStartedAtMs` is
 * when the round began.
 */
export function buildImDemo(
  variant: Exclude<ImDemo, "off">,
  language: ResolvedLanguage,
  now: number,
  runStartedAtMs: number = now,
): ImDemoView {
  const base = imDemoBase(language, now);
  const elapsed = now - runStartedAtMs;
  const running = variant === "running";
  return {
    turns: imDemoTurns(variant, base, imDemoLanded(elapsed), runStartedAtMs),
    running,
    pendingAskUser: variant === "asking" ? imDemoQuestion(base) : null,
    currentTurnIndex: running ? imDemoLanded(elapsed) + 1 : null,
    runStartedAtMs: running ? runStartedAtMs : null,
    inFlight: running ? imDemoStreaming(base, elapsed) : "",
    greetingAt: base.greetingAt,
    cards: base.cards,
  };
}

/** The composer's placeholder and hint while the demo shows (the
 * composer is off: a message would go to the real chat, out of sight). */
export function imDemoComposerCopy(language: ResolvedLanguage): {
  placeholder: string;
  hint: string;
} {
  const copy = language === "en-US" ? EN : ZH;
  return { placeholder: copy.composerPlaceholder, hint: copy.composerHint };
}
