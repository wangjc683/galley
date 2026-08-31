"""Safe, dependency-free import/export helpers for desktop data snapshots."""
from __future__ import annotations

import contextlib
import datetime as dt
import errno
import json
import math
import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable, Iterator


BACKUP_SCHEMA = "genericagent.data-backup"
BACKUP_FORMAT_VERSION = 1
MAX_ARCHIVE_ENTRIES = 100_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

_DATA_PREFIXES = (
    PurePosixPath("memory"),
    PurePosixPath("temp/model_responses"),
    PurePosixPath("temp/desktop_sessions"),
)

_DESKTOP_SESSION_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


class BackupFormatError(ValueError):
    """Raised when a backup cannot be trusted or is not compatible."""


def _is_relative_to(path: PurePosixPath, parent: PurePosixPath) -> bool:
    return path == parent or parent in path.parents


def _is_native_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _is_link_or_reparse(path: Path) -> bool:
    """Recognise POSIX links plus Windows junction/reparse-point indirection."""
    try:
        if path.is_symlink():
            return True
        is_junction = getattr(path, "is_junction", None)
        if callable(is_junction) and is_junction():
            return True
        attributes = int(getattr(os.lstat(path), "st_file_attributes", 0) or 0)
        reparse_flag = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
        return bool(attributes & reparse_flag)
    except OSError:
        return False


def _resolved_directory(value: str | Path, label: str) -> Path:
    raw = Path(value).expanduser()
    if _is_link_or_reparse(raw):
        raise ValueError(f"{label} cannot be a link or reparse point")
    try:
        resolved = raw.resolve(strict=True)
    except OSError as error:
        raise ValueError(f"{label} is unavailable") from error
    if not resolved.is_dir() or _is_link_or_reparse(resolved):
        raise ValueError(f"{label} is unavailable")
    return resolved


def _assert_contained(path: Path, root: Path, label: str) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise ValueError(f"{label} is unavailable") from error
    if not _is_native_relative_to(resolved, root):
        raise ValueError(f"{label} escapes its data root")
    return resolved


def _archive_path(name: str) -> PurePosixPath:
    if not name or "\\" in name:
        raise BackupFormatError("invalid backup entry path")
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise BackupFormatError("invalid backup entry path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise BackupFormatError("invalid backup entry path")
    return path


def _is_allowed_data_path(path: PurePosixPath) -> bool:
    return any(_is_relative_to(path, prefix) for prefix in _DATA_PREFIXES)


def _iter_regular_files(root: Path) -> Iterator[tuple[Path, PurePosixPath]]:
    root = root.resolve()
    for folder, dirs, files in os.walk(root, followlinks=False):
        folder_path = Path(folder)
        if _is_link_or_reparse(folder_path):
            raise ValueError(f"data folder contains a link or reparse point: {folder_path}")
        safe_dirs: list[str] = []
        for name in sorted(dirs):
            candidate = folder_path / name
            if _is_link_or_reparse(candidate):
                raise ValueError(f"data folder contains a link or reparse point: {candidate}")
            _assert_contained(candidate, root, "data folder")
            safe_dirs.append(name)
        dirs[:] = safe_dirs
        for name in sorted(files):
            source = folder_path / name
            if _is_link_or_reparse(source):
                raise ValueError(f"data folder contains a link or reparse point: {source}")
            if not source.is_file():
                raise ValueError(f"data folder contains an unsupported file: {source}")
            _assert_contained(source, root, "data file")
            relative = PurePosixPath(source.relative_to(root).as_posix())
            yield source, relative


def _source_files(root: Path) -> list[tuple[Path, PurePosixPath]]:
    files: list[tuple[Path, PurePosixPath]] = []
    for prefix in _DATA_PREFIXES:
        source_root = root.joinpath(*prefix.parts)
        if not source_root.exists():
            continue
        if _is_link_or_reparse(source_root) or not source_root.is_dir():
            raise ValueError(f"data folder is not a safe directory: {source_root}")
        for source, relative in _iter_regular_files(source_root):
            files.append((source, prefix / relative))
    return files


def _content_counts(paths: list[PurePosixPath]) -> dict[str, int]:
    return {
        "memory": sum(_is_relative_to(path, _DATA_PREFIXES[0]) for path in paths),
        "responses": sum(_is_relative_to(path, _DATA_PREFIXES[1]) for path in paths),
        "sessions": sum(_is_relative_to(path, _DATA_PREFIXES[2]) for path in paths),
    }


def _normalise_source_mode(value: str) -> str:
    if value not in ("included", "localRepository"):
        raise BackupFormatError("invalid backup source mode")
    return value


def _manifest(source_mode: str, paths: list[PurePosixPath]) -> dict:
    exported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    return {
        "schema": BACKUP_SCHEMA,
        "formatVersion": BACKUP_FORMAT_VERSION,
        "exportedAt": exported_at.isoformat().replace("+00:00", "Z"),
        "sourceMode": _normalise_source_mode(source_mode),
        "content": _content_counts(paths),
    }


def export_data_backup(
    ga_root: str,
    destination_path: str,
    source_mode: str,
    *,
    forbidden_roots: Iterable[str | Path] = (),
) -> dict:
    root = _resolved_directory(ga_root, "current data source")
    raw_destination = Path(destination_path).expanduser()
    if _is_link_or_reparse(raw_destination):
        raise ValueError("backup destination cannot be a link or reparse point")
    destination = raw_destination.resolve()
    if destination.suffix.lower() != ".zip":
        raise ValueError("backup destination must be a zip file")
    if not destination.parent.is_dir() or _is_link_or_reparse(destination.parent):
        raise ValueError("backup destination folder does not exist")
    protected_roots = [root.joinpath(*prefix.parts).resolve() for prefix in _DATA_PREFIXES]
    protected_roots.extend(Path(value).expanduser().resolve() for value in forbidden_roots)
    if any(_is_native_relative_to(destination, protected) for protected in protected_roots):
        raise ValueError("backup destination is inside protected application data")

    files = _source_files(root)
    paths = [relative for _, relative in files]
    if not paths:
        raise BackupFormatError("backup contains no importable data")
    manifest = _manifest(source_mode, paths)
    manifest_bytes = (
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    if len(files) + 1 > MAX_ARCHIVE_ENTRIES:
        raise BackupFormatError("backup contains too many files")
    total_bytes = len(manifest_bytes)
    for source, _relative in files:
        _assert_contained(source, root, "data file")
        total_bytes += source.stat().st_size
        if total_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
            raise BackupFormatError("backup is too large")

    temp_handle = tempfile.NamedTemporaryFile(
        prefix=f".{destination.stem}.",
        suffix=".tmp",
        dir=destination.parent,
        delete=False,
    )
    temp_path = Path(temp_handle.name)
    temp_handle.close()
    try:
        with zipfile.ZipFile(
            temp_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            for source, relative in files:
                if _is_link_or_reparse(source):
                    raise ValueError(f"data file became a link or reparse point: {source}")
                _assert_contained(source, root, "data file")
                archive.write(source, relative.as_posix())
        # Validate the bytes that will actually replace the destination.  A source
        # can change after the preflight stat, and ZipFile only finalises CRCs and
        # the central directory when it closes.
        with zipfile.ZipFile(temp_path, "r") as archive:
            _validated_zip(archive)
        os.replace(temp_path, destination)
    except Exception:
        with contextlib.suppress(OSError):
            temp_path.unlink()
        raise

    return {
        "ok": True,
        "path": str(destination),
        "formatVersion": BACKUP_FORMAT_VERSION,
        "exportedAt": manifest["exportedAt"],
        "sourceMode": manifest["sourceMode"],
        "content": manifest["content"],
    }


def _validated_zip(archive: zipfile.ZipFile) -> tuple[dict, list[zipfile.ZipInfo]]:
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        raise BackupFormatError("backup contains too many files")
    total_bytes = sum(info.file_size for info in infos)
    if total_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        raise BackupFormatError("backup is too large")
    if archive.testzip() is not None:
        raise BackupFormatError("backup is corrupt")

    manifest_info: zipfile.ZipInfo | None = None
    data_infos: list[zipfile.ZipInfo] = []
    seen_paths: set[str] = set()
    for info in infos:
        path = _archive_path(info.filename.rstrip("/"))
        folded_path = path.as_posix().casefold()
        if folded_path in seen_paths:
            raise BackupFormatError("backup contains duplicate file paths")
        seen_paths.add(folded_path)
        unix_mode = (info.external_attr >> 16) & 0o170000
        if unix_mode == stat.S_IFLNK:
            raise BackupFormatError("backup contains links")
        if path == PurePosixPath("manifest.json"):
            if info.is_dir() or manifest_info is not None:
                raise BackupFormatError("backup manifest is invalid")
            manifest_info = info
            continue
        if not _is_allowed_data_path(path):
            raise BackupFormatError("backup contains unsupported files")
        if not info.is_dir():
            data_infos.append(info)

    if manifest_info is None:
        raise BackupFormatError("backup manifest is missing")
    try:
        manifest = json.loads(archive.read(manifest_info).decode("utf-8"))
    except Exception as error:
        raise BackupFormatError("backup manifest is invalid") from error
    if not isinstance(manifest, dict):
        raise BackupFormatError("backup manifest is invalid")
    if manifest.get("schema") != BACKUP_SCHEMA:
        raise BackupFormatError("backup format is not supported")
    if manifest.get("formatVersion") != BACKUP_FORMAT_VERSION:
        raise BackupFormatError("backup version is not supported")
    _normalise_source_mode(str(manifest.get("sourceMode") or ""))
    if not isinstance(manifest.get("exportedAt"), str) or not manifest["exportedAt"]:
        raise BackupFormatError("backup export time is missing")

    actual_counts = _content_counts([
        _archive_path(info.filename) for info in data_infos
    ])
    if not data_infos:
        raise BackupFormatError("backup contains no importable data")
    if manifest.get("content") != actual_counts:
        raise BackupFormatError("backup content summary does not match its files")
    return manifest, data_infos


def _legacy_inspection(root: Path) -> dict:
    files = _source_files(root)
    paths = [relative for _, relative in files]
    session_items, _sessions_found, _sessions_skipped = _read_source_sessions(root)
    counts = _content_counts(paths)
    counts["sessions"] = len(session_items)
    if not any(counts.values()):
        raise BackupFormatError("not a GA data source (no importable data)")
    return {
        "ok": True,
        "sourceType": "legacyFolder",
        "formatVersion": None,
        "exportedAt": None,
        "sourceMode": None,
        "content": counts,
    }


def inspect_import_source(source_path: str) -> dict:
    raw_source = Path(source_path).expanduser()
    if _is_link_or_reparse(raw_source):
        raise BackupFormatError("import source cannot be a link or reparse point")
    source = raw_source.resolve()
    if source.is_dir() and not _is_link_or_reparse(source):
        return _legacy_inspection(source)
    if not source.is_file() or source.suffix.lower() != ".zip":
        raise BackupFormatError("select a compatible backup or data folder")
    try:
        with zipfile.ZipFile(source, "r") as archive:
            manifest, _ = _validated_zip(archive)
    except zipfile.BadZipFile as error:
        raise BackupFormatError("backup is corrupt") from error
    return {
        "ok": True,
        "sourceType": "backupZip",
        "formatVersion": manifest["formatVersion"],
        "exportedAt": manifest["exportedAt"],
        "sourceMode": manifest["sourceMode"],
        "content": manifest["content"],
    }


@contextlib.contextmanager
def materialize_import_source(source_path: str) -> Iterator[Path]:
    raw_source = Path(source_path).expanduser()
    if _is_link_or_reparse(raw_source):
        raise BackupFormatError("import source cannot be a link or reparse point")
    source = raw_source.resolve()
    inspection = inspect_import_source(str(source))
    if inspection["sourceType"] == "legacyFolder":
        yield source
        return

    with tempfile.TemporaryDirectory(prefix="genericagent-data-import-") as temp_dir:
        target_root = _resolved_directory(temp_dir, "import staging")
        try:
            with zipfile.ZipFile(source, "r") as archive:
                _, data_infos = _validated_zip(archive)
                for info in data_infos:
                    relative = _archive_path(info.filename)
                    target = target_root.joinpath(*relative.parts)
                    _assert_safe_new_target(target_root, target)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    _assert_contained(target.parent, target_root, "import destination")
                    if target.exists() or _is_link_or_reparse(target):
                        raise BackupFormatError("backup contains duplicate or unsafe paths")
                    with archive.open(info, "r") as reader, target.open("wb") as writer:
                        shutil.copyfileobj(reader, writer)
                    _assert_contained(target, target_root, "import destination")
        except zipfile.BadZipFile as error:
            raise BackupFormatError("backup is corrupt") from error
        yield target_root


def _is_desktop_session_id(value: object) -> bool:
    if not isinstance(value, str):
        return False
    session_id = value
    return (
        not session_id.startswith("tui_")
        and _DESKTOP_SESSION_ID_RE.fullmatch(session_id) is not None
    )


def _finite_timestamp(value: object, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BackupFormatError("session timestamp is invalid")
    timestamp = float(value)
    if not math.isfinite(timestamp):
        raise BackupFormatError("session timestamp is invalid")
    return timestamp


def _non_negative_integer(value: object, default: int, label: str) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise BackupFormatError(f"session {label} is invalid")
    return value


def _record_list(value: object, default: list[dict], label: str) -> list[dict]:
    if value is None:
        return list(default)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise BackupFormatError(f"session {label} is invalid")
    return value


def canonical_session_record(
    item: object,
    *,
    default_cwd: str = "",
    now: float | None = None,
) -> dict[str, Any]:
    """Validate and reduce an imported/persisted Desktop session to its schema."""
    if not isinstance(item, dict):
        raise BackupFormatError("session record is invalid")
    session_id = item.get("id")
    if not _is_desktop_session_id(session_id):
        raise BackupFormatError("session id is invalid")
    current_time = float(now if now is not None else dt.datetime.now().timestamp())
    title = item.get("title", "New chat")
    cwd = item.get("cwd", default_cwd)
    plan_path = item.get("plan_path", "")
    if not isinstance(title, str) or not isinstance(cwd, str) or not isinstance(plan_path, str):
        raise BackupFormatError("session text field is invalid")
    messages = _record_list(item.get("messages"), [], "messages")
    llm_history_value = item.get("llm_history")
    llm_history = None if llm_history_value is None else _record_list(
        llm_history_value, [], "llm history"
    )
    llm_no_value = item.get("llm_no")
    llm_no = None if llm_no_value is None else _non_negative_integer(
        llm_no_value, 0, "model index"
    )
    pinned = item.get("pinned", False)
    untitled = item.get("untitled", True)
    if not isinstance(pinned, bool) or not isinstance(untitled, bool):
        raise BackupFormatError("session boolean field is invalid")
    return {
        "id": session_id,
        "title": title,
        "cwd": cwd,
        "created_at": _finite_timestamp(item.get("created_at"), current_time),
        "updated_at": _finite_timestamp(item.get("updated_at"), current_time),
        "messages": messages,
        "msg_seq": _non_negative_integer(item.get("msg_seq"), 0, "message sequence"),
        "pinned": pinned,
        "untitled": untitled,
        "plan_scan_baseline": _non_negative_integer(
            item.get("plan_scan_baseline"), 0, "plan baseline"
        ),
        "plan_path": plan_path,
        "llm_no": llm_no,
        "llm_history": llm_history,
    }


def _read_source_sessions(source: Path) -> tuple[list[dict], bool, int]:
    """Read supported Desktop session stores without trusting filenames.

    Corrupt/non-Desktop records are skipped. The skipped count is intentionally
    record-oriented; an unreadable file counts as one skipped source record.
    """
    items: list[dict] = []
    found = False
    skipped = 0
    sessions_dir = source / "temp" / "desktop_sessions"
    if sessions_dir.exists() and _is_link_or_reparse(sessions_dir):
        raise ValueError(f"session source contains a link or reparse point: {sessions_dir}")
    if sessions_dir.is_dir():
        for session_file in sorted(sessions_dir.glob("*.json")):
            if _is_link_or_reparse(session_file):
                raise ValueError(
                    f"session source contains a link or reparse point: {session_file}"
                )
            if not session_file.is_file():
                raise ValueError(f"session source contains an unsupported file: {session_file}")
            found = True
            try:
                raw_item = json.loads(session_file.read_text(encoding="utf-8"))
                item = canonical_session_record(raw_item)
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
                skipped += 1
                continue
            items.append(item)

    for legacy in (
        source / "temp" / "desktop_sessions.json",
        source / "temp" / "desktop_sessions.json.migrated",
    ):
        if _is_link_or_reparse(legacy):
            raise ValueError(f"session source contains a link or reparse point: {legacy}")
        if not legacy.is_file():
            continue
        found = True
        try:
            document = json.loads(legacy.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            skipped += 1
            continue
        if not isinstance(document, list):
            skipped += 1
            continue
        for item in document:
            try:
                items.append(canonical_session_record(item))
            except ValueError:
                skipped += 1
    return items, found, skipped


def _existing_session_ids(destination_root: Path) -> set[str]:
    ids: set[str] = set()
    sessions_dir = destination_root / "temp" / "desktop_sessions"
    if _is_link_or_reparse(sessions_dir):
        raise ValueError(f"session destination contains a link or reparse point: {sessions_dir}")
    if not sessions_dir.is_dir():
        return ids
    for session_file in sorted(sessions_dir.glob("*.json")):
        if _is_link_or_reparse(session_file):
            raise ValueError(
                f"session destination contains a link or reparse point: {session_file}"
            )
        if not session_file.is_file():
            raise ValueError(f"session destination contains an unsupported file: {session_file}")
        if _is_desktop_session_id(session_file.stem):
            ids.add(session_file.stem)
        try:
            item = canonical_session_record(
                json.loads(session_file.read_text(encoding="utf-8"))
            )
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            continue
        ids.add(item["id"])
    return ids


def _remove_path(path: Path) -> None:
    if _is_link_or_reparse(path) or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _copy_tree_strict(source: Path, destination: Path) -> None:
    """Copy a complete tree while refusing links and special files."""
    if _is_link_or_reparse(source) or not source.is_dir():
        raise ValueError(f"cannot safely copy data folder: {source}")
    destination.mkdir(parents=True, exist_ok=False)
    for item in sorted(source.iterdir(), key=lambda path: path.name):
        if _is_link_or_reparse(item):
            raise ValueError(f"data folder contains a link or reparse point: {item}")
        _assert_contained(item, source, "data item")
        target = destination / item.name
        if item.is_dir():
            _copy_tree_strict(item, target)
        elif item.is_file():
            shutil.copy2(item, target)
        else:
            raise ValueError(f"data folder contains an unsupported file: {item}")


def _prepare_overlay_target(root: Path, relative: PurePosixPath) -> Path:
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        if _is_link_or_reparse(current):
            raise ValueError(f"memory destination contains a link or reparse point: {current}")
        if current.exists() and not current.is_dir():
            _remove_path(current)
        current.mkdir(exist_ok=True)
        _assert_contained(current, root, "memory destination")
    target = root.joinpath(*relative.parts)
    if _is_link_or_reparse(target):
        raise ValueError(f"memory destination contains a link or reparse point: {target}")
    if target.is_dir():
        _remove_path(target)
    return target


def _assert_safe_new_target(root: Path, target: Path) -> None:
    relative = target.relative_to(root)
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        if _is_link_or_reparse(current):
            raise ValueError(f"data destination contains a link or reparse point: {current}")
        if current.exists() and not current.is_dir():
            raise ValueError(f"data destination parent is not a directory: {current}")
        if current.exists():
            _assert_contained(current, root, "data destination")
    if _is_link_or_reparse(target):
        raise ValueError(f"data destination contains a link or reparse point: {target}")


def _new_backup_path(destination_root: Path) -> Path:
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_parent = destination_root / "temp"
    for suffix in range(1000):
        tail = "" if suffix == 0 else f"_{suffix}"
        candidate = backup_parent / f"memory_import_backup_{timestamp}{tail}"
        if not candidate.exists() and not _is_link_or_reparse(candidate):
            return candidate
    raise OSError("cannot allocate a unique memory backup directory")


def _create_memory_backup(destination_root: Path, memory_root: Path) -> Path:
    backup_dir = _new_backup_path(destination_root)
    backup_parent = backup_dir.parent
    if _is_link_or_reparse(backup_parent) or (
        backup_parent.exists() and not backup_parent.is_dir()
    ):
        raise ValueError("current backup destination is not a safe directory")
    backup_parent.mkdir(parents=True, exist_ok=True)
    _assert_contained(backup_parent, destination_root, "backup destination")
    staging = backup_parent / f".{backup_dir.name}.staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        _copy_tree_strict(memory_root, staging / "memory")
        os.replace(staging, backup_dir)
    except Exception:
        with contextlib.suppress(OSError):
            _remove_path(staging)
        raise
    return backup_dir


def _install_file_add_only(staged: Path, target: Path) -> None:
    """Install one staged file without ever replacing an existing path."""
    try:
        os.link(staged, target, follow_symlinks=False)
    except OSError as error:
        unsupported_link_errors = {
            errno.EINVAL,
            errno.EPERM,
            errno.EXDEV,
            getattr(errno, "ENOTSUP", errno.EINVAL),
            getattr(errno, "EOPNOTSUPP", errno.EINVAL),
        }
        if error.errno not in unsupported_link_errors:
            raise

        # Some removable/network filesystems do not implement hard links.
        # O_EXCL retains the add-only contract there; a failed copy removes
        # only the path this call successfully created.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_BINARY", 0)
        descriptor: int | None = None
        created = False
        try:
            descriptor = os.open(target, flags, stat.S_IMODE(staged.stat().st_mode))
            created = True
            with staged.open("rb") as reader, os.fdopen(descriptor, "wb") as writer:
                descriptor = None
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
        except Exception:
            if descriptor is not None:
                with contextlib.suppress(OSError):
                    os.close(descriptor)
            if created:
                with contextlib.suppress(OSError):
                    target.unlink()
            raise
    with contextlib.suppress(OSError):
        staged.unlink()


def merge_data_files(
    source_dir: str,
    ga_root: str,
    *,
    existing_session_ids: Iterable[str] | None = None,
    session_preparer: Callable[[dict], object] | None = None,
) -> dict[str, Any]:
    """Transactionally merge a validated data tree into ``ga_root``.

    ``memory`` is source-wins after a durable full backup, responses and
    Desktop sessions are add-only, and any activation error rolls back files
    installed by this call. ``session_preparer`` lets the bridge validate and
    construct its in-memory Session objects before any destination is changed.
    """
    source = _resolved_directory(source_dir, "source data folder")
    destination_root = _resolved_directory(ga_root, "current data destination")
    if source == destination_root:
        raise ValueError("source is the same as current data")

    inspection = _legacy_inspection(source)
    source_memory = source.joinpath(*_DATA_PREFIXES[0].parts)
    source_responses = source.joinpath(*_DATA_PREFIXES[1].parts)
    destination_memory = destination_root.joinpath(*_DATA_PREFIXES[0].parts)
    destination_responses = destination_root.joinpath(*_DATA_PREFIXES[1].parts)
    has_source_memory = source_memory.is_dir() and not _is_link_or_reparse(source_memory)

    memory_files = list(_iter_regular_files(source_memory)) if has_source_memory else []
    response_files: list[tuple[Path, PurePosixPath, Path]] = []
    responses_skipped = 0
    if source_responses.exists() and _is_link_or_reparse(source_responses):
        raise ValueError(f"response source contains a link or reparse point: {source_responses}")
    if source_responses.is_dir():
        for item, relative in _iter_regular_files(source_responses):
            target = destination_responses.joinpath(*relative.parts)
            if target.exists() or _is_link_or_reparse(target):
                responses_skipped += 1
                continue
            _assert_safe_new_target(destination_root, target)
            response_files.append((item, relative, target))

    source_session_items, sessions_found, sessions_skipped = _read_source_sessions(source)
    known_session_ids = _existing_session_ids(destination_root)
    if existing_session_ids is not None:
        known_session_ids.update(
            str(value) for value in existing_session_ids if _is_desktop_session_id(value)
        )
    planned_session_ids: set[str] = set()
    session_files: list[tuple[str, dict, Path, object]] = []
    for item in source_session_items:
        session_id = item.get("id")
        if not _is_desktop_session_id(session_id):
            sessions_skipped += 1
            continue
        session_id = str(session_id)
        target = destination_root / "temp" / "desktop_sessions" / f"{session_id}.json"
        if (
            session_id in known_session_ids
            or session_id in planned_session_ids
            or target.exists()
            or _is_link_or_reparse(target)
        ):
            sessions_skipped += 1
            continue
        _assert_safe_new_target(destination_root, target)
        try:
            prepared = session_preparer(item) if session_preparer is not None else item
        except Exception:
            sessions_skipped += 1
            continue
        planned_session_ids.add(session_id)
        session_files.append((session_id, item, target, prepared))

    backup_dir = ""
    prepared_sessions = [entry[3] for entry in session_files]
    with tempfile.TemporaryDirectory(
        prefix=".genericagent-memory-import-",
        dir=destination_root,
    ) as temp_dir:
        staging_root = Path(temp_dir)
        if _is_link_or_reparse(staging_root):
            raise ValueError("import staging cannot be a link or reparse point")
        _assert_contained(staging_root, destination_root, "import staging")
        staged_memory = staging_root / "memory"
        if has_source_memory:
            if _is_link_or_reparse(destination_memory) or (
                destination_memory.exists() and not destination_memory.is_dir()
            ):
                raise ValueError("current memory destination is not a safe directory")
            if destination_memory.is_dir():
                _copy_tree_strict(destination_memory, staged_memory)
            else:
                staged_memory.mkdir()
            for item, relative in memory_files:
                target = _prepare_overlay_target(staged_memory, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)

        staged_responses: list[tuple[Path, Path]] = []
        for item, relative, target in response_files:
            staged = staging_root / "responses" / Path(*relative.parts)
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, staged)
            staged_responses.append((staged, target))

        staged_sessions: list[tuple[Path, Path]] = []
        for session_id, item, target, _prepared in session_files:
            staged = staging_root / "sessions" / f"{session_id}.json"
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_text(
                json.dumps(item, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
            staged_sessions.append((staged, target))

        memory_nonempty = (
            destination_memory.is_dir()
            and next(destination_memory.iterdir(), None) is not None
        )
        if has_source_memory and memory_nonempty:
            backup_dir = str(_create_memory_backup(destination_root, destination_memory))

        installed_files: list[Path] = []
        previous_memory = staging_root / "previous-memory"
        memory_original_moved = False
        memory_activated = False
        memory_existed = destination_memory.is_dir()
        try:
            if has_source_memory:
                if memory_existed:
                    os.replace(destination_memory, previous_memory)
                    memory_original_moved = True
                os.replace(staged_memory, destination_memory)
                memory_activated = True

            for staged, target in (*staged_responses, *staged_sessions):
                if target.exists() or _is_link_or_reparse(target):
                    raise OSError(f"data destination changed during import: {target}")
                _assert_safe_new_target(destination_root, target)
                target.parent.mkdir(parents=True, exist_ok=True)
                # Staging shares the destination filesystem. A hard link gives
                # POSIX/Windows create-if-absent semantics: unlike replace(), it
                # cannot overwrite a response/session created concurrently.
                _install_file_add_only(staged, target)
                installed_files.append(target)
        except Exception as error:
            rollback_errors: list[str] = []
            for target in reversed(installed_files):
                try:
                    target.unlink()
                except OSError as rollback_error:
                    rollback_errors.append(str(rollback_error))
            if memory_activated or memory_original_moved:
                try:
                    if destination_memory.exists() or _is_link_or_reparse(destination_memory):
                        _remove_path(destination_memory)
                    if memory_original_moved:
                        os.replace(previous_memory, destination_memory)
                except OSError as rollback_error:
                    rollback_errors.append(str(rollback_error))
            if rollback_errors:
                raise OSError(
                    f"data import failed: {error}; rollback failed: "
                    + "; ".join(rollback_errors)
                ) from error
            raise

    result: dict[str, Any] = {
        "ok": True,
        "memoryCopied": len(memory_files),
        "memorySkipped": 0,
        "responsesCopied": len(response_files),
        "responsesSkipped": responses_skipped,
        "sessionsAdded": len(session_files),
        "sessionsSkipped": sessions_skipped,
        "sessionsFileFound": sessions_found,
        "backupDir": backup_dir,
        "sourceType": inspection["sourceType"],
    }
    if session_preparer is not None:
        result["_preparedSessions"] = prepared_sessions
    return result
