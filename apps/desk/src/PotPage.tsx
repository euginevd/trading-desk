// The Trade page: the trading account, run by trading-agent (docs/plan-trade.md). Money first
// (value, unrealized, realized) and the two risk limits as gauges; then the market as cards
// with Scan now and its steps (PotMarket.tsx), what trading-agent proposes, the trades in tabs
// (positions, orders, history, stats) and, at the foot, the watchlist
// (AccountWatchlist.tsx). Every tile and card opens the figures behind it (PotDetail.tsx).
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  cancelTakeProfit,
  dismissPotProposal,
  getPot,
  getPotScanProgress,
  placeLadder,
  placePotTrade,
  placeTakeProfit,
  strategize,
  previewLadder,
  previewPotTrade,
  previewTakeProfit,
  putInPot,
  scanPot,
} from "./api";
import { errorOf, percent } from "./format";
import AgentAvatar from "./AgentIcons";
import AccountWatchlist from "./AccountWatchlist";
import CoinIcon from "./CoinIcon";
import { BoltIcon, CoinsIcon } from "./icons";
import { dated, dollars, qty, roundPrice, when, wholeDollars } from "./dcaFormat";
import { Live } from "./Figures";
import PotChat, { usePotChat } from "./PotChat";
import PotDetail from "./PotDetail";
import { REGIME, ScanSteps, type PotDetailOf } from "./PotMarket";
import ScanReport from "./ScanReport";
import { FoldHead, useFold } from "./Fold";
import PotLadder from "./PotLadder";
import { Holding, PlanBar, PositionActions, PositionName } from "./PositionCells";
import TakeProfitPanel from "./TakeProfitPanel";
import CoinFunds from "./CoinFunds";
import PotPositionOrders from "./PotPositionOrders";
import { PctKey, PctStrip, scaleFor } from "./PctStrip";
import PotNewTrade from "./PotNewTrade";
import NewTradeFlow, { OddsLine } from "./NewTradeFlow";
import PotPanel, { px, rewardOf, rr, tone } from "./PotPanel";
import { RuleBreakBanner } from "./RuleMarks";
import type {
  MarketGlobal,
  PotAction,
  PotOdds,
  PotProposal,
  PotScanCard,
  PotScanProgress,
  PotStyleKey,
  PotTakeProfit,
  PotTrade,
  PotPreview,
  PotView,
  RuleBreak,
  Sentiment,
} from "./types";
import "./pot.css";

const VIEW_KEY = "desk.account.view";
const CHAT_KEY = "desk.pot.chat";
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function saveFlag(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // not kept: it starts closed next time
  }
}
// Scan now's steps: shown until the owner hides them, and for how long a finished scan stays
// open before it folds on its own.
const STEPS_KEY = "desk.pot.steps";
const STEPS_LINGER_MS = 4000;
const SCAN_POLL_MS = 1000;
function readStepsShown(): boolean {
  try {
    return window.localStorage.getItem(STEPS_KEY) !== "0";
  } catch {
    return true;
  }
}

// What the review dialog places: a proposal, or one "open" card from the chat.
type Pending = {
  coin: string;
  setup: string;
  reason: string;
  entry: string;
  stop: string;
  target: string;
  qty: string;
  spend: string;
  risk: string;
  proposal?: string;
  style?: PotStyleKey;
  expires?: number;
  verdict?: "take" | "wait" | "pass";
  odds?: PotOdds | null;
};
const STYLE_NAME = { scalp: "Scalp", day: "Day trade", swing: "Swing", position: "Position" };
const pendingOf = (a: PotAction): Pending => ({
  coin: a.coin ?? "",
  setup: a.setup ?? "",
  reason: a.reason,
  entry: a.entry ?? "",
  stop: a.stop ?? "",
  target: a.target ?? "",
  qty: a.qty ?? "0",
  spend: a.spend ?? "0",
  risk: a.risk ?? "0",
});

const live = (t: PotTrade) =>
  t.status === "open" || t.status === "waiting" || t.status === "placing";

// A ladder's rung (PotLadder.tsx): its trade's setup names the ladder and its place in it,
// "Position - Ladder TRD-ETH-26W47-3, 2 of 4".
const RUNG = /Ladder (\S+), (\d+) of (\d+)/;
function rungOf(t: PotTrade): { id: string; i: number; k: number } | null {
  const m = RUNG.exec(t.setup);
  return m ? { id: m[1] ?? "", i: Number(m[2]), k: Number(m[3]) } : null;
}
// The position a trade belongs to: a ladder's limits join the position they were added to
// (its first ref); any other trade is a position of its own.
export const positionOf = (t: PotTrade): string => rungOf(t)?.id ?? t.ref;

// Positions by coin (owner, 21 Nov 2026), like the DCA book's: each coin is one position,
// however many trades or ladder limits made it. A strip shows the price now, the average of
// what's bought and every waiting limit with its distance and amount; a row opens its trades.
type Show = "all" | "bought" | "waiting";
// Open: something bought, whatever limits still wait to add to it. Not filled: nothing bought
// yet, only limits waiting.
const SHOW: [Show, string][] = [
  ["all", "All"],
  ["bought", "Open"],
  ["waiting", "Not filled"],
];

type PosSort = "size" | "coin" | "planned" | "value" | "pnl";

export type PositionPick = { key: string; coin: string; ref: string; label: string };

function CoinPositions({
  show,
  trades,
  every,
  sells,
  onOpen,
  onChanged,
}: {
  show: Show;
  trades: PotTrade[];
  every: PotTrade[]; // closed and cancelled too, for each position's Orders panel
  sells: PotTakeProfit[];
  onOpen: (ref: string) => void;
  onChanged: () => void;
}) {
  // The position whose Add funds is open, in its row (CoinFunds).
  const [funding, setFunding] = useState<string | null>(null);
  // The position whose Take profit is open, in its row.
  const [taking, setTaking] = useState<string | null>(null);
  // The position whose Orders panel is open.
  const [ordersOf, setOrdersOf] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  // Sorted by what's in it (bought now plus waiting) until a header is clicked, like the
  // Portfolio's table: figures high to low first, the coin A to Z.
  const [sort, setSort] = useState<{ key: PosSort; down: boolean }>({ key: "size", down: true });
  const byPosition = new Map<string, PotTrade[]>();
  for (const t of trades) {
    const key = positionOf(t);
    byPosition.set(key, [...(byPosition.get(key) ?? []), t]);
  }
  // A coin held as more than one position is numbered by when each began.
  const firsts = [...byPosition.entries()]
    .map(([key, list]) => ({
      key,
      coin: list[0]?.coin ?? "",
      at: Math.min(...list.map((t) => t.created)),
    }))
    .sort((a, b) => a.at - b.at);
  const numberOf = (key: string, coin: string) => {
    const same = firsts.filter((f) => f.coin === coin);
    return same.length > 1 ? same.findIndex((f) => f.key === key) + 1 : null;
  };
  const rows = [...byPosition.entries()]
    .map(([key, list]) => {
      const coin = list[0]?.coin ?? "";
      const bought = list.filter((t) => t.status === "open");
      const waiting = list.filter((t) => t.status !== "open");
      const invested = bought.reduce((s, t) => s + Number(t.spend), 0);
      const qty = bought.reduce((s, t) => s + Number(t.qty), 0);
      const now = list.find((t) => t.now !== null)?.now ?? null;
      const value = now !== null ? qty * Number(now) : null;
      const result = bought.reduce((s, t) => s + Number(t.result ?? 0), 0);
      return {
        key,
        coin,
        n: numberOf(key, coin),
        list,
        bought,
        waiting: [...waiting].sort((a, b) => Number(b.entry) - Number(a.entry)),
        invested,
        qty,
        now: now === null ? null : Number(now),
        value,
        result,
        avg: qty > 0 ? invested / qty : null,
        limitsUsd: waiting.reduce((s, t) => s + Number(t.spend), 0),
      };
    })
    .filter((r) => show === "all" || (show === "bought") === r.bought.length > 0)
    .sort((a, b) => {
      const fig = (r: typeof a): number | string => {
        switch (sort.key) {
          case "coin":
            return r.coin;
          case "planned":
            return r.invested + r.limitsUsd;
          case "value":
            return r.value ?? 0;
          case "pnl":
            return r.invested > 0 ? r.result / r.invested : -Infinity;
          default:
            return (r.value ?? 0) + r.limitsUsd;
        }
      };
      const x = fig(a);
      const y = fig(b);
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
      return order * (sort.down ? -1 : 1);
    });
  // One scale for every row: each limit, fill and average in percent from that coin's price.
  const scale = scaleFor(
    rows.map((r) => ({
      now: r.now,
      prices: [...r.list.map((t) => Number(t.fillPrice ?? t.entry)), ...(r.avg ? [r.avg] : [])],
    })),
  );
  const sortable = (key: PosSort, label: string) => (
    <button
      type="button"
      className="sort-btn"
      onClick={() => setSort((s) => ({ key, down: s.key === key ? !s.down : key !== "coin" }))}
    >
      {label}
      <span aria-hidden="true">{sort.key === key ? (sort.down ? " ↓" : " ↑") : ""}</span>
    </button>
  );
  const ariaSort = (key: PosSort) =>
    sort.key === key ? (sort.down ? "descending" : "ascending") : "none";
  const sellsOf = (key: string) =>
    sells.filter((o) => o.position === key && (o.status === "open" || o.status === "placing"));
  return (
    <>
      {rows.length === 0 ? (
        <p className="pot-empty">
          <b>{show === "waiting" ? "Nothing waiting to fill." : "No positions."}</b> New trade sets
          one up.
        </p>
      ) : (
        <div className="dcb-scroll">
          <table className="dcb-table cps-table" aria-label="Positions">
            <thead>
              <tr>
                <th aria-sort={ariaSort("coin")}>{sortable("coin", "Position")}</th>
                <th aria-sort={ariaSort("planned")}>{sortable("planned", "Planned")}</th>
                <th>
                  Limits <PctKey />
                </th>
                <th aria-sort={sort.key === "pnl" ? ariaSort("pnl") : ariaSort("value")}>
                  {sortable("value", "Holding")} · {sortable("pnl", "P&L %")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = opened === r.key;
                const pct = r.invested > 0 ? (r.result / r.invested) * 100 : null;
                const planned = r.invested + r.limitsUsd;
                const pick: PositionPick = {
                  key: r.key,
                  coin: r.coin,
                  ref: r.list[0]?.ref ?? r.key,
                  label: `Your ${r.coin} position${r.n ? ` ${r.n}` : ""}`,
                };
                const since = Math.min(...r.list.map((t) => t.created));
                return (
                  <Fragment key={r.key}>
                    {/* The whole row opens the position: the name's button is stretched over it. */}
                    <tr className={`dcb-row-open${open ? " is-open" : ""}`}>
                      <td>
                        <button
                          type="button"
                          className="dcb-expand"
                          aria-expanded={open}
                          onClick={() => setOpened(open ? null : r.key)}
                        >
                          <PositionName
                            coin={r.coin}
                            n={r.n}
                            kind={r.list.some((t) => rungOf(t)) ? "Ladder" : "Trade"}
                            since={since}
                            extra={
                              sellsOf(r.key).length ? `${sellsOf(r.key).length} to sell` : undefined
                            }
                          />
                        </button>
                      </td>
                      <td>
                        <PlanBar
                          bought={r.invested}
                          waiting={r.limitsUsd}
                          planned={planned}
                          done={r.waiting.length === 0}
                          note={
                            r.waiting.length
                              ? `${r.waiting.length} ${r.waiting.length === 1 ? "limit" : "limits"} waiting`
                              : "All filled"
                          }
                        />
                      </td>
                      <td className="cps-strip-cell">
                        <PctStrip
                          now={r.now}
                          avg={r.avg}
                          fills={r.bought.map((t) => Number(t.fillPrice ?? t.entry))}
                          limits={r.waiting.map((t) => ({
                            price: Number(t.entry),
                            spend: Number(t.spend),
                          }))}
                          scale={scale}
                        />
                      </td>
                      <td className="num">
                        <Holding
                          value={r.qty > 0 ? r.value : null}
                          pnl={r.result}
                          pnlPct={pct}
                          avg={r.avg}
                          now={r.now}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr className="cps-open-row">
                        <td colSpan={4}>
                          <table className="dcb-table cps-orders num">
                            <thead>
                              <tr>
                                <th>Order</th>
                                <th className="r">Price</th>
                                <th className="r">From now</th>
                                <th className="r">Amount</th>
                                <th className="r">Result</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...r.list]
                                .sort(
                                  (a, b) =>
                                    Number(b.fillPrice ?? b.entry) - Number(a.fillPrice ?? a.entry),
                                )
                                .map((t) => {
                                  const bought = t.status === "open";
                                  const at = Number(t.fillPrice ?? t.entry);
                                  const away = r.now ? (at / r.now - 1) * 100 : null;
                                  return (
                                    <tr key={t.ref}>
                                      <td>
                                        <span
                                          className={`pot-tag ${bought ? "is-live" : "is-wait"}`}
                                        >
                                          {bought ? "Bought" : "Waiting"}
                                        </span>
                                      </td>
                                      <td className="r">{roundPrice(at)}</td>
                                      <td className="r muted">
                                        {bought || away === null
                                          ? "—"
                                          : `fills ${Math.abs(away).toFixed(1)}% lower`}
                                      </td>
                                      <td className="r">{wholeDollars(t.spend)}</td>
                                      <td
                                        className={`r ${bought ? tone(Number(t.result ?? 0)) : ""}`}
                                      >
                                        {bought ? dollars(t.result ?? "0", true) : "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              {sellsOf(r.key).map((o) => (
                                <tr key={o.ref}>
                                  <td>
                                    <span className="pot-tag is-sell">Selling</span>
                                  </td>
                                  <td className="r">{o.price ? roundPrice(o.price) : "market"}</td>
                                  <td className="r muted">
                                    {o.price && r.now
                                      ? `fills ${((Number(o.price) / r.now - 1) * 100).toFixed(1)}% higher`
                                      : "—"}
                                  </td>
                                  <td className="r">
                                    {wholeDollars(
                                      String(Number(o.qty) * Number(o.price ?? r.now ?? 0)),
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <PositionActions
                            onTakeProfit={
                              r.bought.length
                                ? () => {
                                    setFunding(null);
                                    setTaking(taking === r.key ? null : r.key);
                                  }
                                : undefined
                            }
                            onAddFunds={() => {
                              setTaking(null);
                              setFunding(funding === r.key ? null : r.key);
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() => setOrdersOf(r.key)}
                            >
                              Orders · {r.list.length + sellsOf(r.key).length}
                            </button>
                          </PositionActions>
                          {taking === r.key && (
                            <TakeProfitPanel
                              coin={r.coin}
                              label={pick.label}
                              live={sellsOf(r.key).map((o) => ({
                                ref: o.ref,
                                price: o.price,
                                qty: o.qty,
                                value: o.price ? Number(o.qty) * Number(o.price) : null,
                              }))}
                              preview={(plan) => previewTakeProfit({ position: r.key, ...plan })}
                              place={(plan, anyway) =>
                                placeTakeProfit({ position: r.key, ...plan, anyway }).then(
                                  () => undefined,
                                )
                              }
                              cancelLive={(ref) => cancelTakeProfit(ref).then(() => onChanged())}
                              agent="trading-agent"
                              strategize={(b) =>
                                strategize({
                                  ...b,
                                  book: "trade",
                                  mode: "sell",
                                  coin: r.coin,
                                  position: r.key,
                                })
                              }
                              onClose={() => setTaking(null)}
                              onPlaced={() => {
                                setTaking(null);
                                onChanged();
                              }}
                            />
                          )}
                          {funding === r.key && (
                            <CoinFunds
                              coin={r.coin}
                              waiting={{ count: r.waiting.length, usd: r.limitsUsd }}
                              preview={(body) => previewLadder({ ...body, position: pick.ref })}
                              place={(body) => placeLadder({ ...body, position: pick.ref })}
                              agent="trading-agent"
                              strategize={(b) =>
                                strategize({
                                  ...b,
                                  book: "trade",
                                  mode: "add",
                                  coin: r.coin,
                                  position: r.key,
                                })
                              }
                              onClose={() => setFunding(null)}
                              onPlaced={() => {
                                setFunding(null);
                                onChanged();
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ordersOf &&
        (() => {
          const r = rows.find((x) => x.key === ordersOf);
          return (
            <PotPositionOrders
              key={ordersOf}
              coin={r?.coin ?? ""}
              label={`Your ${r?.coin ?? ""} position${r?.n ? ` ${r.n}` : ""}`}
              trades={every.filter((t) => positionOf(t) === ordersOf)}
              sells={sells.filter((o) => o.position === ordersOf)}
              now={r?.now ?? null}
              onOpen={onOpen}
              onClose={() => setOrdersOf(null)}
              onChanged={onChanged}
            />
          );
        })()}
    </>
  );
}

function ProposalCard({
  p,
  onReview,
  onDismiss,
  onWhy,
}: {
  p: PotProposal;
  onReview: () => void;
  onDismiss: () => void;
  onWhy: () => void;
}) {
  return (
    <article className="pot-proposal" aria-label={`Proposal: ${p.coin}, ${p.setup}`}>
      <div>
        <div className="pot-who">
          <AgentAvatar icon="research" slug="trading-agent" />
          trading-agent proposes, {dated(p.created, true)}
        </div>
        <h3>
          <span className="dcb-coin">
            <CoinIcon coin={p.coin} />
            {p.coin}
          </span>
          , {p.setup}
        </h3>
        <p>{p.reason}</p>
        <dl className="pot-facts">
          <div>
            <dt>Entry, limit</dt>
            <dd className="num">{px(p.entry)}</dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd className="num down">{px(p.stop)}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd className="num up">{px(p.target)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd className="num">
              {dollars(p.spend)}{" "}
              <span className="muted">
                ({qty(p.qty)} {p.coin})
              </span>
            </dd>
          </div>
          <div>
            <dt>At risk</dt>
            <dd className="num">
              {dollars(p.risk)} <span className="muted">({p.stopPct}%)</span>
            </dd>
          </div>
          <div>
            <dt>Reward to risk</dt>
            <dd className="num">{p.rr} : 1</dd>
          </div>
          <div>
            <dt>Crowding</dt>
            <dd>{p.crowding}</dd>
          </div>
        </dl>
      </div>
      <div className="pot-act">
        <button type="button" className="btn btn-accent" onClick={onReview}>
          Review
        </button>
        <button type="button" className="btn" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="link" onClick={onWhy}>
          Ask why
        </button>
      </div>
    </article>
  );
}

function PutIn({ label, onDone }: { label: string; onDone: (view: PotView) => void }) {
  const [usdc, setUsdc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="pot-putin"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        putInPot(usdc).then(
          (v) => {
            setBusy(false);
            setUsdc("");
            onDone(v);
          },
          (err: unknown) => {
            setBusy(false);
            setError(errorOf(err, "That wasn't put in."));
          },
        );
      }}
    >
      <label>
        <span>{label}</span>
        <span className="dcf-unit">
          <input
            inputMode="decimal"
            value={usdc}
            onChange={(e) => setUsdc(e.target.value)}
            aria-label="Amount to put in, USDC"
            placeholder="100"
          />
          <small>USDC</small>
        </span>
      </label>
      <button type="submit" className="btn btn-accent" disabled={!(Number(usdc) > 0) || busy}>
        Put in
      </button>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

// tradingOn: the side panel's kill switch, from App, so this page says at once when it changes;
// null while unknown (and in tests that render the page alone).
// fear and global: the top bar's Fear & Greed and market figures, read once by App and handed
// down for the market cards; null while unknown.
export default function PotPage({
  tradingOn = null,
  fear = null,
  global = null,
}: {
  tradingOn?: boolean | null;
  fear?: Sentiment | null;
  global?: MarketGlobal | null;
}) {
  const [pot, setPot] = useState<PotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  // Market now instead of the limit: the desk's sizing at the price now, and its problems.
  const [atMarket, setAtMarket] = useState<
    "loading" | { now: string; trade: PotPreview["trade"]; problems: string[] } | null
  >(null);
  // The Profile rules a trade breaks, for the trade under review only (decision 78).
  const [ruleHold, setRuleHold] = useState<{ of: Pending; breaks: RuleBreak[] } | null>(null);
  const breaks = ruleHold && ruleHold.of === pending ? ruleHold.breaks : null;
  const [chatOpen, setChatOpen] = useState(() => readFlag(CHAT_KEY));
  // null: closed; "": New trade on its first coin; a coin: opened from that coin's card.
  const [building, setBuilding] = useState<string | null>(null);
  // New trade by style (NewTradeFlow): open or not.
  const [flow, setFlow] = useState(false);
  // A ladder trade (PotLadder): open or not.
  const [laddering, setLaddering] = useState(false);
  // Take profit on a position, or add funds to it (owner, 21 Nov 2026).
  const [tradesOpen, toggleTrades] = useFold("acc-trades");
  // Positions' filter, on the tabs' row: all, open (something bought) or not filled yet.
  const [show, setShow] = useState<Show>("all");
  // Two views (owner, 21 Nov 2026): your own trades, and the agent's market scan.
  const [view, setView] = useState<"mine" | "scan">(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === "scan" ? "scan" : "mine";
    } catch {
      return "mine";
    }
  });
  const pickView = (v: "mine" | "scan") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // not kept: My trades next time
    }
  };
  // Bumped after a scan, so the watchlist reads its coins again.
  const [coinsVersion, setCoinsVersion] = useState(0);
  const review = useRef<HTMLDialogElement>(null);
  // Bumped on each ask for the price now and when the review closes: a late reply is dropped,
  // so it can't switch a closed or changed review to market.
  const marketAsk = useRef(0);
  const chat = usePotChat();
  // The figures behind a tile or card, and the button that opened them: focus goes back there.
  const [detail, setDetail] = useState<PotDetailOf | null>(null);
  // The tile or card that opened the details: the panel opens from it.
  const [detailAt] = useState<HTMLElement | null>(null);
  const detailFrom = useRef<HTMLElement | null>(null);
  // Scan now's steps while it runs (null: none to show, or the progress route didn't answer),
  // the owner's kept choice to see them, whether they touched it this scan, and whether a
  // finished scan has folded on its own.
  const [progress, setProgress] = useState<PotScanProgress | null>(null);
  const [stepsShown, setStepsShown] = useState(readStepsShown);
  const [stepsTouched, setStepsTouched] = useState(false);
  const [stepsFolded, setStepsFolded] = useState(false);
  const [scanClock, setScanClock] = useState({ start: 0, now: 0 });
  const sawScanRun = useRef(false);

  const load = useCallback(() => {
    getPot().then(
      (p) => {
        setPot(p);
        setError(null);
      },
      (e: unknown) => setError(errorOf(e, "The trading account couldn't be read.")),
    );
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [load]);
  useEffect(() => {
    if (pending) review.current?.showModal?.();
  }, [pending]);
  useEffect(() => {
    if (!said) return;
    const fade = window.setTimeout(() => setSaid(null), 6000);
    return () => window.clearTimeout(fade);
  }, [said]);
  // While a scan runs, ask for its steps about once a second. A reply that isn't a running
  // scan (the last scan's record, before this one began) and a failed ask are both left out,
  // so the page falls back to its plain "Scanning…".
  useEffect(() => {
    if (!scanning) return;
    let on = true;
    const tick = window.setInterval(() => {
      setScanClock((c) => ({ ...c, now: Date.now() }));
      getPotScanProgress().then(
        (p) => {
          if (!on || !p.running || p.steps.length === 0) return;
          sawScanRun.current = true;
          setProgress(p);
        },
        () => undefined,
      );
    }, SCAN_POLL_MS);
    return () => {
      on = false;
      window.clearInterval(tick);
    };
  }, [scanning]);
  // A finished scan shows how it ended, then folds on its own.
  const hasSteps = progress !== null;
  useEffect(() => {
    if (scanning || !hasSteps) return;
    const fold = window.setTimeout(() => setStepsFolded(true), STEPS_LINGER_MS);
    return () => window.clearTimeout(fold);
  }, [scanning, hasSteps]);

  const openChat = (on: boolean) => {
    setChatOpen(on);
    saveFlag(CHAT_KEY, on);
  };

  if (error && !pot) {
    return (
      <main className="wrap dcb pot">
        <h1>Trading account</h1>
        <div className="alert" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={load}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!pot) {
    return (
      <main className="wrap dcb pot" aria-busy="true">
        <p className="muted">Reading the trading account…</p>
      </main>
    );
  }

  const putIn = Number(pot.putIn);
  const on = pot.trades.filter(live);
  const done = pot.trades.filter((t) => !live(t));
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = done.filter(
    (t) => t.status === "closed" && (t.closed ?? 0) >= monthStart.getTime(),
  );
  const monthUsd = thisMonth.reduce((s, t) => s + Number(t.result ?? 0), 0);
  const held = on.filter((t) => t.status === "open");
  // Open trades with nothing to stop them: named in the sentence at the top.
  const unstopped = [
    ...new Set(held.filter((t) => t.exits === "held" || t.exits === "none").map((t) => t.coin)),
  ];
  // Positions with something bought: a ladder's filled limits are part of one position.
  const openPositions = new Set(held.map(positionOf)).size;
  const sum = (ts: PotTrade[], k: "result" | "spend") =>
    ts.reduce((s, t) => s + Number(t[k] ?? 0), 0);
  const ofBase = (usd: number, base: number) => (base > 0 ? String((usd / base) * 100) : null);
  // Unrealized: open trades against what they cost. Realized: closed trades against what went in.
  const unrealUsd = sum(held, "result");
  const unrealPct = ofBase(unrealUsd, sum(held, "spend"));
  const closedAll = done.filter((t) => t.status === "closed");
  const realUsd = sum(closedAll, "result");
  const waiting = on.filter((t) => t.status !== "open");
  const openLimit = Number(pot.openRiskLimit ?? (Number(pot.value) * 6) / 100);
  // No cap on the account for now (owner, 21 Nov 2026): what's free on Binance is what a trade
  // can spend; then the Trade page's own positions at today's price and its waiting limits.
  const available = Number(pot.backing?.free ?? pot.cash);
  // Only the Trade page's own: its entries waiting on Binance, not the DCA book's limits.
  const lockedUsd = waiting.reduce((s, t) => s + Number(t.spend), 0);
  const positionsUsd = held.reduce(
    (s, t) => s + (t.now && t.qty ? Number(t.qty) * Number(t.now) : Number(t.spend)),
    0,
  );
  const whole = available + positionsUsd + lockedUsd || 1;
  const investedUsd = held.reduce((s, t) => s + Number(t.spend), 0);
  // What one trade may lose: the percent, or the cap when the cap is what holds it.
  const capped =
    pot.config.maxRisk !== undefined &&
    Number(pot.config.maxRisk) < (Number(pot.value) * Number(pot.config.riskPct)) / 100;
  const perTrade = capped ? "the cap" : `${pot.config.riskPct}%`;
  const openTrade = pot.trades.find((t) => t.ref === openRef) ?? null;
  // The last scan's card per style. A take placed, dismissed or expired since the scan has
  // nothing left to review.
  const scanCards: PotScanCard[] | undefined = pot.lastScan?.styles?.map(({ take, ...c }) =>
    take && pot.proposals.some((x) => x.id === take.id) ? { ...c, take } : c,
  );

  // The scan is over: read its steps once more for how each style ended. After a scan that
  // failed, only a record this page saw running is this scan's; otherwise it may be the last one's.
  const scanEnded = (ok: boolean) => {
    setScanning(false);
    setScanClock((c) => ({ ...c, now: Date.now() }));
    const seen = sawScanRun.current;
    getPotScanProgress().then(
      (p) => {
        if (!p.running && p.steps.length > 0 && (ok || seen)) setProgress(p);
      },
      () => undefined,
    );
  };
  const scan = () => {
    pickView("scan");
    setScanning(true);
    setSaid(null);
    setProgress(null);
    setStepsTouched(false);
    setStepsFolded(false);
    setScanClock({ start: Date.now(), now: Date.now() });
    sawScanRun.current = false;
    scanPot().then(
      (p) => {
        setPot(p);
        scanEnded(true);
        setCoinsVersion((v) => v + 1);
        const n = p.proposals.length;
        setSaid(
          n
            ? `Scanned: ${n} ${n === 1 ? "setup" : "setups"} waiting for you below.`
            : "Scanned: no setup today. That's most days, and the method working.",
        );
      },
      (e: unknown) => {
        scanEnded(false);
        setSaid(errorOf(e, "trading-agent couldn't scan. Try again in a minute."));
      },
    );
  };
  // Hide steps or Show steps: the owner's choice, kept; a scan they opened doesn't fold itself.
  const stepsOpen = stepsTouched ? stepsShown : stepsShown && !stepsFolded;
  const toggleSteps = () => {
    setStepsTouched(true);
    setStepsShown(!stepsOpen);
    saveFlag(STEPS_KEY, !stepsOpen);
  };
  // The panel has closed (Esc, a click outside, Close or one of its own buttons): focus goes
  // back to the card that opened it, or to where its button pointed.
  const detailClosed = () => {
    setDetail(null);
    detailFrom.current?.focus();
    detailFrom.current = null;
  };
  const reviewProposal = (id: string) => {
    const p = pot.proposals.find((x) => x.id === id);
    if (!p) {
      setSaid("That setup has gone: scan again for a fresh one.");
      return;
    }
    setPlaceError(null);
    setPending({ ...p, proposal: p.id });
  };
  const dismiss = (id: string) =>
    dismissPotProposal(id).then(setPot, (e: unknown) =>
      setSaid(errorOf(e, "That proposal couldn't be dismissed.")),
    );
  const place = (override = false) => {
    if (!pending) return;
    setPlacing(true);
    setPlaceError(null);
    placePotTrade({
      coin: pending.coin,
      entry: pending.entry,
      stop: pending.stop,
      target: pending.target,
      setup: pending.setup,
      reason: pending.reason,
      ...(pending.proposal ? { proposal: pending.proposal } : {}),
      ...(pending.style ? { style: pending.style, expires: pending.expires } : {}),
      ...(market ? { market: true, entry: market.now } : {}),
      ...(override ? { override: true } : {}),
      // A trade by hand is the owner's own: the account's soft rules warn, never refuse.
      ...(!pending.proposal && !pending.style ? { anyway: true } : {}),
    }).then(
      (t) => {
        setPlacing(false);
        review.current?.close?.();
        setPending(null);
        setBuilding(null);
        setFlow(false);
        setSaid(
          market
            ? `${t.ref} placed: bought at market, about ${px(t.entry)}.`
            : `${t.ref} placed: the entry waits on Binance at ${px(t.entry)}.`,
        );
        load();
      },
      (e: unknown) => {
        setPlacing(false);
        if (e instanceof ApiError && e.ruleBreaks.length > 0) {
          setRuleHold({ of: pending, breaks: e.ruleBreaks });
          return;
        }
        // Closed while placing: say it as a toast, or it's lost with the dialog.
        const failed = errorOf(e, "The trade wasn't placed.");
        if (review.current?.open === false) setSaid(failed);
        else setPlaceError(failed);
      },
    );
  };
  const market = atMarket && atMarket !== "loading" ? atMarket : null;
  const shown =
    pending && market?.trade
      ? {
          ...pending,
          entry: market.trade.entry,
          qty: market.trade.qty,
          spend: market.trade.spend,
          risk: market.trade.risk,
        }
      : pending;
  const reward = shown ? rewardOf(shown) : 0;
  const marketBlocked =
    atMarket === "loading" || (market !== null && (!market.trade || market.problems.length > 0));
  const chooseMarket = (on: boolean) => {
    setPlaceError(null);
    const ask = ++marketAsk.current;
    if (!on || !pending) {
      setAtMarket(null);
      return;
    }
    setAtMarket("loading");
    const { coin, stop, target, style } = pending;
    previewPotTrade({ coin })
      .then((seen) =>
        previewPotTrade({ coin, entry: seen.now ?? "", stop, target, ...(style ? { style } : {}) }),
      )
      .then(
        (seen) => {
          if (ask !== marketAsk.current) return;
          setAtMarket({ now: seen.now ?? "", trade: seen.trade, problems: seen.problems });
        },
        (e: unknown) => {
          if (ask !== marketAsk.current) return;
          setAtMarket(null);
          setPlaceError(errorOf(e, "The price now couldn't be read."));
        },
      );
  };

  return (
    <main className={`wrap dcb pot${chatOpen ? " has-chat" : ""}`}>
      <div className="dcb-main">
        {putIn > 0 && (
          <nav className="pot-views" aria-label="Trade page">
            <div className="track" role="tablist" aria-label="Trade page">
              <button
                type="button"
                role="tab"
                aria-selected={view === "mine"}
                onClick={() => pickView("mine")}
              >
                <CoinsIcon />
                My trades
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "scan"}
                onClick={() => pickView("scan")}
              >
                <BoltIcon />
                Market scan
                {pot.proposals.length > 0 && <span className="acc-n">{pot.proposals.length}</span>}
              </button>
            </div>
          </nav>
        )}
        {putIn > 0 && view === "scan" && (
          <div className="acc-top pot-scan-top">
            <p className="acc-sub num">
              {pot.regime.state && <>Market {REGIME[pot.regime.state]}</>}
              {fear && Number.isFinite(fear.value) ? ` in ${fear.label}` : ""}
              {pot.lastScan ? ` · last scan ${when(pot.lastScan.at)}` : ""}
            </p>
            <div className="acc-acts">
              <button type="button" className="btn" disabled={scanning} onClick={scan}>
                {scanning ? "Scanning…" : "Scan now"}
              </button>
            </div>
          </div>
        )}
        <h1 className="visually-hidden">Trading account</h1>
        {tradingOn === false && (
          <div className="alert" role="status">
            <span>
              Trading is off: every new order is refused until you switch it on in the side panel.
              Stops and targets already on Binance still hold.
            </span>
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            <span>{error} These figures are from the last read.</span>
            <button type="button" className="btn btn-small" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {putIn > 0 && view === "scan" ? null : putIn > 0 ? (
          <section className="acc-head" aria-label="The account">
            <dl className="acc-money">
              <div>
                <dt>Available</dt>
                <dd className="num">
                  <Live value={String(available)}>{dollars(String(available))}</Live>
                </dd>
                <span className="acc-split" aria-hidden="true">
                  <i className="is-cash" style={{ width: `${(available / whole) * 100}%` }} />
                  <i className="is-trades" style={{ width: `${(positionsUsd / whole) * 100}%` }} />
                  <i className="is-dca" style={{ width: `${(lockedUsd / whole) * 100}%` }} />
                </span>
                <small className="acc-month num">
                  free · {wholeDollars(String(positionsUsd))} in positions ·{" "}
                  {wholeDollars(String(lockedUsd))} in limits
                </small>
              </div>
              <div>
                <dt>Positions</dt>
                <dd className="num">{dollars(String(positionsUsd))}</dd>
                <small className="acc-month num">
                  {openPositions === 0
                    ? "None open"
                    : `${openPositions} open · ${wholeDollars(String(investedUsd))} invested · ${
                        unstopped.length === 0
                          ? "all stopped"
                          : unstopped.length >= openPositions
                            ? "no stops set"
                            : `${unstopped.length} without a stop`
                      }`}
                </small>
              </div>
              <div className="acc-pnl">
                <dt>Profit and loss</dt>
                <dd>
                  <div className="acc-pnl-row">
                    <span>Unrealized</span>
                    <b className={`num ${tone(unrealUsd)}`}>
                      {dollars(unrealUsd, true)}
                      {unrealPct !== null && <small> {percent(unrealPct)}</small>}
                    </b>
                  </div>
                  <div className="acc-pnl-row">
                    <span>Realized</span>
                    <b className={`num ${tone(realUsd)}`}>
                      {dollars(realUsd, true)}
                      <small>
                        {" "}
                        {closedAll.length === 0
                          ? "none closed"
                          : monthUsd === realUsd
                            ? "all this month"
                            : `${dollars(monthUsd, true)} this month`}
                      </small>
                    </b>
                  </div>
                </dd>
              </div>
            </dl>
            {pot.proposals.length > 0 && (
              <p className="acc-said">
                {pot.proposals.length} {pot.proposals.length === 1 ? "setup is" : "setups are"}{" "}
                waiting for you.
              </p>
            )}
          </section>
        ) : (
          <p className="acc-said">Put money in to start; it's kept apart from the DCA book.</p>
        )}

        {pot.priceError && (
          <p className="dcb-warn" role="alert">
            Binance didn't answer, so prices and results are missing. Your stops and targets sit on
            Binance, so they still work.
          </p>
        )}

        {putIn <= 0 ? (
          <section className="dcb-section" aria-label="Put money in">
            <PutIn label="Put money in" onDone={setPot} />
            <p className="muted">
              It comes from the USDC on Binance, kept as the account's own ledger. Trades never
              spend more than the account holds.
            </p>
          </section>
        ) : (
          <>
            {said && (
              <p className="acc-toast" role="status">
                {said}
              </p>
            )}

            {view === "scan" && (
              <>
                {progress && (
                  <ScanSteps
                    progress={progress}
                    scanning={scanning}
                    open={stepsOpen}
                    elapsed={scanClock.now - scanClock.start}
                    onToggle={toggleSteps}
                  />
                )}

                {pot.proposals.length > 0 && (
                  <section className="dcb-section pot-first" aria-labelledby="pot-wait-title">
                    <div className="dcb-section-head">
                      <h2 id="pot-wait-title">Waiting for you</h2>
                    </div>
                    <div className="pot-proposals">
                      {pot.proposals.map((p) => (
                        <ProposalCard
                          key={p.id}
                          p={p}
                          onReview={() => {
                            setPlaceError(null);
                            setPending({ ...p, proposal: p.id });
                          }}
                          onDismiss={() => void dismiss(p.id)}
                          onWhy={() => {
                            openChat(true);
                            chat.send(`Why ${p.coin}?`);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <ScanReport
                  key={pot.lastScan?.at ?? 0}
                  pot={pot}
                  fear={fear}
                  global={global}
                  scanning={scanning}
                />
              </>
            )}

            {view === "mine" && (
              <>
                <section
                  className={`dcb-section acc-tabs-wrap${tradesOpen ? "" : " is-folded"}`}
                  aria-label="Positions"
                >
                  <div className="dcb-section-head">
                    <FoldHead
                      id="acc-trades"
                      open={tradesOpen}
                      onToggle={toggleTrades}
                      title="Positions"
                      summary={
                        <>
                          <span className="fold-chip">
                            {openPositions} open · {wholeDollars(String(positionsUsd))}
                          </span>
                          {held.length > 0 && (
                            <span className={`fold-chip ${tone(unrealUsd)}`}>
                              {dollars(unrealUsd, true)}
                            </span>
                          )}
                          {waiting.length > 0 && (
                            <span className="fold-chip">
                              {waiting.length} limits · {wholeDollars(String(lockedUsd))}
                            </span>
                          )}
                        </>
                      }
                    />
                    {/* Beside the title, so it's there folded too (owner, 21 Nov 2026). */}
                    <span className="acc-head-tools">
                      {tradesOpen && (
                        <div className="views cps-filter" role="group" aria-label="Show">
                          {SHOW.map(([key, name]) => (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={show === key}
                              onClick={() => setShow(key)}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-small acc-new"
                        onClick={() => setFlow(true)}
                      >
                        <span aria-hidden="true">+</span> New trade
                      </button>
                    </span>
                  </div>
                  {tradesOpen && (
                    <>
                      {/* Positions only (owner, 21 Nov 2026): orders live in each position's
                          panel; history and stats went. */}
                      <CoinPositions
                        show={show}
                        trades={on}
                        every={pot.trades}
                        sells={pot.takeProfits ?? []}
                        onOpen={(ref) => setOpenRef(ref)}
                        onChanged={load}
                      />
                    </>
                  )}
                </section>

                <AccountWatchlist version={coinsVersion} onTrade={(coin) => setBuilding(coin)} />
              </>
            )}
          </>
        )}
      </div>

      {putIn > 0 && (
        <PotChat
          chat={chat}
          open={chatOpen}
          onOpen={openChat}
          onReview={(a) => {
            setPlaceError(null);
            setPending(pendingOf(a));
          }}
          onDone={load}
        />
      )}

      {flow && (
        <NewTradeFlow
          onClose={() => setFlow(false)}
          onHand={() => {
            setFlow(false);
            setBuilding("");
          }}
          onLadder={() => {
            setFlow(false);
            setLaddering(true);
          }}
          onReview={(t) => {
            setPlaceError(null);
            setPending(t);
          }}
        />
      )}

      {laddering && (
        <PotLadder
          coins={pot.coins}
          positions={on.map((t) => ({
            ref: t.ref,
            key: positionOf(t),
            coin: t.coin,
            spend: t.spend,
          }))}
          onClose={() => setLaddering(false)}
          onPlaced={(view) => {
            if (view) setPot(view);
            setSaid("Ladder placed: each limit waits on Binance as its own buy order.");
            load();
          }}
        />
      )}

      {building !== null && (
        <PotNewTrade
          coins={pot.coins}
          initialCoin={building || undefined}
          onClose={() => setBuilding(null)}
          onReview={(t) => {
            setPlaceError(null);
            setPending(t);
          }}
        />
      )}

      {openTrade && (
        <PotPanel
          key={openTrade.ref}
          trade={openTrade}
          onClose={() => setOpenRef(null)}
          onChanged={(words) => {
            setSaid(words);
            load();
          }}
        />
      )}

      <PotDetail
        detail={detail}
        from={detailAt}
        pot={pot}
        fear={fear}
        global={global}
        openLimit={openLimit}
        perTrade={perTrade}
        cards={scanCards}
        onClosed={detailClosed}
        onTab={() => {
          detailFrom.current = document.getElementById("acc-trades-title");
          setDetail(null);
        }}
        onNewTrade={() => {
          detailFrom.current = null;
          setDetail(null);
          setFlow(true);
        }}
        onReview={(id) => {
          detailFrom.current = null;
          setDetail(null);
          reviewProposal(id);
        }}
      />

      <dialog
        ref={review}
        aria-labelledby="pot-review-title"
        onClose={() => {
          marketAsk.current += 1;
          setPending(null);
          setPlaceError(null);
          setAtMarket(null);
        }}
      >
        {pending && shown && (
          <>
            <h2 id="pot-review-title">Place the {pending.coin} trade?</h2>
            {pending.style && (
              <p className="muted">
                {STYLE_NAME[pending.style]} · {pending.setup}
                {pending.expires
                  ? ` · good until ${new Date(pending.expires).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
                  : ""}
              </p>
            )}
            {pending.verdict && pending.verdict !== "take" && (
              <p className="ntf-warn" role="note">
                trading-agent says {pending.verdict === "wait" ? "wait" : "pass"} on this one. Its
                reason is below; you can still place it.
              </p>
            )}
            {pending.odds && <OddsLine odds={pending.odds} />}
            <div className="pot-rv-how" role="radiogroup" aria-label="How to enter">
              <button
                type="button"
                role="radio"
                aria-checked={atMarket === null}
                className={`pnt-chip${atMarket === null ? " is-on" : ""}`}
                onClick={() => chooseMarket(false)}
              >
                Limit at {px(pending.entry)}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={atMarket !== null}
                className={`pnt-chip${atMarket !== null ? " is-on" : ""}`}
                onClick={() => chooseMarket(true)}
              >
                {atMarket === "loading"
                  ? "Market now…"
                  : market
                    ? `Market now, about ${px(market.now)}`
                    : "Market now"}
              </button>
            </div>
            {market && market.problems.length > 0 && (
              <ul className="error-text pot-rv-problems" role="alert">
                {market.problems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <ul className="pot-rv" aria-label="The trade's orders">
              <li>
                <span className="pot-tag is-live">Entry</span>
                <span>
                  <b>{pending.coin}</b> {market ? "market buy, about" : "limit buy"}{" "}
                  {px(shown.entry)}
                </span>
                <span className="num">{dollars(shown.spend)}</span>
              </li>
              <li>
                <span className="pot-tag is-lost">Stop</span>
                <span>sell all at {px(shown.stop)}</span>
                <span className="num down">{dollars(-Number(shown.risk))}</span>
              </li>
              <li>
                <span className="pot-tag is-won">Target</span>
                <span>sell all at {px(pending.target)}</span>
                <span className="num up">{dollars(reward, true)}</span>
              </li>
            </ul>
            {pending.reason && (
              <p className="pot-rv-why">
                <b>{pending.setup}.</b> {pending.reason}
              </p>
            )}
            <p className="muted">
              Reward to risk {rr(shown)} : 1. The entry goes to Binance now, tagged as the trade's
              reference. Once it fills, the desk places the stop and target there as one OCO order,
              so they hold even if the desk is off.
            </p>
            {placeError && (
              <p className="error-text" role="alert">
                {placeError}
              </p>
            )}
            {breaks ? (
              <RuleBreakBanner
                breaks={breaks}
                sending={placing}
                onKeep={() => review.current?.close()}
                onOverride={() => place(true)}
              />
            ) : (
              <div className="dlg-btns">
                <button className="btn" type="button" onClick={() => review.current?.close()}>
                  Not yet
                </button>
                <button
                  className="btn btn-accent"
                  type="button"
                  disabled={placing || marketBlocked}
                  onClick={() => place()}
                >
                  {placing
                    ? "Placing…"
                    : pending.verdict && pending.verdict !== "take"
                      ? "Place anyway"
                      : "Place the trade"}
                </button>
              </div>
            )}
          </>
        )}
      </dialog>
    </main>
  );
}
