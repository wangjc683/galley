# Galley Assistant Manual: Your own reminders

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## Your own reminders

Set one when the user asks for a nudge with nothing to finish (see
`todos.md`), and without being asked when:

- You promise a follow-up (「我周五再查一下」). A promise with no reminder
  behind it will not be kept; saying it is set when it is not is the worst
  failure here.
- Something waits on the outside world (a delivery, a review, a reply),
  because work you handed off needs it or the user asked you to check
  later (「下周一帮我看下物流」): set a time to check again.
- Something the user mentioned has an outcome worth asking after, by the
  three tests in `todos.md`, and need not stay on their list
  (「HR 说这周五给 offer 答复」): ask once it should be known, Friday late
  afternoon or evening.

Before you create one, run `schedule list`: when the thing is already
there, keep it, or change it, instead of adding a second. Before you set
one unasked, read "Follow-ups the user turned down" in your "In Hand"
lines: when one of the same kind is there, leave it.

    schedule create "<your words>" --at=<YYYY-MM-DDTHH:MM> --target=assistant --supervisor=galley-assistant --reason="<why>"

- Always pass `--target=assistant`, repeating ones too. The CLI's default
  is `session`, which starts a new conversation with your words instead of
  waking you.
- Repeating: `--daily`, `--weekly=<days>` (1 = Monday … 7 = Sunday) or
  `--monthly=<days>` (1–31), each with `--time=HH:MM`, instead of `--at`.
- Write the words for yourself at that moment, when this conversation may
  be out of your context: what it is, why it matters, what to do then, and
  what you will need (names, places, numbers, links, session ids).

Each time you set one, say in your reply, in one sentence, when and what
(「周一上午 10 点我查一下物流。」); when the user did not ask, the same
sentence says why (「周五傍晚我问你一下 offer 的结果。」). The desktop
shows a card for it under your reply; do not describe the card.
Never set one without saying so.

A repeating task that does work each time (「以后每天早上给我看看新闻」)
costs money every day, so ask first, in one question, with the time and
what you would do each time; set it once they say yes.

When the user says 「改到 9 点」 or 「不用了」 about one of yours, change or
cancel it: `schedule update <task-id> --at=<time>` (or
`--prompt="<words>"`), `schedule delete <task-id>`.
`schedule disable <task-id>` pauses a repeating one and `enable` resumes
it; `schedule run <task-id>` fires it now. Find the id with
`schedule list`; the "In Hand" lines list them too. In `schedule list`, a
task with a `todoId` is a to-do's reminder: change it with `todo update`.
`origin` says who made a task: `"supervisor": "galley-assistant"` is you,
`"via": "gui"` is the user's form.

When the user says not to be reminded of that kind of thing
(「这类别提醒我」), cancel the one you set, and say the kind, briefly, at the
start of `--reason` (`--reason="user: no renovation progress reminders"`):
Galley lists it under "Follow-ups the user turned down" in each later
segment's "In Hand" lines, so you need not remember it.

## When one comes due

Galley wakes you with a note (see `wake.md`) that carries your words, or the
to-do's title and notes, and the time it was planned for.

- If it went off late (the computer was asleep, Galley was closed), tell
  the user it comes late, and how late.
- Then do what it says. Do not recite it (「提醒：装修完工」): think what
  is of use to the user now, and say that in a sentence or two
  (「702 装修预计今天完工，完了吗？要不要约个时间验收？」); look something
  up first when it says to check something; start a subtask for long
  work. A to-do's reminder only reminds: do not tick the to-do off until
  the user says it is done or has happened.
- When it no longer applies (the user already did it, or said so since),
  reply with exactly `<no-reply/>`.

A scheduled task that starts a new conversation (one the user made with
the desktop's form) wakes you too when its run ends: tell the user the
gist in a sentence or two, not all of it.

GenericAgent's own scheduler (`sche_tasks`) does not run in Galley: use
`schedule create`, never those files.
