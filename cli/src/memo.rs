//! `galley memo …` (main chat ticket 95): what Galley knows about the user.
//! `list` reads SQLite directly, like every read command; the writes go
//! through Galley Core's socket (`memo.*`), which decides them (Core's
//! memo functions), records the origin and the turn, and broadcasts.

use crate::args::MemoCmd;
use crate::client::call_print;
use crate::common::emit_json;
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{MemoAddArgs, MemoDeleteArgs, MemoUpdateArgs};

pub(crate) async fn run(cmd: MemoCmd) -> Result<(), GalleyError> {
    match cmd {
        MemoCmd::List => list().await,
        MemoCmd::Add {
            text,
            until,
            supervisor,
            reason,
        } => {
            call_print(MemoAddArgs {
                text,
                until,
                supervisor,
                reason,
            })
            .await
        }
        MemoCmd::Update {
            memo_id,
            text,
            until,
            no_until,
            supervisor,
            reason,
        } => {
            call_print(MemoUpdateArgs {
                memo_id,
                text,
                // On the wire an empty value clears (`memo.update`).
                until: if no_until { Some(String::new()) } else { until },
                supervisor,
                reason,
            })
            .await
        }
        MemoCmd::Delete {
            memo_id,
            supervisor,
            reason,
        } => {
            call_print(MemoDeleteArgs {
                memo_id,
                supervisor,
                reason,
            })
            .await
        }
    }
}

async fn list() -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    for memo in galley.memos_today().await? {
        emit_json(&memo)?;
    }
    Ok(())
}
