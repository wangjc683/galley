"""Shared, crash-safe Desktop settings storage for bridge and package tools."""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import stat
import time
import uuid
from pathlib import Path
from typing import Callable


LOCK_TIMEOUT_SECONDS = 5.0
LOCK_STALE_SECONDS = 30.0
PACKAGE_PATH_KEYS = ("python_path", "project_dir", "bridge_script")


class DesktopSettingsError(RuntimeError):
    pass


def _lock_path(settings_path: Path) -> Path:
    return settings_path.with_name(f"{settings_path.name}.lock")


@contextlib.contextmanager
def settings_lock(
    settings_path: Path,
    *,
    timeout: float = LOCK_TIMEOUT_SECONDS,
    stale_after: float = LOCK_STALE_SECONDS,
):
    lock_path = _lock_path(settings_path)
    token = f"{os.getpid()}:{uuid.uuid4().hex}"
    deadline = time.monotonic() + timeout
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            os.mkdir(lock_path, 0o700)
            (lock_path / "owner").write_text(token, encoding="ascii")
            break
        except FileExistsError:
            try:
                lock_stat = lock_path.lstat()
                if not stat.S_ISDIR(lock_stat.st_mode) or stat.S_ISLNK(lock_stat.st_mode):
                    raise DesktopSettingsError(f"settings lock is not a directory: {lock_path}")
                stale = time.time() - lock_stat.st_mtime > stale_after
            except FileNotFoundError:
                continue
            if stale:
                tombstone = lock_path.with_name(f"{lock_path.name}.stale.{uuid.uuid4().hex}")
                try:
                    os.rename(lock_path, tombstone)
                except FileNotFoundError:
                    continue
                except OSError:
                    pass
                else:
                    shutil.rmtree(tombstone, ignore_errors=True)
                    continue
            if time.monotonic() >= deadline:
                raise DesktopSettingsError(f"timed out waiting for settings lock: {lock_path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            owner = lock_path / "owner"
            if owner.read_text(encoding="ascii") == token:
                owner.unlink()
                lock_path.rmdir()
        except (FileNotFoundError, OSError):
            pass


def read_settings(settings_path: Path, *, strict: bool = True) -> dict:
    if not settings_path.exists():
        return {}
    try:
        document = json.loads(settings_path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        if strict:
            raise DesktopSettingsError(f"cannot read Desktop settings: {error}") from error
        return {}
    if not isinstance(document, dict):
        if strict:
            raise DesktopSettingsError(f"Desktop settings must be a JSON object: {settings_path}")
        return {}
    return document


def write_settings_atomically(settings_path: Path, document: dict) -> None:
    if not isinstance(document, dict):
        raise DesktopSettingsError("Desktop settings must be a JSON object")
    mode = stat.S_IMODE(settings_path.stat().st_mode) if settings_path.exists() else 0o600
    payload = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    temporary = settings_path.with_name(
        f".{settings_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, settings_path)
        if os.name != "nt":
            directory = os.open(settings_path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    except OSError as error:
        raise DesktopSettingsError(f"cannot write Desktop settings: {error}") from error
    finally:
        temporary.unlink(missing_ok=True)


def update_settings(settings_path: Path, mutate: Callable[[dict], None]) -> dict:
    with settings_lock(settings_path):
        document = read_settings(settings_path, strict=True)
        mutate(document)
        write_settings_atomically(settings_path, document)
        return document


def merge_package_paths(
    settings_path: Path,
    *,
    python_path: str,
    project_dir: str,
    bridge_script: str,
) -> dict:
    updates = {
        "python_path": python_path,
        "project_dir": project_dir,
        "bridge_script": bridge_script,
    }
    return update_settings(settings_path, lambda document: document.update(updates))


def _path_is_within(value: str, bundle_root: str) -> bool:
    try:
        candidate = os.path.normcase(os.path.abspath(os.path.expanduser(value)))
        bundle = os.path.normcase(os.path.abspath(os.path.expanduser(bundle_root)))
        return os.path.commonpath((candidate, bundle)) == bundle
    except (OSError, ValueError):
        return False


def remove_bundle_paths(settings_path: Path, bundle_root: str) -> dict:
    def remove_owned(document: dict) -> None:
        for key in PACKAGE_PATH_KEYS:
            value = document.get(key)
            if isinstance(value, str) and _path_is_within(value, bundle_root):
                document.pop(key, None)

    return update_settings(settings_path, remove_owned)
