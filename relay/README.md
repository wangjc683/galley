# galley-relay

The relay between Galley Core on the desktop and the phones paired with it.
Core connects out to it as the `host`, each phone as a `client`. The relay
forwards their frames within one channel and sends APNs pushes on the
desktop's behalf. Core never listens on the network (`AGENTS.md` Rule 2).
This relay is the only meeting point.

Design and rationale:
[05 / 06 remote protocol design](../.scratch/ios-client/issues/05-remote-protocol-design.md),
§4 and §8. The wire formats come from
[`remote-protocol`](../remote-protocol/README.md) (`frame`, `keys`).

## What it sees and what it does not

| It sees | It does not see |
|---|---|
| `SHA-256(channel_secret)`, the channel key | the pairing master key, the Noise PSK, the push key |
| roles, relay-assigned peer ids, connect and disconnect times | anything inside a Noise message |
| frame sizes and timing | the content of a push (`PUSH` carries it sealed) |
| a push's device token, APNs environment, priority, collapse id | who the user is |

What it keeps: an in-memory channel table, dropped when a channel's last
connection leaves, and counters without identifiers. It writes no access
log and no files. Its stderr gets startup, shutdown and server errors
(such as a failed `accept`), never a channel, peer, address or token. It
holds no key, so it cannot read traffic or forge frames. All it can do on
its own is answer `PING`, announce `PEER` changes and report push outcomes.

## Behavior

- `GET /v1/connect` with `X-Galley-Relay: 1`, `X-Galley-Role: host|client`,
  `X-Galley-Channel: <base64url(channel_secret)>` (exactly 32 bytes)
  upgrades to WebSocket. A wrong header, a query string or a non-WebSocket
  request gets a plain `400` (`426` for a WebSocket version other than 13)
  before any upgrade. A full channel gets `429`. Any other path gets `404`.
- Per channel there is one host and at most 4 clients. A new host closes
  the old one (close code `4001`). Clients get ids `1, 2, …`, never reused
  while the channel lives; the host is peer `0`.
- `DATA` from the host goes to the client it names, with the peer
  rewritten to `0`. `DATA` from a client goes to the host, stamped with
  that client's id. `PEER` notices tell the host about clients joining and
  leaving: a host that connects late gets one for every client already
  there. They tell each client about the host coming and going: a client
  learns the host's current state as soon as it joins. `PING` gets `PONG`
  from the relay and is never forwarded.
- Limits (`Limits::default()`):
  - messages up to 65540 bytes, the largest frame;
  - 512 KiB/s sustained and 2 MiB burst per connection, as backpressure: a
    connection over the rate is read more slowly, not dropped;
  - a connection that sends nothing for 90 s is closed (`4002`);
  - when a connection has 1 MiB queued, forwarding to it waits; if it
    reads nothing for 10 s, it is closed as too slow (`4003`);
  - at most 32 pushes per host waiting on APNs; more are answered
    `push_busy` at once.
- A malformed frame, a frame going the wrong way (`PEER`, `PONG`,
  `PUSH_RESULT` from an end, `PUSH` from a client) or a client `DATA`
  naming a peer other than `0` is counted and closes that connection
  (`1008`). A text message closes it with `1003`, an oversize one with
  `1009`.
- `PUSH` (host only) goes to an `ApnsSender`; its answer goes back as
  `PUSH_RESULT`. Until ticket 06b adds the APNs sender, every push is
  answered `Failed`, `apns_status` 0, reason `push_unavailable`.
- On SIGTERM or Ctrl-C it stops accepting, closes every connection with
  `1001` and exits within 5 s.

## Run it locally

```bash
cargo run --manifest-path core/Cargo.toml -p galley-relay -- --listen 127.0.0.1:8787
```

Then point a development Core at it by its base URL:

```bash
GALLEY_REMOTE_RELAY_URL=ws://127.0.0.1:8787
```

The URL follows `remote-protocol`'s `RelayUrl` rules, the same ones as the
QR code's `relay=`: a base URL without `/v1/connect`, because the ends
append the connect path themselves (`RelayUrl::connect_url`). `ws://` is
accepted only for a loopback host (`localhost`, `127.0.0.0/8`, `[::1]`),
so this works for Core and the iOS simulator on the same Mac. A real phone
needs `wss://` through a TLS proxy. A base URL with a path
(`wss://example.com/relay`) needs the proxy to strip that prefix: the
relay itself serves `/v1/connect` only.

Counters:

```bash
curl -s http://127.0.0.1:8788/metrics
```

## Configuration

Flags win over environment variables:

| Flag | Environment | Default |
|---|---|---|
| `--listen` | `GALLEY_RELAY_LISTEN` | `127.0.0.1:8787` |
| `--metrics-listen` | `GALLEY_RELAY_METRICS_LISTEN` | `127.0.0.1:8788`, must be loopback |
| `--apns-key-path` | `GALLEY_RELAY_APNS_KEY_PATH` | none (read from ticket 06b on) |
| `--apns-key-id` | `GALLEY_RELAY_APNS_KEY_ID` | none |
| `--apns-team-id` | `GALLEY_RELAY_APNS_TEAM_ID` | none |
| `--apns-topic` | `GALLEY_RELAY_APNS_TOPIC` | none (the app's bundle id) |

The APNs environment is not a setting: each `PUSH` names production or
sandbox. The relay speaks plain HTTP. Put Caddy (or another TLS proxy) in
front of it with access logging off and `stream_close_delay` set
(design §2, §4.4).

## Counters

`GET /metrics` on the metrics port returns JSON. Every key is always
present, and counters run from process start:

```json
{
  "version": "0.1.0",
  "uptimeSeconds": 3600,
  "channels": 1,
  "connections": { "host": 1, "client": 1 },
  "connectionsTotal": { "host": 2, "client": 5 },
  "hostsReplaced": 1,
  "bytesIn": 123456, "bytesOut": 123400,
  "framesIn": 900, "framesOut": 910,
  "pushes": { "requested": 3, "ok": 0, "unregistered": 0, "failed": 3 },
  "errors": { "empty": 0, "unknown_type": 0, "truncated": 0, "trailing_bytes": 0,
              "invalid_field": 0, "text_message": 0, "oversize": 0, "ws_protocol": 0,
              "wrong_direction": 0, "bad_peer": 0, "idle_timeout": 0,
              "slow_consumer": 0, "upgrade_failed": 0 },
  "rejected": { "not_found": 0, "method_not_allowed": 0, "bad_request": 0,
                "bad_relay_version": 0, "bad_role": 0, "bad_channel": 0, "channel_full": 0 },
  "dropped": { "unknown_peer": 0, "no_host": 0 }
}
```

The bytes are WebSocket message payloads, without WebSocket, TLS or TCP
overhead. `dropped` counts frames for a peer that was not connected. For a
per-day figure, take the difference between two reads.

## Tests

```bash
cargo test --manifest-path core/Cargo.toml -p galley-relay
```

`tests/relay.rs` runs the relay in process on `127.0.0.1:0`, with a fake
host and fake phones as plain WebSocket clients speaking `remote-protocol`
frames. It covers routing, `PEER` notices, host replacement, the client
cap, refusals, malformed and oversize frames, the idle timeout, the rate
limit, a slow receiver, pushes, counters and shutdown. The timers are
shortened through `Limits` rather than tokio's paused clock, because a
paused clock jumps ahead while the runtime waits on real sockets.
