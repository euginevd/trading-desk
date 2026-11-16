// The Trade page: the trading pot as its own book, run by trading-agent (docs/plan-trade.md).
// It reads money first (put in, trading result, open risk, the month's loss limit), then the
// market and Scan now, what trading-agent proposes, the trades on as a stop–entry–target line,
// and, under Show more, every trade, the numbers, the pot's ledger and Check against Binance.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { checkPot, dismissPotProposal, getPot, placePotTrade, putInPot, scanPot } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { dated, day, dollars, qty, when } from "./dcaFormat";
import { Live } from "./Figures";
import PotChat, { usePotChat } from "./PotChat";
import PotNewTrade from "./PotNewTrade";
import PotPanel, { px, rWord, rr, tone } from "./PotPanel";
import type { PotAction, PotCheck, PotProposal, PotTrade, PotView } from "./types";
import "./pot.css";

// Dollars without empty cents: $1, $0.81, $10.
const cash = (v: string | number) => dollars(v).replace(/\.00$/, "");
const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const REGIME = { bull: "Bull", neutral: "Neutral", bear: "Bear" } as const;
const MORE_KEY = "desk.pot.more";
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
};
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
              <b className={`pot-r num ${tone(n)}`}>{rWord(trade.r)}</b>
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

export default function PotPage() {
  const [pot, setPot] = useState<PotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [more, setMore] = useState(() => readFlag(MORE_KEY));
  const [chatOpen, setChatOpen] = useState(() => readFlag(CHAT_KEY));
  const [checked, setChecked] = useState<PotCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [building, setBuilding] = useState(false);
  const review = useRef<HTMLDialogElement>(null);
  const chat = usePotChat();

  const load = useCallback(() => {
    getPot().then(
      (p) => {
        setPot(p);
        setError(null);
      },
      (e: unknown) => setError(errorOf(e, "The pot couldn't be read.")),
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

  const openChat = (on: boolean) => {
    setChatOpen(on);
    saveFlag(CHAT_KEY, on);
  };
  const toggleMore = () =>
    setMore((m) => {
      saveFlag(MORE_KEY, !m);
      return !m;
    });

  if (error && !pot) {
    return (
      <main className="wrap dcb pot">
        <h1>Trade</h1>
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
        <p className="muted">Reading the pot…</p>
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
  const monthR = thisMonth.reduce((s, t) => s + Number(t.r ?? 0), 0);
  const monthUsd = thisMonth.reduce((s, t) => s + Number(t.result ?? 0), 0);
  const first = pot.moves.find((m) => m.kind === "in");
  const test = pot.config.mode === "test";
  const used = Math.max(0, -Number(pot.monthResult));
  const openTrade = pot.trades.find((t) => t.ref === openRef) ?? null;

  const scan = () => {
    setScanning(true);
    setSaid(null);
    scanPot().then(
      (p) => {
        setPot(p);
        setScanning(false);
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
  const place = () => {
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
    }).then(
      (t) => {
        setPlacing(false);
        review.current?.close?.();
        setPending(null);
        setBuilding(false);
        setSaid(`${t.ref} placed: the entry waits on Binance at ${px(t.entry)}.`);
        load();
      },
      (e: unknown) => {
        setPlacing(false);
        setPlaceError(errorOf(e, "The trade wasn't placed."));
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
  const reward = pending
    ? (Number(pending.target) - Number(pending.entry)) * Number(pending.qty)
    : 0;

  return (
    <main className={`wrap dcb pot${chatOpen ? " has-chat" : ""}`}>
      <div className="dcb-main">
        <div className="dcb-top">
          <div>
            <h1 className="dcb-headline">
              {putIn > 0 ? (
                <>
                  Pot <Live value={pot.value}>{dollars(pot.value)}</Live>
                  {result !== 0
                    ? `, ${result > 0 ? "up" : "down"} ${dollars(Math.abs(result))} from trading.`
                    : "."}{" "}
                  {on.length === 0
                    ? "No trades on"
                    : `${on.length} ${on.length === 1 ? "trade" : "trades"} on`}
                  {pot.proposals.length > 0
                    ? `, ${pot.proposals.length} waiting for you.`
                    : on.length === 0
                      ? ": trading-agent waits for its setup."
                      : "."}
                </>
              ) : (
                "The trading pot is empty."
              )}
            </h1>
            <p className="muted dcb-sub">
              {first
                ? `${dollars(pot.putIn)} put in since ${day(first.created)}. `
                : "Put money in to start; it's kept apart from the DCA book. "}
              {test
                ? `Test phase: ${cash(pot.config.fixed)} a trade, at most ${putIn > 0 ? cash((putIn * Number(pot.config.riskPct)) / 100) : `${pot.config.riskPct}% of the pot`} at risk.`
                : `${pot.config.riskPct}% risk a trade, sized from the stop.`}
            </p>
          </div>
          {putIn > 0 && (
            <dl className="dcb-totals">
              <div>
                <dt>Put in</dt>
                <dd className="num">{dollars(pot.putIn)}</dd>
              </div>
              <div>
                <dt>Trading result</dt>
                <dd className={`num dcb-pnl ${result > 0 ? "is-up" : result < 0 ? "is-down" : ""}`}>
                  <Live value={pot.result}>{dollars(pot.result, true)}</Live>
                </dd>
              </div>
              <div>
                <dt>Open risk</dt>
                <dd className="num">{dollars(pot.openRisk)}</dd>
              </div>
              <div>
                <dt>Month's loss limit</dt>
                <dd className="num">
                  {dollars(used)} <span className="pot-of">of {dollars(pot.monthLimit)}</span>
                </dd>
              </div>
            </dl>
          )}
        </div>

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
              It comes from the USDC on Binance, kept as the pot's own ledger. Trades never spend
              more than the pot holds, and never touch the DCA book.
            </p>
          </section>
        ) : (
          <>
            <div className="pot-regime" aria-label="The market today">
              <div className={`pot-state is-${pot.regime.state ?? "none"}`}>
                <small>Regime</small>
                <b>{pot.regime.state ? REGIME[pot.regime.state] : "Unknown"}</b>
              </div>
              <div>
                <small>BTC</small>
                <span>{pot.regime.words || "—"}</span>
              </div>
              <div>
                <small>{pot.lastScan ? `Last scan, ${when(pot.lastScan.at)}` : "Last scan"}</small>
                <span>
                  {scanning
                    ? "trading-agent is reading the regime and every coin's daily chart. About a minute."
                    : pot.lastScan
                      ? pot.lastScan.line
                      : "Not yet"}
                </span>
              </div>
              <div>
                <small>Daily scan</small>
                <span>
                  {pot.scansOnItsOwn
                    ? `11:15am every day, on its own; a setup comes to Telegram too. Next ${when(pot.nextScan)}.`
                    : "Paused in Profile, My agents. Scan now runs it by hand."}
                </span>
              </div>
              <button
                type="button"
                className={`btn${on.length === 0 && pot.proposals.length === 0 ? " btn-accent" : ""}`}
                disabled={scanning}
                onClick={scan}
              >
                {scanning ? "Scanning…" : "Scan now"}
              </button>
            </div>

            {said && (
              <p className="muted" role="status">
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

            <section className="dcb-section" aria-labelledby="pot-on-title">
              <div className="dcb-section-head">
                <h2 id="pot-on-title">Open trades</h2>
                <span className="muted">
                  {on.length ? `${on.length} on, ${dollars(pot.openRisk)} at risk` : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-small pot-new"
                  onClick={() => setBuilding(true)}
                >
                  New trade
                </button>
              </div>
              {on.length === 0 ? (
                <p className="pot-empty">
                  <b>No trades on.</b> New trade sets one up, and trading-agent can analyse a coin
                  and fill it in by your rules.
                </p>
              ) : (
                <ul className="pot-trades">
                  {on.map((t) => (
                    <TradeRow key={t.ref} trade={t} onOpen={() => setOpenRef(t.ref)} />
                  ))}
                </ul>
              )}
            </section>

            <section className="dcb-section" aria-labelledby="pot-closed-title">
              <div className="dcb-section-head">
                <h2 id="pot-closed-title">Closed this month</h2>
                <span className="muted num">
                  {thisMonth.length
                    ? `${thisMonth.length} ${thisMonth.length === 1 ? "trade" : "trades"}, ${rWord(String(monthR))}, ${dollars(monthUsd, true)}`
                    : "None yet"}
                </span>
              </div>
              <button type="button" className="dcb-more" aria-expanded={more} onClick={toggleMore}>
                {more
                  ? "Show less"
                  : "Show more: every trade, the numbers, the pot's ledger, Check against Binance"}
              </button>
              {more && (
                <div className="pot-more">
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
                    {Math.min(pot.stats.trades, pot.stats.judgeAfter)} of {pot.stats.judgeAfter} so
                    far.
                  </p>
                  <div className="pot-cols">
                    <div>
                      <h3 className="dcb-drawer-sub">Every trade</h3>
                      {done.length === 0 ? (
                        <p className="muted">No closed trades yet.</p>
                      ) : (
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
                                    <span
                                      className={`pot-tag ${t.rulesKept ? "is-won" : "is-lost"}`}
                                    >
                                      {t.rulesKept ? "Kept" : "Broken"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="dcb-drawer-sub">The pot's ledger</h3>
                      <table className="dcb-table" aria-label="The pot's ledger">
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
                        <button type="button" className="link" onClick={exportCsv}>
                          Export CSV
                        </button>
                      </p>
                      {checked && <Checked found={checked} />}
                    </div>
                  </div>
                </div>
              )}
            </section>
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

      {building && (
        <PotNewTrade
          coins={pot.coins}
          onClose={() => setBuilding(false)}
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
          setPending(null);
          setPlaceError(null);
        }}
      >
        {pending && (
          <>
            <h2 id="pot-review-title">Place the {pending.coin} trade?</h2>
            <ul className="pot-rv" aria-label="The trade's orders">
              <li>
                <span className="pot-tag is-live">Entry</span>
                <span>
                  <b>{pending.coin}</b> limit buy {px(pending.entry)}
                </span>
                <span className="num">{dollars(pending.spend)}</span>
              </li>
              <li>
                <span className="pot-tag is-lost">Stop</span>
                <span>sell all at {px(pending.stop)}</span>
                <span className="num down">{dollars(-Number(pending.risk))}</span>
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
              Reward to risk {rr(pending)} : 1. The entry goes to Binance now, tagged as the trade's
              reference. Once it fills, the desk places the stop and target there as one OCO order,
              so they hold even if the desk is off.
            </p>
            {placeError && (
              <p className="error-text" role="alert">
                {placeError}
              </p>
            )}
            <div className="dlg-btns">
              <button className="btn" type="button" onClick={() => review.current?.close()}>
                Not yet
              </button>
              <button className="btn btn-accent" type="button" disabled={placing} onClick={place}>
                {placing ? "Placing…" : "Place the trade"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
