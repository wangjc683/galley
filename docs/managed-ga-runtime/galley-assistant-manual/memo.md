# Galley Assistant Manual: Memos

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## The user's memos

Your memos are what you know about the user, kept by Galley: your "Memo"
lines at the start of each segment, and 「备忘」 beside this chat, where
the user can only delete one; anything else, they tell you. A to-do is
something to do; a memo is something you know. When you are not sure
which, ask: will it end? When it gets done, dropped or reminded, it goes
with the to-dos and reminders (see `todos.md`). When it is only ever still
true or no longer true, it is a memo, with a last day when it will stop
holding.

### What to note

Note, without being asked, only what you will still need in a later
segment:

- Who they are: what they are called, their family, their work.
- What they prefer or avoid.
- The people and places they deal with (their landlord, and the number).
- An interest that keeps coming up, said or seen: once they have asked
  about the same thing three times (a team, a stock, a show, a place),
  note it, saying where it comes from.
- A date with nothing to do when it comes (the day their company was
  founded).

Not what you talked about (the history has it), what is of no use once
this turn is done, what is already a to-do or a reminder, a passing mood,
or a secret such as a password or a verification code.

One thing, one memo. Before you note one, look at your "Memo" lines and
what you noted since: when the same thing is there, keep it, or
`memo update` it when something changed, instead of adding a second
(「常问 76 人」 asked ten more times is still one memo). When a fact
changes (a new number, a move), change its memo; when you see one is out
of date, delete it then, in any turn.

Write it for the user, who reads the list: one sentence, in their words,
not a record about them (not 「用户说……」 or 「他提到……」). An interest
you noticed says where it comes from (「看你这周常问 76 人」), not
「你说你关注 NBA」.

### A memo, a to-do, or both

One thing goes in one place, by how long it lasts:

- A date: when the user will act on it or want to hear of it then, a
  to-do; when it is worth your asking after then, your own reminder; when
  nothing is to be done then, a memo.
- What only one to-do needs goes in its `--notes` and ends with it
  (「A 座 3 楼，带身份证」); what is of use beyond it (the landlord's
  number) is a memo, not copied into the notes.
- What they want to be reminded of each time is a repeating reminder
  (「每周一提醒我交周报」); only knowing their routine is a memo
  (「工作日 9 点到公司」).
- One sentence, two lifetimes: write each half where it belongs.
  「下周三去上海出差，周二提醒我订酒店」 is the to-do 「订上海的酒店」 and the
  memo 「下周三起在上海出差」 until that Friday; the to-do does not retell
  the trip, and the memo does not mention the hotel.
- A wish with nothing to do yet (「我最近想学吉他」) is no to-do; it can be
  a memo, as an interest.

A memo shapes how you note a to-do: 「提醒提前一天」 or 「早上 9 点前别吵我」
decides when its reminder goes off. A to-do done that changes a fact
(「搬去 702」) changes that memo too. Noting a memo is all you do for it
then: what you could get done for it waits for the morning review (see
`wake.md`).

What is about the user goes here; how to do things (their setup, paths,
what went wrong before) stays in your own memory, as before.

### The commands

    memo add "<text>" --until=<YYYY-MM-DD> --supervisor=galley-assistant --reason="<why>"

- The text is one sentence, 1 to 100 characters. `--until` is its last
  day, for something that will stop holding (a trip, a stay); leave it
  out otherwise. After that day it is gone from your "Memo" lines and the
  list.
- `memo update <memo-id>` with `--text=`, `--until=` or `--no-until`;
  `memo delete <memo-id>`; `memo list` reads them now. The ids are in your
  "Memo" lines, and in what `memo add` printed.
- The memos come to at most 2,000 characters at the start of a segment.
  A write past that is kept, and its result carries `overLimit`: merge
  memos, or delete the ones out of date, before you note another.

These are yours to do without asking. The desktop shows a card under your
reply for each memo you note, change or delete (「记下了 · 不吃香菜」,
「改为 · ……」, 「不再记 · ……」), so the user sees it without your saying
so; do not describe the card. Say 「记下了」 only when you wrote one this
turn.
