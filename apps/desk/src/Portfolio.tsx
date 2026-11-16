// The Portfolio (decision 64): what you hold in a sentence, one strip of it against your
// targets, then the ledgers: targets, money in, and the holdings with orders, trades and tax.
import { DriftCard, TaxTab } from "./Tax";
import { useCallback, useEffect, useState } from "react";
import { ApiError, cancelOrder, getDrift, getPortfolio, setCost } from "./api";
import CoinIcon from "./CoinIcon";
import ConfirmCancel from "./ConfirmCancel";
import OrderDetail from "./OrderDetail";
import Deposits from "./Deposits";
import { Live } from "./Figures";
import { ResetIcon } from "./icons";
import { type Currency, type Money, money } from "./money";
import { amount, amountSleek, dateTime, fetchedAt, percent, price, trend, usd } from "./format";
import type { Drift, Holding, Order, Portfolio as Data, TaoWallet } from "./types";
import type { Status } from "./ui";
import "./portfolio.css";

const REFRESH_MS = 60_000; // the TAO wallet reading is reused for a minute (tao.py)
const DUST = 5; // a holding worth less than this, or nothing, is dust: never shown
export function isDust(h: Holding): boolean {
  return h.value === null || Number(h.value) < DUST;
}

// Slice colours in order; the light ones (1, 3, 4) carry dark ink, the deep ones light ink.
const COLOURS = [1, 2, 3, 4, 5].map((n) => `var(--alloc-${n})`);
const LIGHT = new Set([0, 2, 3]);
const REST = "var(--line-2)"; // coins without a target, when there are targets, and the small ones
type Tab = "bal" | "ord" | "trd" | "tax";

// Where a holding is kept; the page shows one source or all of them.
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

type SortKey = "coin" | "invested" | "value" | "change" | "pnl";

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

// What a holding is worth against what it cost, as a short bar under its PnL: full and mint at or
// above cost, red and as long as what's kept below it.
function Kept({ holding: h }: { holding: Holding }) {
  const cost = Number(invested(h) ?? 0);
  if (!cost || h.value === null) return null;
  const covered = Number(h.covered ?? 0) * Number(h.price ?? 0);
  const kept = covered / cost;
  return (
    <span className={`port-kept${kept >= 1 ? " above" : ""}`} aria-hidden="true">
      <i style={{ width: `${Math.min(100, kept * 100)}%` }} />
    </span>
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
    ["bal", "Holdings"],
    ["ord", `Open orders (${data.openOrders.length})`],
    ["trd", "Recent trades"],
    ["tax", "Tax"],
  ];
  return (
    <section className="port-ledger" aria-label="Holdings and orders">
      <div className="tabs port-tabs" role="tablist">
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
                        <Kept holding={h} />
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
      {tab === "tax" && <TaxTab />}
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
    </section>
  );
}

// The TAO wallet in a line: the whole (staked, free and rewards to claim) cut to one place.
function TaoLine({ tao }: { tao: TaoWallet }) {
  const tenth = (v: number) =>
    (Math.floor(v * 10) / 10).toLocaleString("en-AU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  if (tao.status !== "connected") {
    return (
      <p className="port-tao">
        {tao.status === "error"
          ? `The wallet couldn't be read: ${tao.error ?? "Taostats didn't answer"}.`
          : "No wallet yet. Add TAO_COLDKEY to .env."}
      </p>
    );
  }
  const rewards = Number(tao.rewards ?? 0);
  return (
    <p
      className="port-tao"
      title={`${amount(tao.staked)} staked and ${amount(tao.free)} free${
        rewards > 0 ? `, with ${amount(tao.rewards ?? "0")} in root rewards to claim` : ""
      }`}
    >
      <span className="num">{tenth(Number(tao.total) + rewards)} τ</span> in the wallet
      {rewards > 0 && (
        <>
          , <span className="num">{tenth(rewards)} τ</span> of it in baskets to claim
        </>
      )}
      .
    </p>
  );
}

// What you hold, in a sentence: the value, against what it cost, then today's move.
function Hero({
  data,
  source,
  sum,
  m,
  accounts,
}: {
  data: Data;
  source: Source;
  sum: Totals;
  m: Money;
  accounts: { binance: number; wallet: number };
}) {
  const who =
    source === "all" ? "You hold" : source === "Binance" ? "Binance holds" : "Your wallet holds";
  const profit = Math.round(sum.profit);
  return (
    <section className="port-hero" aria-label="What you hold">
      <h2 className="port-headline num">
        {who}{" "}
        <Live value={String(Math.round(sum.value))}>
          <span title={m.whole(sum.value)}>{m.short(sum.value)}</span>
        </Live>
        {profit !== 0 && (
          <>
            ,{" "}
            <span className={profit > 0 ? "up" : "down"}>
              {m.short(Math.abs(profit))} {profit > 0 ? "above" : "under"}
            </span>{" "}
            what it cost
          </>
        )}
        .
      </h2>
      <p className="port-lead num">
        {source === "all" && (
          <>
            Binance {m.short(accounts.binance)}, the wallet {m.short(accounts.wallet)}.
          </>
        )}
      </p>
      {source !== "Binance" && <TaoLine tao={data.wallets.tao} />}
    </section>
  );
}

interface Slice {
  key: string;
  label: string;
  value: number;
  share: number;
  target: number | null;
  colour: string;
  ink: "dark" | "light";
  coins: string[];
}

const UNDER = 1; // coins under 1% without a target share one slice at the end
const LABELLED = 7; // a slice this wide (in %) carries its name inside

// The one bold thing: what you hold as a strip, coin by coin, with your targets under it in the
// same order and colours, so drift reads at a glance. Move over a slice, focus it or tap it.
export function Strip({
  holdings,
  drift,
  m,
}: {
  holdings: Holding[];
  drift: Drift | null;
  m: Money;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const byCoin = new Map<string, number>();
  for (const h of holdings) {
    if (h.value !== null && Number(h.value) > 0)
      byCoin.set(h.asset, (byCoin.get(h.asset) ?? 0) + Number(h.value));
  }
  const whole = [...byCoin.values()].reduce((a, b) => a + b, 0);
  if (whole <= 0) return null;
  const targets = new Map(
    (drift?.hasTargets ? drift.rows : []).map((r) => [r.coin, Number(r.targetPct)]),
  );
  // Coins with a target first, largest target first; then the rest by value.
  const rank = (c: string) => targets.get(c) ?? -1;
  const coins = [...new Set([...targets.keys(), ...byCoin.keys()])].sort(
    (a, b) => rank(b) - rank(a) || (byCoin.get(b) ?? 0) - (byCoin.get(a) ?? 0),
  );
  const slices: Slice[] = [];
  const small: string[] = [];
  let painted = 0;
  for (const coin of coins) {
    const value = byCoin.get(coin) ?? 0;
    const share = (value / whole) * 100;
    if (share < UNDER && !targets.has(coin)) {
      small.push(coin);
      continue;
    }
    slices.push({
      key: coin,
      label: coin,
      value,
      share,
      target: targets.get(coin) ?? null,
      // With targets, only coins that have one take a colour: the rest read as unplanned.
      colour: targets.size && !targets.has(coin) ? REST : (COLOURS[painted++] ?? REST),
      ink: LIGHT.has(painted - 1) && (!targets.size || targets.has(coin)) ? "dark" : "light",
      coins: [coin],
    });
  }
  if (small.length) {
    const value = small.reduce((s, c) => s + (byCoin.get(c) ?? 0), 0);
    slices.push({
      key: "rest",
      label: `${small.length} more`,
      value,
      share: (value / whole) * 100,
      target: null,
      colour: REST,
      ink: "light",
      coins: small,
    });
  }
  const pct = (v: number) => (v > 0 && v < 1 ? "<1%" : `${Math.round(v)}%`);
  const targeted = slices.filter((s) => s.target !== null);
  const untargeted = Math.max(0, 100 - targeted.reduce((s, x) => s + (x.target ?? 0), 0));
  const band = Number(drift?.band ?? 0);
  const read = (s: Slice) => {
    const what = s.key === "rest" ? s.coins.join(", ") : s.label;
    const now = `${what}: ${m.short(s.value)}, ${pct(s.share)} of what you hold`;
    if (s.target === null) return s.key === "rest" ? `${now}.` : `${now}. No target set.`;
    const gap = Math.round(s.share - s.target);
    const side = gap > 0 ? `${gap} points over` : gap < 0 ? `${-gap} points under` : "on target";
    const inside = Math.abs(s.share - s.target) <= band ? ", inside your band" : "";
    return `${now}. Target ${pct(s.target)}, ${side}${inside}.`;
  };
  const shown = slices.find((s) => s.key === picked);
  const largest = [...slices].sort((a, b) => b.value - a.value)[0];
  const outside = drift?.hasTargets ? drift.outside : 0;
  const idle = drift?.hasTargets
    ? outside === 0
      ? "Every coin is inside your band."
      : `${outside} coin${outside === 1 ? " is" : "s are"} outside your ±${drift.band} point band.`
    : largest
      ? `The largest, ${largest.label}, is ${pct(largest.share)} of what you hold.`
      : "";
  const slice = (s: Slice, width: number, i: number, now: boolean) => {
    const style = { flexGrow: width, background: s.colour, "--i": i } as React.CSSProperties;
    const name =
      width >= LABELLED ? (
        <span aria-hidden="true">
          {s.label} {pct(width)}
        </span>
      ) : null;
    const dim = picked && picked !== s.key ? " dim" : "";
    return now ? (
      <button
        key={s.key}
        type="button"
        className={`port-slice ${s.ink}${dim}`}
        style={style}
        aria-label={read(s)}
        onPointerEnter={() => setPicked(s.key)}
        onFocus={() => setPicked(s.key)}
        onClick={() => setPicked(s.key)}
      >
        {name}
      </button>
    ) : (
      <i
        key={s.key}
        className={`port-slice ${s.ink}${dim}`}
        style={style}
        onPointerEnter={() => setPicked(s.key)}
      >
        {name}
      </i>
    );
  };
  return (
    <section className="port-strip" aria-label="What you hold, against your targets">
      <div className="port-bars" onPointerLeave={() => setPicked(null)}>
        <span className="port-bar-name">Now</span>
        <div className="port-bar now" role="group" aria-label="What you hold, by coin">
          {slices.map((s, i) => slice(s, s.share, i, true))}
        </div>
        {targeted.length > 0 && (
          <>
            <span className="port-bar-name">Target</span>
            <div className="port-bar target" aria-hidden="true">
              {targeted.map((s, i) => slice(s, s.target ?? 0, i, false))}
              {untargeted > 0 && <i className="port-untargeted" style={{ flexGrow: untargeted }} />}
            </div>
          </>
        )}
      </div>
      <p className="port-readout" key={picked ?? "idle"} aria-live="polite">
        {shown ? read(shown) : idle}
      </p>
    </section>
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
  const [drift, setDrift] = useState<Drift | null>(null);

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
      // The targets move with prices, so they're read with the balances.
      getDrift().then(setDrift, () => setDrift(null));
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
  const valueOf = (where: Holding["source"]) =>
    (data?.holdings ?? [])
      .filter((h) => h.source === where)
      .reduce((s, h) => s + Number(h.value ?? 0), 0);
  const held = data?.holdings.filter((h) => !isDust(h)) ?? [];
  const shown = held.filter((h) => source === "all" || h.source === source);
  const sum = data ? totals(data, source) : null;
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

      {data && sum ? (
        <>
          <Hero
            data={data}
            source={source}
            sum={sum}
            m={m}
            accounts={{ binance: valueOf("Binance"), wallet: valueOf("TAO wallet") }}
          />
          <Strip holdings={shown} drift={source === "all" ? drift : null} m={m} />
          <div className="port-pair">
            {source === "all" && <DriftCard drift={drift} />}
            <Deposits />
          </div>
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
