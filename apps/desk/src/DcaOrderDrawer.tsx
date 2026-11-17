// One DCA order, opened from the Orders table as a panel from the right: the coin's chart at
// 1h, 4h or 1d with this order, the coin's other open limits, its fills as markers, the average
// cost, support and resistance and the 20- and 50-day averages; then what it means (how far to
// fill, the 24-hour odds, the average cost if it fills, its share of the week, what Monday's
// close-out does with it); Modify, by typing or by dragging the limit on the chart; and the
// order's chain (what it replaced and what replaced it).
import {
  CandlestickSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { amendDcaOrder, fundsOdds, getMarket } from "./api";
import CoinIcon from "./CoinIcon";
import {
  SOURCE,
  STATUS,
  amountOf,
  isOpen,
  limit,
  qty as fmtQty,
  two,
  weeklyTotal,
  when,
} from "./dcaFormat";
import type { DcaBook, DcaOrder, Interval, Market } from "./types";

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// What's left to spend on a buy: its amount less anything already filled.
export const left = (o: DcaOrder) => Math.max(0, Number(o.spend ?? 0) - Number(o.filledQuote || 0));
export const qtyOf = (o: DcaOrder) =>
  Number(o.filledQty) > 0 && !isOpen(o)
    ? Number(o.filledQty)
    : o.qty
      ? Number(o.qty)
      : Number(o.price) > 0
        ? left(o) / Number(o.price)
        : 0;
export const away = (at: number, now: number) =>
  now > 0 && at > 0 ? ((at - now) / now) * 100 : null;
export const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
// A price typed or dragged: 2 places from 1 up, 6 under.
const tidy = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(6));

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Line {
  price: number;
  title: string;
  color: [string, string];
  style: LineStyle;
  width?: 1 | 2;
}

// Candles, the lines that matter and the fills; the order's own line can be dragged while
// modifying, and the scale always fits every line.
function OrderChart({
  candles,
  lines,
  fills,
  drag,
  label,
}: {
  candles: Market["candles"];
  lines: Line[];
  fills: { t: number; price: number; text: string }[];
  drag: { price: number; onMove: (price: number) => void } | null;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawn = useRef<IPriceLine[]>([]);
  const range = useRef<number[]>([]);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    if (!box.current) return;
    const grid = token("--line", "#1b272d");
    const made = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { color: token("--panel", "#0f171b") },
        textColor: token("--muted", "#8c9aa3"),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid, timeVisible: true },
    });
    const s = made.addSeries(CandlestickSeries, {
      upColor: token("--up", "#2ebd85"),
      downColor: token("--down", "#f0616d"),
      wickUpColor: token("--up", "#2ebd85"),
      wickDownColor: token("--down", "#f0616d"),
      borderVisible: false,
      autoscaleInfoProvider: (
        base: () => { priceRange: { minValue: number; maxValue: number } } | null,
      ) => {
        const found = base();
        if (!found || range.current.length === 0) return found;
        return {
          ...found,
          priceRange: {
            minValue: Math.min(found.priceRange.minValue, ...range.current),
            maxValue: Math.max(found.priceRange.maxValue, ...range.current),
          },
        };
      },
    });
    series.current = s;
    markers.current = createSeriesMarkers(s, []);
    chart.current = made;

    // Dragging the order's line: grab it within 8px, move it, let go.
    const el = box.current;
    let dragging = false;
    const near = (y: number) => {
      const d = dragRef.current;
      const at = d ? s.priceToCoordinate(d.price) : null;
      return at !== null && Math.abs(at - y) <= 8;
    };
    const yOf = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top;
    const down = (e: PointerEvent) => {
      if (!dragRef.current || !near(yOf(e))) return;
      dragging = true;
      el.setPointerCapture?.(e.pointerId);
      made.applyOptions({ handleScroll: false, handleScale: false });
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!dragging) {
        el.style.cursor = d && near(yOf(e)) ? "ns-resize" : "";
        return;
      }
      const price = s.coordinateToPrice(yOf(e));
      if (d && price !== null && price > 0) d.onMove(Number(tidy(price)));
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      made.applyOptions({ handleScroll: true, handleScale: true });
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      made.remove();
      chart.current = null;
      series.current = null;
      markers.current = null;
      drawn.current = [];
    };
  }, []);

  useEffect(() => {
    const at = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
    series.current?.setData(
      candles.map((c) => ({ time: at(c.t), open: +c.o, high: +c.h, low: +c.l, close: +c.c })),
    );
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    // A fill sits on the candle it happened in; older than the chart, it's left out.
    const first = candles[0]?.t ?? Infinity;
    const placed: SeriesMarker<Time>[] = fills
      .filter((f) => f.t >= first)
      .map((f) => {
        const bar = [...candles].reverse().find((c) => c.t <= f.t) ?? candles[0];
        return {
          time: Math.floor((bar?.t ?? f.t) / 1000) as UTCTimestamp,
          position: "belowBar" as const,
          shape: "arrowUp" as const,
          color: token("--up", "#2ebd85"),
          text: f.text,
        };
      })
      .sort((a, b) => Number(a.time) - Number(b.time));
    markers.current?.setMarkers(placed);
  }, [fills, candles]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const l of drawn.current) s.removePriceLine(l);
    drawn.current = lines.map((l) =>
      s.createPriceLine({
        price: l.price,
        color: token(...l.color),
        lineWidth: l.width ?? 1,
        lineStyle: l.style,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
    range.current = lines.map((l) => l.price);
    chart.current?.applyOptions({});
  }, [lines]);

  return (
    <div
      ref={box}
      className={`bot-chart dco-chart ${drag ? "is-dragging" : ""}`}
      role="img"
      aria-label={label}
    />
  );
}

// The order it replaced, back to the first, and what replaced it, oldest first.
function chainOf(order: DcaOrder, all: DcaOrder[]): DcaOrder[] {
  const byRef = new Map(all.map((o) => [o.ref, o]));
  const back: DcaOrder[] = [];
  let at: DcaOrder | undefined = order;
  while (at?.link && at.source !== "buy-back" && at.source !== "close-out") {
    at = byRef.get(at.link);
    if (at) back.unshift(at);
  }
  const ahead: DcaOrder[] = [];
  let next = all.find((o) => o.link === order.ref && o.source === order.source);
  while (next) {
    ahead.push(next);
    const ref: string = next.ref;
    next = all.find((o) => o.link === ref && o.source === order.source);
  }
  return [...back, order, ...ahead];
}

const INTERVALS: Interval[] = ["1h", "4h", "1d"];

export default function DcaOrderDrawer({
  order,
  book,
  editing: startEditing,
  onClose,
  onCancel,
  onOpen,
  onDone,
}: {
  order: DcaOrder;
  book: DcaBook;
  editing: boolean;
  onClose: () => void;
  onCancel: () => void;
  onOpen: (ref: string) => void;
  onDone: (said: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const quote = book.quote;
  const live = isOpen(order) && order.kind === "limit";
  const buy = order.side === "buy";
  const [interval, setTf] = useState<Interval>("1h");
  const [market, setMarket] = useState<Market | null>(null);
  const [editing, setEditing] = useState(startEditing && live);
  const [price, setPrice] = useState(order.price ?? "");
  const [usdc, setUsdc] = useState(left(order).toFixed(2));
  const [qty, setQty] = useState(
    qtyOf(order)
      .toFixed(8)
      .replace(/\.?0+$/, ""),
  );
  const [odds, setOdds] = useState<{ hit: number; windows: number; pct: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let on = true;
    getMarket(`${order.coin}${quote}`, interval).then(
      (m) => on && setMarket(m),
      () => on && setMarket(null),
    );
    return () => {
      on = false;
    };
  }, [order.coin, quote, interval]);

  // The 24-hour odds of the price on show, asked again a moment after it stops changing.
  const asked = editing ? price : (order.price ?? "");
  useEffect(() => {
    if (!live || !(Number(asked) > 0)) return;
    let on = true;
    const t = window.setTimeout(() => {
      fundsOdds(order.coin, asked, buy ? "add" : "remove").then(
        (o) => on && setOdds(o),
        () => on && setOdds(null),
      );
    }, 300);
    return () => {
      on = false;
      window.clearTimeout(t);
    };
  }, [asked, live, buy, order.coin]);

  const now = Number(market?.price ?? 0);
  const at = Number(editing ? price : live ? order.price : (order.avgPrice ?? order.price));
  const off = away(at, now);
  const filled = Number(order.filledQuote) > 0;
  const spend = editing ? Number(usdc) : left(order);
  const pos = book.positions.find((p) => p.coin === order.coin);
  const others = book.orders.filter(
    (o) => o.coin === order.coin && o.ref !== order.ref && isOpen(o) && o.kind === "limit",
  );
  const fills = book.orders
    .filter((o) => o.coin === order.coin && Number(o.filledQty) > 0 && o.avgPrice)
    .map((o) => ({
      t: o.updated,
      price: Number(o.avgPrice),
      text: o.ref === order.ref ? "this" : `$${Math.round(Number(o.filledQuote))}`,
    }));

  const ind = market?.indicators;
  const ln = (
    price: number,
    title: string,
    color: [string, string],
    style: LineStyle,
    width: 1 | 2 = 1,
  ): Line => ({ price, title, color, style, width });
  const lines: Line[] = [
    ln(
      at,
      live ? (editing ? "New limit" : "This limit") : "This fill",
      ["--accent", "#50d2c1"],
      LineStyle.Solid,
      2,
    ),
    ...(editing && Number(order.price) !== at
      ? [ln(Number(order.price), "Was", ["--muted", "#8c9aa3"], LineStyle.Dotted)]
      : []),
    ...others.map((o) =>
      ln(Number(o.price), o.ref.split("-").pop() ?? "", ["--muted", "#8c9aa3"], LineStyle.Dashed),
    ),
    ...(pos?.avgCost
      ? [ln(Number(pos.avgCost), "Avg cost", ["--wait", "#e8b04b"], LineStyle.Dotted)]
      : []),
    ...(ind?.support
      ? [ln(Number(ind.support), "Support", ["--up", "#2ebd85"], LineStyle.SparseDotted)]
      : []),
    ...(ind?.resistance
      ? [ln(Number(ind.resistance), "Resistance", ["--down", "#f0616d"], LineStyle.SparseDotted)]
      : []),
    ...(ind?.sma20
      ? [ln(Number(ind.sma20), "20 avg", ["--dim", "#5e6c74"], LineStyle.LargeDashed)]
      : []),
    ...(ind?.sma50
      ? [ln(Number(ind.sma50), "50 avg", ["--dim", "#5e6c74"], LineStyle.LargeDashed)]
      : []),
  ].filter((l) => l.price > 0);

  // What it means, in a few lines.
  const reaching = !live
    ? filled
      ? `${order.status === "cancelled" ? "Part filled" : "Filled"}: $${two(order.filledQuote)} at ${limit(order.avgPrice)}${off === null ? "" : `; the price is ${pct(-off)} from there now`}.`
      : order.status === "cancelled"
        ? "Cancelled before anything filled."
        : "A market order, being placed."
    : off === null
      ? ""
      : buy
        ? off < 0
          ? `Fills if the price falls ${Math.abs(off).toFixed(1)}% to ${limit(at)}.`
          : "At or above the price now: it should fill straight away."
        : off > 0
          ? `Fills if the price rises ${off.toFixed(1)}% to ${limit(at)}.`
          : "At or under the price now: it should fill straight away.";
  const avgNow = Number(pos?.avgCost ?? 0);
  const held = Number(pos?.qty ?? 0);
  const avgAfter =
    live && buy && at > 0 && spend > 0 && held > 0 && avgNow > 0
      ? (held * avgNow + spend) / (held + spend / at)
      : null;
  const weekly = weeklyTotal(book);
  const closeOut = book.week.closeOut;
  const thisWeek = order.week === book.week.key;
  const facts: [string, string][] = [];
  if (live && odds?.pct !== null && odds?.pct !== undefined)
    facts.push([
      "Likely to fill in 24h",
      `${odds.pct}%: it got there in ${odds.hit.toLocaleString("en-AU")} of ${odds.windows.toLocaleString("en-AU")} past 24-hour windows`,
    ]);
  if (avgAfter !== null)
    facts.push([
      "Average cost if it fills",
      `${limit(avgNow)} → ${limit(avgAfter)} (${pct(((avgAfter - avgNow) / avgNow) * 100)})`,
    ]);
  if (buy && order.source === "weekly" && weekly > 0)
    facts.push([
      "Share of the week",
      `$${two(Number(order.spend))} of this week's $${two(weekly)}`,
    ]);
  else if (buy)
    facts.push(["Share of the week", `${SOURCE[order.source]}: outside the weekly plan`]);
  if (live && thisWeek)
    facts.push([
      "At Monday's close-out",
      order.source === "weekly" && buy
        ? `${when(closeOut)}: if still open, cancelled and bought at market`
        : `${when(closeOut)}: left open; only weekly limits are bought at market`,
    ]);
  if (pos && Number(pos.qty) > 0)
    facts.push([
      "Your position",
      `${fmtQty(pos.qty)} ${order.coin} at ${limit(pos.avgCost)} average`,
    ]);

  const setFromUsdc = (v: string) => {
    setUsdc(v);
    if (Number(price) > 0 && Number(v) > 0) setQty((Number(v) / Number(price)).toFixed(8));
  };
  const setFromQty = (v: string) => {
    setQty(v);
    if (Number(price) > 0 && Number(v) > 0) setUsdc((Number(v) * Number(price)).toFixed(2));
  };
  const setFromPrice = (v: string) => {
    setPrice(v);
    if (Number(v) > 0 && Number(usdc) > 0) setQty((Number(usdc) / Number(v)).toFixed(8));
  };
  const changed =
    Number(price) !== Number(order.price) || Math.abs(Number(usdc) - left(order)) >= 0.005;
  const save = () => {
    setBusy(true);
    setError("");
    amendDcaOrder({ ref: order.ref, price, spend: usdc }).then(
      (placed) => onDone(`${order.ref} cancelled; now ${placed.ref} at ${limit(placed.price)}.`),
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "Not changed."));
      },
    );
  };
  const chain = chainOf(order, book.orders);

  return (
    <dialog
      ref={dialog}
      className="dcb-drawer dco-drawer"
      aria-labelledby="dco-drawer-title"
      onClose={onClose}
    >
      <header className="dcb-drawer-head">
        <h2 id="dco-drawer-title">
          <span className="dcb-coin">
            <CoinIcon coin={order.coin} />
            {order.coin}/{quote}
          </span>
        </h2>
        <span className={`tag ${buy ? "buy" : "sell"}`}>
          {buy ? "Buy" : "Sell"} {order.kind}
        </span>
        <span className={`dcb-tag is-${order.status}`}>{STATUS[order.status]}</span>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close?.()}
        >
          Close
        </button>
      </header>
      <p className="dcb-id dco-drawer-ref">
        {order.ref} · {SOURCE[order.source]} · placed {when(order.created)}
      </p>

      <div className="dcb-drawer-figures">
        <div>
          <small>Price now</small>
          <b className="num">{limit(market?.price ?? null)}</b>
        </div>
        <div>
          <small>{live ? "Limit" : "Filled at"}</small>
          <b className="num">{order.kind === "market" && !order.avgPrice ? "Market" : limit(at)}</b>
        </div>
        <div>
          <small>{live ? "To fill" : "Since"}</small>
          <b className={`num ${live ? "" : off !== null && -off > 0 ? "up" : "down"}`}>
            {live ? pct(off) : pct(off === null ? null : -off)}
          </b>
        </div>
        <div>
          <small>{quote}</small>
          <b className="num">${two(live ? spend : amountOf(order))}</b>
        </div>
      </div>
      {reaching && <p className="detail-summary">{reaching}</p>}

      <div className="dco-chart-bar" role="group" aria-label="Chart interval">
        {INTERVALS.map((i) => (
          <button key={i} type="button" aria-pressed={interval === i} onClick={() => setTf(i)}>
            {i}
          </button>
        ))}
        {editing && <span className="muted">Drag the New limit line to move it.</span>}
      </div>
      {market && market.candles.length > 1 ? (
        <OrderChart
          candles={market.candles}
          lines={lines}
          fills={fills}
          drag={editing ? { price: Number(price), onMove: (p) => setFromPrice(String(p)) } : null}
          label={`${order.coin} ${interval} candles with ${order.ref}, the coin's other open limits, its fills and levels`}
        />
      ) : (
        <div className="skeleton dco-chart" />
      )}
      <p className="dco-legend muted">
        <span className="k k-this">{live ? "This limit" : "This fill"}</span>
        {others.length > 0 && <span className="k k-other">Other open limits</span>}
        {pos?.avgCost && <span className="k k-avg">Average cost</span>}
        <span className="k k-lvl">Support, resistance</span>
        <span className="k k-ma">20 and 50 averages</span>
        {fills.length > 0 && <span className="k k-fill">▲ Fills</span>}
      </p>

      {facts.length > 0 && (
        <dl className="dcb-drawer-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {editing && (
        <div className="order-edit">
          <div className="dco-edit">
            <div className="field">
              <label htmlFor="dco-price">Limit price</label>
              <div className="in">
                <input
                  id="dco-price"
                  className="num"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setFromPrice(e.target.value)}
                />
                <span className="muted">{quote}</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="dco-usdc">Amount</label>
              <div className="in">
                <input
                  id="dco-usdc"
                  className="num"
                  inputMode="decimal"
                  value={usdc}
                  onChange={(e) => setFromUsdc(e.target.value)}
                />
                <span className="muted">{quote}</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="dco-qty">Quantity</label>
              <div className="in">
                <input
                  id="dco-qty"
                  className="num"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setFromQty(e.target.value)}
                />
                <span className="muted">{order.coin}</span>
              </div>
            </div>
          </div>
          <div className="dca-reason">
            Binance can't change a limit in place: {order.ref} is cancelled and a new order placed
            under a new reference, linked to it. Anything already filled stays.
          </div>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {live && (
        <div className="dca-nav">
          <button className="btn btn-danger-quiet" type="button" onClick={onCancel}>
            Cancel order
          </button>
          {editing ? (
            <div className="row-actions" style={{ width: "auto" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setPrice(order.price ?? "");
                }}
              >
                Back
              </button>
              <button
                className="btn btn-accent"
                type="button"
                disabled={busy || !changed || !(Number(price) > 0) || !(Number(usdc) > 0)}
                onClick={save}
              >
                {busy ? "Changing…" : "Save changes"}
              </button>
            </div>
          ) : (
            <button className="btn btn-accent" type="button" onClick={() => setEditing(true)}>
              Modify
            </button>
          )}
        </div>
      )}

      {chain.length > 1 && (
        <section className="dco-chain" aria-labelledby="dco-chain-title">
          <h3 id="dco-chain-title">History</h3>
          <ol>
            {chain.map((o) => (
              <li key={o.ref} className={o.ref === order.ref ? "is-this" : ""}>
                {o.ref === order.ref ? (
                  <b className="num">{o.ref}</b>
                ) : (
                  <button type="button" className="link num" onClick={() => onOpen(o.ref)}>
                    {o.ref}
                  </button>
                )}
                <span className="num">{limit(o.avgPrice ?? o.price)}</span>
                <span className="num muted">${two(amountOf(o))}</span>
                <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
                <small className="muted num">{when(o.updated)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </dialog>
  );
}
