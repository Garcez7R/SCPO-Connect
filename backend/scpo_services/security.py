"""Small, explicit primitives used by the local-account authentication flow."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import quote

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SESSION_COOKIE = "scpo_session"
# Long enough to cover an uninterrupted hospital shift while still expiring
# abandoned sessions at the end of the day. Active sessions are renewed by
# the client without prompting for MFA again.
SESSION_TTL_SECONDS = 12 * 60 * 60
PASSWORD_SCRYPT_N = 2**15


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def session_signing_key() -> bytes:
    value = os.getenv("SCPO_SESSION_SIGNING_KEY", "")
    if len(value) < 43:
        raise RuntimeError("SCPO_SESSION_SIGNING_KEY deve conter pelo menos 32 bytes aleatórios em Base64URL")
    return value.encode("ascii")


def issue_session(user_id: str, stage: str = "active", session_version: int = 1) -> str:
    now = int(time.time())
    payload = {"sub": user_id, "iat": now, "exp": now + SESSION_TTL_SECONDS, "stage": stage, "sv": session_version}
    encoded = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(session_signing_key(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{_b64(signature)}"


def read_session(token: str) -> dict[str, object] | None:
    try:
        encoded, supplied = token.split(".", maxsplit=1)
        expected = hmac.new(session_signing_key(), encoded.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(supplied)):
            return None
        payload = json.loads(_unb64(encoded))
        if not isinstance(payload, dict) or int(payload["exp"]) <= int(time.time()):
            return None
        if not isinstance(payload.get("sub"), str) or not isinstance(payload.get("stage"), str):
            return None
        return payload
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=PASSWORD_SCRYPT_N, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    return f"scrypt${PASSWORD_SCRYPT_N}$8$1${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = encoded.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(_unb64(digest)), maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual, _unb64(digest))
    except (ValueError, TypeError):
        return False


def _mfa_cipher() -> AESGCM:
    value = os.getenv("SCPO_MFA_ENCRYPTION_KEY", "")
    try:
        key = _unb64(value)
    except (ValueError, TypeError):
        key = b""
    if len(key) != 32:
        raise RuntimeError("SCPO_MFA_ENCRYPTION_KEY deve ser uma chave aleatória de 32 bytes em Base64URL")
    return AESGCM(key)


def encrypt_mfa_secret(secret: str) -> str:
    nonce = secrets.token_bytes(12)
    ciphertext = _mfa_cipher().encrypt(nonce, secret.encode(), b"SCPO-TOTP-v1")
    return _b64(nonce + ciphertext)


def decrypt_mfa_secret(value: str) -> str:
    payload = _unb64(value)
    return _mfa_cipher().decrypt(payload[:12], payload[12:], b"SCPO-TOTP-v1").decode()


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, timestamp: int | None = None) -> str:
    counter = int((timestamp if timestamp is not None else time.time()) // 30)
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = (int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF) % 1_000_000
    return f"{number:06d}"


def verify_totp(secret: str, code: str) -> bool:
    if len(code) != 6 or not code.isdigit():
        return False
    now = int(time.time())
    return any(hmac.compare_digest(totp_code(secret, now + offset * 30), code) for offset in (-1, 0, 1))


def totp_uri(secret: str, username: str) -> str:
    label = quote(f"SCPO Connect:{username}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer=SCPO%20Connect&algorithm=SHA1&digits=6&period=30"
