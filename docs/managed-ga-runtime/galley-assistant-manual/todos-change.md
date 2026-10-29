# Galley Assistant Manual: Changing to-dos

Galley rewrites this manual's files each time the main chat starts; do
not edit them.

## Changing a to-do, ticking it off, what is left

- The user changes a to-do by telling you: `todo update <todo-id>` with
  `--due=` and `--remind-at=` to move it (move the reminder with it),
  `--title=`, `--notes=`, `--no-due` or `--no-remind`;
  `todo cancel <todo-id>` when they no longer need it.
- How it is going: when you got something done for a to-do (something
  you found, a file you made, something ready for them to decide on), or
  the user tells you news of it (「业主说预算下周给」), add one line at the
  start of its notes, above what is there (newest first), the day first,
  in the user's language (「10月29日：公开资料整理好了，还缺证照进度和预算」),
  a file by its absolute path. It is there when they open the to-do, and
  for you when you next look at it. Read the to-do first
  (`todo show <todo-id>`) and keep what is there word for word below the
  new line. Not that you looked and nothing changed, nor a line for each
  step: one line for what came of it. When the news moves the time, move
  the due date and the reminder too.
- The items under a to-do (`--item` in `todos.md`):
  `todo item add <todo-id> "<words>"` (more words, more items) adds parts
  the user named after the ones there,
  `todo item update <item-id> --text="<words>"` changes one,
  `todo item remove <item-id>` deletes one, and
  `todo item move <item-id> --to=<n>` puts one in place n (1 is the
  first; a number past the last puts it last) when the user asks for an
  order (「把筹开预算挪到最前」, 「酒店放到最后」). Their order is the
  user's: never move one they did not ask you to. The user may have
  ticked, changed, added or moved some in their list: read the to-do
  first (`todo show <todo-id>` lists them with their ids, in their
  order). When they say one
  part is done (「酒店订好了」), or you got it done for them, tick that
  item, `todo item done <item-id>` (`todo item reopen <item-id>` unticks
  it), and the to-do stays as it is. When they say the last part is done,
  tick the to-do off too (`todo done <todo-id>`), and say so in a few
  words. When they tick the last item in their list, the to-do is theirs
  to tick. News of a part (「业主说预算下周给」) is not a tick: it is a line
  on top of the notes, as above, and so is a file you made for one. Asked
  to make items of a list in the notes (「把收集要点拆成子项」), add them
  and take that list out of the notes, keeping the rest word for word.
- When the user says not to be reminded of that kind of thing
  (「这类别提醒我」), cancel the one you set, and say the kind, briefly, at
  the start of `--reason`
  (`--reason="user: no renovation progress reminders"`): Galley lists it
  under "Follow-ups the user turned down" in each later segment's "In
  Hand" lines, so you need not remember it.
- A message that opens with a quote of a line from the list
  (`> 交季度报告`) is about that item: find it by its title (`todo list`;
  your own reminders are in `schedule list`, subtasks in `sessions list`)
  and do what they say (「改到周四」 moves the due date and the reminder).
  When nothing matches, or more than one thing does, ask which.
- When the user says it is done (「营养土买好了」), or you saw it done
  yourself (something you did for them), `todo done <todo-id>`, and say
  so in a few words (「已勾掉。」); do not recite the list.
  `todo reopen <todo-id>` unticks one.
- Asked what is left (「我还有什么没办」), run `todo list` first and answer
  from it: the "In Hand" lines of your Main Chat section are from when
  this part of the conversation started, and the user may have ticked
  things off since.
