"""A Bitcoin account's addresses from its xpub (decision 99), without a key and without a package.

Ledger Live hands out a new receive address each time, and a send's change goes to an internal
address, so the Ledger's bitcoin is read across the account, not one address. The xpub is the
account's public key (BIP 32, path 84'/0'/0' for Native SegWit): from it, public derivation
gives each receive address (chain 0) and change address (chain 1), written as bech32 `bc1q…`
(BIP 84, BIP 173). Public derivation can't make a private key: nothing here can spend."""

import hashlib
import hmac

P = 2**256 - 2**32 - 977  # secp256k1's field
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141  # its order
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
XPUB = bytes.fromhex("0488b21e")  # mainnet xpub; zpub is the same key, another label
ZPUB = bytes.fromhex("04b24746")
BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
HARDENED = 2**31
XPUB_LENGTH = 111  # 82 bytes in base58
Point = tuple[int, int] | None


class XpubError(Exception):
    """Not an xpub the desk can read; the message is safe to show the owner."""


def _add(a: Point, b: Point) -> Point:
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    if a == b:
        slope = 3 * a[0] * a[0] * pow(2 * a[1], -1, P) % P
    else:
        slope = (b[1] - a[1]) * pow(b[0] - a[0], -1, P) % P
    x = (slope * slope - a[0] - b[0]) % P
    return x, (slope * (a[0] - x) - a[1]) % P


def _times(k: int, point: Point) -> Point:
    found: Point = None
    while k:
        if k & 1:
            found = _add(found, point)
        point = _add(point, point)
        k >>= 1
    return found


def _compressed(point: Point) -> bytes:
    if point is None:
        raise XpubError("That xpub gives an invalid key.")
    return bytes([2 + (point[1] & 1)]) + point[0].to_bytes(32, "big")


def _point(key: bytes) -> tuple[int, int]:
    x = int.from_bytes(key[1:], "big")
    y = pow((x * x * x + 7) % P, (P + 1) // 4, P)
    if (y * y - x * x * x - 7) % P:
        raise XpubError("That xpub's key isn't on the curve.")
    if (y & 1) != (key[0] & 1):
        y = P - y
    return x, y


def _decode(xpub: str) -> tuple[bytes, bytes]:
    """The xpub's chain code and public key, its checksum checked."""
    if len(xpub) != XPUB_LENGTH or any(c not in BASE58 for c in xpub):
        raise XpubError("That isn't an xpub: copy it from Ledger Live.")
    n = 0
    for c in xpub:
        n = n * 58 + BASE58.index(c)
    try:
        raw = n.to_bytes(82, "big")
    except OverflowError:
        raise XpubError("That isn't an xpub: copy it from Ledger Live.") from None
    body, check = raw[:-4], raw[-4:]
    if hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4] != check:
        raise XpubError("That xpub's checksum is wrong: copy it again.")
    if body[:4] not in {XPUB, ZPUB} or body[45] not in {2, 3}:
        raise XpubError("That isn't a mainnet account xpub.")
    return body[13:45], body[45:78]


def _child(chain: bytes, key: bytes, index: int) -> tuple[bytes, bytes]:
    found = hmac.new(chain, key + index.to_bytes(4, "big"), hashlib.sha512).digest()
    tweak = int.from_bytes(found[:32], "big")
    if tweak >= N:
        raise XpubError("That xpub can't give this address.")
    return found[32:], _compressed(_add(_times(tweak, G), _point(key)))


def _polymod(values: list[int]) -> int:
    gen = (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
    check = 1
    for v in values:
        top = check >> 25
        check = (check & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            check ^= gen[i] if (top >> i) & 1 else 0
    return check


def _segwit(program: bytes) -> str:
    """A version 0 witness program as a `bc1q…` address."""
    bits, acc, data = 0, 0, [0]
    for byte in program:
        acc = (acc << 8) | byte
        bits += 8
        while bits >= 5:  # noqa: PLR2004 - bech32 packs 5 bits a character
            bits -= 5
            data.append((acc >> bits) & 31)
    if bits:
        data.append((acc << (5 - bits)) & 31)
    hrp = [ord(c) >> 5 for c in "bc"] + [0] + [ord(c) & 31 for c in "bc"]
    mod = _polymod([*hrp, *data, 0, 0, 0, 0, 0, 0]) ^ 1
    checksum = [(mod >> 5 * (5 - i)) & 31 for i in range(6)]
    return "bc1" + "".join(BECH32[d] for d in [*data, *checksum])


def addresses(xpub: str, chain: int, start: int, count: int) -> list[str]:
    """`count` Native SegWit addresses on a chain (0 receive, 1 change) from index `start`."""
    if chain not in {0, 1} or start < 0 or start + count >= HARDENED:
        raise XpubError("Ask for receive (0) or change (1) addresses.")
    code, key = _decode(xpub)
    code, key = _child(code, key, chain)
    found: list[str] = []
    for index in range(start, start + count):
        _, child = _child(code, key, index)
        digest = hashlib.new("ripemd160", hashlib.sha256(child).digest()).digest()
        found.append(_segwit(digest))
    return found


def valid(xpub: str) -> bool:
    try:
        _decode(xpub)
    except XpubError:
        return False
    return True
