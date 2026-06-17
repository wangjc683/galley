use crate::api::RuntimeKind;
use crate::error::GalleyError;

pub const GALLEY_NATIVE_EXPERIMENTAL_ENV: &str = "GALLEY_NATIVE_EXPERIMENTAL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeRoute {
    PythonGa(RuntimeKind),
    GalleyNative,
}

pub fn route_for_runtime(kind: RuntimeKind) -> RuntimeRoute {
    match kind {
        RuntimeKind::Managed | RuntimeKind::External => RuntimeRoute::PythonGa(kind),
        RuntimeKind::GalleyNative => RuntimeRoute::GalleyNative,
    }
}

pub fn galley_native_experimental_enabled() -> bool {
    true
}

pub fn galley_native_enabled_from_value(raw: Option<&str>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn galley_native_execution_unavailable_message() -> String {
    "galley_native runtime is recognized, but it does not use the Python GenericAgent runner"
        .to_string()
}

pub fn ensure_runtime_filter_available(_kind: RuntimeKind) -> Result<(), GalleyError> {
    Ok(())
}

pub fn ensure_runtime_execution_available(_kind: RuntimeKind) -> Result<(), GalleyError> {
    Ok(())
}

pub fn ensure_goal_runtime_available(kind: RuntimeKind) -> Result<(), GalleyError> {
    ensure_runtime_filter_available(kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_gate_parser_accepts_only_truthy_values() {
        assert!(galley_native_enabled_from_value(Some("1")));
        assert!(galley_native_enabled_from_value(Some("true")));
        assert!(galley_native_enabled_from_value(Some("YES")));
        assert!(galley_native_enabled_from_value(Some(" on ")));

        assert!(!galley_native_enabled_from_value(None));
        assert!(!galley_native_enabled_from_value(Some("")));
        assert!(!galley_native_enabled_from_value(Some("0")));
        assert!(!galley_native_enabled_from_value(Some("false")));
    }

    #[test]
    fn native_runtime_is_available_without_env_gate() {
        assert!(galley_native_experimental_enabled());
        assert!(ensure_runtime_filter_available(RuntimeKind::GalleyNative).is_ok());
        assert!(ensure_runtime_execution_available(RuntimeKind::GalleyNative).is_ok());
        assert!(ensure_goal_runtime_available(RuntimeKind::GalleyNative).is_ok());
    }

    #[test]
    fn route_keeps_python_ga_separate_from_native() {
        assert_eq!(
            route_for_runtime(RuntimeKind::Managed),
            RuntimeRoute::PythonGa(RuntimeKind::Managed)
        );
        assert_eq!(
            route_for_runtime(RuntimeKind::External),
            RuntimeRoute::PythonGa(RuntimeKind::External)
        );
        assert_eq!(
            route_for_runtime(RuntimeKind::GalleyNative),
            RuntimeRoute::GalleyNative
        );
    }
}
