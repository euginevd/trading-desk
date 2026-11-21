// The Dashboard's weekly DCA (TODO 11): one section for the buying window. A sentence says where
// the week stands; under it, eight days on a line with the window (Friday 7pm to Monday 7pm) as
// a mint band, now marked and each fill a dot at its time; then the plan's coins with their
// limits. It replaced the week rail and the step list, which said the same thing twice.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeOutDca, getDcaBook, skipDcaWeek } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import PositionDrawer from "./DcaPosition";
import { dated, isOpen, qty, roundPrice as price, signed, two } from "./dcaFormat";
import "./myagents.css";
import type { DcaBook, DcaOrder, DcaPosition, DcaWeekState } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const AU = "en-AU";
const SYD = "Australia/Sydney";

type Cycle = { start: number; closeOut: number; orders: DcaOrder[]; current: boolean };

// Every buy that counts toward its week, whichever button placed it (TODO 28); a buy-back
// answers its trim. The api's dca_book.WEEK_BUYS.
const WEEK_BUYS = new Set(["weekly", "named", "close-out", "desk", "imported"]);
const weekBuy = (o: DcaOrder) => o.side === "buy" && WEEK_BUYS.has(o.source);

// The cycle to show: this one while it's open or has limits waiting, else the next.
export function cycleOf(book: DcaBook, now: number): Cycle {
  const waiting = book.week.orders.some((o) => weekBuy(o) && isOpen(o));
  if (now < book.week.closeOut || waiting) {
    const { start, closeOut, orders } = book.week;
    return { start, closeOut, orders, current: true };
  }
  return { start: book.next.start, closeOut: book.next.closeOut, orders: [], current: false };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const whole = (n: number) => Math.round(n).toLocaleString("en-AU");
const boughtOf = (orders: DcaOrder[]) =>
  orders.filter(weekBuy).reduce((s, o) => s + Number(o.filledQuote), 0);

function headline(
  quote: string,
  cycle: Cycle,
  now: number,
  total: number,
  planned: number,
  state: DcaWeekState,
): string {
  const amount = `$${whole(total)} ${quote}`;
  if (now < cycle.start) {
    const days = Math.ceil((cycle.start - now) / DAY);
    const when = cycle.start - now < 12 * HOUR ? "today" : `in ${plural(days, "day")}`;
    return `Next buy ${when}: ${amount} on ${dated(cycle.start)} at 7pm.`;
  }
  const bought = Number(state.bought);
  const waiting = Number(state.waiting);
  const toPlace = Number(state.toPlace);
  if (planned > 0 && bought >= planned * 0.95)
    return `On plan: $${whole(bought)} of $${whole(planned)} bought.`;
  if (bought === 0 && waiting === 0)
    return `The buying window is open: plan this week's ${amount}.`;
  const parts = [`$${whole(bought)} of $${whole(planned)} bought`];
  if (waiting > 0) parts.push(`$${whole(waiting)} in open limits`);
  if (toPlace > 0) parts.push(`$${whole(toPlace)} with no order yet`);
  return `${parts.join(", ")}.`;
}

// A coin against its plan to date (decision 96): what's bought, what waits in open limits from
// any week and how far the closest one is from the price, else what's held. "Done" only once
// the plan to date is met, never for a starter order.
type CoinWeek = {
  target: number;
  bought: number;
  open: number;
  toPlace: number;
  done: boolean;
  limit: number | null;
  away: number | null;
  held: string | null;
  pnl: number | null;
};
function coinWeek(book: DcaBook, coin: string, position: DcaPosition | undefined): CoinWeek {
  const st = book.week.state;
  const target = Number(st.plannedByCoin[coin] ?? 0);
  const bought = Number(st.boughtByCoin[coin] ?? 0);
  const open = Number(st.waitingByCoin[coin] ?? 0);
  const done = target > 0 && bought >= target * 0.95;
  // Every open limit, from any week: the closest is the one the price reaches first.
  const limits = book.orders.filter(
    (o) =>
      o.coin === coin && o.side === "buy" && isOpen(o) && o.kind === "limit" && Number(o.price) > 0,
  );
  const held = Number(position?.qty ?? 0);
  const price = held > 0 && position?.value ? Number(position.value) / held : null;
  // The closest limit: the highest buy, the first the price reaches on the way down.
  const limit = limits.length ? Math.max(...limits.map((o) => Number(o.price))) : null;
  const away = limit !== null && price ? Math.max(0, (1 - limit / price) * 100) : null;
  const pnl =
    position?.pnlPct === null || position?.pnlPct === undefined ? null : Number(position.pnlPct);
  const toPlace = Number(st.toPlaceByCoin[coin] ?? 0);
  return {
    target,
    bought,
    open,
    toPlace,
    done,
    limit,
    away,
    held: held > 0 ? qty(position?.qty) : null,
    pnl,
  };
}

// "2 days 21 hours", "5 hours", "40 minutes".
function left(ms: number): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  if (days > 0) return `${plural(days, "day")}${hours ? ` ${plural(hours, "hour")}` : ""}`;
  if (hours > 0) return plural(hours, "hour");
  return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
}
const short = (ms: number) => {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return days > 0 ? `${days}d ${hours}h left` : `${hours || "<1"}h left`;
};

export default function DcaWidget({ now: given }: { now?: number }) {
  const [now] = useState(() => given ?? Date.now());
  // The countdown and the now mark move each minute; everything else reads the time it opened.
  const [clock, setClock] = useState(now);
  useEffect(() => {
    if (given !== undefined) return;
    const id = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [given]);
  const [book, setBook] = useState<DcaBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [openCoin, setOpenCoin] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    getDcaBook().then(
      (b) => {
        setBook(b);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "The DCA book couldn't be read."),
    );
  }, []);
  useEffect(() => load(), [load]);

  // Skip this week: its amount leaves the plan to date; open limits stay as they are.
  const skipWeek = () => {
    setClosing(true);
    skipDcaWeek(book?.week.key ?? "").then(
      () => {
        setSaid("This week is skipped: its amount is out of the plan. Open limits stay open.");
        setClosing(false);
        dialog.current?.close?.();
        load();
      },
      (e: unknown) => {
        setSaid(e instanceof Error ? e.message : "The week couldn't be skipped.");
        setClosing(false);
        dialog.current?.close?.();
      },
    );
  };
  const closeOut = () => {
    setClosing(true);
    closeOutDca(book?.week.key ?? "").then(
      (r) => {
        const bought = r.closed.length ? `Bought at market: ${r.closed.join(", ")}.` : "";
        const missed = r.missed.length ? ` Not bought: ${r.missed.join(", ")}.` : "";
        const short = Number(r.short) > 0 ? ` $${whole(Number(r.short))} waits for a deposit.` : "";
        setSaid(`${bought}${missed}${short}`.trim() || "Nothing was left to buy.");
        setClosing(false);
        dialog.current?.close?.();
        load();
      },
      (e: unknown) => {
        setSaid(e instanceof Error ? e.message : "The close-out didn't go through.");
        setClosing(false);
        dialog.current?.close?.();
      },
    );
  };

  const home = (
    <a className="dcw-home" href="#/dca-book" aria-label="Weekly DCA: open the DCA book">
      <AgentAvatar icon="dca" slug="dca-agent" />
      <h2>Weekly DCA</h2>
      <span className="dcw-agent">dca-agent</span>
    </a>
  );
  const head = <header className="dcw-head">{home}</header>;

  if (error && !book) {
    return (
      <section className="dcw" aria-label="Weekly DCA">
        {head}
        <p className="error-text" role="alert">
          {error}{" "}
          <button type="button" className="link" onClick={load}>
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (!book) return null;
  if (!book.plan) {
    return (
      <section className="dcw" aria-label="Weekly DCA">
        {head}
        <p className="dcw-line">Set your weekly plan and the desk keeps a book of every buy.</p>
        <a className="btn btn-accent dcw-start" href="#/dca-book">
          Set up the DCA book
        </a>
      </section>
    );
  }

  const cycle = cycleOf(book, now);
  const coins = book.plan.orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.coin] = (acc[o.coin] ?? 0) + Number(o.spend);
    return acc;
  }, {});
  const total = Object.values(coins).reduce((s, v) => s + v, 0);
  // Monday midnight before the window's Friday 7pm, to Tuesday midnight after its close-out.
  const from = cycle.start - 4 * DAY - 19 * HOUR;
  const to = from + 8 * DAY;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - from) / (to - from)) * 100));
  const at = (t: number) => `${pct(t)}%`;
  const inside = now >= cycle.start && now <= cycle.closeOut;
  const state = book.week.state;
  const placed = cycle.orders.some(weekBuy);
  // Something to buy the rest of: limits waiting, or the plan's share not placed yet.
  const waiting =
    cycle.current && now >= cycle.start && (state.open.length > 0 || Number(state.toPlace) > 0);
  const fills = cycle.orders.filter((o) => o.side === "buy" && Number(o.filledQty) > 0);
  const last = cycle.current ? null : boughtOf(book.week.orders);
  const today = Math.floor((now - from) / DAY);

  // The plan as a running total (decision 96): every week adds its amount; what's bought and
  // what waits in limits from any week count against it; the rest has no order yet.
  const planned = Number(state.planned);
  const bought = Number(state.bought);
  const limits = Number(state.waiting);
  const toPlace = Number(state.toPlace);
  const deposit = Number(state.needsDeposit);
  const live = cycle.current && planned > 0;
  const progress = live && bought + limits > 0 && bought < planned * 0.95;
  const whole3 = Math.max(planned, bought + limits + toPlace) || 1;
  const share = (n: number) => `${Math.min(100, (n / whole3) * 100)}%`;
  const remaining = cycle.closeOut - clock;
  const act = waiting ? (
    <button
      type="button"
      className="btn"
      onClick={() => {
        dialog.current?.showModal?.();
        keep.current?.focus();
      }}
    >
      Buy everything now
    </button>
  ) : !placed && inside ? (
    <a className="btn btn-accent" href="#/dca-book?plan">
      Plan this week
    </a>
  ) : null;

  return (
    <section className="dcw" aria-label="Weekly DCA">
      <header className="dcw-head">
        {home}
        <div className="dcw-act">
          {last !== null && (
            <small className="muted">
              Last week: {last > 0 ? `$${whole(last)} bought` : "nothing bought"}.
            </small>
          )}
          {act}
        </div>
      </header>

      <div className={`dcw-top${live ? " has-money" : ""}`}>
        <div>
          {progress ? (
            <p className="dcw-line dcw-lead num">
              ${whole(bought)} <span>of ${whole(planned)} bought</span>
            </p>
          ) : (
            <p className="dcw-line">{headline(book.quote, cycle, now, total, planned, state)}</p>
          )}
          {live && (
            <p className="dcw-sub">
              Plan to date: {state.weeks} {state.weeks === 1 ? "week" : "weeks"} × $
              {whole(Number(state.weekly))}.{" "}
              {state.skipped ? (
                "This week is skipped."
              ) : remaining > 0 ? (
                <>
                  Close-out in <b className="num">{left(remaining)}</b>: what has no order yet is
                  bought at market; this week's limits wait one more week.
                </>
              ) : (
                "The close-out has passed."
              )}
            </p>
          )}
        </div>
        {live && (
          <div className="dcw-money">
            <div
              className="dcw-split"
              role="img"
              aria-label={`${two(bought)} bought, ${two(limits)} in open limits, ${two(toPlace)} with no order yet, of ${whole(planned)} ${book.quote} planned to date.`}
            >
              <i className="is-bought" style={{ width: share(bought) }} />
              <i className="is-limits" style={{ width: share(limits) }} />
            </div>
            <dl className="num">
              <div>
                <dt>
                  <i className="is-bought" /> Bought
                </dt>
                <dd>${whole(bought)}</dd>
              </div>
              <div>
                <dt>
                  <i className="is-limits" /> In open limits
                </dt>
                <dd>${whole(limits)}</dd>
              </div>
              <div>
                <dt>
                  <i /> No order yet
                </dt>
                <dd>${whole(toPlace)}</dd>
              </div>
            </dl>
            {deposit > 0 && (
              <p className="dcw-deposit num">
                ${whole(deposit)} of it waits for a deposit: Binance has too little free{" "}
                {book.quote} outside the Trading account.
              </p>
            )}
          </div>
        )}
      </div>

      <div
        className="dcw-axis"
        role="img"
        aria-label={`The buying window runs from ${dated(cycle.start)} 7pm to ${dated(cycle.closeOut)} 7pm.`}
      >
        <ol className="dcw-days" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => {
            const day = new Date(from + i * DAY + 12 * HOUR);
            return (
              <li key={i} className={i === today ? "is-today" : ""}>
                <span>{day.toLocaleDateString(AU, { weekday: "short", timeZone: SYD })}</span>
                <b className="num">
                  {day.toLocaleDateString(AU, { day: "numeric", timeZone: SYD })}
                </b>
              </li>
            );
          })}
        </ol>
        <div className="dcw-track">
          <span
            className={`dcw-window${inside ? " is-open" : ""}`}
            style={{ left: at(cycle.start), width: `${pct(cycle.closeOut) - pct(cycle.start)}%` }}
          >
            {inside && (
              <>
                <span
                  className="dcw-gone"
                  style={{
                    width: `${Math.min(100, ((clock - cycle.start) / (cycle.closeOut - cycle.start)) * 100)}%`,
                  }}
                />
                {remaining > 0 && <small className="num">{short(remaining)}</small>}
              </>
            )}
          </span>
          {clock >= from && clock <= to && <span className="dcw-now" style={{ left: at(clock) }} />}
          {fills.map((o) => (
            <span key={o.ref} className="dcw-fill" style={{ left: at(o.updated) }} />
          ))}
        </div>
        <div className="dcw-marks" aria-hidden="true">
          <span style={{ left: at(cycle.start) }}>
            <b>Fri 7pm</b> deposit, then limits
          </span>
          <span className="is-end" style={{ left: at(cycle.closeOut) }}>
            <b>Mon 7pm</b> close-out
          </span>
        </div>
      </div>

      <ul className="dcw-coins" aria-label="The plan's coins against their plan to date">
        {Object.keys(coins).map((coin) => {
          const week = coinWeek(
            book,
            coin,
            book.positions.find((x) => x.coin === coin),
          );
          const usdc = week.target;
          const of = (n: number) => (usdc > 0 ? Math.min(100, (n / usdc) * 100) : 0);
          const got = of(week.bought);
          return (
            <li key={coin} className={week.done ? "is-done" : ""}>
              <button
                type="button"
                className="dcw-coin"
                aria-label={`${coin}: open its position and orders`}
                onClick={() => setOpenCoin(coin)}
              >
                <span className="dcw-coin-top">
                  <span className="dcb-coin">
                    <CoinIcon coin={coin} />
                    {coin}
                  </span>
                  <small className="num">{week.done ? "Done" : `${Math.round(got)}%`}</small>
                </span>
                <span className="num dcw-of">
                  <b>${whole(week.bought)}</b> of ${whole(usdc)}
                </span>
                <i className="dcw-bar" aria-hidden="true">
                  <span className="is-bought" style={{ width: `${got}%` }} />
                  {week.open > 0 && (
                    <span
                      className="is-limits"
                      style={{ width: `${Math.min(100 - got, of(week.open))}%` }}
                    />
                  )}
                </i>
                {week.limit !== null ? (
                  <span className="dcw-lim num">
                    <span>
                      ${whole(week.open)} limit at <b>{price(String(week.limit))}</b>
                    </span>
                    {week.away !== null && <span>{week.away.toFixed(1)}% away</span>}
                  </span>
                ) : week.held ? (
                  <span className="dcw-lim num">
                    <span>
                      {week.held} {coin}
                    </span>
                    {week.pnl !== null && (
                      <span className={week.pnl > 0 ? "up" : week.pnl < 0 ? "down" : ""}>
                        {signed(week.pnl)}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="dcw-lim">Nothing held yet</span>
                )}
                {/* The coin's plan to date with no order on it yet (under 10 is rounding). */}
                {live && week.toPlace >= 10 && (
                  <span className="dcw-left num">${whole(week.toPlace)} still to place</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {said && (
        <p className="muted dcw-said" role="status">
          {said}
        </p>
      )}

      {openCoin && (
        <PositionDrawer
          key={openCoin}
          book={book}
          coin={openCoin}
          onClose={() => setOpenCoin(null)}
          footer={
            <a className="btn" href={`#/dca-book?coin=${openCoin}`}>
              Open in the DCA book
            </a>
          }
        />
      )}
      {/* Compact (owner, 21 Nov 2026): what happens in two lines, three short buttons. */}
      <dialog ref={dialog} className="dcw-close" aria-labelledby="dcw-close-title">
        <h2 id="dcw-close-title">Buy everything now?</h2>
        <p>
          Open limits are cancelled and the rest is bought at market.
          {now < cycle.closeOut && (
            <span className="muted"> Or wait: {dated(cycle.closeOut)} 7pm buys it on its own.</span>
          )}
        </p>
        <div className="dlg-btns">
          <button className="btn btn-small" type="button" disabled={closing} onClick={skipWeek}>
            Skip week
          </button>
          <button
            ref={keep}
            className="btn btn-small"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Wait
          </button>
          <button
            className="btn btn-small btn-accent"
            type="button"
            disabled={closing}
            onClick={closeOut}
          >
            Buy now
          </button>
        </div>
      </dialog>
    </section>
  );
}
