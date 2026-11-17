// One trade of the pot in a panel from the right (docs/plan-trade.md): where it stands, its
// figures, what can be done to it, its log, and every Binance order it has had. A waiting
// entry can be cancelled or bought now at market; an open trade can have its stop or target
// moved, be added to (only in profit) or reduced, or be closed at market. Every change is
// logged with its numbers, beside your own notes. Closes on Esc, a click outside, Done.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addToPotTrade,
  cancelPotTrade,
  closePotTrade,
  enterPotTradeNow,
  movePotStop,
  movePotTarget,
  notePotTrade,
  reducePotTrade,
} from "./api";
import { errorOf } from "./format";
import CoinIcon from "./CoinIcon";
import { dated, dollars, qty, when } from "./dcaFormat";
import type { PotTrade } from "./types";

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
  close: "Sell at market",
  add: "Add, market buy",
};
const STATE: Record<PotTrade["orders"][number]["status"], string> = {
  placing: "Placing",
  open: "On Binance",
  filled: "Filled",
  cancelled: "Cancelled",
};
const NOTE = { desk: "Desk", thesis: "Thesis", you: "You" } as const;
const PARTS = [25, 50, 75] as const;
type Ask = "close" | "cancel" | "now" | { reduce: number } | null;

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
  const [target, setTarget] = useState(trade.target);
  const [more, setMore] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(trade);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(false);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  const t = shown;
  const open = t.status === "open";
  const waiting = t.status === "waiting" || t.status === "placing";
  const live = open || waiting;
  const n = Number(t.result ?? 0);
  const now = Number(t.now ?? NaN);
  const higher =
    Number(stop) > Number(t.stop) && Number(stop) < (Number.isNaN(now) ? Infinity : now);
  const newTarget = Number(target) !== Number(t.target) && Number(target) > (now || 0);
  const inProfit = open && t.fillPrice !== null && now > Number(t.fillPrice);

  // An action that stays in the panel: the log and figures update in place.
  const act = (run: () => Promise<PotTrade>, said: (t: PotTrade) => string, stay = false) => {
    setBusy(true);
    setError(null);
    run().then(
      (next) => {
        setBusy(false);
        setAsk(null);
        setShown({ ...next, now: next.now ?? t.now });
        changed.current = true;
        if (!stay) onChanged(said(next));
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "That didn't go through."));
      },
    );
  };
  // However it closes, the page reads the trade again if anything changed here.
  const finish = () => {
    if (changed.current) onChanged("");
    onClose();
  };
  const submit = (e: FormEvent, go: () => void) => {
    e.preventDefault();
    go();
  };

  return (
    <dialog
      ref={dialog}
      className="dcb-drawer pnl"
      aria-labelledby="pot-panel-title"
      onClose={finish}
    >
      <header className="dcb-drawer-head">
        <h2 id="pot-panel-title">
          <span className="dcb-coin">
            <CoinIcon coin={t.coin} />
            {t.coin}, {t.setup}
          </span>
        </h2>
        <small className="dcb-id">
          {t.ref}, opened {dated(t.created, true)}
          {t.regime ? `, ${t.regime} market` : ""}
        </small>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>
      <div className="dcb-drawer-figures">
        <div>
          <small>Now</small>
          <b className="num">{px(t.now)}</b>
        </div>
        <div>
          <small>{t.status === "closed" ? "Result" : "Result so far"}</small>
          <b className={`num ${tone(n)}`}>
            {waiting ? "Entry waiting" : rWord(t.r)}
            {!waiting && t.result !== null && (
              <span className="dcb-drawer-pct"> {dollars(t.result, true)}</span>
            )}
          </b>
        </div>
      </div>
      <dl className="dcb-drawer-facts">
        <div>
          <dt>{t.fillPrice ? "Paid, stop, target" : "Entry, stop, target"}</dt>
          <dd className="num">
            {px(t.fillPrice ?? t.entry)}, <span className="down">{px(t.stop)}</span>,{" "}
            <span className="up">{px(t.target)}</span>
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd className="num">
            {dollars(t.spend)}{" "}
            <span className="muted">
              ({qty(t.qty)} {t.coin})
            </span>
          </dd>
        </div>
        <div>
          <dt>At risk (1R)</dt>
          <dd className="num">{dollars(t.risk)}</dd>
        </div>
        <div>
          <dt>Reward to risk</dt>
          <dd className="num">{rr(t)} : 1</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd className="num">{dollars(t.fees)}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>{t.rulesKept ? "All kept" : "One broken"}</dd>
        </div>
      </dl>
      {t.reason && (
        <p className="pnl-thesis">
          <small>Thesis</small> {t.reason}
        </p>
      )}
      {t.note && <p className="dcb-warn">{t.note}</p>}

      {live && (
        <section className="pnl-manage" aria-label="Manage the trade">
          {open && (
            <form
              className="pnl-row"
              onSubmit={(e) =>
                submit(e, () =>
                  act(
                    () => movePotStop(t.ref, stop),
                    (x) => `${x.ref}: stop moved to ${px(x.stop)}.`,
                    true,
                  ),
                )
              }
            >
              <label>
                <span>Stop</span>
                <input
                  className="dcb-num"
                  inputMode="decimal"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  aria-label={`${t.ref} new stop`}
                />
              </label>
              <button type="submit" className="btn btn-small" disabled={!higher || busy}>
                Move stop
              </button>
              <small className="muted">Only up: above {px(t.stop)}, under the price.</small>
            </form>
          )}
          <form
            className="pnl-row"
            onSubmit={(e) =>
              submit(e, () =>
                act(
                  () => movePotTarget(t.ref, target),
                  (x) => `${x.ref}: target moved to ${px(x.target)}.`,
                  true,
                ),
              )
            }
          >
            <label>
              <span>Target</span>
              <input
                className="dcb-num"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label={`${t.ref} new target`}
              />
            </label>
            <button type="submit" className="btn btn-small" disabled={!newTarget || busy}>
              Move target
            </button>
            <small className="muted">Above the price now.</small>
          </form>
          {open && (
            <form
              className="pnl-row"
              onSubmit={(e) =>
                submit(e, () =>
                  act(
                    () => addToPotTrade(t.ref, more),
                    (x) => `${x.ref}: added at market.`,
                    true,
                  ),
                )
              }
            >
              <label>
                <span>Add</span>
                <input
                  className="dcb-num"
                  inputMode="decimal"
                  placeholder="USDC"
                  value={more}
                  onChange={(e) => setMore(e.target.value)}
                  aria-label={`${t.ref} USDC to add`}
                />
              </label>
              <button
                type="submit"
                className="btn btn-small"
                disabled={!inProfit || !(Number(more) > 0) || busy}
              >
                Add at market
              </button>
              <small className="muted">
                {inProfit
                  ? "Risk to the stop stays within 1%."
                  : "Only while in profit: no averaging down."}
              </small>
            </form>
          )}
          {open && (
            <div className="pnl-row" role="group" aria-label="Reduce">
              <span className="pnl-label">Reduce</span>
              {PARTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setAsk({ reduce: p })}
                >
                  Sell {p}%
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {ask && (
        <div className="alert" role="alert">
          <span>
            {ask === "close"
              ? `Sell all ${t.coin} in ${t.ref} at market now? Its stop and target are cancelled first.`
              : ask === "cancel"
                ? `Cancel the entry of ${t.ref}? Nothing has filled yet.`
                : ask === "now"
                  ? `Cancel the limit at ${px(t.entry)} and buy now at market (about ${px(t.now)})? It's re-sized so risk stays within 1%, and refused if reward to risk falls under the style's minimum.`
                  : `Sell ${ask.reduce}% of ${t.coin} at market now? The stop and target go back on the rest.`}
          </span>
          <button
            type="button"
            className={`btn btn-small ${ask === "close" ? "btn-danger" : ""}`}
            disabled={busy}
            onClick={() =>
              ask === "close"
                ? act(
                    () => closePotTrade(t.ref),
                    (x) => `${x.ref} closed at market.`,
                  )
                : ask === "cancel"
                  ? act(
                      () => cancelPotTrade(t.ref),
                      (x) => `${x.ref} cancelled.`,
                    )
                  : ask === "now"
                    ? act(
                        () => enterPotTradeNow(t.ref),
                        (x) => `${x.ref}: bought at market.`,
                        true,
                      )
                    : act(
                        () => reducePotTrade(t.ref, ask.reduce),
                        (x) => `${x.ref}: sold ${ask.reduce}%.`,
                        true,
                      )
            }
          >
            {ask === "close"
              ? "Close at market"
              : ask === "cancel"
                ? "Cancel the entry"
                : ask === "now"
                  ? "Buy at market"
                  : `Sell ${ask.reduce}%`}
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

      <h3 className="dcb-drawer-sub">Log</h3>
      {t.notes.filter((x) => x.kind !== "thesis").length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <ol className="pnl-log">
          {t.notes
            .filter((x) => x.kind !== "thesis")
            .map((x, i) => (
              <li key={`${x.created}-${i}`} className={`is-${x.kind}`}>
                <small>
                  {when(x.created)} · {NOTE[x.kind]}
                </small>
                <span>{x.text}</span>
              </li>
            ))}
        </ol>
      )}
      <form
        className="pnl-note"
        onSubmit={(e) =>
          submit(e, () =>
            act(
              () =>
                notePotTrade(t.ref, note).then((x) => {
                  setNote("");
                  return x;
                }),
              () => "",
              true,
            ),
          )
        }
      >
        <input
          value={note}
          maxLength={400}
          placeholder="Add a note: what you see, what you'd do differently…"
          onChange={(e) => setNote(e.target.value)}
          aria-label={`${t.ref} note`}
        />
        <button type="submit" className="btn btn-small" disabled={!note.trim() || busy}>
          Add note
        </button>
      </form>

      <h3 className="dcb-drawer-sub">Orders</h3>
      <div className="dcb-scroll">
        <table className="dcb-table" aria-label={`${t.ref} orders`}>
          <thead>
            <tr>
              <th>Binance tag</th>
              <th>What</th>
              <th className="r">Price</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {t.orders.map((o) => (
              <tr key={o.ref}>
                <td className="dcb-id">{o.ref}</td>
                <td>
                  {o.role === "entry" && o.kind === "market" ? "Entry, market buy" : ROLE[o.role]}
                </td>
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

      <div className="dlg-btns">
        {open && (
          <button type="button" className="btn btn-danger pot-left" onClick={() => setAsk("close")}>
            Close at market
          </button>
        )}
        {waiting && (
          <>
            <button type="button" className="btn pot-left" onClick={() => setAsk("cancel")}>
              Cancel entry
            </button>
            <button type="button" className="btn" onClick={() => setAsk("now")}>
              Enter now at market
            </button>
          </>
        )}
        <button type="button" className="btn btn-accent" onClick={() => dialog.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}
