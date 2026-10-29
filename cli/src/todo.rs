//! `galley todo …` (main chat ticket 40): the user's to-dos, Galley's
//! notebook (ticket 39). `list` / `show` read SQLite directly, like every
//! read command; the writes go through Galley Core's socket (`todo.*`),
//! which decides them (Core's to-do functions), records the origin, and
//! broadcasts. `todo item …` (ticket 111) writes the items under a to-do
//! the same way (`todo.item_*`).

use crate::args::{TodoCmd, TodoSubitemCmd};
use crate::client::call_print;
use crate::common::emit_json;
use galley_core_lib::assistant_todo::todo_list;
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    TodoAddArgs, TodoCancelArgs, TodoDoneArgs, TodoReopenArgs, TodoSubitemAddArgs,
    TodoSubitemDoneArgs, TodoSubitemRemoveArgs, TodoSubitemReopenArgs, TodoSubitemUpdateArgs,
    TodoUpdateArgs,
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
            supervisor,
            reason,
        } => {
            call_print(TodoAddArgs {
                title,
                notes,
                due,
                remind_at,
                items,
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
        TodoCmd::Item(cmd) => item(cmd).await,
    }
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
    fn the_no_flags_send_an_empty_value() {
        assert_eq!(cleared_or(None, true), Some(String::new()));
        assert_eq!(cleared_or(None, false), None);
        assert_eq!(
            cleared_or(Some("2026-10-23".into()), false),
            Some("2026-10-23".into())
        );
    }
}
