// Open orders on the DCA book, the way an exchange lists them: each order's price against the
// price now, and View (its chart), Modify (price and amount), Cancel (asks first) on each row;
// several cancelled at once by ticking them, and Dedupe to find orders at the same price.
// Binance can't change a limit in place, so Modify cancels the old order and places a new one
// under a new reference, linked to it; the book keeps both (dca_orders is append-only).
import { useEffect, useRef, useState } from "react";
import { amendDcaOrder, cancelDcaOrder, fundsOdds, getMarket } from "./api";
import { BotChart, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { SOURCE, amountOf, isOpen, limit, qty as fmtQty, two, when } from "./dcaFormat";
import type { DcaOrder, Market } from "./types";

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// What's left to spend on a buy: its amount less anything already filled.
const left = (o: DcaOrder) => Math.max(0, Number(o.spend ?? 0) - Number(o.filledQuote || 0));
const qtyOf = (o: DcaOrder) =>
  o.qty ? Number(o.qty) : Number(o.price) > 0 ? left(o) / Number(o.price) : 0;
const away = (at: number, now: number) => (now > 0 && at > 0 ? ((at - now) / now) * 100 : null);
const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

// Orders sharing a coin, side and price, oldest first: the oldest is kept by default.
function samePrice(orders: DcaOrder[]): DcaOrder[][] {
  const groups = new Map<string, DcaOrder[]>();
  for (const o of orders) {
    const key = `${o.coin}|${o.side}|${Number(o.price)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => a.created - b.created));
}

// What cancelling does, in a line the confirm shows.
function afterCancel(list: DcaOrder[], quote: string): string {
  const usd = list.reduce((s, o) => s + left(o), 0);
  const weekly = list.some((o) => o.source === "weekly" && o.side === "buy");
  return (
    `They come off Binance straight away and $${two(usd)} ${quote} is free to spend again. ` +
    "Each reference stays in the book as cancelled and is never reused; anything already filled is kept." +
    (weekly ? " A cancelled weekly limit isn't bought at market by Monday's close-out." : "")
  );
}

export default function DcaOpen({
  orders,
  quote,
  prices,
  onChanged,
}: {
  orders: DcaOrder[];
  quote: string;
  prices: Record<string, string | null>;
  onChanged: (said: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<{ ref: string; edit: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<DcaOrder[] | null>(null);
  const [deduping, setDeduping] = useState(false);
  const shown = orders.find((o) => o.ref === viewing?.ref) ?? null;
  const groups = samePrice(orders);
  const total = orders.reduce((s, o) => s + left(o), 0);
  const nowOf = (coin: string) => Number(prices[coin] ?? 0);
  const all = picked.size === orders.length && orders.length > 0;

  const toggle = (ref: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const done = (words: string) => {
    setPicked(new Set());
    setViewing(null);
    setCancelling(null);
    setDeduping(false);
    onChanged(words);
  };

  return (
    <section className="dcb-section dco" aria-labelledby="dco-title">
      <details className="dco-fold">
        <summary className="dcb-section-head">
          <h2 id="dco-title">Open orders</h2>
          <span className="muted">
            {orders.length} {orders.length === 1 ? "order" : "orders"}, ${two(total)} {quote}
          </span>
        </summary>

        <div className="dco-bar">
          <button
            type="button"
            className="btn btn-danger-quiet"
            disabled={picked.size === 0}
            onClick={() => setCancelling(orders.filter((o) => picked.has(o.ref)))}
          >
            Cancel {picked.size || ""} selected
          </button>
          <button
            type="button"
            className="btn"
            disabled={groups.length === 0}
            title={groups.length ? undefined : "No two orders share a coin and price"}
            onClick={() => setDeduping(true)}
          >
            Dedupe{groups.length ? ` (${groups.length} same price)` : ""}
          </button>
          <span className="muted">Or ask dca-agent beside the book.</span>
        </div>

        <div className="dcb-scroll">
          <table className="dcb-table dco-table" aria-label="Open orders">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select every order"
                    checked={all}
                    onChange={() => setPicked(all ? new Set() : new Set(orders.map((o) => o.ref)))}
                  />
                </th>
                <th>Order</th>
                <th className="r">Limit</th>
                <th className="r">From now</th>
                <th className="r">{quote}</th>
                <th className="r">Quantity</th>
                <th>Placed</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const off = away(Number(o.price), nowOf(o.coin));
                return (
                  <tr key={o.ref} className={picked.has(o.ref) ? "is-picked" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${o.ref}`}
                        checked={picked.has(o.ref)}
                        onChange={() => toggle(o.ref)}
                      />
                    </td>
                    <td>
                      <span className="dcb-coin">
                        <CoinIcon coin={o.coin} />
                        {o.coin}
                        <span className={`tag ${o.side === "sell" ? "sell" : "buy"}`}>
                          {o.side === "sell" ? "Sell" : "Buy"}
                        </span>
                      </span>
                      <small className="dcb-id">
                        {o.ref} · {SOURCE[o.source]}
                      </small>
                    </td>
                    <td className="r num">{limit(o.price)}</td>
                    <td className="r num muted">{pct(off)}</td>
                    <td className="r num">${two(left(o))}</td>
                    <td className="r num muted">{fmtQty(qtyOf(o).toFixed(8))}</td>
                    <td className="num muted">{when(o.created)}</td>
                    <td className="dco-acts">
                      <button
                        type="button"
                        className="link"
                        aria-label={`View ${o.ref}`}
                        onClick={() => setViewing({ ref: o.ref, edit: false })}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="link"
                        aria-label={`Modify ${o.ref}`}
                        onClick={() => setViewing({ ref: o.ref, edit: true })}
                      >
                        Modify
                      </button>
                      <button
                        type="button"
                        className="link danger"
                        aria-label={`Cancel ${o.ref}`}
                        onClick={() => setCancelling([o])}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      {shown && (
        <OrderPanel
          key={`${shown.ref}-${viewing?.edit ? "e" : "v"}`}
          order={shown}
          others={orders.filter((o) => o.coin === shown.coin && o.ref !== shown.ref)}
          quote={quote}
          editing={viewing?.edit ?? false}
          onClose={() => setViewing(null)}
          onCancel={() => setCancelling([shown])}
          onDone={done}
        />
      )}
      {cancelling && (
        <CancelDialog
          list={cancelling}
          quote={quote}
          onKeep={() => setCancelling(null)}
          onDone={done}
        />
      )}
      {deduping && (
        <DedupeDialog
          groups={groups}
          quote={quote}
          onClose={() => setDeduping(false)}
          onDone={done}
        />
      )}
    </section>
  );
}

// A modal that opens itself on mount.
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);
  return ref;
}

// Cancels each order in turn; stops at the first refusal and says which went through.
async function cancelAll(list: DcaOrder[]): Promise<{ done: number; error: string }> {
  let done = 0;
  for (const o of list) {
    try {
      await cancelDcaOrder(o.ref);
      done += 1;
    } catch (e) {
      return { done, error: `${o.ref}: ${errorOf(e, "not cancelled.")}` };
    }
  }
  return { done, error: "" };
}

const cancelledWords = (n: number) => `${n} open ${n === 1 ? "order" : "orders"} cancelled.`;

export function CancelDialog({
  list,
  quote,
  onKeep,
  onDone,
}: {
  list: DcaOrder[];
  quote: string;
  onKeep: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  const keep = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => keep.current?.focus(), []);
  const one = list.length === 1 ? list[0] : null;
  const go = async () => {
    setBusy(true);
    const r = await cancelAll(list);
    if (r.error) {
      setBusy(false);
      setError(r.done ? `${cancelledWords(r.done)} Then ${r.error}` : r.error);
      return;
    }
    onDone(cancelledWords(r.done));
  };
  return (
    <dialog ref={modal} aria-labelledby="dco-cancel" onClose={onKeep}>
      <h2 id="dco-cancel">
        {one
          ? `Cancel ${one.ref}, a ${one.coin} ${one.side} at ${limit(one.price)}?`
          : `Cancel ${list.length} open orders?`}
      </h2>
      {!one && <p className="num">{list.map((o) => o.ref).join(", ")}</p>}
      <p>{afterCancel(list, quote)}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        <button ref={keep} className="btn" type="button" onClick={onKeep}>
          Keep {one ? "order" : "them"}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void go()}>
          {busy ? "Cancelling…" : one ? "Cancel order" : `Cancel ${list.length}`}
        </button>
      </div>
    </dialog>
  );
}

function DedupeDialog({
  groups,
  quote,
  onClose,
  onDone,
}: {
  groups: DcaOrder[][];
  quote: string;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  // The oldest of each group is kept; the rest are ticked to cancel.
  const [drop, setDrop] = useState<Set<string>>(
    () => new Set(groups.flatMap((g) => g.slice(1).map((o) => o.ref))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = groups.flat().filter((o) => drop.has(o.ref));
  const go = async () => {
    setBusy(true);
    const r = await cancelAll(list);
    if (r.error) {
      setBusy(false);
      setError(r.done ? `${cancelledWords(r.done)} Then ${r.error}` : r.error);
      return;
    }
    onDone(cancelledWords(r.done));
  };
  return (
    <dialog ref={modal} className="dco-dedupe" aria-labelledby="dco-dedupe" onClose={onClose}>
      <h2 id="dco-dedupe">Orders at the same price</h2>
      <p className="muted">
        Same-price limits can be deliberate layers, so nothing goes unless you tick it. The oldest
        of each is kept to start with.
      </p>
      {groups.map((g) => (
        <fieldset key={g[0]?.ref} className="dco-group">
          <legend>
            <CoinIcon coin={g[0]?.coin ?? ""} /> {g[0]?.coin} {g[0]?.side} at {limit(g[0]?.price)}
          </legend>
          {g.map((o) => (
            <label key={o.ref} className="dco-pick">
              <input
                type="checkbox"
                checked={drop.has(o.ref)}
                onChange={() =>
                  setDrop((d) => {
                    const next = new Set(d);
                    if (next.has(o.ref)) next.delete(o.ref);
                    else next.add(o.ref);
                    return next;
                  })
                }
              />
              <span className="num">{o.ref}</span>
              <span className="num muted">
                ${two(left(o))}, {when(o.created)}
              </span>
              <span className={drop.has(o.ref) ? "error-text" : "muted"}>
                {drop.has(o.ref) ? "Cancel" : "Keep"}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {list.length > 0 && <p>{afterCancel(list, quote)}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        <button className="btn" type="button" onClick={onClose}>
          Keep all
        </button>
        <button
          className="btn btn-danger"
          type="button"
          disabled={busy || list.length === 0}
          onClick={() => void go()}
        >
          {busy ? "Cancelling…" : `Cancel ${list.length}`}
        </button>
      </div>
    </dialog>
  );
}

// One order on its coin's hourly chart: the price now, this limit and the coin's other open
// limits; Modify changes its price and amount (as USDC or quantity, kept in step). A filled or
// cancelled order opens read-only, at the price it filled at.
export function OrderPanel({
  order,
  others,
  quote,
  editing: startEditing,
  onClose,
  onCancel,
  onDone,
}: {
  order: DcaOrder;
  others: DcaOrder[];
  quote: string;
  editing: boolean;
  onClose: () => void;
  onCancel: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  const [market, setMarket] = useState<Market | null>(null);
  const [editing, setEditing] = useState(startEditing);
  const [price, setPrice] = useState(order.price ?? "");
  const [usdc, setUsdc] = useState(two(left(order)).replace(/,/g, ""));
  const [qty, setQty] = useState(
    qtyOf(order)
      .toFixed(8)
      .replace(/\.?0+$/, ""),
  );
  const [odds, setOdds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    getMarket(`${order.coin}${quote}`, "1h").then(setMarket, () => setMarket(null));
  }, [order.coin, quote]);

  const buy = order.side === "buy";
  const live = isOpen(order) && order.kind === "limit";
  const now = Number(market?.price ?? 0);
  const at = Number(editing ? price : live ? order.price : (order.avgPrice ?? order.price));
  const off = away(at, now);
  const filled = Number(order.filledQuote) > 0;
  const since = off === null ? "" : `; the price is ${pct(-off)} from there now`;
  const reaching = !live
    ? filled
      ? `${order.status === "cancelled" ? "Part filled" : "Filled"}: $${two(order.filledQuote)} at ${limit(order.avgPrice)}${since}.`
      : order.status === "cancelled"
        ? "Cancelled before anything filled."
        : "Market order, being placed."
    : off === null
      ? ""
      : buy
        ? off < 0
          ? `Fills if the price falls ${Math.abs(off).toFixed(1)}% to ${limit(at)}.`
          : "At or above the price now: it should fill straight away."
        : off > 0
          ? `Fills if the price rises ${off.toFixed(1)}% to ${limit(at)}.`
          : "At or under the price now: it should fill straight away.";
  const mine: Level = { price: at, title: order.ref, tone: buy ? "buy" : "sell" };
  const levels: Level[] = [
    mine,
    ...(editing && Number(order.price) !== at
      ? [{ price: Number(order.price), title: "Was", tone: "muted" as const }]
      : []),
    ...others.map<Level>((o) => ({ price: Number(o.price), title: o.ref, tone: "muted" })),
  ].filter((l: Level) => l.price > 0);

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
  const reOdds = () => {
    if (!(Number(price) > 0)) return;
    fundsOdds(order.coin, price, buy ? "add" : "remove").then(
      (o) => setOdds(o.pct),
      () => setOdds(null),
    );
  };
  const changed =
    price !== (order.price ?? "") || Number(usdc) !== Number(two(left(order)).replace(/,/g, ""));
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

  return (
    <dialog
      ref={modal}
      className="detail-panel dco-panel"
      aria-labelledby="dco-panel-title"
      onClose={onClose}
    >
      <div className="detail-head">
        <h2 id="dco-panel-title" className="wizard-title" style={{ margin: 0 }}>
          <CoinIcon coin={order.coin} />
          {order.coin}/{quote}
          <span className={`tag ${buy ? "buy" : "sell"}`}>{buy ? "Buy" : "Sell"} limit</span>
        </h2>
        <button
          type="button"
          className="link"
          aria-label="Close"
          onClick={() => modal.current?.close?.()}
        >
          ✕
        </button>
      </div>
      {reaching && <p className="detail-summary">{reaching}</p>}
      {market && market.candles.length > 1 ? (
        <BotChart
          candles={market.candles}
          levels={levels}
          height={260}
          label={`${order.coin} hourly candles with ${order.ref}${live ? " and the coin's other open limits" : ""}`}
        />
      ) : (
        <div className="skeleton" style={{ height: 260 }} />
      )}
      <div className="kv">
        <span className="muted">Price now · {live ? "limit" : "this order"}</span>
        <span className="num">
          {limit(market?.price ?? null)} ·{" "}
          {order.kind === "market" && !order.avgPrice ? "market" : limit(at)}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Amount · quantity</span>
        <span className="num">
          ${two(live ? left(order) : amountOf(order))} {quote} ·{" "}
          {fmtQty(filled ? order.filledQty : qtyOf(order).toFixed(8))} {order.coin}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Reference · from</span>
        <span className="num">
          {order.ref} · {SOURCE[order.source]}
          {order.link ? `, replaces ${order.link}` : ""}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Placed · filled</span>
        <span className="num">
          {when(order.created)} ·{" "}
          {Number(order.filledQuote) > 0 ? `$${two(order.filledQuote)}` : "nothing yet"}
        </span>
      </div>

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
                  onBlur={reOdds}
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
            {odds !== null && (
              <b className={odds < 75 ? "wait" : ""}>{odds}% likely to fill in 24h. </b>
            )}
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
              <button className="btn" type="button" onClick={() => setEditing(false)}>
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
    </dialog>
  );
}
