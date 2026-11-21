// The DCA book (TODO 11): five lifelong positions, one per coin, fed only by orders placed from
// the desk. A sentence, three years as weekly ticks, this week's planner, the positions and
// every order. A trim sells a slice and its buy-back is linked to it; tax parcels stay on Tax.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  cancelDcaOrder,
  dcaOdds,
  getDcaBook,
  placeDcaAdd,
  placeDcaOrder,
  placeDcaSell,
  previewDcaAdd,
  previewDcaSell,
  sellCheck,
  strategize,
  setDcaPlan,
} from "./api";
import { errorOf } from "./format";
import CoinIcon from "./CoinIcon";
import { colourOf, PlanPanel, WeekBar } from "./DcaCards";
import { PctKey, PctStrip, scaleFor } from "./PctStrip";
import CoinFunds from "./CoinFunds";
import { Holding, PositionActions, PositionName } from "./PositionCells";
import TakeProfitPanel from "./TakeProfitPanel";
import DcaChat from "./DcaChat";
import PositionDrawer from "./DcaPosition";
import { Live } from "./Figures";
import { FoldHead, useFold } from "./Fold";
import DcaFunds from "./DcaFunds";
import DcaOrderDrawer from "./DcaOrderDrawer";
import DcaOrders, { CancelDialog } from "./DcaOrders";
import { dollars, STATUS, isOpen, qty, signed, two, wholeDollars, roundPrice } from "./dcaFormat";
import type {
  DcaBook,
  DcaOdds,
  DcaOrder,
  DcaOrderRequest,
  DcaPlan,
  DcaPosition,
  SellCheck,
} from "./types";

const oddsWords = (o: DcaOdds | null) =>
  !o
    ? "—"
    : o.weeks === 0
      ? "No history"
      : o.few
        ? `${o.hit} of ${o.weeks} wk`
        : `${o.pct}% (${o.hit} of ${o.weeks})`;

// ---------------------------------------------------------------- the plan

const BLANK_PLAN: DcaPlan = {
  start: new Date().toISOString().slice(0, 10),
  weeks: 156,
  orders: [{ coin: "BTC", spend: "", odds: 60 }],
};

// A date input opens its calendar on the first click; clicked again once focused, it types
// (owner, 21 Nov 2026: both).
const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
  if (document.activeElement === e.currentTarget) return; // focused: let it type
  try {
    e.currentTarget.showPicker();
  } catch {
    // an older browser: the input works as typed
  }
};
const DAY = 86_400_000;
const addWeeks = (start: string, weeks: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + weeks * 7 * DAY).toISOString().slice(0, 10);
const weeksBetween = (start: string, end: string) =>
  Math.min(
    520,
    Math.max(
      1,
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (7 * DAY)),
    ),
  );

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
  // A week's money by coin, biggest first, for the split bar.
  const byCoin = [
    ...draft.orders
      .filter((o) => o.coin && Number(o.spend) > 0)
      .reduce(
        (m, o) => m.set(o.coin, (m.get(o.coin) ?? 0) + Number(o.spend)),
        new Map<string, number>(),
      ),
  ].sort((x, y) => y[1] - x[1]);
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
      {/* The plan at a glance (owner, 21 Nov 2026: sleeker): what a week buys, split by coin,
          over the dates; each order one compact row. */}
      <div className="dpf-head">
        <h2>{plan ? "Change the weekly plan" : "Your weekly plan"}</h2>
        <span className="dpf-sum num">
          <b>{wholeDollars(String(total))}</b> a week · {wholeDollars(String(total * draft.weeks))}{" "}
          over {draft.weeks} {draft.weeks === 1 ? "week" : "weeks"}
        </span>
      </div>
      {total > 0 && (
        <div className="dpf-split" aria-hidden="true">
          <span className="dpf-bar">
            {byCoin.map(([c, v], k) => (
              <i key={c} style={{ width: `${(v / total) * 100}%`, background: colourOf(c, k) }} />
            ))}
          </span>
          <span className="dpf-key">
            {byCoin.map(([c, v], k) => (
              <span key={c}>
                <i style={{ background: colourOf(c, k) }} />
                {c} {Math.round((v / total) * 100)}%
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="dcb-planhead">
        <label>
          Starts
          <input
            type="date"
            value={draft.start}
            onMouseDown={openPicker}
            onChange={(e) => e.target.value && setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label>
          Ends
          <input
            type="date"
            min={draft.start}
            value={addWeeks(draft.start, draft.weeks)}
            onMouseDown={openPicker}
            onChange={(e) =>
              e.target.value &&
              setDraft({ ...draft, weeks: weeksBetween(draft.start, e.target.value) })
            }
          />
        </label>
      </div>
      <div className="dpf-rows" role="table" aria-label="Weekly orders">
        <div className="dpf-row dpf-labels" role="row">
          <span role="columnheader">Coin</span>
          <span role="columnheader">Each week</span>
          <span
            role="columnheader"
            title="The share of past weeks a limit at that depth filled by Monday evening; the desk picks the price to match. Higher fills more often, lower buys cheaper."
          >
            Fill odds ⓘ
          </span>
          <span />
        </div>
        {draft.orders.map((o, i) => (
          <div className="dpf-row" role="row" key={i}>
            <span className="dpf-coin" role="cell">
              {o.coin ? <CoinIcon coin={o.coin} /> : <i className="dpf-dot" />}
              <input
                aria-label={`Order ${i + 1} coin`}
                placeholder="Coin"
                value={o.coin}
                onChange={(e) => row(i, { coin: e.target.value.toUpperCase() })}
              />
            </span>
            <span className="dpf-field" role="cell">
              <small>$</small>
              <input
                aria-label={`Order ${i + 1} amount`}
                inputMode="decimal"
                value={o.spend}
                onChange={(e) => row(i, { spend: e.target.value })}
              />
            </span>
            <span className="dpf-field" role="cell">
              <input
                aria-label={`Order ${i + 1} fill odds`}
                type="number"
                min={5}
                max={95}
                value={o.odds}
                onChange={(e) => row(i, { odds: Number(e.target.value) })}
              />
              <small>%</small>
            </span>
            <button
              type="button"
              className="dpf-x"
              aria-label={`Remove order ${i + 1}`}
              disabled={draft.orders.length === 1}
              onClick={() => setDraft({ ...draft, orders: draft.orders.filter((_, k) => k !== i) })}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="link dpf-add"
        onClick={() =>
          setDraft({ ...draft, orders: [...draft.orders, { coin: "", spend: "", odds: 60 }] })
        }
      >
        + Add an order
      </button>
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

// ---------------------------------------------------------------- one order, trims, buy-backs

type Sheet =
  | {
      kind: "buy";
      coin: string;
      source: "desk" | "buy-back";
      link?: string;
      spend?: string;
      price?: string;
    }
  | { kind: "trim"; position: DcaPosition; qty?: string; price?: string };

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
  const [price, setPrice] = useState(
    sheet.kind === "trim" ? (sheet.price ?? sheet.position.price ?? "") : (sheet.price ?? ""),
  );
  const [amount, setAmount] = useState(
    sheet.kind === "buy" ? (sheet.spend ?? "") : (sheet.qty ?? ""),
  );
  const [odds, setOdds] = useState<DcaOdds | null>(null);
  const [tax, setTax] = useState<SellCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  // The form's button (or Enter) only shows what will be sent; Place sends it (audit 13).
  const [reviewing, setReviewing] = useState(false);

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
  const at = market ? "at market" : `at ${price}`;
  const about =
    !market && Number(price) > 0 && Number(amount) > 0
      ? `, about ${two(Number(amount) * Number(price))} ${book.quote}`
      : "";
  const summary = trim
    ? `Sell ${amount} ${coin} ${at}${about}.`
    : `Buy ${amount} ${book.quote} of ${coin} ${at}.`;
  const review = () => {
    setError(null);
    if (!(Number(amount) > 0) || (!market && !(Number(price) > 0))) {
      setError(trim ? "Enter a quantity and a price." : "Enter an amount and a price.");
      return;
    }
    setReviewing(true);
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
          if (!reviewing) review();
        }}
      >
        <fieldset className="dcb-sheet-fields" disabled={reviewing || busy}>
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
                    changeAmount(
                      String(Math.floor(holding * pct * 1e6) / 1e8).replace(/\.?0+$/, ""),
                    )
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
        </fieldset>
        {reviewing && (
          <p className="dcb-review" role="status">
            {summary}
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dlg-btns">
          {reviewing ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setReviewing(false);
                setHeld(false);
              }}
            >
              Back
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Don't place
            </button>
          )}
          {!reviewing ? (
            <button type="submit" className={`btn ${trim ? "btn-danger" : "btn-accent"}`}>
              Review
            </button>
          ) : held ? (
            <button type="button" className="btn" disabled={busy} onClick={() => send(true)}>
              Place anyway (logged)
            </button>
          ) : (
            <button
              type="button"
              className={`btn ${trim ? "btn-danger" : "btn-accent"}`}
              disabled={busy}
              onClick={() => send()}
            >
              {trim ? `Sell ${coin}` : `Buy ${coin}`}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- money per coin

// What sits in open buy orders, for a coin or the whole book.
const openOf = (book: DcaBook, coin?: string) =>
  book.orders
    .filter((o) => isOpen(o) && o.side === "buy" && (!coin || o.coin === coin))
    .reduce((s, o) => s + Number(o.spend ?? 0), 0);

// The chat and the positions' view are remembered per browser; storage may be blocked, then they start
// closed.
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

// ---------------------------------------------------------------- the page

type DcaSort = "coin" | "added" | "value" | "pnl";
type SortState = { key: DcaSort; down: boolean } | null;

function sortedPositions(list: DcaPosition[], sort: SortState): DcaPosition[] {
  if (!sort) return list;
  const fig = (p: DcaPosition): number | string =>
    sort.key === "coin"
      ? p.coin
      : sort.key === "added"
        ? Number(p.added)
        : sort.key === "value"
          ? Number(p.value ?? 0)
          : p.pnlPct === null
            ? -Infinity
            : Number(p.pnlPct);
  return [...list].sort((a, b) => {
    const x = fig(a);
    const y = fig(b);
    const order = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
    return order * (sort.down ? -1 : 1);
  });
}
const ariaSort = (sort: SortState, key: DcaSort) =>
  sort?.key === key ? (sort.down ? "descending" : "ascending") : "none";
function sortButton(
  sort: SortState,
  setSort: (f: (s: SortState) => SortState) => void,
  key: DcaSort,
  label: string,
) {
  return (
    <button
      type="button"
      className="sort-btn"
      onClick={() => setSort((s) => ({ key, down: s?.key === key ? !s.down : key !== "coin" }))}
    >
      {label}
      <span aria-hidden="true">{sort?.key === key ? (sort.down ? " ↓" : " ↑") : ""}</span>
    </button>
  );
}

// A position opened in place: its waiting limits one by one, then its buys a week to a row
// (the newest six), so a coin with hundreds of orders stays short; the panel has them all.
const WEEKS_SHOWN = 6;
function OpenOrders({
  orders,
  now,
  held,
  funds,
  onPanel,
  onTakeProfit,
  onAddFunds,
}: {
  orders: DcaOrder[];
  now: number | null;
  held: boolean;
  funds?: ReactNode; // Add funds, open in the row
  onPanel: () => void;
  onTakeProfit: () => void;
  onAddFunds: () => void;
}) {
  const waiting = orders
    .filter((o) => isOpen(o) && Number(o.price) > 0)
    .sort((a, b) => Number(b.price) - Number(a.price));
  const done = orders.filter((o) => o.status === "filled" && Number(o.filledQuote) > 0);
  const weeks = new Map<string, { buys: number; sells: number; spent: number; qty: number }>();
  for (const o of done) {
    const w = weeks.get(o.week) ?? { buys: 0, sells: 0, spent: 0, qty: 0 };
    if (o.side === "buy") {
      w.buys += 1;
      w.spent += Number(o.filledQuote);
      w.qty += Number(o.filledQty);
    } else {
      w.sells += 1;
    }
    weeks.set(o.week, w);
  }
  const rows = [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const live = orders.filter((o) => o.status !== "cancelled").length;
  return (
    <>
      <table className="dcb-table cps-orders num">
        <thead>
          <tr>
            <th>Order</th>
            <th className="r">Price</th>
            <th className="r">From now</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {waiting.map((o) => {
            const away = now ? (Number(o.price) / now - 1) * 100 : null;
            const sell = o.side === "sell";
            return (
              <tr key={o.ref}>
                <td>
                  <span className={`pot-tag ${sell ? "is-sell" : "is-wait"}`}>
                    {sell ? "Selling" : "Waiting"}
                  </span>
                </td>
                <td className="r">{roundPrice(o.price)}</td>
                <td className="r muted">
                  {away === null
                    ? "—"
                    : `fills ${Math.abs(away).toFixed(1)}% ${away > 0 ? "higher" : "lower"}`}
                </td>
                <td className="r">
                  {wholeDollars(sell ? String(Number(o.qty) * Number(o.price)) : (o.spend ?? "0"))}
                </td>
              </tr>
            );
          })}
          {rows.slice(0, WEEKS_SHOWN).map(([week, w]) => (
            <tr key={week}>
              <td>
                <span className="pot-tag is-live">Bought</span>{" "}
                <span className="muted">
                  {week} · {w.buys} {w.buys === 1 ? "buy" : "buys"}
                  {w.sells ? ` · ${w.sells} sold` : ""}
                </span>
              </td>
              <td className="r">{w.qty > 0 ? `avg ${roundPrice(w.spent / w.qty)}` : "—"}</td>
              <td className="r muted">—</td>
              <td className="r">{wholeDollars(String(w.spent))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PositionActions onTakeProfit={held ? onTakeProfit : undefined} onAddFunds={onAddFunds}>
        <button type="button" className="btn btn-small" onClick={onPanel}>
          Orders{live > 0 ? ` · ${live}` : ""}
        </button>
      </PositionActions>
      {funds}
    </>
  );
}

export default function DcaBookPage() {
  const [book, setBook] = useState<DcaBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const setSheet = (next: Sheet | null) => {
    if (next) setSheetKey((k) => k + 1);
    setSheetState(next);
  };
  const [said, setSaid] = useState<string | null>(null);
  // The Dashboard's links open the book at Add funds or Remove funds.
  // The Dashboard's "Plan this week" opens the weekly one.
  const [funds, setFunds] = useState<"add" | "remove" | "weekly" | null>(() => {
    const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const asked = query.get("funds");
    if (asked === "add" || asked === "remove") return asked;
    return query.has("plan") ? "weekly" : null;
  });
  const [cancelling, setCancelling] = useState<DcaOrder | null>(null);
  // Take profit on a coin, or add funds to it (owner, 21 Nov 2026), as on the Trade page.
  const [selling, setSelling] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ ref: string; edit: boolean } | null>(null);
  const weeklyAmount = String(
    (book?.plan?.orders ?? []).reduce((sum, o) => sum + Number(o.spend), 0) || "",
  );
  const asked = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const chatting = asked.has("chat");
  // The Dashboard's coin links open that position with its orders; the Tax tab's rebalance
  // link opens a Trim or Add order filled in instead, for review (audit 17).
  const rebalance = useRef(
    asked.get("rebalance") === "sell" || asked.get("rebalance") === "buy"
      ? {
          coin: asked.get("coin") ?? "",
          side: asked.get("rebalance") as "sell" | "buy",
          price: asked.get("price") ?? "",
          qty: asked.get("qty") ?? "",
        }
      : null,
  );
  const [openCoin, setOpenCoin] = useState<string | null>(() =>
    asked.has("rebalance") ? null : asked.get("coin"),
  );
  // A row opens in place (owner, 21 Nov 2026), like the Trade page's; the full panel (facts,
  // Trim) is a click away from there.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [posOpen, togglePos] = useFold("dcb-pos");
  // The positions table sorts like the Portfolio's and the Trade page's: figures high to low
  // on the first click, the coin A to Z; the plan's own order until then.
  const [sort, setSort] = useState<{ key: DcaSort; down: boolean } | null>(null);
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
    const want = rebalance.current;
    if (!book || !want) return;
    rebalance.current = null; // once, on the first read of the book
    const pos = book.positions.find((p) => p.coin === want.coin);
    const spend = (Number(want.qty) * Number(want.price)).toFixed(2);
    if (!pos || (want.side === "sell" && !(Number(pos.qty) > 0))) {
      setSaid(
        `${want.coin} isn't held in the DCA book, so rebalance it where it's held: ${want.side} ${want.qty} at ${want.price}.`,
      );
      return;
    }
    setSheet(
      want.side === "sell"
        ? { kind: "trim", position: pos, qty: want.qty, price: want.price }
        : { kind: "buy", coin: want.coin, source: "desk", spend, price: want.price },
    );
  }, [book]);
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
  // One scale for the Limits column: every coin's limits, fills and average in % from now.
  const stripScale = scaleFor(
    book.positions.map((p) => ({
      now:
        Number(p.qty) > 0 && p.value !== null
          ? Number(p.value) / Number(p.qty)
          : Number(p.price ?? 0) || null,
      prices: [
        ...book.orders
          .filter((o) => o.coin === p.coin && o.side === "buy" && o.status !== "cancelled")
          .map((o) => Number(o.avgPrice ?? o.price ?? 0))
          .filter((x) => x > 0),
        ...(p.avgCost ? [Number(p.avgCost)] : []),
      ],
    })),
  );

  const t = book.totals;
  const p = book.progress;
  const openTotal = openOf(book);
  // The open limits in a few words: how many, and how far the closest one is from its price.
  const limitsNow = book.orders.filter(
    (o) => isOpen(o) && o.side === "buy" && o.kind === "limit" && Number(o.price) > 0,
  );
  const closestAway = limitsNow
    .map((o) => {
      const pos = book.positions.find((x) => x.coin === o.coin);
      const held = Number(pos?.qty ?? 0);
      const now = held > 0 && pos?.value ? Number(pos.value) / held : 0;
      return now > 0 ? Math.max(0, (1 - Number(o.price) / now) * 100) : null;
    })
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b)[0];
  const openWords = limitsNow.length
    ? `${limitsNow.length} ${limitsNow.length === 1 ? "limit" : "limits"}${closestAway !== undefined ? `, closest ${closestAway.toFixed(1)}% away` : ""}`
    : "none waiting";
  const pnl = Number(t.pnl);

  return (
    <main className={`wrap dcb${chatOpen ? " has-chat" : ""}`}>
      <div className="dcb-main">
        {/* No headline and no button row (owner, 21 Nov 2026): the tiles say it; this week's
            buy and the plan's edit live on the Plan panel; adding to or taking from a coin is
            in its row. */}
        <h1 className="visually-hidden">DCA book</h1>
        <dl className="dcb-figs num">
          <div>
            <dt>Put in</dt>
            <dd>{wholeDollars(t.added)}</dd>
            {p && (
              <small>
                week {p.week} of {p.weeks}
              </small>
            )}
          </div>
          <div>
            <dt>Value</dt>
            <dd>
              <Live value={t.value}>{wholeDollars(t.value)}</Live>
            </dd>
            <small>{book.priceError ? "prices missing" : "live from Binance"}</small>
          </div>
          <div>
            <dt>P&amp;L</dt>
            <dd className={`dcb-pnl ${pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : ""}`}>
              <Live value={t.pnl}>{wholeDollars(t.pnl, true)}</Live>
            </dd>
            <small>
              {t.pnlPct !== null ? `${signed(t.pnlPct)}% · ` : ""}fees {dollars(t.fees)}
              {Number(t.realised) ? ` · ${wholeDollars(t.realised, true)} realised` : ""}
            </small>
          </div>
          <div>
            <dt>Open limits</dt>
            <dd className={openTotal > 0 ? "dcb-open" : ""}>{wholeDollars(openTotal)}</dd>
            <small>{openWords}</small>
          </div>
        </dl>
        <PlanPanel
          book={book}
          actions={
            <>
              <button
                type="button"
                className="btn btn-small btn-accent"
                disabled={!weeklyAmount}
                title={`This week's ${weeklyAmount} ${book.quote}, split by your plan`}
                onClick={() => setFunds(funds === "weekly" ? null : "weekly")}
              >
                Buy this week
              </button>
              <button type="button" className="link" onClick={() => setEditing(true)}>
                Edit
              </button>
            </>
          }
        />
        {funds && (
          <DcaFunds
            key={funds}
            side={funds === "remove" ? "remove" : "add"}
            weekly={funds === "weekly" ? weeklyAmount : undefined}
            quote={book.quote}
            onClose={() => setFunds(null)}
            onPlaced={(words) => {
              setSaid(words);
              load();
            }}
          />
        )}
        {book.priceError && (
          <p className="dcb-warn" role="alert">
            Binance didn't answer ({book.priceError}), so value and P&amp;L are missing. Quantities
            and costs are from the desk's own records.
          </p>
        )}

        <section
          className={`dcb-section${posOpen ? "" : " is-folded"}`}
          aria-labelledby="dcb-pos-title"
        >
          <div className="dcb-section-head">
            <FoldHead
              id="dcb-pos"
              open={posOpen}
              onToggle={togglePos}
              title={
                <span title="Each coin is one position for life. Only orders placed from the desk count: buys or sells on Binance outside it, transfers to your Ledger and staking are ignored, so the book can differ from your Binance balance. Tax parcels are on the Tax page.">
                  Positions
                </span>
              }
              summary={`${book.positions.length} coins`}
            />
          </div>
          {posOpen && (
            <div id="dcb-pos-body">
              {
                <div className="dcb-scroll">
                  <table className="dcb-table" aria-label="Positions">
                    <thead>
                      <tr>
                        <th aria-sort={ariaSort(sort, "coin")}>
                          {sortButton(sort, setSort, "coin", "Position")}
                        </th>
                        <th aria-sort={ariaSort(sort, "added")}>
                          {sortButton(sort, setSort, "added", "Plan to date")}
                        </th>
                        <th>
                          Limits <PctKey />
                        </th>
                        <th aria-sort={ariaSort(sort, sort?.key === "pnl" ? "pnl" : "value")}>
                          {sortButton(sort, setSort, "value", "Holding")} ·{" "}
                          {sortButton(sort, setSort, "pnl", "P&L %")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPositions(book.positions, sort).map((pos) => {
                        const n = Number(pos.pnl);
                        const opened = expanded === pos.coin;
                        const nowPx =
                          Number(pos.qty) > 0 && pos.value !== null
                            ? Number(pos.value) / Number(pos.qty)
                            : Number(pos.price ?? 0) || null;
                        const mine = book.orders.filter((o) => o.coin === pos.coin);
                        return (
                          <Fragment key={pos.coin}>
                            {/* The whole row opens the coin: the name's button is stretched over it
                          (dca.css), and Trim sits above. */}
                            <tr
                              id={`pos-${pos.coin}`}
                              className={`dcb-row-open${opened ? " is-open" : ""}`}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="dcb-expand"
                                  aria-expanded={opened}
                                  onClick={() => setExpanded(opened ? null : pos.coin)}
                                >
                                  <PositionName
                                    coin={pos.coin}
                                    kind="DCA"
                                    since={pos.since}
                                    extra={
                                      mine.length
                                        ? `${mine.length} ${mine.length === 1 ? "order" : "orders"}`
                                        : undefined
                                    }
                                  />
                                </button>
                              </td>
                              <td>
                                <WeekBar book={book} coin={pos.coin} />
                              </td>
                              <td className="dcb-strip-cell">
                                <PctStrip
                                  now={nowPx}
                                  avg={pos.avgCost ? Number(pos.avgCost) : null}
                                  fills={mine
                                    .filter(
                                      (o) =>
                                        o.side === "buy" && o.status === "filled" && o.avgPrice,
                                    )
                                    .map((o) => Number(o.avgPrice))}
                                  limits={mine
                                    .filter(
                                      (o) => o.side === "buy" && isOpen(o) && Number(o.price) > 0,
                                    )
                                    .map((o) => ({
                                      price: Number(o.price),
                                      spend: Number(o.spend ?? 0),
                                    }))}
                                  scale={stripScale}
                                />
                              </td>
                              <td className="num">
                                {/* Value with its P&L, then the average against the price now: whether
                              this week's buys bring the average down. */}
                                <Holding
                                  value={pos.value === null ? null : Number(pos.value)}
                                  pnl={n}
                                  pnlPct={pos.pnlPct === null ? null : Number(pos.pnlPct)}
                                  avg={
                                    Number(pos.qty) > 0 && pos.avgCost ? Number(pos.avgCost) : null
                                  }
                                  now={nowPx}
                                />
                              </td>
                            </tr>
                            {opened && (
                              <tr className="cps-open-row">
                                <td colSpan={4}>
                                  <OpenOrders
                                    orders={mine}
                                    now={nowPx}
                                    held={Number(pos.qty) > 0}
                                    onPanel={() => setOpenCoin(pos.coin)}
                                    onTakeProfit={() => {
                                      setAdding(null);
                                      setSelling(selling === pos.coin ? null : pos.coin);
                                    }}
                                    onAddFunds={() => {
                                      setSelling(null);
                                      setAdding(adding === pos.coin ? null : pos.coin);
                                    }}
                                    funds={
                                      selling === pos.coin ? (
                                        <TakeProfitPanel
                                          coin={pos.coin}
                                          label={`DCA-${pos.coin}`}
                                          live={mine
                                            .filter((o) => o.side === "sell" && isOpen(o))
                                            .map((o) => ({
                                              ref: o.ref,
                                              price: o.price,
                                              qty: o.qty ?? "0",
                                              value: o.price
                                                ? Number(o.qty) * Number(o.price)
                                                : null,
                                            }))}
                                          preview={(plan) =>
                                            previewDcaSell({ coin: pos.coin, ...plan })
                                          }
                                          place={(plan, anyway) =>
                                            placeDcaSell({ coin: pos.coin, ...plan, anyway }).then(
                                              (b) => setBook(b),
                                            )
                                          }
                                          cancelLive={(ref) =>
                                            cancelDcaOrder(ref).then(() => load())
                                          }
                                          agent="dca-agent"
                                          strategize={(b) =>
                                            strategize({
                                              ...b,
                                              book: "dca",
                                              mode: "sell",
                                              coin: pos.coin,
                                            })
                                          }
                                          onClose={() => setSelling(null)}
                                          onPlaced={(words) => {
                                            setSelling(null);
                                            setSaid(`${words} Each is a trim in the book.`);
                                            load();
                                          }}
                                        />
                                      ) : (
                                        adding === pos.coin && (
                                          <CoinFunds
                                            coin={pos.coin}
                                            quote={book.quote}
                                            waiting={{
                                              count: mine.filter(
                                                (o) =>
                                                  o.side === "buy" &&
                                                  o.kind === "limit" &&
                                                  isOpen(o),
                                              ).length,
                                              usd: mine
                                                .filter(
                                                  (o) =>
                                                    o.side === "buy" &&
                                                    o.kind === "limit" &&
                                                    isOpen(o),
                                                )
                                                .reduce((s, o) => s + Number(o.spend ?? 0), 0),
                                            }}
                                            preview={previewDcaAdd}
                                            place={placeDcaAdd}
                                            agent="dca-agent"
                                            strategize={(b) =>
                                              strategize({
                                                ...b,
                                                book: "dca",
                                                mode: "add",
                                                coin: pos.coin,
                                              })
                                            }
                                            onClose={() => setAdding(null)}
                                            onPlaced={(words) => {
                                              setAdding(null);
                                              setSaid(words);
                                              load();
                                            }}
                                          />
                                        )
                                      )
                                    }
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
            </div>
          )}
        </section>

        {said && (
          <p className="muted" role="status">
            {said}
          </p>
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
            orders={
              <DcaOrders
                book={book}
                coin={openCoin}
                onChanged={(words) => {
                  setSaid(words);
                  load();
                }}
                onBuyBack={(o) => {
                  setOpenCoin(null);
                  setSheet({
                    kind: "buy",
                    coin: o.coin,
                    source: "buy-back",
                    link: o.ref,
                    spend: String(Math.floor(Number(o.filledQuote) * 100) / 100),
                  });
                }}
              />
            }
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
              <DcaOrderDrawer
                key={`${o.ref}-${viewing.edit ? "e" : "v"}`}
                order={o}
                book={book}
                editing={viewing.edit}
                onClose={() => setViewing(null)}
                onCancel={() => setCancelling(o)}
                onOpen={(ref) => setViewing({ ref, edit: false })}
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
