"""The Ledger as a source (decision 99): Solana read by public address, counted tokens only,
moved coins keeping their Binance cost, the TAO wallet's costs moving to the Ledger, and the
Settings routes refusing what isn't an address. Every address and amount here is made up
(the repo is public, known-mistakes 7); the Solana token mints are public program ids."""

import json
from decimal import Decimal as D
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import ledger_wallet
from api.audit import Audit
from api.handler import handler
from api.portfolio import build
from api.store import Store

# Well-formed Solana keys (32 bytes in base58): public program ids, no one's wallet.
OWNER = "7Hq2mB3xQ9vKp4TfYw8RjN5cZ1aLsD6eGuV2hXo3Zp4m"
COUNTED = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
AIRDROP = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"
LAMPORTS = 12_500_000_000


def solana(calls: list[str], fail: bool = False) -> httpx.Client:
    def reply(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(503)
        body = json.loads(request.content)
        calls.append(body["method"])
        if body["method"] == "getBalance":
            return httpx.Response(200, json={"result": {"value": LAMPORTS}})
        program = body["params"][1]["programId"]
        accounts = []
        if program.startswith("Tokenz"):  # Token-2022 holds both, as PUMP does
            accounts = [
                {"account": {"data": {"parsed": {"info": {"mint": m, "tokenAmount": a}}}}}
                for m, a in (
                    (COUNTED, {"uiAmountString": "4000"}),
                    (AIRDROP, {"uiAmountString": "1000000"}),
                )
            ]
        return httpx.Response(200, json={"result": {"value": accounts}})

    return httpx.Client(transport=httpx.MockTransport(reply))


def test_a_solana_address_is_32_bytes_in_base58() -> None:
    assert ledger_wallet.valid_address("Solana", OWNER)
    assert not ledger_wallet.valid_address("Solana", OWNER[:-1] + "0")  # 0 isn't base58
    assert not ledger_wallet.valid_address("Solana", "short")
    assert not ledger_wallet.valid_address("Bitcoin", OWNER)


def test_sol_and_counted_tokens_are_read_and_an_airdrop_is_not_counted(tmp_path: Path) -> None:
    calls: list[str] = []
    audit = Audit(tmp_path / "audit.jsonl")
    found = ledger_wallet.read(
        solana(calls), ledger_wallet.Watch("Solana", OWNER, {COUNTED: "PUMP"}), audit, lambda: 0
    )
    assert found.coins == {"SOL": D("12.5"), "PUMP": D(4000)}
    assert found.unknown == {AIRDROP: D(1000000)}  # listed apart, never money
    assert OWNER not in (tmp_path / "audit.jsonl").read_text(encoding="utf-8")


def test_a_fresh_reading_is_kept_and_a_failed_read_falls_back_marked_stale(
    tmp_path: Path,
) -> None:
    calls: list[str] = []
    audit = Audit(tmp_path / "audit.jsonl")
    ledger_wallet.read(solana(calls), ledger_wallet.Watch("Solana", OWNER, {}), audit, lambda: 0)
    asked = len(calls)
    ledger_wallet.read(solana(calls), ledger_wallet.Watch("Solana", OWNER, {}), audit, lambda: 60)
    assert len(calls) == asked  # under 15 minutes: no new call
    later = ledger_wallet.read(
        solana([], fail=True), ledger_wallet.Watch("Solana", OWNER, {}), audit, lambda: 3600
    )
    assert later.stale
    assert later.coins["SOL"] == D("12.5")
    with pytest.raises(ledger_wallet.LedgerError):
        ledger_wallet.read(
            solana([], fail=True), ledger_wallet.Watch("Solana", OWNER, {}), audit, lambda: 200_000
        )


EVM_OWNER = "0x1111111111111111111111111111111111111111"  # made up
EVM_CONTRACT = "0x2222222222222222222222222222222222222222"  # made up


def test_ethereum_reads_eth_and_counted_tokens_only(tmp_path: Path) -> None:
    asked: list[dict[str, Any]] = []

    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        asked.append(body)
        if body["method"] == "eth_getBalance":
            return httpx.Response(200, json={"result": hex(2_250_000_000_000_000_000)})
        if body["params"][0]["data"] == "0x313ce567":  # decimals()
            return httpx.Response(200, json={"result": hex(8)})
        return httpx.Response(200, json={"result": hex(3000 * 10**8)})  # balanceOf

    client = httpx.Client(transport=httpx.MockTransport(reply))
    watch = ledger_wallet.Watch("Ethereum", EVM_OWNER, {EVM_CONTRACT: "SPX"})
    found = ledger_wallet.read(client, watch, Audit(tmp_path / "a.jsonl"), lambda: 0)
    assert found.coins == {"ETH": D("2.25"), "SPX": D(3000)}
    assert asked[1]["params"][0]["data"].endswith(EVM_OWNER[2:])  # balanceOf the owner
    assert ledger_wallet.valid_address("Ethereum", EVM_OWNER)
    assert not ledger_wallet.valid_address("Ethereum", "0x123")
    assert ledger_wallet.valid_address("HyperEVM", EVM_OWNER)


def _buy(qty: str, price: str, time: int) -> dict[str, Any]:
    return {
        "symbol": "SOLUSDC",
        "time": time,
        "qty": qty,
        "price": price,
        "quoteQty": str(D(qty) * D(price)),
        "commission": "0.00001",
        "commissionAsset": "BNB",
        "isBuyer": True,
    }


def test_a_coin_moved_to_the_ledger_keeps_its_binance_cost() -> None:
    trades = {"SOL": [_buy("10", "60", 1), _buy("10", "80", 2)]}  # 20 SOL at 70
    tickers = {"SOLUSDT": {"lastPrice": "70", "priceChangePercent": "0"}}
    balances = [
        {"asset": "SOL", "free": "2", "locked": "0"},
        {"asset": "SOL", "free": "18", "locked": "0", "source": "Ledger", "binanceAmount": "2"},
    ]
    rows = build(balances, tickers, trades, [], None)["holdings"]
    ledger = next(h for h in rows if h["source"] == "Ledger")
    binance = next(h for h in rows if h["source"] == "Binance")
    assert ledger["averageCost"] == "70"
    assert ledger["covered"] == "18"  # Binance's 2 covered first, the Ledger the rest
    assert binance["covered"] == "2"


def test_the_tao_wallets_costs_move_to_the_ledger_and_saved_addresses_seed(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path / "desk.sqlite")
    store.set_cost("TAO wallet", "TAO", "300")
    saved = {"addresses": {"SOL": {"network": "Solana", "address": OWNER}}}
    store.set_setting("ledger.device", json.dumps(saved))
    store.close()
    store = Store(tmp_path / "desk.sqlite")
    assert store.costs() == {("Ledger", "TAO"): "300"}
    assert [(a["coin"], a["address"]) for a in store.ledger_addresses()] == [("SOL", OWNER)]
    store.close()


def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    event: dict[str, object] = {
        "rawPath": path,
        "requestContext": {"http": {"method": "POST"}},
        "body": json.dumps(body),
    }
    return handler(event, None)


def test_settings_add_count_and_remove_a_ledger_address(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("DEMO", "1")  # no network: addresses show as not read
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    refused = _post("/ledger/address", {"coin": "SOL", "network": "Solana", "address": "nope"})
    assert refused["statusCode"] == 400
    seed_words = " ".join(["abandon"] * 24)
    assert (
        _post("/ledger/address", {"coin": "SOL", "network": "Solana", "address": seed_words})[
            "statusCode"
        ]
        == 400
    )
    added = _post("/ledger/address", {"coin": "sol", "network": "Solana", "address": OWNER})
    view = json.loads(str(added["body"]))
    row = view["addresses"][0]
    assert (row["coin"], row["address"], row["status"]) == ("SOL", OWNER, "not_read")
    counted = _post("/ledger/token", {"id": row["id"], "mint": COUNTED, "coin": "pump"})
    assert json.loads(str(counted["body"]))["addresses"][0]["tokens"] == {COUNTED: "PUMP"}
    assert (
        _post("/ledger/token", {"id": row["id"], "mint": "x", "coin": "PUMP"})["statusCode"] == 400
    )
    removed = _post("/ledger/remove", {"id": row["id"]})
    assert json.loads(str(removed["body"]))["addresses"] == []


def test_a_ledger_coin_with_no_spot_pair_is_priced_from_its_perpetual(monkeypatch: Any) -> None:
    from api import perp, service  # noqa: PLC0415 - only this test needs them

    seen: list[str] = []

    def ticker(coin: str) -> dict[str, str]:
        seen.append(coin)
        return {"lastPrice": "0.28", "priceChangePercent": "1"}

    monkeypatch.setattr(perp, "ticker", ticker)
    spot = {"ETHUSDT": {"lastPrice": "1700", "priceChangePercent": "0"}}
    priced = service._perp_priced(spot, {"ETH": D(1), "SPX": D(3000)})  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert priced["SPXUSDT"]["lastPrice"] == "0.28"
    assert seen == ["SPX"]  # ETH has a spot pair: no futures call


SUI_OWNER = "0x" + "3" * 64  # made up
NEAR_OWNER = "4" * 64  # made up


def test_sui_and_near_read_their_coin(tmp_path: Path) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if "query" in body and isinstance(body["query"], str):  # Sui GraphQL
            balance = {"balance": {"totalBalance": "725500000000"}}
            return httpx.Response(200, json={"data": {"address": balance}})
        return httpx.Response(200, json={"result": {"amount": "42500000000000000000000000"}})

    client = httpx.Client(transport=httpx.MockTransport(reply))
    audit = Audit(tmp_path / "a.jsonl")
    sui = ledger_wallet.read(client, ledger_wallet.Watch("Sui", SUI_OWNER), audit, lambda: 0)
    near = ledger_wallet.read(client, ledger_wallet.Watch("NEAR", NEAR_OWNER), audit, lambda: 0)
    assert sui.coins == {"SUI": D("725.5")}
    assert near.coins == {"NEAR": D("42.5")}
    assert ledger_wallet.valid_address("NEAR", "sam.near")
    assert not ledger_wallet.valid_address("NEAR", "0x" + "4" * 64)
    assert not ledger_wallet.valid_address("Sui", "0x" + "3" * 40)


# BIP 84's own test vector (the "abandon … about" phrase): a public example, no one's coins.
BIP84_ZPUB = (
    "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3Ef"
    "H1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs"
)


def test_an_xpub_gives_the_accounts_receive_and_change_addresses() -> None:
    from api import bitcoin_xpub  # noqa: PLC0415 - only these tests need it

    assert bitcoin_xpub.addresses(BIP84_ZPUB, 0, 0, 2) == [
        "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    ]
    assert bitcoin_xpub.addresses(BIP84_ZPUB, 1, 0, 1) == [
        "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"
    ]
    assert not bitcoin_xpub.valid(BIP84_ZPUB[:-1] + "x")  # checksum
    assert ledger_wallet.valid_address("Bitcoin", BIP84_ZPUB)


def test_bitcoin_sums_the_account_until_a_gap_of_unused_addresses(tmp_path: Path) -> None:
    from api import bitcoin_xpub  # noqa: PLC0415 - only these tests need it

    first = bitcoin_xpub.addresses(BIP84_ZPUB, 0, 0, 1)[0]
    change = bitcoin_xpub.addresses(BIP84_ZPUB, 1, 0, 1)[0]
    held = {first: 50_000, change: 30_000}
    asked: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        address = request.url.path.rsplit("/", 1)[-1]
        asked.append(address)
        sats = held.get(address, 0)
        chain = {"funded_txo_sum": sats, "spent_txo_sum": 0, "tx_count": 1 if sats else 0}
        idle = {"funded_txo_sum": 0, "spent_txo_sum": 0, "tx_count": 0}
        return httpx.Response(200, json={"chain_stats": chain, "mempool_stats": idle})

    client = httpx.Client(transport=httpx.MockTransport(reply))
    watch = ledger_wallet.Watch("Bitcoin", BIP84_ZPUB)
    found = ledger_wallet.read(client, watch, Audit(tmp_path / "a.jsonl"), lambda: 0)
    assert found.coins == {"BTC": D("0.0008")}
    assert len(asked) == 2 * (1 + ledger_wallet.GAP)  # each chain: one used, then the gap


def test_staking_income_is_recorded_valued_in_aud_and_totalled_for_the_fy(
    tmp_path: Path, monkeypatch: Any
) -> None:
    from api import staking_income  # noqa: PLC0415 - only this test needs it
    from api.trading import Refused  # noqa: PLC0415

    store = Store(tmp_path / "desk.sqlite")
    store.set_setting("aud_per_usd", "1.5")
    today = __import__("datetime").date(2026, 11, 22)
    staking_income.add(
        store, {"day": "2026-11-22", "coin": "tao", "amount": "5", "priceUsd": "200"}, today, 1
    )
    staking_income.add(
        store,
        {"day": "2026-05-01", "coin": "TAO", "amount": "1", "priceUsd": "300", "audRate": "1.5"},
        today,
        2,
    )
    seen = staking_income.view(store, today)
    assert seen["fy"] == 2026
    assert [(c["day"], c["aud"], c["thisFy"]) for c in seen["claims"]] == [
        ("2026-11-22", "1500", True),
        ("2026-05-01", "450", False),  # last financial year
    ]
    assert seen["fyAud"] == "1500"
    for bad in (
        {"day": "2026-12-01", "coin": "TAO", "amount": "1", "priceUsd": "1"},  # not yet
        {"day": "2026-11-01", "coin": "TAO", "amount": "-1", "priceUsd": "1"},
        {"day": "nope", "coin": "TAO", "amount": "1", "priceUsd": "1"},
    ):
        with pytest.raises(Refused):
            staking_income.add(store, bad, today, 3)
    assert store.remove_staking_claim(seen["claims"][1]["id"])
    store.close()


def test_a_busy_mempool_is_waited_out_before_giving_up(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr(ledger_wallet, "RETRY_WAIT", (0.0, 0.0))
    answers = iter([429, 429, 200])

    def reply(_request: httpx.Request) -> httpx.Response:
        code = next(answers)
        if code != 200:  # noqa: PLR2004
            return httpx.Response(code)
        idle = {"funded_txo_sum": 7, "spent_txo_sum": 0, "tx_count": 1}
        return httpx.Response(200, json={"chain_stats": idle, "mempool_stats": idle})

    client = httpx.Client(transport=httpx.MockTransport(reply))
    stats = ledger_wallet._mempool(client, "bc1q", Audit(tmp_path / "a.jsonl"))  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert stats[0]["funded_txo_sum"] == 7


def test_an_xpub_of_the_wrong_length_is_refused_not_a_crash() -> None:
    from api import bitcoin_xpub  # noqa: PLC0415 - only these tests need it

    assert not bitcoin_xpub.valid(BIP84_ZPUB + "z")  # one character too many
    assert not bitcoin_xpub.valid(BIP84_ZPUB[:-1])
    assert not ledger_wallet.valid_address("Bitcoin", "x" * 200)


def test_a_reply_the_desk_cant_read_falls_back_to_the_last_reading(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "a.jsonl")
    watch = ledger_wallet.Watch("Solana", OWNER, {})
    ledger_wallet.read(solana([]), watch, audit, lambda: 0)
    garbled = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"result": None}))
    )
    later = ledger_wallet.read(garbled, watch, audit, lambda: 3600)
    assert later.stale
    assert later.coins["SOL"] == D("12.5")
    calls: list[str] = []
    again = ledger_wallet.read(solana(calls), watch, audit, lambda: 3630)
    assert again.stale
    assert calls == []  # failed half a minute ago: not asked again yet


def test_a_removed_ledger_address_stays_removed(tmp_path: Path) -> None:
    store = Store(tmp_path / "desk.sqlite")
    saved = {"addresses": {"SOL": {"network": "Solana", "address": OWNER}}}
    store.set_setting("ledger.device", json.dumps(saved))
    store.close()
    store = Store(tmp_path / "desk.sqlite")
    [row] = store.ledger_addresses()
    assert store.remove_ledger_address(row["id"])
    store.close()
    store = Store(tmp_path / "desk.sqlite")
    assert store.ledger_addresses() == []  # not seeded again
    store.close()


def test_a_backdated_claim_needs_that_days_rate_and_ids_must_be_numbers(
    tmp_path: Path, monkeypatch: Any
) -> None:
    from api import staking_income  # noqa: PLC0415 - only this test needs it
    from api.trading import Refused  # noqa: PLC0415

    store = Store(tmp_path / "desk.sqlite")
    today = __import__("datetime").date(2026, 11, 22)
    claim = {"day": "2026-11-01", "coin": "TAO", "amount": "1", "priceUsd": "200"}
    with pytest.raises(Refused, match="rate for that day"):
        staking_income.add(store, claim, today, 1)
    staking_income.add(store, claim | {"audRate": "1.52"}, today, 1)
    assert staking_income.view(store, today)["claims"][0]["aud"] == "304"
    store.close()
    monkeypatch.setenv("DEMO", "1")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    assert _post("/ledger/remove", {"id": "abc"})["statusCode"] == 400
