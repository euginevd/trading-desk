// The figures behind a tile or card on the Trade page, in the Dashboard's details panel
// (WidgetDetails.tsx, decision 42): one dialog, its content by what was clicked. Everything
// comes from the account's own view; nothing is fetched here.
import { useEffect, useRef, type ReactNode } from "react";
import { percent, usdShort } from "./format";
import CoinIcon from "./CoinIcon";
import { dated, day, dollars, when } from "./dcaFormat";
import { gapPct, REGIME, share, type PotDetailOf } from "./PotMarket";
import { px, rWord, tone } from "./PotPanel";
import type { MarketGlobal, PotScanCard, PotTrade, PotView, Sentiment } from "./types";

const SHOWN = 8; // rows in a panel's list; the tab it points to has them all
const TITLE: Record<Exclude<PotDetailOf["kind"], "style">, string> = {
  value: "The account's value",
  unrealized: "Unrealized: trades still open",
  realized: "Realized: trades closed",
  risk: "Open risk",
  month: "This month's loss limit",
  regime: "The market regime",
  btc: "BTC against its averages",
  mood: "Fear & Greed and BTC dominance",
  scan: "The scan",
};

function Row({ k, v, cls = "" }: { k: ReactNode; v: ReactNode; cls?: string }) {
  return (
    <div className="kv">
      <span className="muted">{k}</span>
      <span className={`num ${cls}`}>{v}</span>
    </div>
  );
}
const sum = (ts: PotTrade[], of: (t: PotTrade) => string | null) =>
  ts.reduce((s, t) => s + Number(of(t) ?? 0), 0);
const named = (t: PotTrade) => (
  <>
    {t.coin} <span className="dcb-id">{t.ref}</span>
  </>
);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Shared = {
  pot: PotView;
  fear: Sentiment | null;
  global: MarketGlobal | null;
  openLimit: number;
  perTrade: string;
  cards: PotScanCard[] | undefined;
  onTab: (tab: "positions" | "history" | "ledger") => void;
  onNewTrade: () => void;
  onReview: (id: string) => void;
};

function Money({ pot, onTab }: Shared) {
  const closed = pot.trades.filter((t) => t.status === "closed");
  const held = pot.trades.filter((t) => t.status === "open");
  const moved = (kind: "in" | "out") =>
    pot.moves.filter((m) => m.kind === kind).reduce((s, m) => s + Number(m.usdc), 0);
  const out = moved("out");
  const real = sum(closed, (t) => t.result);
  const unreal = sum(held, (t) => t.result);
  const inTrades = Math.max(0, Number(pot.value) - Number(pot.cash));
  return (
    <>
      <p className="detail-summary">
        What went in, less what came out, plus every trade's result after fees.
      </p>
      <Row k="Put in" v={dollars(moved("in"))} />
      {out > 0 && <Row k="Taken out" v={dollars(-out)} />}
      <Row k={`Closed trades (${closed.length})`} v={dollars(real, true)} cls={tone(real)} />
      <Row
        k={`Open trades at the price now (${held.length})`}
        v={dollars(unreal, true)}
        cls={tone(unreal)}
      />
      <Row k="Value" v={dollars(pot.value)} />
      <h3 className="detail-h">Where it sits</h3>
      <Row k="Available" v={dollars(pot.cash)} />
      <Row k="In trades" v={dollars(inTrades)} />
      <Row k="Fees so far, already in the results" v={dollars(pot.fees)} />
      <h3 className="detail-h">Money in and out</h3>
      {pot.moves.length === 0 && <p className="muted">Nothing put in yet.</p>}
      {pot.moves.slice(-SHOWN).map((m) => (
        <Row
          key={m.ref}
          k={`${m.kind === "in" ? "Put in" : "Taken out"}, ${day(m.created)}`}
          v={`${m.kind === "in" ? "+" : "−"}${px(m.usdc)}`}
        />
      ))}
      <div className="dlg-btns">
        <button type="button" className="btn" onClick={() => onTab("ledger")}>
          See the ledger
        </button>
      </div>
    </>
  );
}

function Unrealized({ pot, onTab }: Shared) {
  const held = pot.trades.filter((t) => t.status === "open");
  const waiting = pot.trades.filter((t) => t.status === "waiting" || t.status === "placing");
  const total = sum(held, (t) => t.result);
  return (
    <>
      <p className="detail-summary">
        Each open trade at the price now, after fees: its move from the fill, and its dollars.
      </p>
      {held.length === 0 && <p className="muted">No trades on.</p>}
      {held.map((t) => {
        const fill = Number(t.fillPrice ?? t.entry);
        const move = t.now !== null && fill > 0 ? (Number(t.now) / fill - 1) * 100 : null;
        const n = Number(t.result ?? 0);
        return (
          <Row
            key={t.ref}
            k={named(t)}
            v={`${move === null ? rWord(t.r) : percent(String(move))} · ${dollars(t.result, true)}`}
            cls={tone(n)}
          />
        );
      })}
      {held.length > 0 && <Row k="Together" v={dollars(total, true)} cls={tone(total)} />}
      {waiting.length > 0 && (
        <p className="muted">
          {count(waiting.length, "entry is", "entries are")} still waiting to fill, with no result
          yet.
        </p>
      )}
      <div className="dlg-btns">
        <button type="button" className="btn" onClick={() => onTab("positions")}>
          See positions
        </button>
      </div>
    </>
  );
}

function Realized({ pot, onTab }: Shared) {
  const closed = pot.trades.filter((t) => t.status === "closed");
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const month = closed.filter((t) => (t.closed ?? 0) >= monthStart.getTime());
  const block = (title: string, ts: PotTrade[]) => {
    const usd = sum(ts, (t) => t.result);
    const r = sum(ts, (t) => t.r);
    return (
      <>
        <h3 className="detail-h">{title}</h3>
        <Row k="Closed trades" v={ts.length} />
        <Row k="Won" v={`${ts.filter((t) => Number(t.result ?? 0) > 0).length} of ${ts.length}`} />
        <Row k="Result, after fees" v={dollars(usd, true)} cls={tone(usd)} />
        <Row k="In R" v={ts.length ? rWord(String(r)) : "—"} cls={tone(r)} />
      </>
    );
  };
  const latest = [...month].sort((a, b) => (b.closed ?? 0) - (a.closed ?? 0)).slice(0, SHOWN);
  return (
    <>
      <p className="detail-summary">
        What closed trades made or lost. R is the result as a multiple of what the trade risked.
      </p>
      {block("This month", month)}
      {block("All time", closed)}
      {latest.length > 0 && <h3 className="detail-h">Closed this month</h3>}
      {latest.map((t) => (
        <Row
          key={t.ref}
          k={named(t)}
          v={`${rWord(t.r)}, ${dollars(t.result, true)}`}
          cls={tone(Number(t.result ?? 0))}
        />
      ))}
      <div className="dlg-btns">
        <button type="button" className="btn" onClick={() => onTab("history")}>
          See history
        </button>
      </div>
    </>
  );
}

function Risk({ pot, openLimit, perTrade }: Shared) {
  const live = pot.trades.filter(
    (t) => t.status === "open" || t.status === "waiting" || t.status === "placing",
  );
  const open = Number(pot.openRisk);
  return (
    <>
      <p className="detail-summary">
        What every live trade would lose together if each hit its stop. The cap is a share of the
        account's value: a new trade is refused when its risk would take the total past it.
      </p>
      <Row k="Open risk now" v={dollars(open)} />
      <Row k="The cap" v={dollars(openLimit)} />
      <Row k="Left under the cap" v={dollars(Math.max(0, openLimit - open))} />
      <Row k="Allowed on one trade" v={`${dollars(pot.allowedRisk ?? "0")}, ${perTrade}`} />
      <h3 className="detail-h">Each live trade, as it was sized</h3>
      {live.length === 0 && <p className="muted">No live trades, so nothing is at risk.</p>}
      {live.map((t) => (
        <Row
          key={t.ref}
          k={
            <>
              {named(t)}
              {t.status === "open" ? "" : ", entry waiting"}
            </>
          }
          v={dollars(t.risk)}
        />
      ))}
      {live.length > 0 && (
        <p className="muted">
          The total is worked out from each fill and the stop as it stands now, so it can differ
          from these once an entry fills or a stop moves.
        </p>
      )}
    </>
  );
}

function Month({ pot }: Shared) {
  const result = Number(pot.monthResult);
  const limit = Number(pot.monthLimit);
  const used = Math.max(0, -result);
  return (
    <>
      <p className="detail-summary">
        Trading stops when the month's closed losses reach the limit, and starts again on the 1st.
      </p>
      <Row k="This month's result" v={dollars(result, true)} cls={tone(result)} />
      <Row k="The limit" v={dollars(limit)} />
      <Row k="Used" v={`${dollars(used)} of ${dollars(limit)}`} />
      <Row k="Left before trading stops" v={dollars(Math.max(0, limit - used))} />
    </>
  );
}

function Regime({ pot, first }: Shared & { first: "rule" | "figures" }) {
  const { regime } = pot;
  const against = (average: string | undefined) => {
    const gap = gapPct(regime.btc, average);
    const far =
      gap === null ? "" : ` · BTC ${Math.abs(gap).toFixed(1)}% ${gap >= 0 ? "above" : "under"}`;
    return `${dollars(average)}${far}`;
  };
  const rule = (
    <p className="detail-summary" key="rule">
      Bull: BTC is above its 200-day average and the 50-day is above the 200-day. Bear: both are
      under. Anything else is Neutral. In Bear the desk takes no new trades.
    </p>
  );
  const figures = (
    <div key="figures">
      <Row k="Regime now" v={regime.state ? REGIME[regime.state] : "—"} />
      <Row
        k="New trades"
        v={regime.state === null ? "—" : regime.state === "bear" ? "None" : "Allowed"}
      />
      <Row k="BTC" v={dollars(regime.btc)} />
      <Row k="50-day average" v={against(regime.sma50)} />
      <Row k="200-day average" v={against(regime.sma200)} />
    </div>
  );
  return (
    <>
      {first === "rule" ? [rule, figures] : [figures, rule]}
      {regime.words && <p className="muted">BTC is {regime.words}.</p>}
    </>
  );
}

function Mood({ fear, global }: Shared) {
  return (
    <>
      <p className="detail-summary">
        The Crypto Fear &amp; Greed Index runs from 0, extreme fear, to 100, extreme greed. BTC
        dominance is Bitcoin's share of the whole market: falling means money is moving into
        altcoins.
      </p>
      <Row k="Fear & Greed now" v={fear ? `${fear.value}, ${fear.label}` : "—"} />
      <Row k="Yesterday" v={fear?.yesterday ?? "—"} />
      <Row k="BTC dominance" v={share(global?.btcShare)} />
      <Row k="ETH's share" v={share(global?.ethShare)} />
      <Row k="The whole market" v={global?.cap ? usdShort(global.cap) : "—"} />
      <p className="muted">Fear &amp; Greed in the top bar opens its history.</p>
    </>
  );
}

function Scan({ pot }: Shared) {
  const { lastScan, proposals } = pot;
  return (
    <>
      <p className="detail-summary">
        Scan now runs all four styles. The daily scan at 11:15am runs swing, and position on
        Mondays. Nothing is placed without your review.
      </p>
      <Row k="Last scan" v={lastScan ? dated(lastScan.at, true) : "Not yet"} />
      <Row k="Next scan" v={pot.scansOnItsOwn ? when(pot.nextScan) : "Paused"} />
      <Row k="Waiting for review" v={proposals.length} />
      {proposals.map((p) => (
        <Row key={p.id} k={p.coin} v={p.setup} />
      ))}
      {lastScan?.line && (
        <>
          <h3 className="detail-h">What it said</h3>
          <p>{lastScan.line}</p>
        </>
      )}
    </>
  );
}

function Style({ card, onNewTrade, onReview }: Shared & { card: PotScanCard | undefined }) {
  if (!card) return <p className="muted">That style isn't in the last scan.</p>;
  const { take, close } = card;
  return (
    <>
      <p>
        <span className={`pot-tag ${take ? "is-live" : close ? "is-wait" : "is-quiet"}`}>
          {take ? "Take" : close ? "Near" : "Nothing near"}
        </span>
      </p>
      <p className="detail-summary">{card.line}</p>
      {take && (
        <>
          <h3 className="detail-h">trading-agent's take</h3>
          <Row
            k="Coin"
            v={
              <span className="dcb-coin">
                <CoinIcon coin={take.coin} />
                {take.coin}
              </span>
            }
          />
          <Row k="Setup" v={take.setup} />
          <Row k="Grade" v={take.grade} />
          <Row k="Entry, limit" v={px(take.entry)} />
          <Row k="Reward to risk" v={take.rr ? `${take.rr} : 1` : "—"} />
        </>
      )}
      {!take && close && (
        <>
          <h3 className="detail-h">Nearest to a setup</h3>
          <Row
            k="Coin"
            v={
              <span className="dcb-coin">
                <CoinIcon coin={close.coin} />
                {close.coin}
              </span>
            }
          />
          <p>What's missing: {close.why}</p>
        </>
      )}
      <p className="muted">
        New trade opens at its styles: pick {card.name} there to scan it again.
      </p>
      <div className="dlg-btns">
        <button type="button" className={take ? "btn" : "btn btn-accent"} onClick={onNewTrade}>
          New trade
        </button>
        {take && (
          <button type="button" className="btn btn-accent" onClick={() => onReview(take.id)}>
            Review {take.coin}
          </button>
        )}
      </div>
    </>
  );
}

export default function PotDetail({
  detail,
  onClosed,
  ...shared
}: Shared & { detail: PotDetailOf | null; onClosed: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    if (detail && !box.open) box.showModal?.();
    else if (!detail && box.open) box.close?.();
  }, [detail]);
  const card =
    detail?.kind === "style" ? shared.cards?.find((c) => c.style === detail.style) : undefined;
  return (
    <dialog
      ref={dialog}
      className="detail-panel"
      aria-labelledby="pot-detail-title"
      onClose={onClosed}
    >
      {detail && (
        <>
          <div className="detail-head">
            <h2 id="pot-detail-title">
              {detail.kind === "style" ? (card?.name ?? "Style") : TITLE[detail.kind]}
            </h2>
            <button
              type="button"
              className="link"
              aria-label="Close"
              onClick={() => dialog.current?.close?.()}
            >
              ✕
            </button>
          </div>
          {detail.kind === "value" && <Money {...shared} />}
          {detail.kind === "unrealized" && <Unrealized {...shared} />}
          {detail.kind === "realized" && <Realized {...shared} />}
          {detail.kind === "risk" && <Risk {...shared} />}
          {detail.kind === "month" && <Month {...shared} />}
          {detail.kind === "regime" && <Regime {...shared} first="rule" />}
          {detail.kind === "btc" && <Regime {...shared} first="figures" />}
          {detail.kind === "mood" && <Mood {...shared} />}
          {detail.kind === "scan" && <Scan {...shared} />}
          {detail.kind === "style" && <Style {...shared} card={card} />}
        </>
      )}
    </dialog>
  );
}
