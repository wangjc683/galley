//! Affairs-ledger eval helper (.scratch/main-chat/ledger-eval/, ticket
//! 04): print what the Memory page's parser makes of a `history_insight`
//! directory, so `run_eval.py`'s checker reads the outputs' regions the
//! way the page does instead of guessing from headings. Development
//! only: an example is in no build that ships. Reads, never writes.
//!
//! ```text
//! cargo run --manifest-path core/Cargo.toml -p galley-core --example ledger_parse -- <history_insight dir>
//! ```
//!
//! Prints one JSON object: `{"activities": Parsed, "affairsRaw":
//! "<ongoing_affairs.md>" | null, "affairs": "<the short list as
//! injected>" | null}` (`activities` shaped as in `get_memory_overview`,
//! each entry carrying its emotions since ticket 04d).

use std::path::PathBuf;

use galley_core_lib::ledger::{affairs, entries};
use serde_json::json;

fn main() {
    let Some(dir) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("ledger_parse: give the history_insight directory");
        std::process::exit(2);
    };
    let raw_list = std::fs::read_to_string(dir.join("ongoing_affairs.md")).ok();
    let injected = raw_list
        .as_deref()
        .and_then(|raw| affairs::cap_affairs(raw, affairs::AFFAIRS_CAP_BYTES));
    let out = json!({
        "activities": entries::read_activities(&dir.join("activities.md")),
        "affairsRaw": raw_list,
        "affairs": injected,
    });
    println!("{out}");
}
