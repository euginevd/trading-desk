// The Dashboard's weekly DCA (TODO 11): this week as steps from deposit day to Monday's
// close-out, and the week's orders beside them. The whole book is on its own page.
import { useCallback, useEffect, useRef, useState } from "react";
import { closeOutDca, getDcaBook } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { STATUS, dated, isOpen, limit, two, weeklyTotal, when } from "./dcaFormat";
import "./myagents.css";
import type { DcaBook, DcaOrder } from "./types";

type Step = { at: string; what: string; state: "done" | "now" | "later" };

function steps(book: DcaBook, now: number): Step[] {
  const weekly = book.week.orders.filter((o) => o.source === "weekly");
  const filled = weekly.filter((o) => o.status === "filled").length;
  const open = weekly.filter(isOpen).length;
  const closed = book.week.orders.some((o) => o.source === "close-out");
  const placed = weekly.length > 0;
  const done = placed && open === 0;
  const firstPlaced = Math.min(...weekly.map((o) => o.created));
  const lastFill = Math.max(
    0,
    ...weekly.filter((o) => o.status === "filled").map((o) => o.updated),
  );
  return [
    { at: dated(book.week.start, true), what: "Deposit day", state: "done" },
    {
      at: placed ? dated(firstPlaced, true) : `${dated(now)} today`,
      what: placed
        ? `${weekly.length} ${weekly.length === 1 ? "limit" : "limits"} placed`
        : "Plan and place this week's limits",
      state: placed ? "done" : "now",
    },
    {
      at: done && lastFill ? dated(lastFill, true) : `By ${dated(book.week.closeOut)}`,
      what: placed ? `${filled} of ${weekly.length} filled` : "Waiting for the limits",
      state: done ? "done" : placed ? "now" : "later",
    },
    {
      at: dated(book.week.closeOut, true),
      what: closed
        ? "Closed out: what didn't fill was bought at market"
        : done
          ? "Nothing left to close out"
          : !placed && now >= book.week.closeOut
            ? "Close-out has passed; a buy placed now still counts this week"
            : "Close-out: anything still open is bought at market",
      state: closed || done ? "done" : placed && now >= book.week.closeOut ? "now" : "later",
    },
  ];
}

function sentence(book: DcaBook): string {
  const total = weeklyTotal(book);
  const weekly = book.week.orders.filter((o) => o.source === "weekly");
  const spent = book.week.orders
    .filter((o) => o.side === "buy" && (o.source === "weekly" || o.source === "close-out"))
    .reduce((sum, o) => sum + Number(o.filledQuote), 0);
  if (weekly.length === 0) return `This week's ${two(total)} ${book.quote} isn't placed yet.`;
  const open = weekly.filter(isOpen).length;
  const filled = weekly.filter((o) => o.status === "filled").length;
  if (open === 0) return `This week's buy is done: ${two(spent)} ${book.quote} bought.`;
  return `This week's ${two(total)} ${book.quote}: ${filled} of ${weekly.length} limits filled.`;
}

export default function DcaWidget({ now: given }: { now?: number }) {
  const [now] = useState(() => given ?? Date.now());
  const [book, setBook] = useState<DcaBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
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

  if (error && !book) {
    return (
      <section className="dcw" aria-label="Weekly DCA">
        <p className="dcw-head">
          <b>Weekly DCA</b>
        </p>
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
        <p className="dcw-head">
          <b>Weekly DCA</b>
        </p>
        <p className="dcw-line">Set your weekly plan and the desk keeps a book of every buy.</p>
        <a className="btn btn-accent dcw-start" href="#/dca-book">
          Set up the DCA book
        </a>
      </section>
    );
  }

  const openWeekly = book.week.orders.some((o) => o.source === "weekly" && isOpen(o));
  const early = now < book.week.closeOut;
  return (
    <section className="dcw" aria-label="Weekly DCA">
      <div>
        <p className="dcw-head">
          <AgentAvatar icon="dca" slug="dca-agent" />
          <b>Weekly DCA</b>
          <a className="muted dcw-agent" href="#/profile">
            dca-agent
          </a>
        </p>
        <p className="dcw-line">{sentence(book)}</p>
        <ol className="dcw-steps">
          {steps(book, now).map((s) => (
            <li key={s.at + s.what} className={`is-${s.state}`}>
              <span className="dcw-when num">{s.at}</span>
              <span>{s.what}</span>
            </li>
          ))}
        </ol>
        {said && (
          <p className="muted dcw-said" role="status">
            {said}
          </p>
        )}
      </div>
      <div>
        {book.week.orders.length > 0 ? (
          <table className="dcw-table" aria-label="This week's orders">
            <thead>
              <tr>
                <th>Coin</th>
                <th className="r">Limit</th>
                <th className="r">{book.quote}</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {book.week.orders.map((o: DcaOrder) => (
                <tr key={o.ref}>
                  <td>
                    <span className="dcb-coin">
                      <CoinIcon coin={o.coin} />
                      {o.coin}
                    </span>
                  </td>
                  <td className="r num">{o.kind === "market" ? "Market" : limit(o.price)}</td>
                  <td className="r num">{two(o.spend ?? o.filledQuote)}</td>
                  <td>
                    <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted dcw-none">No orders this week yet.</p>
        )}
        <div className="dcw-foot">
          {openWeekly ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                dialog.current?.showModal?.();
                keep.current?.focus();
              }}
            >
              {early ? "Close out early" : "Close out now"}
            </button>
          ) : (
            <a className="btn btn-small" href="#/dca-book?plan">
              {book.week.orders.length ? "Add an order" : "Plan this week"}
            </a>
          )}
          <a href="#/dca-book">Open the DCA book</a>
        </div>
      </div>
      <dialog ref={dialog} aria-labelledby="dcw-close-title">
        <h2 id="dcw-close-title">Close out this week now?</h2>
        <p>
          Every weekly limit still open is cancelled, and what it didn't buy is bought at market
          straight away.
          {early && ` The plan's close-out is ${when(book.week.closeOut)}.`}
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
