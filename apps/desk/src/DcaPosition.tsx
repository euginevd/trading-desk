// One position of the DCA book in a panel from the right (TODO 11): its value and P&L, its
// facts, its share against its target, and every order it has had. The book page and the
// Dashboard open the same panel; it closes on Esc, a click outside it, or Done.
import { useEffect, useRef, useState, type ReactNode } from "react";
import CoinIcon from "./CoinIcon";
import {
  dollars,
  day,
  limit,
  qty,
  signed,
  two,
  SOURCE_WHY,
  isOpen,
  STATUS,
  amountOf,
  roundPrice,
  wholeDollars,
} from "./dcaFormat";
import { Live } from "./Figures";
import type { DcaBook, DcaOrder, DcaPosition } from "./types";

// The orders, read only: the book page passes its own table, with Cancel and Buy back. Away is how
// far an open limit sits under the price; Source and Quantity stay in the book's own table.
function Orders({
  orders,
  quote,
  label,
  now,
}: {
  orders: DcaOrder[];
  quote: string;
  label: string;
  now: number | null;
}) {
  return (
    <div className="dcb-scroll">
      <table className="dcb-table" aria-label={label}>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Placed</th>
            <th className="r">Price</th>
            <th className="r">Away</th>
            <th className="r">{quote}</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const away =
              now && o.kind === "limit" && isOpen(o) && Number(o.price) > 0
                ? (Number(o.price) / now - 1) * 100
                : null;
            return (
              <tr key={o.ref}>
                <td className="dcb-id" title={SOURCE_WHY[o.source]}>
                  {o.ref}
                </td>
                <td className="num">{day(o.created)}</td>
                <td className="r num">
                  {o.avgPrice ? limit(o.avgPrice) : o.kind === "market" ? "Market" : limit(o.price)}
                </td>
                <td className="r num dcb-away">{away === null ? "" : `${signed(away)}%`}</td>
                <td className={`r num ${o.side === "sell" ? "down" : ""}`}>
                  {o.side === "sell" ? "−" : ""}
                  {two(amountOf(o))}
                </td>
                <td>
                  <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Where the price stands: Now and the average above the line with the gap between them shaded,
// every buy that filled on it, and each open limit under it with how far it is and what it buys.
// A sentence says what it means.
function PriceStrip({ pos, orders }: { pos: DcaPosition; orders: DcaOrder[] }) {
  const held = Number(pos.qty);
  const avg = Number(pos.avgCost);
  if (!(held > 0) || !(avg > 0) || pos.value === null) return null;
  const now = Number(pos.value) / held;
  const filled = orders
    .filter((o) => o.side === "buy" && o.status === "filled" && o.avgPrice)
    .map((o) => Number(o.avgPrice));
  const open = orders
    .filter((o) => o.side === "buy" && (o.status === "open" || o.status === "placing") && o.price)
    .map((o) => ({ price: Number(o.price), spend: Number(amountOf(o)) }));
  const all = [avg, now, ...filled, ...open.map((o) => o.price)];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || hi * 0.02;
  const span = hi - lo + 2 * pad;
  const pos100 = (v: number) => ((v - (lo - pad)) / span) * 100;
  const at = (v: number) => `${pos100(v)}%`;
  const gap = (now / avg - 1) * 100;
  const below = (p: number) => (1 - p / now) * 100;
  // Each open limit's price under the line, closest first; layered orders at one price share a
  // label (×2), and a label too close to one already placed is left to the sentence.
  const levels = [...new Set(open.map((o) => o.price))].sort((a, b) => b - a);
  const labels: { price: number; count: number; spend: number }[] = [];
  for (const p of levels) {
    if (labels.some((l) => Math.abs(l.price - p) / span < 0.2)) continue;
    const here = open.filter((o) => o.price === p);
    labels.push({ price: p, count: here.length, spend: here.reduce((s, o) => s + o.spend, 0) });
  }
  const closest = levels[0];
  const first = closest === undefined ? null : open.filter((o) => o.price === closest);
  const words = [
    `Price is ${Math.abs(gap).toFixed(1)}% ${gap >= 0 ? "over" : "under"} your average.`,
    first && closest !== undefined && closest < now
      ? `Your ${open.length > 1 ? "closest limit buys" : "limit buys"} ${dollars(first.reduce((s, o) => s + o.spend, 0))} more if it falls another ${below(closest).toFixed(1)}%.`
      : open.length
        ? `${open.length} open ${open.length === 1 ? "limit waits" : "limits wait"}.`
        : "No open limits.",
  ].join(" ");
  const gapWide = Math.abs(pos100(avg) - pos100(now)) > 10;
  return (
    <figure className={`dcb-ps ${labels.length ? "has-limits" : ""}`} aria-label={words}>
      <div className="dcb-ps-line" aria-hidden="true">
        <span
          className={`dcb-ps-gap ${gap >= 0 ? "is-up" : "is-down"}`}
          style={{
            left: at(Math.min(avg, now)),
            width: `calc(${at(Math.max(avg, now))} - ${at(Math.min(avg, now))})`,
          }}
        >
          {gapWide && `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}%`}
        </span>
        {filled.map((p, i) => (
          <span key={`f${i}`} className="dcb-ps-buy" style={{ left: at(p) }} />
        ))}
        {open.map((o, i) => (
          <span key={`o${i}`} className="dcb-ps-open" style={{ left: at(o.price) }} />
        ))}
        {labels.map((l) => (
          <span key={`l${l.price}`} className="dcb-ps-limit" style={{ left: at(l.price) }}>
            <b className="num">{roundPrice(l.price)}</b>
            <small className="num">
              {l.price < now ? `−${below(l.price).toFixed(1)}% · ` : ""}
              {dollars(l.spend)} {l.count > 1 ? `in ${l.count} limits` : "limit"}
            </small>
          </span>
        ))}
        <span className="dcb-ps-mark is-avg" style={{ left: at(avg) }}>
          <small>Average</small>
          <b className="num">{roundPrice(avg)}</b>
        </span>
        <span className="dcb-ps-mark is-now" style={{ left: at(now) }}>
          <small>Now</small>
          <b className="num">{roundPrice(now)}</b>
        </span>
      </div>
      <figcaption>
        <span className="dcb-ps-say">{words}</span>
        <span className="dcb-ps-key" aria-hidden="true">
          <i className="dcb-ps-buy" /> filled buy <i className="dcb-ps-open" /> open limit
        </span>
      </figcaption>
    </figure>
  );
}

export default function PositionDrawer({
  book,
  coin,
  onClose,
  onTrim,
  renderOrders,
  orders,
  footer,
}: {
  book: DcaBook;
  coin: string;
  onClose: () => void;
  onTrim?: (position: DcaPosition) => void;
  renderOrders?: (orders: DcaOrder[], label: string) => ReactNode;
  orders?: ReactNode; // the coin's whole Orders tool, in place of the simple list
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const pos = book.positions.find((x) => x.coin === coin);
  const mine = book.orders.filter((o) => o.coin === coin);
  // The orders list opens on what's still working; All shows filled and cancelled too.
  const waiting = mine.filter((o) => o.status === "open" || o.status === "placing");
  const [show, setShow] = useState<"open" | "all">(waiting.length > 0 ? "open" : "all");
  const listed = show === "open" ? waiting : mine;
  const plan = book.plan?.orders ?? [];
  const all = plan.reduce((s, o) => s + Number(o.spend), 0) || 1;
  const target =
    (plan.filter((o) => o.coin === coin).reduce((s, o) => s + Number(o.spend), 0) * 100) / all;
  const value = book.positions.reduce((s, x) => s + Number(x.value ?? 0), 0);
  const share = value > 0 && pos ? (Number(pos.value ?? 0) * 100) / value : 0;
  // The share bar's scale: the larger of the two with room past it, so a small target still reads.
  const scale = Math.min(100, Math.max(share, target) * 1.25) || 1;
  const n = Number(pos?.pnl ?? 0);
  const label = `${coin} orders`;

  return (
    <dialog
      ref={dialog}
      className={`dcb-drawer${orders ? " is-wide" : ""}`}
      aria-labelledby="dcb-drawer-title"
      onClose={onClose}
    >
      {pos && (
        <>
          <header className="dcb-drawer-head">
            <h2 id="dcb-drawer-title">
              <span className="dcb-coin">
                <CoinIcon coin={coin} />
                {coin}
              </span>
            </h2>
            <small className="dcb-id">
              {pos.id}
              {pos.since ? `, since ${day(pos.since, true)}` : ", nothing bought yet"}
            </small>
            <button type="button" className="link dcb-drawer-close" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="dcb-drawer-figures">
            <div>
              <small>Value</small>
              <b className="num">
                <Live value={pos.value}>{dollars(pos.value)}</Live>
              </b>
            </div>
            <div>
              <small className="num">P&amp;L on {dollars(pos.added)} added</small>
              <b className={`num ${n > 0 ? "up" : n < 0 ? "down" : ""}`}>
                <Live value={pos.pnl}>{dollars(pos.pnl, true)}</Live>
                {pos.pnlPct !== null && (
                  <span className="dcb-drawer-pct"> ({signed(pos.pnlPct)}%)</span>
                )}
              </b>
            </div>
          </div>
          <PriceStrip pos={pos} orders={mine} />
          <dl className="dcb-drawer-facts">
            <div>
              <dt>Quantity</dt>
              <dd className="num">
                {qty(pos.qty)} {coin}
              </dd>
            </div>
            <div>
              <dt>Average cost</dt>
              <dd className="num">
                {roundPrice(pos.avgCost)}
                <small className="muted">A{wholeDollars(pos.avgCostAud)}</small>
              </dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd className="num">{dollars(pos.fees)}</dd>
            </div>
            <div>
              <dt>Realised on trims</dt>
              <dd className="num">{Number(pos.realised) ? dollars(pos.realised, true) : "—"}</dd>
            </div>
          </dl>
          <div className="dcb-share num">
            <div className="dcb-share-row">
              <span>Share of the book</span>
              <span>
                <b>{Math.round(share)}%</b> of a {Math.round(target * 10) / 10}% target
              </span>
            </div>
            <div
              className="dcb-share-bar"
              role="img"
              aria-label={`${Math.round(share)}% of the book, against a ${Math.round(target * 10) / 10}% target.`}
            >
              <i style={{ width: `${(share / scale) * 100}%` }} />
              {target > 0 && <span style={{ left: `${(target / scale) * 100}%` }} />}
            </div>
          </div>
          {orders ? (
            <>
              <h3 className="dcb-drawer-sub">Orders</h3>
              {orders}
            </>
          ) : (
            <>
              <div className="dcb-drawer-orders-head">
                <h3 className="dcb-drawer-sub">Orders</h3>
                {mine.length > 0 && (
                  <div className="views" role="group" aria-label="Show orders">
                    <button
                      type="button"
                      aria-pressed={show === "open"}
                      onClick={() => setShow("open")}
                    >
                      Open {waiting.length}
                    </button>
                    <button
                      type="button"
                      aria-pressed={show === "all"}
                      onClick={() => setShow("all")}
                    >
                      All {mine.length}
                    </button>
                  </div>
                )}
              </div>
              {mine.length === 0 ? (
                <p className="muted">No orders for {coin} yet.</p>
              ) : listed.length === 0 ? (
                <p className="muted">No open orders for {coin}.</p>
              ) : renderOrders ? (
                renderOrders(listed, label)
              ) : (
                <Orders
                  orders={listed}
                  quote={book.quote}
                  label={label}
                  now={
                    Number(pos.qty) > 0 && pos.value ? Number(pos.value) / Number(pos.qty) : null
                  }
                />
              )}
            </>
          )}
          <div className="dlg-btns">
            {footer}
            {onTrim && (
              <button
                type="button"
                className="btn"
                disabled={!(Number(pos.qty) > 0)}
                onClick={() => onTrim(pos)}
              >
                Trim {coin}
              </button>
            )}
            <button type="button" className="btn btn-accent" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
