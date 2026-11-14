import { useCallback, useEffect, useState } from "react";
import { ApiError, addAlert, deleteAlert, getPlan, setRisk } from "./api";
import { amount as coinAmount, dateTime, percent, price } from "./format";
import { whatIf } from "./plan";
import type { PlanAction, PlanFacts, RiskRules, Signal } from "./types";

// The AI panel (decision 46): a plan for the owner's own position. Every number on it is
// worked out in code; the model only chose the action and zones and wrote the words. Its
// buttons only fill the trade form; nothing is placed from here.

const two = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number | string | null) =>
  v === null || v === "" ? "–" : `$${two.format(Number(v))}`;
const pct = (v: number | string | null, digits = 1) =>
  v === null ? "–" : `${Number(v).toFixed(digits)}%`;

const TONE: Record<PlanAction, string> = {
  Buy: "up",
  Add: "up",
  Hold: "wait",
  Wait: "wait",
  Trim: "down",
  Sell: "down",
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong.";
}

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : dateTime(ms);
}

export default function AiPanel({
  coin,
  signal,
  running,
  error,
  onRun,
  onPrefill,
}: {
  coin: string;
  signal: Signal | null;
  running: boolean;
  error: string;
  onRun: () => void;
  onPrefill: (side: "buy" | "sell", at: string) => void;
}) {
  const [facts, setFacts] = useState<PlanFacts | null>(null);
  const [factsError, setFactsError] = useState("");
  const load = useCallback(() => {
    getPlan(coin).then(
      (next) => {
        // Only a complete reply is shown: a partial one would put wrong numbers on the page.
        const whole = next?.position && next.track && next.rules && next.whatIf;
        setFacts(whole ? next : null);
        setFactsError(whole ? "" : "Your position couldn't be read just now.");
      },
      (e: unknown) => setFactsError(message(e)),
    );
  }, [coin]);
  useEffect(() => {
    load();
  }, [load, signal?.ranAt]);

  const plan = signal?.action ? signal : null;
  return (
    <div className="ai-panel">
      {facts ? (
        <PositionStrip facts={facts} />
      ) : (
        !factsError && <div className="skeleton" style={{ height: 22 }} />
      )}
      {factsError && <p className="muted ai-note">{factsError}</p>}

      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      {plan?.action ? (
        <div className="ai-grid">
          <div className="ai-left">
            <ActionBlock signal={plan} />
            <Zones signal={plan} onPrefill={onPrefill} />
            {facts && <WhatIf facts={facts} signal={plan} />}
          </div>
          <div className="ai-right">
            <Why signal={plan} />
            {(plan.context?.length ?? 0) > 0 && (
              <div className="ai-context">
                {plan.context?.map((c) => (
                  <p key={c}>{c}</p>
                ))}
              </div>
            )}
            {facts && <WatchFor signal={plan} facts={facts} onChanged={load} />}
          </div>
        </div>
      ) : (
        <p className="muted ai-note">
          {signal
            ? "This signal is from before plans. Re-run for a plan for your position."
            : "Run the analysis for a plan for your position: the action, zones to act in and why."}
        </p>
      )}

      <div className="ai-foot">
        <span className="muted">
          {signal ? `Updated ${ago(signal.ranAt)}` : "Not run yet"}
          {signal?.stale && " · older than 4 hours"}
          {plan?.changedSince && ` · ${plan.changedSince}`}
        </span>
        <button className="link" type="button" disabled={running} onClick={onRun}>
          {running ? "Analysing…" : signal ? "Re-run analysis" : "Run analysis"}
        </button>
        {facts && facts.track.scored > 0 && (
          <span className="muted">
            Last {facts.track.scored} signals on {coin}: {facts.track.correct} right a day later
          </span>
        )}
      </div>
      {facts && <RulesLine rules={facts.rules} onSaved={load} />}
      <p className="ai-note muted">
        Uses your position (amount, avg cost, PnL, allocation). Never your keys. Advice only; you
        decide.
      </p>
    </div>
  );
}

function PositionStrip({ facts }: { facts: PlanFacts }) {
  const p = facts.position;
  if (!p.held) {
    return (
      <p className="ai-position">
        You don&apos;t hold {facts.coin} · {money(facts.cash)} available
      </p>
    );
  }
  const loss = Number(p.pnlPct ?? 0) < 0;
  return (
    <p className="ai-position">
      You hold{" "}
      <b>
        {coinAmount(p.qty)} {facts.coin}
      </b>{" "}
      ({money(p.value)}) · Avg {p.avgCost ? price(p.avgCost) : "–"} ·{" "}
      <span className={loss ? "down" : "up"}>{percent(p.pnlPct)}</span> · {pct(p.weightPct, 0)} of
      portfolio
    </p>
  );
}

function ActionBlock({ signal }: { signal: Signal }) {
  const action = signal.action as PlanAction;
  const was = signal.confidenceBefore;
  return (
    <div className="ai-action">
      <div className="kv" style={{ padding: 0 }}>
        <span className={`ai-verb ${TONE[action]}`}>{action}</span>
        <span className="num">
          {signal.confidence}%
          {was !== null && was !== undefined && <span className="muted">, was {was}%</span>}
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${signal.confidence}%` }} />
      </div>
      {signal.horizons && (
        <div className="ai-horizons">
          {(
            [
              ["Short term", signal.horizons.short],
              ["Swing", signal.horizons.swing],
              ["Long term", signal.horizons.long],
            ] as const
          ).map(([label, act]) => (
            <div key={label}>
              <span className="muted">{label}</span>
              <b className={TONE[act]}>{act}</b>
            </div>
          ))}
        </div>
      )}
      {signal.rulesNotes?.map((n) => (
        <p key={n} className="ai-rule wait">
          {n}
        </p>
      ))}
    </div>
  );
}

function Zones({
  signal,
  onPrefill,
}: {
  signal: Signal;
  onPrefill: (side: "buy" | "sell", at: string) => void;
}) {
  const z = signal.zones;
  if (!z) return null;
  return (
    <div className="ai-zones">
      <h3 className="detail-h">Plan</h3>
      {z.buy && (
        <div className="kv">
          <span>
            <span className="muted">
              {signal.action === "Buy" || signal.action === "Wait" ? "Buy zone" : "Add zone"}
            </span>{" "}
            <b className="num">
              {price(z.buy.low)} – {price(z.buy.high)}
            </b>
          </span>
          <button
            className="link"
            type="button"
            onClick={() => onPrefill("buy", z.buy?.high ?? "")}
          >
            Prefill limit buy
          </button>
        </div>
      )}
      {z.noChase && (
        <div className="kv">
          <span>
            <span className="muted">Don&apos;t chase above</span>{" "}
            <b className="num">{price(z.noChase)}</b>
          </span>
        </div>
      )}
      {z.invalidation && (
        <div className="kv">
          <span>
            <span className="muted">Invalidation</span> daily close below{" "}
            <b className="num">{price(z.invalidation.price)}</b>
            {z.invalidation.next && (
              <span className="muted"> → next {price(z.invalidation.next)}</span>
            )}
          </span>
        </div>
      )}
      {z.trim && (
        <div className="kv">
          <span>
            <span className="muted">Trim zone</span>{" "}
            <b className="num">
              {price(z.trim.low)} – {price(z.trim.high)}
            </b>
          </span>
          <button
            className="link"
            type="button"
            onClick={() => onPrefill("sell", z.trim?.low ?? "")}
          >
            Prefill limit sell
          </button>
        </div>
      )}
      {!z.buy && !z.trim && !z.invalidation && (
        <p className="muted">No zones to act in right now.</p>
      )}
    </div>
  );
}

function WhatIf({ facts, signal }: { facts: PlanFacts; signal: Signal }) {
  const at = Number(signal.zones?.buy?.high ?? facts.price);
  const [amount, setAmount] = useState(() =>
    facts.whatIf.amount ? Number(facts.whatIf.amount).toFixed(2) : "",
  );
  const p = facts.position;
  const found = whatIf(
    {
      qty: Number(p.qty),
      avgCost: p.avgCost === null ? null : Number(p.avgCost),
      value: Number(p.value ?? 0),
    },
    at,
    Number(amount) || 0,
    Number(facts.total ?? 0),
    Number(facts.cash ?? 0),
  );
  const be = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
  return (
    <div className="ai-whatif">
      <h3 className="detail-h">What if</h3>
      <div className="ai-whatif-in">
        <span className="muted">If you {p.held ? "add" : "buy"}</span>
        <div className="in">
          <span className="muted">$</span>
          <input
            aria-label="Amount to add"
            className="num"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <span className="muted">at {price(String(at))}</span>
      </div>
      <div className="kv">
        <span className="muted">New average</span>
        <span className="num">{found.newAvg === null ? "–" : price(String(found.newAvg))}</span>
      </div>
      <div className="kv">
        <span className="muted">Rise to break even</span>
        <span className="num">
          {be(found.breakEvenBefore)} → {be(found.breakEvenAfter)}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Share of portfolio</span>
        <span className={`num ${found.weightAfter > Number(facts.rules.maxCoinPct) ? "down" : ""}`}>
          {found.weightBefore.toFixed(1)}% → {found.weightAfter.toFixed(1)}%
        </span>
      </div>
      <div className="kv">
        <span className="muted">Cash left</span>
        <span className={`num ${found.cashLeft < 0 ? "down" : ""}`}>{money(found.cashLeft)}</span>
      </div>
      {found.weightAfter > Number(facts.rules.maxCoinPct) && (
        <p className="ai-rule wait">Over your {facts.rules.maxCoinPct}% cap a coin.</p>
      )}
    </div>
  );
}

function Why({ signal }: { signal: Signal }) {
  const w = signal.why;
  if (!w) return null;
  return (
    <div className="ai-why">
      <h3 className="detail-h">Why</h3>
      {w.bull && (
        <p>
          <b className="up">+</b> {w.bull}
        </p>
      )}
      {w.bear && (
        <p>
          <b className="down">−</b> {w.bear}
        </p>
      )}
      {w.changeMind && (
        <p>
          <b className="muted">?</b> {w.changeMind}
        </p>
      )}
    </div>
  );
}

function WatchFor({
  signal,
  facts,
  onChanged,
}: {
  signal: Signal;
  facts: PlanFacts;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const set = (w: { price: string; direction: "above" | "below"; note: string }) =>
    addAlert({ coin: facts.coin, ...w }).then(onChanged, (e: unknown) => setError(message(e)));
  const remove = (id: number) =>
    deleteAlert(id).then(onChanged, (e: unknown) => setError(message(e)));
  const has = (w: { price: string; direction: string }) =>
    facts.alerts.some(
      (a) => a.price === w.price && a.direction === w.direction && a.triggered === null,
    );
  return (
    <div className="ai-watch">
      <h3 className="detail-h">Watch for</h3>
      {(signal.watchFor ?? []).map((w) => (
        <div className="kv" key={`${w.direction}-${w.price}`}>
          <span>
            {w.direction === "above" ? "Above" : "Below"} <b className="num">{price(w.price)}</b>{" "}
            <span className="muted">{w.note}</span>
          </span>
          {has(w) ? (
            <span className="muted">Alert set</span>
          ) : (
            <button className="link" type="button" onClick={() => void set(w)}>
              Set alert
            </button>
          )}
        </div>
      ))}
      {(signal.watchFor ?? []).length === 0 && <p className="muted">Nothing to watch for yet.</p>}
      {facts.alerts.length > 0 && (
        <div className="ai-alerts">
          {facts.alerts.map((a) => (
            <div className="kv" key={a.id}>
              <span className={a.triggered ? "up" : "muted"}>
                {a.triggered ? `Hit ${dateTime(a.triggered)}: ` : "Alert: "}
                {a.direction} {price(a.price)}
              </span>
              <button
                className="link danger"
                type="button"
                aria-label={`Remove alert ${a.direction} ${a.price}`}
                onClick={() => void remove(a.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function RulesLine({ rules, onSaved }: { rules: RiskRules; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(rules);
  const [error, setError] = useState("");
  if (!editing) {
    return (
      <div className="ai-rules muted">
        Your rules: max {rules.maxCoinPct}% a coin · A$
        {Number(rules.tradeBudgetAud).toLocaleString("en-AU")} a trade · max loss {rules.maxLossPct}
        % a position{" "}
        <button
          className="link"
          type="button"
          onClick={() => {
            setForm(rules);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </div>
    );
  }
  const field = (key: keyof RiskRules, label: string, unit: string) => (
    <div className="field">
      <label htmlFor={`risk-${key}`}>{label}</label>
      <div className="in">
        <input
          id={`risk-${key}`}
          className="num"
          inputMode="decimal"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
        <span className="muted">{unit}</span>
      </div>
    </div>
  );
  return (
    <div className="ai-rules-edit">
      <div className="dca-two" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {field("maxCoinPct", "Max a coin", "%")}
        {field("tradeBudgetAud", "A trade", "A$")}
        {field("maxLossPct", "Max loss", "%")}
      </div>
      {error && <p className="error-text">{error}</p>}
      <div
        className="row-actions"
        style={{ justifyContent: "flex-start", width: "auto", marginTop: 8 }}
      >
        <button
          className="btn btn-small"
          type="button"
          onClick={() =>
            setRisk(form).then(
              () => {
                setEditing(false);
                onSaved();
              },
              (e: unknown) => setError(message(e)),
            )
          }
        >
          Save rules
        </button>
        <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
