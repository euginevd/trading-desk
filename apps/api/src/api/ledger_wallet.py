"""The Ledger, read by its public addresses only (decision 99): never a key, never a signature.

TAO is read through Taostats (tao.py). This module reads Solana (SOL and SPL tokens), Ethereum
(ETH and ERC-20 tokens), HyperEVM (HYPE), Sui, NEAR, Bitcoin (by the account's xpub, through
mempool.space) and Zcash (the transparent account by its xpub, through 3xpl), each through a
free public endpoint.
A token counts only once the owner names it (its mint or contract), so a token airdropped to
the address (often a scam with a "claim" link) never shows as money. Readings are kept 15
minutes; if a network doesn't answer, the last reading stands in with its time, so the Ledger
never shows as empty for a hiccup. Addresses go to the public RPCs from the api only, never the
browser, a log line or Telegram (threat model)."""

import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import httpx

from api import bitcoin_xpub
from api.audit import Audit

SOLANA_RPC = "https://api.mainnet-beta.solana.com"
RPCS = {
    "Solana": SOLANA_RPC,
    "Ethereum": "https://ethereum-rpc.publicnode.com",
    "HyperEVM": "https://rpc.hyperliquid.xyz/evm",
    "Sui": "https://graphql.mainnet.sui.io/graphql",  # Sui's public JSON-RPC is retired
    "NEAR": "https://rpc.mainnet.fastnear.com",
    "Bitcoin": "https://mempool.space/api/address/",
    # 3xpl's keyless API (Blockchair blocked the IP after a few calls, 22 Nov 2026)
    "Zcash": "https://sandbox-api.3xpl.com/zcash/address/",
}
SATS = Decimal(10) ** 8  # a BTC, and a ZEC, is 10^8 of its smallest unit
GAP = 5  # unused addresses in a row that end a chain's scan: few calls, as mempool.space
# rate-limits (Ledger Live allows 20; a send's change lands at the next index anyway)
BUSY = 429
RETRY_WAIT = (1.0, 3.0)  # seconds to wait before each retry when mempool.space is busy
MOST = 100  # addresses read on a chain at most
MIST = Decimal(10) ** 9  # a SUI is a billion mist
YOCTO = Decimal(10) ** 24  # a NEAR is 10^24 yoctoNEAR
SUI_ADDRESS = re.compile(r"0x[0-9a-fA-F]{64}")
NEAR_PART = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_-")
HEX = frozenset("0123456789abcdef")
SUI_BALANCE = (
    "query($a: SuiAddress!) { address(address: $a) "
    '{ balance(coinType: "0x2::sui::SUI") { totalBalance } } }'
)
WEI = Decimal(10) ** 18  # ETH and HYPE both have 18 decimals
EVM_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
BALANCE_OF = "0x70a08231" + "0" * 24  # ERC-20 balanceOf(address), the address appended
DECIMALS = "0x313ce567"  # ERC-20 decimals()
LAMPORTS = Decimal(10) ** 9  # a SOL is a billion lamports
TOKEN_PROGRAMS = (
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  # SPL Token
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  # Token-2022, the newer token program
)
FRESH_SECONDS = 15 * 60
FALLBACK_SECONDS = 24 * 3600
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
KEY_BYTES = 32
COIN = re.compile(r"[A-Z0-9]{1,15}")
OK = 200

# The networks the desk reads, and the coin each one's own balance is in.
TOKEN_NETWORKS = frozenset({"Solana", "Ethereum", "HyperEVM"})  # where a token is read
NETWORKS = {
    "Solana": "SOL",
    "Ethereum": "ETH",
    "HyperEVM": "HYPE",
    "Sui": "SUI",
    "NEAR": "NEAR",
    "Bitcoin": "BTC",  # by the account's xpub: Ledger Live rotates addresses
    "Zcash": "ZEC",  # the transparent account by its xpub: a shielded balance can't be read
}
LABEL = "Ledger"

_lock = threading.Lock()
# One read at a time per address: two parts of the page asking at once share the first
# read, rather than both calling the network (mempool.space refused the doubled calls).
_reading: dict[str, threading.Lock] = {}
# When an address last failed: for a minute the last reading stands in without asking again.
_failed: dict[str, float] = {}
QUIET_SECONDS = 60
_last: dict[str, tuple[float, "Reading"]] = {}


class LedgerError(Exception):
    """A network couldn't answer; the message is safe to show the owner."""


@dataclass
class Reading:
    """One address's balances: counted coins, and tokens found but not counted (by mint)."""

    coins: dict[str, Decimal]
    unknown: dict[str, Decimal] = field(default_factory=dict[str, Decimal])
    read_at: float = 0.0
    stale: bool = False


@dataclass(frozen=True)
class Watch:
    """One saved public address: its network, the address, and the tokens counted (mint: coin)."""

    network: str
    address: str
    tokens: dict[str, str] = field(default_factory=dict[str, str])

    @staticmethod
    def of(saved: dict[str, Any]) -> "Watch":
        return Watch(str(saved["network"]), str(saved["address"]), dict(saved["tokens"]))


def forget() -> None:
    """Drops the kept readings (tests)."""
    with _lock:
        _last.clear()
        _reading.clear()
        _failed.clear()


def _base58_bytes(text: str) -> int | None:
    if not text or any(c not in BASE58 for c in text):
        return None
    n = 0
    for c in text:
        n = n * 58 + BASE58.index(c)
    lead = len(text) - len(text.lstrip("1"))
    return lead + (n.bit_length() + 7) // 8


def valid_address(network: str, address: str) -> bool:
    """Whether the address is well formed for its network (an unknown network never is)."""
    check = _CHECKS.get(network)
    return bool(check and check(address))


def _solana(address: str) -> bool:
    """A Solana address (or token mint): 32 bytes in base58, 32 to 44 characters."""
    return 32 <= len(address) <= 44 and _base58_bytes(address) == KEY_BYTES  # noqa: PLR2004


def _near_account(address: str) -> bool:
    """An implicit account (64 hex digits) or a named one ending .near, each part letters, digits,
    - and _ (checked without a regular expression: CodeQL, review of 22 Nov 2026)."""
    if len(address) == 64 and set(address) <= HEX:  # noqa: PLR2004
        return True
    parts = address.split(".")
    return (
        len(address) <= 64  # noqa: PLR2004
        and len(parts) >= 2  # noqa: PLR2004
        and parts[-1] == "near"
        and all(p and set(p) <= NEAR_PART for p in parts)
    )


_CHECKS: dict[str, Callable[[str], bool]] = {
    "Solana": _solana,
    "Ethereum": lambda a: bool(EVM_ADDRESS.fullmatch(a)),  # 0x and 40 hex digits
    "HyperEVM": lambda a: bool(EVM_ADDRESS.fullmatch(a)),
    "Sui": lambda a: bool(SUI_ADDRESS.fullmatch(a)),
    "NEAR": _near_account,
    "Bitcoin": bitcoin_xpub.valid,
    "Zcash": bitcoin_xpub.valid,
}


def valid_coin(coin: str) -> bool:
    return bool(COIN.fullmatch(coin))


def _rpc(client: httpx.Client, network: str, method: str, params: Any, audit: Audit) -> Any:
    return _post(
        client, network, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, audit
    ).get("result")


def _post(
    client: httpx.Client, network: str, payload: dict[str, Any], audit: Audit
) -> dict[str, Any]:
    action = f"{network}: Ledger"
    try:
        response = client.post(RPCS[network], json=payload)
    except httpx.HTTPError as error:
        audit.record("exchange", action, f"Failed: {type(error).__name__}")
        raise LedgerError(f"{network} didn't answer. The desk tries again shortly.") from error
    if response.status_code != OK:
        audit.record("exchange", action, f"Refused {response.status_code}")
        raise LedgerError(f"{network} refused the request ({response.status_code}).")
    try:
        raw: object = response.json()
    except ValueError as error:
        audit.record("exchange", action, "Refused: not JSON")
        raise LedgerError(f"{network} sent a reply the desk can't read.") from error
    if not isinstance(raw, dict):
        audit.record("exchange", action, "Refused: not an object")
        raise LedgerError(f"{network} sent a reply the desk can't read.")
    body = cast(dict[str, Any], raw)
    if body.get("error") or body.get("errors"):
        audit.record("exchange", action, "Refused: RPC error")
        raise LedgerError(f"{network} couldn't read the address.")
    return body


def _amount(value: object, scale: Decimal = Decimal(1)) -> Decimal:
    try:
        return Decimal(str(value or "0")) / scale
    except InvalidOperation as error:
        raise LedgerError("The network sent a balance that isn't a number.") from error


def _hex(value: object) -> int:
    text = str(value or "0x0")
    try:
        return int(text, 16) if text != "0x" else 0
    except ValueError as error:
        raise LedgerError("The network sent a balance that isn't a number.") from error


def _read_sui(client: httpx.Client, address: str, audit: Audit) -> Reading:
    body = _post(client, "Sui", {"query": SUI_BALANCE, "variables": {"a": address}}, audit)
    data = cast(dict[str, Any], body.get("data") or {})
    found = cast(dict[str, Any], data.get("address") or {})
    mist = cast(dict[str, Any], found.get("balance") or {})
    audit.record("exchange", "Sui: Ledger", "OK")
    return Reading({"SUI": _amount(mist.get("totalBalance"), MIST)})


def _read_bitcoin(client: httpx.Client, xpub: str, audit: Audit) -> Reading:
    """Every receive and change address of the account, until GAP unused in a row, summed:
    confirmed and pending, as Ledger Live shows it."""
    total = 0
    for chain in (0, 1):
        quiet, index = 0, 0
        # Derived a few at a time as the scan goes: it usually stops within a dozen.
        while quiet < GAP and index < MOST:
            for address in bitcoin_xpub.addresses(xpub, chain, index, GAP):
                if quiet >= GAP:
                    break
                stats = _mempool(client, address, audit)
                used = sum(int(s.get("tx_count", 0)) for s in stats)
                quiet = 0 if used else quiet + 1
                total += sum(int(s["funded_txo_sum"]) - int(s["spent_txo_sum"]) for s in stats)
            index += GAP
        if quiet < GAP:
            audit.record("exchange", "Bitcoin: Ledger", f"Stopped at {MOST} addresses")
    audit.record("exchange", "Bitcoin: Ledger", "OK")
    return Reading({"BTC": Decimal(total) / SATS})


def _mempool(client: httpx.Client, address: str, audit: Audit) -> list[dict[str, Any]]:
    """One address's stats; a busy answer (429) is waited out twice before giving up."""
    response = _mempool_get(client, address, audit)
    for wait in RETRY_WAIT:
        if response.status_code != BUSY:
            break
        time.sleep(wait)
        response = _mempool_get(client, address, audit)
    if response.status_code != OK:
        audit.record("exchange", "Bitcoin: Ledger", f"Refused {response.status_code}")
        raise LedgerError(f"mempool.space refused the request ({response.status_code}).")
    body = cast(dict[str, Any], response.json())
    return [cast(dict[str, Any], body["chain_stats"]), cast(dict[str, Any], body["mempool_stats"])]


def _mempool_get(client: httpx.Client, address: str, audit: Audit) -> httpx.Response:
    try:
        return client.get(RPCS["Bitcoin"] + address)
    except httpx.HTTPError as error:
        audit.record("exchange", "Bitcoin: Ledger", f"Failed: {type(error).__name__}")
        raise LedgerError("mempool.space didn't answer. The desk tries again shortly.") from error


def _read_zcash(client: httpx.Client, xpub: str, audit: Audit) -> Reading:
    """Every receive and change t1 address of the account, until GAP unused in a row, summed:
    Ledger Live sends a send's change to a new address, as for Bitcoin."""
    total = 0
    for chain in (0, 1):
        quiet, index = 0, 0
        while quiet < GAP and index < MOST:
            for address in bitcoin_xpub.addresses(xpub, chain, index, GAP, zcash=True):
                if quiet >= GAP:
                    break
                used, held = _three_xpl(client, address, audit)
                quiet = 0 if used else quiet + 1
                total += held
            index += GAP
        if quiet < GAP:
            audit.record("exchange", "Zcash: Ledger", f"Stopped at {MOST} addresses")
    audit.record("exchange", "Zcash: Ledger", "OK")
    return Reading({"ZEC": Decimal(total) / SATS})


def _three_xpl(client: httpx.Client, address: str, audit: Audit) -> tuple[int, int]:
    """One t1 address's events and balance in zatoshi; an address never used has neither."""
    action = "Zcash: Ledger"

    def ask() -> httpx.Response:
        try:
            return client.get(RPCS["Zcash"] + address, params={"data": "balances"})
        except httpx.HTTPError as error:
            audit.record("exchange", action, f"Failed: {type(error).__name__}")
            raise LedgerError("3xpl didn't answer. The desk tries again shortly.") from error

    response = ask()
    for wait in RETRY_WAIT:
        if response.status_code != BUSY:
            break
        time.sleep(wait)
        response = ask()
    if response.status_code != OK:
        audit.record("exchange", action, f"Refused {response.status_code}")
        raise LedgerError(f"3xpl refused the request ({response.status_code}).")
    # An address never used comes back as an empty list where the balance would be.
    chain = response.json()["data"]["balances"]["zcash-main"]
    if not chain:
        return 0, 0
    found = cast(dict[str, Any], chain["zcash"])
    return int(found["events"]), int(found["balance"])


def _read_near(client: httpx.Client, address: str, audit: Audit) -> Reading:
    params = {"request_type": "view_account", "finality": "final", "account_id": address}
    account = cast(dict[str, Any], _rpc(client, "NEAR", "query", params, audit) or {})
    audit.record("exchange", "NEAR: Ledger", "OK")
    return Reading({"NEAR": _amount(account.get("amount"), YOCTO)})


def _read_evm(client: httpx.Client, watch: "Watch", audit: Audit) -> Reading:
    """The network's own coin, then each counted token by its contract. An EVM node can't list
    an address's tokens, so only the counted ones are read (none is ever found uncounted)."""
    network, address = watch.network, watch.address
    native = _hex(_rpc(client, network, "eth_getBalance", [address, "latest"], audit))
    coins: dict[str, Decimal] = {NETWORKS[network]: Decimal(native) / WEI}
    for contract, coin in watch.tokens.items():
        call = {"to": contract, "data": BALANCE_OF + address[2:].lower()}
        held = _hex(_rpc(client, network, "eth_call", [call, "latest"], audit))
        places = _hex(
            _rpc(client, network, "eth_call", [{"to": contract, "data": DECIMALS}, "latest"], audit)
        )
        if held:
            coins[coin] = coins.get(coin, Decimal(0)) + Decimal(held) / Decimal(10) ** places
    audit.record("exchange", f"{network}: Ledger", "OK")
    return Reading(coins)


def _read_solana(
    client: httpx.Client, address: str, tokens: dict[str, str], audit: Audit
) -> Reading:
    lamports = cast(dict[str, Any], _rpc(client, "Solana", "getBalance", [address], audit))
    coins: dict[str, Decimal] = {"SOL": _amount(lamports.get("value"), LAMPORTS)}
    unknown: dict[str, Decimal] = {}
    for program in TOKEN_PROGRAMS:
        found = cast(
            dict[str, Any],
            _rpc(
                client,
                "Solana",
                "getTokenAccountsByOwner",
                [address, {"programId": program}, {"encoding": "jsonParsed"}],
                audit,
            ),
        )
        for account in cast(list[dict[str, Any]], found.get("value") or []):
            info = account["account"]["data"]["parsed"]["info"]
            mint = str(info["mint"])
            held = _amount(info["tokenAmount"].get("uiAmountString"))
            if held <= 0:
                continue
            coin = tokens.get(mint)
            if coin:
                coins[coin] = coins.get(coin, Decimal(0)) + held
            else:
                unknown[mint] = unknown.get(mint, Decimal(0)) + held
    audit.record("exchange", "Solana: Ledger", "OK")
    return Reading(coins, unknown)


def _read_one(client: httpx.Client, watch: "Watch", audit: Audit) -> Reading:
    if watch.network == "Solana":
        return _read_solana(client, watch.address, watch.tokens, audit)
    if watch.network == "Sui":
        return _read_sui(client, watch.address, audit)
    if watch.network == "NEAR":
        return _read_near(client, watch.address, audit)
    if watch.network == "Bitcoin":
        return _read_bitcoin(client, watch.address, audit)
    if watch.network == "Zcash":
        return _read_zcash(client, watch.address, audit)
    return _read_evm(client, watch, audit)


def read(
    client: httpx.Client,
    watch: Watch,
    audit: Audit,
    clock: Callable[[], float] = time.time,
) -> Reading:
    """One address's balances, kept 15 minutes; the last one stands in for a day if the
    network doesn't answer (marked stale)."""
    network, address, tokens = watch.network, watch.address, watch.tokens
    if not valid_address(network, address):
        raise LedgerError(f"That isn't a {network} address.")
    key = f"{network}:{address}:{sorted(tokens.items())}"
    with _lock:
        one = _reading.setdefault(key, threading.Lock())
    with one:
        return _read_kept(client, watch, audit, clock, key)


def _read_kept(
    client: httpx.Client,
    watch: Watch,
    audit: Audit,
    clock: Callable[[], float],
    key: str,
) -> Reading:
    with _lock:
        kept = _last.get(key)
    now = clock()
    if kept and now - kept[0] < FRESH_SECONDS:
        return kept[1]
    with _lock:
        failed_at = _failed.get(key)
    try:
        if failed_at is not None and now - failed_at < QUIET_SECONDS:
            raise LedgerError(
                f"{watch.network} didn't answer a minute ago. The desk tries again shortly."
            )
        try:
            found = _read_one(client, watch, audit)
        except (KeyError, TypeError, AttributeError, ValueError, InvalidOperation) as error:
            raise LedgerError(f"{watch.network} sent a reply the desk can't read.") from error
    except LedgerError:
        with _lock:
            if failed_at is None or now - failed_at >= QUIET_SECONDS:
                _failed[key] = now
        if kept and now - kept[0] < FALLBACK_SECONDS:
            last = kept[1]
            return Reading(last.coins, last.unknown, last.read_at, stale=True)
        raise
    with _lock:
        _failed.pop(key, None)
    found.read_at = now
    with _lock:
        _last[key] = (now, found)
    return found
