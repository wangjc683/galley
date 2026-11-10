//! `galley todo …` (main chat ticket 40): the user's to-dos, Galley's
//! notebook (ticket 39). `list` / `show` read SQLite directly, like every
//! read command; the writes go through Galley Core's socket (`todo.*`),
//! which decides them (Core's to-do functions), records the origin, and
//! broadcasts. `todo item …` (ticket 111; `move` since ticket 112) writes
//! the items under a to-do the same way (`todo.item_*`). Since ticket 154
//! a to-do may repeat: `add` / `update` take the rule flags (`update` also
//! `--no-repeat` and `--series`), and `todo skip` skips a period.

use crate::args::{TodoCmd, TodoRepeatArgs, TodoSubitemCmd};
use crate::client::call_print;
use crate::common::emit_json;
use crate::schedule::day_list;
use galley_core_lib::api::{TodoRepeatKind, TodoRepeatRule};
use galley_core_lib::assistant_todo::todo_list;
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    TodoAddArgs, TodoCancelArgs, TodoDoneArgs, TodoReopenArgs, TodoSkipArgs, TodoSubitemAddArgs,
    TodoSubitemDoneArgs, TodoSubitemMoveArgs, TodoSubitemRemoveArgs, TodoSubitemReopenArgs,
    TodoSubitemUpdateArgs, TodoUpdateArgs,
};

pub(crate) async fn run(cmd: TodoCmd) -> Result<(), GalleyError> {
    match cmd {
        TodoCmd::List { all } => list(all).await,
        TodoCmd::Show { todo_id } => show(todo_id).await,
        TodoCmd::Add {
            title,
            notes,
            due,
            remind_at,
            items,
            repeat,
            supervisor,
            reason,
        } => {
            call_print(TodoAddArgs {
                title,
                notes,
                due,
                remind_at,
                items,
                repeat: repeat_rule(&repeat)?,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Update {
            todo_id,
            title,
            notes,
            due,
            no_due,
            remind_at,
            no_remind,
            repeat,
            no_repeat,
            series,
            supervisor,
            reason,
        } => {
            call_print(TodoUpdateArgs {
                todo_id,
                title,
                notes,
                // On the wire an empty value clears (`todo.update`).
                due: cleared_or(due, no_due),
                remind_at: cleared_or(remind_at, no_remind),
                repeat: repeat_rule(&repeat)?,
                no_repeat,
                series,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Done {
            todo_id,
            supervisor,
            reason,
        } => {
            call_print(TodoDoneArgs {
                todo_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Reopen {
            todo_id,
            supervisor,
            reason,
        } => {
            call_print(TodoReopenArgs {
                todo_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Cancel {
            todo_id,
            supervisor,
            reason,
        } => {
            call_print(TodoCancelArgs {
                todo_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Skip {
            todo_id,
            supervisor,
            reason,
        } => {
            call_print(TodoSkipArgs {
                todo_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoCmd::Item(cmd) => item(cmd).await,
    }
}

/// The rule the flags name, if any (main chat ticket 154): clap lets
/// through one kind at most and `--every` only with one; the days' and
/// `--every`'s ranges are Core's to check, as `schedule`'s are.
fn repeat_rule(flags: &TodoRepeatArgs) -> Result<Option<TodoRepeatRule>, GalleyError> {
    let (kind, weekdays, monthdays) = if flags.daily {
        (TodoRepeatKind::Daily, Vec::new(), Vec::new())
    } else if let Some(days) = &flags.weekly {
        (
            TodoRepeatKind::Weekly,
            day_list(days, "--weekly")?,
            Vec::new(),
        )
    } else if let Some(days) = &flags.monthly {
        (
            TodoRepeatKind::Monthly,
            Vec::new(),
            day_list(days, "--monthly")?,
        )
    } else if flags.yearly {
        (TodoRepeatKind::Yearly, Vec::new(), Vec::new())
    } else {
        return Ok(None);
    };
    Ok(Some(TodoRepeatRule {
        kind,
        weekdays,
        monthdays,
        every: flags.every.unwrap_or(1),
    }))
}

/// `todo item …` (main chat ticket 111): every write through Core.
async fn item(cmd: TodoSubitemCmd) -> Result<(), GalleyError> {
    match cmd {
        TodoSubitemCmd::Add {
            todo_id,
            texts,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemAddArgs {
                todo_id,
                texts,
                supervisor,
                reason,
            })
            .await
        }
        TodoSubitemCmd::Done {
            item_id,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemDoneArgs {
                item_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoSubitemCmd::Reopen {
            item_id,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemReopenArgs {
                item_id,
                supervisor,
                reason,
            })
            .await
        }
        TodoSubitemCmd::Update {
            item_id,
            text,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemUpdateArgs {
                item_id,
                text,
                supervisor,
                reason,
            })
            .await
        }
        TodoSubitemCmd::Move {
            item_id,
            to,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemMoveArgs {
                item_id,
                to,
                supervisor,
                reason,
            })
            .await
        }
        TodoSubitemCmd::Remove {
            item_id,
            supervisor,
            reason,
        } => {
            call_print(TodoSubitemRemoveArgs {
                item_id,
                supervisor,
                reason,
            })
            .await
        }
    }
}

async fn list(all: bool) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    for todo in todo_list(&galley, all).await? {
        emit_json(&todo)?;
    }
    Ok(())
}

async fn show(todo_id: String) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&galley.todo(&todo_id).await?)
}

/// `--no-due` / `--no-remind` as the wire spells them: an empty value.
fn cleared_or(value: Option<String>, clear: bool) -> Option<String> {
    if clear {
        Some(String::new())
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rule_flags_read_as_a_rule() {
        let flags =
            |daily, weekly: Option<&str>, monthly: Option<&str>, yearly, every| TodoRepeatArgs {
                daily,
                weekly: weekly.map(str::to_string),
                monthly: monthly.map(str::to_string),
                yearly,
                every,
            };
        assert_eq!(
            repeat_rule(&flags(false, None, None, false, None)).unwrap(),
            None
        );
        let daily = repeat_rule(&flags(true, None, None, false, Some(2)))
            .unwrap()
            .unwrap();
        assert_eq!((daily.kind, daily.every), (TodoRepeatKind::Daily, 2));
        let weekly = repeat_rule(&flags(false, Some("1, 4"), None, false, None))
            .unwrap()
            .unwrap();
        assert_eq!(weekly.kind, TodoRepeatKind::Weekly);
        assert_eq!((weekly.weekdays, weekly.every), (vec![1, 4], 1));
        let quarterly = repeat_rule(&flags(false, None, Some("15"), false, Some(3)))
            .unwrap()
            .unwrap();
        assert_eq!(quarterly.monthdays, [15]);
        assert_eq!(quarterly.every, 3);
        let yearly = repeat_rule(&flags(false, None, None, true, None))
            .unwrap()
            .unwrap();
        assert_eq!(yearly.kind, TodoRepeatKind::Yearly);
        assert!(repeat_rule(&flags(false, Some("mon"), None, false, None)).is_err());
    }

    #[test]
    fn the_no_flags_send_an_empty_value() {
        assert_eq!(cleared_or(None, true), Some(String::new()));
        assert_eq!(cleared_or(None, false), None);
        assert_eq!(
            cleared_or(Some("2026-10-23".into()), false),
            Some("2026-10-23".into())
        );
    }
}
