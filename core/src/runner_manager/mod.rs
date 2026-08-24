//! Galley runner subprocess ownership — production code path from B2 M1 onward.
//!
//! ## What this module owns
//!
//! Every Python `runner.workbench_bridge` subprocess that backs an active
//! Galley session. From spawn → stdin command dispatch → stdout event broadcast
//! → graceful shutdown / forced kill. The TypeScript side ([`gui/src/lib/bridge.ts`])
//! is being thinned to an `invoke()` shim against this module in [B2 M2].
//!
//! ## History
//!
//! Ported from [`core/experiments/bridge-owner/registry.rs`] — the throwaway
//! prototype that validated Rust-owned subprocess ownership against 17
//! checklist items (Prototype phase, 2026-05-18). The prototype's
//! `BridgeProcess` is the source pattern for this module's [`RunnerProcess`].
//! Renamed at port time: `BridgeProcess` → `RunnerProcess` to match the
//! `runner/` directory rename + the [PRD §5 path-B vocabulary](../../../docs/PRD.md).
//!
//! ## Layout
//!
//! - [`process`]: a single subprocess + its stdin/stdout/stderr + the
//!   broadcast channel that fans events out to subscribers
//! - [`manager`]: the multi-session orchestrator (keyed by `session_id`) with
//!   LRU eviction
//! - [`error`]: typed errors for spawn / send / shutdown paths
//!
//! ## Lifetime contract (B2-I6 / invariants.md I11)
//!
//! Subprocesses are spawned with `kill_on_drop(true)`. The host Cargo profile
//! must keep `panic = "unwind"` (default) so a panic in the main thread runs
//! every [`RunnerProcess`]'s `Drop` and SIGKILLs the child cleanly — otherwise
//! orphans get reparented to init. See [`docs/refactor/invariants.md#i11`].

pub mod error;
pub mod manager;
pub mod process;
pub mod queue;

pub use error::{RunnerSpawnError, SendCommandError, ShutdownError};
pub use manager::{RunSignal, RunState, RunnerManager, SpawnArgs};
pub use process::{BroadcastItem, RunnerProcess};
pub use queue::{QueueJump, QueueOffer};
