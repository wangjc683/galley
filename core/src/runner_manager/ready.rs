//! Per-runner cache of the latest `ready` report (ticket 02a, ruling 6 in
//! `.scratch/ios-client/issues/02-core-send-takeover.md`).
//!
//! A runner announces its model list, image capability and reasoning
//! effort once, on `ready` (`docs/ipc-protocol.md` §4.1), and revises
//! them on `llm_changed` (§4.12) and `reasoning_effort_changed` (§4.18).
//! A page that attaches after `ready` went by — a webview reload, a
//! runner some other caller started, a phone — never sees that event, so
//! Core keeps the folded state and hands it out on attach
//! (`ensure_session_runner`, `list_live_runners`).
//!
//! The stdout reader folds each event in **before** broadcasting it, so a
//! subscriber that has received an event can rely on the snapshot already
//! containing it. The cache dies with the process: it is cleared when the
//! child exits, and a respawn starts a fresh one.

use crate::ipc::{IpcEvent, ReadyEvent};
use serde_json::Value;

/// The runner's latest `ready`, folded with every later `llm_changed` /
/// `reasoning_effort_changed`. Same wire shape as the `ready` event
/// (camelCase, `availableLLMs`), without the `kind` tag — so a page
/// applies it through the store updates of its `ready` handler.
pub type ReadySnapshot = ReadyEvent;

/// Fold one runner event into the cache. Events other than the three
/// above leave it untouched; a revision that arrives before any `ready`
/// is dropped (there is nothing to revise yet).
pub(crate) fn fold(cache: &mut Option<ReadySnapshot>, event: &IpcEvent) {
    match event {
        IpcEvent::Ready(ready) => *cache = Some(ready.clone()),
        IpcEvent::LlmChanged(changed) => {
            let Some(snapshot) = cache.as_mut() else {
                return;
            };
            snapshot.llm_name = changed.name.clone();
            snapshot.images_supported = changed.images_supported;
            snapshot.reasoning_effort = changed.reasoning_effort.clone();
            snapshot.configured_reasoning_effort = changed.configured_reasoning_effort.clone();
            // Same rule as the GUI's `llm_changed` handler: the entry
            // whose index matches is current, every other one is not.
            for llm in &mut snapshot.available_llms {
                if let Some(entry) = llm.as_object_mut() {
                    let current = entry.get("index").and_then(Value::as_i64) == Some(changed.index);
                    entry.insert("isCurrent".into(), Value::Bool(current));
                }
            }
        }
        IpcEvent::ReasoningEffortChanged(changed) => {
            let Some(snapshot) = cache.as_mut() else {
                return;
            };
            snapshot.reasoning_effort = changed.reasoning_effort.clone();
            snapshot.configured_reasoning_effort = changed.configured_reasoning_effort.clone();
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::{LlmChangedEvent, ReasoningEffortChangedEvent};
    use serde_json::json;

    fn ready() -> IpcEvent {
        IpcEvent::Ready(ReadyEvent {
            session_id: "s1".into(),
            protocol_version: "0.1".into(),
            ga_commit: "abc".into(),
            ga_commit_date: "d".into(),
            ga_path: "/ga".into(),
            llm_name: "A/a".into(),
            cwd: "/".into(),
            pid: 7,
            available_llms: vec![
                json!({"index": 0, "name": "A/a", "displayName": "a", "isCurrent": true}),
                json!({"index": 1, "name": "B/b", "displayName": "b", "isCurrent": false}),
            ],
            images_supported: true,
            reasoning_effort: Some("high".into()),
            configured_reasoning_effort: Some("medium".into()),
            timestamp: "t".into(),
        })
    }

    #[test]
    fn ready_seeds_and_llm_changed_revises() {
        let mut cache = None;
        fold(&mut cache, &ready());
        assert_eq!(cache.as_ref().unwrap().llm_name, "A/a");

        fold(
            &mut cache,
            &IpcEvent::LlmChanged(LlmChangedEvent {
                session_id: "s1".into(),
                index: 1,
                name: "B/b".into(),
                display_name: "b".into(),
                images_supported: false,
                reasoning_effort: None,
                configured_reasoning_effort: Some("low".into()),
                timestamp: "t2".into(),
            }),
        );
        let snapshot = cache.as_ref().unwrap();
        assert_eq!(snapshot.llm_name, "B/b");
        assert!(!snapshot.images_supported);
        assert_eq!(snapshot.reasoning_effort, None);
        assert_eq!(snapshot.configured_reasoning_effort.as_deref(), Some("low"));
        assert_eq!(snapshot.available_llms[0]["isCurrent"], false);
        assert_eq!(snapshot.available_llms[1]["isCurrent"], true);
        // Untouched fields keep the `ready` values.
        assert_eq!(snapshot.ga_commit, "abc");
        assert_eq!(snapshot.timestamp, "t");
    }

    #[test]
    fn reasoning_effort_changed_revises_only_the_effort_pair() {
        let mut cache = None;
        fold(&mut cache, &ready());
        fold(
            &mut cache,
            &IpcEvent::ReasoningEffortChanged(ReasoningEffortChangedEvent {
                session_id: "s1".into(),
                reasoning_effort: Some("xhigh".into()),
                configured_reasoning_effort: Some("medium".into()),
                timestamp: "t2".into(),
            }),
        );
        let snapshot = cache.as_ref().unwrap();
        assert_eq!(snapshot.reasoning_effort.as_deref(), Some("xhigh"));
        assert_eq!(snapshot.llm_name, "A/a");
        assert_eq!(snapshot.available_llms[0]["isCurrent"], true);
    }

    #[test]
    fn revisions_before_ready_are_dropped() {
        let mut cache = None;
        fold(
            &mut cache,
            &IpcEvent::ReasoningEffortChanged(ReasoningEffortChangedEvent {
                session_id: "s1".into(),
                reasoning_effort: Some("xhigh".into()),
                configured_reasoning_effort: None,
                timestamp: "t".into(),
            }),
        );
        assert!(cache.is_none());
    }
}
