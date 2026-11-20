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
  return (
    <ul className="pot-scan pot-mkt" aria-label="The market today">
      <li className="pot-scan-card">
        <Opener name="Market regime" onOpen={(el) => onOpen({ kind: "regime" }, el)}>
          Market regime
        </Opener>
        <p className={`pot-mkt-fig is-${regime.state ?? "none"}`}>
          {regime.state ? REGIME[regime.state] : "—"}
        </p>
        <small className="pot-mkt-line">
          {regime.state === null
            ? regime.words || "Not known yet"
            : regime.state === "bear"
              ? "No new trades"
              : "New trades allowed"}
        </small>
      </li>
      <li className="pot-scan-card">
        <Opener name="BTC against its averages" onOpen={(el) => onOpen({ kind: "btc" }, el)}>
          BTC against its averages
        </Opener>
        <p className="pot-mkt-fig num">{dollars(regime.btc)}</p>
        <small className="pot-mkt-line num">
          {gaps.length > 0 ? gaps.join(" · ") : regime.words ? `BTC ${regime.words}` : "—"}
        </small>
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
    </section>
  );
}
