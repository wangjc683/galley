//! Goal v2 engine (.scratch/goal-simplify/PRD.md §3.2–3.4).
//!
//! A goal is one persistent objective on one session. This module is
//! the whole runtime behind it:
//!
//! - [`GoalEngine::start`] persists the goal and the visible objective
//!   row, then dispatches the wrapped objective as the opening turn.
//! - [`GoalEngine::on_run_settled`] is called by the queue drain task
//!   whenever a `RunComplete` leaves the session truly idle (no queued
//!   user message, no ask_user hold). It reads the settled run's
//!   [`RunOutcome`] and applies [`judge`]: abort → paused, error →
//!   blocked, the model's `<goal-status>` tag → completed / blocked,
//!   time ceiling → one wrap-up turn then budget_limited, otherwise the
//!   next continuation.
//! - [`GoalEngine::stop`] is terminal `stopped` plus an abort of the
//!   in-flight run; [`GoalEngine::on_runner_closed`] parks an active
//!   goal as paused when its bridge process dies.
//!
//! Resume needs no separate entry point: a paused / blocked goal turns
//! active again when the session's next user-initiated run settles —
//! the user's message IS the intervention.
//!
//! Every dispatch goes through the same run gate as user messages
//! (`try_reserve_run`), so a user message that lands first always wins
//! and the continuation is simply re-evaluated when that run settles.

use std::time::Duration;

use crate::api::{
    CreateGoalInput, GalleyApi, GoalBrief, GoalId, GoalStatus, MessageBrief, MessageVisibility,
    Origin, OriginVia, SessionId,
};
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::goal_prompts;
use crate::ipc::{IpcCommand, UserMessageCommand};
use crate::runner_manager::RunOutcome;
use crate::socket_listener::{ensure_runner_for_session, HandlerCtx};
use serde::Serialize;

/// Tauri / socket event fired on every goal state change, payload
/// [`GoalUpdatedPayload`]. The GUI applies it to its goal list directly;
/// its 5-second poll stays only as a fallback.
pub const GOAL_UPDATED_EVENT: &str = "goal-updated";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalUpdatedPayload {
    pub goal: GoalBrief,
}

/// Wire twin of the socket layer's `user-message-persisted` payload —
/// the objective row is announced the same way a CLI send is, so the
/// GUI mirrors it whether the goal was started from the Composer or
/// from `galley goal start`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserMessagePersistedPayload {
    session_id: String,
    message: MessageBrief,
    dispatch: &'static str,
}

/// Result of [`GoalEngine::start`].
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalStartResult {
    pub goal: GoalBrief,
    /// The persisted, visible objective row (stamped with the goal id).
    pub message: MessageBrief,
    /// `dispatched` — the opening turn reached the runner. A dispatch
    /// failure is an error, never a half-started goal (the goal row is
    /// then `failed` with the reason in `latestSummary`).
    pub dispatch: &'static str,
}

/// What [`judge`] tells the engine to do with a settled run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Goal not open (or a stale continuation settled on a parked goal).
    Ignore,
    /// Move the goal to a new status; `Some` summary replaces the stored one.
    Transition(GoalStatus, Option<String>),
    /// Dispatch a normal continuation.
    Continue,
    /// Time ceiling reached: dispatch the single wrap-up turn.
    WrapUp,
}

/// Pure judgment of a settled run against the goal's state (PRD §3.3
/// order). `elapsed` is the goal's wall-clock age; `now` is only there
/// so tests can pin it.
pub fn judge(goal: &GoalBrief, outcome: &RunOutcome, elapsed: Duration) -> Decision {
    if goal.status != GoalStatus::Active {
        return Decision::Ignore;
    }
    if outcome.aborted {
        return Decision::Transition(GoalStatus::Paused, None);
    }
    if let Some(err) = &outcome.errored {
        return Decision::Transition(GoalStatus::Blocked, Some(truncate_summary(err)));
    }
    match outcome.goal_tag.as_deref() {
        Some("complete") => {
            return Decision::Transition(GoalStatus::Completed, outcome.summary.clone());
        }
        Some("blocked") => {
            return Decision::Transition(GoalStatus::Blocked, outcome.summary.clone());
        }
        _ => {}
    }
    let over_budget = goal
        .budget_seconds
        .is_some_and(|b| elapsed >= Duration::from_secs(u64::from(b)));
    if over_budget {
        if goal.wrap_up_dispatched {
            return Decision::Transition(GoalStatus::BudgetLimited, outcome.summary.clone());
        }
        return Decision::WrapUp;
    }
    Decision::Continue
}

fn truncate_summary(text: &str) -> String {
    let compact: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(200).collect()
}

fn remaining(goal: &GoalBrief) -> Option<Duration> {
    goal.budget_seconds
        .map(|b| Duration::from_secs(u64::from(b).saturating_sub(goal.elapsed_seconds)))
}

fn continuation_origin(reason: String) -> Origin {
    Origin {
        via: OriginVia::System,
        supervisor: None,
        reason: Some(reason),
    }
}

pub struct GoalEngine<'a> {
    pub galley: &'a SqliteGalley,
    pub ctx: &'a HandlerCtx<'a>,
}

impl GoalEngine<'_> {
    /// Set a goal on `session_id` and dispatch its opening turn.
    ///
    /// Errors: `not_found` (session), `invalid_args` (blank objective,
    /// the session already has an open goal, or the session is mid-run
    /// — start it again once the run settles; the GUI disables the
    /// entry while a run is open, so only CLI callers see this), and
    /// `runner_error` when the opening turn could not be dispatched (the
    /// goal is then recorded `failed`).
    pub async fn start(
        &self,
        session_id: SessionId,
        objective: String,
        budget_seconds: Option<u32>,
        origin: Origin,
    ) -> Result<GoalStartResult, GalleyError> {
        self.galley.assert_session_writable(&session_id).await?;
        if !self.ctx.runner.try_reserve_run(session_id.as_str()).await {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "session {} is mid-run; wait for the current run to settle \
                     (`galley session wait`) and start the goal again",
                    session_id
                ),
            });
        }
        let goal = match self
            .galley
            .create_goal(
                CreateGoalInput {
                    session_id: session_id.clone(),
                    objective: objective.clone(),
                    budget_seconds,
                },
                origin.clone(),
            )
            .await
        {
            Ok(g) => g,
            Err(e) => {
                self.ctx.runner.queue_release_run(session_id.as_str()).await;
                return Err(e);
            }
        };
        self.notify_goal(&goal);

        // The objective is the user's own words → a visible user row,
        // stamped with the goal id so the GUI brackets the episode by
        // exact id. What the model receives is the wrapped prompt, on
        // the same turn index (the row is the objective's home, the
        // wrapper is dispatch-only — same split `session.goal_synthesize`
        // used).
        let message = match self
            .galley
            .send_message_for_goal(
                session_id.clone(),
                goal.objective.clone(),
                origin,
                goal.id.clone(),
            )
            .await
        {
            Ok(m) => m,
            Err(e) => {
                self.ctx.runner.queue_release_run(session_id.as_str()).await;
                let _ = self
                    .galley
                    .update_goal_status(goal.id.clone(), GoalStatus::Failed, Some(e.to_string()))
                    .await;
                return Err(e);
            }
        };
        let text = goal_prompts::objective_prompt(&goal.objective, remaining(&goal));
        if let Err(reason) = self
            .dispatch_reserved(session_id.as_str(), text, message.turn_index.map(i64::from))
            .await
        {
            let failed = self
                .galley
                .update_goal_status(goal.id.clone(), GoalStatus::Failed, Some(reason.clone()))
                .await
                .unwrap_or(goal);
            self.notify_goal(&failed);
            self.notify_message(session_id.as_str(), message, "persisted_only");
            return Err(GalleyError::RunnerError { message: reason });
        }
        self.notify_message(session_id.as_str(), message.clone(), "dispatched");
        Ok(GoalStartResult {
            goal,
            message,
            dispatch: "dispatched",
        })
    }

    /// Terminal `stopped`, then abort whatever the session is running.
    /// Idempotent on an already-terminal goal.
    pub async fn stop(&self, goal_id: GoalId) -> Result<GoalBrief, GalleyError> {
        let goal = self.galley.get_goal(goal_id.clone()).await?;
        if goal.status.is_terminal() {
            return Ok(goal);
        }
        let stopped = self
            .galley
            .update_goal_status(goal_id, GoalStatus::Stopped, None)
            .await?;
        self.notify_goal(&stopped);
        let sid = stopped.session_id.as_str();
        if self.ctx.runner.run_state(sid).await.open_run {
            // Best effort: a dead runner means nothing is running anyway.
            let _ = self.ctx.runner.send_command(sid, &IpcCommand::Abort).await;
        }
        Ok(stopped)
    }

    /// Give the goal more time. A `budget_limited` goal reopens and, the
    /// session being idle (its wrap-up already settled), gets its next
    /// continuation dispatched right here; an `active` goal just gets a
    /// higher ceiling. A lost gate race (the user is typing into the
    /// session) is silent — the goal is active again and the loop picks
    /// it up when that run settles.
    pub async fn extend(
        &self,
        goal_id: GoalId,
        extra_seconds: u32,
    ) -> Result<GoalBrief, GalleyError> {
        let before = self.galley.get_goal(goal_id.clone()).await?;
        let goal = self
            .galley
            .extend_goal_budget(goal_id, extra_seconds)
            .await?;
        self.notify_goal(&goal);
        if before.status == GoalStatus::BudgetLimited {
            let text = goal_prompts::continuation_prompt(
                &goal.objective,
                goal.continuation_count + 1,
                remaining(&goal),
            );
            self.dispatch_continuation(&goal, text, false).await;
        }
        Ok(goal)
    }

    /// The session's run settled and nothing else claimed the idle slot.
    pub async fn on_run_settled(&self, session_id: &str) {
        let outcome = self
            .ctx
            .runner
            .take_run_outcome(session_id)
            .await
            .unwrap_or_default();
        let Some(mut goal) = self.open_goal(session_id).await else {
            return;
        };
        // A user turn on a paused / blocked goal is the intervention
        // that resumes it; a stale continuation settling there is not.
        if goal.status != GoalStatus::Active {
            if outcome.continuation {
                return;
            }
            goal = match self
                .galley
                .update_goal_status(goal.id.clone(), GoalStatus::Active, None)
                .await
            {
                Ok(g) => g,
                Err(e) => {
                    eprintln!("[goal {}] resume failed: {e}", goal.id);
                    return;
                }
            };
            self.notify_goal(&goal);
        }
        match judge(&goal, &outcome, Duration::from_secs(goal.elapsed_seconds)) {
            Decision::Ignore => {}
            Decision::Transition(status, summary) => {
                self.transition(&goal, status, summary).await;
            }
            Decision::Continue => {
                let text = goal_prompts::continuation_prompt(
                    &goal.objective,
                    goal.continuation_count + 1,
                    remaining(&goal),
                );
                self.dispatch_continuation(&goal, text, false).await;
            }
            Decision::WrapUp => {
                let text = goal_prompts::budget_limit_prompt(
                    &goal.objective,
                    Duration::from_secs(goal.elapsed_seconds),
                );
                self.dispatch_continuation(&goal, text, true).await;
            }
        }
    }

    /// A user-initiated run just started on the session. A paused /
    /// blocked goal resumes right here — the user's message is the
    /// intervention — so the pill and the thread read `active` for the
    /// whole run instead of flipping only when it settles.
    /// `on_run_settled` keeps the same resume as a fallback for a run
    /// whose start the forwarder never saw.
    pub async fn on_user_run_started(&self, session_id: &str) {
        let Some(goal) = self.open_goal(session_id).await else {
            return;
        };
        if goal.status == GoalStatus::Active {
            return;
        }
        self.transition(&goal, GoalStatus::Active, None).await;
    }

    /// The session's bridge process closed. An active goal cannot be
    /// driven by a dead runner; park it as paused so the state is honest
    /// and the user's next message brings it back.
    pub async fn on_runner_closed(&self, session_id: &str) {
        let Some(goal) = self.open_goal(session_id).await else {
            return;
        };
        if goal.status == GoalStatus::Active {
            self.transition(&goal, GoalStatus::Paused, None).await;
        }
    }

    async fn open_goal(&self, session_id: &str) -> Option<GoalBrief> {
        match self
            .galley
            .list_goals_for_session(SessionId(session_id.to_string()))
            .await
        {
            Ok(goals) => goals.into_iter().find(|g| g.status.is_open()),
            Err(e) => {
                eprintln!("[goal] list goals for {session_id} failed: {e}");
                None
            }
        }
    }

    async fn transition(&self, goal: &GoalBrief, status: GoalStatus, summary: Option<String>) {
        match self
            .galley
            .update_goal_status(goal.id.clone(), status, summary)
            .await
        {
            Ok(updated) => self.notify_goal(&updated),
            Err(e) => eprintln!("[goal {}] transition to {status:?} failed: {e}", goal.id),
        }
    }

    /// Reserve the gate, persist the internal continuation row, make
    /// sure the runner is up, dispatch. A lost gate race (a user message
    /// slipped in) is silent: the goal is re-judged when that run
    /// settles. Any real failure lands the goal in `failed`.
    async fn dispatch_continuation(&self, goal: &GoalBrief, text: String, wrap_up: bool) {
        let sid = goal.session_id.as_str();
        if !self.ctx.runner.try_reserve_run(sid).await {
            return;
        }
        let reason = if wrap_up {
            format!("goal {} budget wrap-up", goal.id)
        } else {
            format!(
                "goal {} continuation #{}",
                goal.id,
                goal.continuation_count + 1
            )
        };
        let brief = match self
            .galley
            .send_message_with_visibility(
                goal.session_id.clone(),
                text.clone(),
                continuation_origin(reason),
                MessageVisibility::Internal,
            )
            .await
        {
            Ok(b) => b,
            Err(e) => {
                self.ctx.runner.queue_release_run(sid).await;
                self.transition(goal, GoalStatus::Failed, Some(e.to_string()))
                    .await;
                return;
            }
        };
        // Stamp the run kind BEFORE the send: the bridge's first
        // `TurnStart` can reach the forwarder before this task gets back
        // from `send_command`, and it must not read as a user run. A
        // failed send releases the gate and the next real dispatch
        // re-stamps `UserTurn` on its own.
        self.ctx.runner.mark_goal_continuation(sid).await;
        if let Err(reason) = self
            .dispatch_reserved(sid, text, brief.turn_index.map(i64::from))
            .await
        {
            self.transition(goal, GoalStatus::Failed, Some(reason))
                .await;
            return;
        }
        match self
            .galley
            .bump_goal_continuation(goal.id.clone(), wrap_up)
            .await
        {
            Ok(updated) => self.notify_goal(&updated),
            Err(e) => eprintln!("[goal {}] bump continuation failed: {e}", goal.id),
        }
    }

    /// Ensure a runner and send the turn. The caller holds the run-gate
    /// reservation; on failure it is released here.
    async fn dispatch_reserved(
        &self,
        session_id: &str,
        text: String,
        absolute_turn_index: Option<i64>,
    ) -> Result<(), String> {
        if let Err(e) = ensure_runner_for_session(self.ctx, self.galley, session_id, "goal").await {
            self.ctx.runner.queue_release_run(session_id).await;
            return Err(format!("runner spawn: {e}"));
        }
        if let Err(e) = self
            .ctx
            .runner
            .send_command(
                session_id,
                &IpcCommand::UserMessage(UserMessageCommand {
                    text,
                    images: vec![],
                    visibility: None,
                    absolute_turn_index,
                }),
            )
            .await
        {
            self.ctx.runner.queue_release_run(session_id).await;
            return Err(format!("runner dispatch: {e}"));
        }
        Ok(())
    }

    fn notify_goal(&self, goal: &GoalBrief) {
        self.ctx.notify(
            GOAL_UPDATED_EVENT,
            &GoalUpdatedPayload { goal: goal.clone() },
        );
    }

    fn notify_message(&self, session_id: &str, message: MessageBrief, dispatch: &'static str) {
        self.ctx.notify(
            "user-message-persisted",
            &UserMessagePersistedPayload {
                session_id: session_id.to_string(),
                message,
                dispatch,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goal(status: GoalStatus, budget: Option<u32>, wrap_up: bool) -> GoalBrief {
        GoalBrief {
            id: GoalId("g".into()),
            session_id: SessionId("s".into()),
            objective: "o".into(),
            status,
            budget_seconds: budget,
            started_at: "2026-09-16T00:00:00+00:00".into(),
            ended_at: None,
            paused_at: None,
            latest_summary: None,
            result_seen_at: None,
            continuation_count: 0,
            wrap_up_dispatched: wrap_up,
            elapsed_seconds: 0,
            created_at: "2026-09-16T00:00:00+00:00".into(),
            updated_at: "2026-09-16T00:00:00+00:00".into(),
            origin: None,
        }
    }

    fn outcome() -> RunOutcome {
        RunOutcome::default()
    }

    #[test]
    fn judge_follows_the_prd_order() {
        let g = goal(GoalStatus::Active, Some(600), false);
        let z = Duration::ZERO;

        assert_eq!(judge(&g, &outcome(), z), Decision::Continue);

        let aborted = RunOutcome {
            aborted: true,
            goal_tag: Some("complete".into()),
            ..outcome()
        };
        assert_eq!(
            judge(&g, &aborted, z),
            Decision::Transition(GoalStatus::Paused, None),
            "abort outranks the tag"
        );

        let errored = RunOutcome {
            errored: Some("LLM   exploded\nbadly".into()),
            goal_tag: Some("complete".into()),
            ..outcome()
        };
        assert_eq!(
            judge(&g, &errored, z),
            Decision::Transition(GoalStatus::Blocked, Some("LLM exploded badly".into())),
            "error outranks the tag and is compacted"
        );

        let done = RunOutcome {
            goal_tag: Some("complete".into()),
            summary: Some("shipped".into()),
            ..outcome()
        };
        assert_eq!(
            judge(&g, &done, Duration::from_secs(10_000)),
            Decision::Transition(GoalStatus::Completed, Some("shipped".into())),
            "the tag outranks the budget"
        );

        let blocked = RunOutcome {
            goal_tag: Some("blocked".into()),
            summary: Some("need key".into()),
            ..outcome()
        };
        assert_eq!(
            judge(&g, &blocked, z),
            Decision::Transition(GoalStatus::Blocked, Some("need key".into()))
        );

        let unknown_tag = RunOutcome {
            goal_tag: Some("done".into()),
            ..outcome()
        };
        assert_eq!(judge(&g, &unknown_tag, z), Decision::Continue);
    }

    #[test]
    fn budget_ceiling_wraps_up_once_then_limits() {
        let over = Duration::from_secs(601);
        let g = goal(GoalStatus::Active, Some(600), false);
        assert_eq!(judge(&g, &outcome(), over), Decision::WrapUp);
        let g = goal(GoalStatus::Active, Some(600), true);
        assert_eq!(
            judge(&g, &outcome(), over),
            Decision::Transition(GoalStatus::BudgetLimited, None)
        );
        // Exactly at the ceiling counts as reached; no ceiling never does.
        let g = goal(GoalStatus::Active, Some(600), false);
        assert_eq!(
            judge(&g, &outcome(), Duration::from_secs(600)),
            Decision::WrapUp
        );
        let g = goal(GoalStatus::Active, None, false);
        assert_eq!(
            judge(&g, &outcome(), Duration::from_secs(1 << 30)),
            Decision::Continue
        );
    }

    #[test]
    fn non_active_goals_are_ignored_by_judge() {
        for status in [
            GoalStatus::Paused,
            GoalStatus::Blocked,
            GoalStatus::Completed,
            GoalStatus::Stopped,
        ] {
            let g = goal(status, None, false);
            assert_eq!(judge(&g, &outcome(), Duration::ZERO), Decision::Ignore);
        }
    }

    // ---------------- engine flow against an in-memory DB + fake runner ----------------

    use crate::notify::NullNotifier;
    use crate::runner_manager::{
        BroadcastItem, QueueJump, QueueOffer, RunState, RunnerSpawnError, SendCommandError,
        ShutdownError, SpawnArgs,
    };
    use crate::socket_listener::{DbSource, RunnerPort};
    use async_trait::async_trait;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Minimal RunnerPort: a live pid (so no spawn is attempted), a
    /// scripted reserve answer, a queue of outcomes to hand back, and a
    /// log of everything sent.
    struct FakeRunner {
        reserve: bool,
        send_ok: bool,
        open_run: bool,
        outcomes: Mutex<VecDeque<RunOutcome>>,
        sent: Mutex<Vec<IpcCommand>>,
        marked: Mutex<Vec<String>>,
        released: Mutex<Vec<String>>,
    }

    impl FakeRunner {
        fn idle() -> Self {
            Self {
                reserve: true,
                send_ok: true,
                open_run: false,
                outcomes: Mutex::new(VecDeque::new()),
                sent: Mutex::new(Vec::new()),
                marked: Mutex::new(Vec::new()),
                released: Mutex::new(Vec::new()),
            }
        }
        fn push_outcome(&self, o: RunOutcome) {
            self.outcomes.lock().unwrap().push_back(o);
        }
        fn sent_texts(&self) -> Vec<String> {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .filter_map(|c| match c {
                    IpcCommand::UserMessage(m) => Some(m.text.clone()),
                    _ => None,
                })
                .collect()
        }
        fn abort_count(&self) -> usize {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .filter(|c| matches!(c, IpcCommand::Abort))
                .count()
        }
    }

    #[async_trait]
    impl RunnerPort for FakeRunner {
        async fn spawn(&self, _: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
            panic!("fake runner is always alive; spawn must not be attempted")
        }
        async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
            if self.send_ok {
                self.sent.lock().unwrap().push(cmd.clone());
                Ok(())
            } else {
                Err(SendCommandError::ProcessGone {
                    session_id: sid.to_string(),
                })
            }
        }
        async fn subscribe(
            &self,
            _: &str,
        ) -> Option<tokio::sync::broadcast::Receiver<BroadcastItem>> {
            None
        }
        async fn pid(&self, _: &str) -> Option<u32> {
            Some(4242)
        }
        async fn agent_running(&self, _: &str) -> bool {
            false
        }
        async fn shutdown(&self, _: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
            Ok(())
        }
        async fn queue_offer(&self, _: &str, _: String, _: Option<Origin>) -> QueueOffer {
            QueueOffer::DispatchNow
        }
        async fn queue_release_run(&self, sid: &str) {
            self.released.lock().unwrap().push(sid.to_string());
        }
        async fn queue_jump(&self, _: &str, _: &str) -> QueueJump {
            QueueJump::NotFound
        }
        async fn try_reserve_run(&self, _: &str) -> bool {
            self.reserve
        }
        async fn run_state(&self, _: &str) -> RunState {
            RunState {
                runner_alive: true,
                agent_running: self.open_run,
                open_run: self.open_run,
                queued_count: 0,
            }
        }
        async fn mark_goal_continuation(&self, sid: &str) {
            self.marked.lock().unwrap().push(sid.to_string());
        }
        async fn take_run_outcome(&self, _: &str) -> Option<RunOutcome> {
            self.outcomes.lock().unwrap().pop_front()
        }
    }

    async fn fresh_galley() -> SqliteGalley {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        for m in crate::db_migrations::all() {
            sqlx::raw_sql(m.sql)
                .execute(&pool)
                .await
                .expect("migration");
        }
        sqlx::query(
            "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
                error_count, pinned, last_activity_at, created_at, updated_at) \
             VALUES ('s1', 'goal session', 'idle', 0, 0, 0, 0, \
                '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed session");
        SqliteGalley::from_pool(pool)
    }

    struct Harness {
        galley: SqliteGalley,
        db: DbSource,
        runner: FakeRunner,
    }

    impl Harness {
        async fn new(runner: FakeRunner) -> Self {
            let galley = fresh_galley().await;
            Self {
                db: DbSource::Pool(galley.clone()),
                galley,
                runner,
            }
        }
        fn ctx(&self) -> HandlerCtx<'_> {
            HandlerCtx {
                db: &self.db,
                runner: &self.runner,
                notifier: NullNotifier::arc(),
                app: None,
            }
        }
        async fn start(&self, budget: Option<u32>) -> GoalStartResult {
            let ctx = self.ctx();
            GoalEngine {
                galley: &self.galley,
                ctx: &ctx,
            }
            .start(
                SessionId("s1".into()),
                "Ship the thing".into(),
                budget,
                Origin::gui(),
            )
            .await
            .expect("start goal")
        }
        async fn settle(&self) {
            let ctx = self.ctx();
            GoalEngine {
                galley: &self.galley,
                ctx: &ctx,
            }
            .on_run_settled("s1")
            .await;
        }
        async fn goal(&self, id: &GoalId) -> GoalBrief {
            self.galley.get_goal(id.clone()).await.expect("goal")
        }
        async fn internal_rows(&self) -> usize {
            self.galley
                .session_messages_including_internal(SessionId("s1".into()), None)
                .await
                .expect("rows")
                .iter()
                .filter(|m| m.visibility == Some(MessageVisibility::Internal))
                .count()
        }
    }

    #[tokio::test]
    async fn start_persists_objective_row_and_dispatches_the_wrapped_prompt() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(Some(600)).await;
        assert_eq!(started.dispatch, "dispatched");
        assert_eq!(started.goal.status, GoalStatus::Active);
        assert_eq!(
            started.message.goal_id.as_deref(),
            Some(started.goal.id.as_str())
        );
        assert_eq!(started.message.content, "Ship the thing");
        let sent = h.runner.sent_texts();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].contains("<objective>\nShip the thing\n</objective>"));
        assert!(sent[0].contains("starting a Galley Goal"));
        assert_eq!(
            h.internal_rows().await,
            0,
            "the opening turn rides the visible row"
        );
        assert!(h.runner.marked.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn start_on_a_busy_session_is_invalid_args_and_leaves_no_goal() {
        let mut runner = FakeRunner::idle();
        runner.reserve = false;
        let h = Harness::new(runner).await;
        let ctx = h.ctx();
        let err = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .start(SessionId("s1".into()), "o".into(), None, Origin::gui())
        .await
        .expect_err("busy");
        assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
        assert!(h.galley.list_active_goals().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn start_dispatch_failure_records_failed_and_releases_the_gate() {
        let mut runner = FakeRunner::idle();
        runner.send_ok = false;
        let h = Harness::new(runner).await;
        let ctx = h.ctx();
        let err = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .start(SessionId("s1".into()), "o".into(), None, Origin::gui())
        .await
        .expect_err("dispatch fails");
        assert!(matches!(err, GalleyError::RunnerError { .. }), "{err:?}");
        let goals = h
            .galley
            .list_goals_for_session(SessionId("s1".into()))
            .await
            .unwrap();
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].status, GoalStatus::Failed);
        assert!(goals[0]
            .latest_summary
            .as_deref()
            .unwrap_or("")
            .contains("dispatch"));
        assert_eq!(h.runner.released.lock().unwrap().as_slice(), ["s1"]);
    }

    #[tokio::test]
    async fn settled_runs_continue_until_the_model_completes() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;

        // Opening turn settled with no tag → continuation #1, internal row.
        h.runner.push_outcome(RunOutcome::default());
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Active);
        assert_eq!(g.continuation_count, 1);
        assert_eq!(h.internal_rows().await, 1);
        assert_eq!(h.runner.marked.lock().unwrap().as_slice(), ["s1"]);
        let sent = h.runner.sent_texts();
        assert_eq!(sent.len(), 2);
        assert!(sent[1].contains("continuation #1"));

        // Continuation settled with the complete tag → completed, summary kept.
        h.runner.push_outcome(RunOutcome {
            goal_tag: Some("complete".into()),
            summary: Some("all three files renamed".into()),
            continuation: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Completed);
        assert_eq!(g.latest_summary.as_deref(), Some("all three files renamed"));
        assert!(g.ended_at.is_some());
        assert_eq!(
            h.runner.sent_texts().len(),
            2,
            "nothing dispatched after completion"
        );

        // Further settles on the same session are inert.
        h.runner.push_outcome(RunOutcome::default());
        h.settle().await;
        assert_eq!(h.runner.sent_texts().len(), 2);
    }

    #[tokio::test]
    async fn abort_pauses_and_a_user_turn_resumes_but_a_stale_continuation_does_not() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;

        h.runner.push_outcome(RunOutcome {
            aborted: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Paused);
        assert!(g.paused_at.is_some());
        assert_eq!(h.runner.sent_texts().len(), 1);

        // A continuation that was in flight when we paused settles: ignored.
        h.runner.push_outcome(RunOutcome {
            continuation: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        assert_eq!(h.goal(&started.goal.id).await.status, GoalStatus::Paused);
        assert_eq!(h.runner.sent_texts().len(), 1);

        // The user's own turn settles: active again and the loop resumes.
        h.runner.push_outcome(RunOutcome::default());
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Active);
        assert!(g.paused_at.is_none());
        assert_eq!(g.continuation_count, 1);
        assert_eq!(h.runner.sent_texts().len(), 2);
    }

    #[tokio::test]
    async fn a_fatal_error_blocks_and_the_users_next_turn_can_carry_a_completion() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;
        h.runner.push_outcome(RunOutcome {
            errored: Some("LLM 401 unauthorized".into()),
            ..RunOutcome::default()
        });
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Blocked);
        assert_eq!(g.latest_summary.as_deref(), Some("LLM 401 unauthorized"));

        h.runner.push_outcome(RunOutcome {
            goal_tag: Some("complete".into()),
            summary: Some("fixed the key and finished".into()),
            ..RunOutcome::default()
        });
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Completed);
        assert_eq!(
            g.latest_summary.as_deref(),
            Some("fixed the key and finished")
        );
    }

    #[tokio::test]
    async fn budget_ceiling_dispatches_one_wrap_up_then_lands_budget_limited() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(Some(60)).await;
        // Backdate the start so the ceiling is already behind us.
        sqlx::query("UPDATE goals SET started_at = '2020-01-01T00:00:00+00:00' WHERE id = ?")
            .bind(started.goal.id.as_str())
            .execute(h.galley.pool())
            .await
            .unwrap();

        h.runner.push_outcome(RunOutcome::default());
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Active);
        assert!(g.wrap_up_dispatched);
        let sent = h.runner.sent_texts();
        assert_eq!(sent.len(), 2);
        assert!(sent[1].contains("reached its time budget"));

        h.runner.push_outcome(RunOutcome {
            summary: Some("delivered what exists".into()),
            continuation: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::BudgetLimited);
        assert_eq!(g.latest_summary.as_deref(), Some("delivered what exists"));
        assert_eq!(h.runner.sent_texts().len(), 2);
    }

    #[tokio::test]
    async fn lost_gate_race_skips_the_continuation_silently() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;
        // Flip the fake to "busy" after the start reserved its gate.
        let mut runner = FakeRunner::idle();
        runner.reserve = false;
        let h2 = Harness {
            galley: h.galley.clone(),
            db: DbSource::Pool(h.galley.clone()),
            runner,
        };
        h2.runner.push_outcome(RunOutcome::default());
        h2.settle().await;
        let g = h2.goal(&started.goal.id).await;
        assert_eq!(g.status, GoalStatus::Active);
        assert_eq!(g.continuation_count, 0);
        assert!(h2.runner.sent_texts().is_empty());
    }

    #[tokio::test]
    async fn stop_marks_stopped_and_aborts_an_open_run() {
        let mut runner = FakeRunner::idle();
        runner.open_run = true;
        let h = Harness::new(runner).await;
        let started = h.start(None).await;
        let ctx = h.ctx();
        let stopped = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .stop(started.goal.id.clone())
        .await
        .expect("stop");
        assert_eq!(stopped.status, GoalStatus::Stopped);
        assert_eq!(h.runner.abort_count(), 1);
        // Idempotent and inert once terminal.
        let again = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .stop(started.goal.id.clone())
        .await
        .expect("stop again");
        assert_eq!(again.status, GoalStatus::Stopped);
        assert_eq!(h.runner.abort_count(), 1);
        // The abort's own settle changes nothing.
        h.runner.push_outcome(RunOutcome {
            aborted: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        assert_eq!(h.goal(&started.goal.id).await.status, GoalStatus::Stopped);
    }

    #[tokio::test]
    async fn a_user_run_starting_resumes_a_parked_goal_immediately() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;
        h.runner.push_outcome(RunOutcome {
            aborted: true,
            ..RunOutcome::default()
        });
        h.settle().await;
        assert_eq!(h.goal(&started.goal.id).await.status, GoalStatus::Paused);

        let ctx = h.ctx();
        GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .on_user_run_started("s1")
        .await;
        let g = h.goal(&started.goal.id).await;
        assert_eq!(
            g.status,
            GoalStatus::Active,
            "resumed at run start, not at settle"
        );
        assert!(g.paused_at.is_none());
        assert_eq!(
            h.runner.sent_texts().len(),
            1,
            "no continuation while the user's run is open"
        );

        // Idempotent on an already-active goal.
        GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .on_user_run_started("s1")
        .await;
        assert_eq!(h.goal(&started.goal.id).await.status, GoalStatus::Active);
    }

    #[tokio::test]
    async fn extend_reopens_a_budget_limited_goal_and_continues() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(Some(60)).await;
        sqlx::query("UPDATE goals SET started_at = '2020-01-01T00:00:00+00:00' WHERE id = ?")
            .bind(started.goal.id.as_str())
            .execute(h.galley.pool())
            .await
            .unwrap();
        h.runner.push_outcome(RunOutcome::default());
        h.settle().await; // wrap-up dispatched
        h.runner.push_outcome(RunOutcome {
            continuation: true,
            summary: Some("partial".into()),
            ..RunOutcome::default()
        });
        h.settle().await;
        assert_eq!(
            h.goal(&started.goal.id).await.status,
            GoalStatus::BudgetLimited
        );
        assert_eq!(h.runner.sent_texts().len(), 2);

        let ctx = h.ctx();
        let extended = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .extend(started.goal.id.clone(), 1800)
        .await
        .expect("extend");
        assert_eq!(extended.status, GoalStatus::Active);
        // The ceiling had long passed: the extra counts from now.
        let budget = u64::from(extended.budget_seconds.expect("ceiling"));
        assert!(
            budget >= extended.elapsed_seconds + 1795,
            "{budget} vs {}",
            extended.elapsed_seconds
        );
        assert!(budget <= extended.elapsed_seconds + 1805);
        assert!(extended.ended_at.is_none());
        assert!(!extended.wrap_up_dispatched);
        let sent = h.runner.sent_texts();
        assert_eq!(sent.len(), 3, "reopening dispatches the next continuation");
        assert!(sent[2].contains("continuation #2"), "{}", sent[2]);
        assert!(sent[2].contains("about 30 minutes"), "{}", sent[2]);
        assert_eq!(h.goal(&started.goal.id).await.continuation_count, 2);
    }

    #[tokio::test]
    async fn extend_on_an_active_goal_only_raises_the_ceiling() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(Some(600)).await;
        let ctx = h.ctx();
        let engine = GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        };
        let extended = engine
            .extend(started.goal.id.clone(), 600)
            .await
            .expect("extend");
        assert_eq!(extended.status, GoalStatus::Active);
        assert_eq!(extended.budget_seconds, Some(1200));
        assert_eq!(
            h.runner.sent_texts().len(),
            1,
            "no extra dispatch while active"
        );

        // No ceiling, or a terminal status other than budget_limited: refused.
        let other = h
            .galley
            .list_goals_for_session(SessionId("s1".into()))
            .await
            .unwrap();
        assert_eq!(other.len(), 1);
        h.galley
            .update_goal_status(started.goal.id.clone(), GoalStatus::Stopped, None)
            .await
            .unwrap();
        let err = engine
            .extend(started.goal.id.clone(), 600)
            .await
            .expect_err("stopped");
        assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
        let open_ended = h
            .galley
            .create_goal(
                CreateGoalInput {
                    session_id: SessionId("s1".into()),
                    objective: "o".into(),
                    budget_seconds: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        let err = engine
            .extend(open_ended.id, 600)
            .await
            .expect_err("no ceiling");
        assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    }

    #[tokio::test]
    async fn runner_close_parks_an_active_goal_as_paused() {
        let h = Harness::new(FakeRunner::idle()).await;
        let started = h.start(None).await;
        let ctx = h.ctx();
        GoalEngine {
            galley: &h.galley,
            ctx: &ctx,
        }
        .on_runner_closed("s1")
        .await;
        assert_eq!(h.goal(&started.goal.id).await.status, GoalStatus::Paused);
    }

    #[test]
    fn remaining_is_budget_minus_elapsed_floored_at_zero() {
        let mut g = goal(GoalStatus::Active, Some(120), false);
        g.elapsed_seconds = 30;
        assert_eq!(remaining(&g), Some(Duration::from_secs(90)));
        g.elapsed_seconds = 500;
        assert_eq!(remaining(&g), Some(Duration::ZERO));
        g.budget_seconds = None;
        assert_eq!(remaining(&g), None);
    }
}
