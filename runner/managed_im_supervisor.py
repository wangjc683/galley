"""Galley-managed IM Supervisor launcher.

Galley wraps GenericAgent's official IM frontends while keeping model config,
prompt, state paths, and process lifetime owned by Galley.
"""
from __future__ import annotations

import argparse
import errno
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any

from runner import _watchdog, managed_runtime

IM_SUPERVISOR_PROMPT_ENV = "GALLEY_IM_SUPERVISOR_PROMPT_TEXT"
# Same prompt body with the supervisor id left unresolved. Core injects it
# only for multi-context platforms (Discord), where the identity is per
# channel and therefore cannot ride a process-wide env var.
IM_SUPERVISOR_PROMPT_TEMPLATE_ENV = "GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE"
IM_SUPERVISOR_LOCK_NAME = "supervisor.lock"


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
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logf = open(log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = logf
    # Some GA frontends explicitly write to sys.__stdout__; keep the JSON line
    # channel private to this launcher and send frontend prints to the log.
    sys.__stdout__ = logf  # type: ignore[misc]
    sys.__stderr__ = logf  # type: ignore[misc]
    return logf


def _flush_and_release_lock(logf: IO[str], lock: _SupervisorLock) -> None:
    try:
        logf.flush()
    except Exception:
        pass
    lock.close()


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
    wechatapp.agent.verbose = False
    managed_runtime.install_managed_prompt_profile(
        wechatapp.agent,
        extra_env_names=(IM_SUPERVISOR_PROMPT_ENV,),
    )

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
        bot.run_loop(wechatapp.on_message)
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
    original_get_agent = fsapp.get_agent

    def _managed_get_agent() -> Any:
        agent = original_get_agent()
        if not getattr(agent, "_galley_im_prompt_installed", False):
            agent.verbose = False
            managed_runtime.install_managed_prompt_profile(
                agent,
                extra_env_names=(IM_SUPERVISOR_PROMPT_ENV,),
            )
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
