"""Solana address handling without third-party packages: base58 and ed25519 public keys."""

from __future__ import annotations

import hashlib
from typing import Optional

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_INDEX = {char: value for value, char in enumerate(ALPHABET)}


def b58decode(text: str) -> Optional[bytes]:
    """Base58 (Bitcoin alphabet) to bytes; `None` when a character is outside the alphabet."""
    number = 0
    for char in text:
        value = _INDEX.get(char)
        if value is None:
            return None
        number = number * 58 + value
    body = number.to_bytes((number.bit_length() + 7) // 8, "big")
    leading_zeros = len(text) - len(text.lstrip("1"))
    return b"\x00" * leading_zeros + body


def b58encode(data: bytes) -> str:
    number = int.from_bytes(data, "big")
    chars = []
    while number:
        number, remainder = divmod(number, 58)
        chars.append(ALPHABET[remainder])
    leading_zeros = len(data) - len(data.lstrip(b"\x00"))
    return "1" * leading_zeros + "".join(reversed(chars))


def is_solana_address(text: str) -> bool:
    """True for a base58 string that decodes to exactly 32 bytes.

    This is what separates Solana addresses from the EVM (0x...), Bitcoin and Tron entries
    that share the public lists. A 32-byte base58 string is 32 to 44 characters long.
    """
    if not 32 <= len(text) <= 44:
        return False
    decoded = b58decode(text)
    return decoded is not None and len(decoded) == 32


# --- ed25519 public key from a seed (RFC 8032, section 5.1.5) -------------------------
# Used only to derive the address of a freshly generated keypair for the "fresh wallet"
# case. Nothing is ever signed, so the secret half is discarded straight away.

_P = 2**255 - 19
_D = -121665 * pow(121666, _P - 2, _P) % _P
_Point = tuple[int, int, int, int]


def _point_add(a: _Point, b: _Point) -> _Point:
    aa = (a[1] - a[0]) * (b[1] - b[0]) % _P
    bb = (a[1] + a[0]) * (b[1] + b[0]) % _P
    cc = 2 * a[3] * b[3] * _D % _P
    dd = 2 * a[2] * b[2] % _P
    e, f, g, h = bb - aa, dd - cc, dd + cc, bb + aa
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _point_mul(scalar: int, point: _Point) -> _Point:
    result: _Point = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = _point_add(result, point)
        point = _point_add(point, point)
        scalar >>= 1
    return result


def _recover_x(y: int, sign: int) -> int:
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * pow(2, (_P - 1) // 4, _P) % _P
    if (x & 1) != sign:
        x = _P - x
    return x


_BASE_Y = 4 * pow(5, _P - 2, _P) % _P
_BASE_X = _recover_x(_BASE_Y, 0)
_BASE: _Point = (_BASE_X, _BASE_Y, 1, _BASE_X * _BASE_Y % _P)


def ed25519_public_key(seed: bytes) -> bytes:
    """The 32-byte public key of the 32-byte secret seed."""
    if len(seed) != 32:
        raise ValueError("seed must be 32 bytes")
    digest = hashlib.sha512(seed).digest()
    scalar = int.from_bytes(digest[:32], "little")
    scalar &= (1 << 254) - 8
    scalar |= 1 << 254
    x, y, z, _ = _point_mul(scalar, _BASE)
    inverse = pow(z, _P - 2, _P)
    x, y = x * inverse % _P, y * inverse % _P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def address_from_seed(seed: bytes) -> str:
    """The Solana address of the keypair generated from `seed`."""
    return b58encode(ed25519_public_key(seed))
