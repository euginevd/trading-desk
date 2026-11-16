// One position of the DCA book in a panel from the right (TODO 11): its value and P&L, its
// facts, its share against its target, and every order it has had. The book page and the
// Dashboard open the same panel; it closes on Esc, a click outside it, or Done.
import { useEffect, useRef, type ReactNode } from "react";
import CoinIcon from "./CoinIcon";
import { dollars, day, limit, qty, signed, two, SOURCE, STATUS, amountOf } from "./dcaFormat";
import { Live } from "./Figures";
import type { DcaBook, DcaOrder, DcaPosition } from "./types";

// The orders, read only: the book page passes its own table, with Cancel and Buy back.
function Orders({ orders, quote, label }: { orders: DcaOrder[]; quote: string; label: string }) {
  return (
    <div className="dcb-scroll">
      <table className="dcb-table" aria-label={label}>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Placed</th>
            <th>Source</th>
            <th className="r">Price</th>
            <th className="r">Quantity</th>
            <th className="r">{quote}</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.ref}>
              <td className="dcb-id">{o.ref}</td>
              <td className="num">{day(o.created)}</td>
              <td>
                <span className={`dcb-src is-${o.source}`}>{SOURCE[o.source]}</span>
              </td>
              <td className="r num">
                {o.avgPrice ? limit(o.avgPrice) : o.kind === "market" ? "Market" : limit(o.price)}
              </td>
              <td className={`r num ${o.side === "sell" ? "down" : ""}`}>
                {o.side === "sell" ? "−" : ""}
                {qty(Number(o.filledQty) > 0 ? o.filledQty : o.qty)}
              </td>
              <td className="r num">{two(amountOf(o))}</td>
              <td>
                <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PositionDrawer({
  book,
  coin,
  onClose,
  onTrim,
  renderOrders,
  footer,
}: {
  book: DcaBook;
  coin: string;
  onClose: () => void;
  onTrim?: (position: DcaPosition) => void;
  renderOrders?: (orders: DcaOrder[], label: string) => ReactNode;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const pos = book.positions.find((x) => x.coin === coin);
  const mine = book.orders.filter((o) => o.coin === coin);
  const plan = book.plan?.orders ?? [];
  const all = plan.reduce((s, o) => s + Number(o.spend), 0) || 1;
  const target =
    (plan.filter((o) => o.coin === coin).reduce((s, o) => s + Number(o.spend), 0) * 100) / all;
  const value = book.positions.reduce((s, x) => s + Number(x.value ?? 0), 0);
  const share = value > 0 && pos ? (Number(pos.value ?? 0) * 100) / value : 0;
  const n = Number(pos?.pnl ?? 0);
  const label = `${coin} orders`;

  return (
    <dialog
      ref={dialog}
      className="dcb-drawer"
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
              <small>P&amp;L on added</small>
              <b className={`num ${n > 0 ? "up" : n < 0 ? "down" : ""}`}>
                <Live value={pos.pnl}>{dollars(pos.pnl, true)}</Live>
                {pos.pnlPct !== null && (
                  <span className="dcb-drawer-pct"> ({signed(pos.pnlPct)}%)</span>
                )}
              </b>
            </div>
          </div>
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
                {limit(pos.avgCost)} <span className="muted">(A${two(pos.avgCostAud)})</span>
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd className="num">{dollars(pos.added)}</dd>
            </div>
            <div>
              <dt>Share of the book</dt>
              <dd className="num">
                {Math.round(share)}%{" "}
                <span className="muted">of {Math.round(target * 10) / 10}% target</span>
              </dd>
            </div>
            <div>
              <dt>Realised on trims</dt>
              <dd className="num">{Number(pos.realised) ? dollars(pos.realised, true) : "—"}</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd className="num">{dollars(pos.fees)}</dd>
            </div>
          </dl>
          <h3 className="dcb-drawer-sub">
            {mine.length} {mine.length === 1 ? "order" : "orders"}
          </h3>
          {mine.length === 0 ? (
            <p className="muted">No orders for {coin} yet.</p>
          ) : renderOrders ? (
            renderOrders(mine, label)
          ) : (
            <Orders orders={mine} quote={book.quote} label={label} />
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
