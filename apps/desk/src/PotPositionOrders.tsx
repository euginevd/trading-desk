// A Trading-account position's orders (owner, 21 Nov 2026: as the DCA book's coin panel): every
// buy of the position, bought, waiting, sold or cancelled, and its take-profit sells, with the
// waiting ones cancellable one at a time or together. The page-wide Orders tab moved here.
import { useEffect, useRef, useState } from "react";
import { cancelPotTrade, cancelTakeProfit } from "./api";
import CoinIcon from "./CoinIcon";
import { dollars, roundPrice, wholeDollars } from "./dcaFormat";
import { errorOf } from "./format";
import type { PotTakeProfit, PotTrade } from "./types";

type Line = {
  ref: string;
  tag: string;
  tone: string;
  price: number;
  amount: number;
  result: number | null;
  when: number;
  cancel: "buy" | "sell" | null; // what cancelling it means, while it waits
  trade: string | null; // the trade it opens, for a buy
};

const isLive = (s: string) => s === "open" || s === "placing" || s === "waiting";

export default function PotPositionOrders({
  coin,
  label,
  trades,
  sells,
  now,
  onOpen,
  onClose,
  onChanged,
}: {
  coin: string;
  label: string;
  trades: PotTrade[];
  sells: PotTakeProfit[];
  now: number | null;
  onOpen: (ref: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  const lines: Line[] = [
    ...trades.map((t): Line => {
      const waiting = t.status === "placing" || t.status === "waiting";
      return {
        ref: t.ref,
        tag:
          t.status === "open"
            ? "Bought"
            : waiting
              ? "Waiting"
              : t.status === "closed"
                ? "Sold"
                : "Cancelled",
        tone: t.status === "open" ? "is-live" : waiting ? "is-wait" : "is-done",
        price: Number(t.fillPrice ?? t.entry),
        amount: Number(t.spend),
        result: t.status === "open" || t.status === "closed" ? Number(t.result ?? 0) : null,
        when: t.filled ?? t.created,
        cancel: waiting ? "buy" : null,
        trade: t.ref,
      };
    }),
    ...sells.map((o): Line => {
      const price = Number(o.price ?? 0) || Number(o.executedQuote) / Number(o.executedQty) || 0;
      return {
        ref: o.ref,
        tag: isLive(o.status) ? "Selling" : o.status === "filled" ? "Sold" : "Cancelled",
        tone: isLive(o.status) ? "is-sell" : "is-done",
        price,
        amount:
          o.status === "filled" ? Number(o.executedQuote) : Number(o.qty) * (price || (now ?? 0)),
        result: null,
        when: o.created,
        cancel: isLive(o.status) ? "sell" : null,
        trade: null,
      };
    }),
  ].sort((a, b) => b.when - a.when);
  const live = lines.filter((l) => l.cancel !== null || l.tag === "Bought");
  const shown = show === "open" ? live : lines;
  const cancellable = shown.filter((l) => l.cancel);
  const chosen = cancellable.filter((l) => picked.has(l.ref));
  const toggle = (ref: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const cancel = (list: Line[]) => {
    setBusy(true);
    setError(null);
    Promise.allSettled(
      list.map((l) => (l.cancel === "sell" ? cancelTakeProfit(l.ref) : cancelPotTrade(l.ref))),
    ).then((done) => {
      setBusy(false);
      setPicked(new Set());
      const failed = done.filter((d) => d.status === "rejected");
      if (failed.length) {
        const first = failed[0] as PromiseRejectedResult;
        setError(errorOf(first.reason, `${failed.length} weren't cancelled.`));
      }
      onChanged();
    });
  };

  return (
    <dialog
      ref={dialog}
      className="dcb-drawer is-wide"
      aria-labelledby="ppo-title"
      onClose={onClose}
    >
      <header className="dcb-drawer-head">
        <h2 id="ppo-title">
          <span className="dcb-coin">
            <CoinIcon coin={coin} />
            {coin} orders
          </span>
        </h2>
        <small className="dcb-id">
          {label}
          {now !== null && ` · now ${roundPrice(now)}`}
        </small>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>

      <div className="dcb-drawer-orders-head">
        <div className="views" role="group" aria-label="Show orders">
          <button type="button" aria-pressed={show === "open"} onClick={() => setShow("open")}>
            Open {live.length}
          </button>
          <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>
            All {lines.length}
          </button>
        </div>
        {chosen.length > 0 && (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => cancel(chosen)}
          >
            {busy ? "Cancelling…" : `Cancel ${chosen.length} selected`}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="muted">No orders open for this position.</p>
      ) : (
        <div className="dcb-scroll">
          <table className="dcb-table cps-orders num" aria-label={`${coin} orders`}>
            <thead>
              <tr>
                <th>
                  {cancellable.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Pick every waiting order"
                      checked={chosen.length === cancellable.length}
                      onChange={(e) =>
                        setPicked(
                          e.target.checked ? new Set(cancellable.map((l) => l.ref)) : new Set(),
                        )
                      }
                    />
                  )}
                </th>
                <th>Order</th>
                <th className="r">Price</th>
                <th className="r">From now</th>
                <th className="r">Amount</th>
                <th className="r">Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const away = now && l.price ? (l.price / now - 1) * 100 : null;
                return (
                  <tr key={l.ref}>
                    <td>
                      {l.cancel && (
                        <input
                          type="checkbox"
                          aria-label={`Pick ${l.ref}`}
                          checked={picked.has(l.ref)}
                          onChange={() => toggle(l.ref)}
                        />
                      )}
                    </td>
                    <td>
                      <span className={`pot-tag ${l.tone}`}>{l.tag}</span>{" "}
                      <small className="muted">{l.ref}</small>
                    </td>
                    <td className="r">{l.price ? roundPrice(l.price) : "market"}</td>
                    <td className="r muted">
                      {l.cancel && away !== null
                        ? `fills ${Math.abs(away).toFixed(1)}% ${away > 0 ? "higher" : "lower"}`
                        : "—"}
                    </td>
                    <td className="r">{wholeDollars(String(l.amount))}</td>
                    <td
                      className={`r ${l.result === null ? "muted" : l.result >= 0 ? "up" : "down"}`}
                    >
                      {l.result === null ? "—" : dollars(String(l.result), true)}
                    </td>
                    <td className="r">
                      {l.cancel ? (
                        <button
                          type="button"
                          className="link"
                          disabled={busy}
                          onClick={() => cancel([l])}
                        >
                          Cancel
                        </button>
                      ) : l.trade ? (
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            dialog.current?.close();
                            onOpen(l.trade ?? "");
                          }}
                        >
                          Open
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
