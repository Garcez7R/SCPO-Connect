import io
import json
import tarfile

import pytest
from scpo_services.backup import _encrypt
from scpo_services.rgs_format import (
    DATABASES,
    _extract_validated_archive,
    decrypt_and_extract,
)


def _add_file(archive: tarfile.TarFile, name: str, contents: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(contents)
    archive.addfile(info, io.BytesIO(contents))


def test_restore_reader_decrypts_and_extracts_password_encrypted_bundle(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
        _add_file(
            archive,
            "manifest.json",
            json.dumps(
                {"format": "SCPO-RGS-1", "databases": list(DATABASES)}
            ).encode(),
        )
        for service in DATABASES:
            _add_file(archive, f"{service}.dump", f"dump-{service}".encode())

    source = tmp_path / "backup.rgs"
    source.write_bytes(_encrypt(bundle.getvalue(), "test-password-strong"))
    destination = tmp_path / "restored"
    monkeypatch.setenv("SCPO_RGS_PASSWORD", "test-password-strong")

    decrypt_and_extract(source, destination)

    assert {
        service: (destination / f"{service}.dump").read_bytes()
        for service in DATABASES
    } == {service: f"dump-{service}".encode() for service in DATABASES}


def test_restore_reader_rejects_unsafe_archive_members(tmp_path) -> None:
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
        _add_file(archive, "../escape", b"not allowed")
    archive_path = tmp_path / "bundle.tar.gz"
    archive_path.write_bytes(bundle.getvalue())

    with pytest.raises(ValueError, match="caminhos inválidos"):
        _extract_validated_archive(archive_path, tmp_path, modern=True)


def test_restore_reader_accepts_legacy_gpg_bundle_layout(tmp_path) -> None:
    bundle = io.BytesIO()
    with tarfile.open(fileobj=bundle, mode="w:gz") as archive:
        directory = tarfile.TarInfo("dumps")
        directory.type = tarfile.DIRTYPE
        archive.addfile(directory)
        _add_file(
            archive,
            "MANIFEST.txt",
            (
                "SCPO Connect backup\nFormato: RGS v1 (GPG)\n"
                "Bancos: " + " ".join(f"scpo_{service}" for service in DATABASES) + "\n"
            ).encode(),
        )
        for service in DATABASES:
            _add_file(archive, f"dumps/scpo_{service}.dump", service.encode())
        _add_file(archive, "attachments/env/.env", b"synthetic=only")
    archive_path = tmp_path / "legacy.tar.gz"
    archive_path.write_bytes(bundle.getvalue())
    destination = tmp_path / "restored"

    _extract_validated_archive(archive_path, destination, modern=False)

    assert (destination / "nursing.dump").read_bytes() == b"nursing"
    assert (destination / "attachments/env/.env").read_bytes() == b"synthetic=only"
