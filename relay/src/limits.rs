//! Per-connection limits (design §4.2 rules, §4.4) and the token bucket
//! behind the rate limit.

use std::time::Duration;

use tokio::time::Instant;

/// Limits the relay enforces. [`Limits::default`] is the production set;
/// tests shrink the timers.
#[derive(Debug, Clone)]
pub struct Limits {
    /// Clients per channel; the next one is refused with HTTP 429.
    pub max_clients: usize,
    /// A connection that sends nothing (no frame, no WebSocket ping) for
    /// this long is closed with [`crate::close::IDLE_TIMEOUT`]. The ends
    /// `PING` every 25 s.
    pub idle_timeout: Duration,
    /// Sustained rate of what one connection sends to the relay, in bytes
    /// per second. Going over it is not an error: the relay reads that
    /// connection more slowly (backpressure through TCP).
    pub rate_bytes_per_sec: u32,
    /// Bytes one connection may send at once before the rate applies.
    pub burst_bytes: u32,
    /// Bytes queued for one connection before forwarding to it waits.
    pub outbound_queue_bytes: usize,
    /// How long forwarding waits for a full queue to drain at all before
    /// it closes that receiver with [`crate::close::TOO_SLOW`].
    pub stall_timeout: Duration,
    /// `PUSH` requests one host may have waiting on APNs; more are
    /// answered at once with a `push_busy` failure.
    pub max_pushes_in_flight: usize,
    /// How long shutdown waits for connections to close.
    pub shutdown_grace: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_clients: 4,
            idle_timeout: Duration::from_secs(90),
            rate_bytes_per_sec: 512 * 1024,
            burst_bytes: 2 * 1024 * 1024,
            outbound_queue_bytes: 1024 * 1024,
            stall_timeout: Duration::from_secs(10),
            max_pushes_in_flight: 32,
            shutdown_grace: Duration::from_secs(5),
        }
    }
}

/// Token bucket over bytes: starts full at `burst`, refills at `rate`.
/// [`TokenBucket::charge`] may drive it negative; the debt is the wait.
#[derive(Debug)]
pub(crate) struct TokenBucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub(crate) fn new(limits: &Limits, now: Instant) -> Self {
        let burst = f64::from(limits.burst_bytes);
        Self {
            rate: f64::from(limits.rate_bytes_per_sec.max(1)),
            burst,
            tokens: burst,
            last: now,
        }
    }

    /// Take `bytes` that just arrived; returns how long to wait before
    /// reading again so the sustained rate holds.
    pub(crate) fn charge(&mut self, bytes: usize, now: Instant) -> Duration {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.rate).min(self.burst) - bytes as f64;
        if self.tokens >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-self.tokens / self.rate)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket(rate: u32, burst: u32, now: Instant) -> TokenBucket {
        TokenBucket::new(
            &Limits {
                rate_bytes_per_sec: rate,
                burst_bytes: burst,
                ..Limits::default()
            },
            now,
        )
    }

    #[test]
    fn burst_is_free_then_the_rate_applies() {
        let t0 = Instant::now();
        let mut b = bucket(1000, 4000, t0);
        assert_eq!(b.charge(4000, t0), Duration::ZERO);
        // 500 bytes of debt at 1000 B/s.
        assert_eq!(b.charge(500, t0), Duration::from_millis(500));
        // After waiting it out the bucket is at zero, not refilled twice.
        let t1 = t0 + Duration::from_millis(500);
        assert_eq!(b.charge(1000, t1), Duration::from_secs(1));
    }

    #[test]
    fn idle_time_refills_up_to_the_burst_only() {
        let t0 = Instant::now();
        let mut b = bucket(1000, 2000, t0);
        assert_eq!(b.charge(2000, t0), Duration::ZERO);
        let later = t0 + Duration::from_secs(3600);
        assert_eq!(b.charge(2000, later), Duration::ZERO);
        assert_eq!(b.charge(1000, later), Duration::from_secs(1));
    }

    #[test]
    fn production_numbers_match_the_design() {
        let limits = Limits::default();
        let t0 = Instant::now();
        let mut b = TokenBucket::new(&limits, t0);
        assert_eq!(b.charge(2 * 1024 * 1024, t0), Duration::ZERO);
        assert_eq!(b.charge(512 * 1024, t0), Duration::from_secs(1));
        assert_eq!(limits.max_clients, 4);
        assert_eq!(limits.idle_timeout, Duration::from_secs(90));
    }
}
