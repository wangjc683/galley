//! Managed credential IPC: a localhost-only channel (Unix socket /
//! Windows named pipe) over which managed GA runners request runtime
//! credentials. One process-wide listener serves every runner; access
//! is gated by a per-process token plus a per-spawn allowlist of
//! credential refs.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

use crate::api::ManagedModelAuthKind;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

use super::refresh::resolve_access_token;
use super::secret::ResolvedCodexAccessToken;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCredentialIpcConfig {
    pub kind: &'static str,
    pub address: String,
    pub token: String,
}

pub type CredentialIpcAllowlist = HashMap<String, ManagedModelAuthKind>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CredentialIpcRequest {
    pub(super) token: String,
    pub(super) api_key_ref: String,
    #[serde(default)]
    pub(super) credential_kind: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CredentialIpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<i64>,
}

impl CredentialIpcResponse {
    fn api_key(api_key: String) -> Self {
        Self {
            api_key: Some(api_key),
            access_token: None,
            account_id: None,
            expires_at: None,
        }
    }

    fn codex_access_token(resolved: ResolvedCodexAccessToken) -> Self {
        Self {
            api_key: None,
            access_token: Some(resolved.access_token),
            account_id: resolved.account_id,
            expires_at: resolved.expires_at,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CredentialKind {
    ApiKey,
    ChatgptCodexOauth,
}

impl CredentialKind {
    fn parse(raw: Option<&str>) -> Result<Self> {
        match raw.unwrap_or("chatgpt_codex_oauth") {
            "api_key" => Ok(Self::ApiKey),
            "chatgpt_codex_oauth" => Ok(Self::ChatgptCodexOauth),
            other => Err(GalleyError::InvalidArgs {
                message: format!("credential IPC credentialKind is unsupported: {other}"),
            }),
        }
    }

    fn expected_auth_kind(self) -> ManagedModelAuthKind {
        match self {
            Self::ApiKey => ManagedModelAuthKind::ApiKey,
            Self::ChatgptCodexOauth => ManagedModelAuthKind::ChatgptCodexOauth,
        }
    }
}

/// Process-wide credential IPC handle. One listener serves every
/// managed runner: the per-spawn variant leaked a task + fd + socket
/// file on every spawn (they were never closed).
struct CredentialIpcHandle {
    config: CodexCredentialIpcConfig,
    allowlist: Arc<RwLock<CredentialIpcAllowlist>>,
}

static CREDENTIAL_IPC_SINGLETON: OnceLock<AsyncMutex<Option<CredentialIpcHandle>>> =
    OnceLock::new();

/// Get-or-create the process-wide credential IPC listener and merge
/// `allowed_credentials` into its allowlist. Refs are only added, never
/// removed — a logged-out credential's secret is gone from the store,
/// so a stale allowlist entry cannot leak anything.
pub async fn start_credential_ipc(
    allowed_credentials: CredentialIpcAllowlist,
) -> Result<CodexCredentialIpcConfig> {
    let singleton = CREDENTIAL_IPC_SINGLETON.get_or_init(|| AsyncMutex::new(None));
    let mut slot = singleton.lock().await;
    if let Some(handle) = slot.as_ref() {
        handle
            .allowlist
            .write()
            .expect("credential allowlist lock poisoned")
            .extend(allowed_credentials);
        return Ok(handle.config.clone());
    }
    let token = random_hex(24)?;
    let allowlist = Arc::new(RwLock::new(allowed_credentials));
    let config = start_platform_credential_ipc(token, allowlist.clone()).await?;
    *slot = Some(CredentialIpcHandle {
        config: config.clone(),
        allowlist,
    });
    Ok(config)
}

fn random_hex(bytes_len: usize) -> Result<String> {
    let rng = SystemRandom::new();
    let mut bytes = vec![0_u8; bytes_len];
    rng.fill(&mut bytes).map_err(|_| GalleyError::Internal {
        message: "generating credential IPC token failed".into(),
    })?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn credential_token_matches(actual: &str, expected: &str) -> bool {
    let actual = actual.as_bytes();
    let expected = expected.as_bytes();
    let mut diff = actual.len() ^ expected.len();
    for (idx, expected_byte) in expected.iter().copied().enumerate() {
        let actual_byte = actual.get(idx).copied().unwrap_or(0);
        diff |= usize::from(actual_byte ^ expected_byte);
    }
    diff == 0
}

#[cfg(unix)]
async fn start_platform_credential_ipc(
    token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<CodexCredentialIpcConfig> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;

    let address = std::env::temp_dir().join(format!(
        "galley-codex-{}-{}.sock",
        std::process::id(),
        random_hex(8)?
    ));
    let _ = std::fs::remove_file(&address);
    let listener = UnixListener::bind(&address).map_err(|e| GalleyError::Internal {
        message: format!("binding credential IPC socket failed: {e}"),
    })?;
    std::fs::set_permissions(&address, std::fs::Permissions::from_mode(0o600)).map_err(|e| {
        GalleyError::Internal {
            message: format!("securing credential IPC socket permissions failed: {e}"),
        }
    })?;
    let token_for_task = token.clone();
    tokio::spawn(async move {
        loop {
            let stream = match listener.accept().await {
                Ok((stream, _)) => stream,
                Err(e) => {
                    // A silent break here killed credential IPC for the
                    // rest of the process lifetime; failures are
                    // transient (fd pressure) — retry with backoff.
                    eprintln!(
                        "[codex-oauth] accepting credential IPC connection failed: {e} — retrying in 500ms"
                    );
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            };
            let token = token_for_task.clone();
            let allowed_credentials = allowed_credentials.clone();
            tokio::spawn(async move {
                let _ = handle_credential_ipc_stream(stream, token, allowed_credentials).await;
            });
        }
    });
    Ok(CodexCredentialIpcConfig {
        kind: "unix",
        address: address.to_string_lossy().into_owned(),
        token,
    })
}

#[cfg(windows)]
async fn start_platform_credential_ipc(
    token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<CodexCredentialIpcConfig> {
    let address = format!(
        r"\\.\pipe\galley-codex-{}-{}",
        std::process::id(),
        random_hex(8)?
    );
    let pipe_name = address.clone();
    let token_for_task = token.clone();
    tokio::spawn(async move {
        loop {
            let server = match create_secure_credential_pipe(&pipe_name) {
                Ok(server) => server,
                Err(e) => {
                    // A silent break here killed credential IPC for the
                    // rest of the process lifetime; failures are
                    // transient (handle pressure) — retry with backoff.
                    eprintln!(
                        "[codex-oauth] creating credential pipe instance failed: {e} — retrying in 500ms"
                    );
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            };
            if server.connect().await.is_err() {
                continue;
            }
            let token = token_for_task.clone();
            let allowed_credentials = allowed_credentials.clone();
            tokio::spawn(async move {
                let _ = handle_credential_ipc_stream(server, token, allowed_credentials).await;
            });
        }
    });
    Ok(CodexCredentialIpcConfig {
        kind: "windows_named_pipe",
        address,
        token,
    })
}

#[cfg(windows)]
fn create_secure_credential_pipe(
    pipe_name: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use std::ffi::c_void;
    use std::mem;
    use std::ptr;
    use tokio::net::windows::named_pipe::ServerOptions;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    // Owner Rights (OW) resolves to the creating user for this new kernel
    // object. BA/SY keep administrators and LocalSystem unblocked for normal
    // service/debug scenarios while excluding other authenticated users.
    let sddl: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;BA)(A;;GA;;;SY)"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut security_descriptor: *mut c_void = ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut security_descriptor,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }

    let mut attrs = SECURITY_ATTRIBUTES {
        nLength: mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security_descriptor,
        bInheritHandle: 0,
    };
    let result = unsafe {
        ServerOptions::new().create_with_security_attributes_raw(
            pipe_name,
            (&mut attrs as *mut SECURITY_ATTRIBUTES).cast(),
        )
    };
    unsafe {
        LocalFree(security_descriptor);
    }
    result
}

pub(super) async fn handle_credential_ipc_stream<S>(
    stream: S,
    expected_token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("reading credential IPC request failed: {e}"),
        })?;
    let response = match serde_json::from_str::<CredentialIpcRequest>(&line) {
        Ok(req) => {
            // Snapshot under the read lock; never hold it across await.
            let allowlist_snapshot = allowed_credentials
                .read()
                .expect("credential allowlist lock poisoned")
                .clone();
            build_credential_ipc_response(req, &expected_token, &allowlist_snapshot).await
        }
        Err(e) => Err(GalleyError::InvalidArgs {
            message: format!("credential IPC request is invalid JSON: {e}"),
        }),
    };
    let body = match response {
        Ok(response) => serde_json::to_vec(&response),
        Err(err) => serde_json::to_vec(&err),
    }
    .map_err(|e| GalleyError::Internal {
        message: format!("serializing credential IPC response failed: {e}"),
    })?;
    writer
        .write_all(&body)
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("writing credential IPC response failed: {e}"),
        })?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("writing credential IPC response failed: {e}"),
        })?;
    Ok(())
}

async fn build_credential_ipc_response(
    req: CredentialIpcRequest,
    expected_token: &str,
    allowed_credentials: &CredentialIpcAllowlist,
) -> Result<CredentialIpcResponse> {
    let (api_key_ref, requested_kind) =
        validate_credential_ipc_request(req, expected_token, allowed_credentials)?;
    let galley = SqliteGalley::open().await?;
    fulfill_credential_ipc_request(&galley, api_key_ref, requested_kind).await
}

pub(super) fn validate_credential_ipc_request(
    req: CredentialIpcRequest,
    expected_token: &str,
    allowed_credentials: &CredentialIpcAllowlist,
) -> Result<(String, CredentialKind)> {
    if !credential_token_matches(&req.token, expected_token) {
        return Err(GalleyError::InvalidArgs {
            message: "credential IPC token mismatch".into(),
        });
    }
    let requested_kind = CredentialKind::parse(req.credential_kind.as_deref())?;
    let Some(actual_auth_kind) = allowed_credentials.get(&req.api_key_ref).copied() else {
        return Err(GalleyError::InvalidArgs {
            message: "credential IPC apiKeyRef is not allowed for this runner".into(),
        });
    };
    let expected_auth_kind = requested_kind.expected_auth_kind();
    if actual_auth_kind != expected_auth_kind {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "credential IPC credentialKind does not match apiKeyRef auth kind: requested {:?}, actual {:?}",
                expected_auth_kind, actual_auth_kind
            ),
        });
    }
    Ok((req.api_key_ref, requested_kind))
}

pub(super) async fn fulfill_credential_ipc_request(
    galley: &SqliteGalley,
    api_key_ref: String,
    requested_kind: CredentialKind,
) -> Result<CredentialIpcResponse> {
    match requested_kind {
        CredentialKind::ApiKey => {
            let api_key = credential_store::get_secret(galley, &api_key_ref).await?;
            Ok(CredentialIpcResponse::api_key(api_key))
        }
        CredentialKind::ChatgptCodexOauth => {
            let resolved = resolve_access_token(galley, &api_key_ref).await?;
            Ok(CredentialIpcResponse::codex_access_token(resolved))
        }
    }
}
