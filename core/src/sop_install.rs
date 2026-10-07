//! Bundled Galley Supervisor SOP content.
//!
//! Settings → Agent exposes this as a copyable document for the
//! user to hand to any supervisor agent. Galley deliberately does not
//! write it into GenericAgent `memory/`; the user decides where to
//! paste or install the SOP.

/// SOP body bundled into the Galley binary at build time. The source
/// file is the same one a developer reads in the repo, so there's no
/// drift risk: changing the SOP requires editing this document, which
/// automatically updates the embedded body on the next `cargo build`.
const SOP_BODY: &str = include_str!("../../docs/integrations/galley-supervisor-sop.md");

/// The longer reference the SOP links to as a sibling file
/// (`./galley-supervisor-reference.md`, e.g. for the canonical Boundaries
/// list). Only the managed IM reference directory ships it next to the SOP;
/// "Copy SOP" stays the SOP alone.
const REFERENCE_BODY: &str = include_str!("../../docs/integrations/galley-supervisor-reference.md");

/// Read the embedded SOP body for preview / copy surfaces.
pub fn sop_body() -> &'static str {
    SOP_BODY
}

/// Read the embedded Supervisor reference body.
pub fn reference_body() -> &'static str {
    REFERENCE_BODY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_body_is_non_empty() {
        assert!(
            sop_body().len() > 1024,
            "SOP body looks suspiciously short: {} bytes",
            sop_body().len()
        );
    }

    #[test]
    fn embedded_body_is_copy_first_not_ga_memory_install() {
        let body = sop_body();
        assert!(body.contains("Copy this SOP"));
        assert!(!body.contains("This file lives in your GA `memory/`"));
    }
}
