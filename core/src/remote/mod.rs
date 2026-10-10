//! Remote access for paired phones (ticket 05b,
//! `.scratch/ios-client/issues/05-remote-protocol-design.md` §2, §5–§7).
//!
//! Core never listens on the network (Rule 2). This module connects
//! *outward* to the relay over WSS, as the channel's `host`, and serves
//! the phones the relay routes to it — each over its own end-to-end
//! `Noise_NNpsk0` session, so the relay sees ciphertext and routing
//! metadata only. The wire formats are `galley_remote_protocol`'s; nothing
//! here re-implements one.
//!
//! | Piece | Module |
//! |---|---|
//! | relay URL, the desktop's name, timings and limits | [`config`] |
//! | the connection: reconnects, heartbeat, frames, fan-out | `connection` |
//! | one phone: Noise session, reassembly, bounded out-queue | `phone` |
//! | the methods of design §6.3 | `methods` |
//! | Core types → the phone's types | `convert` |
//! | Core events → phone events: sink, filter, 100 ms batching | `events` |
//! | APNs device tokens and the push counter | [`push`] |
//!
//! Lifecycle: the app builds one [`RemoteModule`] when a relay URL is
//! configured ([`RemoteModule::for_app`]) and starts it at launch only if
//! this desktop is paired (a pairing master key is stored,
//! [`crate::remote_pairing`]). The settings page (ticket 05d) drives
//! [`RemoteModule::pair`] / [`RemoteModule::cancel_pairing`] /
//! [`RemoteModule::unpair`] / [`RemoteModule::status`] through the Tauri
//! commands in `commands/remote.rs` — Tauri only: pairing shows the master
//! key, so no socket or CLI path reaches it; the tray's quit stops it.
//! While running it registers its event sink with [`crate::notify`], so
//! every `TauriNotifier` emit can reach the phones, and announces its own
//! state as [`REMOTE_STATUS_EVENT`].
//!
//! Pairing (design §3.1): the first pairing makes a key that lives only in
//! memory while the module connects and waits for a phone (`pairing` in
//! the status). The first phone to complete its handshake makes it real:
//! the key is stored and the desktop is paired. Until then cancelling
//! ([`RemoteModule::cancel_pairing`], the page hiding its code) or
//! [`RemoteTuning::pairing_timeout`] without a phone disconnects and
//! forgets the key, so a code shown and never scanned leaves nothing
//! behind. Pairing, cancelling, unpairing, starting and stopping take one
//! lock in turn, so none of them sees another half done.
//!
//! Logs name peers by the relay's number and never carry keys, the QR
//! string, plaintext or message content.

pub mod config;
mod connection;
mod convert;
mod events;
mod methods;
mod phone;
pub mod push;

pub use config::{
    desktop_name, relay_url_from_env, resolve_relay_url, RemoteConfig, RemoteTuning,
    PAIRING_TIMEOUT, RELAY_URL_ENV,
};
pub use methods::{SESSION_NOT_MANAGED, TOO_MANY_SUBSCRIPTIONS, VIA_IOS};

use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::notify::{notify, Notifier, RemoteEventSink};
use crate::remote_pairing::{self, PairingMasterKey};
use crate::session_runner::SpawnEnv;
use crate::socket_listener::RunnerPort;
use connection::{Control, RunCtx};
use events::{EventSink, PhoneFilter};
use galley_remote_protocol::app::{CoreHello, PROTOCOL_VERSION};
use galley_remote_protocol::frame::{device_token_from_hex, PushPriority, PushRequest};
use galley_remote_protocol::keys::{MasterKey, PairingCode, PushKey};
use galley_remote_protocol::noise::CloseReason;
use galley_remote_protocol::push::{self as push_seal, PushContent, PushError};
use serde::Serialize;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use zeroize::Zeroizing;

/// Tauri event carrying [`RemoteStatus`] whenever it changes.
pub const REMOTE_STATUS_EVENT: &str = "remote-status";

/// How long [`RemoteModule::stop`] waits for the connection to say
/// goodbye before abandoning it.
const STOP_TIMEOUT: Duration = Duration::from_secs(3);

/// What the module calls into.
#[derive(Clone)]
pub struct RemoteDeps {
    pub galley: SqliteGalley,
    pub runner: Arc<dyn RunnerPort>,
    /// Broadcasts for the phone's writes (sends, creates) — the app's
    /// `TauriNotifier`, so the desktop and the other phones hear them —
    /// and [`REMOTE_STATUS_EVENT`].
    pub notifier: Arc<dyn Notifier>,
    /// For starting managed runners (`None` refuses them, as headless
    /// dispatch does).
    pub env: Option<Arc<dyn SpawnEnv>>,
}

/// The module's state for the settings page (ticket 05d).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    /// A pairing master key is stored (the module connects at launch only
    /// then).
    pub paired: bool,
    /// A new pairing code is out and waiting for its first phone: the key
    /// is only in memory, the module is connected for it. Never together
    /// with `paired`.
    pub pairing: bool,
    /// Storing the key failed when a phone answered the pending code (the
    /// phone was not let in; the code stays valid). Cleared when the
    /// pairing ends or a new one starts.
    pub pairing_error: Option<String>,
    /// The WebSocket to the relay is up.
    pub relay_connected: bool,
    /// Phones with an established end-to-end session.
    pub online_phones: u32,
    /// ISO 8601: the last time a phone completed its handshake, in this
    /// Core process.
    pub last_phone_connected_at: Option<String>,
}

/// [`RemoteStatus`] plus its change announcement.
pub(crate) struct StatusCell {
    status: Mutex<RemoteStatus>,
    notifier: Arc<dyn Notifier>,
}

impl StatusCell {
    fn new(notifier: Arc<dyn Notifier>) -> Self {
        Self {
            status: Mutex::new(RemoteStatus::default()),
            notifier,
        }
    }

    fn get(&self) -> RemoteStatus {
        self.status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Change the status; announce it if it changed.
    pub(crate) fn update(&self, change: impl FnOnce(&mut RemoteStatus)) {
        let changed = {
            let mut status = self.status.lock().unwrap_or_else(PoisonError::into_inner);
            let before = status.clone();
            change(&mut status);
            (*status != before).then(|| status.clone())
        };
        if let Some(status) = changed {
            notify(self.notifier.as_ref(), REMOTE_STATUS_EVENT, &status);
        }
    }
}

/// Why a remote operation failed.
#[derive(Debug)]
pub enum RemoteError {
    /// Reading or writing the pairing key or prefs failed.
    Db(GalleyError),
    /// The pairing code could not be built (a desktop name it rejects).
    Pairing(String),
    /// The module is not running (not paired, or stopped).
    NotRunning,
    /// Running, but the relay is not connected right now.
    RelayOffline,
    /// The push content breaks a rule (`kind`, `sessionId`).
    Push(PushError),
}

impl RemoteError {
    /// Stable tag, for the settings page's commands.
    pub fn tag(&self) -> &'static str {
        match self {
            RemoteError::Db(_) => "db",
            RemoteError::Pairing(_) => "pairing",
            RemoteError::NotRunning => "remote_not_running",
            RemoteError::RelayOffline => "relay_offline",
            RemoteError::Push(_) => "push_invalid",
        }
    }
}

impl fmt::Display for RemoteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RemoteError::Db(e) => write!(f, "{}: {e}", self.tag()),
            RemoteError::Pairing(e) => write!(f, "{}: {e}", self.tag()),
            RemoteError::Push(e) => write!(f, "{}: {e}", self.tag()),
            RemoteError::NotRunning | RemoteError::RelayOffline => f.write_str(self.tag()),
        }
    }
}

impl std::error::Error for RemoteError {}

impl From<GalleyError> for RemoteError {
    fn from(e: GalleyError) -> Self {
        RemoteError::Db(e)
    }
}

/// The pairing QR string (`galley-pair:1?relay=…&mk=…&name=…`). It holds
/// the master key: show it on screen, never log or store it. Zeroed on
/// drop; `Debug` hides it.
pub struct PairingQr(Zeroizing<String>);

impl PairingQr {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The QR code as an SVG image, for the settings page (ticket 05d):
    /// black modules on white, the standard 4-module quiet zone (so it
    /// scans on a dark page too), one SVG unit per module (the page
    /// scales it), error correction M. The string itself is not in it as
    /// text, so the page never holds it.
    pub fn to_svg(&self) -> Result<String, RemoteError> {
        use qrcode::render::svg;
        let code =
            qrcode::QrCode::with_error_correction_level(self.0.as_bytes(), qrcode::EcLevel::M)
                // The error names the limit, never the data.
                .map_err(|e| RemoteError::Pairing(format!("QR code: {e}")))?;
        Ok(code
            .render::<svg::Color<'_>>()
            .module_dimensions(1, 1)
            .quiet_zone(true)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build())
    }
}

impl fmt::Debug for PairingQr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PairingQr(..)")
    }
}

/// A pairing whose key is not stored yet. Dropping it zeroes the key.
struct Pending {
    id: u64,
    key: PairingMasterKey,
    /// Ends the pairing after [`RemoteTuning::pairing_timeout`].
    timeout: JoinHandle<()>,
}

/// The pending pairing, if any. Its lock is the lifecycle lock: pairing,
/// cancelling, unpairing, starting and stopping hold it throughout.
type PairingSlot = Arc<tokio::sync::Mutex<Option<Pending>>>;

/// What a connection run for a new pairing calls when a phone completes
/// its handshake: store the key, once.
pub(crate) struct PairingGate {
    id: u64,
    confirmed: AtomicBool,
    slot: PairingSlot,
    galley: SqliteGalley,
    status: Arc<StatusCell>,
}

impl PairingGate {
    /// The key is stored: phones need not wait any more.
    pub(crate) fn is_confirmed(&self) -> bool {
        self.confirmed.load(Ordering::Acquire)
    }

    /// Store this pairing's key, making the desktop paired. `Err` when
    /// the pairing ended first (cancelled, timed out, unpaired) or the
    /// write failed; then the phone is not let in. A failed write keeps
    /// the pairing and its code (the next phone tries again) and says so
    /// in the status.
    pub(crate) async fn confirm(&self) -> Result<(), &'static str> {
        if self.is_confirmed() {
            return Ok(());
        }
        let mut slot = self.slot.lock().await;
        if self.is_confirmed() {
            return Ok(());
        }
        let Some(pending) = slot.as_ref().filter(|pending| pending.id == self.id) else {
            return Err("the pairing ended");
        };
        if let Err(e) = remote_pairing::store_master_key(&self.galley, &pending.key).await {
            // The error names the store, never the key.
            eprintln!("[remote] saving the pairing key failed: {e}");
            let error = e.to_string();
            self.status.update(|s| s.pairing_error = Some(error));
            return Err("the pairing key could not be saved");
        }
        let pending = slot.take().expect("checked above");
        pending.timeout.abort();
        self.confirmed.store(true, Ordering::Release);
        self.status.update(|s| {
            s.paired = true;
            s.pairing = false;
            s.pairing_error = None;
        });
        Ok(())
    }
}

/// A running connection task and what talks to it.
struct Running {
    control: mpsc::Sender<Control>,
    supervisor: JoinHandle<()>,
    mapper: JoinHandle<()>,
    sink: Arc<EventSink>,
    push_key: PushKey,
}

struct Shared {
    deps: RemoteDeps,
    config: RemoteConfig,
    status: Arc<StatusCell>,
    run: tokio::sync::Mutex<Option<Running>>,
    pairing: PairingSlot,
    pairing_ids: AtomicU64,
    generations: Arc<AtomicU64>,
    push_request_ids: AtomicU32,
}

/// Galley's remote module. Cheap to clone; every clone is the same
/// module.
#[derive(Clone)]
pub struct RemoteModule {
    shared: Arc<Shared>,
}

impl RemoteModule {
    pub fn new(deps: RemoteDeps, config: RemoteConfig) -> Self {
        let status = Arc::new(StatusCell::new(deps.notifier.clone()));
        Self {
            shared: Arc::new(Shared {
                deps,
                config,
                status,
                run: tokio::sync::Mutex::new(None),
                pairing: Arc::new(tokio::sync::Mutex::new(None)),
                pairing_ids: AtomicU64::new(1),
                generations: Arc::new(AtomicU64::new(1)),
                push_request_ids: AtomicU32::new(1),
            }),
        }
    }

    /// The app's module, or `None` when no relay URL is configured (or
    /// the configured one is invalid): then remote access does not exist
    /// in this build.
    pub fn for_app(app: &tauri::AppHandle) -> Option<Self> {
        use tauri::Manager;
        let relay = match relay_url_from_env() {
            Ok(Some(relay)) => relay,
            Ok(None) => return None,
            Err(e) => {
                eprintln!("[remote] {RELAY_URL_ENV} is invalid ({e}); remote access is off");
                return None;
            }
        };
        let deps = RemoteDeps {
            galley: app.state::<SqliteGalley>().inner().clone(),
            runner: app
                .state::<Arc<crate::runner_manager::RunnerManager>>()
                .inner()
                .clone(),
            notifier: crate::notify::TauriNotifier::new(app.clone()),
            env: Some(Arc::new(app.clone())),
        };
        Some(Self::new(deps, RemoteConfig::new(relay)))
    }

    /// Start if this desktop is paired (a key is stored; a pairing that
    /// never got its first phone died with the process). Returns whether
    /// it is running.
    pub async fn start_if_paired(&self) -> Result<bool, RemoteError> {
        let _lifecycle = self.shared.pairing.lock().await;
        let Some(key) = remote_pairing::read_master_key(&self.shared.deps.galley).await? else {
            self.shared.status.update(|s| s.paired = false);
            return Ok(false);
        };
        self.start_with(&key, None).await;
        Ok(true)
    }

    /// The QR string for a phone to scan, making sure the connection runs.
    ///
    /// - Paired: the stored key (Add a phone), so phones already paired
    ///   stay connected; nothing expires.
    /// - Not paired: a new key, kept only in memory while the module
    ///   connects and waits for the first phone (`pairing`); the first
    ///   phone to complete its handshake stores it. Asking again while it
    ///   waits shows the same code. Without a phone it ends after
    ///   [`RemoteTuning::pairing_timeout`], or on [`Self::cancel_pairing`].
    pub async fn pair(&self) -> Result<PairingQr, RemoteError> {
        let shared = &self.shared;
        let mut slot = shared.pairing.lock().await;
        if let Some(key) = remote_pairing::read_master_key(&shared.deps.galley).await? {
            let qr = self.qr_for(&key)?;
            self.start_with(&key, None).await;
            return Ok(qr);
        }
        if let Some(pending) = slot.as_ref() {
            return self.qr_for(&pending.key);
        }
        let key = remote_pairing::generate_master_key()?;
        // Built first: a desktop name the code rejects starts nothing.
        let qr = self.qr_for(&key)?;
        let id = shared.pairing_ids.fetch_add(1, Ordering::Relaxed);
        let gate = Arc::new(PairingGate {
            id,
            confirmed: AtomicBool::new(false),
            slot: shared.pairing.clone(),
            galley: shared.deps.galley.clone(),
            status: shared.status.clone(),
        });
        self.start_with(&key, Some(gate)).await;
        let module = self.clone();
        let after = shared.config.tuning.pairing_timeout;
        let timeout = tokio::spawn(async move {
            tokio::time::sleep(after).await;
            if module.end_pairing(Some(id)).await {
                eprintln!("[remote] no phone paired within {after:?}; the pairing code expired");
            }
        });
        *slot = Some(Pending { id, key, timeout });
        eprintln!("[remote] pairing: waiting for the first phone");
        Ok(qr)
    }

    /// End a pairing that is still waiting for its first phone: disconnect
    /// and forget its key (the code on screen stops working). Nothing
    /// otherwise — a paired desktop stays paired and connected, so hiding
    /// the code after Add a phone is harmless. Returns whether a pairing
    /// ended.
    pub async fn cancel_pairing(&self) -> bool {
        let ended = self.end_pairing(None).await;
        if ended {
            eprintln!("[remote] pairing cancelled");
        }
        ended
    }

    /// Unpair every phone: tell the connected ones (`CLOSE Unpaired`),
    /// stop, and delete the master key (and drop a pending one). A later
    /// [`Self::pair`] makes a new key, so every phone has to scan again
    /// (design §3.1).
    pub async fn unpair(&self) -> Result<(), RemoteError> {
        let mut slot = self.shared.pairing.lock().await;
        if let Some(pending) = slot.take() {
            pending.timeout.abort();
        }
        self.stop_with(CloseReason::Unpaired).await;
        self.shared.status.update(|s| {
            s.pairing = false;
            s.pairing_error = None;
        });
        remote_pairing::clear_master_key(&self.shared.deps.galley).await?;
        self.shared.status.update(|s| s.paired = false);
        Ok(())
    }

    /// Stop (quit): close every phone's session (`CLOSE Normal`) and the
    /// connection. A stored pairing stays; a pending one is dropped.
    pub async fn stop(&self) {
        let mut slot = self.shared.pairing.lock().await;
        if let Some(pending) = slot.take() {
            pending.timeout.abort();
        }
        self.stop_with(CloseReason::Normal).await;
        self.shared.status.update(|s| {
            s.pairing = false;
            s.pairing_error = None;
        });
    }

    pub fn status(&self) -> RemoteStatus {
        self.shared.status.get()
    }

    /// The running sink, for tests that feed it events directly.
    #[doc(hidden)]
    pub async fn event_sink(&self) -> Option<Arc<dyn RemoteEventSink>> {
        let run = self.shared.run.lock().await;
        run.as_ref()
            .map(|running| running.sink.clone() as Arc<dyn RemoteEventSink>)
    }

    /// Push to every registered phone (ticket 08 decides when): one
    /// sealed push, one `PUSH` frame per device. `kind` is one of
    /// `galley_remote_protocol::push::kind`; `title` and `body` are cut to
    /// fit. Returns how many frames went to the relay (0 with no device
    /// registered). APNs' answer comes later; a 410 removes the token.
    pub async fn send_push(
        &self,
        kind: &str,
        session_id: Option<&str>,
        title: &str,
        body: &str,
    ) -> Result<usize, RemoteError> {
        let galley = &self.shared.deps.galley;
        let (control, push_key) = {
            let run = self.shared.run.lock().await;
            let running = run.as_ref().ok_or(RemoteError::NotRunning)?;
            (running.control.clone(), running.push_key.clone())
        };
        // Validate before spending a seq.
        PushContent::new(0, session_id.map(str::to_string), kind, title, body)
            .map_err(RemoteError::Push)?;
        let devices = push::push_devices(galley).await?;
        if devices.is_empty() {
            return Ok(0);
        }
        let seq = push::next_push_seq(galley).await?;
        let content = PushContent::new(seq, session_id.map(str::to_string), kind, title, body)
            .map_err(RemoteError::Push)?;
        let sealed = push_seal::seal(&push_key, &content).map_err(RemoteError::Push)?;
        let requests: Vec<(PushRequest, String)> = devices
            .into_iter()
            .filter_map(|device| {
                let token = device_token_from_hex(&device.token)?;
                let request = PushRequest {
                    request_id: self.shared.push_request_ids.fetch_add(1, Ordering::Relaxed),
                    env: device.env,
                    priority: PushPriority::Immediate,
                    device_token: token,
                    collapse_id: None,
                    sealed: sealed.clone(),
                };
                Some((request, device.token))
            })
            .collect();
        let count = requests.len();
        let (reply, sent) = tokio::sync::oneshot::channel();
        control
            .send(Control::Push { requests, reply })
            .await
            .map_err(|_| RemoteError::NotRunning)?;
        match sent.await {
            Ok(true) => Ok(count),
            Ok(false) => Err(RemoteError::RelayOffline),
            Err(_) => Err(RemoteError::NotRunning),
        }
    }

    /// The pairing code for `key`.
    fn qr_for(&self, key: &PairingMasterKey) -> Result<PairingQr, RemoteError> {
        let code = PairingCode::new(
            self.shared.config.relay.clone(),
            MasterKey::from_bytes(*key.as_bytes()),
            self.shared.config.desktop_name.clone(),
        )
        .map_err(|e| RemoteError::Pairing(e.to_string()))?;
        Ok(PairingQr(code.to_qr_string()))
    }

    /// End the pending pairing (`only`: if it is that one — the timeout's
    /// own), stopping its connection. Returns whether one ended.
    async fn end_pairing(&self, only: Option<u64>) -> bool {
        let mut slot = self.shared.pairing.lock().await;
        let Some(pending) = slot.take_if(|pending| only.is_none_or(|id| pending.id == id)) else {
            return false;
        };
        if only.is_none() {
            // The timeout task itself is the caller otherwise: aborting
            // it would cut this stop short.
            pending.timeout.abort();
        }
        drop(pending);
        self.stop_with(CloseReason::Normal).await;
        self.shared.status.update(|s| {
            s.pairing = false;
            s.pairing_error = None;
        });
        true
    }

    /// Start the connection for `key` unless it already runs: for a
    /// stored key (`gate` `None`, paired) or a new pairing's (`gate`,
    /// pairing). The caller holds the lifecycle lock; a connection runs
    /// only while paired or pairing, so one already running is for `key`.
    async fn start_with(&self, key: &PairingMasterKey, gate: Option<Arc<PairingGate>>) {
        let shared = &self.shared;
        let mut run = shared.run.lock().await;
        let pairing = gate.is_some();
        shared.status.update(|s| {
            s.paired = !pairing;
            s.pairing = pairing;
            s.pairing_error = None;
        });
        if run
            .as_ref()
            .is_some_and(|running| !running.supervisor.is_finished())
        {
            return;
        }
        if let Some(ended) = run.take() {
            // A connection task that ended on its own (it never should).
            ended.mapper.abort();
        }
        let keys = MasterKey::from_bytes(*key.as_bytes()).derive();
        let config = &shared.config;
        let hello = CoreHello {
            protocol: PROTOCOL_VERSION,
            core_version: config.core_version.clone(),
            desktop_name: config.desktop_name.clone(),
        };
        // Plain data with a name capped at 128 bytes: far below the
        // handshake's 4096-byte hello limit.
        let hello_json = serde_json::to_vec(&hello).expect("CoreHello serializes");
        let filter = Arc::new(PhoneFilter::default());
        let (sink, sink_rx, dropped) = EventSink::new(config.tuning.sink_capacity, filter.clone());
        let sink = Arc::new(sink);
        let (events_tx, events_rx) = mpsc::channel(256);
        let mapper = tokio::spawn(events::map_events(
            shared.deps.galley.clone(),
            sink_rx,
            dropped,
            events_tx,
            config.tuning.runner_batch_window,
        ));
        let ctx = Arc::new(RunCtx {
            methods: Arc::new(methods::MethodCtx {
                deps: shared.deps.clone(),
                hello,
            }),
            relay: config.relay.clone(),
            channel_header: keys.channel_secret.to_header_value(),
            psk: keys.noise_psk.clone(),
            hello: hello_json,
            tuning: config.tuning.clone(),
            status: shared.status.clone(),
            filter,
            generations: shared.generations.clone(),
            pairing: gate,
        });
        let (control, control_rx) = mpsc::channel(16);
        let supervisor = tokio::spawn(connection::supervise(ctx, control_rx, events_rx));
        if config.register_global_sink {
            crate::notify::register_remote_sink(sink.clone());
        }
        *run = Some(Running {
            control,
            supervisor,
            mapper,
            sink,
            push_key: keys.push_key.clone(),
        });
    }

    /// Stop the connection task, closing phone sessions with `reason`.
    async fn stop_with(&self, reason: CloseReason) {
        let Some(running) = self.shared.run.lock().await.take() else {
            return;
        };
        if self.shared.config.register_global_sink {
            crate::notify::clear_remote_sink();
        }
        let Running {
            control,
            mut supervisor,
            mapper,
            ..
        } = running;
        let _ = control.send(Control::Stop(reason)).await;
        if tokio::time::timeout(STOP_TIMEOUT, &mut supervisor)
            .await
            .is_err()
        {
            supervisor.abort();
        }
        mapper.abort();
        self.shared.status.update(|s| {
            s.relay_connected = false;
            s.online_phones = 0;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galley_remote_protocol::keys::RelayUrl;

    fn qr(name: &str) -> PairingQr {
        let code = PairingCode::new(
            RelayUrl::parse("wss://relay.example.com").unwrap(),
            MasterKey::from_bytes([0x5A; 32]),
            name.into(),
        )
        .unwrap();
        PairingQr(code.to_qr_string())
    }

    /// `(width, height)` from the SVG's `viewBox`.
    fn view_box(svg: &str) -> (u32, u32) {
        let start = svg.find("viewBox=\"0 0 ").expect("a viewBox") + 13;
        let end = start + svg[start..].find('"').unwrap();
        let mut parts = svg[start..end].split(' ').map(|n| n.parse().unwrap());
        (parts.next().unwrap(), parts.next().unwrap())
    }

    #[test]
    fn the_svg_is_the_qr_code_with_a_quiet_zone_and_no_text() {
        let pairing = qr("JC 的 MacBook");
        let svg = pairing.to_svg().unwrap();
        assert!(svg.contains("<svg"), "{svg}");
        assert!(svg.ends_with("</svg>"));
        // White behind every module, quiet zone included.
        assert!(svg.contains(r##"fill="#ffffff""##));
        assert!(svg.contains(r##"fill="#000000""##));
        let code = qrcode::QrCode::with_error_correction_level(
            pairing.as_str().as_bytes(),
            qrcode::EcLevel::M,
        )
        .unwrap();
        let side = u32::try_from(code.width()).unwrap() + 8;
        assert_eq!(view_box(&svg), (side, side));
        // Neither the code nor any piece of it is in the image as text.
        let mk = &pairing.as_str()[pairing.as_str().find("mk=").unwrap() + 3..][..43];
        assert!(!svg.contains(mk));
        assert!(!svg.contains("galley-pair"));
        assert!(!svg.contains("relay.example.com"));
        // The same code draws the same image.
        assert_eq!(qr("JC 的 MacBook").to_svg().unwrap(), svg);
    }

    #[test]
    fn the_longest_desktop_name_still_fits_a_qr_code() {
        let name = "名".repeat(galley_remote_protocol::keys::DESKTOP_NAME_MAX_BYTES / 3);
        assert!(qr(&name).to_svg().is_ok());
    }
}
