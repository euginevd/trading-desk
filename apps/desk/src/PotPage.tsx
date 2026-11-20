// The Trade page: the trading account, run by trading-agent (docs/plan-trade.md). Money first
// (available, in trades, value, this month) and the risk rules in a line; then the market and
// Scan now, what trading-agent proposes, the trades in tabs (positions, orders, history,
// stats, the ledger) and, at the foot, the watchlist (AccountWatchlist.tsx).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ApiError,
  checkPot,
  dismissPotProposal,
  getPot,
  placePotTrade,
  previewPotTrade,
  putInPot,
  scanPot,
} from "./api";
import { errorOf, percent } from "./format";
import AgentAvatar from "./AgentIcons";
import AccountWatchlist from "./AccountWatchlist";
import CoinIcon from "./CoinIcon";
import { dated, day, dollars, qty, when } from "./dcaFormat";
import { Live } from "./Figures";
import PotChat, { usePotChat } from "./PotChat";
import PotNewTrade from "./PotNewTrade";
import NewTradeFlow, { OddsLine } from "./NewTradeFlow";
import PotPanel, { px, rewardOf, rWord, rr, tone } from "./PotPanel";
import { RuleBreakBanner } from "./RuleMarks";
import type {
  PotAction,
  PotCheck,
  PotOdds,
  PotProposal,
  PotStyleKey,
  PotTrade,
  PotPreview,
  PotView,
  RuleBreak,
} from "./types";
import "./pot.css";

// Dollars without empty cents: $1, $0.81, $10.
const cash = (v: string | number) => dollars(v).replace(/\.00$/, "");
const REGIME = { bull: "Bull", neutral: "Neutral", bear: "Bear" } as const;
const TAB_KEY = "desk.account.tab";
const TABS = [
  ["positions", "Positions"],
  ["orders", "Orders"],
  ["history", "History"],
  ["stats", "Stats"],
  ["ledger", "Ledger"],
] as const;
type Tab = (typeof TABS)[number][0];
function readTab(): Tab {
  try {
    const kept = window.localStorage.getItem(TAB_KEY);
    return TABS.find(([k]) => k === kept)?.[0] ?? "positions";
  } catch {
    return "positions";
  }
}
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

// Every trade as CSV; quotes guard commas and formulas.
function toCsv(trades: PotTrade[]): string {
  const cell = (v: string | number | null) => {
    const text = v === null ? "" : String(v);
    return /^[=+\-@]/.test(text) || /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [
    "Ref",
    "Coin",
    "Setup",
    "Status",
    "Entry",
    "Stop",
    "Target",
    "Qty",
    "Spend",
    "Exit",
    "Result USDC",
    "R",
    "Fees USDC",
    "Rules kept",
    "Opened",
    "Closed",
  ];
  const rows = trades.map((t) =>
    [
      t.ref,
      t.coin,
      t.setup,
      t.status,
      t.fillPrice ?? t.entry,
      t.stop,
      t.target,
      t.qty,
      t.spend,
      t.exitPrice,
      t.result,
      t.r,
      t.fees,
      t.rulesKept ? "yes" : "no",
      new Date(t.created).toISOString(),
      t.closed ? new Date(t.closed).toISOString() : null,
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

// The trade as a line: stop on the left, target on the right, the entry between, and now.
function Ladder({ trade }: { trade: PotTrade }) {
  const stop = Number(trade.stop);
  const span = Number(trade.target) - stop || 1;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - stop) / span) * 100));
  const entry = Number(trade.fillPrice ?? trade.entry);
  const now = trade.now === null ? null : Number(trade.now);
  const waiting = trade.status !== "open";
  return (
    <span
      className="pot-ladder"
      style={{ "--e": `${at(entry)}%` } as CSSProperties}
      aria-label={`Stop ${px(trade.stop)}, entry ${px(entry)}, target ${px(trade.target)}${now === null ? "" : `, now ${px(now)}`}${waiting ? "; entry not filled" : ""}`}
    >
      <span className="pot-rail" />
      <span className="pot-pin is-stop" style={{ left: "0%" }}>
        {px(trade.stop)}
      </span>
      <span className="pot-pin" style={{ left: `${at(entry)}%` }}>
        {px(entry)}
      </span>
      <span className="pot-pin is-target" style={{ left: "100%" }}>
        {px(trade.target)}
      </span>
      {now !== null && (
        <span
          className={`pot-now${waiting ? " is-waiting" : ""}`}
          style={{ left: `${at(now)}%` }}
        />
      )}
    </span>
  );
}

function TradeRow({ trade, onOpen }: { trade: PotTrade; onOpen: () => void }) {
  const waiting = trade.status !== "open";
  const n = Number(trade.result ?? 0);
  const gap =
    trade.now !== null ? ((Number(trade.now) / Number(trade.entry) - 1) * 100).toFixed(1) : null;
  // How far the coin has moved from the fill, the way a chart reads it; the result when no price.
  const fill = Number(trade.fillPrice ?? trade.entry);
  const moved =
    trade.now !== null && fill > 0
      ? (Number(trade.now) / fill - 1) * 100
      : Number(trade.spend) > 0
        ? (n / Number(trade.spend)) * 100
        : null;
  return (
    <li>
      <button
        type="button"
        className="pot-trade"
        aria-label={`${trade.coin} trade ${trade.ref}: open its panel`}
        onClick={onOpen}
      >
        <span>
          <span className="dcb-coin">
            <CoinIcon coin={trade.coin} />
            {trade.coin}
          </span>
          <small className="dcb-id">
            {trade.ref}, {trade.setup}
          </small>
        </span>
        <Ladder trade={trade} />
        <span className="r">
          {waiting ? (
            <span className="muted num">
              {gap === null
                ? "Entry waiting"
                : `${Math.abs(Number(gap))}% ${Number(gap) >= 0 ? "above" : "below"} entry`}
            </span>
          ) : (
            <>
              <b className={`pot-r num ${tone(moved ?? n)}`}>
                {moved === null ? rWord(trade.r) : percent(String(moved))}
              </b>
              <small className={`num ${tone(n)}`}>{dollars(trade.result, true)}</small>
            </>
          )}
        </span>
        <span className="r">
          <span className={`pot-tag ${waiting ? "is-wait" : "is-live"}`}>
            {waiting ? "Entry waiting" : "In trade"}
          </span>
        </span>
      </button>
    </li>
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

function Checked({ found }: { found: PotCheck }) {
  const clean = !found.missing.length && !found.unknown.length && !found.differ.length;
  return (
    <div className={clean ? "muted" : "dcb-warn"} role="status">
      {clean
        ? `Binance matches the pot: ${found.matched} ${found.matched === 1 ? "order" : "orders"}.`
        : `${found.matched} matched.`}
      {found.missing.length > 0 && <p>Not found on Binance: {found.missing.join(", ")}.</p>}
      {found.unknown.length > 0 && (
        <p>On Binance but not in the pot: {found.unknown.join(", ")}.</p>
      )}
      {found.differ.map((d) => (
        <p key={d.ref}>
          {d.ref}: the pot says {d.desk}, Binance says {d.binance}.
        </p>
      ))}
    </div>
  );
}

// tradingOn: the side panel's kill switch, from App, so this page says at once when it changes;
// null while unknown (and in tests that render the page alone).
export default function PotPage({ tradingOn = null }: { tradingOn?: boolean | null }) {
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
  const [tab, setTab] = useState<Tab>(readTab);
  const [chatOpen, setChatOpen] = useState(() => readFlag(CHAT_KEY));
  const [checked, setChecked] = useState<PotCheck | null>(null);
  const [checking, setChecking] = useState(false);
  // null: closed; "": New trade on its first coin; a coin: opened from that coin's card.
  const [building, setBuilding] = useState<string | null>(null);
  // New trade by style (NewTradeFlow): open or not.
  const [flow, setFlow] = useState(false);
  // Bumped after a scan, so the watchlist reads its coins again.
  const [coinsVersion, setCoinsVersion] = useState(0);
  const review = useRef<HTMLDialogElement>(null);
  // Bumped on each ask for the price now and when the review closes: a late reply is dropped,
  // so it can't switch a closed or changed review to market.
  const marketAsk = useRef(0);
  const chat = usePotChat();

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

  const openChat = (on: boolean) => {
    setChatOpen(on);
    saveFlag(CHAT_KEY, on);
  };
  const pickTab = (key: Tab) => {
    setTab(key);
    try {
      window.localStorage.setItem(TAB_KEY, key);
    } catch {
      // not kept: Positions next time
    }
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
  const result = Number(pot.result);
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
  const sum = (ts: PotTrade[], k: "result" | "spend") =>
    ts.reduce((s, t) => s + Number(t[k] ?? 0), 0);
  const ofBase = (usd: number, base: number) => (base > 0 ? String((usd / base) * 100) : null);
  // Unrealized: open trades against what they cost. Realized: closed trades against what went in.
  const unrealUsd = sum(held, "result");
  const unrealPct = ofBase(unrealUsd, sum(held, "spend"));
  const closedAll = done.filter((t) => t.status === "closed");
  const realUsd = sum(closedAll, "result");
  const realPct = ofBase(realUsd, putIn);
  const waiting = on.filter((t) => t.status !== "open");
  const inTrades = Math.max(0, Number(pot.value) - Number(pot.cash));
  const openLimit = (Number(pot.value) * 3) / 100;
  const short = Number(pot.backing?.short ?? 0);
  const used = Math.max(0, -Number(pot.monthResult));
  const openTrade = pot.trades.find((t) => t.ref === openRef) ?? null;

  const scan = () => {
    setScanning(true);
    setSaid(null);
    scanPot().then(
      (p) => {
        setPot(p);
        setScanning(false);
        setCoinsVersion((v) => v + 1);
        const n = p.proposals.length;
        setSaid(
          n
            ? `Scanned: ${n} ${n === 1 ? "setup" : "setups"} waiting for you below.`
            : "Scanned: no setup today. That's most days, and the method working.",
        );
      },
      (e: unknown) => {
        setScanning(false);
        setSaid(errorOf(e, "trading-agent couldn't scan. Try again in a minute."));
      },
    );
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
  const runCheck = () => {
    setChecking(true);
    checkPot().then(
      (found) => {
        setChecked(found);
        setChecking(false);
      },
      (e: unknown) => {
        setChecking(false);
        setSaid(errorOf(e, "Binance couldn't be read. Try again in a minute."));
      },
    );
  };
  const exportCsv = () => {
    const blob = new Blob([toCsv(pot.trades)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-pot-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
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
        {putIn > 0 ? (
          <section className="acc-head" aria-label="The account">
            <dl className="acc-money">
              <div>
                <dt>Available</dt>
                <dd className="num">
                  <Live value={pot.cash}>{dollars(pot.cash)}</Live>
                </dd>
              </div>
              <div>
                <dt>In trades</dt>
                <dd className="num">{dollars(inTrades)}</dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd className="num">
                  <Live value={pot.value}>{dollars(pot.value)}</Live>
                </dd>
              </div>
              <div>
                <dt>Unrealized</dt>
                <dd className={`num ${tone(unrealUsd)}`}>
                  {dollars(unrealUsd, true)}{" "}
                  {unrealPct !== null && <span className="pot-of">{percent(unrealPct)}</span>}
                </dd>
              </div>
              <div>
                <dt>Realized</dt>
                <dd className={`num ${tone(realUsd)}`}>
                  {dollars(realUsd, true)}{" "}
                  {realPct !== null && <span className="pot-of">{percent(realPct)}</span>}
                </dd>
                <small className={`acc-month num ${tone(monthUsd)}`}>
                  {dollars(monthUsd, true)} this month
                </small>
              </div>
            </dl>
            <div className="acc-sub">
              <p className="acc-said">
                {pot.proposals.length > 0
                  ? `${pot.proposals.length} ${pot.proposals.length === 1 ? "setup is" : "setups are"} waiting for you.`
                  : on.length === 0
                    ? "No trades on: trading-agent waits for its setup."
                    : `${on.length} ${on.length === 1 ? "trade" : "trades"} on${result !== 0 ? `, ${result > 0 ? "up" : "down"} ${dollars(Math.abs(result))} from trading` : ""}.`}
              </p>
              <ul className="acc-chips num" aria-label="The risk rules">
                <li title="Sized from the stop">
                  Risk a trade <b>{dollars(pot.allowedRisk ?? "0")}</b>
                  <small>
                    {pot.config.riskPct}%
                    {pot.config.maxRisk ? `, at most ${cash(pot.config.maxRisk)}` : ""}
                  </small>
                </li>
                <li>
                  Open risk <b>{dollars(pot.openRisk)}</b> <small>of {dollars(openLimit)}</small>
                </li>
                <li>
                  Month's loss <b>{dollars(used)}</b> <small>of {dollars(pot.monthLimit)}</small>
                </li>
              </ul>
            </div>
          </section>
        ) : (
          <p className="acc-said">Put money in to start; it's kept apart from the DCA book.</p>
        )}

        {short > 0 && (
          <p className="dcb-warn" role="alert">
            Free {pot.quote} on Binance is {dollars(short)} short of the account's available{" "}
            {dollars(pot.backing?.held ?? "0")}. The DCA book and hand orders spend the same{" "}
            {pot.quote}, so they can dip into it; each time is logged. Top up to cover it.
          </p>
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
            <div className="acc-strip" aria-label="The market today">
              <span className={`acc-regime is-${pot.regime.state ?? "none"}`}>
                {pot.regime.state ? REGIME[pot.regime.state] : "Unknown"}
              </span>
              <span className="acc-btc">BTC {pot.regime.words || "—"}</span>
              <span
                className="acc-scan"
                title={`${pot.lastScan?.line ?? ""}${pot.scansOnItsOwn ? ` Next scan ${when(pot.nextScan)}.` : " Scans paused."}`}
              >
                {scanning
                  ? "Scanning the market…"
                  : pot.lastScan
                    ? `${when(pot.lastScan.at)}: ${pot.lastScan.line}`
                    : "Not scanned yet"}
              </span>
              <div className="acc-acts">
                <button type="button" className="btn" disabled={scanning} onClick={scan}>
                  {scanning ? "Scanning…" : "Scan now"}
                </button>
                <button type="button" className="btn btn-accent" onClick={() => setFlow(true)}>
                  New trade
                </button>
              </div>
            </div>

            {said && (
              <p className="acc-toast" role="status">
                {said}
              </p>
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

            <section className="dcb-section acc-tabs-wrap" aria-label="Trades">
              <div className="acc-tabs" role="tablist" aria-label="Trades">
                {TABS.map(([key, label]) => {
                  const n =
                    key === "positions" ? held.length : key === "orders" ? waiting.length : null;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      id={`acc-tab-${key}`}
                      aria-selected={tab === key}
                      aria-controls="acc-panel"
                      className={tab === key ? "is-on" : ""}
                      onClick={() => pickTab(key)}
                    >
                      {label}
                      {n ? <span className="acc-n">{n}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div id="acc-panel" role="tabpanel" aria-labelledby={`acc-tab-${tab}`}>
                {tab === "positions" &&
                  (held.length === 0 ? (
                    <p className="pot-empty">
                      <b>No positions.</b> New trade sets one up; trading-agent can analyse a coin
                      and fill it in by your rules.
                    </p>
                  ) : (
                    <ul className="pot-trades">
                      {held.map((t) => (
                        <TradeRow key={t.ref} trade={t} onOpen={() => setOpenRef(t.ref)} />
                      ))}
                    </ul>
                  ))}
                {tab === "orders" &&
                  (waiting.length === 0 ? (
                    <p className="pot-empty">
                      <b>No entries waiting.</b> A placed trade waits here until its limit fills.
                    </p>
                  ) : (
                    <ul className="pot-trades">
                      {waiting.map((t) => (
                        <TradeRow key={t.ref} trade={t} onOpen={() => setOpenRef(t.ref)} />
                      ))}
                    </ul>
                  ))}
                {tab === "history" &&
                  (done.length === 0 ? (
                    <p className="pot-empty">
                      <b>No closed trades yet.</b> Each one lands here with its result in dollars
                      and R.
                    </p>
                  ) : (
                    <>
                      <div className="dcb-scroll">
                        <table className="dcb-table" aria-label="Every trade">
                          <thead>
                            <tr>
                              <th>Trade</th>
                              <th>Setup</th>
                              <th className="r">Entry</th>
                              <th className="r">Exit</th>
                              <th className="r">Result</th>
                              <th className="r">Fees</th>
                              <th>Rules</th>
                            </tr>
                          </thead>
                          <tbody>
                            {done.map((t) => (
                              <tr key={t.ref}>
                                <td>
                                  <button
                                    type="button"
                                    className="link"
                                    onClick={() => setOpenRef(t.ref)}
                                  >
                                    {t.coin}
                                  </button>{" "}
                                  <span className="dcb-id">{t.ref}</span>
                                </td>
                                <td>{t.status === "cancelled" ? "Cancelled" : t.setup}</td>
                                <td className="r num">{px(t.fillPrice ?? t.entry)}</td>
                                <td className="r num">{px(t.exitPrice)}</td>
                                <td className={`r num ${tone(Number(t.result ?? 0))}`}>
                                  {t.status === "closed"
                                    ? `${rWord(t.r)}, ${dollars(t.result, true)}`
                                    : "—"}
                                </td>
                                <td className="r num muted">{dollars(t.fees)}</td>
                                <td>
                                  <span className={`pot-tag ${t.rulesKept ? "is-won" : "is-lost"}`}>
                                    {t.rulesKept ? "Kept" : "Broken"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="pot-tools">
                        <button type="button" className="link" onClick={exportCsv}>
                          Export CSV
                        </button>
                      </p>
                    </>
                  ))}
                {tab === "stats" && (
                  <>
                    <dl className="pot-stats">
                      <div>
                        <dt>Trades</dt>
                        <dd className="num">{pot.stats.trades}</dd>
                      </div>
                      <div>
                        <dt>Win rate</dt>
                        <dd className="num">
                          {pot.stats.winRate === null ? "—" : `${pot.stats.winRate}%`}
                        </dd>
                      </div>
                      <div>
                        <dt>Average win</dt>
                        <dd className="num">{rWord(pot.stats.avgWinR)}</dd>
                      </div>
                      <div>
                        <dt>Average loss</dt>
                        <dd className="num">{rWord(pot.stats.avgLossR)}</dd>
                      </div>
                      <div>
                        <dt>Expectancy</dt>
                        <dd className="num">{rWord(pot.stats.expectancyR)}</dd>
                      </div>
                      <div>
                        <dt>Deepest drawdown</dt>
                        <dd className="num">{pot.stats.drawdownPct}%</dd>
                      </div>
                    </dl>
                    <p className="muted">
                      The method is judged after {pot.stats.judgeAfter} trades:{" "}
                      {Math.min(pot.stats.trades, pot.stats.judgeAfter)} of {pot.stats.judgeAfter}{" "}
                      so far.
                    </p>
                  </>
                )}
                {tab === "ledger" && (
                  <div className="acc-ledger">
                    <table className="dcb-table" aria-label="The account's ledger">
                      <thead>
                        <tr>
                          <th>Ref</th>
                          <th>What</th>
                          <th className="r">USDC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pot.moves.map((m) => (
                          <tr key={m.ref}>
                            <td className="dcb-id">{m.ref}</td>
                            <td>
                              {m.kind === "in" ? "Put in" : "Taken out"}, {day(m.created)}
                            </td>
                            <td className="r num">
                              {m.kind === "in" ? "+" : "−"}
                              {px(m.usdc)}
                            </td>
                          </tr>
                        ))}
                        {done
                          .filter((t) => t.status === "closed")
                          .map((t) => (
                            <tr key={t.ref}>
                              <td className="dcb-id">{t.ref}</td>
                              <td>Closed, after fees</td>
                              <td className={`r num ${tone(Number(t.result ?? 0))}`}>
                                {Number(t.result ?? 0) >= 0 ? "+" : "−"}
                                {px(Math.abs(Number(t.result ?? 0)))}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <div>
                      <PutIn label="Put in more" onDone={setPot} />
                      <p className="pot-tools">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={checking}
                          onClick={runCheck}
                        >
                          {checking ? "Checking…" : "Check against Binance"}
                        </button>
                      </p>
                      {checked && <Checked found={checked} />}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <AccountWatchlist version={coinsVersion} onTrade={(coin) => setBuilding(coin)} />
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
          onReview={(t) => {
            setPlaceError(null);
            setPending(t);
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
