//! Listening sockets and the accept loop.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::net::TcpListener;
use tokio::time::Instant;

use crate::apns::ApnsSender;
use crate::channels::{Close, State};
use crate::http;
use crate::limits::Limits;

/// Pause after a failed `accept` (e.g. out of file descriptors), so the
/// loop does not spin.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// A bound relay: the WebSocket port and the metrics port.
pub struct Server {
    relay: TcpListener,
    metrics: TcpListener,
    state: Arc<State>,
}

impl Server {
    /// Bind both ports. Port 0 picks a free one ([`Server::relay_addr`],
    /// [`Server::metrics_addr`] say which). The metrics port must be a
    /// loopback address: the counters are for the machine's operator only.
    pub async fn bind(
        relay_addr: SocketAddr,
        metrics_addr: SocketAddr,
        limits: Limits,
        apns: Arc<dyn ApnsSender>,
    ) -> io::Result<Self> {
        if !metrics_addr.ip().is_loopback() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the metrics address must be a loopback address",
            ));
        }
        if limits.max_clients == 0 || limits.rate_bytes_per_sec == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "max_clients and rate_bytes_per_sec must be positive",
            ));
        }
        Ok(Self {
            relay: TcpListener::bind(relay_addr).await?,
            metrics: TcpListener::bind(metrics_addr).await?,
            state: Arc::new(State::new(limits, apns)),
        })
    }

    pub fn relay_addr(&self) -> io::Result<SocketAddr> {
        self.relay.local_addr()
    }

    pub fn metrics_addr(&self) -> io::Result<SocketAddr> {
        self.metrics.local_addr()
    }

    /// The counters, as the metrics port serves them.
    pub fn metrics(&self) -> Value {
        self.state.metrics.snapshot(self.state.channel_count())
    }

    /// Serve until `shutdown` resolves; then stop accepting, close every
    /// connection with 1001 and wait up to [`Limits::shutdown_grace`] for
    /// them to finish.
    pub async fn run(self, shutdown: impl Future<Output = ()>) {
        let Server {
            relay,
            metrics,
            state,
        } = self;
        tokio::pin!(shutdown);
        loop {
            tokio::select! {
                () = &mut shutdown => break,
                accepted = relay.accept() => match accepted {
                    // The peer address is never read: not logged, not kept.
                    Ok((stream, _)) => {
                        let _ = stream.set_nodelay(true);
                        tokio::spawn(http::serve_relay(stream, Arc::clone(&state)));
                    }
                    Err(e) => accept_failed(e).await,
                },
                accepted = metrics.accept() => match accepted {
                    Ok((stream, _)) => {
                        tokio::spawn(http::serve_metrics(stream, Arc::clone(&state)));
                    }
                    Err(e) => accept_failed(e).await,
                },
            }
        }
        drop(relay);
        drop(metrics);
        state.close_all(Close::Shutdown);
        let deadline = Instant::now() + state.limits.shutdown_grace;
        while state.metrics.open_connections() > 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

async fn accept_failed(e: io::Error) {
    eprintln!("galley-relay: accept failed: {e}");
    tokio::time::sleep(ACCEPT_BACKOFF).await;
}
