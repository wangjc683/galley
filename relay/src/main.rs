//! `galley-relay`: run the relay. See `relay/README.md`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use clap::Parser;
use galley_relay::{Limits, PushUnavailable, Server};

/// Galley relay: forwards end-to-end encrypted frames between a desktop
/// Core and its paired phones. Plain HTTP / WebSocket; put a TLS proxy
/// (Caddy) in front of it.
#[derive(Debug, Parser)]
#[command(version)]
struct Cli {
    /// Address of the WebSocket listener (`GET /v1/connect`).
    #[arg(long, env = "GALLEY_RELAY_LISTEN", default_value = "127.0.0.1:8787")]
    listen: SocketAddr,

    /// Address of the counters (`GET /metrics`, JSON). Loopback only.
    #[arg(
        long,
        env = "GALLEY_RELAY_METRICS_LISTEN",
        default_value = "127.0.0.1:8788"
    )]
    metrics_listen: SocketAddr,

    #[command(flatten)]
    apns: ApnsArgs,
}

/// APNs settings, read now and used once ticket 06b adds the sender. The
/// APNs environment (production / sandbox) is per push, in the `PUSH`
/// frame, not a relay setting.
#[derive(Debug, clap::Args)]
struct ApnsArgs {
    /// Path of the APNs auth key (`.p8`).
    #[arg(long, env = "GALLEY_RELAY_APNS_KEY_PATH")]
    apns_key_path: Option<PathBuf>,
    /// Key ID of that key.
    #[arg(long, env = "GALLEY_RELAY_APNS_KEY_ID")]
    apns_key_id: Option<String>,
    /// Apple Developer team ID.
    #[arg(long, env = "GALLEY_RELAY_APNS_TEAM_ID")]
    apns_team_id: Option<String>,
    /// The app's bundle ID (`apns-topic`).
    #[arg(long, env = "GALLEY_RELAY_APNS_TOPIC")]
    apns_topic: Option<String>,
}

impl ApnsArgs {
    fn any_set(&self) -> bool {
        self.apns_key_path.is_some()
            || self.apns_key_id.is_some()
            || self.apns_team_id.is_some()
            || self.apns_topic.is_some()
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("galley-relay: cannot start the runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    runtime.block_on(run(cli))
}

async fn run(cli: Cli) -> ExitCode {
    let server = match Server::bind(
        cli.listen,
        cli.metrics_listen,
        Limits::default(),
        Arc::new(PushUnavailable),
    )
    .await
    {
        Ok(server) => server,
        Err(e) => {
            eprintln!("galley-relay: cannot listen: {e}");
            return ExitCode::FAILURE;
        }
    };
    let (relay_addr, metrics_addr) = match (server.relay_addr(), server.metrics_addr()) {
        (Ok(relay), Ok(metrics)) => (relay, metrics),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("galley-relay: cannot listen: {e}");
            return ExitCode::FAILURE;
        }
    };
    eprintln!(
        "galley-relay {}: relay on {relay_addr}, metrics on {metrics_addr}",
        env!("CARGO_PKG_VERSION")
    );
    // Ticket 06b adds the APNs sender; until then every push fails.
    eprintln!(
        "galley-relay: no APNs sender in this build, pushes are answered with push_unavailable{}",
        if cli.apns.any_set() {
            " (APNs settings ignored)"
        } else {
            ""
        }
    );
    server.run(shutdown_signal()).await;
    eprintln!("galley-relay: stopped");
    ExitCode::SUCCESS
}

/// Ctrl-C everywhere; SIGTERM (systemd's stop) on Unix too.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {}
                    _ = term.recv() => {}
                }
            }
            Err(e) => {
                eprintln!("galley-relay: cannot watch SIGTERM: {e}");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
    eprintln!("galley-relay: shutting down");
}
