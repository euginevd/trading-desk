// One trade of the pot in a panel from the right (docs/plan-trade.md): where it stands, its
// figures, every Binance order it has had, and what can be done to it: cancel an unfilled
// entry, move the stop toward profit, or close at market. Closes on Esc, a click outside, Done.
import { useEffect, useRef, useState } from "react";
import { cancelPotTrade, closePotTrade, movePotStop } from "./api";
import CoinIcon from "./CoinIcon";
import { dated, dollars, qty } from "./dcaFormat";
import type { PotTrade } from "./types";

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// A price as Binance has it: every decimal the pair uses, at least two.
export function px(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

export const rWord = (r: string | null) => {
  if (r === null) return "—";
  const n = Number(r);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
};
export const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");
export const rr = (t: { entry: string; stop: string; target: string }) => {
  const risk = Number(t.entry) - Number(t.stop);
  return risk > 0 ? ((Number(t.target) - Number(t.entry)) / risk).toFixed(1) : "—";
};

const ROLE: Record<PotTrade["orders"][number]["role"], string> = {
  entry: "Entry, limit buy",
  exit: "Exit, OCO: stop and target as one",
  close: "Close, market sell",
};
const STATE: Record<PotTrade["orders"][number]["status"], string> = {
  placing: "Placing",
  open: "On Binance",
  filled: "Filled",
  cancelled: "Cancelled",
};

export default function PotPanel({
  trade,
  onClose,
  onChanged,
}: {
  trade: PotTrade;
  onClose: () => void;
  onChanged: (said: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [stop, setStop] = useState(trade.stop);
  const [ask, setAsk] = useState<"close" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  const open = trade.status === "open";
  const waiting = trade.status === "waiting" || trade.status === "placing";
  const n = Number(trade.result ?? 0);
  const higher = Number(stop) > Number(trade.stop) && Number(stop) < Number(trade.now ?? Infinity);

  const act = (run: () => Promise<PotTrade>, said: (t: PotTrade) => string) => {
    setBusy(true);
    setError(null);
    run().then(
      (t) => {
        setBusy(false);
        setAsk(null);
        onChanged(said(t));
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "That didn't go through."));
      },
    );
  };

  return (
    <dialog ref={dialog} className="dcb-drawer" aria-labelledby="pot-panel-title" onClose={onClose}>
      <header className="dcb-drawer-head">
        <h2 id="pot-panel-title">
          <span className="dcb-coin">
            <CoinIcon coin={trade.coin} />
            {trade.coin}, {trade.setup}
          </span>
        </h2>
        <small className="dcb-id">
          {trade.ref}, opened {dated(trade.created, true)}
          {trade.regime ? `, ${trade.regime} market` : ""}
        </small>
        <button type="button" className="link dcb-drawer-close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="dcb-drawer-figures">
        <div>
          <small>Now</small>
          <b className="num">{px(trade.now)}</b>
        </div>
        <div>
          <small>{trade.status === "closed" ? "Result" : "Result so far"}</small>
          <b className={`num ${tone(n)}`}>
            {waiting ? "Entry waiting" : rWord(trade.r)}
            {!waiting && trade.result !== null && (
              <span className="dcb-drawer-pct"> {dollars(trade.result, true)}</span>
            )}
          </b>
        </div>
      </div>
      <dl className="dcb-drawer-facts">
        <div>
          <dt>Entry, stop, target</dt>
          <dd className="num">
            {px(trade.fillPrice ?? trade.entry)}, <span className="down">{px(trade.stop)}</span>,{" "}
            <span className="up">{px(trade.target)}</span>
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd className="num">
            {dollars(trade.spend)}{" "}
            <span className="muted">
              ({qty(trade.qty)} {trade.coin})
            </span>
          </dd>
        </div>
        <div>
          <dt>At risk</dt>
          <dd className="num">{dollars(trade.risk)}</dd>
        </div>
        <div>
          <dt>Reward to risk</dt>
          <dd className="num">{rr(trade)} : 1</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd className="num">{dollars(trade.fees)}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>{trade.rulesKept ? "All kept" : "One broken"}</dd>
        </div>
      </dl>

      <h3 className="dcb-drawer-sub">Orders</h3>
      <div className="dcb-scroll">
        <table className="dcb-table" aria-label={`${trade.ref} orders`}>
          <thead>
            <tr>
              <th>Binance tag</th>
              <th>What</th>
              <th className="r">Price</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {trade.orders.map((o) => (
              <tr key={o.ref}>
                <td className="dcb-id">{o.ref}</td>
                <td>{ROLE[o.role]}</td>
                <td className="r num">
                  {o.kind === "oco"
                    ? `${px(o.stop)} / ${px(o.price)}`
                    : o.kind === "market"
                      ? "Market"
                      : px(o.price)}
                </td>
                <td>
                  <span className={`dcb-tag is-${o.status}`}>{STATE[o.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trade.reason && <p className="muted pot-why">Why: {trade.reason}</p>}
      {trade.note && <p className="dcb-warn">{trade.note}</p>}

      {open && (
        <form
          className="pot-stop"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => movePotStop(trade.ref, stop),
              (t) => `${t.ref}: stop moved to ${px(t.stop)}.`,
            );
          }}
        >
          <label>
            <span>New stop</span>
            <input
              className="dcb-num"
              inputMode="decimal"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              aria-label={`${trade.ref} new stop`}
            />
          </label>
          <button type="submit" className="btn" disabled={!higher || busy}>
            Move stop
          </button>
          <small className="muted">
            Only toward profit: above {px(trade.stop)}, below the price now.
          </small>
        </form>
      )}

      {ask && (
        <div className="alert" role="alert">
          <span>
            {ask === "close"
              ? `Sell all ${trade.coin} in ${trade.ref} at market now? Its stop and target are cancelled first.`
              : `Cancel the entry of ${trade.ref}? Nothing has filled yet.`}
          </span>
          <button
            type="button"
            className={`btn btn-small ${ask === "close" ? "btn-danger" : ""}`}
            disabled={busy}
            onClick={() =>
              ask === "close"
                ? act(
                    () => closePotTrade(trade.ref),
                    (t) => `${t.ref} closed at market.`,
                  )
                : act(
                    () => cancelPotTrade(trade.ref),
                    (t) => `${t.ref} cancelled.`,
                  )
            }
          >
            {ask === "close" ? "Close at market" : "Cancel the entry"}
          </button>
          <button type="button" className="btn btn-small" onClick={() => setAsk(null)}>
            Keep it
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="dlg-btns">
        {open && (
          <button type="button" className="btn btn-danger pot-left" onClick={() => setAsk("close")}>
            Close at market
          </button>
        )}
        {waiting && (
          <button type="button" className="btn pot-left" onClick={() => setAsk("cancel")}>
            Cancel entry
          </button>
        )}
        <button type="button" className="btn btn-accent" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
