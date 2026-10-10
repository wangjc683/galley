//! Paging a session's visible transcript backwards
//! (`SqliteGalley::persisted_message_rows_page`, ticket 05c — the phone's
//! `session.messages`): pages in ascending order, `has_more`, the
//! `(turn_index, sequence, id)` cursor, and paging back while a run keeps
//! appending.

use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, RuntimeKind, SessionId,
};
use galley_core_lib::db::{
    MessageCursor, PersistAssistantMessage, PersistedMessagePage, PersistedMessageRow,
    SqliteGalley, MESSAGE_PAGE_MAX,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::time::Duration;
use tempfile::TempDir;

/// File-backed, WAL, the full runtime migration list — concurrent
/// writers and readers like production.
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

/// One user row and its one-step reply (same turn, sequence 0 and 1).
async fn exchange(galley: &SqliteGalley, sid: &str, n: usize) {
    let user = galley
        .send_message(
            SessionId(sid.into()),
            format!("q{n}"),
            Origin::cli(None, None),
        )
        .await
        .expect("user row");
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index: user.turn_index.expect("turn index"),
            content: format!("a{n}"),
            tool_calls: None,
            tool_results: None,
            thinking: None,
            final_answer: Some(format!("a{n}")),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
}

fn ids(rows: &[PersistedMessageRow]) -> Vec<String> {
    rows.iter().map(|r| r.id.clone()).collect()
}

async fn all_rows(galley: &SqliteGalley, sid: &str) -> Vec<PersistedMessageRow> {
    galley
        .persisted_message_rows(&SessionId(sid.into()))
        .await
        .expect("full read")
}

async fn page(
    galley: &SqliteGalley,
    sid: &str,
    before: Option<&MessageCursor>,
    limit: usize,
) -> PersistedMessagePage {
    galley
        .persisted_message_rows_page(&SessionId(sid.into()), before, limit)
        .await
        .expect("page")
}

/// Page back from `start` (exclusive) to the beginning; the pages joined
/// oldest first.
async fn walk_back(
    galley: &SqliteGalley,
    sid: &str,
    start: Option<MessageCursor>,
    limit: usize,
) -> Vec<PersistedMessageRow> {
    let mut pages = Vec::new();
    let mut cursor = start;
    loop {
        let p = page(galley, sid, cursor.as_ref(), limit).await;
        assert!(p.rows.len() <= limit);
        let has_more = p.has_more;
        cursor = p.before();
        pages.push(p.rows);
        if !has_more {
            break;
        }
    }
    pages.into_iter().rev().flatten().collect()
}

#[tokio::test]
async fn pages_walk_back_to_the_first_row_in_order() {
    let (_dir, _pool, galley) = db().await;
    session(&galley, "s").await;
    for n in 0..7 {
        exchange(&galley, "s", n).await;
    }
    let full = all_rows(&galley, "s").await;
    assert_eq!(full.len(), 14);

    let tail = page(&galley, "s", None, 4).await;
    assert_eq!(ids(&tail.rows), ids(&full[10..]));
    assert!(tail.has_more);
    let second = page(&galley, "s", tail.before().as_ref(), 4).await;
    assert_eq!(ids(&second.rows), ids(&full[6..10]));
    assert!(second.has_more);

    assert_eq!(ids(&walk_back(&galley, "s", None, 4).await), ids(&full));
    // A last page that is exactly full says there is nothing more.
    let exact = page(&galley, "s", Some(&MessageCursor::of(&full[4])), 4).await;
    assert_eq!(ids(&exact.rows), ids(&full[..4]));
    assert!(!exact.has_more);
    // Before the first row: nothing.
    let none = page(&galley, "s", Some(&MessageCursor::of(&full[0])), 4).await;
    assert!(none.rows.is_empty() && !none.has_more && none.before().is_none());
}

#[tokio::test]
async fn a_page_boundary_inside_a_turn_loses_and_repeats_nothing() {
    let (_dir, _pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&galley, "s", 0).await;
    exchange(&galley, "s", 1).await;
    // Odd page size: every boundary falls between a question and its
    // answer, which share a turn index.
    let tail = page(&galley, "s", None, 3).await;
    assert_eq!(
        tail.rows
            .iter()
            .map(|r| (r.turn_index, r.sequence))
            .collect::<Vec<_>>(),
        vec![(0, 1), (1, 0), (1, 1)]
    );
    let rest = page(&galley, "s", tail.before().as_ref(), 3).await;
    assert_eq!(ids(&rest.rows), vec!["msg_s_0_user"]);
    assert!(!rest.has_more);
}

#[tokio::test]
async fn only_this_sessions_visible_rows_with_their_attachments() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    session(&galley, "other").await;
    exchange(&galley, "s", 0).await;
    exchange(&galley, "other", 0).await;
    galley
        .send_message_with_visibility(
            SessionId("s".into()),
            "internal".into(),
            Origin::cli(None, None),
            MessageVisibility::Internal,
        )
        .await
        .unwrap();
    exchange(&galley, "s", 1).await;
    sqlx::query(
        "INSERT INTO message_attachments (id, message_id, session_id, kind, file_path, \
            mime_type, byte_size, created_at) \
         VALUES ('att_msg_s_2_user_1', 'msg_s_2_user', 's', 'image', '/x.png', \
            'image/png', 3, 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let p = page(&galley, "s", None, 10).await;
    assert_eq!(
        ids(&p.rows),
        vec![
            "msg_s_0_user",
            "msg_s_0_assistant",
            "msg_s_2_user",
            "msg_s_2_assistant"
        ]
    );
    assert!(!p.has_more);
    assert_eq!(p.rows[2].attachments.len(), 1);
    assert_eq!(p.rows[2].attachments[0].id, "att_msg_s_2_user_1");
    // Same rows as the unpaged read.
    assert_eq!(ids(&p.rows), ids(&all_rows(&galley, "s").await));
}

#[tokio::test]
async fn ties_on_turn_and_sequence_are_broken_by_id() {
    let (_dir, pool, galley) = db().await;
    session(&galley, "s").await;
    for id in ["m_b", "m_a", "m_c"] {
        sqlx::query(
            "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                created_at) VALUES (?, 's', 0, 0, 'user', 'x', 'x')",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }
    let walked = walk_back(&galley, "s", None, 1).await;
    assert_eq!(ids(&walked), vec!["m_a", "m_b", "m_c"]);
}

#[tokio::test]
async fn the_limit_is_clamped() {
    let (_dir, _pool, galley) = db().await;
    session(&galley, "s").await;
    exchange(&galley, "s", 0).await;
    let one = page(&galley, "s", None, 0).await;
    assert_eq!(ids(&one.rows), vec!["msg_s_0_assistant"]);
    assert!(one.has_more);
    let all = page(&galley, "s", None, MESSAGE_PAGE_MAX * 10).await;
    assert_eq!(all.rows.len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paging_back_while_a_run_appends_neither_skips_nor_repeats() {
    let (_dir, _pool, galley) = db().await;
    session(&galley, "s").await;
    for n in 0..20 {
        exchange(&galley, "s", n).await;
    }
    let before_appends = all_rows(&galley, "s").await;
    let tail = page(&galley, "s", None, 5).await;
    assert_eq!(ids(&tail.rows), ids(&before_appends[35..]));

    // A run keeps appending while the phone scrolls up.
    let writer = {
        let galley = galley.clone();
        tokio::spawn(async move {
            for n in 20..35 {
                exchange(&galley, "s", n).await;
                tokio::task::yield_now().await;
            }
        })
    };
    let mut seen = HashSet::new();
    let mut pages = Vec::new();
    let mut cursor = tail.before();
    let mut between = 0;
    loop {
        // Besides the writer's own pace, one append between every two
        // pages for certain.
        exchange(&galley, "s", 100 + between).await;
        between += 1;
        let p = page(&galley, "s", cursor.as_ref(), 5).await;
        for row in &p.rows {
            assert!(seen.insert(row.id.clone()), "row {} repeated", row.id);
        }
        let ascending = p
            .rows
            .windows(2)
            .all(|w| (w[0].turn_index, w[0].sequence) < (w[1].turn_index, w[1].sequence));
        assert!(ascending, "page out of order: {:?}", ids(&p.rows));
        let has_more = p.has_more;
        cursor = p.before();
        pages.push(p.rows);
        if !has_more {
            break;
        }
    }
    writer.await.unwrap();
    let older: Vec<PersistedMessageRow> = pages.into_iter().rev().flatten().collect();

    // Exactly the rows before the first page, none of the new ones.
    let full = all_rows(&galley, "s").await;
    assert_eq!(full.len(), 40 + 2 * (15 + between));
    assert_eq!(ids(&older), ids(&full[..35]));
    assert_eq!(ids(&tail.rows), ids(&full[35..40]));
    // The new rows are at the tail.
    let new_tail = page(&galley, "s", None, 5).await;
    assert_eq!(ids(&new_tail.rows), ids(&full[full.len() - 5..]));
}
