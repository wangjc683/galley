//! A fake phone, for seeing Settings → Phone with a phone online in
//! `pnpm tauri dev` (ticket 05d). Development only: an example is in no
//! build that ships.
//!
//! It does what the iPhone app does after scanning the pairing QR code:
//! connects to the relay named in the code as a `client`, runs the Noise
//! handshake with the desktop's Core, says `hello`, lists the sessions,
//! and stays online — pinging the relay, printing the events it gets —
//! until you stop it (Ctrl-C) or the desktop unpairs it. When the desktop
//! goes offline or the relay drops, it waits and comes back by itself, so
//! the page can be watched through every state. Run it twice for two
//! phones. The protocol calls are the ones the test phone in
//! `tests/common/remote.rs` makes; this one survives disconnects instead
//! of failing a test.
//!
//! Where the pairing code comes from:
//!
//! - `--scan`: drag a box around the QR code on screen (`screencapture
//!   -i`); macOS's own QR detector (Core Image, via `osascript`) reads it
//!   and the screenshot is deleted at once;
//! - `--qr-image <file>`: the same detector on a screenshot you took
//!   (delete it afterwards: it is the pairing key);
//! - standard input: the `galley-pair:1?…` string itself.
//!
//! So the desktop needs no new way to hand out the code (it carries the
//! pairing master key): the phone reads it off the screen, as a real one
//! does. This program never prints or stores it.
//!
//! ```text
//! cargo run --manifest-path core/Cargo.toml -p galley-core --example fake_phone -- --scan
//! ```
//!
//! Relay and dev setup: `relay/README.md`, "Preview Settings → Phone".

use futures_util::{SinkExt, StreamExt};
use galley_remote_protocol::app::chunk::{Chunker, Reassembler};
use galley_remote_protocol::app::{
    CoreHello, Empty, Envelope, Hello, HelloParams, Method, Request, SessionsList,
    SessionsListResult, PROTOCOL_VERSION,
};
use galley_remote_protocol::frame::{
    Frame, PeerId, Role, HEADER_CHANNEL, HEADER_RELAY_VERSION, HEADER_ROLE, RELAY_PROTOCOL_VERSION,
};
use galley_remote_protocol::keys::{DerivedKeys, PairingCode};
use galley_remote_protocol::noise::{self, ClientHandshake, CloseReason, Record, Transport};
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use zeroize::Zeroizing;

/// `PING` the relay this often (it drops a client silent for 90 s).
const PING_EVERY: Duration = Duration::from_secs(25);
/// Between attempts to reach the relay.
const RETRY_AFTER: Duration = Duration::from_secs(2);

/// macOS's QR detector over an image file, printing the first Galley
/// pairing code it finds (or nothing).
const DETECT_QR_JXA: &str = r#"
ObjC.import('CoreImage');
function run(argv) {
  const image = $.CIImage.imageWithContentsOfURL($.NSURL.fileURLWithPath(argv[0]));
  if (image.isNil()) return '';
  const options = $.NSDictionary.dictionaryWithObjectForKey(
    $.CIDetectorAccuracyHigh, $.CIDetectorAccuracy);
  const detector = $.CIDetector.detectorOfTypeContextOptions(
    $.CIDetectorTypeQRCode, $.CIContext.context, options);
  const found = detector.featuresInImage(image);
  for (let i = 0; i < found.count; i++) {
    const text = found.objectAtIndex(i).messageString;
    if (!text.isNil() && text.js.startsWith('galley-pair:')) return text.js;
  }
  return '';
}
"#;

const USAGE: &str = "\
usage: fake_phone [--scan | --qr-image <file>]
  --scan             select the QR code on screen (macOS screencapture)
  --qr-image <file>  read the QR code from a screenshot
  (neither)          read the galley-pair:1?... string from standard input";

enum Source {
    Scan,
    Image(PathBuf),
    Stdin,
}

#[tokio::main]
async fn main() -> ExitCode {
    let source = match parse_args(std::env::args().skip(1)) {
        Ok(source) => source,
        Err(message) => {
            eprintln!("{message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let code = match read_code(source).and_then(|qr| {
        PairingCode::parse(qr.trim()).map_err(|e| format!("not a pairing code: {e}"))
    }) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::FAILURE;
        }
    };
    let keys = code.master_key().derive();
    println!(
        "pairing code for \"{}\" via {}",
        code.desktop_name(),
        code.relay()
    );
    run(&code.relay().connect_url(), &keys).await
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Source, String> {
    let source = match args.next().as_deref() {
        None => Source::Stdin,
        Some("--scan") => Source::Scan,
        Some("--qr-image") => Source::Image(args.next().ok_or("--qr-image needs a file")?.into()),
        Some(other) => return Err(format!("unknown argument {other:?}")),
    };
    match args.next() {
        None => Ok(source),
        Some(extra) => Err(format!("unexpected argument {extra:?}")),
    }
}

fn read_code(source: Source) -> Result<Zeroizing<String>, String> {
    match source {
        Source::Stdin => {
            if std::io::stdin().is_terminal() {
                eprintln!("paste the pairing code (galley-pair:1?...), then Return:");
                let mut line = Zeroizing::new(String::new());
                std::io::stdin()
                    .read_line(&mut line)
                    .map_err(|e| format!("reading standard input: {e}"))?;
                Ok(line)
            } else {
                let mut all = Zeroizing::new(String::new());
                std::io::stdin()
                    .read_to_string(&mut all)
                    .map_err(|e| format!("reading standard input: {e}"))?;
                Ok(all)
            }
        }
        Source::Image(path) => detect_qr(&path),
        Source::Scan => {
            let path =
                std::env::temp_dir().join(format!("galley-fake-phone-{}.png", std::process::id()));
            eprintln!("drag a box around the pairing QR code (Esc cancels)");
            let shot = Command::new("screencapture")
                .args(["-i", "-x"])
                .arg(&path)
                .status()
                .map_err(|e| format!("cannot run screencapture: {e}"))?;
            if !shot.success() || !path.exists() {
                return Err("no screenshot taken".into());
            }
            let code = detect_qr(&path).map_err(|e| {
                format!(
                    "{e}; if the shot missed the window, allow Screen Recording for this terminal"
                )
            });
            // The screenshot is the pairing key: never leave it behind.
            let _ = std::fs::remove_file(&path);
            code
        }
    }
}

fn detect_qr(path: &Path) -> Result<Zeroizing<String>, String> {
    let path = std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", DETECT_QR_JXA])
        .arg(&path)
        .output()
        .map_err(|e| format!("cannot run osascript (macOS only): {e}"))?;
    let text = Zeroizing::new(String::from_utf8_lossy(&output.stdout).trim().to_string());
    if !output.status.success() {
        return Err(format!(
            "QR detection failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if text.is_empty() {
        return Err(format!(
            "no Galley pairing QR code found in {}",
            path.display()
        ));
    }
    Ok(text)
}

/// How a connection to the relay ended.
enum End {
    /// The desktop unpaired this phone: its code is dead.
    Unpaired,
    /// Unusable for good: the handshake failed, or the protocol
    /// versions differ.
    Fatal(String),
    /// The relay connection dropped; try again.
    Lost(String),
}

/// Stay connected, reconnecting, until the code stops working.
async fn run(url: &str, keys: &DerivedKeys) -> ExitCode {
    let mut said_unreachable = false;
    loop {
        match Phone::connect(url, keys).await {
            Ok(phone) => {
                said_unreachable = false;
                println!("connected to the relay");
                match phone.serve(keys).await {
                    End::Unpaired => {
                        println!(
                            "the desktop unpaired this phone; scan the new code to pair again"
                        );
                        return ExitCode::SUCCESS;
                    }
                    End::Fatal(why) => {
                        eprintln!("{why}");
                        return ExitCode::FAILURE;
                    }
                    End::Lost(why) => println!("relay connection lost ({why}); reconnecting"),
                }
            }
            Err(why) if !said_unreachable => {
                println!("relay not reachable ({why}); retrying every {RETRY_AFTER:?}");
                said_unreachable = true;
            }
            Err(_) => {}
        }
        tokio::time::sleep(RETRY_AFTER).await;
    }
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// One relay connection and the Noise session on it.
struct Phone {
    ws: Ws,
    handshake: Option<ClientHandshake>,
    transport: Option<Transport>,
    chunker: Chunker,
    reassembler: Reassembler,
    next_request: u64,
    hello_request: u64,
    list_request: u64,
}

impl Phone {
    async fn connect(url: &str, keys: &DerivedKeys) -> Result<Self, String> {
        let mut request = url.into_client_request().map_err(|e| e.to_string())?;
        let headers = request.headers_mut();
        let value = |v: &str| HeaderValue::from_str(v).map_err(|e| e.to_string());
        headers.insert(
            HEADER_CHANNEL,
            value(&keys.channel_secret.to_header_value())?,
        );
        headers.insert(HEADER_ROLE, value(Role::Client.as_str())?);
        headers.insert(
            HEADER_RELAY_VERSION,
            value(&RELAY_PROTOCOL_VERSION.to_string())?,
        );
        let (ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| e.to_string())?;
        Ok(Self {
            ws,
            handshake: None,
            transport: None,
            chunker: Chunker::new(),
            reassembler: Reassembler::new(),
            next_request: 1,
            hello_request: 0,
            list_request: 0,
        })
    }

    async fn serve(mut self, keys: &DerivedKeys) -> End {
        let mut ping = tokio::time::interval(PING_EVERY);
        let mut nonce = 0_u64;
        loop {
            let frame = tokio::select! {
                _ = ping.tick() => {
                    nonce += 1;
                    if let Err(why) = self.send(Frame::Ping(nonce)).await {
                        return End::Lost(why);
                    }
                    continue;
                }
                message = self.ws.next() => match message {
                    Some(Ok(Message::Binary(bytes))) => match Frame::decode(&bytes) {
                        Ok(frame) => frame,
                        Err(e) => return End::Lost(format!("bad frame from the relay: {e}")),
                    },
                    Some(Ok(Message::Close(close))) => {
                        return End::Lost(match close {
                            Some(close) => format!("closed by the relay, code {}", close.code),
                            None => "closed by the relay".into(),
                        })
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return End::Lost(e.to_string()),
                    None => return End::Lost("connection ended".into()),
                },
            };
            match frame {
                Frame::Peer { online: true, .. } => {
                    println!("desktop online; handshaking");
                    if let Err(why) = self.start_handshake(keys).await {
                        return End::Lost(why);
                    }
                }
                Frame::Peer { online: false, .. } => {
                    self.handshake = None;
                    self.transport = None;
                    println!("desktop offline (Galley not running, or it lost the relay); waiting");
                }
                Frame::Data { payload, .. } => {
                    if let Some(end) = self.on_data(&payload, keys).await {
                        return end;
                    }
                }
                _ => {}
            }
        }
    }

    async fn start_handshake(&mut self, keys: &DerivedKeys) -> Result<(), String> {
        self.transport = None;
        self.reassembler.clear();
        let (request, handshake) =
            noise::client_start(&keys.noise_psk).map_err(|e| e.to_string())?;
        self.handshake = Some(handshake);
        self.send(Frame::Data {
            peer: PeerId::HOST,
            payload: request,
        })
        .await
    }

    async fn on_data(&mut self, payload: &[u8], keys: &DerivedKeys) -> Option<End> {
        if let Some(handshake) = self.handshake.take() {
            let (hello, transport) = match handshake.finish(payload) {
                Ok(done) => done,
                Err(e) => return Some(End::Fatal(format!("handshake failed: {e}"))),
            };
            self.transport = Some(transport);
            match serde_json::from_slice::<CoreHello>(&hello) {
                Ok(hello) => println!(
                    "paired with \"{}\" (Galley {}); online",
                    hello.desktop_name, hello.core_version
                ),
                Err(e) => println!("online (unreadable hello: {e})"),
            }
            self.hello_request = self
                .request::<Hello>(&HelloParams {
                    protocol: PROTOCOL_VERSION,
                    app_version: "fake_phone (dev)".into(),
                })
                .await
                .ok()?;
            self.list_request = self.request::<SessionsList>(&Empty {}).await.ok()?;
            return None;
        }
        let transport = self.transport.as_mut()?;
        let record = match transport.open(payload) {
            Ok(record) => record,
            Err(e) => {
                // Core drops a phone whose record does not open; so does
                // this one, and starts over.
                println!("a record did not open ({e}); handshaking again");
                return self.start_handshake(keys).await.err().map(End::Lost);
            }
        };
        match record {
            Record::Close(CloseReason::Unpaired) => Some(End::Unpaired),
            Record::Close(CloseReason::VersionMismatch) => Some(End::Fatal(
                "the desktop speaks another protocol version".into(),
            )),
            Record::Close(CloseReason::Expired) => {
                println!("session expired; handshaking again");
                self.start_handshake(keys).await.err().map(End::Lost)
            }
            Record::Close(reason) => {
                self.transport = None;
                println!("the desktop closed the session ({reason:?}); waiting");
                None
            }
            Record::App(body) => {
                self.on_message(&body);
                None
            }
        }
    }

    fn on_message(&mut self, body: &[u8]) {
        let envelope = match Envelope::from_json(body)
            .map_err(|e| e.to_string())
            .and_then(|e| self.reassembler.push(e).map_err(|e| e.to_string()))
        {
            Ok(Some(envelope)) => envelope,
            Ok(None) => return,
            Err(e) => {
                println!("unreadable message: {e}");
                return;
            }
        };
        match envelope {
            Envelope::Response(response) if response.id == self.list_request => {
                match response.result::<SessionsList>() {
                    Ok(Ok(SessionsListResult { sessions, .. })) => {
                        println!("{} sessions", sessions.len())
                    }
                    Ok(Err(e)) => println!("sessions.list failed: {}", e.code),
                    Err(e) => println!("sessions.list: {e}"),
                }
            }
            Envelope::Response(response) if response.id == self.hello_request => {
                if let Err(e) = response.outcome {
                    println!("hello failed: {}", e.code);
                }
            }
            Envelope::Event(event) => println!("event {}", event.name),
            _ => {}
        }
    }

    async fn request<M: Method>(&mut self, params: &M::Params) -> Result<u64, ()> {
        let id = self.next_request;
        self.next_request += 1;
        let envelope = Envelope::Request(Request::new::<M>(id, params));
        let bodies = self.chunker.encode(&envelope).map_err(|_| ())?;
        for body in bodies {
            let transport = self.transport.as_mut().ok_or(())?;
            let sealed = transport.seal_app(&body).map_err(|_| ())?;
            self.send(Frame::Data {
                peer: PeerId::HOST,
                payload: sealed,
            })
            .await
            .map_err(|_| ())?;
        }
        Ok(id)
    }

    async fn send(&mut self, frame: Frame) -> Result<(), String> {
        let bytes = frame.encode().map_err(|e| e.to_string())?;
        self.ws
            .send(Message::Binary(bytes.into()))
            .await
            .map_err(|e| e.to_string())
    }
}
