"""Read and validate encrypted SCPO RGS backup bundles."""

import getpass
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"SCPO-RGS\x01"
DATABASES = ("access", "audit", "nursing", "pharmacy", "social", "xray", "maintenance")
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 20 * 1024**3


def decrypt_and_extract(
    source: Path, destination: Path, *, password: str | None = None
) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    archive_path = destination.parent / ".rgs-bundle.tar.gz"
    with source.open("rb") as encrypted:
        is_password_bundle = encrypted.read(len(MAGIC)) == MAGIC
    try:
        if is_password_bundle:
            supplied_password = password or os.getenv("SCPO_RGS_PASSWORD") or getpass.getpass(
                "Senha do backup .rgs: "
            )
            _decrypt_password_bundle(source, archive_path, supplied_password)
        else:
            with archive_path.open("wb") as output:
                subprocess.run(
                    ["gpg", "--batch", "--decrypt", str(source)],
                    check=True,
                    stdout=output,
                    stderr=subprocess.PIPE,
                )
        _extract_validated_archive(archive_path, destination, modern=is_password_bundle)
    finally:
        archive_path.unlink(missing_ok=True)


def _decrypt_password_bundle(source: Path, destination: Path, password: str) -> None:
    header_length = len(MAGIC) + 16 + 12
    file_size = source.stat().st_size
    if file_size <= header_length + 16:
        raise ValueError("Arquivo .rgs AES-GCM incompleto")
    with source.open("rb") as encrypted:
        magic = encrypted.read(len(MAGIC))
        salt = encrypted.read(16)
        nonce = encrypted.read(12)
        encrypted.seek(-16, os.SEEK_END)
        tag = encrypted.read(16)
        encrypted.seek(header_length)
        remaining = file_size - header_length - len(tag)
        key = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**15,
            r=8,
            p=1,
            maxmem=64 * 1024 * 1024,
            dklen=32,
        )
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        decryptor.authenticate_additional_data(magic)
        with destination.open("wb") as output:
            while remaining:
                chunk = encrypted.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError("Arquivo .rgs AES-GCM truncado")
                output.write(decryptor.update(chunk))
                remaining -= len(chunk)
            output.write(decryptor.finalize())


def _extract_validated_archive(archive_path: Path, destination: Path, *, modern: bool) -> None:
    with tarfile.open(name=str(archive_path), mode="r:gz") as archive:
        members = archive.getmembers()
        if len(members) > len(DATABASES) + 2:
            raise ValueError("O pacote contém itens demais")
        names: set[str] = set()
        files: dict[str, tarfile.TarInfo] = {}
        total_size = 0
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.name in names:
                raise ValueError("O pacote contém caminhos inválidos ou duplicados")
            names.add(member.name)
            if member.isdir():
                if member.name != "dumps" or modern:
                    raise ValueError("O pacote contém diretório inesperado")
            elif member.isfile():
                total_size += member.size
                if total_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                    raise ValueError("O conteúdo do pacote excede o limite permitido")
                files[member.name] = member
            else:
                raise ValueError("O pacote contém um tipo de arquivo não permitido")

        manifest_name = "manifest.json" if modern else "MANIFEST.txt"
        expected_names = (
            {manifest_name, *(f"{service}.dump" for service in DATABASES)}
            if modern
            else {manifest_name, *(f"dumps/scpo_{service}.dump" for service in DATABASES)}
        )
        if set(files) != expected_names:
            raise ValueError("O pacote não contém exatamente o manifesto e os sete bancos esperados")

        manifest_file = archive.extractfile(files[manifest_name])
        if manifest_file is None:
            raise ValueError("Manifesto RGS ausente")
        if files[manifest_name].size > 65536:
            raise ValueError("Manifesto RGS excede o tamanho permitido")
        manifest = manifest_file.read()
        if modern:
            manifest_data = json.loads(manifest)
            if (
                not isinstance(manifest_data, dict)
                or manifest_data.get("format") != "SCPO-RGS-1"
                or tuple(manifest_data.get("databases", ())) != DATABASES
            ):
                raise ValueError("Formato ou lista de bancos inválida no manifesto RGS")
        elif b"Formato: RGS v1 (GPG)" not in manifest or not all(
            f"scpo_{service}".encode() in manifest for service in DATABASES
        ):
            raise ValueError("Formato ou lista de bancos inválida no manifesto RGS")

        destination.mkdir(parents=True, exist_ok=True)
        for service in DATABASES:
            member_name = (
                f"{service}.dump"
                if modern
                else f"dumps/scpo_{service}.dump"
            )
            dump = archive.extractfile(files[member_name])
            if dump is None:
                raise ValueError(f"Dump ausente: {service}")
            with (destination / f"{service}.dump").open("xb") as output:
                shutil.copyfileobj(dump, output, length=1024 * 1024)


def main() -> None:
    import sys

    if len(sys.argv) != 3:
        raise SystemExit("Uso: python -m scpo_services.rgs_format ARQUIVO DESTINO")
    decrypt_and_extract(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
