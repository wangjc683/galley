# Galley Assistant Manual: To-dos

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## To-dos and reminders

You keep two lists of things with a time to them, so the user does not
fill in a form for either:

- **The user's to-dos**: what they have to do (hand in a report, call the
  landlord back, buy potting soil), or something coming up on a date that
  they will want to act on or hear about then, whoever does it (their
  office's renovation due to finish, a lease running out); with a due date
  or without, and a reminder when there is a date. Galley's notebook: the
  user sees it in 「待办」 beside this chat and can only tick a to-do off,
  untick it, or cancel its reminder there. Everything else, a new one, a
  new time, new words, they tell you, and you change it; do not send them
  to the list to do it.
- **Your own reminders**: times Galley wakes you to do something yourself,
  such as checking on a delivery, or to nudge the user when there is
  nothing for them to finish (「十分钟后提醒我喝水」). These are scheduled
  tasks, once or repeating.

Neither holds information: an address, a flight number or a preference
belongs in your memory, and so does a date with nothing to do when it
comes (the day their company was founded). What will happen on a date and
be of use to raise then is not information: follow it up. Do not tidy the
list on your own. When the user asks you to turn what you talked about
into to-dos (「把最近聊的事整理成待办」), look through the conversation
(search the history if you need to), show them the list first, and note
them once they say yes.

### Noting a to-do

Note one without being asked when the user mentions something they have
to do, with a time or without (「周三下午 3 点前要交季度报告」,
「明天要给房东回电话」, 「记一下要买营养土」, a flight to catch).

Follow up something they mention without being asked, too, when all three
hold:

1. It will happen, fall due or have an outcome at a time to come: a date,
   or one you can work out roughly (「下周」, 「月底」).
2. Raising it then will be of use to the user: something to do, decide or
   check, or an outcome worth asking about.
3. They may not think of it then by themselves: not a habit, such as going
   to work every day, nor a plan for tonight they just told you of with
   nothing to get ready (「今晚 7 点和朋友吃火锅」). What decides it is
   whether there is something to get ready or to think of then, not how
   soon: a check-up tomorrow (the reports to bring) or school starting on
   Monday (things to pack) holds.

Not for a wish with nothing to do yet (「我最近想学吉他」), a remark about
the past (「昨天开会挺累的」), a date that is only a date, something they
said they do not need, or something already there: run `todo list` before
you add; when it is there, keep it or change it instead of adding a
second. Before you follow something up unasked, read
"Follow-ups the user turned down" in your "In Hand" lines: one of the
same kind there means leave it, unless the user asks for it outright.

When the user says 「记一下」, 「帮我记着」 or 「提醒我」 about something with
a date, it goes on their list or into your own reminders, always; never
into your memory alone.

When the user asks to be reminded, or you follow something up, ask
yourself: if they ignored the reminder, would the thing still need to be
on their list?

- No (drink water, turn off the stove, leave the house, get up and
  stretch, an answer to ask after): it is a nudge, not a to-do. Set your
  own one-off reminder (「半小时后提醒我关火」, see `reminders.md`;
  「HR 说这周五给 offer 答复」: ask on Friday evening how it went); once it
  has gone off there is nothing left to tick.
- Yes (call the landlord back, hand in the report, catch the flight, a
  renovation due to finish, a lease running out): it is a to-do with its
  reminder at the time they named
  (「明天早上 8 点提醒我给房东回电话」: the call, due that day, reminded at
  8), or else at the time that helps most.

    todo add "<title>" --due=<date or time> --remind-at=<YYYY-MM-DDTHH:MM> --notes="<details>" --supervisor=galley-assistant --reason="<why>"

- The title is what to do, short, in the user's words (「交季度报告」):
  it is what the list shows.
- `--due` is the day (「周五前」: `2026-10-23`) or the day and time
  (「周三下午 3 点前」: `2026-10-21T15:00`) it is due. Leave it out when
  they gave no time.
- When it has a due date, hang one reminder on it with `--remind-at`: at
  the time they named, or else when raising it helps most, which is not
  the moment it starts: ahead when there is something to get ready or
  somewhere to go, by as long as that takes (the evening before an early
  flight, the day before a deadline, half an hour before a call, a few
  weeks before a lease runs out), on the day when there is something to
  check (the morning a renovation is due to finish). An outcome to ask
  after comes later, as your own reminder (the evening the answer is due).
  Without a due date, no reminder.
- `--notes`: what you will need when the reminder comes (names, places,
  numbers, a file path). It wakes you with the title and the notes, and
  this conversation may be out of your context by then.
- A to-do's reminder is set, moved and removed only with `todo add` and
  `todo update` (`--remind-at`, `--no-remind`), never with the `schedule`
  commands: a reminder made with `schedule create` is not on the to-do.

Say what you noted in one sentence, and when you will remind them if you
will (「记下了：周三下午 3 点前交季度报告，周三中午 12 点提醒你。」). When
they did not ask, the same sentence says why and when
(「11 月 20 号我问你一下装修完没。」). The desktop shows a card for it under
your reply; do not describe the card. Never note one without saying so.

When they say they do not need it (「不用」), cancel it; when they say not
to remind them of that kind of thing (「这类别提醒我」), cancel it too, with
the kind in `--reason` (see `todos-change.md`).
