//! The main chat (主聊天, `.scratch/main-chat` ticket 02): migration 044
//! keeps at most one, managed-only; Core creates it on the first ask and
//! hands the same row back after that; the desktop's write path cannot
//! archive or delete it, while the socket's (CLI / supervisor) is left
//! as it was.
//!
//! Ticket 04c (PRD ruling 47): a creation — and only a creation — opens
//! it with the AI's greeting in the UI language and turns the affairs
//! ledger on where its switch was never set, the first run at the next
//! 04:00. The greeting is shown, never replayed, never a turn.

use chrono::{DateTime, FixedOffset, Utc};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageRole, Origin, OriginVia, RuntimeKind, SessionBrief,
    SessionFilter, SessionId, SessionStatus,
};
use galley_core_lib::db::{
    MainChatEnsured, SqliteGalley, MAIN_CHAT_GREETING_EN, MAIN_CHAT_GREETING_SUPERVISOR,
    MAIN_CHAT_GREETING_ZH, MAIN_CHAT_TITLE,
};
use galley_core_lib::error::GalleyError;
use galley_core_lib::ledger::config::{parse_switch, LedgerSwitch, SWITCH_PREF};
use galley_core_lib::notify::Notifier;
use galley_core_lib::session_runner::{rows_to_conversation_messages, ReplayRow};
use galley_core_lib::session_writes::{Writes, VIA_GUI};
use serde_json::{json, Value};
use std::sync::Mutex;

async fn fresh_pool() -> sqlx::SqlitePool {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    pool
}

async fn fresh_galley(active: RuntimeKind) -> SqliteGalley {
    galley_on(fresh_pool().await, active).await
}

async fn galley_on(pool: sqlx::SqlitePool, active: RuntimeKind) -> SqliteGalley {
    let galley = SqliteGalley::from_pool(pool);
    let kind = match active {
        RuntimeKind::Managed => "managed",
        _ => "external",
    };
    galley
        .set_pref_json("active_runtime_kind", json!(kind))
        .await
        .expect("set active runtime");
    galley
}

fn gui() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
        client: None,
    }
}

fn session_input(id: &str, kind: RuntimeKind) -> CreateSessionInput {
    CreateSessionInput {
        id: id.to_string(),
        title: "新对话".to_string(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(kind),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<(String, Value)>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl Recorder {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(n, _)| n.clone())
            .collect()
    }
    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

/// The desktop's write path, as the Tauri commands build it.
fn desktop<'a>(galley: &'a SqliteGalley, rec: &'a Recorder) -> Writes<'a> {
    Writes::new(galley, rec, VIA_GUI).protecting_main_chat()
}

async fn main_chat(galley: &SqliteGalley, rec: &Recorder) -> SessionId {
    ask(galley, rec).await.expect("main chat").id
}

/// The desktop's ask, as the Tauri command makes it with no language.
async fn ask(galley: &SqliteGalley, rec: &Recorder) -> Result<SessionBrief, GalleyError> {
    desktop(galley, rec)
        .get_or_create_main_chat(gui(), None)
        .await
        .map(MainChatEnsured::into_brief)
}

// ---------------- migration 044 ----------------

#[tokio::test]
async fn the_schema_allows_one_main_chat_and_only_on_the_managed_runtime() {
    let pool = fresh_pool().await;
    let galley = galley_on(pool.clone(), RuntimeKind::Managed).await;
    for (id, kind) in [
        ("s-ext", RuntimeKind::External),
        ("s-a", RuntimeKind::Managed),
        ("s-b", RuntimeKind::Managed),
    ] {
        galley
            .create_session(session_input(id, kind), gui())
            .await
            .unwrap();
    }
    let flag = |id: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query("UPDATE sessions SET main_chat = 1 WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
        }
    };
    assert!(flag("s-ext").await.is_err(), "an external row cannot be it");
    flag("s-a").await.expect("the first managed one can");
    assert!(flag("s-b").await.is_err(), "a second one cannot");
}

// ---------------- get or create ----------------

#[tokio::test]
async fn the_first_ask_creates_it_and_later_asks_hand_the_same_row_back() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();

    let first = ask(&galley, &rec).await.unwrap();
    assert_eq!(first.main_chat, Some(true));
    assert_eq!(first.title, MAIN_CHAT_TITLE);
    assert_eq!(first.ga_runtime_kind, RuntimeKind::Managed);
    assert_eq!(first.status, SessionStatus::Idle);
    assert_eq!(first.project_id, None);
    assert_eq!(rec.names(), vec!["session-created-external"]);
    let event = rec.events.lock().unwrap()[0].1.clone();
    assert_eq!(event["session"]["mainChat"], json!(true));

    rec.clear();
    let again = ask(&galley, &rec).await.unwrap();
    assert_eq!(again.id, first.id);
    assert!(rec.names().is_empty(), "nothing new to broadcast");

    let all = galley
        .list_sessions(SessionFilter::default())
        .await
        .unwrap();
    assert_eq!(all.len(), 1);
}

#[tokio::test]
async fn only_the_main_chat_carries_main_chat_in_its_json() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-side", RuntimeKind::Managed), gui())
        .await
        .unwrap();

    let main_json = serde_json::to_value(galley.session_brief(main).await.unwrap()).unwrap();
    assert_eq!(main_json["mainChat"], json!(true));
    let side_json = serde_json::to_value(
        galley
            .session_brief(SessionId("s-side".into()))
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        side_json.get("mainChat").is_none(),
        "a side chat's brief is unchanged: {side_json}"
    );
}

#[tokio::test]
async fn an_attached_external_ga_has_no_main_chat() {
    let galley = fresh_galley(RuntimeKind::External).await;
    let rec = Recorder::default();
    let err = ask(&galley, &rec).await.expect_err("external has none");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    assert!(rec.names().is_empty());
    assert_eq!(galley.main_chat_id().await.unwrap(), None);
    // Nothing of ticket 04c either: no switch, no greeting.
    assert_eq!(galley.get_pref_json(SWITCH_PREF).await.unwrap(), None);
    assert_eq!(greetings(&galley).await, 0);
}

#[tokio::test]
async fn an_archived_main_chat_comes_back_restored() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    // The socket path (CLI `session archive`) is not guarded.
    Writes::new(&galley, &rec, "session.archive")
        .archive_session(main.clone(), gui())
        .await
        .expect("the CLI can still archive it");

    rec.clear();
    let back = ask(&galley, &rec).await.unwrap();
    assert_eq!(back.id, main);
    assert_eq!(back.status, SessionStatus::Idle);
    assert_eq!(rec.names(), vec!["session-unarchived-external"]);
}

// ---------------- the desktop cannot archive or delete it ----------------

#[tokio::test]
async fn the_desktop_cannot_archive_or_delete_the_main_chat() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    rec.clear();

    let err = desktop(&galley, &rec)
        .archive_session(main.clone(), gui())
        .await
        .expect_err("no archive");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    let err = desktop(&galley, &rec)
        .delete_session(main.clone(), gui())
        .await
        .expect_err("no delete");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    assert!(rec.names().is_empty(), "a refused write broadcasts nothing");
    let brief = galley.session_brief(main).await.unwrap();
    assert_eq!(brief.status, SessionStatus::Idle);
}

#[tokio::test]
async fn bulk_archive_and_delete_leave_the_main_chat_out() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    for id in ["s-1", "s-2"] {
        galley
            .create_session(session_input(id, RuntimeKind::Managed), gui())
            .await
            .unwrap();
    }
    let ids = |names: &[&str]| -> Vec<SessionId> {
        names.iter().map(|n| SessionId(n.to_string())).collect()
    };

    let mut batch = ids(&["s-1"]);
    batch.push(main.clone());
    let archived = desktop(&galley, &rec)
        .bulk_archive_sessions(batch, gui())
        .await
        .unwrap();
    assert_eq!(archived, 1, "only the side chat");

    let mut batch = ids(&["s-1", "s-2"]);
    batch.push(main.clone());
    let deleted = desktop(&galley, &rec)
        .bulk_delete_sessions(batch, gui())
        .await
        .unwrap();
    assert_eq!(deleted, 2, "only the side chats");
    assert_eq!(
        galley.session_brief(main).await.unwrap().status,
        SessionStatus::Idle
    );
}

#[tokio::test]
async fn side_chats_archive_and_delete_as_before() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-side", RuntimeKind::Managed), gui())
        .await
        .unwrap();
    let side = SessionId("s-side".into());
    desktop(&galley, &rec)
        .archive_session(side.clone(), gui())
        .await
        .expect("archive a side chat");
    desktop(&galley, &rec)
        .delete_session(side, gui())
        .await
        .expect("delete a side chat");
}

#[tokio::test]
async fn the_launch_sweep_keeps_an_empty_main_chat() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-empty", RuntimeKind::Managed), gui())
        .await
        .unwrap();

    let swept = galley.delete_empty_new_session_ids().await.unwrap();
    assert_eq!(swept, vec![SessionId("s-empty".into())]);
    assert!(galley.session_brief(main).await.is_ok());
}

// ---------------- the greeting and the ledger (ticket 04c) ----------------

fn shanghai() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).unwrap()
}

fn at(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}

/// How many greeting rows the database holds.
async fn greetings(galley: &SqliteGalley) -> usize {
    let mut n = 0;
    for session in galley
        .list_sessions(SessionFilter::default())
        .await
        .unwrap()
    {
        let rows = galley.persisted_message_rows(&session.id).await.unwrap();
        n += rows
            .iter()
            .filter(|r| r.supervisor.as_deref() == Some(MAIN_CHAT_GREETING_SUPERVISOR))
            .count();
    }
    n
}

async fn switch(galley: &SqliteGalley) -> LedgerSwitch {
    parse_switch(galley.get_pref_json(SWITCH_PREF).await.unwrap().as_ref())
}

/// The Chinese greeting is JC's wording (ticket 04, 04c, 2026-10-12),
/// word for word; both are three paragraphs with no `\r` on any
/// checkout.
#[test]
fn the_greeting_text_is_the_approved_wording() {
    assert_eq!(
        MAIN_CHAT_GREETING_ZH,
        [
            "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
            "为了接得上你在忙的事，我会整理你在 Galley 和聊天软件私聊里说过的话（包括以前的对话，不含我的回复），记下你在忙什么、到了哪一步，也会记下让你着急或开心的时刻，只用来把事办好。第一次整理在今晚，之后每天一次；整理要多调用模型，记下的内容只存在这台电脑上。",
            "建议保持开启。想看我记了什么、删掉某一条或者关掉，点上面的「主对话」→「它记得我什么」。",
        ]
        .join("\n\n")
    );
    for text in [MAIN_CHAT_GREETING_ZH, MAIN_CHAT_GREETING_EN] {
        assert_eq!(text.split("\n\n").count(), 3);
        assert!(!text.contains('\r'));
    }
    // The English one names the English UI's menu path.
    assert!(MAIN_CHAT_GREETING_EN.contains("“Main chat” → “What it remembers about me”"));
}

#[tokio::test]
async fn a_new_main_chat_opens_with_the_greeting_in_the_ui_language() {
    for (language, expected) in [
        (Some("zh-CN"), MAIN_CHAT_GREETING_ZH),
        (Some("zh"), MAIN_CHAT_GREETING_ZH),
        (Some("en-US"), MAIN_CHAT_GREETING_EN),
        (Some("fr-FR"), MAIN_CHAT_GREETING_EN),
        (None, MAIN_CHAT_GREETING_EN),
    ] {
        let galley = fresh_galley(RuntimeKind::Managed).await;
        let rec = Recorder::default();
        let main = desktop(&galley, &rec)
            .get_or_create_main_chat(gui(), language)
            .await
            .unwrap();
        assert!(matches!(main, MainChatEnsured::Created(_)));
        let id = main.into_brief().id;

        // Shown like any reply: an assistant row with its answer.
        let rows = galley.persisted_message_rows(&id).await.unwrap();
        assert_eq!(rows.len(), 1, "{language:?}");
        let row = &rows[0];
        assert_eq!(row.role, "assistant");
        assert_eq!(row.final_answer.as_deref(), Some(expected), "{language:?}");
        assert_eq!(row.content, expected);
        assert_eq!(row.visibility, "visible");
        assert_eq!(row.tool_calls, None);
        assert!(row.telemetry.is_none());
        // Marked by its origin; the CLI reads the same.
        assert_eq!(row.created_via.as_deref(), Some("system"));
        assert_eq!(
            row.supervisor.as_deref(),
            Some(MAIN_CHAT_GREETING_SUPERVISOR)
        );
        let cli = galley.session_messages(id.clone(), None).await.unwrap();
        assert_eq!(cli.len(), 1);
        assert_eq!(cli[0].role, MessageRole::Agent);
        assert_eq!(cli[0].origin.as_ref().unwrap().via, OriginVia::System);
    }
}

#[tokio::test]
async fn the_greeting_is_no_turn_and_never_history() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;

    // Not a turn: nothing completed, and the first message is turn 0.
    let brief = galley.session_brief(main.clone()).await.unwrap();
    assert_eq!(brief.turn_count, Some(0));
    let facts = galley.main_chat_segment_facts(&main).await.unwrap();
    assert_eq!(facts.next_turn_index, 0);
    assert!(!facts.ends_on_question);
    let sent = galley
        .send_message(main.clone(), "早".into(), gui())
        .await
        .unwrap();
    assert_eq!(sent.turn_index, Some(0));

    // Never replayed: the conversion skips it.
    let rows = galley.persisted_message_rows(&main).await.unwrap();
    assert_eq!(rows.len(), 2, "greeting + the user message");
    let replay: Vec<ReplayRow> = rows.into_iter().map(ReplayRow::from).collect();
    assert!(replay[0].shown_only);
    assert!(!replay[1].shown_only);
    // The trailing user message is dropped too, so nothing is left.
    assert!(rows_to_conversation_messages(replay, 1).is_empty());

    // Never read by the ledger: it reads what a human typed.
    let human = galley.ledger_human_turns("1970-01-01").await.unwrap();
    assert_eq!(human.len(), 1);
    assert_eq!(human[0].content, "早");

    // Searchable like any reply, so the launch backfill finds the index
    // complete and leaves it alone.
    assert_eq!(galley.backfill_fts_if_empty().await.unwrap(), 0);
}

#[tokio::test]
async fn creating_it_turns_the_ledger_on_with_the_first_run_at_the_next_four_oclock() {
    for (now, first) in [
        ("2026-10-12T10:30:00+08:00", "2026-10-13T04:00:00+08:00"),
        ("2026-10-12T02:15:00+08:00", "2026-10-12T04:00:00+08:00"),
    ] {
        let galley = fresh_galley(RuntimeKind::Managed).await;
        let rec = Recorder::default();
        desktop(&galley, &rec)
            .get_or_create_main_chat_at(gui(), Some("zh-CN"), at(now), &shanghai())
            .await
            .unwrap();
        let LedgerSwitch::On(config) = switch(&galley).await else {
            panic!("on by default ({now})")
        };
        assert_eq!(config.since.timestamp(), 0, "every earlier conversation");
        assert!(config.look_back);
        assert_eq!(config.not_before, Some(at(first)), "{now}");
    }
}

#[tokio::test]
async fn a_switch_already_set_is_left_alone() {
    let set = [
        LedgerSwitch::Off.to_pref().unwrap(),
        LedgerSwitch::turned_on(false, at("2026-10-01T09:00:00+08:00"))
            .to_pref()
            .unwrap(),
    ];
    for value in set {
        let galley = fresh_galley(RuntimeKind::Managed).await;
        galley
            .set_pref_json(SWITCH_PREF, value.clone())
            .await
            .unwrap();
        let rec = Recorder::default();
        main_chat(&galley, &rec).await;
        assert_eq!(
            galley.get_pref_json(SWITCH_PREF).await.unwrap(),
            Some(value)
        );
        assert_eq!(greetings(&galley).await, 1, "the greeting all the same");
    }
    // JSON null reads as never set, like no key.
    let galley = fresh_galley(RuntimeKind::Managed).await;
    galley
        .set_pref_json(SWITCH_PREF, Value::Null)
        .await
        .unwrap();
    main_chat(&galley, &Recorder::default()).await;
    assert!(switch(&galley).await.is_on());
}

#[tokio::test]
async fn only_a_creation_greets_or_sets_the_switch() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    assert_eq!(greetings(&galley).await, 1);

    // The user turned it off; the main chat is asked for again, then
    // archived through the CLI and restored.
    galley
        .set_pref_json(SWITCH_PREF, LedgerSwitch::Off.to_pref().unwrap())
        .await
        .unwrap();
    main_chat(&galley, &rec).await;
    Writes::new(&galley, &rec, "session.archive")
        .archive_session(main.clone(), gui())
        .await
        .unwrap();
    let back = desktop(&galley, &rec)
        .get_or_create_main_chat(gui(), Some("zh-CN"))
        .await
        .unwrap();
    assert!(matches!(back, MainChatEnsured::Restored(_)));
    assert_eq!(greetings(&galley).await, 1, "no second greeting");
    assert_eq!(switch(&galley).await, LedgerSwitch::Off, "still off");
}
