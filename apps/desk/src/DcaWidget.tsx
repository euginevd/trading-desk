// The Dashboard's weekly DCA (TODO 11): one section for the buying window. A sentence says where
// the week stands; under it, eight days on a line with the window (Friday 7pm to Monday 7pm) as
// a mint band, now marked and each fill a dot at its time; then the plan's coins with their
// limits. It replaced the week rail and the step list, which said the same thing twice.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeOutDca, getDcaBook } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import PositionDrawer from "./DcaPosition";
import { dated, isOpen, qty, signed, two } from "./dcaFormat";
import "./myagents.css";
import type { DcaBook, DcaOrder, DcaPosition } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const AU = "en-AU";
const SYD = "Australia/Sydney";

type Cycle = { start: number; closeOut: number; orders: DcaOrder[]; current: boolean };

// The cycle to show: this one while it's open or has limits waiting, else the next.
export function cycleOf(book: DcaBook, now: number): Cycle {
  const waiting = book.week.orders.some((o) => o.source === "weekly" && isOpen(o));
  if (now < book.week.closeOut || waiting) {
    const { start, closeOut, orders } = book.week;
    return { start, closeOut, orders, current: true };
  }
  return { start: book.next.start, closeOut: book.next.closeOut, orders: [], current: false };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const whole = (n: number) => Math.round(n).toLocaleString("en-AU");
const weeklyOf = (orders: DcaOrder[]) => orders.filter((o) => o.source === "weekly");
const boughtOf = (orders: DcaOrder[]) =>
  orders
    .filter((o) => o.side === "buy" && (o.source === "weekly" || o.source === "close-out"))
    .reduce((s, o) => s + Number(o.filledQuote), 0);

function headline(quote: string, cycle: Cycle, now: number, total: number): string {
  const amount = `$${whole(total)} ${quote}`;
  if (now < cycle.start) {
    const days = Math.ceil((cycle.start - now) / DAY);
    const when = cycle.start - now < 12 * HOUR ? "today" : `in ${plural(days, "day")}`;
    return `Next buy ${when}: ${amount} on ${dated(cycle.start)} at 7pm.`;
  }
  const weekly = weeklyOf(cycle.orders);
  if (weekly.length === 0) return `The buying window is open: plan this week's ${amount}.`;
  const open = weekly.filter(isOpen).length;
  if (open === 0) return `This week's buy is done: ${two(boughtOf(cycle.orders))} ${quote} bought.`;
  const filled = weekly.filter((o) => o.status === "filled").length;
  return `${filled} of ${plural(weekly.length, "limit")} filled. The rest buy at market on ${dated(cycle.closeOut)} at 7pm.`;
}

// A coin's week: what's bought of its weekly target (every source counts), then what's held or
// what's waiting. "Bought" only once the target is met, never for a starter order.
function coinWeek(
  orders: DcaOrder[],
  coin: string,
  target: number,
  position: DcaPosition | undefined,
): { bought: number; done: boolean; line: string; tone: string } {
  const mine = orders.filter((o) => o.coin === coin && o.side === "buy");
  const bought = mine.reduce((s, o) => s + Number(o.filledQuote), 0);
  const done = target > 0 && bought >= target * 0.95;
  const open = mine
    .filter((o) => isOpen(o) && o.kind === "limit")
    .reduce((s, o) => s + Number(o.spend ?? 0), 0);
  const held = Number(position?.qty ?? 0);
  if (open > 0) return { bought, done, line: `$${whole(open)} waiting`, tone: "is-open" };
  if (held > 0) {
    const pnl =
      position?.pnlPct === null || position?.pnlPct === undefined
        ? ""
        : `, ${signed(position.pnlPct)}%`;
    return {
      bought,
      done,
      line: `${qty(position?.qty)} ${coin}${pnl}`,
      tone: done ? "is-filled" : "",
    };
  }
  return { bought, done, line: "Nothing held yet", tone: "" };
}

export default function DcaWidget({ now: given }: { now?: number }) {
  const [now] = useState(() => given ?? Date.now());
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

  const closeOut = () => {
    setClosing(true);
    closeOutDca().then(
      (r) => {
        setSaid(
          r.closed.length ? `Bought at market: ${r.closed.join(", ")}.` : "Nothing was open.",
        );
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

  const head = (
    <header className="dcw-head">
      <a className="dcw-home" href="#/dca-book" aria-label="Weekly DCA: open the DCA book">
        <AgentAvatar icon="dca" slug="dca-agent" />
        <h2>Weekly DCA</h2>
        <span className="dcw-agent">dca-agent</span>
      </a>
    </header>
  );

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
  const waiting = weeklyOf(cycle.orders).some(isOpen);
  const placed = weeklyOf(cycle.orders).length > 0;
  const fills = cycle.orders.filter((o) => o.side === "buy" && Number(o.filledQty) > 0);
  const last = cycle.current ? null : boughtOf(book.week.orders);
  const today = Math.floor((now - from) / DAY);

  return (
    <section className="dcw" aria-label="Weekly DCA">
      {head}
      <p className="dcw-line">{headline(book.quote, cycle, now, total)}</p>

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
          />
          {now >= from && now <= to && <span className="dcw-now" style={{ left: at(now) }} />}
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

      <div className="dcw-foot">
        <ul className="dcw-coins" aria-label="This week's coins against their targets">
          {Object.entries(coins).map(([coin, usdc]) => {
            const week = coinWeek(
              cycle.orders,
              coin,
              usdc,
              book.positions.find((x) => x.coin === coin),
            );
            const pct = usdc > 0 ? Math.min(100, (week.bought / usdc) * 100) : 0;
            return (
              <li key={coin} className={`${week.tone}${week.done ? " is-done" : ""}`}>
                <button
                  type="button"
                  className="dcw-coin"
                  aria-label={`${coin}: open its position and orders`}
                  onClick={() => setOpenCoin(coin)}
                >
                  <span className="dcb-coin">
                    <CoinIcon coin={coin} />
                    {coin}
                  </span>
                  <span className="num dcw-of">
                    <b>${whole(week.bought)}</b> of ${whole(usdc)}
                  </span>
                  <i className="dcw-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </i>
                  <small className="num">{week.line}</small>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="dcw-act">
          {waiting ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                dialog.current?.showModal?.();
                keep.current?.focus();
              }}
            >
              {now < cycle.closeOut ? "Close out early" : "Close out now"}
            </button>
          ) : !placed && inside ? (
            <a className="btn btn-accent" href="#/dca-book?plan">
              Plan this week
            </a>
          ) : null}
          {last !== null && (
            <small className="muted">
              Last week: {last > 0 ? `${two(last)} ${book.quote} bought` : "nothing bought"}.
            </small>
          )}
        </div>
      </div>
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
      <dialog ref={dialog} aria-labelledby="dcw-close-title">
        <h2 id="dcw-close-title">Close out this week now?</h2>
        <p>
          Every weekly limit still open is cancelled, and what it didn't buy is bought at market
          straight away.
          {now < cycle.closeOut && ` The plan's close-out is ${dated(cycle.closeOut)} at 7pm.`}
        </p>
        <div className="dlg-btns">
          <button ref={keep} className="btn" type="button" onClick={() => dialog.current?.close()}>
            Keep waiting
          </button>
          <button className="btn btn-accent" type="button" disabled={closing} onClick={closeOut}>
            Buy the rest at market
          </button>
        </div>
      </dialog>
    </section>
  );
}
