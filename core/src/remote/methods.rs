//! The phone's methods (design §6.3, §6.6), each calling the Core
//! function the GUI's command or the socket handler calls — never a Tauri
//! command — and converting the result into the phone's types.
//!
//! Only managed-runtime sessions exist for a phone (PRD ruling 18): a
//! method naming another runtime's session answers
//! [`SESSION_NOT_MANAGED`], a missing one `not_found`. Writes carry
//! `origin.via = gui` with `client = ios` (PRD ruling 9) and broadcast
//! with `via: "ios"`.

use super::convert;
use super::RemoteDeps;
use crate::api::{
    CreateSessionInput, GalleyApi, Origin, OriginClient, RuntimeKind, SessionBrief, SessionFilter,
    SessionId,
};
use crate::attachment_read::read_conversation_attachment;
use crate::commands::{decode_image_uploads, ImageUpload};
use crate::error::GalleyError;
use crate::runner_manager::RunState;
use crate::session_runner::{RunnerHost, SessionRunnerError};
use crate::session_send::{
    send_user_message, stop_session_run, SendError, SendOutcome, SendRequest, StopOutcome,
};
use crate::session_writes::Writes;
use base64::Engine as _;
use galley_remote_protocol::app::{
    self as phone, error_code, ClientRequest, CoreHello, Empty, ErrorBody, Hello, Method, Request,
    Response, MESSAGES_PAGE_DEFAULT, MESSAGES_PAGE_MAX, PROTOCOL_VERSION,
};
use galley_remote_protocol::noise::CloseReason;
use std::collections::BTreeSet;

/// Error code for a session of another runtime than the managed one.
pub const SESSION_NOT_MANAGED: &str = "session_not_managed";
/// Error code for a phone subscribed to too many sessions at once.
pub const TOO_MANY_SUBSCRIPTIONS: &str = "too_many_subscriptions";

/// `via` of the phone's writes and runner starts (session events,
/// `runner-spawned-external`).
pub const VIA_IOS: &str = "ios";

/// Sessions one phone may receive `runner.event` for at once.
pub const MAX_SUBSCRIPTIONS: usize = 16;

/// Title of a session the phone creates without one: the GUI's seed,
/// which the first message then replaces (`session_title`).
const DEFAULT_SESSION_TITLE: &str = "新对话";

/// What the methods work with.
pub(super) struct MethodCtx {
    pub(super) deps: RemoteDeps,
    pub(super) hello: CoreHello,
}

/// What the connection does besides sending the response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Effect {
    None,
    Subscribe(String),
    Unsubscribe(String),
    /// Close the session after the response (`hello` with another major).
    Close(CloseReason),
}

/// Answer one request. `subscriptions` is the phone's current set, for
/// the subscription cap.
pub(super) async fn handle(
    ctx: &MethodCtx,
    request: Request,
    subscriptions: &BTreeSet<String>,
) -> (Response, Effect) {
    let id = request.id;
    let decoded = match ClientRequest::from_request(&request) {
        Ok(decoded) => decoded,
        Err(error) => return (Response::error(id, error), Effect::None),
    };
    let mut effect = Effect::None;
    let outcome = match decoded {
        ClientRequest::Hello(params) => {
            if PROTOCOL_VERSION.is_compatible_with(&params.protocol) {
                Ok(Response::ok::<Hello>(id, &ctx.hello))
            } else {
                effect = Effect::Close(CloseReason::VersionMismatch);
                Err(ErrorBody::new(
                    error_code::PROTOCOL_MISMATCH,
                    format!(
                        "phone speaks protocol {}, desktop speaks {}",
                        params.protocol.major, PROTOCOL_VERSION.major
                    ),
                ))
            }
        }
        ClientRequest::SessionsList(_) => ok::<phone::SessionsList>(id, sessions_list(ctx).await),
        ClientRequest::SessionMessages(params) => {
            ok::<phone::SessionMessages>(id, session_messages(ctx, params).await)
        }
        ClientRequest::SessionSend(params) => {
            ok::<phone::SessionSend>(id, session_send(ctx, params).await)
        }
        ClientRequest::SessionStop(params) => {
            ok::<phone::SessionStop>(id, session_stop(ctx, &params.session_id).await)
        }
        ClientRequest::SessionCreate(params) => {
            ok::<phone::SessionCreate>(id, session_create(ctx, params).await)
        }
        ClientRequest::SessionMarkRead(params) => {
            ok::<phone::SessionMarkRead>(id, mark_read(ctx, &params.session_id).await)
        }
        ClientRequest::SessionSubscribe(params) => {
            let session_id = params.session_id;
            let checked = async {
                managed_session(ctx, &session_id).await?;
                if !subscriptions.contains(&session_id) && subscriptions.len() >= MAX_SUBSCRIPTIONS
                {
                    return Err(ErrorBody::new(
                        TOO_MANY_SUBSCRIPTIONS,
                        format!("at most {MAX_SUBSCRIPTIONS} sessions at once"),
                    ));
                }
                Ok(Empty {})
            }
            .await;
            if checked.is_ok() {
                effect = Effect::Subscribe(session_id);
            }
            ok::<phone::SessionSubscribe>(id, checked)
        }
        ClientRequest::SessionUnsubscribe(params) => {
            effect = Effect::Unsubscribe(params.session_id);
            ok::<phone::SessionUnsubscribe>(id, Ok(Empty {}))
        }
        ClientRequest::AttachmentRead(params) => {
            ok::<phone::AttachmentRead>(id, attachment_read(ctx, params).await)
        }
        ClientRequest::DeviceRegisterPush(params) => {
            let registered =
                super::push::register_push_device(&ctx.deps.galley, &params.token, params.env)
                    .await
                    .map(|()| Empty {})
                    .map_err(galley_error);
            ok::<phone::DeviceRegisterPush>(id, registered)
        }
    };
    (
        outcome.unwrap_or_else(|error| Response::error(id, error)),
        effect,
    )
}

fn ok<M: Method>(id: u64, result: Result<M::Result, ErrorBody>) -> Result<Response, ErrorBody> {
    result.map(|result| Response::ok::<M>(id, &result))
}

/// A `GalleyError` as the phone gets it: its stable tag and message.
pub(super) fn galley_error(error: GalleyError) -> ErrorBody {
    let (code, message) = match error {
        GalleyError::NotFound { message } => (error_code::NOT_FOUND, message),
        GalleyError::InvalidArgs { message } => (error_code::INVALID_ARGS, message),
        GalleyError::DbUnavailable { message } => (error_code::DB_UNAVAILABLE, message),
        GalleyError::RunnerError { message } => (error_code::RUNNER_ERROR, message),
        GalleyError::Internal { message } => (error_code::INTERNAL, message),
    };
    ErrorBody::new(code, message)
}

fn runner_error(error: SessionRunnerError) -> ErrorBody {
    match error {
        SessionRunnerError::Db(error) => galley_error(error),
        SessionRunnerError::HistoryReplay(detail) => {
            ErrorBody::new(error_code::HISTORY_REPLAY, detail)
        }
        other => ErrorBody::new(error_code::RUNNER_ERROR, format!("{other:?}")),
    }
}

fn send_error(error: SendError) -> ErrorBody {
    match error {
        SendError::Db(error) => galley_error(error),
        SendError::Runner(error) => runner_error(error),
        other => ErrorBody::new(other.tag().unwrap_or(error_code::INTERNAL), other.detail()),
    }
}

/// The session, if it exists and belongs to the managed runtime.
async fn managed_session(ctx: &MethodCtx, session_id: &str) -> Result<SessionBrief, ErrorBody> {
    let brief = ctx
        .deps
        .galley
        .session_brief(SessionId(session_id.to_string()))
        .await
        .map_err(galley_error)?;
    if brief.ga_runtime_kind != RuntimeKind::Managed {
        return Err(ErrorBody::new(
            SESSION_NOT_MANAGED,
            "the session belongs to an attached GenericAgent, which the phone does not show",
        ));
    }
    Ok(brief)
}

async fn sessions_list(ctx: &MethodCtx) -> Result<phone::SessionsListResult, ErrorBody> {
    let galley = &ctx.deps.galley;
    let sessions: Vec<SessionBrief> = galley
        .list_sessions(SessionFilter {
            project_id: None,
            status: None,
            archived: None,
            runtime_kind: Some(RuntimeKind::Managed),
        })
        .await
        .map_err(galley_error)?
        .into_iter()
        .filter(|session| session.ga_runtime_kind == RuntimeKind::Managed)
        .collect();
    let projects = galley.list_projects().await.map_err(galley_error)?;
    let listed: BTreeSet<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
    let mut run_states = Vec::new();
    for session_id in ctx.deps.runner.known_session_ids().await {
        if !listed.contains(session_id.as_str()) {
            continue;
        }
        let state = ctx.deps.runner.run_state(&session_id).await;
        if state != RunState::default() {
            run_states.push(convert::run_state(&session_id, state));
        }
    }
    Ok(phone::SessionsListResult {
        sessions: sessions.into_iter().map(convert::session).collect(),
        projects: projects.into_iter().map(convert::project).collect(),
        run_states,
    })
}

async fn session_messages(
    ctx: &MethodCtx,
    params: phone::SessionMessagesParams,
) -> Result<phone::SessionMessagesResult, ErrorBody> {
    managed_session(ctx, &params.session_id).await?;
    let galley = &ctx.deps.galley;
    let session_id = SessionId(params.session_id);
    let before = match params.before {
        None => None,
        Some(message_id) => Some(
            galley
                .message_cursor(&session_id, &message_id)
                .await
                .map_err(galley_error)?
                .ok_or_else(|| {
                    ErrorBody::new(
                        error_code::NOT_FOUND,
                        "before names no visible message of this session",
                    )
                })?,
        ),
    };
    let limit = params
        .limit
        .unwrap_or(MESSAGES_PAGE_DEFAULT)
        .clamp(1, MESSAGES_PAGE_MAX);
    let page = galley
        .persisted_message_rows_page(&session_id, before.as_ref(), limit as usize)
        .await
        .map_err(galley_error)?;
    Ok(phone::SessionMessagesResult {
        messages: page
            .rows
            .into_iter()
            .map(convert::persisted_message)
            .collect(),
        has_more: page.has_more,
    })
}

async fn session_send(
    ctx: &MethodCtx,
    params: phone::SessionSendParams,
) -> Result<phone::SessionSendResult, ErrorBody> {
    managed_session(ctx, &params.session_id).await?;
    let images = decode_image_uploads(
        params
            .images
            .into_iter()
            .map(|image| ImageUpload {
                mime_type: image.mime_type,
                base64: image.data,
                width: image.width,
                height: image.height,
            })
            .collect(),
    )
    .map_err(galley_error)?;
    let deps = &ctx.deps;
    let host = RunnerHost {
        galley: &deps.galley,
        runner: deps.runner.as_ref(),
        notifier: deps.notifier.clone(),
        env: deps.env.as_deref(),
    };
    let outcome = send_user_message(
        &host,
        SendRequest {
            session_id: params.session_id,
            text: params.text,
            images,
            client_request_id: params.client_request_id,
            // A human, through the phone (PRD ruling 9).
            origin: Origin::gui().with_client(OriginClient::Ios),
            via: VIA_IOS,
            llm_override: None,
            ga_config: None,
            timeouts: Default::default(),
        },
    )
    .await
    .map_err(send_error)?;
    Ok(match outcome {
        SendOutcome::Dispatched { message, .. } => phone::SessionSendResult {
            outcome: phone::SendOutcome::Dispatched,
            message: Some(convert::brief_message(message)),
            queue: None,
        },
        SendOutcome::Queued { queue_id, position } => phone::SessionSendResult {
            outcome: phone::SendOutcome::Queued,
            message: None,
            queue: Some(phone::QueuedPlacement {
                queue_id,
                position: u32::try_from(position).unwrap_or(u32::MAX),
            }),
        },
        SendOutcome::SideQuestion { .. } => phone::SessionSendResult {
            outcome: phone::SendOutcome::SideQuestion,
            message: None,
            queue: None,
        },
    })
}

async fn session_stop(
    ctx: &MethodCtx,
    session_id: &str,
) -> Result<phone::SessionStopResult, ErrorBody> {
    managed_session(ctx, session_id).await?;
    let outcome = stop_session_run(ctx.deps.runner.as_ref(), session_id)
        .await
        .map_err(|e| ErrorBody::new(error_code::RUNNER_ERROR, e.to_string()))?;
    Ok(phone::SessionStopResult {
        dispatch: match outcome {
            StopOutcome::AbortSent => phone::StopDispatch::AbortSent,
            StopOutcome::AlreadyStopped => phone::StopDispatch::AlreadyStopped,
        },
    })
}

async fn session_create(
    ctx: &MethodCtx,
    params: phone::SessionCreateParams,
) -> Result<phone::SessionCreateResult, ErrorBody> {
    let title = params
        .title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| DEFAULT_SESSION_TITLE.to_string());
    let input = CreateSessionInput {
        id: crate::socket_listener::mint_session_id(),
        title,
        project_id: params.project_id,
        // The runner starts on the managed runtime's default model.
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let brief = Writes::new(&ctx.deps.galley, ctx.deps.notifier.as_ref(), VIA_IOS)
        .create_session(input, Origin::gui().with_client(OriginClient::Ios))
        .await
        .map_err(galley_error)?;
    Ok(phone::SessionCreateResult {
        session: convert::session(brief),
    })
}

async fn mark_read(ctx: &MethodCtx, session_id: &str) -> Result<Empty, ErrorBody> {
    managed_session(ctx, session_id).await?;
    Writes::new(&ctx.deps.galley, ctx.deps.notifier.as_ref(), VIA_IOS)
        .clear_session_unread(SessionId(session_id.to_string()))
        .await
        .map_err(galley_error)?;
    Ok(Empty {})
}

async fn attachment_read(
    ctx: &MethodCtx,
    params: phone::AttachmentReadParams,
) -> Result<phone::AttachmentReadResult, ErrorBody> {
    managed_session(ctx, &params.session_id).await?;
    let file =
        read_conversation_attachment(&ctx.deps.galley, &params.session_id, &params.attachment_id)
            .await
            .map_err(|e| ErrorBody::new(e.tag(), e.to_string()))?;
    Ok(phone::AttachmentReadResult {
        attachment_id: params.attachment_id,
        mime_type: file.mime_type.to_string(),
        byte_size: file.bytes.len() as u64,
        data: base64::engine::general_purpose::STANDARD.encode(&file.bytes),
    })
}
