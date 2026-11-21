// The Trade page's scan, as the process a trader follows (owner, 21 Nov 2026;
// docs/mockups/trade-scan.html): what it reads, the market's gates before any coin, each
// style's steps from 100 coins to a trade with the coins that fell out and why, what the AI was
// given, searched and said, and the near misses with the price that would make each a setup.
// Every section folds (Fold.tsx).
import { when } from "./dcaFormat";
import Fold from "./Fold";
import type { BtcGate, MarketGlobal, PotView, ScanGates, Sentiment } from "./types";

const REGIME_WORD = { bull: "Bull", neutral: "Neutral", bear: "Bear" } as const;

const n0 = (v: string | number) =>
  Number(v).toLocaleString("en-AU", { maximumFractionDigits: Number(v) >= 100 ? 0 : 2 });

function Gate({ name, gate }: { name: string; gate?: BtcGate }) {
  if (!gate || !gate.close) {
    return (
      <div className="scr-gate">
        <small>{name}</small>
        <b>—</b>
      </div>
    );
  }
  const gap = (Number(gate.ema) / Number(gate.close) - 1) * 100;
  return (
    <div className="scr-gate">
      <small>
        {name}: BTC's {gate.frame} trend
      </small>
      <b className={gate.open ? "up" : "down"}>{gate.open ? "Open" : "Shut"}</b>
      <span className="scr-gate-line num">
        {gate.open
          ? `BTC ${Math.abs(gap).toFixed(1)}% over its 50 EMA`
          : `Opens on a close over $${n0(gate.ema)} (+${gap.toFixed(1)}%)`}
      </span>
    </div>
  );
}

function Gates({
  gates,
  pot,
  fear,
  global,
}: {
  gates?: ScanGates;
  pot: PotView;
  fear: Sentiment | null;
  global: MarketGlobal | null;
}) {
  const regime = gates?.regime ?? pot.regime;
  const btc = Number(regime.btc);
  const fast = Number(regime.sma50);
  const slow = Number(regime.sma200);
  const tests =
    btc > 0 && fast > 0 && slow > 0
      ? [
          { label: "BTC > 200d", ok: btc > slow },
          { label: "50d > 200d", ok: fast > slow },
        ]
      : [];
  const bearIn = Number(regime.bearIn);
  const turn =
    regime.state === "bull"
      ? `Neutral < $${n0(slow)}`
      : regime.state === "bear"
        ? "Neutral once BTC is back over its 200-day"
        : tests[0] && !tests[0].ok
          ? `Bull > $${n0(slow)} (+${((slow / btc - 1) * 100).toFixed(0)}%)${bearIn > 0 ? ` · Bear in ~${bearIn}d` : ""}`
          : "Bull once the 50-day crosses over";
  const mood = gates?.fearGreed ?? (fear ? { value: fear.value, label: fear.label } : null);
  const share = gates?.dominance?.share ?? global?.btcShare;
  const change = gates?.dominance?.change7d;
  return (
    <div className="scr-gates num">
      <div className="scr-gate">
        <small>Regime</small>
        <b className={`is-${regime.state ?? "none"}`}>
          {regime.state ? REGIME_WORD[regime.state] : "—"}
        </b>
        <span className="pot-mkt-checks">
          {tests.map((t) => (
            <span key={t.label} className={t.ok ? "is-yes" : "is-no"}>
              <span aria-hidden="true">{t.ok ? "✓" : "✕"}</span>
              {t.label}
            </span>
          ))}
        </span>
        <span className="scr-gate-line">{turn}</span>
      </div>
      <Gate name="Scalp" gate={gates?.scalp} />
      <Gate name="Day trade" gate={gates?.day} />
      <div className="scr-gate">
        <small>Macro · next 14 days</small>
        <b>{gates ? `${gates.macro.length} high-impact` : "—"}</b>
        <ul className="scr-list">
          {(gates?.macro ?? []).slice(0, 3).map((e) => (
            <li key={`${e.title}${e.at}`}>
              {e.title} <span className="muted">· {e.when}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="scr-gate">
        <small>Mood</small>
        <b>{mood ? `${mood.value} · ${mood.label}` : "—"}</b>
        <span className="scr-gate-line">
          {share ? `BTC dominance ${Number(share).toFixed(1)}%` : ""}
          {change ? ` (${Number(change) > 0 ? "+" : ""}${change} in 7d)` : ""}
          {gates?.weekend ? " · weekend: thin books" : ""}
        </span>
      </div>
    </div>
  );
}

export default function ScanReport({
  pot,
  fear,
  global,
  scanning,
}: {
  pot: PotView;
  fear: Sentiment | null;
  global: MarketGlobal | null;
  scanning: boolean;
}) {
  const last = pot.lastScan;
  const gates = last?.gates;
  const events = gates?.macro ?? [];
  const regime = gates?.regime.state ?? pot.regime.state;
  const mood = gates?.fearGreed ?? (fear ? { value: fear.value, label: fear.label } : null);
  const chip = (text: string, tone = "") => (
    <span key={text} className={`fold-chip ${tone}`}>
      {text}
    </span>
  );
  return (
    <div className="scr">
      <Fold
        id="scr-gates"
        title="Market"
        summary={
          <>
            {regime && chip(REGIME_WORD[regime], `is-${regime}`)}
            {gates?.scalp &&
              chip(`Scalp ${gates.scalp.open ? "open" : "shut"}`, gates.scalp.open ? "up" : "down")}
            {gates?.day &&
              chip(`Day ${gates.day.open ? "open" : "shut"}`, gates.day.open ? "up" : "down")}
            {mood &&
              chip(`F&G ${mood.value}`, mood.value < 25 ? "down" : mood.value > 75 ? "up" : "")}
            {events[0] && chip(`${events[0].title.split(" ")[0]} in ${events[0].inDays}d`, "wait")}
            {scanning ? chip("Scanning…") : last ? chip(`Scanned ${when(last.at)}`) : null}
          </>
        }
      >
        <Gates gates={gates} pot={pot} fear={fear} global={global} />
      </Fold>
    </div>
  );
}
