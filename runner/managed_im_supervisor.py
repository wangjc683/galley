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

from runner import managed_runtime

IM_SUPERVISOR_PROMPT_ENV = "GALLEY_IM_SUPERVISOR_PROMPT_TEXT"
GALLEY_CORE_PID_ENV = "GALLEY_CORE_PID"
IM_SUPERVISOR_LOCK_NAME = "supervisor.lock"
PARENT_WATCH_INTERVAL_SEC = 2.0
_EXIT_FOR_PARENT_LOSS = os._exit


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
        _exit_parentless("Galley Core status pipe closed")
    except OSError as e:
        if e.errno == errno.EPIPE:
            _exit_parentless("Galley Core status pipe closed")
        raise


def _exit_parentless(reason: str) -> None:
    try:
        print(f"[managed-im-supervisor] exiting: {reason}", file=sys.__stderr__, flush=True)
    except Exception:
        pass
    _EXIT_FOR_PARENT_LOSS(0)
    raise SystemExit(0)


def _parse_core_pid() -> int | None:
    raw = os.environ.get(GALLEY_CORE_PID_ENV)
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError:
        return None
    if pid <= 0 or pid == os.getpid():
        return None
    return pid


def _parent_process_alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - exercised on Windows smoke only
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            process_query_limited_information = 0x1000
            synchronize = 0x00100000
            wait_timeout = 0x00000102
            handle = kernel32.OpenProcess(
                process_query_limited_information | synchronize,
                False,
                wintypes.DWORD(pid),
            )
            if not handle:
                return False
            try:
                result = int(kernel32.WaitForSingleObject(handle, 0))
                return result == wait_timeout
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _parent_loss_reason(parent_pid: int | None, original_ppid: int | None) -> str | None:
    if parent_pid is None:
        return None
    if not _parent_process_alive(parent_pid):
        return f"Galley Core process {parent_pid} disappeared"
    if original_ppid is not None and hasattr(os, "getppid"):
        current_ppid = os.getppid()
        if current_ppid not in {original_ppid, parent_pid}:
            return f"parent process changed from {original_ppid} to {current_ppid}"
    return None


def _start_parent_watchdog(parent_pid: int | None) -> None:
    if parent_pid is None:
        return
    original_ppid = os.getppid() if hasattr(os, "getppid") else None

    def _watch() -> None:
        while True:
            time.sleep(PARENT_WATCH_INTERVAL_SEC)
            reason = _parent_loss_reason(parent_pid, original_ppid)
            if reason:
                _exit_parentless(reason)

    threading.Thread(target=_watch, name="galley-im-parent-watchdog", daemon=True).start()


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
                    "corePid": os.environ.get(GALLEY_CORE_PID_ENV),
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a Galley-managed IM Supervisor.")
    parser.add_argument("--platform", choices=["wechat", "feishu", "telegram"], required=True)
    parser.add_argument("--ga-path", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--sop-path", required=True)
    parser.add_argument("--relogin", action="store_true")
    args = parser.parse_args(argv)

    out = _capture_real_stdout()
    _start_parent_watchdog(_parse_core_pid())
    if not managed_runtime.is_managed_runtime():
        _emit(out, platform=args.platform, state="error", lastError="not a managed runtime")
        return 1
    if args.platform == "wechat":
        return _run_wechat(args, out)
    if args.platform == "feishu":
        return _run_feishu(args, out)
    if args.platform == "telegram":
        return _run_telegram(args, out)
    _emit(out, platform=args.platform, state="error", lastError="unsupported platform")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
