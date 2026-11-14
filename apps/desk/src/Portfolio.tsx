import { useCallback, useEffect, useState } from "react";
import { ApiError, cancelOrder, getPortfolio, setCost } from "./api";
import CoinIcon from "./CoinIcon";
import ConfirmCancel from "./ConfirmCancel";
import OrderDetail from "./OrderDetail";
import Deposits from "./Deposits";
import { FearGreed, Movers, Signals } from "./Widgets";
import { ResetIcon } from "./icons";
import { type Currency, type Money, money } from "./money";
import { Clickable, DetailPanel, type DetailKind } from "./WidgetDetails";
import {
  amount,
  amountSleek,
  dateTime,
  fetchedAt,
  percent,
  price,
  trend,
  usd,
  usdWhole,
} from "./format";
import type { Holding, Order, Portfolio as Data, TaoWallet } from "./types";
import type { Status } from "./ui";

// The US-dollar figure and rate under the total: kept, but hidden at the owner's request.
const SHOW_RATE_LINE = false;

const DUST = 5; // a holding worth less than this, or nothing, is dust: never shown
export function isDust(h: Holding): boolean {
  return h.value === null || Number(h.value) < DUST;
}

const COLOURS = [1, 2, 3, 4, 5, 6].map((n) => `var(--alloc-${n})`);
type Tab = "bal" | "ord" | "trd";

// Where a holding is kept; the Dashboard can show one source or all of them.
export type Source = "all" | Holding["source"];
const SOURCES: [Source, string][] = [
  ["all", "All"],
  ["Binance", "Binance"],
  ["TAO wallet", "Wallet"],
];
const SOURCE_WORD: Record<Source, string> = {
  all: "all sources",
  Binance: "Binance",
  "TAO wallet": "Wallet",
};

// How much of the holding the trades account for, as a share.
function coverage(h: Holding): string {
  const share = (Number(h.covered) / Number(h.amount)) * 100;
  return `${share < 1 ? "<1" : Math.floor(share)}%`;
}

interface Totals {
  value: number;
  change: number;
  changePercent: number | null;
  profit: number;
}

// Totals for the holdings shown. With every source, the api's own figures; for one source,
// summed from its holdings (dust included, so the parts add up to the whole).
export function totals(data: Data, source: Source): Totals {
  if (source === "all") {
    return {
      value: Number(data.total.value),
      change: Number(data.total.change24h),
      changePercent:
        data.total.change24hPercent === null ? null : Number(data.total.change24hPercent),
      profit: Number(data.total.profit),
    };
  }
  let value = 0;
  let change = 0;
  let profit = 0;
  for (const h of data.holdings.filter((x) => x.source === source)) {
    const v = Number(h.value ?? 0);
    const pct = Number(h.change24h ?? 0);
    value += v;
    change += v - v / (1 + pct / 100);
    profit += Number(h.profit ?? 0);
  }
  const before = value - change;
  return { value, change, changePercent: before > 0 ? (change / before) * 100 : null, profit };
}

type State =
  | { kind: "loading"; last: Data | null }
  | { kind: "ready"; data: Data }
  | { kind: "error"; message: string; last: Data | null };

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

function Coin({ symbol, name, tag }: { symbol: string; name?: string; tag?: string }) {
  return (
    <span className="coin">
      <CoinIcon coin={symbol} />
      {name ?? symbol}
      {tag && <small className="coin-tag">{tag}</small>}
    </span>
  );
}

type By = "coin" | "wallet";
type SortKey = "coin" | "invested" | "value" | "change" | "pnl";

// A card's heading with its By coin / By wallet switch (Allocation, PnL).
function ByHeading({ title, by, onBy }: { title: string; by: By; onBy: (by: By) => void }) {
  return (
    <div className="kv" style={{ padding: 0, alignItems: "center" }}>
      <span className="label">{title}</span>
      <div className="views views-small" role="group" aria-label={`${title} by`}>
        {(["coin", "wallet"] as const).map((key) => (
          <button key={key} type="button" aria-pressed={by === key} onClick={() => onBy(key)}>
            By {key}
          </button>
        ))}
      </div>
    </div>
  );
}

const WALLETS = ["Binance", "TAO wallet"] as const;

// Every coin held (dust is already out), or the split between Binance and the wallet; shares of
// what's shown, so they add to 100%. The largest five get their own colour, the rest share one.
function Allocation({ holdings }: { holdings: Holding[] }) {
  const [by, setBy] = useState<By>("coin");
  const valued = holdings.filter((h) => h.value !== null && Number(h.value) > 0);
  const whole = valued.reduce((s, h) => s + Number(h.value), 0) || 1;
  const groups =
    by === "coin"
      ? valued.map((h) => ({
          key: `${h.asset}-${h.source}`,
          label: h.source === "TAO wallet" ? "TAO (wallet)" : h.asset,
          coin: h.asset as string | null,
          value: Number(h.value),
        }))
      : WALLETS.map((source) => ({
          key: source,
          label: SOURCE_WORD[source],
          coin: null as string | null,
          value: valued.filter((h) => h.source === source).reduce((s, h) => s + Number(h.value), 0),
        }))
          .filter((g) => g.value > 0)
          .sort((a, b) => b.value - a.value);
  const parts = groups.map((g, i) => ({
    ...g,
    share: (g.value / whole) * 100,
    colour: COLOURS[Math.min(i, COLOURS.length - 1)],
  }));
  return (
    <>
      <ByHeading title="Allocation" by={by} onBy={setBy} />
      <div className="alloc" aria-hidden="true">
        {parts.map((p) => (
          <div key={p.key} style={{ flex: p.share, background: p.colour }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            {p.coin ? (
              <span className="legend-icon" style={{ boxShadow: `0 0 0 1.5px ${p.colour}` }}>
                <CoinIcon coin={p.coin} />
              </span>
            ) : (
              <s style={{ background: p.colour }} />
            )}
            {p.label} {p.share > 0 && p.share < 1 ? "<1" : p.share.toFixed(0)}%
          </span>
        ))}
      </div>
    </>
  );
}

// Unrealised PnL per account (Binance, Wallet) in the chosen currency and percent, from each holding's
// average cost: its trades', or one the owner entered (decision 27). A holding with neither has
// no PnL; a note counts them.
function Pnl({ holdings, m }: { holdings: Holding[]; m: Money }) {
  const costOf = (h: Holding) => {
    const p = Number(h.profitPercent ?? 0);
    return p ? Number(h.profit) / (p / 100) : 0;
  };
  const sum = (list: Holding[]) => {
    const costed = list.filter((h) => h.profit !== null);
    const profit = costed.reduce((s, h) => s + Number(h.profit), 0);
    const cost = costed.reduce((s, h) => s + costOf(h), 0);
    return { profit, pct: cost > 0 ? String((profit / cost) * 100) : null, costed: costed.length };
  };
  const total = sum(holdings);
  const accounts = WALLETS.filter((w) => holdings.some((h) => h.source === w)).map((w) => ({
    key: w,
    label: SOURCE_WORD[w],
    ...sum(holdings.filter((h) => h.source === w)),
  }));
  return (
    <div className="card stat widget pnl">
      <div className="kv" style={{ padding: 0 }}>
        <span className="label">PnL</span>
        <span className="label muted">Unrealised</span>
      </div>
      <div className={`big num ${trend(String(Math.round(total.profit)))}`}>
        {m.whole(total.profit, true)}
      </div>
      <div style={{ marginTop: 4 }}>
        <span className={`num ${trend(total.pct)}`}>{percent(total.pct)}</span>
      </div>
      <table className="pnl-accounts" aria-label="PnL by account">
        <thead>
          <tr>
            <th>Account</th>
            <th className="r">{m.currency}</th>
            <th className="r">%</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const none = a.costed === 0;
            const tone = none ? "" : trend(String(Math.round(a.profit)));
            return (
              <tr key={a.key}>
                <td>{a.label}</td>
                <td className={`r num ${tone}`}>{none ? "–" : m.whole(a.profit, true)}</td>
                <td className={`r num ${trend(a.pct)}`}>{percent(a.pct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaoLine({ tao }: { tao: TaoWallet }) {
  if (tao.status === "connected") {
    return (
      <div
        className="kv"
        title={`${amount(tao.staked)} staked + ${amount(tao.free)} free${
          Number(tao.rewards ?? 0) > 0
            ? `; ${amount(tao.rewards ?? "0")} in root rewards to claim`
            : ""
        }`}
      >
        <span className="muted">TAO</span>
        <span className="num">
          {/* The whole: staked + free + rewards to claim, cut (not rounded) to 1 place. */}
          {(Math.floor((Number(tao.total) + Number(tao.rewards ?? 0)) * 10) / 10).toLocaleString(
            "en-AU",
            { minimumFractionDigits: 1, maximumFractionDigits: 1 },
          )}{" "}
          τ
          {Number(tao.rewards ?? 0) > 0 && (
            <span className="muted">
              {" "}
              · incl.{" "}
              {(Math.floor(Number(tao.rewards) * 10) / 10).toLocaleString("en-AU", {
                maximumFractionDigits: 1,
              })}{" "}
              τ in baskets
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="kv">
      <span className="muted">Wallet</span>
      <span className="dim">{tao.status === "error" ? tao.error : "Not set up"}</span>
    </div>
  );
}

function OrderRow({
  o,
  onDone,
  onOpen,
}: {
  o: Order;
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
      <td className="r num">{price(o.price)}</td>
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

// The owner's own average cost for a holding with no trades here, such as the TAO wallet
// (decision 27): "Add cost" until set, then the cost itself, either opening a small editor.
// What a holding cost in US dollars: the amount its cost covers, at that cost; null if no cost.
function invested(h: Holding): string | null {
  if (h.averageCost === null || h.covered === null) return null;
  return String(Number(h.covered) * Number(h.averageCost));
}

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
  const [value, setValue] = useState(holding.averageCost ?? "");
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

function Tables({
  data,
  holdings,
  source,
  m,
  onReload,
}: {
  data: Data;
  holdings: Holding[];
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
      pnl: h.profitPercent,
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
  const tabs: [Tab, string][] = [
    ["bal", "Balances"],
    ["ord", `Open orders (${data.openOrders.length})`],
    ["trd", "Recent trades"],
  ];
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "bal" &&
        (holdings.length === 0 ? (
          <p className="empty">
            {source === "all"
              ? "No balances yet. Deposit or buy on Binance, then refresh."
              : `Nothing over $${DUST} in ${SOURCE_WORD[source]}.`}
          </p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {sortable("coin", "Coin")}
                  {sortable("invested", "Invested")}
                  {sortable("value", "Value")}
                  {sortable("pnl", "PnL")}
                  {sortable("change", "24h")}
                  <th className="r">Price</th>
                  <th className="r">Avg cost</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((h) => {
                  const partial = h.covered !== null && Number(h.covered) < Number(h.amount);
                  return (
                    <tr key={`${h.asset}-${h.source}`}>
                      <td>
                        <Coin
                          symbol={h.asset}
                          tag={
                            h.source !== "Binance" ||
                            holdings.some((o) => o.asset === h.asset && o.source !== h.source)
                              ? SOURCE_WORD[h.source]
                              : undefined
                          }
                        />
                        <small className="sub num">{amountSleek(h.amount, h.price)}</small>
                      </td>
                      <td className="r num muted">
                        {invested(h) === null ? "–" : m.whole(invested(h))}
                      </td>
                      <td className="r num">{m.whole(h.value)}</td>
                      <td
                        className={`r num ${trend(h.profit === null ? null : String(Math.round(Number(h.profit))))}`}
                      >
                        {m.whole(h.profit, true)}
                        {h.profitPercent !== null && (
                          <small className="sub">{percent(h.profitPercent)}</small>
                        )}
                      </td>
                      <td className={`r num ${trend(h.change24h)}`}>{percent(h.change24h)}</td>
                      <td className="r num">{m.price(h.price)}</td>
                      <td
                        className={`r num muted${partial && !h.costEntered ? " partial" : ""}`}
                        title={
                          h.feeToken
                            ? "Fee token: the average price of this year's buys, for all you hold"
                            : partial && !h.costEntered
                              ? `From trades for ${coverage(h)}: they cover ${amount(h.covered)} of ${amount(h.amount)}; the rest was deposited or bought another way`
                              : undefined
                        }
                      >
                        {h.averageCost !== null && !h.costEntered ? (
                          m.price(h.averageCost)
                        ) : (
                          <CostCell holding={h} m={m} onSaved={onReload} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="r num">{m.whole(totalInvested)}</td>
                  <td className="r num">{m.whole(totalValue)}</td>
                  <td className={`r num ${trend(String(Math.round(totalProfit)))}`}>
                    {m.whole(totalProfit, true)}
                    {totalInvested > 0 && (
                      <small className="sub">
                        {percent(String((totalProfit / totalInvested) * 100))}
                      </small>
                    )}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      {tab === "ord" &&
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
                  <OrderRow key={o.orderId} o={o} onDone={onReload} onOpen={showOrder} />
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
      {tab === "trd" &&
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
                    <td className="r num">{price(t.price)}</td>
                    <td className="r num">{amount(t.amount)}</td>
                    <td className="r num">{usd(t.total)}</td>
                    <td className="r num muted">{t.fee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

let lastSeen: Data | null = null;

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
  const [source, setSource] = useState<Source>("all");
  const [detail, setDetail] = useState<DetailKind | null>(null);
  const [detailAt, setDetailAt] = useState<DOMRect | null>(null);
  const openDetail = (kind: DetailKind, at: DOMRect) => {
    setDetailAt(at);
    setDetail(kind);
  };

  const settle = useCallback(
    (pending: Promise<Data>) => {
      pending.then(
        (data) => {
          lastSeen = data;
          setState({ kind: "ready", data });
          onStatus(data.demo ? "demo" : "connected");
          onTao(data.wallets.tao.status);
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
    },
    [onStatus, onTao],
  );

  useEffect(() => {
    settle(getPortfolio());
  }, [settle]);

  const load = () => {
    setState((s) => ({ kind: "loading", last: s.kind === "ready" ? s.data : s.last }));
    onStatus("fetching");
    settle(getPortfolio());
  };

  const reload = (issue?: string) => {
    setProblem(issue ?? "");
    load();
  };

  const data = state.kind === "ready" ? state.data : state.last;
  const binanceValue = data?.holdings
    .filter((h) => h.source === "Binance")
    .reduce((s, h) => s + Number(h.value ?? 0), 0);
  const walletValue = data?.holdings
    .filter((h) => h.source === "TAO wallet")
    .reduce((s, h) => s + Number(h.value ?? 0), 0);
  const held = data?.holdings.filter((h) => !isDust(h)) ?? [];
  const shown = held.filter((h) => source === "all" || h.source === source);
  const sum = data ? totals(data, source) : null;
  const m = money(
    currency,
    data?.total.rates ?? (data?.total.audRate ? { AUD: data.total.audRate } : undefined),
  );
  const rateText =
    m.currency === "USD"
      ? ""
      : m.rate.toLocaleString("en-AU", { maximumSignificantDigits: m.currency === "BTC" ? 4 : 6 });

  return (
    <main className="wrap">
      <div className="head-row dash-head">
        <h1 className="visually-hidden">Dashboard</h1>
        {data && (
          <div className="views source-filter" role="group" aria-label="Show holdings from">
            {SOURCES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={source === key}
                onClick={() => setSource(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <span className="label">
          {data?.demo ? "Demo data · " : ""}
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

      {data && sum ? (
        <>
          {/* Eight compact widgets, four a row (design-system 19). */}
          <div className="widgets">
            <Clickable kind="total" onOpen={openDetail}>
              <div className="card stat widget">
                <div className="label">
                  {source === "all" ? "Total value" : `${SOURCE_WORD[source]} value`}
                </div>
                <div className="big num">{m.whole(sum.value)}</div>
                <div className={`num ${trend(String(sum.change))}`} style={{ marginTop: 4 }}>
                  {m.whole(sum.change, true)} (
                  {percent(sum.changePercent === null ? null : String(sum.changePercent))}){" "}
                  <span className="muted">24h</span>
                </div>
                {SHOW_RATE_LINE && m.currency !== "USD" && (
                  <div className="muted num" style={{ marginTop: 4 }}>
                    US{usdWhole(String(sum.value))} at {rateText} {m.currency}
                  </div>
                )}
              </div>
            </Clickable>
            <Clickable kind="accounts" onOpen={openDetail}>
              <div className="card stat widget">
                <div className="label">Accounts</div>
                <div className="kv">
                  <span className="muted">Binance</span>
                  <span className="num">{m.whole(binanceValue ?? 0)}</span>
                </div>
                <div className="kv">
                  <span className="muted">Wallet</span>
                  <span className="num">{m.whole(walletValue ?? 0)}</span>
                </div>
                <TaoLine tao={data.wallets.tao} />
              </div>
            </Clickable>
            <Clickable kind="pnl" onOpen={openDetail}>
              <Pnl holdings={shown} m={m} />
            </Clickable>
            <Clickable kind="fear" onOpen={openDetail}>
              <FearGreed />
            </Clickable>
            <Clickable kind="allocation" onOpen={openDetail}>
              <div className="card stat widget">
                <Allocation holdings={shown} />
              </div>
            </Clickable>
            <Clickable kind="deposits" onOpen={openDetail}>
              <Deposits />
            </Clickable>
            <Clickable kind="movers" onOpen={openDetail}>
              <Movers holdings={shown} />
            </Clickable>
            <Clickable kind="signals" onOpen={openDetail}>
              <Signals />
            </Clickable>
          </div>
          <DetailPanel
            kind={detail}
            at={detailAt}
            onClose={() => setDetail(null)}
            holdings={shown}
            m={m}
            history={data.history ?? []}
            accounts={[
              { name: "Binance", value: binanceValue ?? 0 },
              { name: "Wallet", value: walletValue ?? 0 },
            ]}
          />

          <Tables data={data} holdings={shown} source={source} m={m} onReload={reload} />
        </>
      ) : (
        state.kind === "loading" && (
          <div aria-hidden="true" className="skeleton" style={{ height: 260 }} />
        )
      )}
    </main>
  );
}
