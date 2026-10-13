//! Paging a session's visible transcript backwards at whole turns
//! (`SqliteGalley::persisted_message_turns_page`, main-chat ticket 12 —
//! the desktop conversation): a turn's rows stay on one page, the main
//! chat's greeting (turn -1) is a turn of its own, a page never starts
//! inside a run (multi-step, `ask_user`-continued, continued by internal
//! user rows), `has_more`, the previous user message's send time, and the
//! empty session.

use galley_core_lib::api::{CreateSessionInput, GalleyApi, Origin, RuntimeKind, SessionId};
use galley_core_lib::db::{PersistedMessageRow, PersistedTurnPage, SqliteGalley};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::time::Duration;
use tempfile::TempDir;

/// File-backed, WAL, the full runtime migration list.
async fn db() -> (TempDir, SqlitePool, SqliteGalley) {
    let dir = TempDir::new().expect("tempdir");
    let opts = SqliteConnectOptions::new()
        .filename(dir.path().join("workbench.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
        .expect("open sqlite");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    (dir, pool, galley)
}

async fn session(galley: &SqliteGalley, id: &str) {
    galley
        .create_session(
            CreateSessionInput {
                id: id.into(),
                title: "t".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::cli(None, None),
        )
        .await
        .expect("create session");
}

/// A message row as a test spells it.
struct Row<'a> {
    turn: i64,
    sequence: i64,
    role: &'a str,
    visibility: &'a str,
    tool_calls: Option<&'a str>,
    created_at: &'a str,
}

const SENT: &str = "2026-10-13T08:00:00.000Z";

fn user(turn: i64) -> Row<'static> {
    Row {
        turn,
        sequence: 0,
        role: "user",
        visibility: "visible",
        tool_calls: None,
        created_at: SENT,
    }
}

fn step(turn: i64) -> Row<'static> {
    Row {
        turn,
        sequence: 1,
        role: "assistant",
        visibility: "visible",
        tool_calls: None,
        created_at: SENT,
    }
}

const ASK_USER: &str = r#"[{"toolName":"ask_user","args":{"question":"A or B?"}}]"#;
const READ_FILE: &str = r#"[{"toolName":"file_read","args":{"path":"ask_user.md"}}]"#;

async fn insert(pool: &SqlitePool, sid: &str, row: Row<'_>) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
            tool_calls, visibility, created_at) \
         VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)",
    )
    .bind(format!("m_{sid}_{}_{}", row.turn, row.sequence))
    .bind(sid)
    .bind(row.turn)
    .bind(row.sequence)
    .bind(row.role)
    .bind(row.tool_calls)
    .bind(row.visibility)
    .bind(row.created_at)
    .execute(pool)
    .await
    .expect("insert message");
}

/// One exchange: a user row and its one-step reply, sharing a turn.
async fn exchange(pool: &SqlitePool, sid: &str, turn: i64) {
    insert(pool, sid, user(turn)).await;
    insert(pool, sid, step(turn)).await;
}

async fn page(
    galley: &SqliteGalley,
    sid: &str,
    before: Option<i64>,
    turns: usize,
) -> PersistedTurnPage {
    galley
        .persisted_message_turns_page(&SessionId(sid.into()), before, turns)
        .await
        .expect("turn page")
}

fn turns_of(p: &PersistedTurnPage) -> Vec<i64> {
    let mut turns: Vec<i64> = p.rows.iter().map(|r| r.turn_index).collect();
    turns.dedup();
    turns
}

fn positions(rows: &[PersistedMessageRow]) -> Vec<(i64, i64)> {
    rows.iter().map(|r| (r.turn_index, r.sequence)).collect()
}

/// Page back from the tail to the beginning; the pages joined oldest
/// first, with each page's turns.
async fn walk_back(
    galley: &SqliteGalley,
    sid: &str,
    turns: usize,
) -> (Vec<PersistedMessageRow>, Vec<Vec<i64>>) {
    let mut pages = Vec::new();
    let mut before = None;
    loop {
        let p = page(galley, sid, before, turns).await;
        let has_more = p.has_more;
        before = p.rows.first().map(|r| r.turn_index);
        pages.push(p);
        if !has_more {
            break;
        }
    }
    let shape = pages.iter().rev().map(turns_of).collect();
    let rows = pages.into_iter().rev().flat_map(|p| p.rows).collect();
    (rows, shape)
}

async fn all_rows(galley: &SqliteGalley, sid: &str) -> Vec<PersistedMessageRow> {
    galley
        .persisted_message_rows(&SessionId(sid.into()))
        .await
        .expect("full read")
}

#[tokio::test]
async fn pages_hold_whole_turns_and_walk_back_to_the_first() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    for turn in 0..7 {
        exchange(&pool, "s", turn).await;
    }
    // A turn of three rows (a tool row past the reply) stays together.
    insert(
        &pool,
        "s",
        Row {
            sequence: 2,
            role: "tool",
            ..step(4)
        },
    )
    .await;

    let tail = page(&galley, "s", None, 3).await;
    assert_eq!(turns_of(&tail), vec![4, 5, 6]);
    assert_eq!(
        positions(&tail.rows),
        vec![(4, 0), (4, 1), (4, 2), (5, 0), (5, 1), (6, 0), (6, 1)]
    );
    assert!(tail.has_more);

    let next = page(&galley, "s", Some(4), 3).await;
    assert_eq!(turns_of(&next), vec![1, 2, 3]);
    assert!(next.has_more);
    let first = page(&galley, "s", Some(1), 3).await;
    assert_eq!(turns_of(&first), vec![0]);
    assert!(!first.has_more);

    let (rows, shape) = walk_back(&galley, "s", 3).await;
    assert_eq!(shape, vec![vec![0], vec![1, 2, 3], vec![4, 5, 6]]);
    assert_eq!(positions(&rows), positions(&all_rows(&galley, "s").await));

    // A page that ends exactly at the first turn has nothing more.
    let exact = page(&galley, "s", Some(3), 3).await;
    assert_eq!(turns_of(&exact), vec![0, 1, 2]);
    assert!(!exact.has_more);
}

#[tokio::test]
async fn an_empty_session_and_a_page_before_the_first_turn_are_empty() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    let empty = page(&galley, "s", None, 50).await;
    assert!(empty.rows.is_empty() && !empty.has_more);
    assert_eq!(empty.previous_user_created_at, None);

    exchange(&pool, "s", 0).await;
    let none = page(&galley, "s", Some(0), 50).await;
    assert!(none.rows.is_empty() && !none.has_more);
    // Another session's rows are not this one's.
    session(&galley, "other").await;
    assert!(page(&galley, "other", None, 50).await.rows.is_empty());
}

#[tokio::test]
async fn the_greeting_is_a_turn_of_its_own() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "main").await;
    // The main chat's greeting: an assistant row at turn -1 with no user
    // row (`MAIN_CHAT_GREETING_TURN_INDEX`).
    insert(&pool, "main", step(-1)).await;
    for turn in 0..3 {
        exchange(&pool, "main", turn).await;
    }

    let tail = page(&galley, "main", None, 3).await;
    assert_eq!(turns_of(&tail), vec![0, 1, 2]);
    assert!(tail.has_more);
    // Nothing a user sent comes before the page.
    assert_eq!(tail.previous_user_created_at, None);

    let greeting = page(&galley, "main", Some(0), 3).await;
    assert_eq!(positions(&greeting.rows), vec![(-1, 1)]);
    assert!(!greeting.has_more);

    // The greeting alone, and with the first question — it heads no run,
    // so a page may start on it.
    let both = page(&galley, "main", Some(1), 2).await;
    assert_eq!(turns_of(&both), vec![-1, 0]);
    assert!(!both.has_more);
}

#[tokio::test]
async fn a_run_cut_by_the_page_boundary_reaches_back_to_its_opener() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&pool, "s", 0).await;
    // A five-step run: the question and step 1 share turn 1, steps 2–5
    // are turns of their own with no user row.
    exchange(&pool, "s", 1).await;
    for turn in 2..6 {
        insert(&pool, "s", step(turn)).await;
    }

    let tail = page(&galley, "s", None, 2).await;
    assert_eq!(turns_of(&tail), vec![1, 2, 3, 4, 5]);
    assert!(tail.has_more);
    let rest = page(&galley, "s", Some(1), 2).await;
    assert_eq!(turns_of(&rest), vec![0]);
    assert!(!rest.has_more);
}

#[tokio::test]
async fn an_ask_user_reply_never_starts_a_page() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&pool, "s", 0).await;
    // Turn 1 opens a run that asks; turn 2 answers it (after a system
    // row, which is a bystander); the run's step at turn 3 asks again
    // and turn 4 answers.
    insert(&pool, "s", user(1)).await;
    insert(
        &pool,
        "s",
        Row {
            tool_calls: Some(ASK_USER),
            ..step(1)
        },
    )
    .await;
    insert(
        &pool,
        "s",
        Row {
            sequence: 2,
            role: "system",
            ..step(1)
        },
    )
    .await;
    exchange(&pool, "s", 2).await;
    insert(
        &pool,
        "s",
        Row {
            tool_calls: Some(ASK_USER),
            ..step(3)
        },
    )
    .await;
    exchange(&pool, "s", 4).await;
    // A tool merely mentioning ask_user does not ask: turn 6 is a new run.
    insert(
        &pool,
        "s",
        Row {
            tool_calls: Some(READ_FILE),
            ..step(5)
        },
    )
    .await;
    exchange(&pool, "s", 6).await;

    let tail = page(&galley, "s", None, 1).await;
    assert_eq!(turns_of(&tail), vec![6]);
    let run = page(&galley, "s", Some(6), 1).await;
    assert_eq!(turns_of(&run), vec![1, 2, 3, 4, 5]);
    assert!(run.has_more);
    let (_, shape) = walk_back(&galley, "s", 1).await;
    assert_eq!(shape, vec![vec![0], vec![1, 2, 3, 4, 5], vec![6]]);

    // A reply the transcript does not show (an internal row) opens
    // nothing: the page reaches back to the visible opener.
    session(&galley, "hidden").await;
    insert(&pool, "hidden", user(0)).await;
    insert(
        &pool,
        "hidden",
        Row {
            tool_calls: Some(ASK_USER),
            ..step(0)
        },
    )
    .await;
    insert(
        &pool,
        "hidden",
        Row {
            visibility: "internal",
            ..user(1)
        },
    )
    .await;
    insert(&pool, "hidden", step(1)).await;
    let hidden = page(&galley, "hidden", None, 1).await;
    assert_eq!(turns_of(&hidden), vec![0, 1]);
}

/// Continuation turns the transcript never shows — internal user rows,
/// each followed by visible steps, as older Galley versions wrote them —
/// open no run: the page reaches back to the visible message they continue.
#[tokio::test]
async fn internal_user_rows_never_open_a_page() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&pool, "s", 0).await;
    insert(&pool, "s", user(1)).await;
    insert(&pool, "s", step(1)).await;
    for turn in 2..5 {
        insert(
            &pool,
            "s",
            Row {
                visibility: "internal",
                ..user(turn)
            },
        )
        .await;
        insert(&pool, "s", step(turn)).await;
    }

    let tail = page(&galley, "s", None, 2).await;
    assert_eq!(turns_of(&tail), vec![1, 2, 3, 4]);
    assert!(tail.has_more);
    assert_eq!(
        positions(&tail.rows[..1]),
        vec![(1, 0)],
        "opens at the visible row"
    );
    let rest = page(&galley, "s", Some(1), 2).await;
    assert_eq!(turns_of(&rest), vec![0]);
    assert!(!rest.has_more);
}

#[tokio::test]
async fn the_previous_user_message_sets_the_first_send_time_break() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    for (turn, sent) in [
        (0, "2026-10-12T08:00:00.000Z"),
        (1, "2026-10-12T09:00:00.000Z"),
        (2, "2026-10-13T08:00:00.000Z"),
    ] {
        insert(
            &pool,
            "s",
            Row {
                created_at: sent,
                ..user(turn)
            },
        )
        .await;
        insert(&pool, "s", step(turn)).await;
    }
    // Hidden rows do not count.
    insert(
        &pool,
        "s",
        Row {
            visibility: "internal",
            created_at: "2026-10-12T23:00:00.000Z",
            ..user(3)
        },
    )
    .await;
    insert(&pool, "s", step(3)).await;
    exchange(&pool, "s", 4).await;

    let tail = page(&galley, "s", None, 2).await;
    assert_eq!(turns_of(&tail), vec![2, 3, 4]);
    assert_eq!(
        tail.previous_user_created_at.as_deref(),
        Some("2026-10-12T09:00:00.000Z")
    );
    let first = page(&galley, "s", Some(2), 2).await;
    assert_eq!(turns_of(&first), vec![0, 1]);
    assert_eq!(first.previous_user_created_at, None);
}

#[tokio::test]
async fn only_visible_rows_with_their_attachments_as_the_full_read() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&pool, "s", 0).await;
    insert(
        &pool,
        "s",
        Row {
            visibility: "internal",
            ..user(1)
        },
    )
    .await;
    insert(
        &pool,
        "s",
        Row {
            visibility: "internal",
            ..step(1)
        },
    )
    .await;
    exchange(&pool, "s", 2).await;
    sqlx::query(
        "INSERT INTO message_attachments (id, message_id, session_id, kind, file_path, \
            mime_type, byte_size, created_at) \
         VALUES ('att_1', 'm_s_2_0', 's', 'image', '/x.png', 'image/png', 3, 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Turn 1 has no visible row, so it is not one of the page's turns.
    let tail = page(&galley, "s", None, 2).await;
    assert_eq!(turns_of(&tail), vec![0, 2]);
    assert!(!tail.has_more);
    assert_eq!(
        positions(&tail.rows),
        positions(&all_rows(&galley, "s").await)
    );
    let attached = tail.rows.iter().find(|r| r.id == "m_s_2_0").unwrap();
    assert_eq!(attached.attachments.len(), 1);
}
