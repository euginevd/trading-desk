// The Plan (decision 52): the owner's written trading plan, the source every agent reads. Each
// section saves on its own; the rules keep a history of every change.
import { type ReactNode, useEffect, useState } from "react";
import { getTradingPlan, saveTradingPlan } from "./api";
import { dateTime } from "./format";
import type { Lesson, PlanSection, Quote, TradingPlan } from "./types";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

export default function PlanPage() {
  const [plan, setPlan] = useState<TradingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTradingPlan().then(setPlan, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Your Plan couldn't be read."),
    );
  }, []);

  if (error) {
    return (
      <main className="wrap plan-page">
        <p className="error-text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!plan) {
    return (
      <main className="wrap plan-page">
        <p className="muted">Loading your Plan…</p>
      </main>
    );
  }
  return (
    <main className="wrap plan-page">
      <p className="muted plan-intro">
        Your profile and trading plan. Every agent reads it, and says when a suggestion would break
        one of your rules.
      </p>
      <div className="plan-grid">
        <Goals plan={plan} onSaved={setPlan} />
        <Strategy plan={plan} onSaved={setPlan} />
        <Rules plan={plan} onSaved={setPlan} />
        <Lessons plan={plan} onSaved={setPlan} />
        <Quotes plan={plan} onSaved={setPlan} />
      </div>
    </main>
  );
}

type Props = { plan: TradingPlan; onSaved: (plan: TradingPlan) => void };

function useSave(section: PlanSection, onSaved: (plan: TradingPlan) => void) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (body: unknown) => {
    setSaving(true);
    setNote(null);
    saveTradingPlan(section, body).then(
      (next) => {
        onSaved(next);
        setSaving(false);
        setNote({ ok: true, text: "Saved" });
      },
      (e: unknown) => {
        setSaving(false);
        setNote({ ok: false, text: e instanceof Error ? e.message : "Not saved. Try again." });
      },
    );
  };
  return { saving, note, save };
}

function Section({
  n,
  title,
  updated,
  wide,
  extra,
  children,
  saving,
  note,
  onSave,
}: {
  n: number;
  title: string;
  updated: number | null;
  wide?: boolean;
  extra?: ReactNode;
  children: ReactNode;
  saving: boolean;
  note: { ok: boolean; text: string } | null;
  onSave: () => void;
}) {
  const id = `plan-${title.toLowerCase()}`;
  return (
    <section className={`card plan-card${wide ? " wide" : ""}`} aria-labelledby={id}>
      <div className="plan-head">
        <h2 id={id}>
          {n} · {title}
        </h2>
        <span className="muted plan-updated">
          {updated ? `Last updated ${dateTime(updated)}` : "Not saved yet"}
          {extra}
        </span>
      </div>
      {children}
      <div className="plan-save">
        <button type="button" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : `Save ${title.toLowerCase()}`}
        </button>
        {note && (
          <span className={note.ok ? "muted" : "error-text"} role={note.ok ? "status" : "alert"}>
            {note.text}
          </span>
        )}
      </div>
    </section>
  );
}

function Goals({ plan, onSaved }: Props) {
  const [text, setText] = useState(plan.goals.text);
  const [targets, setTargets] = useState(plan.goals.targets);
  const { saving, note, save } = useSave("goals", onSaved);
  return (
    <Section
      n={1}
      title="Goals"
      updated={plan.goals.updated}
      saving={saving}
      note={note}
      onSave={() => save({ text, targets })}
    >
      <textarea
        aria-label="Goals"
        placeholder="What you're building, and over what time."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="plan-label">Target allocation</span>
      {targets.map((t, i) => (
        <div className="plan-line" key={i}>
          <input
            aria-label="Coin"
            placeholder="BTC"
            value={t.coin}
            onChange={(e) =>
              setTargets(targets.map((x, j) => (j === i ? { ...x, coin: e.target.value } : x)))
            }
          />
          <input
            aria-label={`${t.coin || "Coin"} target %`}
            inputMode="decimal"
            placeholder="%"
            value={t.pct}
            onChange={(e) =>
              setTargets(targets.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
            }
          />
          <span className="muted">%</span>
          <button
            className="link"
            type="button"
            onClick={() => setTargets(targets.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="link plan-add"
        type="button"
        onClick={() => setTargets([...targets, { coin: "", pct: "" }])}
      >
        + Add a target
      </button>
    </Section>
  );
}

function Strategy({ plan, onSaved }: Props) {
  const [text, setText] = useState(plan.strategy.text);
  const { saving, note, save } = useSave("strategy", onSaved);
  return (
    <Section
      n={2}
      title="Strategy"
      updated={plan.strategy.updated}
      saving={saving}
      note={note}
      onSave={() => save({ text })}
    >
      <textarea
        aria-label="Strategy"
        className="tall"
        placeholder="How you buy, when you take profit, the timeframes you trade."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Section>
  );
}

function Rules({ plan, onSaved }: Props) {
  const r = plan.rules;
  const [form, setForm] = useState({
    monthlyCapAud: r.monthlyCapAud ?? "",
    maxCoinPct: r.maxCoinPct,
    tradeBudgetAud: r.tradeBudgetAud,
    maxLossPct: r.maxLossPct,
    takeProfit: r.takeProfit,
    notes: r.notes,
    driftBand: r.driftBand,
  });
  const [behaviour, setBehaviour] = useState(r.behaviour);
  const [history, setHistory] = useState(false);
  const { saving, note, save } = useSave("rules", onSaved);
  const field = (
    key: "monthlyCapAud" | "maxCoinPct" | "tradeBudgetAud" | "maxLossPct" | "driftBand",
    label: string,
  ) => (
    <label className="plan-field">
      {label}
      <input
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <Section
      n={3}
      title="Rules"
      wide
      updated={r.updated}
      saving={saving}
      note={note}
      onSave={() => save({ ...form, behaviour })}
      extra={
        r.history.length > 0 && (
          <>
            {" · "}
            <button
              className="link"
              type="button"
              aria-expanded={history}
              onClick={() => setHistory(!history)}
            >
              History ({r.history.length})
            </button>
          </>
        )
      }
    >
      <div className="plan-fields">
        {field("monthlyCapAud", "Monthly deposit cap (A$)")}
        {field("maxCoinPct", "Max % per coin")}
        {field("tradeBudgetAud", "Per-trade size (A$)")}
        {field("maxLossPct", "Max loss per position (%)")}
        {field("driftBand", "Rebalance band (± points)")}
      </div>
      <span className="plan-label">Take-profit rule</span>
      <textarea
        aria-label="Take-profit rule"
        className="short"
        placeholder="If the portfolio is up 7 days in a row or +15% in 7 days, consider trimming back to target allocation."
        value={form.takeProfit}
        onChange={(e) => setForm({ ...form, takeProfit: e.target.value })}
      />
      <span className="plan-label">Behaviour rules</span>
      {behaviour.map((b, i) => (
        <div className="plan-line" key={i}>
          <input
            aria-label={`Behaviour rule ${i + 1}`}
            className="grow"
            value={b}
            onChange={(e) => setBehaviour(behaviour.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            className="link"
            type="button"
            onClick={() => setBehaviour(behaviour.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="link plan-add"
        type="button"
        onClick={() => setBehaviour([...behaviour, ""])}
      >
        + Add a rule
      </button>
      <span className="plan-label">Notes</span>
      <textarea
        aria-label="Rule notes"
        className="short"
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />
      {history && (
        <table className="plan-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Rule</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {r.history.map((h) => (
              <tr key={`${h.time}-${h.rule}`}>
                <td>{dateTime(h.time)}</td>
                <td>{h.rule}</td>
                <td>
                  {h.from} → {h.to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Lessons({ plan, onSaved }: Props) {
  const [items, setItems] = useState<Lesson[]>(plan.lessons.items);
  const { saving, note, save } = useSave("lessons", onSaved);
  const set = (i: number, part: Partial<Lesson>) =>
    setItems(items.map((x, j) => (j === i ? { ...x, ...part } : x)));
  return (
    <Section
      n={4}
      title="Lessons"
      updated={plan.lessons.updated}
      saving={saving}
      note={note}
      onSave={() => save({ items })}
    >
      {items.length === 0 && <p className="muted">No lessons yet.</p>}
      {items.map((l, i) => (
        <div className="plan-lesson" key={l.id ?? i}>
          <input
            type="date"
            aria-label="Date"
            value={l.date}
            onChange={(e) => set(i, { date: e.target.value })}
          />
          <input
            aria-label="What happened"
            placeholder="What happened"
            value={l.happened}
            onChange={(e) => set(i, { happened: e.target.value })}
          />
          <input
            aria-label="What I learned"
            placeholder="What I learned"
            value={l.learned}
            onChange={(e) => set(i, { learned: e.target.value })}
          />
          <button
            className="link"
            type="button"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="link plan-add"
        type="button"
        onClick={() => setItems([{ date: today(), happened: "", learned: "" }, ...items])}
      >
        + Add a lesson
      </button>
    </Section>
  );
}

function Quotes({ plan, onSaved }: Props) {
  const [items, setItems] = useState<Quote[]>(plan.quotes.items);
  const { saving, note, save } = useSave("quotes", onSaved);
  const set = (i: number, part: Partial<Quote>) =>
    setItems(items.map((x, j) => (j === i ? { ...x, ...part } : x)));
  return (
    <Section
      n={5}
      title="Quotes"
      updated={plan.quotes.updated}
      saving={saving}
      note={note}
      onSave={() => save({ items })}
      extra={<span> · agents quote only these</span>}
    >
      {items.length === 0 && (
        <p className="muted">No quotes yet. The coach skips the quote until you add one.</p>
      )}
      {items.map((q, i) => (
        <div className="plan-line" key={q.id ?? i}>
          <input
            aria-label="Quote"
            className="grow"
            placeholder="Opportunities always come back."
            value={q.text}
            onChange={(e) => set(i, { text: e.target.value })}
          />
          <input
            aria-label="Author"
            placeholder="Author"
            value={q.author}
            onChange={(e) => set(i, { author: e.target.value })}
          />
          <button
            className="link"
            type="button"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="link plan-add"
        type="button"
        onClick={() => setItems([...items, { text: "", author: "" }])}
      >
        + Add a quote
      </button>
    </Section>
  );
}
