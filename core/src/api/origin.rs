use serde::{Deserialize, Serialize};

/// How a session command was triggered. Per PRD §8.3 — Galley records
/// this on every write so audit logs can distinguish human and agent
/// actions even after the fact.
///
/// Wire-level mapping (matches `messages.created_via` / `sessions.created_via`
/// SQL CHECK constraint in migrations 006/007):
///   - Gui        → user clicked Composer / used GUI controls
///   - Cli        → an agent invoked `galley` CLI
///   - Supervisor → a Supervisor SOP / agent acted through the socket
///     transport with an attached supervisor label
///   - System     → Galley itself injected the message (e.g. /btw replies,
///     system-level notifications)
///
/// B1 used a narrower {Manual, Cli} pair; B2 M5 widens it to match the
/// migrated schema. The `manual` wire value is no longer accepted — old
/// stored rows had defaults that resolved to `gui`, so the widening is
/// strictly additive at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginVia {
    /// Human-triggered through the GUI.
    Gui,
    /// Agent-triggered through `galley` CLI.
    Cli,
    /// Supervisor SOP / external agent through the socket transport.
    Supervisor,
    /// Galley itself (system messages, /btw replies, etc.).
    System,
}

impl OriginVia {
    /// SQL-friendly string. Matches the CHECK constraint on
    /// `messages.created_via` / `sessions.created_via`.
    pub fn as_sql(&self) -> &'static str {
        match self {
            Self::Gui => "gui",
            Self::Cli => "cli",
            Self::Supervisor => "supervisor",
            Self::System => "system",
        }
    }
}

/// Which app a human used for a write (iOS PRD ruling 9): stored in
/// `messages.client` / `sessions.client` (migration 043), next to `via`,
/// which keeps saying who acted (`gui` = a human). `None` — and the
/// column NULL — for everything no app stands behind: CLI, IM, agents,
/// schedules, Goal continuations, and rows older than the column. The
/// column has no CHECK, so a new client needs no table rebuild.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginClient {
    /// The Galley desktop window (its Tauri commands).
    Desktop,
    /// The iOS app, through the remote module (ticket 05b).
    Ios,
}

impl OriginClient {
    /// The stored value.
    pub fn as_sql(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Ios => "ios",
        }
    }
}

/// Metadata about the source of a command. Required on every B2+ write;
/// optional on the read APIs in B1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Origin {
    pub via: OriginVia,
    /// Free-text supervisor identifier when via=Cli or Supervisor
    /// ("ga-claude-1", "user@local"). None for Gui / System.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervisor: Option<String>,
    /// One-line reason from the agent for the action — surfaces in
    /// audit / log views.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The app behind a human's write ([`OriginClient`]), set by Core
    /// itself where the write comes in — the GUI's Tauri send / create
    /// commands, the remote module. Written to the `client` columns and
    /// carried with a queued message to its dispatch. Never on the wire:
    /// `Origin` is part of the CLI's JSON (Agent API, Rule 3), so the
    /// field is not serialized, and not deserialized either — no caller
    /// can claim a client. Not read back from the database.
    #[serde(skip)]
    pub client: Option<OriginClient>,
}

impl Origin {
    /// Convenience: GUI-originated write with no supervisor / reason.
    /// Use this when the write is in response to a user interaction in
    /// the Tauri front-end.
    pub fn gui() -> Self {
        Self {
            via: OriginVia::Gui,
            supervisor: None,
            reason: None,
            client: None,
        }
    }

    /// A human at the desktop window: [`Self::gui`] stamped with
    /// [`OriginClient::Desktop`]. For the GUI's writes that store a
    /// client — a sent message, a created session.
    pub fn desktop() -> Self {
        Self::gui().with_client(OriginClient::Desktop)
    }

    /// The same origin, stamped with the app the write came through.
    pub fn with_client(self, client: OriginClient) -> Self {
        Self {
            client: Some(client),
            ..self
        }
    }

    /// CLI-originated write. `supervisor` is the label the agent
    /// declared (`--supervisor=<x>`); `reason` is the `--reason=<y>`
    /// note.
    pub fn cli(supervisor: Option<String>, reason: Option<String>) -> Self {
        Self {
            via: OriginVia::Cli,
            supervisor,
            reason,
            client: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn via_as_sql_matches_check_constraint_values() {
        assert_eq!(OriginVia::Gui.as_sql(), "gui");
        assert_eq!(OriginVia::Cli.as_sql(), "cli");
        assert_eq!(OriginVia::Supervisor.as_sql(), "supervisor");
        assert_eq!(OriginVia::System.as_sql(), "system");
    }

    #[test]
    fn origin_serializes_snake_case_via() {
        let o = Origin::cli(Some("ga-1".into()), Some("auto-trigger".into()));
        let s = serde_json::to_string(&o).unwrap();
        assert!(s.contains("\"via\":\"cli\""));
        assert!(s.contains("\"supervisor\":\"ga-1\""));
        assert!(s.contains("\"reason\":\"auto-trigger\""));
    }

    #[test]
    fn origin_skips_null_optional_fields() {
        let o = Origin::gui();
        let s = serde_json::to_string(&o).unwrap();
        assert_eq!(s, r#"{"via":"gui"}"#);
    }

    #[test]
    fn client_is_never_on_the_wire() {
        // Not serialized: `Origin` is in the CLI's JSON (Rule 3).
        let o = Origin::desktop();
        assert_eq!(o.client, Some(OriginClient::Desktop));
        assert_eq!(serde_json::to_string(&o).unwrap(), r#"{"via":"gui"}"#);
        let o = Origin::cli(Some("ga-1".into()), None).with_client(OriginClient::Ios);
        assert!(!serde_json::to_string(&o).unwrap().contains("client"));
        // Not deserialized: a caller cannot claim one.
        let o: Origin = serde_json::from_str(r#"{"via":"gui","client":"ios"}"#).unwrap();
        assert_eq!(o.client, None);
    }

    #[test]
    fn client_sql_values() {
        assert_eq!(OriginClient::Desktop.as_sql(), "desktop");
        assert_eq!(OriginClient::Ios.as_sql(), "ios");
    }
}
