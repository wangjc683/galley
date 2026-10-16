//! `galley schedule …` (main chat ticket 34): scheduled tasks for the
//! assistant and for any agent. `list` / `show` read SQLite directly, like
//! every read command; the writes go through Galley Core's socket
//! (`schedule.*`), which validates, records the origin, and broadcasts.

use crate::args::{RepeatArgs, ScheduleCmd, ScheduleTargetArg};
use crate::client::call_print;
use crate::common::emit_json;
use galley_core_lib::api::schedule::{ScheduleTarget, ScheduledTaskRepeat};
use galley_core_lib::db::{ScheduleListScope, SqliteGalley};
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    ScheduleCreateArgs, ScheduleDeleteArgs, ScheduleDisableArgs, ScheduleEnableArgs,
    ScheduleRunArgs, ScheduleUpdateArgs,
};

pub(crate) async fn run(cmd: ScheduleCmd) -> Result<(), GalleyError> {
    match cmd {
        ScheduleCmd::List { all } => list(all).await,
        ScheduleCmd::Show { task_id } => show(task_id).await,
        ScheduleCmd::Create {
            prompt,
            at,
            rule,
            target,
            project,
            llm,
            supervisor,
            reason,
        } => {
            let repeat = repeat_from(&rule)?;
            call_print(ScheduleCreateArgs {
                prompt,
                fire_at: at,
                repeat,
                time_of_day: rule.time,
                target: Some(target_from(target)),
                project_id: project,
                llm_name: llm,
                supervisor,
                reason,
            })
            .await
        }
        ScheduleCmd::Update {
            task_id,
            prompt,
            at,
            rule,
            target,
            project,
            llm,
            supervisor,
            reason,
        } => {
            let repeat = repeat_from(&rule)?;
            call_print(ScheduleUpdateArgs {
                task_id,
                prompt,
                fire_at: at,
                repeat,
                time_of_day: rule.time,
                target: target.map(target_from),
                project_id: project,
                llm_name: llm,
                supervisor,
                reason,
            })
            .await
        }
        ScheduleCmd::Delete {
            task_id,
            supervisor,
            reason,
        } => {
            call_print(ScheduleDeleteArgs {
                task_id,
                supervisor,
                reason,
            })
            .await
        }
        ScheduleCmd::Enable {
            task_id,
            supervisor,
            reason,
        } => {
            call_print(ScheduleEnableArgs {
                task_id,
                supervisor,
                reason,
            })
            .await
        }
        ScheduleCmd::Disable {
            task_id,
            supervisor,
            reason,
        } => {
            call_print(ScheduleDisableArgs {
                task_id,
                supervisor,
                reason,
            })
            .await
        }
        ScheduleCmd::Run {
            task_id,
            supervisor,
            reason,
        } => {
            call_print(ScheduleRunArgs {
                task_id,
                supervisor,
                reason,
            })
            .await
        }
    }
}

async fn list(all: bool) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let scope = if all {
        ScheduleListScope::All
    } else {
        ScheduleListScope::Active
    };
    for task in galley.list_scheduled_tasks_in(scope).await? {
        emit_json(&task)?;
    }
    Ok(())
}

async fn show(task_id: String) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&galley.scheduled_task(&task_id).await?)
}

fn target_from(target: ScheduleTargetArg) -> ScheduleTarget {
    match target {
        ScheduleTargetArg::Assistant => ScheduleTarget::Assistant,
        ScheduleTargetArg::Session => ScheduleTarget::Session,
    }
}

/// The repeating rule the flags name, if any. Day ranges and the time are
/// Core's to validate (the desktop form's rules).
fn repeat_from(rule: &RepeatArgs) -> Result<Option<ScheduledTaskRepeat>, GalleyError> {
    if rule.daily {
        return Ok(Some(ScheduledTaskRepeat::Daily));
    }
    if let Some(days) = &rule.weekly {
        return Ok(Some(ScheduledTaskRepeat::Weekly {
            weekdays: day_list(days, "--weekly")?,
        }));
    }
    if let Some(days) = &rule.monthly {
        return Ok(Some(ScheduledTaskRepeat::Monthly {
            monthdays: day_list(days, "--monthly")?,
        }));
    }
    Ok(None)
}

fn day_list(raw: &str, flag: &str) -> Result<Vec<u8>, GalleyError> {
    raw.split(',')
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| {
            d.parse::<u8>().map_err(|_| GalleyError::InvalidArgs {
                message: format!("{flag}: days are comma-separated numbers, got {raw:?}"),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(daily: bool, weekly: Option<&str>, monthly: Option<&str>) -> RepeatArgs {
        RepeatArgs {
            daily,
            weekly: weekly.map(str::to_string),
            monthly: monthly.map(str::to_string),
            time: Some("09:00".into()),
        }
    }

    #[test]
    fn the_rule_flags_read_as_a_repeat() {
        assert_eq!(
            repeat_from(&rule(true, None, None)).unwrap(),
            Some(ScheduledTaskRepeat::Daily)
        );
        assert_eq!(
            repeat_from(&rule(false, Some("1, 5"), None)).unwrap(),
            Some(ScheduledTaskRepeat::Weekly {
                weekdays: vec![1, 5]
            })
        );
        assert_eq!(
            repeat_from(&rule(false, None, Some("31,1"))).unwrap(),
            Some(ScheduledTaskRepeat::Monthly {
                monthdays: vec![31, 1]
            })
        );
        assert_eq!(repeat_from(&rule(false, None, None)).unwrap(), None);
        assert!(repeat_from(&rule(false, Some("mon"), None)).is_err());
    }
}
