// The Portfolio (decisions 64 and 101): three tabs, All, Binance and Ledger, each with only its own
// figures: four widgets, Allocation beside the tab's own box (Targets, Fiat, Custody), then the
// holdings, whose rows
// open in place, with orders and trades on Binance's tabs.
import { Allocation, Custody, Targets, Widgets } from "./PortfolioViews";
import { Holding as HoldingCell } from "./PositionCells";
import "./dca.css";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ApiError, cancelOrder, getDcaBook, getDrift, getPortfolio, setCost } from "./api";
import { toCsv } from "./dcaFormat";
import CoinIcon from "./CoinIcon";
import ConfirmCancel from "./ConfirmCancel";
import OrderDetail from "./OrderDetail";
import Deposits from "./Deposits";
import {
  ClockIcon,
  CoinsIcon,
  ExchangeIcon,
  LayersIcon,
  ListIcon,
  HardwareWalletIcon,
  ResetIcon,
} from "./icons";
import { type Currency, type Money, money } from "./money";
import { amount, amountSleek, dateTime, fetchedAt, percent, trend } from "./format";
import type { Drift, Holding, Num, Order, Portfolio as Data, TaoWallet } from "./types";
import type { Status } from "./ui";
import "./portfolio.css";

const REFRESH_MS = 60_000; // TAO is re-read each minute (tao.py), the Ledger's other coins every 15
const DUST = 5; // a holding worth less than this, or nothing, is dust: never shown
export function isDust(h: Holding): boolean {
  return h.value === null || Number(h.value) < DUST;
}

type Tab = "bal" | "ord" | "trd";

// Where a holding is kept; the page shows one source or all of them.
export type Source = "all" | Holding["source"];
const SOURCES: [Source, string][] = [
  ["all", "All"],
  ["Binance", "Binance"],
  ["Ledger", "Ledger"],
];
const SOURCE_ICON: Record<Source, () => React.JSX.Element> = {
  all: LayersIcon,
  Binance: ExchangeIcon,
  Ledger: HardwareWalletIcon,
};
// `#/portfolio?source=binance` or `?source=ledger` (`wallet` still works) opens on that source;
// anything else shows all.
export function sourceFromHash(): Source {
  const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const asked = query.get("source");
  if (asked === "binance") return "Binance";
  if (asked === "ledger" || asked === "wallet") return "Ledger";
  return "all";
}

const inSource = (h: Holding, source: Source) => h.source === source;

const SOURCE_WORD: Record<Source, string> = {
  all: "all sources",
  Binance: "Binance",
  Ledger: "Ledger",
};

// How much of the holding the trades account for, as a share.
function coverage(h: Holding): string {
  const share = (Number(h.covered) / Number(h.amount)) * 100;
  return `${share < 1 ? "<1" : Math.floor(share)}%`;
}

type State =
  | { kind: "loading"; last: Data | null }
  | { kind: "ready"; data: Data }
  | { kind: "error"; message: string; last: Data | null };

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

function Coin({ symbol, name }: { symbol: string; name?: string }) {
  return (
    <span className="coin">
      <CoinIcon coin={symbol} />
      {name ?? symbol}
    </span>
  );
}

type SortKey = "coin" | "invested" | "value" | "change";

function OrderRow({
  o,
  m,
  onDone,
  onOpen,
}: {
  o: Order;
  m: Money;
  onDone: (problem?: string) => void;
  onOpen: (o: Order, at: DOMRect) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    setBusy(true);
    cancelOrder(o.symbol, o.orderId).then(
      () => onDone(),
      (e: unknown) => {
        setBusy(false);
        onDone(message(e));
      },
    );
  };
  return (
    <tr>
      <td className="muted">{dateTime(o.time)}</td>
      <td>
        <button
          type="button"
          className="link order-open"
          onClick={(e) => onOpen(o, e.currentTarget.getBoundingClientRect())}
        >
          {o.pair}
        </button>
      </td>
      <td>
        <span className={`tag ${o.side === "Buy" ? "buy" : "sell"}`}>{o.side}</span>
      </td>
      <td className="muted">{o.type}</td>
      <td className="r num">{m.price(o.price)}</td>
      <td className="r num">{amount(o.amount)}</td>
      <td className="r num muted">{amount(o.filled)}</td>
      <td className="r">
        <div className="order-actions">
          <button
            className="link"
            type="button"
            onClick={(e) => onOpen(o, e.currentTarget.getBoundingClientRect())}
          >
            View
          </button>
          <button className="link danger" type="button" onClick={() => setAsking(true)}>
            Cancel
          </button>
        </div>
        <ConfirmCancel
          order={asking ? o : null}
          busy={busy}
          onKeep={() => setAsking(false)}
          onCancel={cancel}
        />
      </td>
    </tr>
  );
}

// One row per coin across Binance and the Ledger (All): amounts, values and P&L added up, the
// average cost weighted by what each part's cost covers. An entered cost stays editable on the
// part it was entered for.
export function combined(holdings: Holding[]): Holding[] {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) groups.set(h.asset, [...(groups.get(h.asset) ?? []), h]);
  return [...groups.values()].map((parts) => {
    const entered = parts.find((h) => h.costEntered);
    const lead =
      entered ?? parts.reduce((a, b) => (Number(b.value ?? 0) > Number(a.value ?? 0) ? b : a));
    if (parts.length === 1) return lead;
    const add = (pick: (h: Holding) => Num) => {
      const known = parts.map(pick).filter((v): v is string => v !== null);
      return known.length ? String(known.reduce((s, v) => s + Number(v), 0)) : null;
    };
    const costed = parts.filter((h) => h.averageCost !== null && h.covered !== null);
    const covered = costed.reduce((s, h) => s + Number(h.covered), 0);
    const paid = costed.reduce((s, h) => s + Number(h.covered) * Number(h.averageCost), 0);
    const profit = add((h) => h.profit);
    return {
      ...lead,
      amount: add((h) => h.amount) ?? "0",
      value: add((h) => h.value),
      share: add((h) => h.share),
      averageCost: covered > 0 ? String(paid / covered) : null,
      covered: costed.length ? String(covered) : null,
      profit,
      profitPercent: profit !== null && paid > 0 ? String((Number(profit) / paid) * 100) : null,
      costEntered: Boolean(entered),
      // The row's figures use the blend; the cost editor shows and saves the entered part's own
      // cost, never the blend (review, 22 Nov 2026).
      enteredCost: entered ? entered.averageCost : undefined,
    };
  });
}

// What a holding cost in US dollars: the amount its cost covers, at that cost; null if no cost.
function invested(h: Holding): string | null {
  if (h.averageCost === null || h.covered === null) return null;
  return String(Number(h.covered) * Number(h.averageCost));
}

// The owner's own average cost for a holding with no trades here, such as TAO on the Ledger
// (decision 27): "Add cost" until set, then the cost itself, either opening a small editor.
function CostCell({
  holding,
  m,
  onSaved,
}: {
  holding: Holding;
  m: Money;
  onSaved: (problem?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(holding.enteredCost ?? holding.averageCost ?? "");
  const [saving, setSaving] = useState(false);
  const what = `${holding.asset} in ${SOURCE_WORD[holding.source]}`;
  const save = async (next: string | null) => {
    setSaving(true);
    try {
      await setCost(holding.source, holding.asset, next);
      setEditing(false);
      onSaved();
    } catch (error) {
      onSaved(message(error));
    } finally {
      setSaving(false);
    }
  };
  if (!editing) {
    return (
      <button
        type="button"
        className="cost-btn"
        aria-label={
          holding.costEntered
            ? `Change your average cost for ${what}`
            : `Add average cost for ${what}`
        }
        title={holding.costEntered ? "Your own average cost: click to change" : undefined}
        onClick={() => setEditing(true)}
      >
        {holding.costEntered && holding.averageCost !== null
          ? m.price(holding.averageCost)
          : "Add cost"}
      </button>
    );
  }
  return (
    <form
      className="cost-form"
      // Clicking anywhere outside the editor closes it, unsaved (Save keeps it open to send).
      onBlur={(e) => {
        if (!saving && !e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void save(value.trim() === "" ? null : value.trim());
      }}
    >
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner just asked to edit this cell
        autoFocus
        aria-label={`Average cost for ${what}, in USD`}
        inputMode="decimal"
        placeholder="USD each"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button
        className="btn btn-small"
        type="submit"
        disabled={saving}
        // Keeps focus in the field, so the click saves rather than closing the editor first.
        onMouseDown={(e) => e.preventDefault()}
      >
        Save
      </button>
    </form>
  );
}

// A holding opened in place: where it's held, what it cost, and where to act on it. Selling or
// adding runs through the book that owns the coin (the DCA book or Trade), so every order keeps
// its record; coins on the Ledger are sent to Binance first.
const DCA_COINS = new Set(["BTC", "ETH", "SOL", "ZEC", "HYPE"]);

function HoldingDetail({
  holding: h,
  where,
  m,
  onSaved,
}: {
  holding: Holding;
  where: Holding[];
  m: Money;
  onSaved: (problem?: string) => void;
}) {
  const onBinance = where.find((p) => p.source === "Binance");
  const onLedger = where.find((p) => p.source === "Ledger");
  return (
    <div className="port-detail">
      <dl>
        {where.map((p) => (
          <div key={p.source}>
            <dt>{p.source === "Ledger" ? "On the Ledger" : "On Binance"}</dt>
            <dd className="num">
              {amount(p.amount)} {p.asset} · {m.whole(p.value)}
            </dd>
          </div>
        ))}
        <div>
          <dt>Average cost</dt>
          <dd className="num">
            {h.averageCost === null ? "Not known" : m.price(h.averageCost)}
            {h.covered !== null && Number(h.covered) < Number(h.amount) && (
              <small className="muted"> · covers {coverage(h)}</small>
            )}{" "}
            <CostCell holding={h} m={m} onSaved={onSaved} />
          </dd>
        </div>
      </dl>
      <p className="port-detail-acts">
        {onBinance ? (
          DCA_COINS.has(h.asset) ? (
            <a className="btn btn-small" href={`#/dca-book?coin=${h.asset}`}>
              Take profit or add funds on the DCA book
            </a>
          ) : (
            <a className="btn btn-small" href="#/trade">
              Take profit or add funds on Trade
            </a>
          )
        ) : null}
        {onLedger && (
          <span className="muted">
            {onBinance ? "The Ledger's part sells" : "To sell, send it"} to Binance first; the desk
            never moves coins off the Ledger.
          </span>
        )}
      </p>
    </div>
  );
}

function Tables({
  data,
  holdings,
  parts,
  source,
  m,
  onReload,
}: {
  data: Data;
  holdings: Holding[];
  // Every holding by source, so an All row can say where its coin is held.
  parts: Holding[];
  source: Source;
  m: Money;
  onReload: (problem?: string) => void;
}) {
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [orderAt, setOrderAt] = useState<DOMRect | null>(null);
  const showOrder = (o: Order, at: DOMRect) => {
    setOrderAt(at);
    setOpenOrder(o);
  };
  const [tab, setTab] = useState<Tab>("bal");
  // The holding row that's open, by coin and source.
  const [opened, setOpened] = useState<string | null>(null);
  // What each holding cost: the amount its cost covers at that cost; the table's totals.
  const totalInvested = holdings.reduce((s, h) => s + Number(invested(h) ?? 0), 0);
  const totalValue = holdings.reduce((s, h) => s + Number(h.value ?? 0), 0);
  const totalProfit = holdings.reduce((s, h) => s + Number(h.profit ?? 0), 0);
  // Sorting the balances: by value, high first, until a header is clicked; empty figures last.
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "value", down: true });
  const figure = (h: Holding): string | null =>
    ({
      coin: h.asset,
      invested: invested(h),
      value: h.value,
      change: h.change24h,
    })[sort.key];
  const sorted = [...holdings].sort((a, b) => {
    const x = figure(a);
    const y = figure(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    const order = sort.key === "coin" ? x.localeCompare(y) : Number(x) - Number(y);
    return order * (sort.down ? -1 : 1);
  });
  // Coins sort A to Z on the first click; figures high to low.
  const sortable = (key: SortKey, label: string) => (
    <th
      className={key === "coin" ? undefined : "r"}
      aria-sort={sort.key === key ? (sort.down ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className="sort-btn"
        onClick={() => setSort((s) => ({ key, down: s.key === key ? !s.down : key !== "coin" }))}
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.down ? " ↓" : " ↑") : ""}</span>
      </button>
    </th>
  );
  // Orders and trades are Binance's: the Ledger view leaves them out (owner, 22 Nov 2026).
  const tabs: [Tab, string, () => React.JSX.Element][] = (
    [
      ["bal", "Holdings", CoinsIcon],
      ["ord", `Open orders (${data.openOrders.length})`, ClockIcon],
      ["trd", "Recent trades", ListIcon],
    ] as [Tab, string, () => React.JSX.Element][]
  ).filter(([key]) => source !== "Ledger" || (key !== "ord" && key !== "trd"));
  const shownTab = tabs.some(([key]) => key === tab) ? tab : "bal";
  return (
    <section className="port-ledger" aria-label="Holdings and orders">
      <div className="tabs port-tabs" role="tablist">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={shownTab === key}
            onClick={() => setTab(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      {shownTab === "bal" &&
        (holdings.length === 0 ? (
          <p className="empty">
            {source === "all"
              ? "No balances yet. Deposit or buy on Binance, then refresh."
              : source === "Ledger"
                ? `Nothing over ${m.whole(DUST)} on the Ledger. Add its addresses in Settings.`
                : `Nothing over ${m.whole(DUST)} on Binance.`}
          </p>
        ) : (
          <div className="scroll">
            <table className="port-holdings">
              <thead>
                <tr>
                  {sortable("coin", "Coin")}
                  {sortable("invested", "Invested")}
                  {sortable("value", "Holding")}
                  {sortable("change", "24h")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((h) => {
                  const key = `${h.asset}-${h.source}`;
                  const open = opened === key;
                  const partial = h.covered !== null && Number(h.covered) < Number(h.amount);
                  const where = parts.filter((p) => p.asset === h.asset);
                  return (
                    <Fragment key={key}>
                      {/* The whole row opens the coin, as on Trade: the name's button is stretched over it. */}
                      <tr className={`dcb-row-open${open ? " is-open" : ""}`}>
                        <td>
                          <button
                            type="button"
                            className="dcb-expand"
                            aria-expanded={open}
                            aria-label={`${h.asset}: ${open ? "close" : "open"} its details`}
                            onClick={() => setOpened(open ? null : key)}
                          >
                            <Coin symbol={h.asset} />
                          </button>
                          <small className="sub num">{amountSleek(h.amount, h.price)}</small>
                        </td>
                        <td className="r num muted">
                          {invested(h) === null ? "–" : m.whole(invested(h))}
                        </td>
                        <td className="r port-hold">
                          <HoldingCell
                            m={m}
                            value={h.value === null ? null : Number(h.value)}
                            pnl={Number(h.profit ?? 0)}
                            pnlPct={h.profitPercent === null ? null : Number(h.profitPercent)}
                            avg={h.averageCost === null ? null : Number(h.averageCost)}
                            now={h.price === null ? null : Number(h.price)}
                            avgTitle={
                              h.feeToken
                                ? "Fee token: the average price of this year's buys, for all you hold"
                                : partial && !h.costEntered
                                  ? `From trades for ${coverage(h)}: trades since 1 Jul 2026 cover ${amount(h.covered)} of ${amount(h.amount)}; add a cost for the rest`
                                  : undefined
                            }
                          />
                        </td>
                        <td className={`r num ${trend(h.change24h)}`}>{percent(h.change24h)}</td>
                      </tr>
                      {open && (
                        <tr className="port-open">
                          <td colSpan={4}>
                            <HoldingDetail holding={h} where={where} m={m} onSaved={onReload} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="r num">{m.whole(totalInvested)}</td>
                  <td className="r port-hold">
                    <span className="dcb-hold">
                      <b>{m.whole(totalValue)}</b>
                      <span className={trend(String(Math.round(totalProfit)))}>
                        {m.whole(totalProfit, true)}
                        {totalInvested > 0 &&
                          ` (${percent(String((totalProfit / totalInvested) * 100))})`}
                      </span>
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      {shownTab === "ord" && (
        <p className="port-ord-tools">
          <button type="button" className="link" onClick={exportDcaCsv}>
            Export the DCA book's orders (CSV)
          </button>
        </p>
      )}
      {shownTab === "ord" &&
        (data.openOrders.length === 0 ? (
          <p className="empty">No open orders.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Placed</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="r">Price</th>
                  <th className="r">Amount</th>
                  <th className="r">Filled</th>
                  <th className="r">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.openOrders.map((o) => (
                  <OrderRow key={o.orderId} o={o} m={m} onDone={onReload} onOpen={showOrder} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <OrderDetail
        order={openOrder}
        at={orderAt}
        onClose={() => setOpenOrder(null)}
        onDone={(_note, problem) => onReload(problem)}
      />
      {shownTab === "trd" &&
        (data.recentTrades.length === 0 ? (
          <p className="empty">No trades against USDT, USDC or FDUSD yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th className="r">Price</th>
                  <th className="r">Amount</th>
                  <th className="r">Total</th>
                  <th className="r">Fee</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTrades.map((t) => (
                  <tr key={`${t.time}-${t.pair}-${t.price}-${t.amount}`}>
                    <td className="muted">{dateTime(t.time)}</td>
                    <td>{t.pair}</td>
                    <td>
                      <span className={`tag ${t.side === "Buy" ? "buy" : "sell"}`}>{t.side}</span>
                    </td>
                    <td className="r num">{m.price(t.price)}</td>
                    <td className="r num">{amount(t.amount)}</td>
                    <td className="r num">{m.whole(t.total)}</td>
                    <td className="r num muted">{t.fee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

// The side panel's Ledger dot: off when TAO or any of the Ledger's addresses couldn't be read,
// so a partly read Ledger never shows as fine (audit, 22 Nov 2026).
function ledgerStatus(data: Data): TaoWallet["status"] {
  const tao = data.wallets.tao.status;
  const ledger = data.wallets.ledger;
  const failed =
    ledger?.status === "error" ||
    (ledger?.status === "connected" && (ledger.failedNetworks ?? []).length > 0);
  if (tao === "error" || failed) return "error";
  if (tao === "not_set" && (!ledger || ledger.status === "not_set")) return "not_set";
  return "connected";
}

// The last figures read, shown at once when the page comes back while fresh ones load.
let lastSeen: Data | null = null;

// Every order the DCA book placed, as a spreadsheet (moved here from the DCA page, owner,
// 21 Nov 2026).
function exportDcaCsv() {
  getDcaBook().then(
    (book) => {
      const blob = new Blob([toCsv(book.orders, book.quote)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dca-book-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    () => undefined,
  );
}

export default function Portfolio({
  onStatus,
  onTao,
  currency = "AUD",
}: {
  onStatus: (status: Status) => void;
  onTao: (status: TaoWallet["status"]) => void;
  currency?: Currency;
}) {
  // Coming back to the page shows the last figures at once while fresh ones load.
  const [state, setState] = useState<State>({ kind: "loading", last: lastSeen });
  const [problem, setProblem] = useState("");
  const [source, setSource] = useState<Source>(sourceFromHash);
  // The side panel's Binance and Ledger links open the page on that source.
  useEffect(() => {
    const follow = () => setSource(sourceFromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  // null while loading, false when the first read failed (a failed refresh keeps the last).
  const [drift, setDrift] = useState<Drift | null | false>(null);

  const settle = useCallback(
    (pending: Promise<Data>) => {
      pending.then(
        (data) => {
          lastSeen = data;
          setState({ kind: "ready", data });
          onStatus(data.demo ? "demo" : "connected");
          onTao(ledgerStatus(data));
        },
        (e: unknown) => {
          setState((s) => ({
            kind: "error",
            message: message(e),
            last: s.kind === "ready" ? s.data : s.last,
          }));
          onStatus("disconnected");
        },
      );
      // The targets move with prices, so they're read with the balances.
      getDrift().then(setDrift, () => setDrift((d) => d ?? false));
    },
    [onStatus, onTao],
  );

  // Balances change on Binance outside the desk (an app trade, a deposit), so the page reads them
  // again every minute while it's in view, and at once when the tab comes back into view.
  useEffect(() => {
    const quiet = () => {
      if (document.visibilityState === "visible") settle(getPortfolio());
    };
    settle(getPortfolio());
    const timer = window.setInterval(quiet, REFRESH_MS);
    document.addEventListener("visibilitychange", quiet);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", quiet);
    };
  }, [settle]);

  const reload = (issue?: string) => {
    setProblem(issue ?? "");
    setState((s) => ({ kind: "loading", last: s.kind === "ready" ? s.data : s.last }));
    onStatus("fetching");
    settle(getPortfolio());
  };

  const data = state.kind === "ready" ? state.data : state.last;
  const held = data?.holdings.filter((h) => !isDust(h)) ?? [];
  const everything = data?.holdings ?? [];
  // Binance and Ledger list their own coins; All adds each coin up across them, one row a coin
  // and no labels (owner, 22 Nov 2026).
  const shown =
    source === "all"
      ? combined(everything).filter((h) => !isDust(h))
      : held.filter((h) => inSource(h, source));
  const m = money(
    currency,
    data?.total.rates ?? (data?.total.audRate ? { AUD: data.total.audRate } : undefined),
  );

  return (
    <main className="wrap port">
      <h1 className="visually-hidden">Portfolio</h1>
      <div className="port-head">
        {data && (
          <div className="views source-filter" role="group" aria-label="Show holdings from">
            {SOURCES.map(([key, label]) => {
              const Icon = SOURCE_ICON[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={source === key}
                  onClick={() => setSource(key)}
                >
                  <Icon />
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <span className="spacer" />
        <span className="port-stamp">
          {data?.demo ? "Demo data. " : ""}
          {data ? `Fetched ${fetchedAt(data.fetchedAt)}` : "Fetching"}
        </span>
        <button
          className={`icon-btn refresh-btn${state.kind === "loading" ? " spinning" : ""}`}
          type="button"
          aria-label={state.kind === "loading" ? "Refreshing" : "Refresh"}
          title="Refresh"
          onClick={() => reload()}
          disabled={state.kind === "loading"}
        >
          <ResetIcon />
        </button>
      </div>

      {state.kind === "error" && (
        <div className="alert" role="alert">
          <span>{state.message}</span>
          <button className="btn btn-small" type="button" onClick={() => reload()}>
            Try again
          </button>
        </div>
      )}
      {problem && (
        <div className="alert" role="alert">
          <span>{problem}</span>
        </div>
      )}

      {data ? (
        <>
          <Widgets data={data} source={source} m={m} />
          {/* Two boxes of one size (owner, 22 Nov 2026): Allocation, and beside it the tab's own
              second box: targets on All, Fiat on Binance, custody on the Ledger. */}
          <div className="port-pair">
            <Allocation holdings={shown} m={m} />
            {source === "all" && <Targets drift={drift} />}
            {source === "Binance" && <Deposits />}
            {source === "Ledger" && <Custody parts={held} m={m} />}
          </div>
          <Tables
            data={data}
            holdings={shown}
            parts={held}
            source={source}
            m={m}
            onReload={reload}
          />
        </>
      ) : (
        state.kind === "loading" && (
          // The page's own shape while it loads (code-standards 28): four tiles, the boxes, rows.
          <div className="port-skeleton" aria-busy="true" aria-label="Loading your holdings">
            <div className="port-skel-tiles">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="skeleton" />
              ))}
            </div>
            <span className="skeleton port-skel-box" />
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="skeleton port-skel-row" />
            ))}
          </div>
        )
      )}
    </main>
  );
}
