// The Trade page's market row: four cards the size of the style cards under them (the regime,
// BTC against its averages, Fear & Greed with BTC dominance, and the scan), each opening its
// details (PotDetail.tsx); and Scan now's steps as they happen, a row per style, which fold
// to one line.
import type { ReactNode } from "react";
import { dollars, when } from "./dcaFormat";
import type { MarketGlobal, PotScanProgress, PotScanState, PotView, Sentiment } from "./types";

export const REGIME = { bull: "Bull", neutral: "Neutral", bear: "Bear" } as const;

// What a tile or card opens: the figures behind it.
export type PotDetailOf =
  | {
      kind:
        "value" | "unrealized" | "realized" | "risk" | "month" | "regime" | "btc" | "mood" | "scan";
    }
  | { kind: "style"; style: string };

// The card's label is its button, stretched over the whole card (pot.css, .pot-open), so a
// card that holds a button of its own, such as Review, nests nothing.
export function Opener({
  name,
  onOpen,
  children,
}: {
  name: string;
  onOpen: (from: HTMLElement) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pot-open"
      aria-label={`${name}: details`}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      {children}
    </button>
  );
}

// How far a price sits from an average, in percent; null when either is unknown.
export function gapPct(price: string | undefined, average: string | undefined): number | null {
  if (!price || !average) return null;
  const p = Number(price);
  const a = Number(average);
  if (!Number.isFinite(p) || !Number.isFinite(a) || !(p > 0) || !(a > 0)) return null;
  return (p / a - 1) * 100;
}
export function gapWords(pct: number | null, name: string): string | null {
  if (pct === null) return null;
  return `${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? "above" : "under"} its ${name}`;
}
// A share such as BTC's dominance, to one place; "—" when it isn't known.
export function share(value: string | undefined): string {
  const n = Number(value);
  return value && Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

export function MarketCards({
  pot,
  fear,
  global,
  scanning,
  onOpen,
}: {
  pot: PotView;
  fear: Sentiment | null;
  global: MarketGlobal | null;
  scanning: boolean;
  onOpen: (detail: PotDetailOf, from: HTMLElement) => void;
}) {
  const { regime, lastScan } = pot;
  const gaps = [
    gapWords(gapPct(regime.btc, regime.sma50), "50-day"),
    gapWords(gapPct(regime.btc, regime.sma200), "200-day"),
  ].filter((g): g is string => g !== null);
  const waiting = pot.proposals.length;
  // BTC against each average as a bar: its length is the distance, up to 25%.
  const avg = (label: string, value: string | undefined) => {
    const gap = gapPct(regime.btc, value);
    if (gap === null) return null;
    return (
      <span className="pot-mkt-avg" key={label}>
        <span>{label}</span>
        <span className="pot-mkt-avg-bar" aria-hidden="true">
          <i
            className={gap >= 0 ? "is-up" : "is-down"}
            style={{ width: `${Math.min(100, (Math.abs(gap) / 25) * 100)}%` }}
          />
        </span>
        <span className={gap >= 0 ? "up" : "down"}>
          {gap >= 0 ? "+" : "−"}
          {Math.abs(gap).toFixed(1)}%
        </span>
      </span>
    );
  };
  const bars = [avg("50-day", regime.sma50), avg("200-day", regime.sma200)].filter(Boolean);
  // The regime's two tests, so the card says why: Bull passes both, Bear fails both, Neutral
  // is one of each.
  const btc = Number(regime.btc);
  const fast = Number(regime.sma50);
  const slow = Number(regime.sma200);
  const checks =
    btc > 0 && fast > 0 && slow > 0
      ? [
          { label: "BTC > 200d", full: "BTC above its 200-day", ok: btc > slow },
          { label: "50d > 200d", full: "50-day above the 200-day", ok: fast > slow },
        ]
      : null;
  // What would change it: Bull has a price (BTC back over its 200-day, the 50-day above it);
  // Bear has none once BTC is under the 200-day, only the 50-day's slide, so it's in days.
  const upTo = (to: number) =>
    `${dollars(String(Math.round(to)))} (+${((to / btc - 1) * 100).toFixed(0)}%)`;
  const bearIn = Number(regime.bearIn);
  // One short line: what turns it, with the price or the days.
  const why =
    regime.state === "bull"
      ? `Neutral < ${dollars(String(Math.round(slow)))}`
      : regime.state === "bear"
        ? "Neutral once BTC is back over its 200-day"
        : checks && checks[0]?.ok === false
          ? `Bull > ${upTo(slow)}${bearIn > 0 ? ` · Bear in ~${bearIn}d` : ""}`
          : checks
            ? "Bull once the 50-day crosses over"
            : "";
  return (
    <ul className="pot-scan pot-mkt is-strip" aria-label="The market today">
      <li className="pot-scan-card">
        <Opener name="Market regime" onOpen={(el) => onOpen({ kind: "regime" }, el)}>
          Market regime
        </Opener>
        <p className={`pot-mkt-fig is-${regime.state ?? "none"}`}>
          {regime.state ? REGIME[regime.state] : "—"}
        </p>
        {checks ? (
          <>
            <ul className="pot-mkt-checks num" aria-label="What decides the regime">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className={c.ok ? "is-yes" : "is-no"}
                  title={`${c.full}: ${c.ok ? "yes" : "no"}`}
                >
                  <span aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
                  {c.label}
                </li>
              ))}
            </ul>
            <small className="pot-mkt-line num">{why}</small>
          </>
        ) : (
          <small className="pot-mkt-line">{regime.words || "Not known yet"}</small>
        )}
      </li>
      <li className="pot-scan-card">
        <Opener name="BTC against its averages" onOpen={(el) => onOpen({ kind: "btc" }, el)}>
          BTC
        </Opener>
        <p className="pot-mkt-fig num">{dollars(regime.btc)}</p>
        {bars.length > 0 ? (
          <span className="pot-mkt-avgs num" role="img" aria-label={gaps.join(" · ")}>
            {bars}
          </span>
        ) : (
          <small className="pot-mkt-line num">{regime.words ? `BTC ${regime.words}` : "—"}</small>
        )}
      </li>
      <li className="pot-scan-card">
        <Opener name="Fear and Greed" onOpen={(el) => onOpen({ kind: "mood" }, el)}>
          Fear &amp; Greed
        </Opener>
        <p className="pot-mkt-fig num">
          {fear && Number.isFinite(fear.value) ? (
            <>
              {fear.value} <small>{fear.label}</small>
            </>
          ) : (
            "—"
          )}
        </p>
        {fear && Number.isFinite(fear.value) && (
          <span className="pot-mkt-fg" aria-hidden="true">
            <i style={{ left: `${Math.min(100, Math.max(0, fear.value))}%` }} />
          </span>
        )}
        <small className="pot-mkt-line num">BTC dominance {share(global?.btcShare)}</small>
      </li>
      <li className="pot-scan-card">
        <Opener name="The scan" onOpen={(el) => onOpen({ kind: "scan" }, el)}>
          The scan
        </Opener>
        <p className="pot-mkt-fig num">
          {scanning ? "Scanning…" : lastScan ? when(lastScan.at) : "Not yet"}
        </p>
        <small className="pot-mkt-line">
          {lastScan && !lastScan.styles && !scanning
            ? // The daily scan leaves no card per style: its own line says what it found.
              lastScan.line
            : `${pot.scansOnItsOwn ? `Next ${when(pot.nextScan)}` : "Scans paused"} · ${
                waiting ? `${waiting} waiting for review` : "nothing waiting"
              }`}
        </small>
      </li>
    </ul>
  );
}

// What the scan reads, in one line each (the owner's wording, 21 Nov 2026).
export const INPUTS: [string, string][] = [
  ["Chart structure", "trend, support, volatility (ATR) and volume, read from Binance candles"],
  ["BTC's direction", "BTC's regime, plus its 1-hour and 4-hour trend for scalps and day trades"],
  ["Strength against BTC", "keeps only coins outperforming BTC over 30 days or 13 weeks"],
  ["Liquidity", "top 100 coins that trade enough each day to fill without slippage"],
  ["Coin catalysts", "unlocks, listings and hacks due within the hold, found by web search"],
  ["Back-test odds", "how often this exact setup paid off on the coin's own history"],
  ["Funding", "when longs pay a high rate the trade is crowded, and a flush hits spot too"],
  ["Macro calendar", "CPI, FOMC and jobs dates, read daily; warns when one lands inside the hold"],
  ["Fear & Greed", "context for the AI, never a rule: extremes don't time an entry"],
  ["BTC dominance", "when BTC's share of the market rises, alts tend to lag: a point against"],
  ["Open interest", "rising open interest with a rising price means a crowded, fragile move"],
  ["News tone", "the coin search also rates the week's headlines: positive, neutral or negative"],
  [
    "ETF flows and on-chain",
    "BTC and ETH swing and position trades: the week's ETF flows and exchange balances",
  ],
];

// Each stage as the owner reads it, and whether the style is being worked on now.
const STAGE: Record<PotScanState, string> = {
  waiting: "Waiting",
  screening: "Screening the top 100",
  "checking odds": "Checking funding and odds",
  judging: "trading-agent is judging",
  sizing: "Sizing and checking the rules",
  done: "Done",
  failed: "Failed",
};
const MARK: Partial<Record<PotScanState, string>> = { done: "✓", failed: "✕" };
const ended = (state: PotScanState) => state === "done" || state === "failed";
const tone = (state: PotScanState) =>
  state === "waiting" ? "waiting" : ended(state) ? state : "busy";

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The scan in one line: "Scanning: swing, judging… 2 of 4", then how it ended.
export function stepsLine(progress: PotScanProgress, scanning: boolean): string {
  const { steps } = progress;
  if (!scanning) {
    const failed = steps.filter((s) => s.state === "failed").length;
    const done = steps.filter((s) => s.state === "done").length;
    return `Scan finished: ${done} of ${steps.length} done${failed ? `, ${failed} failed` : ""}`;
  }
  const at = steps.findIndex((s) => !ended(s.state));
  const now = steps[at];
  if (!now) return "Scanning: finishing up…";
  return `Scanning: ${now.name.toLowerCase()}, ${now.state}… ${at + 1} of ${steps.length}`;
}

export function ScanSteps({
  progress,
  scanning,
  open,
  elapsed,
  onToggle,
}: {
  progress: PotScanProgress;
  scanning: boolean;
  open: boolean;
  elapsed: number;
  onToggle: () => void;
}) {
  return (
    <section className="pot-steps" aria-label="Scan steps">
      <div className="pot-steps-head">
        <p role="status">{stepsLine(progress, scanning)}</p>
        <span className="pot-steps-time num" aria-label={`Time taken ${clock(elapsed)}`}>
          {clock(elapsed)}
        </span>
        <button
          type="button"
          className="link"
          aria-expanded={open}
          aria-controls="pot-steps-list"
          onClick={onToggle}
        >
          {open ? "Hide steps" : "Show steps"}
        </button>
      </div>
      {open && (
        <ol id="pot-steps-list" className="pot-steps-list">
          {progress.steps.map((s) => (
            <li key={s.style} className={`is-${tone(s.state)}`}>
              <span className="pot-steps-icon" aria-hidden="true">
                {MARK[s.state] ?? ""}
              </span>
              <b>{s.name}</b>
              <span className="pot-steps-stage">{STAGE[s.state] ?? s.state}</span>
              <span className="pot-steps-notes">{s.notes.join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <details className="pot-steps-reads">
          <summary>What each scan reads ({INPUTS.length})</summary>
          <ul className="scr-checks">
            {INPUTS.map(([name, what]) => (
              <li key={name}>
                <i aria-hidden="true">✓</i>
                <b>{name}</b>
                <span>{what}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
