// The DCA book's pictures (TODO 11): the Plan, the plan to date's money with the 3-year plan's
// progress under it, and for the Positions table each coin's plan to date and its price strip in
// small (the cards are gone, 21 Nov 2026: the table carries the strip as its Limits column).
import type { ReactNode } from "react";
import { FoldHead, useFold } from "./Fold";
import { isOpen, roundPrice, wholeDollars } from "./dcaFormat";
import type { DcaBook, DcaPosition } from "./types";

// A colour per coin, for the Mix and a card's top edge; others take the palette in order.
const BRAND: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#8A92B2",
  SOL: "#9945FF",
  ZEC: "#F4B728",
  HYPE: "#5FE0C8",
};
const SPARE = ["#50D2C1", "#E8B04B", "#6C9EF8", "#E07AB8", "#9BC26B"];
// A coin's colour outside the DCA book (the Trade page's cards): its brand, else a spare.
export function colourOf(coin: string, i: number): string {
  return BRAND[coin] ?? SPARE[i % SPARE.length] ?? "#50D2C1";
}

export function coinColour(book: DcaBook, coin: string): string {
  if (BRAND[coin]) return BRAND[coin];
  const others = book.positions.map((p) => p.coin).filter((c) => !BRAND[c]);
  return SPARE[Math.max(0, others.indexOf(coin)) % SPARE.length] ?? "#50D2C1";
}

// A coin against its plan to date (decision 96): bought, what waits in open limits from any
// week, and what has no order yet, all the api's own counts (under 10 is rounding).
export function coinWeekOf(book: DcaBook, coin: string) {
  const st = book.week.state;
  return {
    quota: Number(st.plannedByCoin[coin] ?? 0),
    bought: Number(st.boughtByCoin[coin] ?? 0),
    open: Number(st.waitingByCoin[coin] ?? 0),
    toPlace: Number(st.toPlaceByCoin[coin] ?? 0),
  };
}

// The plan to date as a bar: bought, then open limits, against what's due so far.
export function WeekBar({ book, coin }: { book: DcaBook; coin: string }) {
  const w = coinWeekOf(book, coin);
  if (!(w.quota > 0)) return <span className="muted">Not in the plan</span>;
  const of = (n: number) => `${Math.min(100, (n / w.quota) * 100)}%`;
  return (
    <span
      className="dcb-week num"
      role="img"
      aria-label={`Plan to date: ${wholeDollars(w.bought)} bought and ${wholeDollars(w.open)} in open limits of ${wholeDollars(w.quota)}; ${wholeDollars(w.toPlace)} with no order yet.`}
    >
      <span className="dcb-week-figs">
        <b>{wholeDollars(w.bought)}</b>
        {w.open > 0 && <span className="wait"> + {wholeDollars(w.open)}</span>}
        <span className="muted"> of {wholeDollars(w.quota)}</span>
      </span>
      <span className="dcb-week-bar" aria-hidden="true">
        <i className="is-bought" style={{ width: of(w.bought) }} />
        <i className="is-limits" style={{ width: of(w.open) }} />
      </span>
      <small className={w.toPlace >= 10 ? "" : "is-done"}>
        {w.toPlace >= 10 ? `${wholeDollars(w.toPlace)} still to place` : "All placed"}
      </small>
    </span>
  );
}

// The Plan (decision 96): the plan to date's money as one bar, bought, in open limits and with
// no order yet, the same split as the Dashboard's Weekly DCA; a line only when something needs
// doing; and the 3-year plan's progress. The held split by value is left out: for a DCA that
// buys a fixed split it only shows which limits filled first.
// The plan's length from its weeks: "3-year plan" on whole years, else "59-week plan".
const planLength = (weeks: number) =>
  weeks % 52 === 0 ? `${weeks / 52}-year plan` : `${weeks}-week plan`;

// actions: Buy this week and Edit, on the panel's head (owner, 21 Nov 2026).
export function PlanPanel({ book, actions }: { book: DcaBook; actions?: ReactNode }) {
  const [open, toggle] = useFold("dcb-plan");
  const st = book.week.state;
  const planned = Number(st.planned);
  const bought = Number(st.bought);
  const waiting = Number(st.waiting);
  const toPlace = Number(st.toPlace);
  const deposit = Number(st.needsDeposit);
  const whole = Math.max(planned, bought + waiting + toPlace) || 1;
  const of = (n: number) => `${Math.min(100, (n / whole) * 100)}%`;
  const short = Object.entries(st.toPlaceByCoin).filter(([, v]) => Number(v) >= 10);
  const words = [
    short.length
      ? `${short.map(([c, v]) => `${c} ${wholeDollars(v)}`).join(", ")} still to place.`
      : "",
    deposit > 0 ? `${wholeDollars(deposit)} waits for a deposit.` : "",
    st.skipped ? "This week is skipped." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const p = book.progress;
  return (
    <section className={`dcb-mixp${open ? "" : " is-folded"}`} aria-labelledby="dcb-plan-title">
      <div className="dcb-mixp-head">
        <FoldHead
          id="dcb-plan"
          open={open}
          onToggle={toggle}
          title="Plan"
          summary={`${p ? `Week ${p.week} of ${p.weeks} · ` : ""}${wholeDollars(bought)} of ${wholeDollars(planned)} bought`}
        />
        {actions && <span className="dcb-plan-actions">{actions}</span>}
      </div>
      {open && (
        <div id="dcb-plan-body">
          <div
            className="dcb-plan-bar"
            role="img"
            aria-label={`${wholeDollars(bought)} bought, ${wholeDollars(waiting)} in open limits and ${wholeDollars(toPlace)} with no order yet, of ${wholeDollars(planned)} planned to date.`}
          >
            <i className="is-bought" style={{ width: of(bought) }} />
            <i className="is-limits" style={{ width: of(waiting) }} />
          </div>
          <dl className="dcb-plan-figs num">
            <div>
              <dt>
                <i className="is-bought" /> Bought
              </dt>
              <dd>{wholeDollars(bought)}</dd>
            </div>
            <div>
              <dt>
                <i className="is-limits" /> In open limits
              </dt>
              <dd>{wholeDollars(waiting)}</dd>
            </div>
            <div>
              <dt>
                <i /> No order yet
              </dt>
              <dd>{wholeDollars(toPlace)}</dd>
            </div>
          </dl>
          {words && <p className="dcb-plan-say">{words}</p>}
          {p && (
            <div className="dcb-plan3 num">
              <span>{planLength(p.weeks)}</span>
              <span className="dcb-plan3-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${Number(p.planTotal) > 0 ? Math.min(100, (Number(p.onPlan) / Number(p.planTotal)) * 100) : 0}%`,
                  }}
                />
              </span>
              <span>
                {wholeDollars(p.onPlan)} of {wholeDollars(p.planTotal)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// A position's price strip in small: the gap between average and now, filled buys, open limits.
export function Strip({ book, pos }: { book: DcaBook; pos: DcaPosition }) {
  const held = Number(pos.qty);
  const avg = Number(pos.avgCost);
  if (!(held > 0) || !(avg > 0) || pos.value === null) {
    return <div className="dcb-cstrip is-empty">No price yet</div>;
  }
  const now = Number(pos.value) / held;
  const mine = book.orders.filter((o) => o.coin === pos.coin && o.side === "buy");
  const filled = mine
    .filter((o) => o.status === "filled" && o.avgPrice)
    .map((o) => Number(o.avgPrice));
  const open = mine.filter((o) => isOpen(o) && Number(o.price) > 0).map((o) => Number(o.price));
  const all = [avg, now, ...filled, ...open];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || hi * 0.02;
  const at = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;
  const up = now >= avg;
  return (
    <div className="dcb-cstrip">
      <div className="dcb-cstrip-line" aria-hidden="true">
        <span
          className={`dcb-cstrip-gap ${up ? "is-up" : "is-down"}`}
          style={{
            left: at(Math.min(avg, now)),
            width: `calc(${at(Math.max(avg, now))} - ${at(Math.min(avg, now))})`,
          }}
        />
        {open.map((p, i) => (
          <span key={`o${i}`} className="dcb-cstrip-lim" style={{ left: at(p) }} />
        ))}
        {filled.map((p, i) => (
          <span key={`f${i}`} className="dcb-cstrip-buy" style={{ left: at(p) }} />
        ))}
        <span className="dcb-cstrip-avg" style={{ left: at(avg) }} />
        <span className="dcb-cstrip-now" style={{ left: at(now) }} />
      </div>
      <div className="dcb-cstrip-key num">
        {up ? (
          <>
            <span>
              Avg <b>{roundPrice(avg)}</b>
            </span>
            <span className="is-now">
              Now <b>{roundPrice(now)}</b>
            </span>
          </>
        ) : (
          <>
            <span className="is-now">
              Now <b>{roundPrice(now)}</b>
            </span>
            <span>
              Avg <b>{roundPrice(avg)}</b>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
