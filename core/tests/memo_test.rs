//! Memos (main chat ticket 95) against an in-memory database: the record
//! and its writes (`SqliteGalley::create_memo` and the rest) through Core's
//! write path, the limits (a memo's characters, its last day, the total),
//! a memo past its day in no reader, who wrote it and in which turn, the
//! record of every write the cards read, the turn settled to its reply,
//! what the panel reads, which turns make a memo fresh for the morning
//! review, and the external runtime. The review itself is in
//! `schedule_wake_test.rs`; a main chat reset in `main_chat_reset_test.rs`;
//! the pure rules (characters, days, the review's window) and the segment
//! start's lines in the modules' unit tests.

use chrono::{Duration, Local};
use galley_core_lib::api::{
    CreateMemoInput, GalleyApi, MemoAction, MemoId, MemoPatch, MessageVisibility, Origin,
    OriginVia, SessionId, ASSISTANT_SUPERVISOR, ASSISTANT_UNAVAILABLE, MEMOS_CHANGED_EVENT,
    TIME_IN_PAST,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::error::GalleyError;
use galley_core_lib::notify::Notifier;
use galley_core_lib::session_writes::Writes;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;

const MAIN: &str = "s-main";

async fn fresh(runtime: &str) -> (SqlitePool, SqliteGalley) {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .set_pref_json("active_runtime_kind", json!(runtime))
        .await
        .expect("runtime");
    (pool, galley)
}

async fn with_main_chat() -> (SqlitePool, SqliteGalley) {
    let (pool, galley) = fresh("managed").await;
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    (pool, galley)
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<String>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, _payload: Value) {
        self.events.lock().unwrap().push(event.to_string());
    }
}

impl Recorder {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }
}

fn assistant() -> Origin {
    Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(ASSISTANT_SUPERVISOR.into()),
        reason: Some("the user said so".into()),
        client: None,
    }
}

fn input(text: &str) -> CreateMemoInput {
    CreateMemoInput {
        text: text.into(),
        until: None,
    }
}

fn day(days_from_today: i64) -> String {
    (Local::now().date_naive() + Duration::days(days_from_today))
        .format("%Y-%m-%d")
        .to_string()
}

/// The user says something in the main chat: the turn of their row.
async fn user_turn(galley: &SqliteGalley, text: &str) -> (SessionId, i64) {
    let turn = galley
        .send_message(SessionId(MAIN.into()), text.into(), Origin::desktop())
        .await
        .expect("user row")
        .turn_index
        .expect("turn");
    (SessionId(MAIN.into()), i64::from(turn))
}

/// Galley wakes the main chat (a reminder, a subtask's report, the morning
/// review): the turn of its row, written as the wake pipeline writes it.
async fn wake_turn(galley: &SqliteGalley) -> (SessionId, i64) {
    let row = galley
        .persist_subtask_report(
            &SessionId(MAIN.into()),
            "[Galley — not a message from the user] It is time for the morning review.".into(),
            Origin::subtask_report(&["sched_review".to_string()]),
            "[Galley: the morning review sched_review came due]",
        )
        .await
        .expect("wake row");
    (
        SessionId(MAIN.into()),
        i64::from(row.turn_index.expect("turn")),
    )
}

/// The reply of `turn`, as a run writes it.
async fn reply(galley: &SqliteGalley, turn: i64, text: &str) {
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(MAIN.into()),
            turn_index: (turn + 1) as u32,
            content: text.into(),
            tool_calls: Some("[]".into()),
            tool_results: None,
            thinking: None,
            final_answer: Some(text.into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("reply");
}

async fn fresh_at(pool: &SqlitePool, id: &MemoId) -> Option<String> {
    sqlx::query_scalar("SELECT fresh_at FROM memos WHERE id = ?")
        .bind(id.as_str())
        .fetch_one(pool)
        .await
        .expect("memo row")
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(pool)
        .await
        .expect("count")
}

fn refused(err: GalleyError) -> String {
    match err {
        GalleyError::InvalidArgs { message } => message,
        other => panic!("not invalid_args: {other:?}"),
    }
}

// ---------------- the record ----------------

#[tokio::test]
async fn a_memo_is_noted_with_who_and_where_and_broadcast() {
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let turn = user_turn(&galley, "我不吃香菜").await;
    let write = Writes::new(&galley, &rec, "memo.add")
        .create_memo(input("  不吃香菜 "), assistant(), Some(turn.clone()))
        .await
        .expect("noted");
    let memo = write.memo.clone();
    assert!(write.over_limit.is_none());
    let hex = memo.id.as_str().strip_prefix("memo_").expect("memo_ id");
    assert_eq!(hex.len(), 16);
    assert_eq!(memo.text, "不吃香菜");
    assert!(memo.until.is_none());
    assert_eq!(memo.origin.via, OriginVia::Supervisor);
    assert_eq!(
        memo.origin.supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );
    assert_eq!(memo.origin.reason.as_deref(), Some("the user said so"));
    let created_in = memo.created_in.clone().expect("noted in the main chat");
    assert_eq!(created_in.session_id.as_str(), MAIN);
    assert_eq!(created_in.turn_index, None, "settled when the run ends");
    assert_eq!(memo.created_at, memo.updated_at);
    assert_eq!(rec.take(), [MEMOS_CHANGED_EVENT]);
    // On the wire: camelCase, empty fields left out, `overLimit` absent.
    let wire = serde_json::to_value(&write).unwrap();
    assert_eq!(wire["memo"]["id"], json!(memo.id.as_str()));
    assert_eq!(wire["memo"]["createdIn"], json!({"sessionId": MAIN}));
    assert!(wire["memo"].get("until").is_none());
    assert!(wire.get("overLimit").is_none());
    // In the list, and the record of the write.
    let listed = galley.memos_today().await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, memo.id);
    let events = galley
        .memo_events_in(&SessionId(MAIN.into()))
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, MemoAction::Add);
    assert_eq!(events[0].text, "不吃香菜");
    assert_eq!(events[0].memo_id, memo.id);
    assert!(events[0].memo_exists);
    let (via, supervisor, note, run_turn): (String, Option<String>, Option<String>, Option<i64>) =
        sqlx::query_as(
            "SELECT via, supervisor, origin_note, run_turn FROM memo_events WHERE memo_id = ?",
        )
        .bind(memo.id.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(via, "supervisor");
    assert_eq!(supervisor.as_deref(), Some(ASSISTANT_SUPERVISOR));
    assert_eq!(note.as_deref(), Some("the user said so"));
    assert_eq!(run_turn, Some(turn.1));
    // Noted outside a main chat run (no turn): made all the same.
    let outside = galley
        .create_memo(input("工作日 9 点到公司"), assistant(), None)
        .await
        .unwrap()
        .memo;
    assert!(outside.created_in.is_none());
}

#[tokio::test]
async fn a_memo_is_one_to_a_hundred_characters() {
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "memo.add");
    // 0 and 101, in characters: refused, nothing written, nothing said.
    for (text, chars) in [
        ("   ".to_string(), 0),
        ("香".repeat(101), 101),
        ("🏀".repeat(101), 101),
        (format!("{}x", "a".repeat(100)), 101),
    ] {
        let message = refused(
            writes
                .create_memo(input(&text), assistant(), None)
                .await
                .unwrap_err(),
        );
        assert_eq!(
            message,
            format!("create_memo: a memo is 1 to 100 characters once trimmed; this one is {chars}")
        );
    }
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM memos").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM memo_events").await, 0);
    assert!(rec.take().is_empty());
    // 1 and 100, in three- and four-byte characters: noted.
    for text in ["我".to_string(), "香".repeat(100), "🏀".repeat(100)] {
        let memo = writes
            .create_memo(input(&text), assistant(), None)
            .await
            .expect("noted")
            .memo;
        assert_eq!(memo.text, text);
    }
    // The same rule for a change, and a change with nothing in it.
    let id = galley.memos_today().await.unwrap()[0].id.clone();
    let message = refused(
        galley
            .update_memo(
                &id,
                MemoPatch {
                    text: Some("香".repeat(101)),
                    until: None,
                },
                assistant(),
                None,
            )
            .await
            .unwrap_err(),
    );
    assert!(message.ends_with("this one is 101"), "{message}");
    assert_eq!(galley.memo(id.as_str()).await.unwrap().text, "我");
}

#[tokio::test]
async fn until_is_today_or_later_and_a_memo_past_it_is_in_no_reader() {
    let (pool, galley) = with_main_chat().await;
    let message = refused(
        galley
            .create_memo(
                CreateMemoInput {
                    text: "下周三起在上海出差".into(),
                    until: Some(day(-1)),
                },
                assistant(),
                None,
            )
            .await
            .unwrap_err(),
    );
    assert!(
        message.starts_with(&format!("{TIME_IN_PAST}: create_memo: until ")),
        "{message}"
    );
    let message = refused(
        galley
            .create_memo(
                CreateMemoInput {
                    text: "x".into(),
                    until: Some("next Friday".into()),
                },
                assistant(),
                None,
            )
            .await
            .unwrap_err(),
    );
    assert!(
        message.contains("until is a local date YYYY-MM-DD"),
        "{message}"
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM memos").await, 0);
    // Today is fine: it holds to the end of it.
    let trip = galley
        .create_memo(
            CreateMemoInput {
                text: "下周三起在上海出差".into(),
                until: Some(day(0)),
            },
            assistant(),
            None,
        )
        .await
        .expect("today")
        .memo;
    assert_eq!(trip.until.as_deref(), Some(day(0).as_str()));
    let kept = galley
        .create_memo(input(&"字".repeat(100)), assistant(), None)
        .await
        .unwrap()
        .memo;
    // The day passes (Core never writes a past day; the clock does).
    sqlx::query("UPDATE memos SET until_date = ? WHERE id = ?")
        .bind(day(-1))
        .bind(trip.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    let today = Local::now().date_naive();
    let listed: Vec<MemoId> = galley
        .memos_today()
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(listed, [kept.id.clone()]);
    let panel: Vec<MemoId> = galley
        .memo_items(today)
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.memo.id)
        .collect();
    assert_eq!(panel, [kept.id.clone()]);
    assert_eq!(galley.memo_total_chars(today).await.unwrap(), 100);
    // Its row stays, and it can be given a later day.
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM memos").await, 2);
    assert!(galley.memo(trip.id.as_str()).await.is_ok());
    galley
        .update_memo(
            &trip.id,
            MemoPatch {
                text: None,
                until: Some(Some(day(3))),
            },
            assistant(),
            None,
        )
        .await
        .expect("a later day");
    assert_eq!(galley.memos_today().await.unwrap().len(), 2);
    // And taken off.
    let plain = galley
        .update_memo(
            &trip.id,
            MemoPatch {
                text: None,
                until: Some(None),
            },
            assistant(),
            None,
        )
        .await
        .unwrap()
        .memo;
    assert!(plain.until.is_none());
}

#[tokio::test]
async fn past_two_thousand_characters_a_write_is_kept_and_says_by_how_much() {
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "memo.add");
    for _ in 0..19 {
        writes
            .create_memo(input(&"字".repeat(100)), assistant(), None)
            .await
            .unwrap();
    }
    let last = writes
        .create_memo(input(&"字".repeat(99)), assistant(), None)
        .await
        .unwrap();
    assert!(last.over_limit.is_none(), "1,999");
    // One past its day does not count.
    let gone = writes
        .create_memo(input(&"旧".repeat(100)), assistant(), None)
        .await
        .unwrap();
    assert!(gone.over_limit.is_some());
    sqlx::query("UPDATE memos SET until_date = ? WHERE id = ?")
        .bind(day(-1))
        .bind(gone.memo.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        galley
            .memo_total_chars(Local::now().date_naive())
            .await
            .unwrap(),
        1_999
    );
    // 1,999 and two more: kept, 1 over.
    let over = writes
        .create_memo(input("两字"), assistant(), None)
        .await
        .expect("kept");
    let limit = over.over_limit.clone().expect("over the total");
    assert_eq!((limit.chars, limit.limit, limit.over), (2_001, 2_000, 1));
    assert!(galley
        .memos_today()
        .await
        .unwrap()
        .iter()
        .any(|m| m.id == over.memo.id));
    let wire = serde_json::to_value(&over).unwrap();
    assert_eq!(wire["overLimit"]["chars"], 2_001);
    assert_eq!(wire["overLimit"]["over"], 1);
    assert_eq!(
        wire["overLimit"]["message"],
        "Memos now total 2001 characters, 1 over the 2000 the start of each segment holds, so \
         the last ones noted will be left out of it: merge memos or delete the ones out of date \
         first."
    );
    // A change says so too; a shorter one brings it back under.
    let changed = galley
        .update_memo(
            &over.memo.id,
            MemoPatch {
                text: Some("三个字".into()),
                until: None,
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    assert_eq!(changed.over_limit.expect("over").over, 2);
    let changed = galley
        .update_memo(
            &over.memo.id,
            MemoPatch {
                text: Some("一".into()),
                until: None,
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    assert!(changed.over_limit.is_none(), "2,000 is within it");
}

// ---------------- the record of writes ----------------

#[tokio::test]
async fn every_write_is_recorded_and_a_delete_keeps_the_record() {
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "memo");
    let main = SessionId(MAIN.into());
    let noted_in = user_turn(&galley, "我们家老大叫小树").await;
    let memo = writes
        .create_memo(input("大儿子叫小树"), assistant(), Some(noted_in))
        .await
        .unwrap()
        .memo;
    let changed_in = user_turn(&galley, "小树今年上三年级了").await;
    writes
        .update_memo(
            &memo.id,
            MemoPatch {
                text: Some("大儿子叫小树，今年上三年级".into()),
                until: None,
            },
            assistant(),
            Some(changed_in.clone()),
        )
        .await
        .unwrap();
    let events = galley.memo_events_in(&main).await.unwrap();
    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|e| e.memo_exists));
    let deleted_in = user_turn(&galley, "别记我孩子的事了").await;
    let gone = writes
        .delete_memo(&memo.id, assistant(), Some(deleted_in))
        .await
        .expect("deleted");
    assert_eq!(gone.text, "大儿子叫小树，今年上三年级");
    assert_eq!(rec.take().len(), 3, "one memos:changed per write");
    // Gone from every read and write; its record stays.
    assert!(matches!(
        galley.memo(memo.id.as_str()).await,
        Err(GalleyError::NotFound { .. })
    ));
    assert!(galley.memos_today().await.unwrap().is_empty());
    assert!(matches!(
        writes.delete_memo(&memo.id, assistant(), None).await,
        Err(GalleyError::NotFound { .. })
    ));
    assert!(matches!(
        writes
            .update_memo(
                &memo.id,
                MemoPatch {
                    text: Some("x".into()),
                    until: None
                },
                assistant(),
                None
            )
            .await,
        Err(GalleyError::NotFound { .. })
    ));
    assert!(rec.take().is_empty(), "a refused write says nothing");
    let events = galley.memo_events_in(&main).await.unwrap();
    let actions: Vec<MemoAction> = events.iter().map(|e| e.action).collect();
    assert_eq!(
        actions,
        [MemoAction::Add, MemoAction::Update, MemoAction::Delete]
    );
    let texts: Vec<&str> = events.iter().map(|e| e.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "大儿子叫小树",
            "大儿子叫小树，今年上三年级",
            "大儿子叫小树，今年上三年级"
        ]
    );
    assert!(events.iter().all(|e| !e.memo_exists));
    assert!(events.windows(2).all(|pair| pair[0].id < pair[1].id));
    // The desktop's delete: `gui`, in no turn, so on no card.
    let other = writes
        .create_memo(input("喜欢喝茶"), assistant(), Some(changed_in))
        .await
        .unwrap()
        .memo;
    writes
        .delete_memo(&other.id, Origin::desktop(), None)
        .await
        .expect("deleted on the desktop");
    let (via, session): (String, Option<String>) = sqlx::query_as(
        "SELECT via, session_id FROM memo_events WHERE memo_id = ? AND action = 'delete'",
    )
    .bind(other.id.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((via.as_str(), session), ("gui", None));
    let on_cards = galley.memo_events_in(&main).await.unwrap();
    assert_eq!(on_cards.len(), 4, "its add is on a card, its delete is not");
    assert!(!on_cards.last().unwrap().memo_exists);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM memo_events").await, 5);
}

#[tokio::test]
async fn the_turn_a_memo_was_written_in_is_settled_to_its_reply() {
    let (pool, galley) = with_main_chat().await;
    let turn = user_turn(&galley, "我不吃香菜").await;
    let memo = galley
        .create_memo(input("不吃香菜"), assistant(), Some(turn.clone()))
        .await
        .unwrap()
        .memo;
    // No reply yet: nothing to settle.
    assert_eq!(galley.settle_memo_created_in(MAIN).await.unwrap(), 0);
    let updated_at: String = sqlx::query_scalar("SELECT updated_at FROM memos WHERE id = ?")
        .bind(memo.id.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    // Backdate it, so a settle that moved it would show.
    sqlx::query("UPDATE memos SET updated_at = '2026-10-20T01:00:00+00:00' WHERE id = ?")
        .bind(memo.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    assert!(!updated_at.is_empty());
    reply(&galley, turn.1, "记下了，以后不放香菜").await;
    // The memo and its event.
    assert_eq!(galley.settle_memo_created_in(MAIN).await.unwrap(), 2);
    let settled = galley.memo(memo.id.as_str()).await.unwrap();
    assert_eq!(settled.created_in.unwrap().turn_index, Some(turn.1 + 1));
    assert_eq!(
        settled.updated_at, "2026-10-20T01:00:00+00:00",
        "settling is not a change of the memo"
    );
    let events = galley
        .memo_events_in(&SessionId(MAIN.into()))
        .await
        .unwrap();
    assert_eq!(events[0].turn_index, Some(turn.1 + 1));
    assert_eq!(galley.settle_memo_created_in(MAIN).await.unwrap(), 0);
    // The panel jumps there.
    let items = galley.memo_items(Local::now().date_naive()).await.unwrap();
    let place = items[0].changed_in.clone().expect("where");
    assert_eq!(place.session_id.as_str(), MAIN);
    assert_eq!(place.turn_index, Some(turn.1 + 1));
}

#[tokio::test]
async fn the_panel_jumps_to_where_a_memo_was_last_written() {
    let (_pool, galley) = with_main_chat().await;
    let today = Local::now().date_naive();
    let first = user_turn(&galley, "我住在思明区").await;
    let home = galley
        .create_memo(input("住在思明区"), assistant(), Some(first))
        .await
        .unwrap()
        .memo;
    let tea = galley
        .create_memo(input("喜欢喝茶"), assistant(), None)
        .await
        .unwrap()
        .memo;
    let moved = user_turn(&galley, "我搬去湖里了").await;
    galley
        .update_memo(
            &home.id,
            MemoPatch {
                text: Some("住在湖里区".into()),
                until: None,
            },
            assistant(),
            Some(moved),
        )
        .await
        .unwrap();
    let items = galley.memo_items(today).await.unwrap();
    // In the order they were noted; the last write's turn.
    let ids: Vec<&MemoId> = items.iter().map(|i| &i.memo.id).collect();
    assert_eq!(ids, [&home.id, &tea.id]);
    assert_eq!(items[0].memo.text, "住在湖里区");
    let place = items[0].changed_in.clone().expect("in a turn");
    assert_eq!(place.turn_index, None, "not settled yet");
    assert_eq!(place.session_id.as_str(), MAIN);
    assert!(items[1].changed_in.is_none(), "written in no turn");
    // A later change outside a run keeps the last place in the chat.
    galley
        .update_memo(
            &home.id,
            MemoPatch {
                text: Some("住在湖里区，靠近 BRT".into()),
                until: None,
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let wire = serde_json::to_value(&galley.memo_items(today).await.unwrap()[0]).unwrap();
    assert_eq!(wire["id"], json!(home.id.as_str()));
    assert_eq!(wire["text"], "住在湖里区，靠近 BRT");
    assert_eq!(wire["changedIn"], json!({"sessionId": MAIN}));
}

// ---------------- fresh for the morning review ----------------

#[tokio::test]
async fn a_memo_is_fresh_only_when_written_in_a_turn_the_user_started() {
    let (pool, galley) = with_main_chat().await;
    // The user's turn: fresh.
    let theirs = user_turn(&galley, "我最近在看 76 人的比赛").await;
    let watching = galley
        .create_memo(input("最近在看 76 人"), assistant(), Some(theirs))
        .await
        .unwrap()
        .memo;
    let first = fresh_at(&pool, &watching.id).await.expect("fresh");
    // A wake's turn (Galley's own row): noting is not fresh, and a
    // change leaves the stamp where it was.
    sqlx::query("UPDATE memos SET fresh_at = '2026-10-20T01:00:00+00:00' WHERE id = ?")
        .bind(watching.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    let wake = wake_turn(&galley).await;
    let woke_noted = galley
        .create_memo(input("76 人进了次轮"), assistant(), Some(wake.clone()))
        .await
        .unwrap()
        .memo;
    assert_eq!(fresh_at(&pool, &woke_noted.id).await, None);
    let changed = galley
        .update_memo(
            &watching.id,
            MemoPatch {
                text: Some("最近在看 76 人，季后赛".into()),
                until: None,
            },
            assistant(),
            Some(wake),
        )
        .await
        .unwrap()
        .memo;
    assert_eq!(
        fresh_at(&pool, &watching.id).await.as_deref(),
        Some("2026-10-20T01:00:00+00:00")
    );
    assert_ne!(
        changed.updated_at, "2026-10-20T01:00:00+00:00",
        "it did change"
    );
    // The user's turn again: fresh again.
    let again = user_turn(&galley, "对，我关注季后赛").await;
    galley
        .update_memo(
            &watching.id,
            MemoPatch {
                text: Some("在关注 76 人的季后赛".into()),
                until: None,
            },
            assistant(),
            Some(again),
        )
        .await
        .unwrap();
    let now = fresh_at(&pool, &watching.id).await.expect("fresh");
    assert_ne!(now, "2026-10-20T01:00:00+00:00");
    assert!(now >= first);
    // Outside a main chat run (no turn): not fresh.
    let outside = galley
        .create_memo(input("工作日 9 点到公司"), assistant(), None)
        .await
        .unwrap()
        .memo;
    assert_eq!(fresh_at(&pool, &outside.id).await, None);
}

/// Ticket 98: an update that changes nothing (the same text once trimmed,
/// the same last day, or no last day taken off one that has none) is no
/// write: `updated_at` and `fresh_at` stay, no event is recorded, and it
/// answers with the memo as it is. A new last day alone, or new words
/// alone, is a change, and makes the memo fresh again in a turn the user
/// started.
#[tokio::test]
async fn an_update_that_changes_nothing_is_no_write() {
    let (pool, galley) = with_main_chat().await;
    let main = SessionId(MAIN.into());
    let noted_in = user_turn(&galley, "76 人昨天赢了没？").await;
    let memo = galley
        .create_memo(
            input("看你这周常问 76 人的比赛"),
            assistant(),
            Some(noted_in),
        )
        .await
        .unwrap()
        .memo;
    let stamp = "2026-10-20T01:00:00+00:00";
    let stamps = |pool: SqlitePool, id: MemoId| async move {
        sqlx::query_as::<_, (Option<String>, String)>(
            "SELECT fresh_at, updated_at FROM memos WHERE id = ?",
        )
        .bind(id.as_str())
        .fetch_one(&pool)
        .await
        .expect("memo row")
    };
    let reset = |pool: SqlitePool, id: MemoId| async move {
        sqlx::query("UPDATE memos SET fresh_at = ?, updated_at = ? WHERE id = ?")
            .bind(stamp)
            .bind(stamp)
            .bind(id.as_str())
            .execute(&pool)
            .await
            .unwrap();
    };
    let unchanged = (Some(stamp.to_string()), stamp.to_string());
    reset(pool.clone(), memo.id.clone()).await;
    // The same words (spaces around them trimmed), in a turn the user
    // started; then no last day, on a memo that has none.
    for patch in [
        MemoPatch {
            text: Some("  看你这周常问 76 人的比赛 ".into()),
            until: None,
        },
        MemoPatch {
            text: None,
            until: Some(None),
        },
    ] {
        let again = user_turn(&galley, "76 人下一场什么时候？").await;
        let same = galley
            .update_memo(&memo.id, patch, assistant(), Some(again))
            .await
            .expect("an update with nothing new still answers");
        assert_eq!(same.memo.text, "看你这周常问 76 人的比赛");
        assert_eq!(same.memo.updated_at, stamp);
        assert_eq!(stamps(pool.clone(), memo.id.clone()).await, unchanged);
    }
    assert_eq!(
        galley.memo_events_in(&main).await.unwrap().len(),
        1,
        "the add only"
    );
    // A last day alone is a change.
    let trip = user_turn(&galley, "我这周在外地，看不了直播").await;
    galley
        .update_memo(
            &memo.id,
            MemoPatch {
                text: None,
                until: Some(Some(day(5))),
            },
            assistant(),
            Some(trip),
        )
        .await
        .unwrap();
    let (fresh, updated) = stamps(pool.clone(), memo.id.clone()).await;
    assert_ne!(fresh.as_deref(), Some(stamp));
    assert_ne!(updated, stamp);
    // And the same last day again is not.
    reset(pool.clone(), memo.id.clone()).await;
    let same_day = user_turn(&galley, "对，这周都不在").await;
    galley
        .update_memo(
            &memo.id,
            MemoPatch {
                text: None,
                until: Some(Some(day(5))),
            },
            assistant(),
            Some(same_day),
        )
        .await
        .unwrap();
    assert_eq!(stamps(pool.clone(), memo.id.clone()).await, unchanged);
    // New words alone are a change.
    let words = user_turn(&galley, "季后赛我也会一直看").await;
    galley
        .update_memo(
            &memo.id,
            MemoPatch {
                text: Some("看你这两周常问 76 人的比赛".into()),
                until: None,
            },
            assistant(),
            Some(words),
        )
        .await
        .unwrap();
    let (fresh, updated) = stamps(pool.clone(), memo.id.clone()).await;
    assert_ne!(fresh.as_deref(), Some(stamp));
    assert_ne!(updated, stamp);
    let actions: Vec<MemoAction> = galley
        .memo_events_in(&main)
        .await
        .unwrap()
        .iter()
        .map(|e| e.action)
        .collect();
    assert_eq!(
        actions,
        [MemoAction::Add, MemoAction::Update, MemoAction::Update],
        "a write recorded for each change, none for the updates that changed nothing"
    );
}

// ---------------- the external runtime ----------------

#[tokio::test]
async fn under_the_external_runtime_writes_are_refused_and_reads_answer() {
    let (_pool, galley) = with_main_chat().await;
    let kept = galley
        .create_memo(input("不吃香菜"), assistant(), None)
        .await
        .unwrap()
        .memo;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "memo");
    let prefix = format!("{ASSISTANT_UNAVAILABLE}: ");
    let errors = [
        writes
            .create_memo(input("x"), assistant(), None)
            .await
            .unwrap_err(),
        writes
            .update_memo(
                &kept.id,
                MemoPatch {
                    text: Some("y".into()),
                    until: None,
                },
                assistant(),
                None,
            )
            .await
            .unwrap_err(),
        writes
            .delete_memo(&kept.id, Origin::desktop(), None)
            .await
            .unwrap_err(),
    ];
    for err in errors {
        let message = refused(err);
        assert!(message.starts_with(&prefix), "{message}");
    }
    assert!(rec.take().is_empty());
    assert_eq!(galley.memos_today().await.unwrap().len(), 1);
    // No main chat at all: refused too.
    let (_pool, none) = fresh("managed").await;
    let message = refused(
        none.create_memo(input("x"), assistant(), None)
            .await
            .unwrap_err(),
    );
    assert!(message.starts_with(&prefix), "{message}");
}
