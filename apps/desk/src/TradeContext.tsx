// The Trade page's right column (TODO 6): a compact 4-hour chart with the agent's levels drawn on
// it, which opens the full TradingView chart on request; the levels; and the Profile's guardrails.
import { useEffect, useRef, useState } from "react";
import { aud, dateTime, price } from "./format";
import TradingViewChart from "./TradingViewChart";
import type { AgentRun, Market, PriceAlert } from "./types";

const W = 280;
const H = 170;
const PAD = 8;
const CANDLES = 60;

interface Mark {
  y: number;
  label: string;
  tone: "nochase" | "zone" | "inv";
}

function CompactChart({ market, run }: { market: Market; run: AgentRun | null }) {
  const closes = market.candles.slice(-CANDLES).map((c) => Number(c.c));
  const zones = run?.signal?.zones;
  const levels = [
    zones?.noChase ? Number(zones.noChase) : null,
    zones?.buy ? Number(zones.buy.low) : null,
    zones?.buy ? Number(zones.buy.high) : null,
    zones?.invalidation ? Number(zones.invalidation.price) : null,
  ].filter((v): v is number => v !== null && v > 0);
  const all = [...closes, ...levels];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = high - low || 1;
  const y = (v: number) => PAD + ((high - v) / span) * (H - PAD * 2);
  const x = (i: number) => (closes.length > 1 ? (i / (closes.length - 1)) * W : 0);
  const line = closes.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const marks: Mark[] = [];
  if (zones?.noChase)
    marks.push({
      y: y(Number(zones.noChase)),
      label: `Don't chase ${price(zones.noChase)}`,
      tone: "nochase",
    });
  if (zones?.invalidation)
    marks.push({
      y: y(Number(zones.invalidation.price)),
      label: `Invalidation ${price(zones.invalidation.price)}`,
      tone: "inv",
    });
  const zoneTop = zones?.buy ? y(Number(zones.buy.high)) : null;
  const zoneBottom = zones?.buy ? y(Number(zones.buy.low)) : null;
  return (
    <svg
      className="tr-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${market.coin} price, 4 hour${zones ? ", with the agent's levels" : ""}`}
    >
      {zoneTop !== null && zoneBottom !== null && (
        <>
          <rect
            className="tr-ch-zone"
            x={0}
            y={zoneTop}
            width={W}
            height={Math.max(1, zoneBottom - zoneTop)}
          />
          <line className="tr-ch-zone-line" x1={0} x2={W} y1={zoneTop} y2={zoneTop} />
          <text className="tr-ch-zone-text" x={W - 4} y={zoneTop - 3} textAnchor="end">
            Add zone
          </text>
        </>
      )}
      {marks.map((m) => (
        <g key={m.tone}>
          <line className={`tr-ch-${m.tone}`} x1={0} x2={W} y1={m.y} y2={m.y} />
          <text
            className={`tr-ch-${m.tone}-text`}
            x={W - 4}
            y={m.y < 14 ? m.y + 11 : m.y - 3}
            textAnchor="end"
          >
            {m.label}
          </text>
        </g>
      ))}
      <polyline className="tr-ch-price" points={line} />
    </svg>
  );
}

export function PriceCard({
  market,
  run,
  symbol,
}: {
  market: Market | null;
  run: AgentRun | null;
  symbol: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (full) dialog.current?.showModal?.();
  }, [full]);
  return (
    <section className="tr-card" aria-label="Price">
      <h2>
        Price · 4h
        {market && symbol && (
          <button type="button" className="link" onClick={() => setFull(true)}>
            Full chart
          </button>
        )}
      </h2>
      {market && market.candles.length > 1 ? (
        <CompactChart market={market} run={run} />
      ) : market ? (
        <p className="muted tr-empty">No candles yet for {market.coin}.</p>
      ) : (
        <div className="skeleton tr-chart-skeleton" aria-hidden="true" />
      )}
      {full && market && symbol && (
        <dialog
          ref={dialog}
          className="tr-full"
          aria-labelledby="tr-full-title"
          onClose={() => setFull(false)}
        >
          <div className="tr-full-head">
            <h2 id="tr-full-title">{market.pair} chart</h2>
            <button
              className="btn btn-small"
              type="button"
              onClick={() => dialog.current?.close?.()}
            >
              Close
            </button>
          </div>
          <TradingViewChart symbol={symbol} pair={market.pair} />
        </dialog>
      )}
    </section>
  );
}

export function LevelsCard({ run }: { run: AgentRun | null }) {
  const zones = run?.signal?.zones;
  const rows: { key: string; label: string; value: string; at: number }[] = [];
  if (zones?.noChase)
    rows.push({
      key: "nochase",
      label: "Don't chase above",
      value: price(zones.noChase),
      at: Number(zones.noChase),
    });
  for (const l of run?.levels ?? [])
    rows.push({ key: l.id, label: l.source, value: price(l.price), at: Number(l.price) });
  if (zones?.buy)
    rows.push({
      key: "zone",
      label: "Add zone",
      value: `${price(zones.buy.low)} – ${price(zones.buy.high)}`,
      at: Number(zones.buy.high),
    });
  if (zones?.invalidation)
    rows.push({
      key: "inv",
      label: "Invalidation",
      value: `${price(zones.invalidation.price)} daily close`,
      at: Number(zones.invalidation.price),
    });
  rows.sort((a, b) => b.at - a.at);
  return (
    <section className="tr-card" aria-label="Levels">
      <h2>Levels</h2>
      {rows.length === 0 ? (
        <p className="muted tr-empty">The agent&apos;s levels show here after a run.</p>
      ) : (
        <dl className="tr-rows">
          {rows.map((r) => (
            <div key={r.key}>
              <dt>{r.label}</dt>
              <dd className="num">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Bar({ pct, label }: { pct: number; label: string }) {
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="tr-gbar"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(shown)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${shown}%` }} />
    </div>
  );
}

export function GuardrailsCard({ run }: { run: AgentRun | null }) {
  const g = run?.guardrails;
  return (
    <section className="tr-card" aria-label="Your guardrails">
      <h2>
        Your guardrails <a href="#/profile">Profile</a>
      </h2>
      {!g || !run ? (
        <p className="muted tr-empty">Your Profile&apos;s limits for this coin show after a run.</p>
      ) : (
        <div className="tr-rows tr-guard">
          <div>
            <span>Cap this month</span>
            <b className="num">
              {g.capAud ? `${aud(g.monthSpentAud)} of ${aud(g.capAud)}` : "No cap set"}
            </b>
          </div>
          {g.capAud && (
            <Bar
              pct={(Number(g.monthSpentAud) / Number(g.capAud)) * 100}
              label="This month's buys against the cap"
            />
          )}
          <div>
            <span>{run.coin} share · max</span>
            <b className="num">
              {g.sharePct ?? "–"}% {g.maxPctPerCoin ? `of ${g.maxPctPerCoin}%` : "· no max set"}
            </b>
          </div>
          {g.maxPctPerCoin && g.sharePct && (
            <Bar
              pct={(Number(g.sharePct) / Number(g.maxPctPerCoin)) * 100}
              label={`${run.coin}'s share against the max per coin`}
            />
          )}
          <div>
            <span>Per trade</span>
            <b className="num">{g.perTradeAud ? aud(g.perTradeAud) : "Not set"}</b>
          </div>
          <div>
            <span>Minimum cash</span>
            <b className="num">{g.minCashAud ? aud(g.minCashAud) : "Not set"}</b>
          </div>
          <div>
            <span>Autonomy</span>
            <b>
              {run.agent.autonomy.slice(0, 1).toUpperCase()}
              {run.agent.autonomy.slice(1)}
            </b>
          </div>
        </div>
      )}
    </section>
  );
}

// Price alerts on this coin (decision 46): set from a call's Watch for lines, sent when crossed.
export function AlertsCard({
  coin,
  alerts,
  error,
  onRemove,
}: {
  coin: string;
  alerts: PriceAlert[] | null;
  error: string;
  onRemove: (id: number) => void;
}) {
  return (
    <section className="tr-card" aria-label="Alerts">
      <h2>Alerts</h2>
      {alerts === null && !error ? (
        <div className="skeleton tr-alerts-skeleton" aria-hidden="true" />
      ) : alerts && alerts.length > 0 ? (
        <ul className="tr-alerts">
          {alerts.map((a) => (
            <li key={a.id}>
              <span className={a.triggered ? "up" : undefined}>
                {a.triggered ? `Hit ${dateTime(a.triggered)}: ` : ""}
                {a.direction === "above" ? "Above" : "Below"}{" "}
                <b className="num">{price(a.price)}</b>
                {a.note && <span className="muted"> · {a.note}</span>}
              </span>
              <button
                className="tr-rm"
                type="button"
                aria-label={`Remove alert ${a.direction} ${price(a.price)}`}
                onClick={() => onRemove(a.id)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <p className="muted tr-empty">
            No alerts on {coin}. Set one from a call&apos;s Watch for lines.
          </p>
        )
      )}
      {error && (
        <p className="error-text tr-empty" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
