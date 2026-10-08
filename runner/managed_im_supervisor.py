"""Galley-managed IM Supervisor launcher.

Galley wraps GenericAgent's official IM frontends while keeping model config,
prompt, state paths, and process lifetime owned by Galley.
"""
from __future__ import annotations

import argparse
import errno
import json
import logging
import os
import sys
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any, TextIO, cast

from runner import _watchdog, im_resume, managed_runtime

IM_SUPERVISOR_PROMPT_ENV = "GALLEY_IM_SUPERVISOR_PROMPT_TEXT"
# Same prompt body with the supervisor id left unresolved. Core injects it
# only for multi-context platforms (Discord), where the identity is per
# channel and therefore cannot ride a process-wide env var.
IM_SUPERVISOR_PROMPT_TEMPLATE_ENV = "GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE"
IM_SUPERVISOR_LOCK_NAME = "supervisor.lock"
# Upstream ``wechatapp`` defaults ``_MODE`` to ``"conductor"`` and forwards every
# incoming message to a detached ``conductor.py`` child on a fixed port. That
# child carries neither the managed mykey loader nor the Galley supervisor
# prompt, so under the managed runtime it never answers. Galley pins the
# in-process agent and refuses ``/switch`` instead of patching the child.
WECHAT_MANAGED_MODE = "agent"
WECHAT_SWITCH_BLOCKED_REPLY = "Galley 托管的微信渠道固定由 supervisor 处理消息，不支持 /switch。"
# Upstream wechatapp knows /switch, /stop and /llm only; Galley answers
# /new, /status and /help itself so every channel takes the same commands.
WECHAT_HELP_COMMANDS = (
    ("/new", "开始新对话"),
    ("/stop", "停止当前任务"),
    ("/status", "查看运行状态和当前模型"),
    ("/llm", "查看可用模型"),
    ("/llm n", "切换到第 n 个模型"),
    ("/help", "查看全部命令"),
)
WECHAT_HELP_REPLY = "📖 命令列表：\n" + "\n".join(
    f"{command} - {description}" for command, description in WECHAT_HELP_COMMANDS
)

# The channel credentials Galley Core hands the frontends: the env var it
# sets before spawn and the key of the secret in that JSON (written in
# core/src/im_supervisor/platform_config.rs). WeChat's token is not in the
# env: the launcher adds it once WxBotClient has it.
SECRET_CONFIG_FIELDS = (
    ("GALLEY_FEISHU_CONFIG_JSON", "fs_app_secret"),
    ("GALLEY_TELEGRAM_CONFIG_JSON", "tg_bot_token"),
    ("GALLEY_DISCORD_CONFIG_JSON", "discord_bot_token"),
)
# Shorter strings are not credentials, and masking them would garble
# ordinary text.
SECRET_MIN_LENGTH = 8
SECRET_KEPT_TAIL = 4


def _mask_secret(secret: str) -> str:
    return "…" + secret[-SECRET_KEPT_TAIL:]


class _SecretRedactor:
    """Masks the channel credentials in what this process reports and logs.

    A frontend error can quote its credential verbatim (python-telegram-bot's
    ``InvalidToken`` reads "The token `<token>` was rejected by the
    server."), and both the status line (the Settings error block, the
    menu bar) and the channel log would carry it. Each credential becomes
    ``…`` plus its last four characters: enough to tell which one, not
    enough to use it."""

    def __init__(self) -> None:
        self._secrets: tuple[str, ...] = ()

    def load_env(self, environ: Mapping[str, str] | None = None) -> None:
        """Start over from the credentials in this process's config env."""
        environ = os.environ if environ is None else environ
        self._secrets = ()
        for env_name, key in SECRET_CONFIG_FIELDS:
            raw = environ.get(env_name)
            if not raw:
                continue
            try:
                config = json.loads(raw)
            except ValueError:
                continue
            if isinstance(config, dict):
                self.add(config.get(key))

    def add(self, secret: object) -> None:
        if not isinstance(secret, str):
            return
        found = {s for s in (secret, secret.strip()) if len(s) >= SECRET_MIN_LENGTH}
        if found <= set(self._secrets):
            return
        # Longest first: a credential that contains another is masked whole.
        self._secrets = tuple(
            sorted(set(self._secrets) | found, key=len, reverse=True)
        )

    def redact(self, text: str) -> str:
        for secret in self._secrets:
            if secret in text:
                text = text.replace(secret, _mask_secret(secret))
        return text


_REDACTOR = _SecretRedactor()


class _RedactingWriter:
    """``sys.stdout`` / ``sys.stderr`` of a channel: every write reaches the
    log masked. Anything else (``encoding``, ``fileno``, ``reconfigure``…)
    is the log file's own."""

    def __init__(self, target: IO[str], redactor: _SecretRedactor) -> None:
        self._target = target
        self._redactor = redactor

    def write(self, text: str) -> int:
        self._target.write(self._redactor.redact(text) if isinstance(text, str) else text)
        return len(text)

    def writelines(self, lines: Iterable[str]) -> None:
        for line in lines:
            self.write(line)

    def flush(self) -> None:
        self._target.flush()

    def isatty(self) -> bool:
        return self._target.isatty()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._target, name)


def _rebind_logging_streams(writer: TextIO, stale: Iterable[object]) -> int:
    """Point every ``logging`` stream handler still writing to one of
    ``stale`` (the stdio this process started with) at ``writer``.

    Nothing in the launcher or the frontends' import chain sets one up
    before the redirect today: the frontends add no handlers, lark_oapi's
    ``StreamHandler(sys.stdout)`` and any handler made later bind to
    ``sys.stdout`` / ``sys.stderr`` after they already are the writer, and
    ``logging.lastResort`` looks ``sys.stderr`` up on every record. This
    covers a handler that would otherwise send unmasked text down Core's
    stderr pipe (Core shows stderr lines as the channel's last error)."""
    streams = [stream for stream in stale if stream is not None and stream is not writer]
    loggers: list[logging.Logger] = [logging.getLogger()]
    loggers.extend(
        logger
        for logger in list(logging.Logger.manager.loggerDict.values())
        if isinstance(logger, logging.Logger)
    )
    rebound = 0
    for logger in loggers:
        for handler in list(logger.handlers):
            if (
                isinstance(handler, logging.StreamHandler)
                and not isinstance(handler, logging.FileHandler)
                and any(handler.stream is stream for stream in streams)
            ):
                handler.setStream(writer)
                rebound += 1
    return rebound


def _capture_real_stdout() -> IO[str]:
    fd = os.dup(1)
    return os.fdopen(fd, "w", encoding="utf-8", buffering=1)


def _emit(out: IO[str], **payload: Any) -> None:
    payload.setdefault(
        "updatedAt",
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    )
    # lastError above all: a frontend's error can quote its credential.
    payload = {
        key: _REDACTOR.redact(value) if isinstance(value, str) else value
        for key, value in payload.items()
    }
    try:
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), file=out)
    except BrokenPipeError:
        _watchdog.exit_parentless(
            "Galley Core status pipe closed", label="managed-im-supervisor"
        )
    except OSError as e:
        if e.errno == errno.EPIPE:
            _watchdog.exit_parentless(
                "Galley Core status pipe closed", label="managed-im-supervisor"
            )
        raise


class _SupervisorLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._file: IO[str] | None = None
        self._locked = False

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)
        f = open(self.path, "r+", encoding="utf-8", buffering=1)
        try:
            if os.name == "nt":  # pragma: no cover - exercised on Windows smoke only
                import msvcrt

                if not f.read(1):
                    f.seek(0)
                    f.write("\0")
                    f.flush()
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]
            else:
                import fcntl

                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError):
            f.close()
            return False
        self._file = f
        self._locked = True
        return True

    def write_metadata(self, *, platform: str, state_dir: Path) -> None:
        if not self._file:
            return
        self._file.seek(0)
        self._file.truncate()
        self._file.write(
            json.dumps(
                {
                    "pid": os.getpid(),
                    "platform": platform,
                    "stateDir": str(state_dir),
                    "corePid": os.environ.get(_watchdog.GALLEY_CORE_PID_ENV),
                    "updatedAt": datetime.now(timezone.utc)
                    .isoformat(timespec="milliseconds")
                    .replace("+00:00", "Z"),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        self._file.write("\n")
        self._file.flush()

    def close(self) -> None:
        if not self._file:
            return
        try:
            if self._locked:
                if os.name == "nt":  # pragma: no cover - exercised on Windows smoke only
                    import msvcrt

                    self._file.seek(0)
                    msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]
                else:
                    import fcntl

                    fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            self._file.close()
        finally:
            self._file = None
            self._locked = False

    def __del__(self) -> None:
        self.close()


def _acquire_supervisor_lock(
    *,
    platform: str,
    state_dir: Path,
    log_path: Path,
    out: IO[str],
) -> _SupervisorLock | None:
    lock = _SupervisorLock(state_dir / IM_SUPERVISOR_LOCK_NAME)
    if not lock.acquire():
        _emit(
            out,
            platform=platform,
            state="error",
            lastError=(
                f"Another Galley {platform} supervisor is already running for "
                f"state directory: {state_dir}"
            ),
            logPath=str(log_path),
        )
        return None
    lock.write_metadata(platform=platform, state_dir=state_dir)
    return lock


def _install_paths(ga_path: str) -> None:
    if ga_path not in sys.path:
        sys.path.insert(0, ga_path)
    frontends_dir = os.path.join(ga_path, "frontends")
    if frontends_dir not in sys.path:
        sys.path.insert(0, frontends_dir)


def _redirect_logs(log_path: Path) -> IO[str]:
    """Send this process's prints to the channel log, masked. Every channel
    runs this before it imports its frontend, so the credentials Core put
    in the env are masked from then on, in the log and in status lines."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logf = open(log_path, "a", encoding="utf-8", buffering=1)
    _REDACTOR.load_env()
    writer = cast(TextIO, _RedactingWriter(logf, _REDACTOR))
    started_with = (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
    sys.stdout = sys.stderr = writer
    # Some GA frontends explicitly write to sys.__stdout__; keep the JSON line
    # channel private to this launcher and send frontend prints to the log.
    sys.__stdout__ = writer  # type: ignore[misc,assignment]
    sys.__stderr__ = writer  # type: ignore[misc,assignment]
    _rebind_logging_streams(writer, started_with)
    return writer


def _flush_and_release_lock(logf: IO[str], lock: _SupervisorLock) -> None:
    try:
        logf.flush()
    except Exception:
        pass
    lock.close()


def _start_resume(platform: str, state_dir: Path) -> im_resume.ChannelResume | None:
    """The single-agent channel's restart continuity. Failure to set it up
    must never take the channel down: the channel then runs as before,
    with a fresh context after every restart."""
    try:
        return im_resume.load(platform, state_dir)
    except Exception as e:
        print(f"{im_resume.LOG_PREFIX} disabled: {e}")
        return None


def _wechat_status_reply(agent: Any) -> str:
    """The other channels' ``/status`` (chatapp_common's), for wechatapp's
    single agent: running or idle, and the current model."""
    llm = agent.get_llm_name() if getattr(agent, "llmclient", None) else "未配置"
    state = "🔴 运行中" if getattr(agent, "is_running", False) else "🟢 空闲"
    return f"状态：{state}\nLLM：[{agent.llm_no}] {llm}"


def _managed_wechat_on_message(
    wechatapp: Any, resume: im_resume.ChannelResume | None = None
) -> Callable[[Any, Any], None]:
    """Wrap upstream ``on_message``: ``/switch`` cannot leave the managed
    agent mode, ``/help`` / ``/status`` / ``/new`` (which upstream lacks)
    are answered here, and a context that could not be picked back up
    after a restart says so on the next answer."""

    def on_message(bot: Any, msg: Any) -> None:
        text = bot.extract_text(msg).strip()
        reply: str | None = None
        if text == "/switch":
            reply = WECHAT_SWITCH_BLOCKED_REPLY
        elif text == "/help":
            reply = WECHAT_HELP_REPLY
        elif text == "/status":
            reply = _wechat_status_reply(wechatapp.agent)
        if reply is not None:
            bot.send_text(
                msg.get("from_user_id", ""),
                reply,
                context_token=msg.get("context_token", ""),
            )
            return
        if resume is None:
            wechatapp.on_message(bot, msg)
            return
        if text == "/new":
            im_resume.wechat_new_conversation(wechatapp, resume, bot, msg)
            return
        wechatapp.on_message(im_resume.WechatNoticeBot(bot, resume), msg)

    return on_message


def _run_wechat(args: argparse.Namespace, out: IO[str]) -> int:
    state_dir = Path(args.state_dir).expanduser().resolve()
    temp_dir = state_dir / "temp"
    token_file = state_dir / "token.json"
    qr_file = state_dir / f"wx_qr_{time.time_ns()}_{os.getpid()}.png"
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = _acquire_supervisor_lock(
        platform=args.platform,
        state_dir=state_dir,
        log_path=state_dir / "wechat.log",
        out=out,
    )
    if lock is None:
        return 1
    logf = _redirect_logs(state_dir / "wechat.log")
    temp_dir.mkdir(parents=True, exist_ok=True)
    for old_qr in state_dir.glob("wx_qr*.png"):
        try:
            old_qr.unlink()
        except OSError:
            pass
    os.environ["GALLEY_WECHAT_TOKEN_FILE"] = str(token_file)
    os.environ["GALLEY_WECHAT_TEMP_DIR"] = str(temp_dir)
    os.environ["GALLEY_WECHAT_QR_FILE"] = str(qr_file)

    _install_paths(args.ga_path)
    managed_runtime.install_managed_mykey_loader()
    managed_state_root = managed_runtime.managed_state_root()
    if managed_state_root:
        os.chdir(managed_state_root)

    try:
        import frontends.wechatapp as wechatapp  # type: ignore[import-not-found]
    except Exception as e:
        _emit(out, platform="wechat", state="error", lastError=f"import failed: {e}")
        _flush_and_release_lock(logf, lock)
        return 1

    wechatapp._TEMP_DIR = str(temp_dir)
    wechatapp._MODE = WECHAT_MANAGED_MODE
    wechatapp.agent.verbose = False
    managed_runtime.install_managed_prompt_profile(
        wechatapp.agent,
        extra_env_names=(IM_SUPERVISOR_PROMPT_ENV,),
    )
    # Before the agent's run thread starts: the first message runs in the
    # conversation picked back up from before the restart.
    resume = _start_resume("wechat", state_dir)
    if resume is not None:
        resume.attach(wechatapp.agent)

    _emit(
        out,
        platform="wechat",
        state="starting",
        logPath=str(state_dir / "wechat.log"),
    )

    if args.relogin:
        token_file.unlink(missing_ok=True)
        qr_file.unlink(missing_ok=True)

    bot = wechatapp.WxBotClient(token_file=str(token_file))
    # The saved login's token (token.json), masked like the env credentials.
    _REDACTOR.add(getattr(bot, "token", None))
    if args.relogin or not bot.token:
        qr_file.unlink(missing_ok=True)
        _emit(
            out,
            platform="wechat",
            state="waiting_scan",
            logPath=str(state_dir / "wechat.log"),
        )
        login_result: dict[str, Any] = {"done": False, "error": None}

        def _login() -> None:
            try:
                bot.login_qr()
            except Exception as e:  # pragma: no cover - network/platform path
                login_result["error"] = e
            finally:
                login_result["done"] = True

        login_thread = threading.Thread(target=_login, daemon=True)
        login_thread.start()
        qr_announced = False
        while not login_result["done"]:
            if qr_file.exists() and not qr_announced:
                _emit(
                    out,
                    platform="wechat",
                    state="waiting_scan",
                    qrImagePath=str(qr_file),
                    logPath=str(state_dir / "wechat.log"),
                )
                qr_announced = True
            login_thread.join(timeout=0.25)
        if login_result["error"] is not None:
            _emit(out, platform="wechat", state="error", lastError=str(login_result["error"]))
            _flush_and_release_lock(logf, lock)
            return 1
        # The token this QR login just obtained.
        _REDACTOR.add(getattr(bot, "token", None))

    threading.Thread(target=wechatapp.agent.run, daemon=True).start()
    _emit(
        out,
        platform="wechat",
        state="running",
        botId=bot.bot_id,
        qrImagePath=str(qr_file) if qr_file.exists() else None,
        logPath=str(state_dir / "wechat.log"),
    )

    try:
        bot.run_loop(_managed_wechat_on_message(wechatapp, resume))
    except wechatapp.AuthExpired:
        _emit(out, platform="wechat", state="expired", lastError="WeChat login expired")
        return 2
    except KeyboardInterrupt:
        _emit(out, platform="wechat", state="stopped")
        return 0
    except Exception as e:
        _emit(out, platform="wechat", state="error", lastError=str(e))
        return 1
    finally:
        _flush_and_release_lock(logf, lock)
    return 0


def _run_feishu(args: argparse.Namespace, out: IO[str]) -> int:
    state_dir = Path(args.state_dir).expanduser().resolve()
    temp_dir = state_dir / "temp"
    user_data_dir = state_dir / "ga_config"
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = _acquire_supervisor_lock(
        platform=args.platform,
        state_dir=state_dir,
        log_path=state_dir / "feishu.log",
        out=out,
    )
    if lock is None:
        return 1
    logf = _redirect_logs(state_dir / "feishu.log")
    temp_dir.mkdir(parents=True, exist_ok=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["GA_WORKSPACE_ROOT"] = str(state_dir)
    os.environ["GA_USER_DATA_DIR"] = str(user_data_dir)
    os.environ["GALLEY_FEISHU_TEMP_DIR"] = str(temp_dir)

    _install_paths(args.ga_path)
    managed_runtime.install_managed_mykey_loader()
    managed_state_root = managed_runtime.managed_state_root()
    if managed_state_root:
        os.chdir(managed_state_root)

    try:
        import frontends.fsapp as fsapp  # type: ignore[import-not-found]
    except Exception as e:
        _emit(out, platform="feishu", state="error", lastError=f"import failed: {e}")
        _flush_and_release_lock(logf, lock)
        return 1

    os.chdir(state_dir)
    resume = _start_resume("feishu", state_dir)
    if resume is not None:
        im_resume.install_feishu(fsapp, resume)
    original_get_agent = fsapp.get_agent
    agent_setup_lock = threading.Lock()

    def _managed_get_agent() -> Any:
        agent = original_get_agent()
        if getattr(agent, "_galley_im_prompt_installed", False):
            return agent
        # fsapp builds its agent lazily, on the first message or the first
        # report turn. The conversation from before the restart is picked
        # back up here, before that caller gets the agent (nothing is queued
        # yet); a concurrent first caller waits for it.
        with agent_setup_lock:
            if not getattr(agent, "_galley_im_prompt_installed", False):
                agent.verbose = False
                managed_runtime.install_managed_prompt_profile(
                    agent,
                    extra_env_names=(IM_SUPERVISOR_PROMPT_ENV,),
                )
                if resume is not None:
                    resume.attach(agent)
                agent._galley_im_prompt_installed = True
        return agent

    fsapp.get_agent = _managed_get_agent
    # Extra keyword fields (e.g. ownerOpenId on owner binding) pass
    # through to the JSON status line for Galley Core to persist.
    fsapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: _emit(
        out,
        platform="feishu",
        state=state,
        lastError=last_error,
        logPath=str(state_dir / "feishu.log"),
        **extra,
    )

    # Proactive completion reporter (Feishu only). Failure to start must
    # never take the channel down — the reporter is an enhancement, the
    # inbound message path is the product.
    try:
        from runner import im_reporter

        im_reporter.start_feishu_reporter(fsapp, state_dir)
    except Exception as e:
        print(f"[galley-im-reporter] disabled: {e}")

    _emit(
        out,
        platform="feishu",
        state="starting",
        logPath=str(state_dir / "feishu.log"),
    )

    try:
        config = fsapp.check_config(init_agent=False)
    except Exception as e:
        _emit(out, platform="feishu", state="error", lastError=f"config check failed: {e}")
        _flush_and_release_lock(logf, lock)
        return 1
    if not config.get("ready"):
        _emit(
            out,
            platform="feishu",
            state="error",
            lastError="Feishu App ID and App Secret are required",
            logPath=str(state_dir / "feishu.log"),
        )
        _flush_and_release_lock(logf, lock)
        return 1

    try:
        code = fsapp.main()
        return int(code or 0)
    except KeyboardInterrupt:
        _emit(out, platform="feishu", state="stopped")
        return 0
    except Exception as e:
        _emit(out, platform="feishu", state="error", lastError=str(e))
        return 1
    finally:
        _flush_and_release_lock(logf, lock)


def _run_telegram(args: argparse.Namespace, out: IO[str]) -> int:
    state_dir = Path(args.state_dir).expanduser().resolve()
    temp_dir = state_dir / "temp"
    user_data_dir = state_dir / "ga_config"
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = _acquire_supervisor_lock(
        platform=args.platform,
        state_dir=state_dir,
        log_path=state_dir / "telegram.log",
        out=out,
    )
    if lock is None:
        return 1
    logf = _redirect_logs(state_dir / "telegram.log")
    temp_dir.mkdir(parents=True, exist_ok=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["GA_WORKSPACE_ROOT"] = str(state_dir)
    os.environ["GA_USER_DATA_DIR"] = str(user_data_dir)

    _install_paths(args.ga_path)
    managed_runtime.install_managed_mykey_loader()
    managed_state_root = managed_runtime.managed_state_root()
    if managed_state_root:
        os.chdir(managed_state_root)

    # tgapp reads GALLEY_TELEGRAM_CONFIG_JSON (set by Galley Core before
    # spawn) at import time. Import failure exits with SystemExit when the
    # telegram dependency is missing — catch it so the status line still
    # reaches Core instead of a silent nonzero exit.
    try:
        import frontends.tgapp as tgapp  # type: ignore[import-not-found]
    except (Exception, SystemExit) as e:
        _emit(out, platform="telegram", state="error", lastError=f"import failed: {e}")
        _flush_and_release_lock(logf, lock)
        return 1

    os.chdir(state_dir)
    tgapp._TEMP_DIR = str(temp_dir)
    tgapp.agent.verbose = False
    managed_runtime.install_managed_prompt_profile(
        tgapp.agent,
        extra_env_names=(IM_SUPERVISOR_PROMPT_ENV,),
    )
    # Before the reporter and main(): the first message and the first
    # report turn both run in the conversation picked back up.
    resume = _start_resume("telegram", state_dir)
    if resume is not None:
        resume.attach(tgapp.agent)
        im_resume.install_telegram(tgapp, resume)
    # Extra keyword fields (botId on connect, ownerOpenId on owner binding)
    # pass through to the JSON status line for Galley Core to persist.
    tgapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: _emit(
        out,
        platform="telegram",
        state=state,
        lastError=last_error,
        logPath=str(state_dir / "telegram.log"),
        **extra,
    )

    # Proactive completion reporter. Failure to start must never take the
    # channel down — the reporter is an enhancement, the inbound message
    # path is the product.
    try:
        from runner import im_reporter

        im_reporter.start_telegram_reporter(tgapp, state_dir)
    except Exception as e:
        print(f"[galley-im-reporter] disabled: {e}")

    _emit(
        out,
        platform="telegram",
        state="starting",
        logPath=str(state_dir / "telegram.log"),
    )

    if not tgapp.check_config().get("ready"):
        _emit(
            out,
            platform="telegram",
            state="error",
            lastError="Telegram Bot Token is required",
            logPath=str(state_dir / "telegram.log"),
        )
        _flush_and_release_lock(logf, lock)
        return 1

    try:
        code = tgapp.main()
        return int(code or 0)
    except KeyboardInterrupt:
        _emit(out, platform="telegram", state="stopped")
        return 0
    except Exception as e:
        _emit(out, platform="telegram", state="error", lastError=str(e))
        return 1
    finally:
        _flush_and_release_lock(logf, lock)


def _run_discord(args: argparse.Namespace, out: IO[str]) -> int:
    state_dir = Path(args.state_dir).expanduser().resolve()
    temp_dir = state_dir / "temp"
    user_data_dir = state_dir / "ga_config"
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = _acquire_supervisor_lock(
        platform=args.platform,
        state_dir=state_dir,
        log_path=state_dir / "discord.log",
        out=out,
    )
    if lock is None:
        return 1
    logf = _redirect_logs(state_dir / "discord.log")
    temp_dir.mkdir(parents=True, exist_ok=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["GA_WORKSPACE_ROOT"] = str(state_dir)
    os.environ["GA_USER_DATA_DIR"] = str(user_data_dir)
    # dcapp resolves its active-channel file and attachment scratch from
    # this at import time; without it they land in the shipped payload.
    os.environ["GALLEY_DISCORD_STATE_DIR"] = str(state_dir)

    _install_paths(args.ga_path)
    managed_runtime.install_managed_mykey_loader()
    managed_state_root = managed_runtime.managed_state_root()
    if managed_state_root:
        os.chdir(managed_state_root)

    # dcapp reads GALLEY_DISCORD_CONFIG_JSON (set by Galley Core before
    # spawn) at import time, and exits with SystemExit when discord.py is
    # missing — catch it so the status line still reaches Core instead of
    # a silent nonzero exit.
    try:
        import frontends.dcapp as dcapp  # type: ignore[import-not-found]
    except (Exception, SystemExit) as e:
        # dcapp's SystemExit stringifies to its bare exit code ("1"),
        # which told the first dogfooder nothing. Name the by-far most
        # common cause outright instead of pointing at the log.
        import importlib.util

        if importlib.util.find_spec("discord") is None:
            detail = (
                f"discord.py is not installed for {sys.executable} "
                f"(dev builds run the PATH python3; try: "
                f"python3 -m pip install discord.py)"
            )
        else:
            detail = str(e)
        _emit(out, platform="discord", state="error", lastError=f"import failed: {detail}")
        _flush_and_release_lock(logf, lock)
        return 1

    os.chdir(state_dir)
    # Extra keyword fields (botId on connect, ownerOpenId on owner binding)
    # pass through to the JSON status line for Galley Core to persist.
    dcapp.GALLEY_STATUS_HOOK = lambda state, last_error=None, **extra: _emit(
        out,
        platform="discord",
        state=state,
        lastError=last_error,
        logPath=str(state_dir / "discord.log"),
        **extra,
    )

    # Proactive completion reporter. Failure to start must never take the
    # channel down — the reporter is an enhancement, the inbound message
    # path is the product.
    reporter: Any = None
    try:
        from runner import im_reporter

        reporter = im_reporter.start_discord_reporter(dcapp, state_dir)
    except Exception as e:
        print(f"[galley-im-reporter] disabled: {e}")

    # One supervisor context per channel: the per-channel identity is bound
    # onto each channel agent as it is created, never onto os.environ.
    prompt_env = (
        IM_SUPERVISOR_PROMPT_TEMPLATE_ENV
        if os.environ.get(IM_SUPERVISOR_PROMPT_TEMPLATE_ENV)
        else IM_SUPERVISOR_PROMPT_ENV
    )
    base_supervisor_id = (os.environ.get("GALLEY_SUPERVISOR_ID") or "").strip()

    def _on_agent_created(agent: Any, chat_id: str) -> None:
        agent.verbose = False
        managed_runtime.install_managed_prompt_profile(
            agent,
            extra_env_names=(prompt_env,),
            supervisor_id=(
                f"{base_supervisor_id}/{chat_id}" if base_supervisor_id else None
            ),
        )
        if reporter is not None:
            reporter.attach_channel(chat_id, agent)

    def _on_channel_released(chat_id: str) -> None:
        if reporter is not None:
            reporter.detach_channel(chat_id)

    dcapp.GALLEY_AGENT_HOOK = _on_agent_created
    dcapp.GALLEY_CHANNEL_RELEASED_HOOK = _on_channel_released

    _emit(
        out,
        platform="discord",
        state="starting",
        logPath=str(state_dir / "discord.log"),
    )

    if not dcapp.check_config().get("ready"):
        _emit(
            out,
            platform="discord",
            state="error",
            lastError="Discord Bot Token is required",
            logPath=str(state_dir / "discord.log"),
        )
        _flush_and_release_lock(logf, lock)
        return 1

    try:
        code = dcapp.main()
        return int(code or 0)
    except KeyboardInterrupt:
        _emit(out, platform="discord", state="stopped")
        return 0
    except Exception as e:
        _emit(out, platform="discord", state="error", lastError=str(e))
        return 1
    finally:
        _flush_and_release_lock(logf, lock)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a Galley-managed IM Supervisor.")
    parser.add_argument(
        "--platform",
        choices=["wechat", "feishu", "telegram", "discord"],
        required=True,
    )
    parser.add_argument("--ga-path", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--sop-path", required=True)
    parser.add_argument("--relogin", action="store_true")
    args = parser.parse_args(argv)

    out = _capture_real_stdout()
    _watchdog.start_parent_watchdog(
        _watchdog.parse_core_pid(),
        label="managed-im-supervisor",
        thread_name="galley-im-parent-watchdog",
    )
    if not managed_runtime.is_managed_runtime():
        _emit(out, platform=args.platform, state="error", lastError="not a managed runtime")
        return 1
    if args.platform == "wechat":
        return _run_wechat(args, out)
    if args.platform == "feishu":
        return _run_feishu(args, out)
    if args.platform == "telegram":
        return _run_telegram(args, out)
    if args.platform == "discord":
        return _run_discord(args, out)
    _emit(out, platform=args.platform, state="error", lastError="unsupported platform")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
