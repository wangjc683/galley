//! The mining run's input — the batch file that stands in for upstream's
//! `all_histories.txt` — and the task that points the run at it.
//!
//! The batch holds only what the human said, grouped the way the SOP
//! reads: one group per Galley session (its id is the session
//! identifier findings cite), one group per IM channel and local day
//! (`im-<channel>-<YYYY-MM-DD>`, traceable in the archive). Groups are
//! ordered by their first turn; a group is never split.

use std::collections::BTreeMap;
use std::fmt::Display;

use chrono::{DateTime, FixedOffset, TimeZone, Utc};

use super::sources::GuiTurn;
use super::LedgerPaths;
use crate::ledger::im_archive::ImRecord;

const RULE: &str = "============================================================";

/// One group of turns: a Galley session, or one IM channel's day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    /// The session identifier findings cite.
    pub id: String,
    /// One line saying where the words were said.
    pub source: String,
    /// `(local time, words)`, oldest first.
    pub turns: Vec<(String, String)>,
    first: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    pub groups: Vec<Group>,
    pub turn_count: usize,
    /// Local times of the first and last turn.
    pub span: Option<(String, String)>,
}

impl Batch {
    pub fn is_empty(&self) -> bool {
        self.turn_count == 0
    }
}

fn channel_label(channel: Option<&str>) -> &str {
    match channel {
        Some("wechat") => "微信",
        Some("feishu") => "飞书",
        Some("telegram") => "Telegram",
        Some("discord") => "Discord",
        Some(other) => other,
        None => "渠道未知",
    }
}

fn local_minute<Tz: TimeZone>(at: &DateTime<Utc>, tz: &Tz) -> String
where
    Tz::Offset: Display,
{
    at.with_timezone(tz).format("%Y-%m-%d %H:%M").to_string()
}

/// Group GUI turns by session and IM records by channel and local day.
/// IM records whose time does not parse are dropped (logged).
pub fn build_batch<Tz: TimeZone>(gui: &[GuiTurn], im: &[ImRecord], tz: &Tz) -> Batch
where
    Tz::Offset: Display,
{
    // BTreeMap only for determinism; the final order is by first turn.
    let mut groups: BTreeMap<String, (String, Vec<(DateTime<Utc>, String)>)> = BTreeMap::new();
    for turn in gui {
        groups
            .entry(turn.session_id.clone())
            .or_insert_with(|| ("Galley 会话".to_string(), Vec::new()))
            .1
            .push((turn.at, turn.text.clone()));
    }
    for record in im {
        let Ok(at) = DateTime::<FixedOffset>::parse_from_rfc3339(&record.at) else {
            eprintln!(
                "[ledger] skipping an IM record with an unreadable time: {:?}",
                record.at
            );
            continue;
        };
        let at = at.with_timezone(&Utc);
        let day = at.with_timezone(tz).format("%Y-%m-%d").to_string();
        let channel = record.channel.as_deref().unwrap_or("unknown");
        let id = format!("im-{channel}-{day}");
        let source = format!(
            "IM 私聊 · {} · {day}",
            channel_label(record.channel.as_deref())
        );
        groups
            .entry(id)
            .or_insert_with(|| (source, Vec::new()))
            .1
            .push((at, record.text.clone()));
    }

    let mut out: Vec<Group> = groups
        .into_iter()
        .map(|(id, (source, mut turns))| {
            turns.sort_by_key(|(at, _)| *at);
            let first = turns[0].0;
            Group {
                id,
                source,
                turns: turns
                    .into_iter()
                    .map(|(at, text)| (local_minute(&at, tz), text))
                    .collect(),
                first,
            }
        })
        .collect();
    out.sort_by(|a, b| a.first.cmp(&b.first).then_with(|| a.id.cmp(&b.id)));

    let turn_count = out.iter().map(|g| g.turns.len()).sum();
    let mut stamps = out
        .iter()
        .flat_map(|g| g.turns.iter().map(|(t, _)| t.clone()));
    let span = stamps.next().map(|first| {
        let (min, max) = stamps.fold((first.clone(), first), |(lo, hi), t| {
            (lo.min(t.clone()), hi.max(t))
        });
        (min, max)
    });
    Batch {
        groups: out,
        turn_count,
        span,
    }
}

/// The batch file's text.
pub fn render_batch(batch: &Batch, generated_at: &str) -> String {
    let mut out = String::new();
    out.push_str("# Galley 事项账本输入批次\n\n");
    out.push_str(&format!(
        "生成于 {generated_at}（本机时间）。只含用户本人说过的话：Galley 会话里用户发的消息，IM 私聊里用户发的消息。助理的回复、工具输出、其他 agent 或自动化写的消息都不在其中。\n"
    ));
    if let Some((first, last)) = &batch.span {
        out.push_str(&format!(
            "共 {} 个会话，{} 条用户消息，时间 {first} 至 {last}。\n",
            batch.groups.len(),
            batch.turn_count
        ));
    }
    for group in &batch.groups {
        out.push_str(&format!(
            "\n{RULE}\nSESSION: {}\n来源：{}\n{RULE}\n",
            group.id, group.source
        ));
        for (at, text) in &group.turns {
            // Continuation lines are indented so every turn starts a line
            // with its time.
            let text = text.trim().replace('\n', "\n  ");
            out.push_str(&format!("[{at}] {text}\n"));
        }
    }
    out
}

/// The task the hidden mining session is given. Kept under GA's
/// 2000-character long-prompt threshold (`agentmain.run`), so the model
/// reads it as written.
pub fn task_prompt(paths: &LedgerPaths, batch: &Batch) -> String {
    let span = batch
        .span
        .as_ref()
        .map(|(a, b)| format!("{a} 至 {b}"))
        .unwrap_or_default();
    format!(
        "这是 Galley 每天一次的事项账本整理，在后台运行，没有人会回答问题，不要调用 ask_user。\n\
         \n\
         先完整读一遍历史重点挖掘 SOP：{sop}\n\
         按它的提取标准与产物要求执行（持续活动、已消失事项、情绪事件；增量；读原文），只有下面几点替代 SOP 里对应的写法：\n\
         \n\
         1. 数据源：读 {batch_file}。不要读或生成 all_histories.txt，不要运行 compress_session.py。这个文件只有用户本人说过的话，按会话分组，带会话标识与时间。\n\
         2. 产物目录：{insight}（绝对路径，代替 SOP 里的 ./history_insight/）。先读已有产物，再增量更新。\n\
         3. 增量标记由 Galley 记录：这个文件就是全部新增内容。{galley} 归 Galley 所有，只读，不要改动其中任何文件。\n\
         4. 会话标识用批次里 SESSION 行的标识（Galley 会话 id，或 im-渠道-日期），代替 SOP 里的 L4 文件名。\n\
         5. 测试产品、调试工具的对话不算生活事项的证据（例如测模型是哪个、测记忆、让它记暗号、测连通性），不要据此建条目或标情绪。\n\
         6. 只写上面的产物目录：不要调用 start_long_term_update，不要改全局记忆或其他 SOP（账本何时进入对话由 Galley 决定）。\n\
         \n\
         本批次：{groups} 个会话，{turns} 条用户消息，{span}。完成后用一两句话说明更新了哪些文件。",
        sop = paths.sop_file().display(),
        batch_file = paths.batch_file().display(),
        insight = paths.insight_dir().display(),
        galley = paths.galley_dir().display(),
        groups = batch.groups.len(),
        turns = batch.turn_count,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shanghai() -> FixedOffset {
        FixedOffset::east_opt(8 * 3600).unwrap()
    }

    fn gui(session: &str, at: &str, text: &str) -> GuiTurn {
        GuiTurn {
            session_id: session.into(),
            message_id: format!("{session}-{at}"),
            at: at.parse().unwrap(),
            text: text.into(),
        }
    }

    fn im(at: &str, channel: Option<&str>, text: &str) -> ImRecord {
        ImRecord {
            at: at.into(),
            channel: channel.map(str::to_string),
            log: "model_responses_1.txt".into(),
            text: text.into(),
        }
    }

    #[test]
    fn groups_by_session_and_by_im_channel_day_in_first_turn_order() {
        let batch = build_batch(
            &[
                gui("s-b", "2026-10-11T02:00:00Z", "B 的第一句"),
                gui("s-a", "2026-10-11T01:00:00Z", "A 的第一句"),
                gui("s-a", "2026-10-11T05:00:00Z", "A 的第二句"),
            ],
            &[
                im("2026-10-11T21:30:00+08:00", Some("feishu"), "晚上在飞书说"),
                im("2026-10-11T08:30:00+08:00", Some("feishu"), "早上在飞书说"),
                im("2026-10-12T00:10:00+08:00", Some("feishu"), "过了零点"),
                im("2026-10-11T12:00:00+08:00", None, "不知道哪个渠道"),
            ],
            &shanghai(),
        );
        let ids: Vec<_> = batch.groups.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "im-feishu-2026-10-11",
                "s-a",
                "s-b",
                "im-unknown-2026-10-11",
                "im-feishu-2026-10-12"
            ]
        );
        assert_eq!(batch.turn_count, 7);
        assert_eq!(
            batch.groups[0].turns,
            vec![
                ("2026-10-11 08:30".to_string(), "早上在飞书说".to_string()),
                ("2026-10-11 21:30".to_string(), "晚上在飞书说".to_string()),
            ]
        );
        assert_eq!(batch.groups[1].turns[0].0, "2026-10-11 09:00");
        assert_eq!(
            batch.span,
            Some(("2026-10-11 08:30".into(), "2026-10-12 00:10".into()))
        );
    }

    #[test]
    fn renders_session_headers_and_keeps_each_turn_on_its_own_time_line() {
        let batch = build_batch(
            &[gui("s-a", "2026-10-11T01:00:00Z", "第一行\n第二行")],
            &[im("2026-10-11T21:30:00+08:00", Some("wechat"), "微信里说")],
            &shanghai(),
        );
        let text = render_batch(&batch, "2026-10-12 04:00");
        assert!(text.contains("SESSION: s-a\n来源：Galley 会话\n"));
        assert!(text.contains("[2026-10-11 09:00] 第一行\n  第二行\n"));
        assert!(text.contains("SESSION: im-wechat-2026-10-11\n来源：IM 私聊 · 微信 · 2026-10-11\n"));
        assert!(text.contains("共 2 个会话，2 条用户消息"));
    }

    #[test]
    fn an_empty_batch_is_empty() {
        let batch = build_batch(&[], &[], &shanghai());
        assert!(batch.is_empty());
        assert_eq!(batch.span, None);
    }

    #[test]
    fn the_task_names_absolute_paths_the_galley_rule_and_stays_short() {
        let paths = LedgerPaths::new(
            "/Users/someone/Library/Application Support/app.galley/managed-ga-state".into(),
        );
        let batch = build_batch(
            &[gui("s-a", "2026-10-11T01:00:00Z", "一句")],
            &[],
            &shanghai(),
        );
        let task = task_prompt(&paths, &batch);
        assert!(task.contains("/managed-ga-state/memory/L4_raw_sessions/salient_mining_sop.md"));
        assert!(task.contains("/managed-ga-state/memory/history_insight/galley/batch.md"));
        assert!(task.contains("/managed-ga-state/memory/history_insight（绝对路径"));
        assert!(task.contains("测试产品、调试工具的对话不算生活事项的证据"));
        assert!(task.contains("不要调用 start_long_term_update"));
        assert!(!task.starts_with(crate::ledger::im_archive::FILE_HINT));
        assert!(task.chars().count() < 2000, "{}", task.chars().count());
    }
}
