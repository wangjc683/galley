//! ChatGPT / Codex usage-limit messaging: query the wham usage endpoint
//! after a 429 and turn its rate-limit windows into a human-readable
//! "next reset in ..." message.

use std::time::Duration;

use chrono::{SecondsFormat, TimeZone, Utc};
use serde_json::Value;

use super::{CODEX_WHAM_USAGE_URL, WHAM_TIMEOUT_SECS};

pub(super) async fn fetch_codex_usage_limit_message(
    access_token: &str,
    account_id: Option<&str>,
) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(WHAM_TIMEOUT_SECS))
        .build()
        .ok()?;
    let mut req = client
        .get(CODEX_WHAM_USAGE_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "codex_cli_rs/0.0.0 (Galley)")
        .header("originator", "codex_cli_rs");
    if let Some(account_id) = account_id {
        req = req.header("ChatGPT-Account-ID", account_id);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: Value = resp.json().await.ok()?;
    codex_usage_limit_message_from_wham(&body, Utc::now().timestamp())
}

pub(super) fn codex_usage_limit_message_from_wham(body: &Value, now_ts: i64) -> Option<String> {
    let rate_limit = body
        .get("rate_limit")
        .or_else(|| body.get("rateLimit"))
        .unwrap_or(body);
    let limit_reached = bool_field(rate_limit, "limit_reached")
        .or_else(|| bool_field(rate_limit, "limitReached"))
        .or_else(|| bool_field(body, "limit_reached"))
        .or_else(|| bool_field(body, "limitReached"));
    let windows: Vec<CodexUsageWindow> = [
        "primary_window",
        "secondary_window",
        "primaryWindow",
        "secondaryWindow",
        "primary",
        "secondary",
    ]
    .into_iter()
    .filter_map(|key| rate_limit.get(key))
    .filter_map(|window| parse_codex_usage_window(window, now_ts))
    .collect();

    if limit_reached == Some(false) {
        return Some("Codex request was rate limited temporarily; retry shortly".into());
    }

    let exhausted_reset = windows
        .iter()
        .filter(|window| window.exhausted)
        .filter_map(|window| window.reset_at)
        .max();
    let fallback_reset = (limit_reached == Some(true))
        .then(|| windows.iter().filter_map(|window| window.reset_at).max())
        .flatten();
    let reset_at = exhausted_reset.or(fallback_reset)?;
    Some(format!(
        "Codex usage limit reached; next reset in {} ({})",
        format_reset_duration(reset_at, now_ts),
        format_reset_timestamp(reset_at)
    ))
}

#[derive(Debug, Clone, Copy)]
struct CodexUsageWindow {
    exhausted: bool,
    reset_at: Option<i64>,
}

fn parse_codex_usage_window(window: &Value, now_ts: i64) -> Option<CodexUsageWindow> {
    let used_percent = number_field(window, "used_percent")
        .or_else(|| number_field(window, "usedPercent"))
        .or_else(|| number_field(window, "usage_percent"))
        .or_else(|| number_field(window, "usagePercent"));
    let exhausted = used_percent
        .map(|percent| percent >= 100.0 || (percent - 1.0).abs() < f64::EPSILON)
        .unwrap_or(false);
    let reset_at = parse_reset_at(window, now_ts);
    if used_percent.is_none() && reset_at.is_none() {
        return None;
    }
    Some(CodexUsageWindow {
        exhausted,
        reset_at,
    })
}

fn parse_reset_at(window: &Value, now_ts: i64) -> Option<i64> {
    let reset_at = window
        .get("reset_at")
        .or_else(|| window.get("resetAt"))
        .and_then(parse_timestamp_value);
    if reset_at.is_some() {
        return reset_at;
    }
    let after_seconds = number_field(window, "reset_after_seconds")
        .or_else(|| number_field(window, "resetAfterSeconds"))
        .map(|seconds| seconds.max(0.0).ceil() as i64);
    after_seconds.map(|seconds| now_ts + seconds)
}

fn parse_timestamp_value(value: &Value) -> Option<i64> {
    if let Some(ts) = value.as_i64() {
        return Some(if ts > 10_000_000_000 { ts / 1000 } else { ts });
    }
    if let Some(ts) = value.as_f64() {
        let ts = if ts > 10_000_000_000.0 {
            ts / 1000.0
        } else {
            ts
        };
        return Some(ts.round() as i64);
    }
    let text = value.as_str()?.trim();
    if let Ok(ts) = text.parse::<i64>() {
        return Some(if ts > 10_000_000_000 { ts / 1000 } else { ts });
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.timestamp())
}

fn number_field(value: &Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn bool_field(value: &Value, key: &str) -> Option<bool> {
    match value.get(key)? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn format_reset_duration(reset_at: i64, now_ts: i64) -> String {
    let seconds = reset_at.saturating_sub(now_ts);
    if seconds < 60 {
        return "less than 1 minute".into();
    }
    let minutes = (seconds + 59) / 60;
    if minutes < 60 {
        return plural_duration(minutes, "minute");
    }
    let hours = minutes / 60;
    let remaining_minutes = minutes % 60;
    if remaining_minutes == 0 {
        plural_duration(hours, "hour")
    } else {
        format!(
            "{} {}",
            plural_duration(hours, "hour"),
            plural_duration(remaining_minutes, "minute")
        )
    }
}

fn plural_duration(value: i64, unit: &str) -> String {
    if value == 1 {
        format!("{value} {unit}")
    } else {
        format!("{value} {unit}s")
    }
}

fn format_reset_timestamp(reset_at: i64) -> String {
    match Utc.timestamp_opt(reset_at, 0).single() {
        Some(dt) => dt.to_rfc3339_opts(SecondsFormat::Secs, true),
        None => format!("unix {reset_at}"),
    }
}
