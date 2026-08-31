from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path

import pytest

import frontends.data_backup as data_backup
from frontends.data_backup import (
    BACKUP_FORMAT_VERSION,
    BACKUP_SCHEMA,
    BackupFormatError,
    export_data_backup,
    inspect_import_source,
    materialize_import_source,
    merge_data_files,
)


def _seed_data(root: Path) -> None:
    (root / "memory" / "nested").mkdir(parents=True)
    (root / "memory" / "notes.md").write_text("memory", encoding="utf-8")
    (root / "memory" / "nested" / "facts.json").write_text("{}", encoding="utf-8")
    (root / "temp" / "model_responses").mkdir(parents=True)
    (root / "temp" / "model_responses" / "response.json").write_text("{}", encoding="utf-8")
    (root / "temp" / "desktop_sessions").mkdir(parents=True)
    (root / "temp" / "desktop_sessions" / "sess-one.json").write_text(
        json.dumps({"id": "sess-one", "title": "One", "messages": []}),
        encoding="utf-8",
    )
    (root / "mykey.py").write_text("secret", encoding="utf-8")
    (root / "agentmain.py").write_text("code", encoding="utf-8")
    (root / "logs").mkdir()
    (root / "logs" / "bridge.log").write_text("private log", encoding="utf-8")


class TestDataBackupExport:
    def test_exports_only_allowed_data_and_private_manifest(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        destination = tmp_path / "GenericAgent-data-backup.zip"

        result = export_data_backup(str(source), str(destination), "localRepository")

        assert result["content"] == {"memory": 2, "responses": 1, "sessions": 1}
        with zipfile.ZipFile(destination) as archive:
            names = set(archive.namelist())
            assert names == {
                "manifest.json",
                "memory/notes.md",
                "memory/nested/facts.json",
                "temp/model_responses/response.json",
                "temp/desktop_sessions/sess-one.json",
            }
            manifest = json.loads(archive.read("manifest.json"))
        assert manifest["schema"] == BACKUP_SCHEMA
        assert manifest["formatVersion"] == BACKUP_FORMAT_VERSION
        assert manifest["sourceMode"] == "localRepository"
        assert str(source) not in json.dumps(manifest)
        assert "mykey.py" not in names
        assert "agentmain.py" not in names
        assert "logs/bridge.log" not in names

    def test_rejects_symlinks_instead_of_reading_through_them(self, tmp_path: Path):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        secret = tmp_path / "outside-secret.txt"
        secret.write_text("secret", encoding="utf-8")
        (source / "memory" / "linked.txt").symlink_to(secret)
        destination = tmp_path / "backup.zip"

        with pytest.raises(ValueError, match="link or reparse point"):
            export_data_backup(str(source), str(destination), "included")

        assert not destination.exists()

    def test_rejects_destination_inside_exported_data_before_replacing_it(
        self, tmp_path: Path
    ):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        destination = source / "memory" / "nested-backup.zip"
        destination.write_bytes(b"old-destination")

        with pytest.raises(ValueError, match="protected application data"):
            export_data_backup(str(source), str(destination), "included")

        assert destination.read_bytes() == b"old-destination"

    def test_rejects_http_readable_destination_before_creating_it(self, tmp_path: Path):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "one.md").write_text("one", encoding="utf-8")
        upload_root = source / "temp" / "desktop_uploads"
        upload_root.mkdir(parents=True)
        destination = upload_root / "exfil.zip"

        with pytest.raises(ValueError, match="protected application data"):
            export_data_backup(
                str(source), str(destination), "included", forbidden_roots=(upload_root,)
            )

        assert not destination.exists()

    def test_export_enforces_the_same_entry_limit_as_import(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "one.md").write_text("one", encoding="utf-8")
        destination = tmp_path / "backup.zip"
        destination.write_bytes(b"old")
        monkeypatch.setattr(data_backup, "MAX_ARCHIVE_ENTRIES", 1)

        with pytest.raises(BackupFormatError, match="too many files"):
            export_data_backup(str(source), str(destination), "included")

        assert destination.read_bytes() == b"old"

    def test_export_enforces_the_same_size_limit_as_import(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "one.md").write_text("one", encoding="utf-8")
        destination = tmp_path / "backup.zip"
        destination.write_bytes(b"old")
        monkeypatch.setattr(data_backup, "MAX_ARCHIVE_UNCOMPRESSED_BYTES", 1)

        with pytest.raises(BackupFormatError, match="too large"):
            export_data_backup(str(source), str(destination), "included")

        assert destination.read_bytes() == b"old"

    def test_export_revalidates_written_zip_before_replacing_destination(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        data_file = source / "memory" / "one.md"
        data_file.write_text("one", encoding="utf-8")
        destination = tmp_path / "backup.zip"
        destination.write_bytes(b"old")
        monkeypatch.setattr(data_backup, "MAX_ARCHIVE_UNCOMPRESSED_BYTES", 10_000)
        original_write = zipfile.ZipFile.write

        def grow_then_write(archive, filename, arcname=None, *args, **kwargs):
            path = Path(filename)
            if path == data_file:
                path.write_bytes(b"x" * 20_000)
            return original_write(archive, filename, arcname, *args, **kwargs)

        monkeypatch.setattr(zipfile.ZipFile, "write", grow_then_write)

        with pytest.raises(BackupFormatError, match="too large"):
            export_data_backup(str(source), str(destination), "included")

        assert destination.read_bytes() == b"old"
        assert not list(tmp_path.glob(".backup.*.tmp"))


class TestDataBackupInspection:
    def test_inspects_generated_backup(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        destination = tmp_path / "backup.zip"
        export_data_backup(str(source), str(destination), "included")

        result = inspect_import_source(str(destination))

        assert result["sourceType"] == "backupZip"
        assert result["sourceMode"] == "included"
        assert result["content"]["sessions"] == 1

    def test_rejects_traversal_before_extraction(self, tmp_path: Path):
        destination = tmp_path / "traversal.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 0, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("../outside.txt", "escape")

        with pytest.raises(BackupFormatError, match="invalid backup entry path"):
            inspect_import_source(str(destination))

    def test_rejects_symlink_entries(self, tmp_path: Path):
        destination = tmp_path / "link.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 1, "responses": 0, "sessions": 0},
        }
        link = zipfile.ZipInfo("memory/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr(link, "../../secret")

        with pytest.raises(BackupFormatError, match="contains links"):
            inspect_import_source(str(destination))

    def test_rejects_manifest_count_mismatch(self, tmp_path: Path):
        destination = tmp_path / "mismatch.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 2, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("memory/one.md", "one")

        with pytest.raises(BackupFormatError, match="summary"):
            inspect_import_source(str(destination))

    def test_rejects_duplicate_paths_even_when_case_differs(self, tmp_path: Path):
        destination = tmp_path / "duplicates.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 2, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("memory/Note.md", "one")
            archive.writestr("memory/note.md", "two")

        with pytest.raises(BackupFormatError, match="duplicate"):
            inspect_import_source(str(destination))

    def test_accepts_session_only_legacy_folder(self, tmp_path: Path):
        source = tmp_path / "legacy"
        (source / "temp").mkdir(parents=True)
        (source / "temp" / "desktop_sessions.json").write_text(
            json.dumps([{"id": "sess-only", "messages": [], "msg_seq": 0}]),
            encoding="utf-8",
        )

        result = inspect_import_source(str(source))

        assert result["sourceType"] == "legacyFolder"
        assert result["content"] == {"memory": 0, "responses": 0, "sessions": 1}

    def test_rejects_empty_legacy_folder_and_empty_backup(self, tmp_path: Path):
        source = tmp_path / "legacy"
        (source / "temp").mkdir(parents=True)
        (source / "temp" / "desktop_sessions.json").write_text("[]", encoding="utf-8")
        with pytest.raises(BackupFormatError, match="no importable data"):
            inspect_import_source(str(source))

        backup = tmp_path / "empty.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 0, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(backup, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
        with pytest.raises(BackupFormatError, match="no importable data"):
            inspect_import_source(str(backup))

    def test_accepts_generated_sessions_only_zip(self, tmp_path: Path):
        source = tmp_path / "source"
        sessions = source / "temp" / "desktop_sessions"
        sessions.mkdir(parents=True)
        (sessions / "sess-only.json").write_text(
            json.dumps({"id": "sess-only", "messages": [], "msg_seq": 0}),
            encoding="utf-8",
        )
        backup = tmp_path / "sessions-only.zip"

        export_data_backup(str(source), str(backup), "included")
        inspection = inspect_import_source(str(backup))

        assert inspection["content"] == {"memory": 0, "responses": 0, "sessions": 1}


class TestDataBackupImport:
    def test_sessions_only_backup_round_trips(self, tmp_path: Path):
        source = tmp_path / "source"
        sessions = source / "temp" / "desktop_sessions"
        sessions.mkdir(parents=True)
        (sessions / "sess-only.json").write_text(
            json.dumps({"id": "sess-only", "messages": [], "msg_seq": 0}),
            encoding="utf-8",
        )
        backup = tmp_path / "sessions-only.zip"
        export_data_backup(str(source), str(backup), "included")
        target = tmp_path / "target"
        target.mkdir()

        with materialize_import_source(str(backup)) as extracted:
            result = merge_data_files(str(extracted), str(target))

        assert result["sessionsAdded"] == 1
        assert result["memoryCopied"] == 0
        assert (target / "temp" / "desktop_sessions" / "sess-only.json").is_file()

    def test_materializes_backup_and_applies_the_full_merge_contract(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        backup = tmp_path / "backup.zip"
        export_data_backup(str(source), str(backup), "included")

        target = tmp_path / "target"
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "notes.md").write_text("current", encoding="utf-8")
        with materialize_import_source(str(backup)) as extracted:
            result = merge_data_files(str(extracted), str(target))
            assert (extracted / "temp" / "desktop_sessions" / "sess-one.json").is_file()

        assert result.keys() >= {
            "ok",
            "memoryCopied",
            "responsesCopied",
            "responsesSkipped",
            "sessionsAdded",
            "sessionsSkipped",
            "sessionsFileFound",
            "backupDir",
        }
        assert result["memoryCopied"] == 2
        assert result["memorySkipped"] == 0
        assert result["responsesCopied"] == 1
        assert result["sessionsAdded"] == 1
        assert result["sessionsSkipped"] == 0
        assert result["sessionsFileFound"] is True
        assert (target / "memory" / "notes.md").read_text(encoding="utf-8") == "memory"
        assert (target / "memory" / "nested" / "facts.json").is_file()
        assert (target / "temp" / "desktop_sessions" / "sess-one.json").is_file()
        backup_dir = Path(result["backupDir"])
        assert backup_dir.is_dir()
        assert (backup_dir / "memory" / "notes.md").read_text(encoding="utf-8") == "current"

    def test_memory_is_source_wins_responses_are_add_only(self, tmp_path: Path):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "same.md").write_text("new", encoding="utf-8")
        (source / "memory" / "added.md").write_text("added", encoding="utf-8")
        (source / "temp" / "model_responses").mkdir(parents=True)
        (source / "temp" / "model_responses" / "same.json").write_text("new", encoding="utf-8")
        (source / "temp" / "model_responses" / "added.json").write_text("added", encoding="utf-8")
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "same.md").write_text("old", encoding="utf-8")
        (target / "temp" / "model_responses").mkdir(parents=True)
        (target / "temp" / "model_responses" / "same.json").write_text("old", encoding="utf-8")

        result = merge_data_files(str(source), str(target))

        assert result["memoryCopied"] == 2
        assert result["responsesCopied"] == 1
        assert result["responsesSkipped"] == 1
        assert (target / "memory" / "same.md").read_text(encoding="utf-8") == "new"
        assert (target / "memory" / "added.md").read_text(encoding="utf-8") == "added"
        assert (target / "temp" / "model_responses" / "same.json").read_text(encoding="utf-8") == "old"
        assert (target / "temp" / "model_responses" / "added.json").read_text(encoding="utf-8") == "added"
        assert (Path(result["backupDir"]) / "memory" / "same.md").read_text(encoding="utf-8") == "old"

    def test_sessions_dedupe_by_desktop_id_across_new_and_legacy_stores(self, tmp_path: Path):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        source_sessions = source / "temp" / "desktop_sessions"
        source_sessions.mkdir(parents=True)
        (source_sessions / "existing.json").write_text(
            json.dumps({"id": "sess-existing", "messages": []}), encoding="utf-8"
        )
        (source_sessions / "new.json").write_text(
            json.dumps({"id": "sess-new", "messages": []}), encoding="utf-8"
        )
        (source_sessions / "tui.json").write_text(
            json.dumps({"id": "tui_worker", "messages": []}), encoding="utf-8"
        )
        (source_sessions / "corrupt.json").write_text("{bad", encoding="utf-8")
        (source / "temp" / "desktop_sessions.json").write_text(
            json.dumps([
                {"id": "sess-new", "messages": []},
                {"id": "sess-legacy", "messages": []},
                {"id": "../../escape", "messages": []},
            ]),
            encoding="utf-8",
        )
        target_sessions = target / "temp" / "desktop_sessions"
        target_sessions.mkdir(parents=True)
        (target_sessions / "different-name.json").write_text(
            json.dumps({"id": "sess-existing", "messages": []}), encoding="utf-8"
        )

        result = merge_data_files(
            str(source), str(target), existing_session_ids={"sess-in-memory"}
        )

        assert result["sessionsAdded"] == 2
        assert result["sessionsSkipped"] == 5
        assert result["sessionsFileFound"] is True
        assert (target_sessions / "sess-new.json").is_file()
        assert (target_sessions / "sess-legacy.json").is_file()
        assert not (tmp_path / "escape.json").exists()

    def test_invalid_session_schema_is_skipped_and_valid_record_is_canonical(
        self, tmp_path: Path
    ):
        source = tmp_path / "source"
        sessions = source / "temp" / "desktop_sessions"
        sessions.mkdir(parents=True)
        records = {
            "int-id.json": {"id": 7, "messages": [], "msg_seq": 0},
            "nan-time.json": {
                "id": "sess-nan",
                "messages": [],
                "msg_seq": 0,
                "updated_at": float("nan"),
            },
            "bad-seq.json": {"id": "sess-seq", "messages": [], "msg_seq": -1},
            "bad-messages.json": {
                "id": "sess-msg",
                "messages": ["not-an-object"],
                "msg_seq": 0,
            },
            "valid.json": {
                "id": "sess-valid",
                "title": "Valid",
                "messages": [{"id": 1, "role": "user", "content": "hi"}],
                "msg_seq": 1,
                "created_at": 10,
                "updated_at": 11.5,
                "llm_history": [{"role": "user", "content": "hi"}],
                "unknown": "drop-me",
            },
        }
        for name, record in records.items():
            (sessions / name).write_text(json.dumps(record), encoding="utf-8")
        target = tmp_path / "target"
        target.mkdir()

        result = merge_data_files(str(source), str(target))

        assert result["sessionsAdded"] == 1
        assert result["sessionsSkipped"] == 4
        document = json.loads(
            (target / "temp" / "desktop_sessions" / "sess-valid.json").read_text(
                encoding="utf-8"
            )
        )
        assert document["id"] == "sess-valid"
        assert document["updated_at"] == 11.5
        assert document["messages"][0]["role"] == "user"
        assert "unknown" not in document

    def test_mocked_windows_reparse_source_is_rejected_before_read(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        memory = source / "memory"
        memory.mkdir(parents=True)
        (memory / "secret.md").write_text("secret", encoding="utf-8")
        destination = tmp_path / "backup.zip"
        real_check = data_backup._is_link_or_reparse

        monkeypatch.setattr(
            data_backup,
            "_is_link_or_reparse",
            lambda path: Path(path) == memory or real_check(Path(path)),
        )

        with pytest.raises(ValueError, match="safe directory"):
            export_data_backup(str(source), str(destination), "included")
        assert not destination.exists()

    def test_mocked_windows_reparse_target_ancestor_is_rejected_before_write(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "new.md").write_text("new", encoding="utf-8")
        target_memory = target / "memory"
        target_memory.mkdir(parents=True)
        (target_memory / "old.md").write_text("old", encoding="utf-8")
        real_check = data_backup._is_link_or_reparse

        monkeypatch.setattr(
            data_backup,
            "_is_link_or_reparse",
            lambda path: Path(path) == target_memory or real_check(Path(path)),
        )

        with pytest.raises(ValueError, match="safe directory"):
            merge_data_files(str(source), str(target))
        assert (target_memory / "old.md").read_text(encoding="utf-8") == "old"
        assert not (target_memory / "new.md").exists()

    def test_empty_target_needs_no_backup_and_reports_missing_sessions(self, tmp_path: Path):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "one.md").write_text("one", encoding="utf-8")
        target.mkdir()

        result = merge_data_files(str(source), str(target))

        assert result["backupDir"] == ""
        assert result["sessionsAdded"] == 0
        assert result["sessionsSkipped"] == 0
        assert result["sessionsFileFound"] is False

    def test_backup_failure_never_writes_the_destination(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "same.md").write_text("new", encoding="utf-8")
        (source / "temp" / "model_responses").mkdir(parents=True)
        (source / "temp" / "model_responses" / "added.json").write_text("new", encoding="utf-8")
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "same.md").write_text("old", encoding="utf-8")

        def fail_backup(*_args, **_kwargs):
            raise OSError("backup disk full")

        monkeypatch.setattr(data_backup, "_create_memory_backup", fail_backup)

        with pytest.raises(OSError, match="backup disk full"):
            merge_data_files(str(source), str(target))

        assert (target / "memory" / "same.md").read_text(encoding="utf-8") == "old"
        assert not (target / "temp" / "model_responses" / "added.json").exists()

    def test_staging_copy_failure_cleans_up_without_partial_writes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        responses = source / "temp" / "model_responses"
        responses.mkdir(parents=True)
        (responses / "a-ok.json").write_text("ok", encoding="utf-8")
        (responses / "z-fail.json").write_text("fail", encoding="utf-8")
        target.mkdir()
        real_copy2 = data_backup.shutil.copy2

        def fail_second_copy(source_path, destination_path, *args, **kwargs):
            if Path(source_path).name == "z-fail.json":
                raise OSError("copy failed")
            return real_copy2(source_path, destination_path, *args, **kwargs)

        monkeypatch.setattr(data_backup.shutil, "copy2", fail_second_copy)

        with pytest.raises(OSError, match="copy failed"):
            merge_data_files(str(source), str(target))

        assert not (target / "temp" / "model_responses" / "a-ok.json").exists()
        assert not list(target.glob(".genericagent-memory-import-*"))

    def test_activation_partial_failure_rolls_memory_and_added_files_back(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "same.md").write_text("new", encoding="utf-8")
        (source / "temp" / "model_responses").mkdir(parents=True)
        (source / "temp" / "model_responses" / "fail.json").write_text("new", encoding="utf-8")
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "same.md").write_text("old", encoding="utf-8")
        failing_target = target / "temp" / "model_responses" / "fail.json"

        real_install = data_backup._install_file_add_only

        def fail_response_activation(source_path, destination_path):
            if Path(destination_path) == failing_target:
                raise OSError("activation failed")
            return real_install(source_path, destination_path)

        monkeypatch.setattr(
            data_backup, "_install_file_add_only", fail_response_activation
        )

        with pytest.raises(OSError, match="activation failed"):
            merge_data_files(str(source), str(target))

        assert (target / "memory" / "same.md").read_text(encoding="utf-8") == "old"
        assert not failing_target.exists()
        backups = list((target / "temp").glob("memory_import_backup_*"))
        assert len(backups) == 1
        assert (backups[0] / "memory" / "same.md").read_text(encoding="utf-8") == "old"

    def test_add_only_install_falls_back_on_filesystems_without_hard_links(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        responses = source / "temp" / "model_responses"
        responses.mkdir(parents=True)
        (responses / "portable.json").write_text("portable", encoding="utf-8")
        target.mkdir()

        def unsupported_link(*_args, **_kwargs):
            raise OSError(data_backup.errno.EOPNOTSUPP, "hard links unsupported")

        monkeypatch.setattr(data_backup.os, "link", unsupported_link)

        result = merge_data_files(str(source), str(target))

        assert result["responsesCopied"] == 1
        assert (
            target / "temp" / "model_responses" / "portable.json"
        ).read_text(encoding="utf-8") == "portable"

    def test_concurrent_response_creation_is_never_overwritten(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        source = tmp_path / "source"
        target = tmp_path / "target"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "same.md").write_text("new", encoding="utf-8")
        responses = source / "temp" / "model_responses"
        responses.mkdir(parents=True)
        (responses / "race.json").write_text("import", encoding="utf-8")
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "same.md").write_text("old", encoding="utf-8")
        racing_target = target / "temp" / "model_responses" / "race.json"
        real_link = data_backup.os.link

        def collide_then_link(source_path, destination_path, **kwargs):
            destination = Path(destination_path)
            if destination == racing_target:
                destination.write_text("concurrent", encoding="utf-8")
            return real_link(source_path, destination_path, **kwargs)

        monkeypatch.setattr(data_backup.os, "link", collide_then_link)

        with pytest.raises(FileExistsError):
            merge_data_files(str(source), str(target))

        assert racing_target.read_text(encoding="utf-8") == "concurrent"
        assert (target / "memory" / "same.md").read_text(encoding="utf-8") == "old"

    def test_memory_backup_refuses_symlinked_temp_directory(self, tmp_path: Path):
        source = tmp_path / "source"
        target = tmp_path / "target"
        outside = tmp_path / "outside"
        (source / "memory").mkdir(parents=True)
        (source / "memory" / "same.md").write_text("new", encoding="utf-8")
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "same.md").write_text("old", encoding="utf-8")
        outside.mkdir()
        (target / "temp").symlink_to(outside, target_is_directory=True)

        with pytest.raises(ValueError, match="backup destination"):
            merge_data_files(str(source), str(target))

        assert (target / "memory" / "same.md").read_text(encoding="utf-8") == "old"
        assert list(outside.iterdir()) == []
