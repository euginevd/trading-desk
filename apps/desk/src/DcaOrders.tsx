// Every order on the DCA book in one section, the way an exchange lists them: a line of what
// matters this week, filters (state, coin, source, week, a search by reference) and grouping,
// remembered per browser; one table with the same columns for every state; tick open orders to
// cancel them, move them by a percentage or dedupe them; and a ⋯ menu (or a click on the row)
// to view an order on its chart, modify or cancel it.
// Binance can't change a limit in place, so Modify and Move cancel the old order and place a
// new one under a new reference, linked to it; the book keeps both (dca_orders is append-only).
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { amendDcaOrder, cancelDcaOrder, fundsOdds } from "./api";
import { errorOf } from "./format";
import { FoldHead, useFold } from "./Fold";
import CoinIcon from "./CoinIcon";
import DcaOrderDrawer, { away, left, pct, qtyOf, since } from "./DcaOrderDrawer";
import { SOURCE, STATUS, amountOf, isOpen, limit, qty as fmtQty, two, when } from "./dcaFormat";
import type { DcaBook, DcaOrder } from "./types";

type State = "open" | "filled" | "cancelled" | "all";
type Week = "this" | "last4" | "all";
type Group = "none" | "coin" | "week";
interface Filters {
  state: State;
  coin: string;
  source: string;
  week: Week;
  group: Group;
}
const KEY = "desk.dca.orders";
const START: Filters = { state: "open", coin: "all", source: "all", week: "this", group: "none" };
function readFilters(): Filters {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Filters>;
    return { ...START, ...kept };
  } catch {
    return START;
  }
}
function saveFilters(f: Filters) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // not kept: the defaults next time
  }
}

const stateOf = (o: DcaOrder): Exclude<State, "all"> =>
  isOpen(o) ? "open" : o.status === "filled" ? "filled" : "cancelled";
const canEdit = (o: DcaOrder) => isOpen(o) && o.kind === "limit";

// Orders sharing a coin, side and price, oldest first: the oldest is kept by default.
function samePrice(orders: DcaOrder[]): DcaOrder[][] {
  const groups = new Map<string, DcaOrder[]>();
  for (const o of orders) {
    const key = `${o.coin}|${o.side}|${Number(o.price)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => a.created - b.created));
}

// What cancelling does, in a line the confirm shows.
function afterCancel(list: DcaOrder[], quote: string): string {
  const usd = list.reduce((s, o) => s + left(o), 0);
  const weekly = list.some((o) => o.source === "weekly" && o.side === "buy");
  return (
    `They come off Binance straight away and $${two(usd)} ${quote} is free to spend again. ` +
    "Each reference stays in the book as cancelled and is never reused; anything already filled is kept." +
    (weekly
      ? " What a cancelled limit didn't buy shows as not placed yet at Monday's close-out."
      : "")
  );
}

export default function DcaOrders({
  book,
  onChanged,
  onBuyBack,
  tools,
  below,
  coin,
}: {
  book: DcaBook;
  onChanged: (said: string) => void;
  onBuyBack: (o: DcaOrder) => void;
  tools?: ReactNode;
  below?: ReactNode;
  // One coin's orders, in its panel (owner, 21 Nov 2026: the page-wide list moved there).
  coin?: string;
}) {
  const quote = book.quote;
  const orders = coin ? book.orders.filter((o) => o.coin === coin) : book.orders;
  const [f, setF] = useState<Filters>(readFilters);
  const [folded, toggleExpanded] = useFold("dco");
  const expanded = coin ? true : folded;
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ ref: string; edit: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<DcaOrder[] | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [moving, setMoving] = useState(false);
  const [odds, setOdds] = useState<Record<string, number | null>>({});

  const set = (change: Partial<Filters>) =>
    setF((was) => {
      const next = { ...was, ...change };
      saveFilters(next);
      return next;
    });

  const prices = useMemo(
    () => Object.fromEntries(book.positions.map((p) => [p.coin, Number(p.price ?? 0)])),
    [book.positions],
  );
  const coins = book.positions.map((p) => p.coin);
  const sources = [...new Set(orders.map((o) => o.source))];
  const weeks = [...new Set(orders.map((o) => o.week))].sort().reverse();
  const recent = new Set(weeks.filter((w) => w <= book.week.key).slice(0, 4));
  const open = orders.filter(isOpen);
  const groups = samePrice(open.filter((o) => o.kind === "limit"));
  const backed = new Set(orders.filter((o) => o.source === "buy-back").map((o) => o.link));

  // The 24-hour odds of each open limit, from the desk's own count (no model).
  const oddsKey = open
    .filter(canEdit)
    .map((o) => `${o.ref}@${o.price}`)
    .join(",");
  useEffect(() => {
    let on = true;
    for (const o of orders.filter(canEdit)) {
      fundsOdds(o.coin, o.price ?? "0", o.side === "sell" ? "remove" : "add").then(
        (r) => on && setOdds((all) => ({ ...all, [`${o.ref}@${o.price}`]: r.pct })),
        () => undefined,
      );
    }
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the open limits change
  }, [oddsKey]);
  const oddsOf = (o: DcaOrder) => odds[`${o.ref}@${o.price}`] ?? null;

  // Every filter but the state, so each state chip can say how many it holds.
  const needle = search.trim().toUpperCase();
  const base = orders.filter(
    (o) =>
      (coin !== undefined || f.coin === "all" || o.coin === f.coin) &&
      (f.source === "all" || o.source === f.source) &&
      (f.week === "all" || (f.week === "this" ? o.week === book.week.key : recent.has(o.week))) &&
      (!needle || o.ref.toUpperCase().includes(needle)),
  );
  const count = (s: State) =>
    s === "all" ? base.length : base.filter((o) => stateOf(o) === s).length;
  const shown = base.filter((o) => f.state === "all" || stateOf(o) === f.state);
  const openElsewhere = open.filter((o) => !base.includes(o)).length;

  const rows: { head?: string; orders: DcaOrder[] }[] =
    f.group === "none"
      ? [{ orders: shown }]
      : [...new Set(shown.map((o) => (f.group === "coin" ? o.coin : o.week)))].map((k) => ({
          head: k,
          orders: shown.filter((o) => (f.group === "coin" ? o.coin : o.week) === k),
        }));

  // The line of what matters this week.
  const waiting = open.reduce((s, o) => s + (o.side === "buy" ? left(o) : 0), 0);
  const nearest = open
    .filter(canEdit)
    .map((o) => ({ o, off: away(Number(o.price), prices[o.coin] ?? 0) }))
    .filter((x) => x.off !== null)
    .sort((a, b) => Math.abs(a.off ?? 0) - Math.abs(b.off ?? 0))[0];
  // The plan as a running total (decision 96).
  const planned = Number(book.week.state.planned);
  const planBought = Number(book.week.state.bought);
  const known = open
    .filter(canEdit)
    .map(oddsOf)
    .filter((p): p is number => p !== null);
  const likely = known.filter((p) => p >= 50).length;

  const pickable = shown.filter(canEdit);
  const allPicked = pickable.length > 0 && pickable.every((o) => picked.has(o.ref));
  const chosen = open.filter((o) => picked.has(o.ref));
  const toggle = (ref: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  // The ⋯ menu closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".dco-menu")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const done = (words: string) => {
    setPicked(new Set());
    setViewing(null);
    setCancelling(null);
    setDeduping(false);
    setMoving(false);
    onChanged(words);
  };
  const shownOrder = orders.find((o) => o.ref === viewing?.ref) ?? null;

  const chip = (label: string, on: boolean, onClick: () => void, n?: number) => (
    <button type="button" aria-pressed={on} onClick={onClick}>
      {label}
      {n !== undefined && <span className="dco-n">{n}</span>}
    </button>
  );

  return (
    <section
      className={`dcb-section dco${expanded ? "" : " is-folded"}`}
      aria-labelledby="dco-title"
    >
      {!coin && (
        <div className="dcb-section-head">
          <FoldHead
            id="dco"
            open={expanded}
            onToggle={toggleExpanded}
            title="Orders"
            summary={
              <>
                {open.length} open, ${two(waiting)} {quote} waiting
                {nearest ? `, nearest ${nearest.o.coin} ${pct(nearest.off)}` : ""}
              </>
            }
          />
        </div>
      )}
      {expanded && (
        <div id="dco-body">
          <p className="dco-insight">
            {planned > 0 && !coin && (
              <span className="dco-week">
                Plan to date: <b className="num">${two(planBought)}</b> of ${two(planned)} bought
                <span
                  className="dco-split"
                  role="img"
                  aria-label={`${two(planBought)} bought and ${two(book.week.state.waiting)} in open limits, of ${two(planned)} planned to date.`}
                >
                  <i
                    className="is-bought"
                    style={{ width: `${Math.min(100, (planBought / planned) * 100)}%` }}
                  />
                  <i
                    className="is-limits"
                    style={{
                      width: `${Math.min(100, (Number(book.week.state.waiting) / planned) * 100)}%`,
                    }}
                  />
                </span>
              </span>
            )}
            {known.length > 0 && (
              <span>
                Likely to fill in 24h:{" "}
                <b className="num">
                  {likely} of {known.length}
                </b>
              </span>
            )}
            {groups.length > 0 && (
              <span>
                {groups.reduce((s, g) => s + g.length, 0)} at the same price{" "}
                <button type="button" className="link" onClick={() => setDeduping(true)}>
                  Dedupe
                </button>
              </span>
            )}
          </p>

          <div className="dco-filters">
            <div className="dcb-filters" role="group" aria-label="State">
              {(["open", "filled", "cancelled", "all"] as State[]).map((s) =>
                chip(
                  s === "all" ? "All" : STATUS[s],
                  f.state === s,
                  () => set({ state: s }),
                  count(s),
                ),
              )}
            </div>
            {!coin && (
              <div className="dcb-filters" role="group" aria-label="Coin">
                {chip("All coins", f.coin === "all", () => set({ coin: "all" }))}
                {coins.map((c) => chip(c, f.coin === c, () => set({ coin: c })))}
              </div>
            )}
            <div className="dco-selects">
              <label>
                <span className="visually-hidden">Source</span>
                <select value={f.source} onChange={(e) => set({ source: e.target.value })}>
                  <option value="all">Every source</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="visually-hidden">Week</span>
                <select value={f.week} onChange={(e) => set({ week: e.target.value as Week })}>
                  <option value="this">This week</option>
                  <option value="last4">Last 4 weeks</option>
                  <option value="all">Every week</option>
                </select>
              </label>
              <label>
                <span className="visually-hidden">Group</span>
                <select value={f.group} onChange={(e) => set({ group: e.target.value as Group })}>
                  <option value="none">No grouping</option>
                  <option value="coin">By coin</option>
                  <option value="week">By week</option>
                </select>
              </label>
              <input
                type="search"
                className="dco-search"
                placeholder="Find a reference"
                aria-label="Find a reference"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {tools}
            </div>
          </div>
          {below}

          {shown.length === 0 ? (
            <p className="muted dco-empty">
              No {f.state === "all" ? "" : `${STATUS[f.state].toLowerCase()} `}orders match.{" "}
              {f.state === "open" && openElsewhere > 0 && (
                <button
                  type="button"
                  className="link"
                  onClick={() => set({ week: "all", coin: "all", source: "all" })}
                >
                  Show {openElsewhere} open from other filters
                </button>
              )}
            </p>
          ) : (
            <div className="dcb-scroll">
              <table className="dcb-table dco-table" aria-label="Orders">
                <thead>
                  <tr>
                    <th className="dco-tick">
                      <input
                        type="checkbox"
                        aria-label="Select every open order shown"
                        checked={allPicked}
                        disabled={pickable.length === 0}
                        onChange={() =>
                          setPicked(allPicked ? new Set() : new Set(pickable.map((o) => o.ref)))
                        }
                      />
                    </th>
                    <th>Order</th>
                    <th className="r">Price</th>
                    <th className="r">From now</th>
                    <th className="r">24h odds</th>
                    <th className="r">{quote}</th>
                    <th className="r dcb-hide">Quantity</th>
                    <th className="dcb-hide">Placed</th>
                    <th>State</th>
                    <th className="dco-more">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <Fragment key={g.head ?? "all"}>
                      {g.head && (
                        <tr className="dco-grp">
                          <th colSpan={10} scope="colgroup">
                            {f.group === "coin" && <CoinIcon coin={g.head} />} {g.head}
                            <span className="muted num">
                              {" "}
                              {g.orders.length} {g.orders.length === 1 ? "order" : "orders"}, $
                              {two(
                                g.orders.reduce(
                                  (s, o) => s + Number(isOpen(o) ? left(o) : amountOf(o)),
                                  0,
                                ),
                              )}
                            </span>
                          </th>
                        </tr>
                      )}
                      {g.orders.map((o) => {
                        const live = isOpen(o);
                        const at = Number(o.avgPrice ?? o.price);
                        const off = away(at, prices[o.coin] ?? 0);
                        const moved = since(at, prices[o.coin] ?? 0);
                        const p = canEdit(o) ? oddsOf(o) : null;
                        const buyBack =
                          o.source === "trim" && o.status === "filled" && !backed.has(o.ref);
                        return (
                          <tr
                            key={o.ref}
                            className={`dco-row ${picked.has(o.ref) ? "is-picked" : ""} ${live ? "" : "is-closed"}`}
                            onClick={(e) => {
                              if (
                                (e.target as HTMLElement).closest(
                                  "button,input,a,label,[role=menu]",
                                )
                              )
                                return;
                              setViewing({ ref: o.ref, edit: false });
                            }}
                          >
                            <td className="dco-tick">
                              {canEdit(o) && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${o.ref}`}
                                  checked={picked.has(o.ref)}
                                  onChange={() => toggle(o.ref)}
                                />
                              )}
                            </td>
                            <td>
                              <span className="dcb-coin">
                                <CoinIcon coin={o.coin} />
                                {o.coin}
                                <span className={`tag ${o.side === "sell" ? "sell" : "buy"}`}>
                                  {o.side === "sell" ? "Sell" : "Buy"}
                                </span>
                              </span>
                              <small className="dcb-id">
                                {o.ref} · {SOURCE[o.source]}
                                {o.link ? ` · for ${o.link}` : ""}
                              </small>
                            </td>
                            <td className="r num">
                              {o.kind === "market" && !o.avgPrice ? "Market" : limit(at)}
                            </td>
                            <td className={`r num ${live ? "muted" : ""}`}>
                              {live ? (
                                pct(off)
                              ) : moved === null ? (
                                "—"
                              ) : (
                                <span
                                  className={moved >= 0 ? "up" : "down"}
                                  title="The price now against its fill"
                                >
                                  {pct(moved)}
                                </span>
                              )}
                            </td>
                            <td className="r num">
                              {p === null ? (
                                <span className="muted">—</span>
                              ) : (
                                <span
                                  className="dco-odds"
                                  title={`${p}% likely to fill in 24 hours`}
                                >
                                  <span className="dco-odds-bar" aria-hidden="true">
                                    <i
                                      style={{ width: `${p}%` }}
                                      className={p < 50 ? "is-low" : ""}
                                    />
                                  </span>
                                  {p}%
                                </span>
                              )}
                            </td>
                            <td className="r num">${two(live ? left(o) : amountOf(o))}</td>
                            <td className="r num muted dcb-hide">{fmtQty(qtyOf(o).toFixed(8))}</td>
                            <td className="num muted dcb-hide">{when(o.created)}</td>
                            <td>
                              <span className={`dcb-tag is-${o.status}`}>{STATUS[o.status]}</span>
                            </td>
                            <td className="dco-more">
                              <div className="dco-menu">
                                <button
                                  type="button"
                                  className="dco-dots"
                                  aria-label={`Actions for ${o.ref}`}
                                  aria-haspopup="menu"
                                  aria-expanded={menu === o.ref}
                                  onClick={() => setMenu(menu === o.ref ? null : o.ref)}
                                >
                                  ⋯
                                </button>
                                {menu === o.ref && (
                                  <div role="menu" aria-label={`${o.ref} actions`}>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenu(null);
                                        setViewing({ ref: o.ref, edit: false });
                                      }}
                                    >
                                      View on chart
                                    </button>
                                    {canEdit(o) && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setMenu(null);
                                          setViewing({ ref: o.ref, edit: true });
                                        }}
                                      >
                                        Modify
                                      </button>
                                    )}
                                    {live && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="danger"
                                        onClick={() => {
                                          setMenu(null);
                                          setCancelling([o]);
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    )}
                                    {buyBack && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setMenu(null);
                                          onBuyBack(o);
                                        }}
                                      >
                                        Buy back
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {chosen.length > 0 && (
            <div className="dco-bulk" role="region" aria-label="Selected orders">
              <span className="num">
                {chosen.length} selected, ${two(chosen.reduce((s, o) => s + left(o), 0))} {quote}
              </span>
              <button
                type="button"
                className="btn btn-danger-quiet"
                onClick={() => setCancelling(chosen)}
              >
                Cancel {chosen.length}
              </button>
              <button type="button" className="btn" onClick={() => setMoving(true)}>
                Move by %
              </button>
              <button type="button" className="link" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {shownOrder && (
        <DcaOrderDrawer
          key={`${shownOrder.ref}-${viewing?.edit ? "e" : "v"}`}
          order={shownOrder}
          book={book}
          editing={viewing?.edit ?? false}
          onClose={() => setViewing(null)}
          onCancel={() => setCancelling([shownOrder])}
          onOpen={(ref) => setViewing({ ref, edit: false })}
          onDone={done}
        />
      )}
      {cancelling && (
        <CancelDialog
          list={cancelling}
          quote={quote}
          onKeep={() => setCancelling(null)}
          onDone={done}
        />
      )}
      {deduping && (
        <DedupeDialog
          groups={groups}
          quote={quote}
          onClose={() => setDeduping(false)}
          onDone={done}
        />
      )}
      {moving && (
        <MoveDialog list={chosen} prices={prices} onClose={() => setMoving(false)} onDone={done} />
      )}
    </section>
  );
}

// A modal that opens itself on mount.
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);
  return ref;
}

// Cancels each order in turn; stops at the first refusal and says which went through.
async function cancelAll(list: DcaOrder[]): Promise<{ done: number; error: string }> {
  let done = 0;
  for (const o of list) {
    try {
      await cancelDcaOrder(o.ref);
      done += 1;
    } catch (e) {
      return { done, error: `${o.ref}: ${errorOf(e, "not cancelled.")}` };
    }
  }
  return { done, error: "" };
}

const cancelledWords = (n: number) => `${n} open ${n === 1 ? "order" : "orders"} cancelled.`;

export function CancelDialog({
  list,
  quote,
  onKeep,
  onDone,
}: {
  list: DcaOrder[];
  quote: string;
  onKeep: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  const keep = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => keep.current?.focus(), []);
  const one = list.length === 1 ? list[0] : null;
  const go = async () => {
    setBusy(true);
    const r = await cancelAll(list);
    if (r.error) {
      setBusy(false);
      setError(r.done ? `${cancelledWords(r.done)} Then ${r.error}` : r.error);
      return;
    }
    onDone(cancelledWords(r.done));
  };
  return (
    <dialog ref={modal} aria-labelledby="dco-cancel" onClose={onKeep}>
      <h2 id="dco-cancel">
        {one
          ? `Cancel ${one.ref}, a ${one.coin} ${one.side} at ${limit(one.price)}?`
          : `Cancel ${list.length} open orders?`}
      </h2>
      {!one && <p className="num">{list.map((o) => o.ref).join(", ")}</p>}
      <p>{afterCancel(list, quote)}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        <button ref={keep} className="btn" type="button" onClick={onKeep}>
          Keep {one ? "order" : "them"}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void go()}>
          {busy ? "Cancelling…" : one ? "Cancel order" : `Cancel ${list.length}`}
        </button>
      </div>
    </dialog>
  );
}

function DedupeDialog({
  groups,
  quote,
  onClose,
  onDone,
}: {
  groups: DcaOrder[][];
  quote: string;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  // The oldest of each group is kept; the rest are ticked to cancel.
  const [drop, setDrop] = useState<Set<string>>(
    () => new Set(groups.flatMap((g) => g.slice(1).map((o) => o.ref))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = groups.flat().filter((o) => drop.has(o.ref));
  const go = async () => {
    setBusy(true);
    const r = await cancelAll(list);
    if (r.error) {
      setBusy(false);
      setError(r.done ? `${cancelledWords(r.done)} Then ${r.error}` : r.error);
      return;
    }
    onDone(cancelledWords(r.done));
  };
  return (
    <dialog ref={modal} className="dco-dedupe" aria-labelledby="dco-dedupe" onClose={onClose}>
      <h2 id="dco-dedupe">Orders at the same price</h2>
      <p className="muted">
        Same-price limits can be deliberate layers, so nothing goes unless you tick it. The oldest
        of each is kept to start with.
      </p>
      {groups.map((g) => (
        <fieldset key={g[0]?.ref} className="dco-group">
          <legend>
            <CoinIcon coin={g[0]?.coin ?? ""} /> {g[0]?.coin} {g[0]?.side} at {limit(g[0]?.price)}
          </legend>
          {g.map((o) => (
            <label key={o.ref} className="dco-pick">
              <input
                type="checkbox"
                checked={drop.has(o.ref)}
                onChange={() =>
                  setDrop((d) => {
                    const next = new Set(d);
                    if (next.has(o.ref)) next.delete(o.ref);
                    else next.add(o.ref);
                    return next;
                  })
                }
              />
              <span className="num">{o.ref}</span>
              <span className="num muted">
                ${two(left(o))}, {when(o.created)}
              </span>
              <span className={drop.has(o.ref) ? "error-text" : "muted"}>
                {drop.has(o.ref) ? "Cancel" : "Keep"}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {list.length > 0 && <p>{afterCancel(list, quote)}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        <button className="btn" type="button" onClick={onClose}>
          Keep all
        </button>
        <button
          className="btn btn-danger"
          type="button"
          disabled={busy || list.length === 0}
          onClick={() => void go()}
        >
          {busy ? "Cancelling…" : `Cancel ${list.length}`}
        </button>
      </div>
    </dialog>
  );
}

// Several limits moved by the same percentage: each is replaced, as Modify does.
const moved = (price: number, by: number) => {
  const n = price * (1 + by / 100);
  return n >= 1 ? n.toFixed(2) : n.toFixed(6);
};

function MoveDialog({
  list,
  prices,
  onClose,
  onDone,
}: {
  list: DcaOrder[];
  prices: Record<string, number>;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const modal = useModal();
  const [by, setBy] = useState("-1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Moved ones drop out, so trying again after a refusal moves only the rest.
  const [moved_, setMoved] = useState<string[]>([]);
  const n = Number(by);
  const ok = Number.isFinite(n) && n !== 0 && n > -50 && n < 50;
  const go = async () => {
    setBusy(true);
    let done = moved_.length;
    for (const o of list.filter((x) => !moved_.includes(x.ref))) {
      try {
        // No amount: the api keeps what's left of each order.
        await amendDcaOrder({ ref: o.ref, price: moved(Number(o.price), n) });
        done += 1;
        setMoved((m) => [...m, o.ref]);
      } catch (e) {
        setBusy(false);
        setError(`${done ? `${done} moved. Then ` : ""}${o.ref}: ${errorOf(e, "not moved.")}`);
        return;
      }
    }
    onDone(`${done} open ${done === 1 ? "order" : "orders"} moved ${n > 0 ? "+" : ""}${n}%.`);
  };
  return (
    <dialog ref={modal} aria-labelledby="dco-move" onClose={onClose}>
      <h2 id="dco-move">
        Move {list.length} {list.length === 1 ? "limit" : "limits"}
      </h2>
      <div className="field">
        <label htmlFor="dco-by">By</label>
        <div className="in">
          <input
            id="dco-by"
            className="num"
            inputMode="decimal"
            value={by}
            onChange={(e) => setBy(e.target.value)}
          />
          <span className="muted">%</span>
        </div>
      </div>
      <ul className="dco-moves">
        {list.map((o) => {
          const to = ok ? moved(Number(o.price), n) : null;
          return (
            <li key={o.ref}>
              <span className="num">{o.ref}</span>
              <span className="num">
                {limit(o.price)} → {to ? limit(to) : "—"}
              </span>
              <span className="num muted">
                {to ? pct(away(Number(to), prices[o.coin] ?? 0)) : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted">
        Each is cancelled on Binance and placed again at its new price under a new reference, linked
        to the old one; the amount left stays the same.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-btns">
        <button className="btn" type="button" onClick={onClose}>
          Keep them
        </button>
        <button
          className="btn btn-accent"
          type="button"
          disabled={busy || !ok}
          onClick={() => void go()}
        >
          {busy ? "Moving…" : `Move ${list.length}`}
        </button>
      </div>
    </dialog>
  );
}
