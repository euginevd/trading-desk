// The DCA book (TODO 11): five lifelong positions, one per coin, fed only by orders placed from
// the desk. A sentence, three years as weekly ticks, this week's planner, the positions and
// every order. A trim sells a slice and its buy-back is linked to it; tax parcels stay on Tax.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  checkDca,
  dcaOdds,
  fixDca,
  getDcaBook,
  placeDcaOrder,
  sellCheck,
  setDcaPlan,
  suggestDca,
} from "./api";
import CoinIcon from "./CoinIcon";
import OrderReview from "./OrderReview";
import DcaChat from "./DcaChat";
import PositionDrawer from "./DcaPosition";
import { Live } from "./Figures";
import DcaFunds from "./DcaFunds";
import DcaOpen, { CancelDialog, OrderPanel } from "./DcaOpen";
import {
  SOURCE,
  dated,
  dollars,
  STATUS,
  amountOf,
  day,
  isOpen,
  limit,
  qty,
  signed,
  toCsv,
  two,
  when,
} from "./dcaFormat";
import type {
  DcaBook,
  DcaCheck,
  DcaOdds,
  DcaOrder,
  DcaOrderRequest,
  DcaPlan,
  DcaPosition,
  SellCheck,
} from "./types";

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const oddsWords = (o: DcaOdds | null) =>
  !o
    ? "—"
    : o.weeks === 0
      ? "No history"
      : o.few
        ? `${o.hit} of ${o.weeks} wk`
        : `${o.pct}% (${o.hit} of ${o.weeks})`;

function Coin({ coin }: { coin: string }) {
  return (
    <span className="dcb-coin">
      <CoinIcon coin={coin} />
      {coin}
    </span>
  );
}

// ---------------------------------------------------------------- the plan

const BLANK_PLAN: DcaPlan = {
  start: new Date().toISOString().slice(0, 10),
  weeks: 156,
  orders: [{ coin: "BTC", spend: "", odds: 60 }],
};

function PlanForm({
  plan,
  onSaved,
  onCancel,
}: {
  plan: DcaPlan | null;
  onSaved: (b: DcaBook) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<DcaPlan>(plan ?? BLANK_PLAN);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const row = (i: number, change: Partial<DcaPlan["orders"][number]>) =>
    setDraft((d) => ({
      ...d,
      orders: d.orders.map((o, k) => (k === i ? { ...o, ...change } : o)),
    }));
  const total = draft.orders.reduce((s, o) => s + (Number(o.spend) || 0), 0);
  const save = () => {
    setBusy(true);
    setError(null);
    setDcaPlan(draft).then(
      (b) => {
        setBusy(false);
        onSaved(b);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "The plan wasn't saved."));
      },
    );
  };
  return (
    <form
      className="dcb-planform"
      aria-label="Weekly plan"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2>{plan ? "Change the weekly plan" : "Your weekly plan"}</h2>
      <p className="muted">
        One row per weekly order. Fill odds are the share of past weeks a limit at that depth filled
        by Monday evening; the desk picks the price to match.
      </p>
      <div className="dcb-planhead">
        <label>
          Starts
          <input
            type="date"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label>
          Weeks
          <input
            type="number"
            min={1}
            max={520}
            value={draft.weeks}
            onChange={(e) => setDraft({ ...draft, weeks: Number(e.target.value) })}
          />
        </label>
      </div>
      <table className="dcb-table">
        <thead>
          <tr>
            <th>Coin</th>
            <th>Amount</th>
            <th>Fill odds %</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.orders.map((o, i) => (
            <tr key={i}>
              <td>
                <input
                  aria-label={`Order ${i + 1} coin`}
                  value={o.coin}
                  onChange={(e) => row(i, { coin: e.target.value.toUpperCase() })}
                />
              </td>
              <td>
                <input
                  aria-label={`Order ${i + 1} amount`}
                  inputMode="decimal"
                  value={o.spend}
                  onChange={(e) => row(i, { spend: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`Order ${i + 1} fill odds`}
                  type="number"
                  min={5}
                  max={95}
                  value={o.odds}
                  onChange={(e) => row(i, { odds: Number(e.target.value) })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="link"
                  disabled={draft.orders.length === 1}
                  onClick={() =>
                    setDraft({ ...draft, orders: draft.orders.filter((_, k) => k !== i) })
                  }
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dcb-planfoot">
        <button
          type="button"
          className="link"
          onClick={() =>
            setDraft({ ...draft, orders: [...draft.orders, { coin: "", spend: "", odds: 60 }] })
          }
        >
          Add a row
        </button>
        <span className="muted num">{two(total)} a week</span>
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Keep the plan
          </button>
        )}
        <button type="submit" className="btn btn-accent" disabled={busy}>
          Save plan
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- three years as ticks

function Ticks({ book }: { book: DcaBook }) {
  const p = book.progress;
  const [said, setSaid] = useState("Hover or focus a week to read it.");
  if (!p) return null;
  const tell = (i: number) => {
    const t = p.ticks[i];
    if (!t) return setSaid(`Week ${i + 1}: to come.`);
    const base = `Week ${t.week}, Friday ${day(Date.parse(t.friday), true)}`;
    if (t.state === "now")
      return setSaid(`${base}: this week, ${two(t.usdc)} ${book.quote} so far.`);
    if (t.state === "missed") return setSaid(`${base}: nothing bought.`);
    setSaid(`${base}: ${two(t.usdc)} ${book.quote} bought${t.trim ? ", and a trim" : ""}.`);
  };
  return (
    <div className="dcb-years">
      <div
        className="dcb-ticks"
        role="group"
        aria-label={`Week ${p.week} of ${p.weeks}: ${p.ticks.filter((t) => t.state === "bought").length} weeks bought`}
        style={{ gridTemplateColumns: `repeat(${p.weeks}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: p.weeks }, (_, i) => {
          const t = p.ticks[i];
          const cls = t ? `is-${t.state}${t.trim ? " is-trim" : ""}` : "";
          return t ? (
            <button
              key={i}
              type="button"
              className={`dcb-tick ${cls}`}
              style={{ ["--i" as string]: i }}
              aria-label={`Week ${t.week}`}
              onPointerEnter={() => tell(i)}
              onFocus={() => tell(i)}
              onClick={() => tell(i)}
            />
          ) : (
            <span key={i} className="dcb-tick" style={{ ["--i" as string]: i }} />
          );
        })}
      </div>
      <p className="muted dcb-years-said" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- this week's planner

type Row = {
  coin: string;
  spend: string;
  price: string;
  odds: DcaOdds | null;
  on: boolean;
  result?: string;
  failed?: boolean;
};

function Planner({
  book,
  onPlaced,
  start = false,
}: {
  book: DcaBook;
  onPlaced: () => void;
  start?: boolean;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const fetchPlan = useCallback(() => {
    suggestDca().then(
      (s) =>
        setRows(
          s.orders.map((o) => ({
            coin: o.coin,
            spend: o.spend,
            price: o.price,
            odds: o.odds,
            on: true,
          })),
        ),
      (e: unknown) => setError(errorOf(e, "The desk couldn't plan this week.")),
    );
  }, []);
  const plan = () => {
    setError(null);
    setRows(null);
    fetchPlan();
  };
  // Opened from the Dashboard's Plan this week: the plan comes straight away.
  useEffect(() => {
    if (start) fetchPlan();
  }, [start, fetchPlan]);
  const edit = (i: number, change: Partial<Row>) =>
    setRows((r) => r?.map((x, k) => (k === i ? { ...x, ...change } : x)) ?? null);
  const reOdds = (i: number) => {
    const r = rows?.[i];
    if (!r || !(Number(r.price) > 0)) return;
    dcaOdds(r.coin, r.price).then(
      (o) => edit(i, { odds: o }),
      () => edit(i, { odds: null }),
    );
  };

  const chosen = rows?.filter((r) => r.on && !r.result) ?? [];
  const place = async (override = false) => {
    if (!rows) return;
    setBusy(true);
    setHeld(null);
    const next = [...rows];
    for (const [i, r] of next.entries()) {
      if (!r.on || r.result) continue;
      try {
        const order: DcaOrderRequest = {
          coin: r.coin,
          spend: r.spend,
          price: r.price,
          source: "weekly",
          override,
        };
        const placed = await placeDcaOrder(order);
        next[i] = { ...r, result: `${placed.ref}, ${STATUS[placed.status].toLowerCase()}` };
      } catch (e) {
        if (e instanceof ApiError && e.ruleBreaks.length) {
          setHeld(e.message);
          break;
        }
        next[i] = { ...r, result: errorOf(e, "Not placed."), failed: true };
      }
      setRows([...next]);
    }
    setBusy(false);
    dialog.current?.close?.();
    onPlaced();
  };

  return (
    <section className="dcb-section" aria-labelledby="dcb-plan-title">
      <div className="dcb-section-head">
        <h2 id="dcb-plan-title">This week</h2>
        <span className="muted">
          Buying window {dated(book.week.start)} 7pm to {dated(book.week.closeOut)} 7pm, Sydney time
        </span>
      </div>
      {!rows ? (
        <div className="dcb-plan-start">
          <button type="button" className="btn btn-accent" onClick={plan}>
            Plan this week's orders
          </button>
          <span className="muted">
            The desk picks each limit from a year of prices: the depth that filled about as often as
            your plan asks, just above a round number.
          </span>
        </div>
      ) : (
        <>
          <div className="dcb-scroll">
            <table className="dcb-table" aria-label="This week's planned orders">
              <thead>
                <tr>
                  <th>
                    <span className="visually-hidden">Place</span>
                  </th>
                  <th>Coin</th>
                  <th className="r">Limit</th>
                  <th className="r">{book.quote}</th>
                  <th className="r">Fill odds</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.coin}-${i}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Place ${r.coin}`}
                        checked={r.on}
                        disabled={Boolean(r.result)}
                        onChange={(e) => edit(i, { on: e.target.checked })}
                      />
                    </td>
                    <td>
                      <Coin coin={r.coin} />
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${r.coin} limit price`}
                        inputMode="decimal"
                        value={r.price}
                        disabled={Boolean(r.result)}
                        onChange={(e) => edit(i, { price: e.target.value })}
                        onBlur={() => reOdds(i)}
                      />
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${r.coin} amount`}
                        inputMode="decimal"
                        value={r.spend}
                        disabled={Boolean(r.result)}
                        onChange={(e) => edit(i, { spend: e.target.value })}
                      />
                    </td>
                    <td className="r num">{oddsWords(r.odds)}</td>
                    <td className={r.failed ? "error-text" : "muted"}>{r.result ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {held && (
            <div className="alert" role="alert">
              <span>{held}</span>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => void place(true)}
              >
                Place anyway (logged)
              </button>
            </div>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dcb-plan-foot">
            <button type="button" className="link" onClick={plan}>
              Plan again at today's prices
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={chosen.length === 0 || busy}
              onClick={() => dialog.current?.showModal?.()}
            >
              Review {chosen.length} {chosen.length === 1 ? "limit" : "limits"}
            </button>
          </div>
        </>
      )}
      {error && !rows && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <dialog ref={dialog} aria-labelledby="dcb-place-title">
        <h2 id="dcb-place-title">
          Place {chosen.length} limit {chosen.length === 1 ? "buy" : "buys"}?
        </h2>
        <OrderReview
          quote={book.quote}
          items={chosen.map((r) => ({
            coin: r.coin,
            action: "Buy" as const,
            price: r.price,
            usdc: r.spend,
            odds: r.odds?.pct ?? null,
          }))}
          note={`They go to Binance now and wait for their price. Anything open at ${when(book.week.closeOut)} can be bought at market.`}
        />
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => dialog.current?.close()}>
            Not yet
          </button>
          <button
            className="btn btn-accent"
            type="button"
            disabled={busy}
            onClick={() => void place()}
          >
            Place {chosen.length} {chosen.length === 1 ? "limit" : "limits"}
          </button>
        </div>
      </dialog>
    </section>
  );
}

// ---------------------------------------------------------------- one order, trims, buy-backs

type Sheet =
  | { kind: "buy"; coin: string; source: "desk" | "buy-back"; link?: string; spend?: string }
  | { kind: "trim"; position: DcaPosition };

function OrderSheet({
  sheet,
  book,
  onClose,
  onDone,
}: {
  sheet: Sheet;
  book: DcaBook;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  // Mounted afresh for each sheet (by key), so its fields start from the sheet.
  const dialog = useRef<HTMLDialogElement>(null);
  const taxTimer = useRef<number | undefined>(undefined);
  const [coin, setCoin] = useState(sheet.kind === "trim" ? sheet.position.coin : sheet.coin);
  const [market, setMarket] = useState(false);
  const [price, setPrice] = useState(sheet.kind === "trim" ? (sheet.position.price ?? "") : "");
  const [amount, setAmount] = useState(sheet.kind === "buy" ? (sheet.spend ?? "") : "");
  const [odds, setOdds] = useState<DcaOdds | null>(null);
  const [tax, setTax] = useState<SellCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal?.();
    return () => window.clearTimeout(taxTimer.current);
  }, []);

  const trim = sheet.kind === "trim";
  const holding = trim ? Number(sheet.position.qty) : 0;
  // A trim's tax check follows the quantity, a moment after typing stops.
  const changeAmount = (value: string) => {
    setAmount(value);
    window.clearTimeout(taxTimer.current);
    if (!trim || !(Number(value) > 0)) {
      setTax(null);
      return;
    }
    taxTimer.current = window.setTimeout(() => {
      sellCheck(coin, value).then(setTax, () => setTax(null));
    }, 300);
  };

  const share = trim && holding > 0 ? (Number(amount) / holding) * 100 : 0;
  const send = (override = false) => {
    setBusy(true);
    setError(null);
    const body: DcaOrderRequest = trim
      ? {
          coin,
          side: "sell",
          kind: market ? "market" : "limit",
          qty: amount,
          source: "trim",
          ...(market ? {} : { price }),
        }
      : {
          coin,
          kind: market ? "market" : "limit",
          spend: amount,
          source: sheet.source,
          ...(sheet.link ? { link: sheet.link } : {}),
          ...(market ? {} : { price }),
          override,
        };
    placeDcaOrder(body).then(
      (o) => {
        setBusy(false);
        onDone(`${o.ref}: ${STATUS[o.status].toLowerCase()}.`);
      },
      (e: unknown) => {
        setBusy(false);
        setHeld(e instanceof ApiError && e.ruleBreaks.length > 0);
        setError(errorOf(e, "The order wasn't placed."));
      },
    );
  };
  const title = trim
    ? `Trim ${coin}`
    : sheet.source === "buy-back"
      ? `Buy back ${coin}`
      : "Add an order to the book";
  return (
    <dialog ref={dialog} aria-labelledby="dcb-sheet-title" onClose={onClose} className="dcb-sheet">
      <h2 id="dcb-sheet-title">{title}</h2>
      {trim ? (
        <p>
          Sells a slice of {sheet.position.id}. The average cost stays; the gain is realised and
          taxed. Buy it back lower from the order list once it fills.
        </p>
      ) : sheet.source === "buy-back" ? (
        <p>Buys back what trim {sheet.link} sold, linked to it in the book.</p>
      ) : (
        <p>A buy placed here counts in the book. Buys made on Binance directly never do.</p>
      )}
      <form
        className="dcb-sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {!trim && sheet.source === "desk" && (
          <label>
            Coin
            <select value={coin} onChange={(e) => setCoin(e.target.value)}>
              {book.positions.map((p) => (
                <option key={p.coin}>{p.coin}</option>
              ))}
            </select>
          </label>
        )}
        <div className="dcb-seg" role="group" aria-label="Order type">
          <button type="button" aria-pressed={!market} onClick={() => setMarket(false)}>
            Limit
          </button>
          <button type="button" aria-pressed={market} onClick={() => setMarket(true)}>
            Market
          </button>
        </div>
        {!market && (
          <label>
            Price ({book.quote})
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => {
                if (!trim && Number(price) > 0)
                  dcaOdds(coin, price).then(setOdds, () => setOdds(null));
              }}
            />
          </label>
        )}
        <label>
          {trim ? `Quantity (${coin})` : `Amount (${book.quote})`}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => changeAmount(e.target.value)}
          />
        </label>
        {trim && (
          <p className="dcb-chips">
            {[10, 20, 25].map((pct) => (
              <button
                key={pct}
                type="button"
                className="btn btn-small"
                onClick={() =>
                  changeAmount(String(Math.floor(holding * pct * 1e6) / 1e8).replace(/\.?0+$/, ""))
                }
              >
                {pct}%
              </button>
            ))}
            <span className="muted">of {qty(holding)} held</span>
          </p>
        )}
        {trim && share > 25 && (
          <p className="dcb-warn" role="note">
            That's {Math.round(share)}% of the position; the agent's rule is 25% at most.
          </p>
        )}
        {trim && tax && (
          <p className={tax.young ? "dcb-warn" : "muted"}>
            {tax.unknown
              ? "The tax page can't price every parcel of this."
              : `Estimated gain A$${two(tax.gainAud)}.`}
            {tax.young && " Some was held under 12 months: no 50% discount on it."}
          </p>
        )}
        {!trim && !market && odds && (
          <p className="muted">Fill odds by Monday evening: {oddsWords(odds)}.</p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dlg-btns">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            Don't place
          </button>
          {held ? (
            <button type="button" className="btn" disabled={busy} onClick={() => send(true)}>
              Place anyway (logged)
            </button>
          ) : (
            <button
              type="submit"
              className={`btn ${trim ? "btn-danger" : "btn-accent"}`}
              disabled={busy}
            >
              {trim ? `Sell ${coin}` : `Buy ${coin}`}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- check against Binance

// Every order goes to Binance with its reference as its client order id; this reads them all
// back and says what differs. Fixing re-reads each differing order and adds back any the book
// lost.
function Checked({ found, busy, onFix }: { found: DcaCheck; busy: boolean; onFix: () => void }) {
  const issues = found.differ.length + found.onlyBinance.length + found.onlyBook.length;
  const fixable = found.differ.length + found.onlyBinance.length;
  const fixedWords =
    found.fixed !== undefined ? ` Updated ${found.fixed}, added back ${found.added ?? 0}.` : "";
  if (issues === 0) {
    return (
      <p className="dcb-check is-ok" role="status">
        All {found.inBook} {found.inBook === 1 ? "order" : "orders"} in the book match Binance.
        {fixedWords}
      </p>
    );
  }
  return (
    <div className="dcb-check" role="status">
      <p>
        {found.matched} of {found.inBook} match Binance; {issues} to look at.{fixedWords}
      </p>
      <ul>
        {found.differ.map((d) => (
          <li key={d.ref}>
            <b>{d.ref}</b>: the book says {d.book.status} ({qty(d.book.filledQty)} filled), Binance
            says {d.binance.status} ({qty(d.binance.filledQty)} filled).
          </li>
        ))}
        {found.onlyBinance.map((o) => (
          <li key={o.ref}>
            <b>{o.ref}</b>: on Binance ({o.side}, {o.status}), not in the book.
          </li>
        ))}
        {found.onlyBook.map((o) => (
          <li key={o.ref}>
            <b>{o.ref}</b>: in the book, not found on Binance. Binance drops orders cancelled with
            nothing filled after about 90 days.
          </li>
        ))}
      </ul>
      {fixable > 0 && (
        <button type="button" className="btn btn-small" disabled={busy} onClick={onFix}>
          Update the book from Binance
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- money per coin

// What sits in open buy orders for a coin, and the share of the book against its target.
const openOf = (book: DcaBook, coin?: string) =>
  book.orders
    .filter((o) => isOpen(o) && o.side === "buy" && (!coin || o.coin === coin))
    .reduce((s, o) => s + Number(o.spend ?? 0), 0);
function mixOf(book: DcaBook) {
  const plan = book.plan?.orders ?? [];
  const spend = plan.reduce((s, o) => s + Number(o.spend), 0) || 1;
  const value = book.positions.reduce((s, p) => s + Number(p.value ?? 0), 0);
  const target = (coin: string) =>
    (plan.filter((o) => o.coin === coin).reduce((s, o) => s + Number(o.spend), 0) * 100) / spend;
  const now = (v: string | null) => (value > 0 ? (Number(v ?? 0) * 100) / value : 0);
  const scale = Math.max(
    1,
    ...book.positions.map((p) => Math.max(target(p.coin), now(p.value)) * 1.15),
  );
  return { target, now, scale };
}

// Show more and the chat are remembered per browser; storage may be blocked, then they start
// closed.
const MORE_KEY = "desk.dcaBook.more";
const CHAT_KEY = "desk.dcaBook.chat";
function readFlag(key: string, fallback = false): boolean {
  try {
    const kept = window.localStorage.getItem(key);
    return kept === null ? fallback : kept === "1";
  } catch {
    return fallback;
  }
}
function saveFlag(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // not kept: it starts closed next time
  }
}
const readMore = () => readFlag(MORE_KEY);
const saveMore = (open: boolean) => saveFlag(MORE_KEY, open);

// ---------------------------------------------------------------- the page

type Filter = "all" | "trims" | string;
const HIDE_KEY = "desk.dca.hideCancelled";
// Cancelled with nothing bought: of no interest once it's off Binance.
const gone = (o: DcaOrder) => o.status === "cancelled" && Number(o.filledQty) === 0;

export default function DcaBookPage() {
  const [book, setBook] = useState<DcaBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const setSheet = (next: Sheet | null) => {
    if (next) setSheetKey((k) => k + 1);
    setSheetState(next);
  };
  const [said, setSaid] = useState<string | null>(null);
  // The Dashboard's links open the book at Add funds or Remove funds.
  const [checked, setChecked] = useState<DcaCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [funds, setFunds] = useState<"add" | "remove" | null>(() => {
    const asked = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("funds");
    return asked === "add" || asked === "remove" ? asked : null;
  });
  const [cancelling, setCancelling] = useState<DcaOrder | null>(null);
  const [viewing, setViewing] = useState<{ ref: string; edit: boolean } | null>(null);
  const [hideCancelled, setHideCancelled] = useState(() => readFlag(HIDE_KEY, true));
  const toggleHide = () =>
    setHideCancelled((h) => {
      saveFlag(HIDE_KEY, !h);
      return !h;
    });
  const planning = window.location.hash.includes("?plan");
  const asked = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const chatting = asked.has("chat");
  // The Dashboard's coin links open that position with its orders.
  const [openCoin, setOpenCoin] = useState<string | null>(() => asked.get("coin"));
  const [more, setMore] = useState(() => readMore());
  const [chatOpen, setChatOpen] = useState(() => chatting || readFlag(CHAT_KEY));
  const openChat = (open: boolean) => {
    setChatOpen(open);
    saveFlag(CHAT_KEY, open);
  };

  const load = useCallback(() => {
    getDcaBook().then(
      (b) => {
        setBook(b);
        setError(null);
      },
      (e: unknown) => setError(errorOf(e, "The DCA book couldn't be read.")),
    );
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [load]);

  if (error && !book) {
    return (
      <main className="wrap dcb">
        <h1>DCA book</h1>
        <p className="error-text" role="alert">
          {error}
        </p>
        <button type="button" className="btn" onClick={load}>
          Try again
        </button>
      </main>
    );
  }
  if (!book) {
    return (
      <main className="wrap dcb" aria-busy="true">
        <p className="muted">Reading the DCA book…</p>
      </main>
    );
  }
  if (!book.plan || editing) {
    return (
      <main className="wrap dcb">
        <h1>{book.plan ? "DCA book" : "Start the DCA book"}</h1>
        <PlanForm
          plan={book.plan}
          onSaved={(b) => {
            setBook(b);
            setEditing(false);
          }}
          onCancel={book.plan ? () => setEditing(false) : undefined}
        />
      </main>
    );
  }

  const t = book.totals;
  const p = book.progress;
  const openTotal = openOf(book);
  const mix = mixOf(book);
  const pnl = Number(t.pnl);
  const bought = book.orders.some((o) => Number(o.filledQty) > 0);
  const backed = new Set(book.orders.filter((o) => o.source === "buy-back").map((o) => o.link));
  const shown = book.orders.filter(
    (o) =>
      filter === "all" || (filter === "trims" ? o.link || o.source === "trim" : o.coin === filter),
  );
  const runCheck = (fix: boolean) => {
    setChecking(true);
    (fix ? fixDca() : checkDca()).then(
      (found) => {
        setChecked(found);
        setChecking(false);
        if (fix) load();
      },
      (e: unknown) => {
        setChecking(false);
        setSaid(errorOf(e, "Binance couldn't be read. Try again in a minute."));
      },
    );
  };
  const toggleMore = () => {
    setMore((m) => {
      saveMore(!m);
      return !m;
    });
  };
  const renderOrders = (all: DcaOrder[], label: string) => {
    const list = hideCancelled ? all.filter((o) => !gone(o)) : all;
    const hidden = all.length - list.length;
    return (
      <>
        {list.length > 0 && (
          <div className="dcb-scroll">
            <table className="dcb-table" aria-label={label}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Placed</th>
                  <th>Coin</th>
                  <th>Source</th>
                  <th className="r">Price</th>
                  <th className="r">Quantity</th>
                  <th className="r">{book.quote}</th>
                  <th className="r dcb-hide">Fee</th>
                  <th>State</th>
                  <th>
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const sold = o.side === "sell";
                  return (
                    <tr key={o.ref}>
                      <td className="dcb-id">
                        {o.ref}
                        {o.link && <small> for {o.link}</small>}
                      </td>
                      <td className="num">{day(o.created)}</td>
                      <td>
                        <Coin coin={o.coin} />
                      </td>
                      <td>
                        <span className={`dcb-src is-${o.source}`}>{SOURCE[o.source]}</span>
                      </td>
                      <td className="r num">
                        {o.avgPrice
                          ? limit(o.avgPrice)
                          : o.kind === "market"
                            ? "Market"
                            : limit(o.price)}
                      </td>
                      <td className={`r num ${sold ? "down" : ""}`}>
                        {sold ? "−" : ""}
                        {qty(Number(o.filledQty) > 0 ? o.filledQty : o.qty)}
                      </td>
                      <td className="r num">{two(amountOf(o))}</td>
                      <td className="r num muted dcb-hide">{two(o.fee)}</td>
                      <td>
                        <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
                      </td>
                      <td className="r dco-acts">
                        <button
                          type="button"
                          className="link"
                          aria-label={`View ${o.ref}`}
                          onClick={() => setViewing({ ref: o.ref, edit: false })}
                        >
                          View
                        </button>
                        {isOpen(o) && o.kind === "limit" && (
                          <button
                            type="button"
                            className="link"
                            aria-label={`Modify ${o.ref}`}
                            onClick={() => setViewing({ ref: o.ref, edit: true })}
                          >
                            Modify
                          </button>
                        )}
                        {isOpen(o) ? (
                          <button
                            type="button"
                            className="link danger"
                            aria-label={`Cancel ${o.ref}`}
                            onClick={() => setCancelling(o)}
                          >
                            Cancel
                          </button>
                        ) : o.source === "trim" && o.status === "filled" && !backed.has(o.ref) ? (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              setSheet({
                                kind: "buy",
                                coin: o.coin,
                                source: "buy-back",
                                link: o.ref,
                                spend: String(Math.floor(Number(o.filledQuote) * 100) / 100),
                              })
                            }
                          >
                            Buy back
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
        {hidden > 0 && (
          <p className="muted dcb-hidden-note">
            {hidden} cancelled {hidden === 1 ? "order" : "orders"} hidden.{" "}
            <button type="button" className="link" onClick={toggleHide}>
              Show
            </button>
          </p>
        )}
      </>
    );
  };
  const exportCsv = () => {
    const blob = new Blob([toCsv(book.orders, book.quote)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dca-book-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className={`wrap dcb${chatOpen ? " has-chat" : ""}`}>
      <div className="dcb-main">
        <div className="dcb-top">
          <div>
            <h1 className="dcb-headline">
              {bought ? (
                <>
                  {dollars(t.added)} in, worth <Live value={t.value}>{dollars(t.value)}</Live>.
                </>
              ) : (
                "Nothing bought yet."
              )}
              {openTotal > 0 && <> {dollars(openTotal)} more in open orders.</>}
            </h1>
            <p className="muted dcb-sub">
              {book.positions.length} positions for life, week {p?.week ?? 1} of {p?.weeks ?? "—"}.
              {bought && t.pnlPct !== null
                ? ` ${pnl >= 0 ? "Up" : "Down"} ${two(Math.abs(Number(t.pnlPct)))}% on what you've put in, after ${dollars(t.fees)} in fees.`
                : " The book starts with your first order."}
              {Number(t.realised) ? ` ${dollars(t.realised, true)} realised on trims.` : ""}
              {p && ` Friday buys: ${dollars(p.onPlan)} of ${dollars(p.planTotal)} over 3 years.`}
            </p>
          </div>
          <dl className="dcb-totals">
            <div>
              <dt>Put in</dt>
              <dd className="num">{dollars(t.added)}</dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd className="num">
                <Live value={t.value}>{dollars(t.value)}</Live>
              </dd>
            </div>
            <div>
              <dt>P&amp;L</dt>
              <dd className={`num dcb-pnl ${pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : ""}`}>
                <Live value={t.pnl}>{dollars(t.pnl, true)}</Live>
              </dd>
            </div>
            <div>
              <dt>Open orders</dt>
              <dd className="num dcb-open">{dollars(openTotal)}</dd>
            </div>
          </dl>
        </div>
        {book.priceError && (
          <p className="dcb-warn" role="alert">
            Binance didn't answer ({book.priceError}), so value and P&amp;L are missing. Quantities
            and costs are from the desk's own records.
          </p>
        )}

        <section className="dcb-section" aria-labelledby="dcb-pos-title">
          <div className="dcb-section-head">
            <h2 id="dcb-pos-title">Positions</h2>
            <span className="dcb-actions">
              <button type="button" className="btn btn-small" onClick={() => setFunds("add")}>
                Add funds
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={!book.positions.some((x) => Number(x.qty) > 0)}
                onClick={() => setFunds("remove")}
              >
                Remove funds
              </button>
              <button type="button" className="link" onClick={() => setEditing(true)}>
                Change the plan
              </button>
            </span>
          </div>
          <div className="dcb-scroll">
            <table className="dcb-table" aria-label="Positions">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="r">Put in</th>
                  <th className="r">Value</th>
                  <th className="r">P&amp;L</th>
                  <th className="r">Open orders</th>
                  <th>Share of the book</th>
                  <th>
                    <span className="visually-hidden">Trim</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {book.positions.map((pos) => {
                  const n = Number(pos.pnl);
                  const opened = openCoin === pos.coin;
                  const mine = book.orders.filter((o) => o.coin === pos.coin);
                  const open = openOf(book, pos.coin);
                  const now = mix.now(pos.value);
                  const target = mix.target(pos.coin);
                  return (
                    <Fragment key={pos.coin}>
                      <tr id={`pos-${pos.coin}`} className={opened ? "is-open" : ""}>
                        <td>
                          <button
                            type="button"
                            className="dcb-expand"
                            aria-expanded={opened}
                            onClick={() => setOpenCoin(opened ? null : pos.coin)}
                          >
                            <Coin coin={pos.coin} />
                            <small className="dcb-id">
                              {pos.id}
                              {pos.since
                                ? ` since ${day(pos.since, true)}`
                                : ", nothing bought yet"}
                              {mine.length > 0 && (
                                <span className="dcb-count">
                                  {", "}
                                  {mine.length} {mine.length === 1 ? "order" : "orders"}
                                </span>
                              )}
                            </small>
                          </button>
                        </td>
                        <td className="r num">${Math.round(Number(pos.added))}</td>
                        <td className="r num">
                          <Live value={pos.value}>${Math.round(Number(pos.value ?? 0))}</Live>
                        </td>
                        <td className={`r num ${n > 0 ? "up" : n < 0 ? "down" : ""}`}>
                          {dollars(pos.pnl, true)}
                          {pos.pnlPct !== null && (
                            <span className="muted"> ({signed(pos.pnlPct)}%)</span>
                          )}
                        </td>
                        <td className={`r num ${open > 0 ? "dcb-open" : "muted"}`}>
                          {open > 0 ? dollars(open) : "—"}
                        </td>
                        <td>
                          <span className="dcb-mix">
                            <span className="dcb-tbar" aria-hidden="true">
                              <span
                                className="dcb-tnow"
                                style={{ width: `${(now / mix.scale) * 100}%` }}
                              />
                              <span
                                className="dcb-ttarget"
                                style={{ left: `${(target / mix.scale) * 100}%` }}
                              />
                            </span>
                            <span className="num">
                              {Math.round(now)}%{" "}
                              <span className="muted">of {Math.round(target * 10) / 10}%</span>
                            </span>
                          </span>
                        </td>
                        <td className="r">
                          <button
                            type="button"
                            className="link"
                            disabled={!(Number(pos.qty) > 0)}
                            onClick={() => setSheet({ kind: "trim", position: pos })}
                          >
                            Trim
                          </button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="dcb-note">
            Each coin is one position for life. Only orders placed from the desk count: buys or
            sells on Binance outside it, transfers to your Ledger and staking are ignored, so the
            book can differ from your Binance balance. Tax parcels are on the Tax page.
          </p>
        </section>

        {said && (
          <p className="muted" role="status">
            {said}
          </p>
        )}

        <Planner key={planning ? "plan" : "week"} book={book} onPlaced={load} start={planning} />

        {funds && (
          <DcaFunds
            key={funds}
            side={funds}
            quote={book.quote}
            onClose={() => setFunds(null)}
            onPlaced={(words) => {
              setSaid(words);
              load();
            }}
          />
        )}

        {book.orders.some((o) => isOpen(o) && o.kind === "limit") && (
          <DcaOpen
            orders={book.orders.filter((o) => isOpen(o) && o.kind === "limit")}
            quote={book.quote}
            prices={Object.fromEntries(book.positions.map((x) => [x.coin, x.price]))}
            onChanged={(words) => {
              setSaid(words);
              load();
            }}
          />
        )}

        <button type="button" className="dcb-more" aria-expanded={more} onClick={toggleMore}>
          {more ? "Show less" : "Show more: every order, the 3-year plan, Check against Binance"}
        </button>
        {more && (
          <>
            <Ticks book={book} />
            <section className="dcb-section" aria-labelledby="dcb-orders-title">
              <div className="dcb-section-head">
                <h2 id="dcb-orders-title">Every order</h2>
                <div className="dcb-filters" role="group" aria-label="Show">
                  {["all", ...book.positions.map((x) => x.coin), "trims"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                    >
                      {f === "all" ? "All" : f === "trims" ? "Trims" : f}
                    </button>
                  ))}
                  <label className="dcb-hide-toggle">
                    <input type="checkbox" checked={hideCancelled} onChange={toggleHide} />
                    Hide cancelled
                  </label>
                  <button
                    type="button"
                    className="link"
                    disabled={!book.orders.length}
                    onClick={exportCsv}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={checking}
                    onClick={() => runCheck(false)}
                  >
                    {checking ? "Checking Binance…" : "Check against Binance"}
                  </button>
                </div>
              </div>
              {checked && <Checked found={checked} busy={checking} onFix={() => runCheck(true)} />}
              {shown.length === 0 ? (
                <p className="muted">No orders here yet.</p>
              ) : (
                renderOrders(shown, "Every order")
              )}
            </section>
          </>
        )}

        {openCoin && (
          <PositionDrawer
            key={openCoin}
            book={book}
            coin={openCoin}
            onClose={() => setOpenCoin(null)}
            onTrim={(pos) => {
              setOpenCoin(null);
              setSheet({ kind: "trim", position: pos });
            }}
            renderOrders={renderOrders}
          />
        )}
        {sheet && (
          <OrderSheet
            key={sheetKey}
            sheet={sheet}
            book={book}
            onClose={() => setSheet(null)}
            onDone={(words) => {
              setSheet(null);
              setSaid(words);
              load();
            }}
          />
        )}
        {viewing &&
          (() => {
            const o = book.orders.find((x) => x.ref === viewing.ref);
            return o ? (
              <OrderPanel
                key={`${o.ref}-${viewing.edit ? "e" : "v"}`}
                order={o}
                others={book.orders.filter(
                  (x) => x.coin === o.coin && x.ref !== o.ref && isOpen(x) && x.kind === "limit",
                )}
                quote={book.quote}
                editing={viewing.edit}
                onClose={() => setViewing(null)}
                onCancel={() => setCancelling(o)}
                onDone={(words) => {
                  setViewing(null);
                  setSaid(words);
                  load();
                }}
              />
            ) : null;
          })()}
        {cancelling && (
          <CancelDialog
            list={[cancelling]}
            quote={book.quote}
            onKeep={() => setCancelling(null)}
            onDone={(words) => {
              setCancelling(null);
              setViewing(null);
              setSaid(words);
              load();
            }}
          />
        )}
      </div>
      <DcaChat
        hasOpen={book.orders.some((o) => isOpen(o) && o.kind === "limit")}
        open={chatOpen}
        onOpen={openChat}
        onDone={load}
      />
    </main>
  );
}
