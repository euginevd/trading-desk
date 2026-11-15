// The Dashboard as a personal, rules-aware coach (decision 52): a greeting and mood, the deposit
// coach and today's key points above the fold, the agents below. Every figure comes from the
// api; the words are the model's when it has written them, the plain ones until then.
import { useCallback, useEffect, useState } from "react";
import { getAgent, getAgents, getCoach, sendAgent, writeCoach } from "./api";
import { aud, audWhole, percent, price, shortDate } from "./format";
import type { AgentThread, Coach as CoachData, KeyPoint, Mood } from "./types";

const ARROWS: Record<Mood, string> = {
  sharp_up: "▲▲",
  up: "▲",
  flat: "■",
  down: "▼",
  sharp_down: "▼▼",
};

export default function Coach() {
  const [coach, setCoach] = useState<CoachData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCoach().then(
      (data) => {
        if (!live) return;
        setCoach(data);
        // The model words today's message once; it's kept, so this only runs when it's new.
        if (data.pending)
          writeCoach().then(
            (next) => live && setCoach(next),
            () => undefined,
          );
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : "The coach couldn't load."),
    );
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <main className="wrap coach">
        <p className="error-text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!coach) {
    return (
      <main className="wrap coach">
        <section className="card coach-greet" aria-busy="true">
          <p className="muted">Reading your portfolio and your Plan…</p>
        </section>
      </main>
    );
  }
  return (
    <main className="wrap coach">
      <Greeting coach={coach} />
      <div className="coach-row">
        <Deposits coach={coach} />
        <KeyPoints points={coach.keyPoints} />
      </div>
      <Agents />
    </main>
  );
}

function Greeting({ coach }: { coach: CoachData }) {
  const change = Number(coach.changeAud);
  const { message } = coach;
  const direction = Number(coach.changePct) < 0 ? "down" : "up";
  return (
    <section className="card coach-greet" aria-labelledby="coach-hello">
      <div>
        <h2 id="coach-hello">{coach.greeting}</h2>
        <p className="coach-headline">
          {coach.mood === "flat"
            ? `Your portfolio is flat today (${percent(coach.changePct)}, ${audWhole(change)}).`
            : `Your portfolio is ${direction} ${percent(String(Math.abs(Number(coach.changePct))), false)} today `}
          {coach.mood !== "flat" && (
            <span className={change < 0 ? "down" : "up"}>({audWhole(change)})</span>
          )}
          {coach.mood !== "flat" && "."}
        </p>
        <div className="coach-message" aria-live="polite">
          {message.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {message.link === "trade" && (
            <p>
              <a href="#/trade">Go to Trade →</a>
            </p>
          )}
          {message.quote && (
            <blockquote className="coach-quote">
              “{message.quote.text}”{message.quote.author && ` — ${message.quote.author}`}
            </blockquote>
          )}
        </div>
      </div>
      <div className="coach-side">
        <span className={`coach-mood ${coach.mood}`}>
          {ARROWS[coach.mood]} {coach.moodLabel}
        </span>
        <div className="coach-links">
          <a href="#/portfolio">Portfolio →</a>
          <a href="#/trade">Trade →</a>
        </div>
      </div>
    </section>
  );
}

function Deposits({ coach }: { coach: CoachData }) {
  const d = coach.deposits;
  const used = Math.min(Number(d.usedPct ?? 0), 100);
  return (
    <section className="card coach-card" aria-labelledby="coach-deposits">
      <h3 id="coach-deposits">Deposits</h3>
      {!d.known && <p className="muted">Binance's deposit history couldn't be read just now.</p>}
      <div className="coach-split">
        <span>This financial year{d.fy ? ` (${d.fy})` : ""}</span>
        <strong>{aud(d.fyAud)}</strong>
      </div>
      <div className="coach-split coach-month">
        <span>This month</span>
        <span>{d.capAud ? `cap ${aud(d.capAud)}` : "no cap set"}</span>
      </div>
      <div className="coach-big">
        {aud(d.monthAud)}
        {d.capAud && (
          <span className="muted">
            {" "}
            of {aud(d.capAud)} · {aud(d.leftAud)} left
          </span>
        )}
      </div>
      {d.capAud && (
        <div
          className={`coach-bar${d.overAud ? " over" : ""}`}
          role="progressbar"
          aria-label="This month's deposits against the cap"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${used}%` }} />
        </div>
      )}
      {d.overAud && <p className="coach-over">Over your monthly cap by {aud(d.overAud)}</p>}
      <p className="coach-line">{coach.message.coach}</p>
      {d.lesson && (
        <p className="coach-note">
          Your note · {shortDate(d.lesson.date)} — <strong>{d.lesson.happened}</strong>
          {d.lesson.learned && `. ${d.lesson.learned}`}
        </p>
      )}
      {!d.capAud && (
        <a className="coach-set" href="#/plan">
          Set a monthly cap on your Plan →
        </a>
      )}
    </section>
  );
}

export function pointText(p: KeyPoint): string {
  switch (p.kind) {
    case "concentration":
      return `${p.coin} is ${p.pct}% of your portfolio, over your ${p.cap}% cap.`;
    case "loss":
      return `${p.coin} is ${percent(p.pct)} on its cost, past your ${p.cap}% max loss.`;
    case "mover":
      return `${p.coin} moved most of what you hold: ${percent(p.pct)} today.`;
    case "addZone":
      return `${p.coin} is in its add zone (${price(p.low)} to ${price(p.high)}) on its last plan.`;
    case "nearInvalidation":
      return `${p.coin} is ${percent(p.pct, false)} above its invalidation level (${price(p.price)}).`;
  }
}

function KeyPoints({ points }: { points: KeyPoint[] }) {
  return (
    <section className="card coach-card" aria-labelledby="coach-points">
      <h3 id="coach-points">Today&apos;s key points</h3>
      {points.length === 0 ? (
        <p className="muted">Nothing stands out today.</p>
      ) : (
        <ul className="coach-points">
          {points.map((p) => (
            <li key={`${p.kind}-${p.coin}`}>
              {pointText(p)}
              {p.rule && <span className="coach-rule">Rule</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Agents() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState("desk");
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getAgents().then(
      (r) => setAgents(r.agents),
      () => setAgents([]),
    );
  }, []);
  const load = useCallback((id: string) => {
    getAgent(id).then(setThread, () => setThread(null));
  }, []);
  useEffect(() => load(chosen), [chosen, load]);

  const send = () => {
    if (!text.trim()) return;
    setSending(true);
    sendAgent(chosen, text).then(
      (next) => {
        setThread(next);
        setText("");
        setSending(false);
      },
      () => setSending(false),
    );
  };
  const name = agents.find((a) => a.id === chosen)?.name ?? "Ask the desk";

  return (
    <section className="coach-agents" aria-labelledby="coach-agents">
      <div className="card coach-card">
        <h3 id="coach-agents">
          Agents{" "}
          <span className="muted coach-sub">
            · each reads your Plan and flags a suggestion that would break a rule
          </span>
        </h3>
        <div className="coach-chips" role="group" aria-label="Agents">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.id === chosen ? "on" : ""}
              aria-pressed={a.id === chosen}
              onClick={() => setChosen(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
        <p className="muted coach-sub">Advice only. Nothing is placed from the Dashboard.</p>
      </div>
      <div className="card coach-card coach-chat">
        <h3>{name}</h3>
        <div className="coach-thread" aria-live="polite">
          {(thread?.messages ?? []).length === 0 && (
            <p className="muted">Ask {name === "Ask the desk" ? "the desk" : `the ${name}`}.</p>
          )}
          {thread?.messages.map((m) => (
            <p key={`${m.time}-${m.role}-${m.text}`} className={`coach-bubble ${m.role}`}>
              {m.text}
            </p>
          ))}
        </div>
        <form
          className="coach-ask"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            aria-label={`Message to ${name}`}
            placeholder={`Ask ${name === "Ask the desk" ? "the desk" : `the ${name}`}…`}
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" disabled={sending || !text.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
