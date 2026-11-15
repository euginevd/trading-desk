// The Dashboard as a personal, rules-aware coach (decision 52): a greeting and mood, the deposit
// coach and today's key points above the fold, the weekly recap, then the agents as a team under
// the Desk Coordinator (decision 59). Every figure comes from the api; the words are the model's
// when it has written them, the plain ones until then.
import { useEffect, useState } from "react";
import { getAgent, getAgents, getCoach, getRecaps, sendAgent, writeCoach, writeRecap } from "./api";
import { aud, audWhole, fetchedAt, longDate, percent, price } from "./format";
import { ResetIcon } from "./icons";
import { OutOfDate } from "./RuleMarks";
import type {
  AgentInfo,
  AgentThread,
  Coach as CoachData,
  KeyPoint,
  Mood,
  Recap as RecapData,
} from "./types";

const ARROWS: Record<Mood, string> = {
  sharp_up: "▲▲",
  up: "▲",
  flat: "■",
  down: "▼",
  sharp_down: "▼▼",
};

function problem(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function Coach() {
  const [coach, setCoach] = useState<CoachData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState<string | null>(null);
  // Each refresh bumps the round: the coach and the recap read again.
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    getCoach().then(
      (data) => {
        if (!live) return;
        setCoach(data);
        setError(null);
        setLoading(false);
        setFetched(new Date().toISOString());
        // The model words today's message once; it's kept, so this only runs when it's new.
        if (data.pending)
          writeCoach().then(
            (next) => live && setCoach(next),
            () => undefined,
          );
      },
      (e: unknown) => {
        if (!live) return;
        setError(problem(e, "The coach couldn't load."));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [round]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setRound((r) => r + 1);
  };

  return (
    <main className="wrap coach">
      <div className="head-row coach-head">
        <h1 className="visually-hidden">Dashboard</h1>
        <span className="spacer" />
        <span className="label">{fetched ? `Fetched ${fetchedAt(fetched)}` : "Fetching"}</span>
        <button
          className={`icon-btn refresh-btn${loading ? " spinning" : ""}`}
          type="button"
          aria-label={loading ? "Refreshing" : "Refresh"}
          title="Refresh"
          onClick={refresh}
          disabled={loading}
        >
          <ResetIcon />
        </button>
      </div>
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button className="btn btn-small" type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {coach ? (
        <>
          <Greeting coach={coach} />
          <div className="coach-row">
            <Deposits coach={coach} />
            <KeyPoints points={coach.keyPoints} />
          </div>
          <Recaps round={round} />
          <Agents />
        </>
      ) : (
        !error && (
          <section className="card coach-greet" aria-busy="true">
            <p className="muted">Reading your portfolio and your Profile…</p>
          </section>
        )
      )}
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
          {message.outOfDate && (
            <div className="coach-dated">
              <OutOfDate />
            </div>
          )}
          {message.lines.map((line, i) => (
            <p key={`${i}-${line}`}>{line}</p>
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
          Your lesson{d.lesson.year ? ` · ${d.lesson.year}` : ""} — <strong>{d.lesson.text}</strong>
        </p>
      )}
      {!d.capAud && (
        <a className="coach-set" href="#/profile">
          Set a monthly cap on your Profile →
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

type RecapState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; recaps: RecapData[] };

// The weekly recap (decision 58): written on Sunday at 6 pm, or now on request.
function Recaps({ round }: { round: number }) {
  const [state, setState] = useState<RecapState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState("");

  useEffect(() => {
    let live = true;
    getRecaps().then(
      (r) => live && setState({ kind: "ready", recaps: r.recaps }),
      (e: unknown) =>
        live && setState({ kind: "error", message: problem(e, "The recaps couldn't load.") }),
    );
    return () => {
      live = false;
    };
  }, [round, retry]);

  const write = () => {
    setWriting(true);
    setWriteError("");
    writeRecap().then(
      ({ recap }) => {
        setState((s) => ({
          kind: "ready",
          recaps: [
            recap,
            ...(s.kind === "ready" ? s.recaps : []).filter((r) => r.week !== recap.week),
          ],
        }));
        setWriting(false);
      },
      (e: unknown) => {
        setWriteError(problem(e, "The recap couldn't be written. Try again."));
        setWriting(false);
      },
    );
  };

  const [newest, ...past] = state.kind === "ready" ? state.recaps : [];
  return (
    <section className="card coach-card coach-recap" aria-labelledby="coach-recap">
      <div className="coach-card-head">
        <h3 id="coach-recap">Weekly recap</h3>
        <button className="btn btn-small" type="button" disabled={writing} onClick={write}>
          {writing ? "Writing…" : "Write now"}
        </button>
      </div>
      {writeError && (
        <p className="error-text" role="alert">
          {writeError}
        </p>
      )}
      {state.kind === "loading" && (
        <p className="muted" aria-busy="true">
          Reading your recaps…
        </p>
      )}
      {state.kind === "error" && (
        <div className="alert" role="alert">
          <span>{state.message}</span>
          <button
            className="btn btn-small"
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              setRetry((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.kind === "ready" && !newest && (
        <p className="muted">Your first recap comes on Sunday at 6 pm.</p>
      )}
      {newest && (
        <article className="coach-recap-body">
          <p className="coach-recap-meta">
            <span className="muted">
              Week to {longDate(newest.week)} ·{" "}
              {newest.source === "model"
                ? "written by the AI from your figures"
                : "a plain summary of your figures"}
            </span>
            {newest.outOfDate && <OutOfDate />}
          </p>
          <p className="coach-recap-headline">{newest.headline}</p>
          {newest.lines.length > 0 && (
            <ul className="coach-points">
              {newest.lines.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </article>
      )}
      {past.length > 0 && (
        <details className="coach-past">
          <summary>Past recaps ({past.length})</summary>
          <ul>
            {past.map((r) => (
              <li key={r.week}>
                {r.headline} <span className="muted">· {longDate(r.week)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function AgentCard({
  agent,
  lead,
  chosen,
  onChoose,
}: {
  agent: AgentInfo;
  lead: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const remitId = `coach-remit-${agent.id}`;
  return (
    <button
      type="button"
      className={`coach-agent${lead ? " lead" : ""}${chosen ? " on" : ""}`}
      aria-pressed={chosen}
      aria-label={`${agent.name}, ${agent.title}`}
      aria-describedby={remitId}
      onClick={onChoose}
    >
      <span className="coach-avatar" aria-hidden="true">
        {initial(agent.name)}
      </span>
      <span className="coach-agent-text">
        <span className="coach-agent-name">
          {agent.name}
          {chosen && <span className="coach-agent-open">Open</span>}
        </span>
        <span className="coach-agent-title">{agent.title}</span>
        <span className="coach-agent-remit" id={remitId}>
          {agent.remit}
        </span>
      </span>
    </button>
  );
}

type TeamState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; agents: AgentInfo[] };

// Five agents as a team (decision 59): the Desk Coordinator leads, the four specialists report to
// them. Each reads the Profile; advice only.
function Agents() {
  const [team, setTeam] = useState<TeamState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState("desk");
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    getAgents().then(
      (r) => live && setTeam({ kind: "ready", agents: r.agents }),
      () => live && setTeam({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [retry]);
  useEffect(() => {
    let live = true;
    getAgent(chosen).then(
      (t) => live && setThread(t),
      () => live && setThread(null),
    );
    return () => {
      live = false;
    };
  }, [chosen]);

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

  const agents = team.kind === "ready" ? team.agents : [];
  const lead = agents.find((a) => a.reportsTo === null) ?? null;
  const reports = agents.filter((a) => a !== lead);
  const info = agents.find((a) => a.id === chosen);
  const shown = thread?.id === chosen ? thread : null;
  const name = info?.name ?? shown?.name ?? "the desk";
  const title = info?.title ?? shown?.title ?? "";
  const choose = (id: string) => {
    if (id === chosen) return;
    setThread(null);
    setChosen(id);
  };

  return (
    <section className="coach-agents" aria-labelledby="coach-agents">
      <div className="card coach-card">
        <h3 id="coach-agents">
          Agents{" "}
          <span className="muted coach-sub">
            · each reads your Profile and flags a suggestion that would break a rule
          </span>
        </h3>
        {team.kind === "loading" && (
          <p className="muted" aria-busy="true">
            Meeting the team…
          </p>
        )}
        {team.kind === "error" && (
          <div className="alert" role="alert">
            <span>The team couldn&apos;t load. Check the api is running.</span>
            <button
              className="btn btn-small"
              type="button"
              onClick={() => {
                setTeam({ kind: "loading" });
                setRetry((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {team.kind === "ready" && agents.length === 0 && (
          <p className="muted">No agents are set up. Restart the api, then refresh.</p>
        )}
        {agents.length > 0 && (
          <div className="coach-team" role="group" aria-label="Agents">
            {lead && (
              <AgentCard
                agent={lead}
                lead
                chosen={lead.id === chosen}
                onChoose={() => choose(lead.id)}
              />
            )}
            {lead && reports.length > 0 && <p className="coach-reports">Reports to {lead.name}</p>}
            {reports.length > 0 && (
              <div className={`coach-specialists${lead ? " under" : ""}`}>
                {reports.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    lead={false}
                    chosen={a.id === chosen}
                    onChoose={() => choose(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="muted coach-sub coach-advice">
          Advice only. Nothing is placed from the Dashboard.
        </p>
      </div>
      <div className="card coach-card coach-chat">
        <div className="coach-chat-head">
          <span className="coach-avatar small" aria-hidden="true">
            {initial(name)}
          </span>
          <h3>
            {name}
            {title && <span className="muted coach-sub"> · {title}</span>}
          </h3>
        </div>
        <div className="coach-thread" aria-live="polite">
          {(shown?.messages ?? []).length === 0 && <p className="muted">Ask {name}.</p>}
          {shown?.messages.map((m) => (
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
            placeholder={`Ask ${name}…`}
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
